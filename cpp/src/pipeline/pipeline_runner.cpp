#include "pipeline/pipeline_runner.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <unordered_set>
#include <utility>

#include "core/geometry.hpp"

namespace {

bool hasLargeOverlap(const std::vector<PersonTrackState>& people, float iou_thresh) {
    for (size_t i = 0; i < people.size(); ++i) {
        for (size_t j = i + 1; j < people.size(); ++j) {
            if (people[i].bbox.iou(people[j].bbox) >= iou_thresh) return true;
        }
    }
    return false;
}

bool IsWarpSane(const Mat3f& warp,
                int width,
                int height,
                const GmcConfig& cfg,
                float* out_mag = nullptr) {
    if (width <= 0 || height <= 0) return false;
    for (int r = 0; r < 3; ++r) {
        for (int c = 0; c < 3; ++c) {
            const float v = warp(r, c);
            if (!std::isfinite(v)) return false;
        }
    }

    const float tx = warp(0, 2);
    const float ty = warp(1, 2);
    const float mag = std::sqrt(tx * tx + ty * ty);
    const float diag = std::sqrt(static_cast<float>(width * width + height * height));
    const float max_trans = cfg.max_translation_frac * std::max(1.0f, diag);

    const float a = warp(0, 0);
    const float b = warp(0, 1);
    const float c = warp(1, 0);
    const float d = warp(1, 1);
    const float sx = std::sqrt(a * a + c * c);
    const float sy = std::sqrt(b * b + d * d);
    const float avg_scale = 0.5f * (sx + sy);
    const float scale_dev = std::abs(avg_scale - 1.0f);
    const float rot_rad = std::atan2(c, a);
    const float rot_deg = std::abs(rot_rad * 57.2957795f);

    if (out_mag) *out_mag = mag;
    return mag <= max_trans && scale_dev <= cfg.max_scale_deviation &&
           rot_deg <= cfg.max_rotation_deg;
}

int countSwitchBreaks(const std::vector<TrackFrame>& frames) {
    if (frames.size() < 3) return 0;
    int breaks = 0;
    for (size_t i = 2; i < frames.size(); ++i) {
        const auto& a = frames[i - 2];
        const auto& b = frames[i - 1];
        const auto& c = frames[i];
        const int dt1 = b.frame_index - a.frame_index;
        const int dt2 = c.frame_index - b.frame_index;
        if (dt1 <= 0 || dt2 <= 0 || dt1 > 3 || dt2 > 3) continue;
        const float vx1 = b.bbox.centerX() - a.bbox.centerX();
        const float vy1 = b.bbox.centerY() - a.bbox.centerY();
        const float vx2 = c.bbox.centerX() - b.bbox.centerX();
        const float vy2 = c.bbox.centerY() - b.bbox.centerY();
        const float dot = vx1 * vx2 + vy1 * vy2;
        const float n1 = std::sqrt(vx1 * vx1 + vy1 * vy1) + 1e-6f;
        const float n2 = std::sqrt(vx2 * vx2 + vy2 * vy2) + 1e-6f;
        const float cosv = dot / (n1 * n2);
        if (cosv < -0.2f) ++breaks;
    }
    return breaks;
}

}  // namespace

namespace {

void EmitProgress(const char* stage,
                  int current_frame,
                  int total_frames,
                  int percent,
                  const char* message) {
    fprintf(stderr,
            "FB_PROGRESS {\"stage\":\"%s\",\"currentFrame\":%d,\"totalFrames\":%d,\"percent\":%d,\"message\":\"%s\"}\n",
            stage,
            current_frame,
            total_frames,
            percent,
            message);
}

}  // namespace

PipelineRunner::PipelineRunner(const PipelineConfig& cfg)
    : cfg_(cfg),
      detector_(cfg_.person_detection),
      face_detector_(cfg_.face_detection),
      reid_(cfg_.body_reid),
      associator_(cfg_.association),
      gmc_(cfg_.gmc),
      tracker_(cfg_.tracker, reid_.IsEnabled(), cfg_.body_reid),
      linker_(cfg_.linking, cfg_.output),
      post_(cfg_.output) {}

PipelineResult PipelineRunner::Run(IFrameSource& source, float video_fps) {
    PipelineResult result;
    result.frame_count = source.FrameCount();
    const int total_frames = result.frame_count;

    if (total_frames <= 0 || !detector_.IsLoaded() || !face_detector_.IsLoaded()) {
        return result;
    }

    FrameScheduler scheduler(total_frames,
                             video_fps,
                             cfg_.person_detection.detection_fps,
                             cfg_.gmc.gmc_fps,
                             cfg_.gmc.enabled);

    std::unordered_map<int, std::vector<TrackFrame>> person_track_data;
    std::unordered_map<int, std::vector<FaceKeyframe>> face_track_data;
    std::vector<std::pair<int, int>> frame_sizes(static_cast<size_t>(total_frames), {0, 0});

    std::vector<Detection> person_dets;
    std::vector<FaceDetection> face_dets;
    ITracker::TrackMap active_tracks;
    PipelineStats stats{};

    FramePool pool;
    FrameBuffer prev_buf;
    bool prev_valid = false;
    int force_detection_until = -1;
    int no_face_run = 0;

    const char* gmc_log_env = std::getenv("FACE_PIPELINE_LOG_GMC");
    const bool log_gmc = gmc_log_env && gmc_log_env[0] != '\0' && gmc_log_env[0] != '0';
    const char* assoc_log_env = std::getenv("FACE_PIPELINE_LOG_ASSOC");
    const bool log_assoc = assoc_log_env && assoc_log_env[0] != '\0' && assoc_log_env[0] != '0';
    const int progress_emit_every = std::max(1, total_frames / 100);

    EmitProgress("startup", 0, total_frames, 0, "Pipeline initialized.");

    for (int i = 0; i < total_frames; ++i) {
        const bool det_frame_base = scheduler.IsDetectionFrame(i);
        const bool det_frame = det_frame_base || (i <= force_detection_until);
        const bool gmc_frame = scheduler.IsGmcFrame(i);
        if (!det_frame_base && det_frame) {
            ++stats.quality.adaptive_detection_frames;
        }

        FrameInfo info{};
        bool info_ok = source.GetFrameInfo(i, info);

        FrameBuffer cur_buf = pool.Acquire();
        bool cur_buf_used = true;
        bool cur_ok = source.ReadFrame(i, cur_buf);
        if (cur_ok) {
            info = cur_buf.info;
            info_ok = true;
        }

        if (info_ok) {
            frame_sizes[static_cast<size_t>(i)] = {info.width, info.height};
        }

        Mat3f warp_prev_to_curr = Mat3f::Identity();
        bool warp_ok = false;
        bool gmc_rejected = false;
        float gmc_mag = 0.0f;
        if (cfg_.gmc.enabled && gmc_frame && cur_ok && i > 0) {
            FrameView prev_view;
            FrameBuffer prev_tmp;
            bool prev_ok = false;
            bool prev_tmp_used = false;

            if (prev_valid && prev_buf.info.index == i - 1) {
                prev_view = prev_buf.view();
                prev_ok = prev_view.isValid();
            } else {
                prev_tmp = pool.Acquire();
                prev_tmp_used = true;
                prev_ok = source.ReadFrame(i - 1, prev_tmp);
                if (prev_ok) {
                    prev_view = prev_tmp.view();
                }
            }

            if (prev_ok) {
                warp_ok = gmc_.Estimate(prev_view, cur_buf.view(), warp_prev_to_curr);
                if (warp_ok && cfg_.gmc.enable_sanity_gate) {
                    const bool sane = IsWarpSane(
                        warp_prev_to_curr, info.width, info.height, cfg_.gmc, &gmc_mag);
                    if (!sane) {
                        warp_ok = false;
                        gmc_rejected = true;
                        ++stats.quality.gmc_rejected_frames;
                    }
                }
            }

            if (prev_tmp_used) {
                pool.Release(std::move(prev_tmp));
            }
        }

        if (log_gmc && gmc_frame) {
            fprintf(stderr,
                    "GMC: frame=%d ok=%d m=[%.4f %.4f %.4f; %.4f %.4f %.4f; %.4f %.4f %.4f]\n",
                    i,
                    warp_ok ? 1 : 0,
                    warp_prev_to_curr(0, 0), warp_prev_to_curr(0, 1), warp_prev_to_curr(0, 2),
                    warp_prev_to_curr(1, 0), warp_prev_to_curr(1, 1), warp_prev_to_curr(1, 2),
                    warp_prev_to_curr(2, 0), warp_prev_to_curr(2, 1), warp_prev_to_curr(2, 2));
        }

        person_dets.clear();
        if (cur_ok && det_frame) {
            PersonDetectTimingMs person_timing{};
            const auto t0 = std::chrono::steady_clock::now();
            detector_.Detect(cur_buf.view(), person_dets, &person_timing);
            const auto t1 = std::chrono::steady_clock::now();
            stats.timing_ms.person_detect +=
                std::chrono::duration<double, std::milli>(t1 - t0).count();
            stats.timing_ms.person_preprocess += person_timing.preprocess;
            stats.timing_ms.person_infer += person_timing.infer;
            stats.timing_ms.person_decode += person_timing.decode;
            stats.person_detections += static_cast<int>(person_dets.size());

            if (reid_.IsEnabled()) {
                const auto t2 = std::chrono::steady_clock::now();
                reid_.Extract(cur_buf.view(), person_dets);
                const auto t3 = std::chrono::steady_clock::now();
                stats.timing_ms.body_reid +=
                    std::chrono::duration<double, std::milli>(t3 - t2).count();
            }
        }

        const FrameInfo tracker_frame = info_ok ? info : FrameInfo{i, 0, 0};
        const auto t_track_0 = std::chrono::steady_clock::now();
        tracker_.Update(person_dets,
                        true,
                        warp_ok ? &warp_prev_to_curr : nullptr,
                        tracker_frame,
                        active_tracks);
        const auto t_track_1 = std::chrono::steady_clock::now();
        stats.timing_ms.track_update +=
            std::chrono::duration<double, std::milli>(t_track_1 - t_track_0).count();

        std::vector<PersonTrackState> active_people;
        if (info_ok) {
            const float min_bbox_px = cfg_.output.min_bbox_frac *
                                      static_cast<float>(std::min(info.width, info.height));
            for (const auto& kv : active_tracks) {
                const int track_id = kv.first;
                const auto& track_result = kv.second;
                BBox bbox = clamp_bbox(track_result.bbox, info.width, info.height);
                if (bbox.width() < min_bbox_px || bbox.height() < min_bbox_px) {
                    continue;
                }
                if (track_result.confidence < cfg_.output.min_output_conf) {
                    continue;
                }
                stats.quality.total_track_frames++;
                if (track_result.time_since_update > 0) {
                    stats.quality.predicted_track_frames++;
                }
                person_track_data[track_id].push_back(TrackFrame{i, bbox, track_result.confidence});
                active_people.push_back(PersonTrackState{track_id, bbox, track_result.confidence});
            }
        }

        if (hasLargeOverlap(active_people, 0.35f)) {
            ++stats.quality.duplicate_overlap_frames;
            force_detection_until = std::max(force_detection_until, i + 12);
        }
        if (gmc_rejected || (warp_ok && gmc_mag > 0.0f &&
                             gmc_mag > 0.06f * std::sqrt(static_cast<float>(info.width * info.width +
                                                                            info.height * info.height)))) {
            force_detection_until = std::max(force_detection_until, i + 8);
        }

        face_dets.clear();
        if (cur_ok) {
            const auto t_face_0 = std::chrono::steady_clock::now();
            face_detector_.Detect(cur_buf.view(), face_dets);
            const auto t_face_1 = std::chrono::steady_clock::now();
            stats.timing_ms.face_detect +=
                std::chrono::duration<double, std::milli>(t_face_1 - t_face_0).count();
            stats.face_detections += static_cast<int>(face_dets.size());

            if (!face_dets.empty() && !active_people.empty() && info_ok) {
                const auto t_assoc_0 = std::chrono::steady_clock::now();
                std::vector<FacePersonCandidate> assoc_candidates;
                const auto matches = log_assoc
                                         ? associator_.Associate(
                                               face_dets, active_people, i, &assoc_candidates)
                                         : associator_.Associate(face_dets, active_people, i);
                const auto t_assoc_1 = std::chrono::steady_clock::now();
                stats.timing_ms.associate +=
                    std::chrono::duration<double, std::milli>(t_assoc_1 - t_assoc_0).count();
                stats.associated_faces += static_cast<int>(matches.size());
                stats.unassociated_faces +=
                    static_cast<int>(face_dets.size()) - static_cast<int>(matches.size());

                if (log_assoc) {
                    int gate_pass_count = 0;
                    float max_iou = 0.0f;
                    float max_overlap = 0.0f;
                    std::vector<FacePersonCandidate> best_by_face(face_dets.size());
                    std::vector<bool> have_best(face_dets.size(), false);
                    for (const auto& c : assoc_candidates) {
                        if (c.gate_pass) ++gate_pass_count;
                        max_iou = std::max(max_iou, c.iou);
                        max_overlap = std::max(max_overlap, c.face_overlap);

                        if (c.face_index < 0 ||
                            c.face_index >= static_cast<int>(best_by_face.size())) {
                            continue;
                        }
                        const size_t face_idx = static_cast<size_t>(c.face_index);
                        if (!have_best[face_idx] || c.score > best_by_face[face_idx].score) {
                            best_by_face[face_idx] = c;
                            have_best[face_idx] = true;
                        }
                    }

                    fprintf(stderr,
                            "ASSOC: frame=%d faces=%zu people=%zu matches=%zu gatePass=%d/%zu maxIoU=%.3f maxOverlap=%.3f\n",
                            i,
                            face_dets.size(),
                            active_people.size(),
                            matches.size(),
                            gate_pass_count,
                            assoc_candidates.size(),
                            max_iou,
                            max_overlap);

                    const size_t face_log_count = std::min<size_t>(3, face_dets.size());
                    for (size_t fi = 0; fi < face_log_count; ++fi) {
                        if (!have_best[fi]) continue;
                        const auto& best = best_by_face[fi];
                        fprintf(stderr,
                                "ASSOC: frame=%d face=%zu bestPerson=%d iou=%.3f overlap=%.3f center=%d gate=%d score=%.3f\n",
                                i,
                                fi,
                                best.person_id,
                                best.iou,
                                best.face_overlap,
                                best.center_inside ? 1 : 0,
                                best.gate_pass ? 1 : 0,
                                best.score);
                    }
                }

                for (const auto& m : matches) {
                    if (m.face_index < 0 || m.face_index >= static_cast<int>(face_dets.size())) continue;
                    const auto& fd = face_dets[static_cast<size_t>(m.face_index)];
                    const BBox b = clamp_bbox(fd.bbox, info.width, info.height);
                    face_track_data[m.person_id].push_back(FaceKeyframe{i, b, fd.score, m.iou});
                }

                if (!active_people.empty() && matches.empty()) {
                    ++stats.quality.person_present_no_face_frames;
                    ++no_face_run;
                    stats.quality.longest_person_present_no_face_run =
                        std::max(stats.quality.longest_person_present_no_face_run, no_face_run);
                    force_detection_until = std::max(force_detection_until, i + 6);
                } else {
                    no_face_run = 0;
                }
            } else {
                stats.unassociated_faces += static_cast<int>(face_dets.size());
                if (!active_people.empty()) {
                    ++stats.quality.person_present_no_face_frames;
                    ++no_face_run;
                    stats.quality.longest_person_present_no_face_run =
                        std::max(stats.quality.longest_person_present_no_face_run, no_face_run);
                } else {
                    no_face_run = 0;
                }
            }
        } else if (!active_people.empty()) {
            ++stats.quality.person_present_no_face_frames;
            ++no_face_run;
            stats.quality.longest_person_present_no_face_run =
                std::max(stats.quality.longest_person_present_no_face_run, no_face_run);
        } else {
            no_face_run = 0;
        }

        if (cur_ok) {
            if (prev_valid) {
                pool.Release(std::move(prev_buf));
            }
            prev_buf = std::move(cur_buf);
            prev_valid = true;
            cur_buf_used = false;
        }

        if (cur_buf_used) {
            pool.Release(std::move(cur_buf));
        }

        const int processed = i + 1;
        if (processed == total_frames || (processed % progress_emit_every) == 0) {
            const int percent = std::max(0, std::min(95, (processed * 95) / total_frames));
            EmitProgress("processing", processed, total_frames, percent, "Processing frames.");
        }
    }

    std::unordered_map<int, Appearance> appearances;
    if (reid_.IsEnabled()) {
        auto finished = tracker_.TakeFinishedAppearances();
        auto active = tracker_.GetActiveAppearances();
        appearances = std::move(finished);
        for (auto& kv : active) {
            appearances[kv.first] = kv.second;
        }
    }

    auto merged_data = linker_.Link(std::move(person_track_data),
                                    appearances,
                                    video_fps,
                                    cfg_.person_detection.conf_thresh,
                                    cfg_.body_reid.cos_thresh);
    EmitProgress("linking", total_frames, total_frames, 97, "Linking track fragments.");

    result = post_.Finalize(std::move(merged_data),
                            std::move(face_track_data),
                            frame_sizes,
                            cfg_.person_detection.conf_thresh);
    EmitProgress("finalizing", total_frames, total_frames, 99, "Finalizing output.");
    result.frame_count = source.FrameCount();
    result.stats = stats;

    std::unordered_map<int, std::unordered_set<int>> face_frames_by_person;
    for (const auto& ft : result.face_tracks) {
        auto& face_set = face_frames_by_person[ft.person_id];
        for (const auto& f : ft.frames) {
            face_set.insert(f.frame_index);
        }
    }

    for (const auto& person : result.people) {
        PersonFaceCoverage coverage{};
        coverage.person_id = person.id;
        coverage.person_frames = static_cast<int>(person.frames.size());
        const auto ff_it = face_frames_by_person.find(person.id);
        const std::unordered_set<int>* ff =
            (ff_it == face_frames_by_person.end()) ? nullptr : &ff_it->second;

        int open_gap = 0;
        for (const auto& pf : person.frames) {
            const bool has_face = ff && ff->find(pf.frame_index) != ff->end();
            if (has_face) {
                ++coverage.face_frames;
                if (open_gap > 0) {
                    ++coverage.blink_gaps;
                    coverage.longest_blink_gap = std::max(coverage.longest_blink_gap, open_gap);
                    open_gap = 0;
                }
            } else {
                ++open_gap;
            }
        }
        if (open_gap > 0) {
            ++coverage.blink_gaps;
            coverage.longest_blink_gap = std::max(coverage.longest_blink_gap, open_gap);
        }

        if (coverage.person_frames > 0) {
            coverage.coverage =
                static_cast<float>(coverage.face_frames) / static_cast<float>(coverage.person_frames);
        }
        result.stats.quality.person_face_coverage.push_back(coverage);
        result.stats.quality.estimated_switch_breakpoints += countSwitchBreaks(person.frames);
    }
    std::sort(result.stats.quality.person_face_coverage.begin(),
              result.stats.quality.person_face_coverage.end(),
              [](const PersonFaceCoverage& a, const PersonFaceCoverage& b) {
                  return a.person_id < b.person_id;
              });

    if (prev_valid) {
        pool.Release(std::move(prev_buf));
    }

    return result;
}
