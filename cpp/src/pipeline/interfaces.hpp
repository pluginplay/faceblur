#pragma once

#include <unordered_map>
#include <vector>

#include "associate/face_person_associator.hpp"
#include "core/types.hpp"
#include "ocsort.hpp"
#include "pipeline/frame_types.hpp"
#include "transform.hpp"

class IDetector {
public:
    virtual ~IDetector() = default;
    virtual bool IsLoaded() const = 0;
    virtual void Detect(const FrameView& frame, std::vector<Detection>& out) = 0;
};

class IReidExtractor {
public:
    virtual ~IReidExtractor() = default;
    virtual bool IsEnabled() const = 0;
    virtual void Extract(const FrameView& frame, std::vector<Detection>& in_out) = 0;
};

class IFaceDetector {
public:
    virtual ~IFaceDetector() = default;
    virtual bool IsLoaded() const = 0;
    virtual void Detect(const FrameView& frame, std::vector<FaceDetection>& out) = 0;
};

class IMotionEstimator {
public:
    virtual ~IMotionEstimator() = default;
    virtual bool Estimate(const FrameView& prev, const FrameView& curr, Mat3f& out_warp) = 0;
};

class ITracker {
public:
    using TrackMap = std::unordered_map<int, TrackResult>;
    using AppearanceMap = std::unordered_map<int, Appearance>;

    virtual ~ITracker() = default;
    virtual void Update(const std::vector<Detection>& detections,
                        bool return_all,
                        const Mat3f* warp_prev_to_curr,
                        const FrameInfo& frame,
                        TrackMap& out_tracks) = 0;
    virtual AppearanceMap TakeFinishedAppearances() = 0;
    virtual AppearanceMap GetActiveAppearances() const = 0;
};

class IAssociator {
public:
    virtual ~IAssociator() = default;
    virtual std::vector<FacePersonMatch> Associate(const std::vector<FaceDetection>& faces,
                                                   const std::vector<PersonTrackState>& people,
                                                   int frame_index,
                                                   std::vector<FacePersonCandidate>* candidates = nullptr) = 0;
};

class ILinker {
public:
    virtual ~ILinker() = default;
    virtual std::unordered_map<int, std::vector<TrackFrame>> Link(
        std::unordered_map<int, std::vector<TrackFrame>> track_data,
        const std::unordered_map<int, Appearance>& appearances,
        float video_fps,
        float conf_thresh,
        float base_sim_thresh) const = 0;
};

class IPostProcessor {
public:
    virtual ~IPostProcessor() = default;
    virtual PipelineResult Finalize(
        std::unordered_map<int, std::vector<TrackFrame>> person_track_data,
        std::unordered_map<int, std::vector<FaceKeyframe>> face_track_data,
        const std::vector<std::pair<int, int>>& frame_sizes,
        float conf_thresh) const = 0;
};
