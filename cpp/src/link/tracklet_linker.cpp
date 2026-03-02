#include "link/tracklet_linker.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

#include "core/union_find.hpp"

namespace {
inline float clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

inline float cosine_sim(const Appearance& a, const Appearance& b) {
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

inline float median_of(std::vector<float>& vals) {
    if (vals.empty()) return 0.0f;
    std::sort(vals.begin(), vals.end());
    const size_t mid = vals.size() / 2;
    if (vals.size() % 2 == 1) {
        return vals[mid];
    }
    return 0.5f * (vals[mid - 1] + vals[mid]);
}
}  // namespace

TrackletLinker::TrackletLinker(const LinkingConfig& cfg, const OutputConfig& out_cfg)
    : cfg_(cfg), out_cfg_(out_cfg) {}

std::unordered_map<int, std::vector<TrackFrame>> TrackletLinker::Link(
    std::unordered_map<int, std::vector<TrackFrame>> track_data,
    const std::unordered_map<int, Appearance>& appearances,
    float video_fps,
    float conf_thresh,
    float base_sim_thresh) const {
    if (!cfg_.enabled) return track_data;
    if (appearances.empty() || track_data.size() < 2) return track_data;

    struct TrackletSummary {
        int id = -1;
        int start_frame = 0;
        int end_frame = 0;
        BBox start_bbox{};
        BBox end_bbox{};
        float median_area = 0.0f;
        int frame_count = 0;
        int conf_ge_thresh = 0;
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

        const float span_conf = std::max(out_cfg_.span_conf_floor,
                                         conf_thresh * out_cfg_.span_conf_scale);
        int first = 0;
        int last = static_cast<int>(frames.size()) - 1;
        while (first < static_cast<int>(frames.size()) && frames[first].confidence < span_conf) {
            first++;
        }
        while (last >= 0 && frames[last].confidence < span_conf) {
            last--;
        }
        if (first >= static_cast<int>(frames.size()) || last < 0 || last < first) {
            first = 0;
            last = static_cast<int>(frames.size()) - 1;
        }
        s.start_frame = frames[first].frame_index;
        s.end_frame = frames[last].frame_index;
        s.start_bbox = frames[first].bbox;
        s.end_bbox = frames[last].bbox;

        std::vector<float> areas;
        areas.reserve(frames.size());
        for (const auto& f : frames) {
            if (f.confidence >= span_conf) {
                areas.push_back(std::max(1e-6f, f.bbox.area()));
            }
        }
        if (areas.empty()) {
            for (const auto& f : frames) {
                areas.push_back(std::max(1e-6f, f.bbox.area()));
            }
        }
        s.median_area = median_of(areas);

        int ge = 0;
        for (const auto& f : frames) {
            if (f.confidence >= conf_thresh) ge++;
        }
        s.conf_ge_thresh = ge;
        tracklets.push_back(s);
    }

    UnionFind uf;
    for (const auto& s : tracklets) uf.add(s.id);

    const int link_max_gap_short = std::max(1, static_cast<int>(std::round(video_fps * cfg_.short_gap_sec)));
    const int link_max_gap_long = std::max(link_max_gap_short,
                                           static_cast<int>(std::round(video_fps * cfg_.long_gap_sec)));

    const int n = static_cast<int>(tracklets.size());
    std::vector<int> best_to(n, -1);
    std::vector<float> best_to_sim(n, -1.0f);
    std::vector<float> best_to_dist(n, 1e9f);

    std::vector<int> best_from(n, -1);
    std::vector<float> best_from_sim(n, -1.0f);
    std::vector<float> best_from_dist(n, 1e9f);

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
            if (!(dist <= cfg_.max_center_dist)) continue;

            const float aA = (A.median_area > 0.0f) ? A.median_area : std::max(1e-6f, A.end_bbox.area());
            const float aB = (B.median_area > 0.0f) ? B.median_area : std::max(1e-6f, B.start_bbox.area());
            float ar = aB / aA;
            if (ar < 1.0f) ar = 1.0f / std::max(1e-6f, ar);
            if (!(ar <= cfg_.max_area_ratio)) continue;

            const float sim = cosine_sim(itA->second, itB->second);
            const bool long_gap = (gap > link_max_gap_short);
            float sim_thresh = base_sim_thresh;
            if (long_gap) {
                if (A.conf_ge_thresh < cfg_.long_gap_min_conf_frames ||
                    B.conf_ge_thresh < cfg_.long_gap_min_conf_frames) {
                    continue;
                }
                sim_thresh = std::max(cfg_.long_gap_min_sim, sim_thresh);
            }
            if (!(sim >= sim_thresh)) continue;

            if (sim > best_to_sim[i] || (sim == best_to_sim[i] && dist < best_to_dist[i])) {
                best_to[i] = j;
                best_to_sim[i] = sim;
                best_to_dist[i] = dist;
            }
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
        if (best_from[j] != i) continue;
        const int idA = tracklets[i].id;
        const int idB = tracklets[j].id;
        if (uf.find(idA) == uf.find(idB)) continue;
        uf.unite(idA, idB);
    }

    std::unordered_map<int, std::vector<TrackFrame>> merged_data;
    for (auto& kv : track_data) {
        const int root = uf.find(kv.first);
        auto& out = merged_data[root];
        auto& frames = kv.second;
        out.insert(out.end(), frames.begin(), frames.end());
    }

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

    return merged_data;
}
