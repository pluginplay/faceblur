#include "ocsort.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace {
constexpr float kPi = 3.14159265358979323846f;
inline float clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
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
    // Normalize by the larger diagonal to avoid over-penalizing when one box
    // temporarily shrinks (common during partial occlusion / detector jitter).
    const float diag = std::max(bbox_diag(a), bbox_diag(b)) + 1e-6f;
    return std::sqrt(dx * dx + dy * dy) / diag;
}

inline float area_ratio(const BBox& a, const BBox& b) {
    const float aa = std::max(1e-6f, a.area());
    const float bb = std::max(1e-6f, b.area());
    float r = aa / bb;
    if (r < 1.0f) r = 1.0f / r;
    return r;
}

inline float cosine_sim(const std::array<float, Detection::kReidDim>& a,
                        const std::array<float, Detection::kReidDim>& b) {
    double dot = 0.0;
    for (int i = 0; i < Detection::kReidDim; ++i) {
        dot += static_cast<double>(a[i]) * static_cast<double>(b[i]);
    }
    // Both vectors are expected L2-normalized; clamp for numerical safety.
    return clampf(static_cast<float>(dot), -1.0f, 1.0f);
}

inline std::array<float, 2> speed_direction(const BBox& from, const BBox& to) {
    const float cx1 = (from.x1 + from.x2) / 2.0f;
    const float cy1 = (from.y1 + from.y2) / 2.0f;
    const float cx2 = (to.x1 + to.x2) / 2.0f;
    const float cy2 = (to.y1 + to.y2) / 2.0f;
    const float dy = cy2 - cy1;
    const float dx = cx2 - cx1;
    const float norm = std::sqrt(dx * dx + dy * dy) + 1e-6f;
    return {dy / norm, dx / norm};  // (dy, dx)
}
}  // namespace

OCSort::OCSort(float iou_thresh,
               int max_age,
               int min_hits,
               int delta_t,
               float inertia,
               bool use_reid,
               float reid_weight,
               float reid_cos_thresh,
               float rescue_iou_thresh,
               float assoc_max_center_dist,
               float assoc_max_area_ratio,
               float assoc_dist_weight,
               float assoc_area_weight,
               int max_return_pred_age)
    : iou_thresh_(iou_thresh),
      max_age_(max_age),
      min_hits_(min_hits),
      delta_t_(delta_t),
      inertia_(inertia),
      use_reid_(use_reid),
      reid_weight_(reid_weight),
      reid_cos_thresh_(reid_cos_thresh),
      rescue_iou_thresh_(rescue_iou_thresh),
      assoc_max_center_dist_(assoc_max_center_dist),
      assoc_max_area_ratio_(assoc_max_area_ratio),
      assoc_dist_weight_(assoc_dist_weight),
      assoc_area_weight_(assoc_area_weight),
      max_return_pred_age_(max_return_pred_age),
      next_id_(0) {}

std::unordered_map<int, TrackResult> OCSort::update(const std::vector<Detection>& detections,
                                                   bool return_all,
                                                   const Mat3f* warp_prev_to_curr,
                                                   int frame_width,
                                                   int frame_height) {
    frame_count_++;

    // Predict next state for all trackers
    for (auto& tracker : trackers_) {
        tracker->predict();
    }

    // Apply global motion compensation (prev -> curr) after prediction.
    // This keeps association and output in the current frame's coordinate system.
    if (warp_prev_to_curr && frame_width > 0 && frame_height > 0) {
        for (auto& tracker : trackers_) {
            tracker->applyWarp(*warp_prev_to_curr, frame_width, frame_height);
        }
    }
    
    // Associate detections to trackers
    std::vector<std::pair<int, int>> matched_indices;
    std::vector<int> unmatched_detections;
    std::vector<int> unmatched_trackers;
    associate(detections, matched_indices, unmatched_detections, unmatched_trackers);
    
    // Update matched trackers
    for (const auto& [d_idx, t_idx] : matched_indices) {
        auto& tracker = trackers_[t_idx];
        tracker->update(detections[d_idx]);
    }

    // Second round of association by OCR (observation-centric recovery)
    std::vector<std::pair<int, int>> ocr_matches;
    associateOCR(detections, ocr_matches, unmatched_detections, unmatched_trackers);
    for (const auto& [d_idx, t_idx] : ocr_matches) {
        auto& tracker = trackers_[t_idx];
        tracker->update(detections[d_idx]);
    }

    // Explicitly update unmatched trackers with "no observation" (required for ORU)
    for (int t_idx : unmatched_trackers) {
        trackers_[t_idx]->update(std::nullopt);
    }
    
    // Create new trackers for unmatched detections
    for (int d_idx : unmatched_detections) {
        trackers_.push_back(
            std::make_unique<KalmanBoxTracker>(detections[d_idx], next_id_++, delta_t_));
    }
    
    // Remove old trackers
    {
        std::vector<std::unique_ptr<KalmanBoxTracker>> kept;
        kept.reserve(trackers_.size());
        for (auto& t : trackers_) {
            if (t->timeSinceUpdate() > max_age_) {
                if (t->hasAppearance()) {
                    finished_appearances_[t->trackId()] = t->appearance();
                }
                continue;
            }
            kept.push_back(std::move(t));
        }
        trackers_.swap(kept);
    }
    
    // Return confirmed tracks
    std::unordered_map<int, TrackResult> result;
    
    for (const auto& tracker : trackers_) {
        // Only return confirmed tracks.
        //
        // Note: When `return_all=true` (prediction frames included), using
        // consecutive-hit streaks would make tracks "un-confirm" on frames
        // without an update (common in sparse-detection pipelines). For that
        // mode we instead gate on total hits, which matches typical MOT usage:
        // once confirmed, a track stays confirmed until aged out.
        const bool confirmed =
            ((return_all ? (tracker->hits() >= min_hits_) : (tracker->hitStreak() >= min_hits_)) ||
             (frame_count_ <= min_hits_));
        if (!confirmed) continue;

        // By default, only return tracks updated this frame
        if (!return_all && tracker->timeSinceUpdate() >= 1) {
            continue;
        }
        
        // Prefer returning the most recent observation when updated this frame;
        // otherwise return the KF prediction.
        BBox out_bbox = tracker->getState();
        float base_conf = 1.0f;
        if (tracker->lastObservation().has_value()) {
            base_conf = tracker->lastObservation()->score;
            if (tracker->timeSinceUpdate() == 0) {
                out_bbox = tracker->lastObservation()->bbox;
            }
        }
        if (tracker->timeSinceUpdate() > 0) {
            base_conf *= std::max(0.0f, 1.0f - 0.05f * static_cast<float>(tracker->timeSinceUpdate()));
        }

        if (return_all && tracker->timeSinceUpdate() > max_return_pred_age_) {
            continue;
        }

        result[tracker->trackId()] = TrackResult{out_bbox, base_conf, tracker->timeSinceUpdate()};
    }
    
    return result;
}

void OCSort::reset() {
    trackers_.clear();
    next_id_ = 0;
    finished_appearances_.clear();
}

OCSort::AppearanceMap OCSort::takeFinishedAppearances() {
    AppearanceMap out;
    out.swap(finished_appearances_);
    return out;
}

OCSort::AppearanceMap OCSort::getActiveAppearances() const {
    AppearanceMap out;
    for (const auto& t : trackers_) {
        if (t->hasAppearance()) {
            out[t->trackId()] = t->appearance();
        }
    }
    return out;
}

void OCSort::associate(const std::vector<Detection>& detections,
                       std::vector<std::pair<int, int>>& matched_indices,
                       std::vector<int>& unmatched_detections,
                       std::vector<int>& unmatched_trackers) {
    matched_indices.clear();
    unmatched_detections.clear();
    unmatched_trackers.clear();
    
    if (trackers_.empty()) {
        // All detections are unmatched
        for (int i = 0; i < static_cast<int>(detections.size()); ++i) {
            unmatched_detections.push_back(i);
        }
        return;
    }
    
    if (detections.empty()) {
        // No detections: all trackers are unmatched
        for (int t = 0; t < static_cast<int>(trackers_.size()); ++t) {
            unmatched_trackers.push_back(t);
        }
        return;
    }
    
    // Get predicted states for all trackers
    std::vector<BBox> predicted_bboxes;
    predicted_bboxes.reserve(trackers_.size());
    for (const auto& tracker : trackers_) {
        predicted_bboxes.push_back(tracker->getState());
    }
    
    // Build IoU matrix and OCM (velocity-direction consistency) augmentation
    int n_dets = static_cast<int>(detections.size());
    int n_trks = static_cast<int>(trackers_.size());

    const int total = n_dets * n_trks;
    std::vector<float> iou_matrix(static_cast<size_t>(total), 0.0f);
    std::vector<float> score_matrix(static_cast<size_t>(total), 0.0f);
    std::vector<bool> row_valid(static_cast<size_t>(n_dets), false);
    std::vector<bool> col_valid(static_cast<size_t>(n_trks), false);

    float max_combined = -std::numeric_limits<float>::infinity();
    std::vector<bool> gate_matrix(static_cast<size_t>(total), false);
    for (int d = 0; d < n_dets; ++d) {
        for (int t = 0; t < n_trks; ++t) {
            const float iou = detections[d].bbox.iou(predicted_bboxes[t]);
            const float dist = center_dist_norm_max_diag(detections[d].bbox, predicted_bboxes[t]);
            const float ar = area_ratio(detections[d].bbox, predicted_bboxes[t]);
            const bool near_gate = iou >= rescue_iou_thresh_ &&
                                   dist <= assoc_max_center_dist_ &&
                                   ar <= assoc_max_area_ratio_;
            const bool strict_iou = iou >= iou_thresh_;
            const bool geometry_ok = strict_iou || near_gate;
            gate_matrix[static_cast<size_t>(d * n_trks + t)] = geometry_ok;
            iou_matrix[static_cast<size_t>(d * n_trks + t)] = iou;
            if (geometry_ok) {
                row_valid[static_cast<size_t>(d)] = true;
                col_valid[static_cast<size_t>(t)] = true;
            }

            const Detection prev_obs = trackers_[t]->kPreviousObservation(delta_t_);
            const bool valid_prev = prev_obs.score >= 0.0f;
            const auto inertia = trackers_[t]->velocityDir();  // (dy, dx)
            const auto dir = speed_direction(prev_obs.bbox, detections[d].bbox);  // (dy, dx)

            float angle_cost = 0.0f;
            if (valid_prev) {
                const float inertia_Y = inertia[0];
                const float inertia_X = inertia[1];
                const float Y = dir[0];
                const float X = dir[1];
                const float cosv = clampf(inertia_X * X + inertia_Y * Y, -1.0f, 1.0f);
                const float angle = std::acos(cosv);
                const float diff = (kPi / 2.0f - std::abs(angle)) / kPi;
                angle_cost = diff * inertia_ * detections[d].score;
            }

            const float combined = iou + angle_cost -
                                   assoc_dist_weight_ * dist -
                                   assoc_area_weight_ * std::max(0.0f, ar - 1.0f);
            float reid_bonus = 0.0f;
            // Geometry-first: only let appearance influence pairs that already overlap.
            // This avoids appearance-only "teleport" matches under shaky camera.
            if (geometry_ok &&
                use_reid_ && detections[d].has_reid && trackers_[t]->hasAppearance()) {
                const float sim = cosine_sim(detections[d].reid, trackers_[t]->appearance());
                if (sim >= reid_cos_thresh_) {
                    const float app_score01 = (sim + 1.0f) * 0.5f;  // [-1,1] -> [0,1]
                    reid_bonus = reid_weight_ * app_score01;
                }
            }

            // Hard-gate invalid geometry in the assignment cost.
            const float total = geometry_ok ? (combined + reid_bonus) : -1e6f;
            score_matrix[static_cast<size_t>(d * n_trks + t)] = total;
            if (geometry_ok) {
                max_combined = std::max(max_combined, total);
            }
        }
    }

    std::vector<int> det_candidates;
    std::vector<int> trk_candidates;
    det_candidates.reserve(static_cast<size_t>(n_dets));
    trk_candidates.reserve(static_cast<size_t>(n_trks));
    for (int d = 0; d < n_dets; ++d) {
        if (row_valid[static_cast<size_t>(d)]) det_candidates.push_back(d);
    }
    for (int t = 0; t < n_trks; ++t) {
        if (col_valid[static_cast<size_t>(t)]) trk_candidates.push_back(t);
    }

    std::vector<int> assignment(static_cast<size_t>(det_candidates.size()), -1);

    // Fast-path: unique 1-1 matching above IoU threshold (when not using ReID).
    if (!use_reid_) {
        if (det_candidates.empty() || trk_candidates.empty()) {
            // no viable pairs
        } else {
        bool use_fast_path = true;
            std::vector<int> row_sum(det_candidates.size(), 0);
            std::vector<int> col_sum(trk_candidates.size(), 0);
            for (size_t di = 0; di < det_candidates.size(); ++di) {
                const int d = det_candidates[di];
                for (size_t ti = 0; ti < trk_candidates.size(); ++ti) {
                    const int t = trk_candidates[ti];
                    if (gate_matrix[static_cast<size_t>(d * n_trks + t)]) {
                        row_sum[di] += 1;
                        col_sum[ti] += 1;
                    }
                }
                if (row_sum[di] > 1) use_fast_path = false;
            }
            for (size_t ti = 0; ti < trk_candidates.size(); ++ti) {
                if (col_sum[ti] > 1) use_fast_path = false;
            }

            if (use_fast_path) {
                for (size_t di = 0; di < det_candidates.size(); ++di) {
                    const int d = det_candidates[di];
                    for (size_t ti = 0; ti < trk_candidates.size(); ++ti) {
                        const int t = trk_candidates[ti];
                        if (gate_matrix[static_cast<size_t>(d * n_trks + t)]) {
                            assignment[di] = static_cast<int>(ti);
                            break;
                        }
                    }
                }
            } else {
                std::vector<std::vector<double>> cost_matrix(det_candidates.size(),
                                                             std::vector<double>(trk_candidates.size(), 0.0));
                const float shift = std::isfinite(max_combined) ? max_combined : 0.0f;
                for (size_t di = 0; di < det_candidates.size(); ++di) {
                    const int d = det_candidates[di];
                    for (size_t ti = 0; ti < trk_candidates.size(); ++ti) {
                        const int t = trk_candidates[ti];
                        cost_matrix[di][ti] = static_cast<double>(shift - score_matrix[static_cast<size_t>(d * n_trks + t)]);
                    }
                }
                hungarian_.solve(cost_matrix, assignment);
            }
        }
    } else {
        if (!(det_candidates.empty() || trk_candidates.empty())) {
            std::vector<std::vector<double>> cost_matrix(det_candidates.size(),
                                                         std::vector<double>(trk_candidates.size(), 0.0));
            const float shift = std::isfinite(max_combined) ? max_combined : 0.0f;
            for (size_t di = 0; di < det_candidates.size(); ++di) {
                const int d = det_candidates[di];
                for (size_t ti = 0; ti < trk_candidates.size(); ++ti) {
                    const int t = trk_candidates[ti];
                    cost_matrix[di][ti] = static_cast<double>(shift - score_matrix[static_cast<size_t>(d * n_trks + t)]);  // minimize
                }
            }
            hungarian_.solve(cost_matrix, assignment);
        }
    }

    std::vector<bool> det_matched(n_dets, false);
    std::vector<bool> trk_matched(n_trks, false);

    for (size_t di = 0; di < det_candidates.size(); ++di) {
        const int t_idx = assignment[di];
        if (t_idx < 0) continue;
        if (t_idx >= static_cast<int>(trk_candidates.size())) continue;
        const int d = det_candidates[di];
        const int t = trk_candidates[static_cast<size_t>(t_idx)];
        const bool gate_ok = gate_matrix[static_cast<size_t>(d * n_trks + t)];
        if (gate_ok) {
            matched_indices.emplace_back(d, t);
            det_matched[d] = true;
            trk_matched[t] = true;
            continue;
        }
    }

    for (int d = 0; d < n_dets; ++d) {
        if (!det_matched[d]) unmatched_detections.push_back(d);
    }
    for (int t = 0; t < n_trks; ++t) {
        if (!trk_matched[t]) unmatched_trackers.push_back(t);
    }
}

void OCSort::associateOCR(const std::vector<Detection>& detections,
                          std::vector<std::pair<int, int>>& matched_indices,
                          std::vector<int>& unmatched_detections,
                          std::vector<int>& unmatched_trackers) {
    matched_indices.clear();
    if (unmatched_detections.empty() || unmatched_trackers.empty()) return;
    if (detections.empty()) return;

    const int n_dets = static_cast<int>(unmatched_detections.size());
    const int n_trks = static_cast<int>(unmatched_trackers.size());
    std::vector<std::vector<double>> cost_matrix(n_dets, std::vector<double>(n_trks, 1.0));
    std::vector<std::vector<float>> iou_matrix(n_dets, std::vector<float>(n_trks, 0.0f));
    std::vector<std::vector<float>> reid_sim_matrix(n_dets, std::vector<float>(n_trks, -1.0f));
    std::vector<std::vector<float>> dist_matrix(n_dets, std::vector<float>(n_trks, 1e6f));
    std::vector<std::vector<float>> area_matrix(n_dets, std::vector<float>(n_trks, 1e6f));
    std::vector<std::vector<bool>> gate_matrix(n_dets, std::vector<bool>(n_trks, false));
    std::vector<std::vector<bool>> reid_valid(n_dets, std::vector<bool>(n_trks, false));

    float max_iou = 0.0f;
    for (int di = 0; di < n_dets; ++di) {
        const int d_idx = unmatched_detections[di];
        for (int ti = 0; ti < n_trks; ++ti) {
            const int t_idx = unmatched_trackers[ti];
            const auto& last = trackers_[t_idx]->lastObservation();
            float iou = 0.0f;
            if (last.has_value() && last->score >= 0.0f) {
                iou = detections[d_idx].bbox.iou(last->bbox);
                dist_matrix[di][ti] =
                    center_dist_norm_max_diag(detections[d_idx].bbox, last->bbox);
                area_matrix[di][ti] = area_ratio(detections[d_idx].bbox, last->bbox);
            }
            iou_matrix[di][ti] = iou;
            max_iou = std::max(max_iou, iou);
            gate_matrix[di][ti] = (iou >= iou_thresh_) ||
                                  (iou >= rescue_iou_thresh_ &&
                                   dist_matrix[di][ti] <= assoc_max_center_dist_ &&
                                   area_matrix[di][ti] <= assoc_max_area_ratio_);

            if (use_reid_ && detections[d_idx].has_reid && trackers_[t_idx]->hasAppearance()) {
                const float sim = cosine_sim(detections[d_idx].reid, trackers_[t_idx]->appearance());
                reid_sim_matrix[di][ti] = sim;
                reid_valid[di][ti] = true;
            }
        }
    }

    if (!use_reid_ && max_iou <= rescue_iou_thresh_) {
        return;
    }

    for (int di = 0; di < n_dets; ++di) {
        for (int ti = 0; ti < n_trks; ++ti) {
            const float iou_cost = 1.0f - iou_matrix[di][ti];
            const float geom_penalty =
                assoc_dist_weight_ * dist_matrix[di][ti] +
                assoc_area_weight_ * std::max(0.0f, area_matrix[di][ti] - 1.0f);
            float app_cost = 1.0f;
            if (use_reid_ && reid_valid[di][ti] && reid_sim_matrix[di][ti] >= reid_cos_thresh_) {
                const float app_score01 = (reid_sim_matrix[di][ti] + 1.0f) * 0.5f;
                app_cost = 1.0f - app_score01;
            }
            // Geometry-first with guarded ReID rescue in near-gate region.
            const float w =
                (use_reid_ && gate_matrix[di][ti] && app_cost < 1.0f) ? reid_weight_ : 0.0f;
            const float cost = (1.0f - w) * (iou_cost + geom_penalty) + w * app_cost;
            cost_matrix[di][ti] = gate_matrix[di][ti] ? static_cast<double>(cost) : 1e6;
        }
    }

    std::vector<int> assignment(n_dets, -1);
    hungarian_.solve(cost_matrix, assignment);

    std::vector<bool> det_used(n_dets, false);
    std::vector<bool> trk_used(n_trks, false);

    for (int di = 0; di < n_dets; ++di) {
        const int ti = assignment[di];
        if (ti < 0) continue;
        if (gate_matrix[di][ti]) {
            det_used[di] = true;
            trk_used[ti] = true;
            matched_indices.emplace_back(unmatched_detections[di], unmatched_trackers[ti]);
            continue;
        }
    }

    // Remove matched entries from unmatched lists
    std::vector<int> new_unmatched_dets;
    new_unmatched_dets.reserve(unmatched_detections.size());
    for (int di = 0; di < n_dets; ++di) {
        if (!det_used[di]) new_unmatched_dets.push_back(unmatched_detections[di]);
    }
    unmatched_detections.swap(new_unmatched_dets);

    std::vector<int> new_unmatched_trks;
    new_unmatched_trks.reserve(unmatched_trackers.size());
    for (int ti = 0; ti < n_trks; ++ti) {
        if (!trk_used[ti]) new_unmatched_trks.push_back(unmatched_trackers[ti]);
    }
    unmatched_trackers.swap(new_unmatched_trks);
}
