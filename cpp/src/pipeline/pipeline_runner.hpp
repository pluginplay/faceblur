#pragma once

#include <unordered_map>
#include <vector>

#include "core/config.hpp"
#include "core/types.hpp"
#include "io/frame_source.hpp"
#include "pipeline/adapters.hpp"
#include "pipeline/frame_pool.hpp"
#include "pipeline/frame_scheduler.hpp"

class PipelineRunner {
public:
    explicit PipelineRunner(const PipelineConfig& cfg);

    bool IsLoaded() const { return detector_.IsLoaded() && face_detector_.IsLoaded(); }

    PipelineResult Run(IFrameSource& source, float video_fps = 30.0f);

private:
    PipelineConfig cfg_{};

    DetectorAdapter detector_;
    FaceDetectorAdapter face_detector_;
    ReidAdapter reid_;
    AssociatorAdapter associator_;
    MotionEstimatorAdapter gmc_;
    OcsortTrackerAdapter tracker_;
    LinkerAdapter linker_;
    PostProcessor post_;
};
