#include "pipeline.hpp"
#include "gmc.hpp"
#include "stb_image.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <limits>
#include <map>

namespace {
std::vector<Detection> NmsDetections(std::vector<Detection> dets, float iou_thresh) {
    if (dets.size() <= 1) return dets;
    std::sort(dets.begin(), dets.end(),
              [](const Detection& a, const Detection& b) { return a.score > b.score; });

    std::vector<Detection> kept;
    kept.reserve(dets.size());
    for (const auto& d : dets) {
        bool suppressed = false;
        for (const auto& k : kept) {
            if (d.bbox.iou(k.bbox) > iou_thresh) {
                suppressed = true;
                break;
            }
        }
        if (!suppressed) kept.push_back(d);
    }
    return kept;
}

inline bool FileExists(const std::string& path) {
    std::ifstream f(path.c_str(), std::ios::binary);
    return f.good();
}

struct LoadedRgbFrame {
    int w = 0;
    int h = 0;
    std::vector<uint8_t> rgb;  // RGB, size = w*h*3
};

inline bool LoadRgbFrame(const std::string& path, LoadedRgbFrame& out) {
    out = LoadedRgbFrame{};
    int w = 0, h = 0, ch = 0;
    unsigned char* rgb = stbi_load(path.c_str(), &w, &h, &ch, 3);
    if (!rgb || w <= 0 || h <= 0) {
        if (rgb) stbi_image_free(rgb);
        return false;
    }
    out.w = w;
    out.h = h;
    out.rgb.assign(rgb, rgb + static_cast<size_t>(w) * static_cast<size_t>(h) * 3u);
    stbi_image_free(rgb);
    return true;
}

inline float clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

inline float cosine_sim(const std::array<float, Detection::kReidDim>& a,
                        const std::array<float, Detection::kReidDim>& b) {
    double dot = 0.0;
    for (int i = 0; i < Detection::kReidDim; ++i) {
        dot += static_cast<double>(a[i]) * static_cast<double>(b[i]);
    }
    return clampf(static_cast<float>(dot), -1.0f, 1.0f);
}

inline float bbox_diag(const BBox& b) {
    const float w = std::max(0.0f, b.width());
    const float h = std::max(0.0f, b.height());
    return std::sqrt(w * w + h * h);
}

inline float center_dist_norm_max_diag(const BBox& a, const BBox& b) {
    const float acx = (a.x1 + a.x2) * 0.5f;
    const float acy = (a.y1 + a.y2) * 0.5f;
    const float bcx = (b.x1 + b.x2) * 0.5f;
    const float bcy = (b.y1 + b.y2) * 0.5f;
    const float dx = acx - bcx;
    const float dy = acy - bcy;
    const float diag = std::max(bbox_diag(a), bbox_diag(b)) + 1e-6f;
    return std::sqrt(dx * dx + dy * dy) / diag;
}

struct UnionFind {
    std::map<int, int> parent;
    int find(int x) {
        auto it = parent.find(x);
        if (it == parent.end()) {
            parent[x] = x;
            return x;
        }
        int p = it->second;
        if (p == x) return x;
        int r = find(p);
        parent[x] = r;
        return r;
    }
    void unite(int a, int b) {
        int ra = find(a);
        int rb = find(b);
        if (ra == rb) return;
        // Keep smallest ID as the representative for stable output.
        if (ra < rb) parent[rb] = ra;
        else parent[ra] = rb;
    }
};
}  // namespace

FacePipeline::FacePipeline(const std::string& model_dir,
                           float conf_thresh,
                           float detection_fps,
                           float iou_thresh,
                           const std::string& reid_model_dir,
                           float reid_weight,
                           float reid_cos_thresh)
    : detector_(model_dir + "/scrfd.param",
                model_dir + "/scrfd.bin",
                640, 640,
                conf_thresh,
                0.4f),  // NMS threshold
      conf_thresh_(conf_thresh),
      detection_fps_(detection_fps),
      iou_thresh_(iou_thresh),
      use_reid_(!reid_model_dir.empty()),
      reid_weight_(reid_weight),
      reid_cos_thresh_(reid_cos_thresh) {
    if (!use_reid_) return;

    // Prefer optimized files if present.
    std::string param_path = reid_model_dir + "/mobilefacenet-opt.param";
    std::string bin_path = reid_model_dir + "/mobilefacenet-opt.bin";
    if (!FileExists(param_path) || !FileExists(bin_path)) {
        param_path = reid_model_dir + "/mobilefacenet.param";
        bin_path = reid_model_dir + "/mobilefacenet.bin";
    }

    if (!FileExists(param_path) || !FileExists(bin_path)) {
        use_reid_ = false;
        return;
    }

    reid_ = std::make_unique<MobileFaceNetReid>(param_path, bin_path);
    if (!reid_->IsLoaded()) {
        reid_.reset();
        use_reid_ = false;
    }
}

BBox FacePipeline::scrfdToBBox(const ScrfdFace& face, int width, int height) {
    // Convert from absolute to normalized coordinates
    return BBox{
        face.bbox[0] / static_cast<float>(width),
        face.bbox[1] / static_cast<float>(height),
        face.bbox[2] / static_cast<float>(width),
        face.bbox[3] / static_cast<float>(height)
    };
}

std::vector<Detection> FacePipeline::detectSingle(const std::string& image_path,
                                                  int& width, int& height) {
    std::vector<Detection> result;
    
    if (!detector_.IsLoaded()) {
        return result;
    }
    
    // Load image
    int channels;
    unsigned char* rgb = stbi_load(image_path.c_str(), &width, &height, &channels, 3);
    if (!rgb) {
        return result;
    }
    
    // Detect faces
    std::vector<ScrfdFace> faces = detector_.Detect(rgb, width, height);
    
    // Convert to normalized Detection (bbox + score)
    result.reserve(faces.size());
    for (const auto& face : faces) {
        Detection det{scrfdToBBox(face, width, height), face.score};
        if (use_reid_ && reid_ && reid_->IsLoaded()) {
            // ReID crop uses absolute pixel bbox.
            const BBox abs_bbox{face.bbox[0], face.bbox[1], face.bbox[2], face.bbox[3]};
            bool ok = false;
            float q = 0.0f;
            det.reid = reid_->Extract(rgb, width, height, abs_bbox, &face.landmarks, ok, &q);
            det.reid_quality = q;
            // ReID may be used for association even if quality is low;
            // bank updates are gated inside the tracker by reid_quality.
            det.has_reid = ok;
        }
        result.push_back(det);
    }

    // SCRFD can occasionally produce multiple highly-overlapping boxes on the same face
    // (e.g. near-profile / partial occlusion). A small NMS pass here reduces duplicate
    // track births downstream.
    result = NmsDetections(std::move(result), 0.30f);

    stbi_image_free(rgb);
    
    return result;
}

PipelineResult FacePipeline::process(const std::vector<std::string>& image_paths,
                                      float video_fps) {
    PipelineResult result;
    result.frame_count = static_cast<int>(image_paths.size());
    
    if (image_paths.empty() || !detector_.IsLoaded()) {
        return result;
    }
    
    // Calculate detection stride (how many frames between detections)
    int stride = std::max(1, static_cast<int>(video_fps / detection_fps_));
    
    // Phase 1: Run face detection on sampled frames
    // Store detections as map: frame_index -> list of bboxes
    std::map<int, std::vector<Detection>> detections;
    int last_width = 0, last_height = 0;

    // Dev-only: ReID quality gate health counters.
    int reid_attempted = 0;
    int reid_kept = 0;
    double reid_q_sum = 0.0;
    double reid_q_min = std::numeric_limits<double>::infinity();
    double reid_q_max = -std::numeric_limits<double>::infinity();
    
    for (int i = 0; i < result.frame_count; i += stride) {
        int width, height;
        auto faces = detectSingle(image_paths[i], width, height);
        if (use_reid_) {
            for (const auto& d : faces) {
                reid_attempted++;
                reid_q_sum += static_cast<double>(d.reid_quality);
                reid_q_min = std::min(reid_q_min, static_cast<double>(d.reid_quality));
                reid_q_max = std::max(reid_q_max, static_cast<double>(d.reid_quality));
                if (d.has_reid) reid_kept++;
            }
        }
        if (!faces.empty()) {
            detections[i] = std::move(faces);
            last_width = width;
            last_height = height;
        }
    }
    
    // Always detect on last frame if not already done
    int last_frame = result.frame_count - 1;
    if (detections.find(last_frame) == detections.end()) {
        int width, height;
        auto faces = detectSingle(image_paths[last_frame], width, height);
        if (use_reid_) {
            for (const auto& d : faces) {
                reid_attempted++;
                reid_q_sum += static_cast<double>(d.reid_quality);
                reid_q_min = std::min(reid_q_min, static_cast<double>(d.reid_quality));
                reid_q_max = std::max(reid_q_max, static_cast<double>(d.reid_quality));
                if (d.has_reid) reid_kept++;
            }
        }
        if (!faces.empty()) {
            detections[last_frame] = std::move(faces);
        }
    }
    
    // Phase 2: Track across all frames
    // IoU threshold controls how strict matching is between detections and predictions
    // max_age=90 (3 seconds at 30fps) allows tracks to survive long gaps
    // min_hits=1 to allow tracks from single detections (we filter later)
    OCSort tracker(iou_thresh_, 90, 1, 3, 0.2f, use_reid_, reid_weight_, reid_cos_thresh_);

    // Global Motion Compensation (GMC): estimate camera warp between consecutive frames
    // and apply it to track predictions before association.
    GmcEstimator gmc(GmcConfig{});
    LoadedRgbFrame prev_frame;
    bool prev_ok = false;
    int gmc_attempts = 0;
    int gmc_ok = 0;
    int gmc_frame_load_ok = 0;
    
    // Collect track data: track_id -> list of TrackFrames
    std::map<int, std::vector<TrackFrame>> track_data;

    auto clamp01 = [](float v) { return std::max(0.0f, std::min(1.0f, v)); };
    auto clampBBox01 = [&](const BBox& b) {
        return BBox{
            clamp01(b.x1),
            clamp01(b.y1),
            clamp01(b.x2),
            clamp01(b.y2),
        };
    };
    
    for (int i = 0; i < result.frame_count; ++i) {
        LoadedRgbFrame cur_frame;
        const bool cur_ok = LoadRgbFrame(image_paths[i], cur_frame);
        if (cur_ok) gmc_frame_load_ok++;
        Mat3f warp_prev_to_curr = Mat3f::Identity();
        bool warp_ok = false;
        if (i > 0 && prev_ok && cur_ok) {
            gmc_attempts++;
            warp_ok = gmc.Estimate(cur_frame.rgb.data(), cur_frame.w, cur_frame.h,
                                   prev_frame.rgb.data(), prev_frame.w, prev_frame.h,
                                   warp_prev_to_curr);
            if (warp_ok) gmc_ok++;
        }

        // Check if this is a detection frame
        auto det_it = detections.find(i);
        bool is_detection_frame = (det_it != detections.end());
        
        // Only pass detections on actual detection frames
        // On non-detection frames, pass empty vector - tracker will predict only
        std::vector<Detection> frame_dets;
        if (is_detection_frame) {
            frame_dets = det_it->second;
        }
        
        // Update tracker
        auto active_tracks = tracker.update(frame_dets,
                                            true,  // return_all=true
                                            warp_ok ? &warp_prev_to_curr : nullptr,
                                            cur_ok ? cur_frame.w : 0,
                                            cur_ok ? cur_frame.h : 0);

        prev_frame = std::move(cur_frame);
        prev_ok = cur_ok;
        
        // Record track frames (skip degenerate bboxes)
        // Note: When `return_all=true`, OC-SORT will also emit predictions on frames
        // without a matched detection. We drop ultra-low-confidence predictions to
        // avoid "ghost" boxes lingering and accidentally blurring the wrong region.
        constexpr float kMinOutputConfidence = 0.05f;
        for (const auto& [track_id, track_result] : active_tracks) {
            const BBox bbox = clampBBox01(track_result.bbox);
            // Skip degenerate boxes (zero or near-zero dimensions)
            if (bbox.width() < 0.01f || bbox.height() < 0.01f) {
                continue;
            }
            if (track_result.confidence < kMinOutputConfidence) {
                continue;
            }
            track_data[track_id].push_back(TrackFrame{
                i,
                bbox,
                track_result.confidence
            });
        }
    }

    // Dev-only: opt-in GMC health log (stderr), without polluting JSON output.
    if (std::getenv("FACE_PIPELINE_LOG_GMC") != nullptr) {
#ifdef FACE_PIPELINE_GMC_OPENCV
        constexpr int kGmcCompiled = 1;  // OpenCV videostab backend
#elif defined(FACE_PIPELINE_GMC_FALLBACK)
        constexpr int kGmcCompiled = 2;  // dependency-free fallback backend
#else
        constexpr int kGmcCompiled = 0;  // disabled
#endif
        const float ok_ratio = (gmc_attempts > 0) ? (static_cast<float>(gmc_ok) / static_cast<float>(gmc_attempts)) : 0.0f;
        fprintf(stderr,
                "GMC: compiled=%d frames_loaded=%d/%d attempts=%d ok=%d ok_ratio=%.3f\n",
                kGmcCompiled,
                gmc_frame_load_ok,
                result.frame_count,
                gmc_attempts,
                gmc_ok,
                ok_ratio);
    }

    if (use_reid_ && std::getenv("FACE_PIPELINE_LOG_REID") != nullptr) {
        const double mean_q = (reid_attempted > 0) ? (reid_q_sum / static_cast<double>(reid_attempted)) : 0.0;
        const double qmin = std::isfinite(reid_q_min) ? reid_q_min : 0.0;
        const double qmax = std::isfinite(reid_q_max) ? reid_q_max : 0.0;
        fprintf(stderr,
                "ReID: attempted=%d kept=%d kept_ratio=%.3f q_mean=%.3f q_min=%.3f q_max=%.3f\n",
                reid_attempted,
                reid_kept,
                (reid_attempted > 0) ? (static_cast<double>(reid_kept) / static_cast<double>(reid_attempted)) : 0.0,
                mean_q,
                qmin,
                qmax);
    }
    
    // Phase 3: Offline tracklet linking (Stage B) + build output tracks.
    // Link short/high-precision tracklets across gaps using appearance + time/space constraints.
    std::map<int, std::array<float, Detection::kReidDim>> appearances;
    if (use_reid_) {
        auto finished = tracker.takeFinishedAppearances();
        auto active = tracker.getActiveAppearances();
        appearances = std::move(finished);
        for (auto& kv : active) {
            appearances[kv.first] = kv.second;
        }
    }

    // Summarize tracklets from collected geometry.
    struct TrackletSummary {
        int id = -1;
        int start_frame = 0;
        int end_frame = 0;
        BBox start_bbox{};
        BBox end_bbox{};
        int frame_count = 0;
        int conf_ge_thresh = 0;  // frames with confidence >= conf_thresh_
    };
    std::vector<TrackletSummary> tracklets;
    tracklets.reserve(track_data.size());
    for (const auto& kv : track_data) {
        const int id = kv.first;
        const auto& frames = kv.second;
        if (frames.empty()) continue;
        TrackletSummary s;
        s.id = id;
        s.frame_count = static_cast<int>(frames.size());
        // Trim extremely low-confidence prediction tails so tracklet spans reflect
        // when the face was actually present (helps offline linking + removes ghosts).
        const float span_conf = std::max(0.20f, conf_thresh_ * 0.60f);
        int first = 0;
        int last = static_cast<int>(frames.size()) - 1;
        while (first < static_cast<int>(frames.size()) &&
               frames[first].confidence < span_conf) {
            first++;
        }
        while (last >= 0 && frames[last].confidence < span_conf) {
            last--;
        }
        if (first >= static_cast<int>(frames.size()) || last < 0 || last < first) {
            // Fallback: use raw endpoints.
            first = 0;
            last = static_cast<int>(frames.size()) - 1;
        }
        s.start_frame = frames[first].frame_index;
        s.end_frame = frames[last].frame_index;
        s.start_bbox = frames[first].bbox;
        s.end_bbox = frames[last].bbox;

        int ge = 0;
        for (const auto& f : frames) {
            if (f.confidence >= conf_thresh_) ge++;
        }
        s.conf_ge_thresh = ge;
        tracklets.push_back(s);
    }

    UnionFind uf;
    for (const auto& s : tracklets) uf.parent[s.id] = s.id;

    int links_made = 0;
    double sim_sum = 0.0;
    double sim_min = std::numeric_limits<double>::infinity();
    double sim_max = -std::numeric_limits<double>::infinity();

    if (use_reid_ && !appearances.empty() && tracklets.size() >= 2) {
        const int link_max_gap_short = std::max(1, static_cast<int>(std::round(video_fps * 2.0f)));   // ~2s
        const int link_max_gap_long  = std::max(link_max_gap_short,
                                               static_cast<int>(std::round(video_fps * 10.0f)));      // ~10s
        constexpr float kMaxCenterDist = 2.0f;   // normalized by max diag
        constexpr float kMaxAreaRatio = 4.0f;

        const int n = static_cast<int>(tracklets.size());
        std::vector<int> best_to(n, -1);
        std::vector<float> best_to_sim(n, -1.0f);
        std::vector<float> best_to_dist(n, 1e9f);

        std::vector<int> best_from(n, -1);
        std::vector<float> best_from_sim(n, -1.0f);
        std::vector<float> best_from_dist(n, 1e9f);

        // Debug: track best long-gap candidate per tracklet (helps threshold tuning).
        std::vector<int> best_long_to(n, -1);
        std::vector<float> best_long_to_sim(n, -1.0f);
        std::vector<int> best_long_to_gap(n, 0);
        std::vector<float> best_long_to_dist(n, 1e9f);

        for (int i = 0; i < n; ++i) {
            const auto& A = tracklets[i];
            const auto itA = appearances.find(A.id);
            if (itA == appearances.end()) continue;

            for (int j = 0; j < n; ++j) {
                if (i == j) continue;
                const auto& B = tracklets[j];
                if (B.start_frame <= A.end_frame) continue;

                const int gap = B.start_frame - A.end_frame;
                if (gap <= 0 || gap > link_max_gap_long) continue;

                const auto itB = appearances.find(B.id);
                if (itB == appearances.end()) continue;

                const float dist = center_dist_norm_max_diag(A.end_bbox, B.start_bbox);
                if (!(dist <= kMaxCenterDist)) continue;

                const float aA = std::max(1e-6f, A.end_bbox.area());
                const float aB = std::max(1e-6f, B.start_bbox.area());
                float ar = aB / aA;
                if (ar < 1.0f) ar = 1.0f / std::max(1e-6f, ar);
                if (!(ar <= kMaxAreaRatio)) continue;

                const float sim = cosine_sim(itA->second, itB->second);
                const bool long_gap = (gap > link_max_gap_short);
                if (long_gap) {
                    if (sim > best_long_to_sim[i] || (sim == best_long_to_sim[i] && dist < best_long_to_dist[i])) {
                        best_long_to[i] = j;
                        best_long_to_sim[i] = sim;
                        best_long_to_gap[i] = gap;
                        best_long_to_dist[i] = dist;
                    }
                }

                float sim_thresh = reid_cos_thresh_;
                if (long_gap) {
                    // Long gaps are much riskier. Require (a) enough confident frames in
                    // both tracklets and (b) a moderate absolute similarity floor.
                    if (A.conf_ge_thresh < 6 || B.conf_ge_thresh < 6) continue;
                    sim_thresh = std::max(reid_cos_thresh_, 0.50f);
                }
                if (!(sim >= sim_thresh)) continue;

                // Best-to (A -> B): maximize sim, break ties with smaller dist.
                if (sim > best_to_sim[i] || (sim == best_to_sim[i] && dist < best_to_dist[i])) {
                    best_to[i] = j;
                    best_to_sim[i] = sim;
                    best_to_dist[i] = dist;
                }

                // Best-from (B <- A): maximize sim, break ties with smaller dist.
                if (sim > best_from_sim[j] || (sim == best_from_sim[j] && dist < best_from_dist[j])) {
                    best_from[j] = i;
                    best_from_sim[j] = sim;
                    best_from_dist[j] = dist;
                }
            }
        }

        for (int i = 0; i < n; ++i) {
            const int j = best_to[i];
            if (j < 0) continue;
            if (best_from[j] != i) continue;  // mutual nearest neighbor

            const int idA = tracklets[i].id;
            const int idB = tracklets[j].id;
            if (uf.find(idA) == uf.find(idB)) continue;
            uf.unite(idA, idB);
            links_made++;

            const double s = static_cast<double>(best_to_sim[i]);
            sim_sum += s;
            sim_min = std::min(sim_min, s);
            sim_max = std::max(sim_max, s);
        }

        if (std::getenv("FACE_PIPELINE_LOG_REID_CANDS") != nullptr) {
            for (int i = 0; i < n; ++i) {
                if (best_long_to[i] < 0) continue;
                const int idA = tracklets[i].id;
                const int idB = tracklets[best_long_to[i]].id;
                fprintf(stderr,
                        "ReIDLinkLongCand: %d -> %d gap=%d sim=%.3f dist=%.3f\n",
                        idA, idB,
                        best_long_to_gap[i],
                        best_long_to_sim[i],
                        best_long_to_dist[i]);
            }
        }
    }

    if (use_reid_ && std::getenv("FACE_PIPELINE_LOG_REID") != nullptr) {
        const double mean_sim = (links_made > 0) ? (sim_sum / static_cast<double>(links_made)) : 0.0;
        const double smin = std::isfinite(sim_min) ? sim_min : 0.0;
        const double smax = std::isfinite(sim_max) ? sim_max : 0.0;
        fprintf(stderr,
                "ReIDLink: links=%d sim_mean=%.3f sim_min=%.3f sim_max=%.3f\n",
                links_made,
                mean_sim,
                smin,
                smax);
    }

    // Merge track data by union-find representative.
    std::map<int, std::vector<TrackFrame>> merged_data;
    for (auto& kv : track_data) {
        const int root = uf.find(kv.first);
        auto& out = merged_data[root];
        auto& frames = kv.second;
        out.insert(out.end(), frames.begin(), frames.end());
    }

    // Deduplicate per-frame within merged tracks and sort.
    for (auto& kv : merged_data) {
        auto& frames = kv.second;
        std::sort(frames.begin(), frames.end(), [](const TrackFrame& a, const TrackFrame& b) {
            return a.frame_index < b.frame_index;
        });
        std::vector<TrackFrame> dedup;
        dedup.reserve(frames.size());
        for (const auto& f : frames) {
            if (dedup.empty() || dedup.back().frame_index != f.frame_index) {
                dedup.push_back(f);
            } else if (f.confidence > dedup.back().confidence) {
                dedup.back() = f;
            }
        }
        frames.swap(dedup);
    }

    // Filter out very short tracks (likely noise) AFTER linking.
    const int min_track_frames = 10;
    result.tracks.reserve(merged_data.size());
    for (auto& kv : merged_data) {
        const int id = kv.first;
        auto& frames = kv.second;
        if (static_cast<int>(frames.size()) < min_track_frames) continue;

        // Drop tracks that are mostly low-confidence predictions / spurious detections.
        // This helps eliminate duplicate short-lived IDs under jitter.
        int ge = 0;
        for (const auto& f : frames) {
            if (f.confidence >= conf_thresh_) ge++;
        }
        const float frac_ge = static_cast<float>(ge) / static_cast<float>(frames.size());
        if (ge < 3 || frac_ge < 0.15f) continue;

        FaceTrack track;
        track.id = id;
        track.frames = std::move(frames);
        result.tracks.push_back(std::move(track));
    }
    
    // Sort tracks by ID for consistent output
    std::sort(result.tracks.begin(), result.tracks.end(),
              [](const FaceTrack& a, const FaceTrack& b) {
                  return a.id < b.id;
              });
    
    return result;
}
