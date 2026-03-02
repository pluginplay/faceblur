#include "associate/face_person_associator.hpp"

#include <algorithm>

namespace {

constexpr double kInvalidCost = 1.0;
constexpr float kOverlapWeight = 0.85f;
constexpr float kIouWeight = 0.15f;

float IntersectionArea(const BBox& a, const BBox& b) {
    const float ix1 = (a.x1 > b.x1) ? a.x1 : b.x1;
    const float iy1 = (a.y1 > b.y1) ? a.y1 : b.y1;
    const float ix2 = (a.x2 < b.x2) ? a.x2 : b.x2;
    const float iy2 = (a.y2 < b.y2) ? a.y2 : b.y2;
    if (ix2 <= ix1 || iy2 <= iy1) return 0.0f;
    return (ix2 - ix1) * (iy2 - iy1);
}

bool PointInBox(float x, float y, const BBox& b) {
    return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
}

}  // namespace

std::vector<FacePersonMatch> FacePersonAssociator::Associate(
    const std::vector<FaceDetection>& faces,
    const std::vector<PersonTrackState>& people,
    int frame_index,
    std::vector<FacePersonCandidate>* candidates) const {
    std::vector<FacePersonMatch> matches;
    if (faces.empty() || people.empty()) return matches;
    if (candidates) candidates->clear();
    pruneMemory(frame_index);

    const int n_faces = static_cast<int>(faces.size());
    const int n_people = static_cast<int>(people.size());
    std::vector<std::vector<double>> cost_matrix(static_cast<size_t>(n_faces),
                                                 std::vector<double>(static_cast<size_t>(n_people),
                                                                     kInvalidCost));
    struct PairMetrics {
        float iou = 0.0f;
        float face_overlap = 0.0f;
        bool center_inside = false;
        bool gate_pass = false;
        float score = 0.0f;
    };
    std::vector<std::vector<PairMetrics>> metric_matrix(
        static_cast<size_t>(n_faces),
        std::vector<PairMetrics>(static_cast<size_t>(n_people)));

    for (int fi = 0; fi < n_faces; ++fi) {
        const BBox& face_box = faces[static_cast<size_t>(fi)].bbox;
        const float face_area = std::max(0.0f, face_box.area());
        const float face_cx = face_box.centerX();
        const float face_cy = face_box.centerY();
        for (int pi = 0; pi < n_people; ++pi) {
            const BBox& person_box = people[static_cast<size_t>(pi)].bbox;
            const float iou = face_box.iou(person_box);
            const float intersection = IntersectionArea(face_box, person_box);
            const float face_overlap =
                (face_area > 0.0f) ? std::clamp(intersection / face_area, 0.0f, 1.0f) : 0.0f;
            const bool center_inside = PointInBox(face_cx, face_cy, person_box);
            const bool center_ok = !cfg_.require_face_center_in_person || center_inside;
            const bool gate_pass = (iou >= cfg_.face_person_iou_thresh) ||
                                   (center_ok && face_overlap >= cfg_.face_person_overlap_thresh) ||
                                   (iou >= cfg_.track_iou_gate && center_ok);
            float score = 0.0f;
            if (gate_pass) {
                score = (kOverlapWeight * face_overlap + kIouWeight * iou);
                score += temporalPrior(face_box, people[static_cast<size_t>(pi)].person_id, frame_index);
                score -= switchPenalty(face_box, people[static_cast<size_t>(pi)].person_id, frame_index);
                score = std::clamp(score, 0.0f, 1.0f);
            }

            PairMetrics metrics;
            metrics.iou = iou;
            metrics.face_overlap = face_overlap;
            metrics.center_inside = center_inside;
            metrics.gate_pass = gate_pass;
            metrics.score = score;
            metric_matrix[static_cast<size_t>(fi)][static_cast<size_t>(pi)] = metrics;

            if (gate_pass) {
                cost_matrix[static_cast<size_t>(fi)][static_cast<size_t>(pi)] =
                    static_cast<double>(1.0f - score);
            }

            if (candidates) {
                FacePersonCandidate c;
                c.face_index = fi;
                c.person_id = people[static_cast<size_t>(pi)].person_id;
                c.iou = iou;
                c.face_overlap = face_overlap;
                c.center_inside = center_inside;
                c.gate_pass = gate_pass;
                c.score = score;
                candidates->push_back(c);
            }
        }
    }

    std::vector<int> assignment(static_cast<size_t>(n_faces), -1);
    hungarian_.solve(cost_matrix, assignment);

    for (int fi = 0; fi < n_faces; ++fi) {
        const int pi = assignment[static_cast<size_t>(fi)];
        if (pi < 0 || pi >= n_people) continue;
        const PairMetrics& metrics = metric_matrix[static_cast<size_t>(fi)][static_cast<size_t>(pi)];
        if (!metrics.gate_pass) continue;
        FacePersonMatch m;
        m.person_id = people[static_cast<size_t>(pi)].person_id;
        m.face_index = fi;
        m.iou = metrics.iou;
        m.face_overlap = metrics.face_overlap;
        m.center_inside = metrics.center_inside;
        m.score = metrics.score;
        matches.push_back(m);
        FaceMemory mem;
        mem.bbox = faces[static_cast<size_t>(fi)].bbox;
        mem.frame_index = frame_index;
        memory_by_person_[m.person_id] = mem;
    }
    return matches;
}

void FacePersonAssociator::pruneMemory(int frame_index) const {
    const int keep_frames = std::max(1, cfg_.temporal_memory_frames);
    for (auto it = memory_by_person_.begin(); it != memory_by_person_.end();) {
        if (frame_index - it->second.frame_index > keep_frames) {
            it = memory_by_person_.erase(it);
        } else {
            ++it;
        }
    }
}

float FacePersonAssociator::temporalPrior(const BBox& face_box,
                                          int person_id,
                                          int frame_index) const {
    const auto it = memory_by_person_.find(person_id);
    if (it == memory_by_person_.end()) return 0.0f;
    const int age = frame_index - it->second.frame_index;
    if (age < 0 || age > cfg_.temporal_memory_frames) return 0.0f;
    const float iou = face_box.iou(it->second.bbox);
    const float decay = 1.0f - (static_cast<float>(age) /
                                static_cast<float>(std::max(1, cfg_.temporal_memory_frames)));
    return cfg_.temporal_bonus * std::clamp(iou, 0.0f, 1.0f) * std::clamp(decay, 0.0f, 1.0f);
}

float FacePersonAssociator::switchPenalty(const BBox& face_box,
                                          int candidate_person_id,
                                          int frame_index) const {
    int best_owner = -1;
    float best_iou = 0.0f;
    for (const auto& kv : memory_by_person_) {
        const int age = frame_index - kv.second.frame_index;
        if (age < 0 || age > cfg_.temporal_memory_frames) continue;
        const float iou = face_box.iou(kv.second.bbox);
        if (iou > best_iou) {
            best_iou = iou;
            best_owner = kv.first;
        }
    }
    if (best_owner < 0 || best_owner == candidate_person_id) return 0.0f;
    if (best_iou < cfg_.switch_margin) return 0.0f;
    return cfg_.switch_penalty * best_iou;
}
