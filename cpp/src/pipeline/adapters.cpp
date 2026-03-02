#include "pipeline/adapters.hpp"

#include <algorithm>
#include <unordered_set>

DetectorAdapter::DetectorAdapter(const PersonDetectionConfig& cfg) : detector_(cfg) {}

void DetectorAdapter::Detect(const FrameView& frame, std::vector<Detection>& out) {
    detector_.Detect(frame, out);
}

void DetectorAdapter::Detect(const FrameView& frame,
                             std::vector<Detection>& out,
                             PersonDetectTimingMs* timing) {
    detector_.Detect(frame, out, timing);
}

ReidAdapter::ReidAdapter(const BodyReidConfig& cfg) : reid_(cfg) {}

void ReidAdapter::Extract(const FrameView& frame, std::vector<Detection>& in_out) {
    reid_.Extract(frame, in_out);
}

FaceDetectorAdapter::FaceDetectorAdapter(const FaceDetectionConfig& cfg) : detector_(cfg) {}

void FaceDetectorAdapter::Detect(const FrameView& frame, std::vector<FaceDetection>& out) {
    detector_.Detect(frame, out);
}

MotionEstimatorAdapter::MotionEstimatorAdapter(const GmcConfig& cfg) : gmc_(cfg) {}

bool MotionEstimatorAdapter::Estimate(const FrameView& prev, const FrameView& curr, Mat3f& out_warp) {
    if (!prev.isValid() || !curr.isValid()) {
        out_warp = Mat3f::Identity();
        return false;
    }
    return gmc_.Estimate(curr.rgb, curr.width, curr.height,
                         prev.rgb, prev.width, prev.height,
                         out_warp);
}

OcsortTrackerAdapter::OcsortTrackerAdapter(const TrackerConfig& tracker_cfg,
                                           bool use_reid,
                                           const BodyReidConfig& reid_cfg)
    : tracker_(tracker_cfg.iou_thresh,
               tracker_cfg.max_age,
               tracker_cfg.min_hits,
               tracker_cfg.delta_t,
               tracker_cfg.inertia,
               use_reid,
               reid_cfg.weight,
               reid_cfg.cos_thresh,
               tracker_cfg.rescue_iou_thresh,
               tracker_cfg.assoc_max_center_dist,
               tracker_cfg.assoc_max_area_ratio,
               tracker_cfg.assoc_dist_weight,
               tracker_cfg.assoc_area_weight,
               tracker_cfg.max_return_pred_age) {}

void OcsortTrackerAdapter::Update(const std::vector<Detection>& detections,
                                  bool return_all,
                                  const Mat3f* warp_prev_to_curr,
                                  const FrameInfo& frame,
                                  TrackMap& out_tracks) {
    out_tracks = tracker_.update(detections,
                                 return_all,
                                 warp_prev_to_curr,
                                 frame.width,
                                 frame.height);
}

AssociatorAdapter::AssociatorAdapter(const AssociationConfig& cfg) : associator_(cfg) {}

std::vector<FacePersonMatch> AssociatorAdapter::Associate(const std::vector<FaceDetection>& faces,
                                                          const std::vector<PersonTrackState>& people,
                                                          int frame_index,
                                                          std::vector<FacePersonCandidate>* candidates) {
    return associator_.Associate(faces, people, frame_index, candidates);
}

LinkerAdapter::LinkerAdapter(const LinkingConfig& cfg, const OutputConfig& out_cfg)
    : linker_(cfg, out_cfg) {}

std::unordered_map<int, std::vector<TrackFrame>> LinkerAdapter::Link(
    std::unordered_map<int, std::vector<TrackFrame>> track_data,
    const std::unordered_map<int, Appearance>& appearances,
    float video_fps,
    float conf_thresh,
    float base_sim_thresh) const {
    return linker_.Link(std::move(track_data), appearances, video_fps, conf_thresh, base_sim_thresh);
}

PostProcessor::PostProcessor(const OutputConfig& cfg) : cfg_(cfg) {}

namespace {
void FillShortFaceGaps(std::vector<FaceKeyframe>& frames,
                       const std::unordered_set<int>& person_frame_set) {
    if (frames.size() < 2) return;
    std::vector<FaceKeyframe> out;
    out.reserve(frames.size() + 8);
    for (size_t i = 0; i + 1 < frames.size(); ++i) {
        const auto& a = frames[i];
        const auto& b = frames[i + 1];
        out.push_back(a);
        const int gap = b.frame_index - a.frame_index;
        if (gap <= 1 || gap > 3) continue;  // fill up to 2 missing frames.
        for (int step = 1; step < gap; ++step) {
            const int frame_idx = a.frame_index + step;
            if (person_frame_set.find(frame_idx) == person_frame_set.end()) continue;
            const float t = static_cast<float>(step) / static_cast<float>(gap);
            FaceKeyframe k;
            k.frame_index = frame_idx;
            k.bbox.x1 = a.bbox.x1 + (b.bbox.x1 - a.bbox.x1) * t;
            k.bbox.y1 = a.bbox.y1 + (b.bbox.y1 - a.bbox.y1) * t;
            k.bbox.x2 = a.bbox.x2 + (b.bbox.x2 - a.bbox.x2) * t;
            k.bbox.y2 = a.bbox.y2 + (b.bbox.y2 - a.bbox.y2) * t;
            k.confidence = std::min(a.confidence, b.confidence) * 0.9f;
            k.assoc_iou = std::min(a.assoc_iou, b.assoc_iou);
            out.push_back(k);
        }
    }
    out.push_back(frames.back());
    std::sort(out.begin(), out.end(),
              [](const FaceKeyframe& lhs, const FaceKeyframe& rhs) {
                  return lhs.frame_index < rhs.frame_index;
              });
    frames.swap(out);
}
}  // namespace

PipelineResult PostProcessor::Finalize(
    std::unordered_map<int, std::vector<TrackFrame>> person_track_data,
    std::unordered_map<int, std::vector<FaceKeyframe>> face_track_data,
    const std::vector<std::pair<int, int>>& frame_sizes,
    float conf_thresh) const {
    PipelineResult result;

    std::unordered_map<int, bool> keep_person;
    result.people.reserve(person_track_data.size());
    for (auto& kv : person_track_data) {
        const int id = kv.first;
        auto& frames = kv.second;
        if (static_cast<int>(frames.size()) < cfg_.min_track_frames) continue;

        int ge = 0;
        for (const auto& f : frames) {
            if (f.confidence >= conf_thresh) ge++;
        }
        const float frac_ge = frames.empty() ? 0.0f
                                             : static_cast<float>(ge) / static_cast<float>(frames.size());
        if (ge < cfg_.min_conf_frames || frac_ge < cfg_.min_conf_frac) continue;

        PersonTrack track;
        track.id = id;
        track.frames = std::move(frames);
        result.people.push_back(std::move(track));
        keep_person[id] = true;
    }

    if (cfg_.normalize_output) {
        for (auto& track : result.people) {
            for (auto& f : track.frames) {
                if (f.frame_index < 0 || f.frame_index >= static_cast<int>(frame_sizes.size())) continue;
                const auto dims = frame_sizes[static_cast<size_t>(f.frame_index)];
                const int w = dims.first;
                const int h = dims.second;
                if (w <= 0 || h <= 0) continue;
                f.bbox.x1 /= static_cast<float>(w);
                f.bbox.y1 /= static_cast<float>(h);
                f.bbox.x2 /= static_cast<float>(w);
                f.bbox.y2 /= static_cast<float>(h);
            }
        }
    }

    std::sort(result.people.begin(), result.people.end(),
              [](const PersonTrack& a, const PersonTrack& b) { return a.id < b.id; });

    std::unordered_map<int, std::unordered_set<int>> person_frames_by_id;
    person_frames_by_id.reserve(result.people.size());
    for (const auto& p : result.people) {
        auto& set = person_frames_by_id[p.id];
        for (const auto& f : p.frames) {
            set.insert(f.frame_index);
        }
    }

    result.face_tracks.reserve(face_track_data.size());
    for (auto& kv : face_track_data) {
        const int person_id = kv.first;
        if (!keep_person[person_id]) continue;
        auto& frames = kv.second;
        if (frames.empty()) continue;
        std::sort(frames.begin(), frames.end(),
                  [](const FaceKeyframe& a, const FaceKeyframe& b) {
                      return a.frame_index < b.frame_index;
                  });
        const auto person_it = person_frames_by_id.find(person_id);
        if (person_it != person_frames_by_id.end()) {
            FillShortFaceGaps(frames, person_it->second);
        }
        FaceTrack t;
        t.person_id = person_id;
        t.frames = std::move(frames);
        result.face_tracks.push_back(std::move(t));
    }

    if (cfg_.normalize_output) {
        for (auto& track : result.face_tracks) {
            for (auto& f : track.frames) {
                if (f.frame_index < 0 || f.frame_index >= static_cast<int>(frame_sizes.size())) continue;
                const auto dims = frame_sizes[static_cast<size_t>(f.frame_index)];
                const int w = dims.first;
                const int h = dims.second;
                if (w <= 0 || h <= 0) continue;
                f.bbox.x1 /= static_cast<float>(w);
                f.bbox.y1 /= static_cast<float>(h);
                f.bbox.x2 /= static_cast<float>(w);
                f.bbox.y2 /= static_cast<float>(h);
            }
        }
    }

    std::sort(result.face_tracks.begin(), result.face_tracks.end(),
              [](const FaceTrack& a, const FaceTrack& b) { return a.person_id < b.person_id; });

    return result;
}
