#pragma once

#include "associate/face_person_associator.hpp"
#include "core/config.hpp"
#include "detect/face_detector.hpp"
#include "detect/person_detector.hpp"
#include "gmc.hpp"
#include "link/tracklet_linker.hpp"
#include "ocsort.hpp"
#include "pipeline/interfaces.hpp"
#include "reid/body_reid_extractor.hpp"

class DetectorAdapter : public IDetector {
public:
    explicit DetectorAdapter(const PersonDetectionConfig& cfg);

    bool IsLoaded() const override { return detector_.IsLoaded(); }
    void Detect(const FrameView& frame, std::vector<Detection>& out) override;
    void Detect(const FrameView& frame,
                std::vector<Detection>& out,
                PersonDetectTimingMs* timing);

private:
    PersonDetector detector_;
};

class ReidAdapter : public IReidExtractor {
public:
    explicit ReidAdapter(const BodyReidConfig& cfg);

    bool IsEnabled() const override { return reid_.IsEnabled(); }
    void Extract(const FrameView& frame, std::vector<Detection>& in_out) override;

private:
    BodyReidExtractor reid_;
};

class FaceDetectorAdapter : public IFaceDetector {
public:
    explicit FaceDetectorAdapter(const FaceDetectionConfig& cfg);

    bool IsLoaded() const override { return detector_.IsLoaded(); }
    void Detect(const FrameView& frame, std::vector<FaceDetection>& out) override;

private:
    FaceDetector detector_;
};

class MotionEstimatorAdapter : public IMotionEstimator {
public:
    explicit MotionEstimatorAdapter(const GmcConfig& cfg);

    bool Estimate(const FrameView& prev, const FrameView& curr, Mat3f& out_warp) override;

private:
    GmcEstimator gmc_;
};

class OcsortTrackerAdapter : public ITracker {
public:
    OcsortTrackerAdapter(const TrackerConfig& tracker_cfg,
                         bool use_reid,
                         const BodyReidConfig& reid_cfg);

    void Update(const std::vector<Detection>& detections,
                bool return_all,
                const Mat3f* warp_prev_to_curr,
                const FrameInfo& frame,
                TrackMap& out_tracks) override;

    AppearanceMap TakeFinishedAppearances() override { return tracker_.takeFinishedAppearances(); }
    AppearanceMap GetActiveAppearances() const override { return tracker_.getActiveAppearances(); }

private:
    OCSort tracker_;
};

class AssociatorAdapter : public IAssociator {
public:
    explicit AssociatorAdapter(const AssociationConfig& cfg);

    std::vector<FacePersonMatch> Associate(const std::vector<FaceDetection>& faces,
                                           const std::vector<PersonTrackState>& people,
                                           int frame_index,
                                           std::vector<FacePersonCandidate>* candidates = nullptr) override;

private:
    FacePersonAssociator associator_;
};

class LinkerAdapter : public ILinker {
public:
    explicit LinkerAdapter(const LinkingConfig& cfg, const OutputConfig& out_cfg);

    std::unordered_map<int, std::vector<TrackFrame>> Link(
        std::unordered_map<int, std::vector<TrackFrame>> track_data,
        const std::unordered_map<int, Appearance>& appearances,
        float video_fps,
        float conf_thresh,
        float base_sim_thresh) const override;

private:
    TrackletLinker linker_;
};

class PostProcessor : public IPostProcessor {
public:
    explicit PostProcessor(const OutputConfig& cfg);

    PipelineResult Finalize(
        std::unordered_map<int, std::vector<TrackFrame>> person_track_data,
        std::unordered_map<int, std::vector<FaceKeyframe>> face_track_data,
        const std::vector<std::pair<int, int>>& frame_sizes,
        float conf_thresh) const override;

private:
    OutputConfig cfg_{};
};
