#pragma once

#include <string>
#include <vector>

#include "core/config.hpp"
#include "core/types.hpp"
#include "io/frame_source.hpp"
#include "pipeline/pipeline_runner.hpp"

class FacePipeline {
public:
    explicit FacePipeline(const PipelineConfig& cfg);

    bool isLoaded() const { return runner_.IsLoaded(); }

    PipelineResult process(const std::vector<std::string>& image_paths,
                           float video_fps = 30.0f);

private:
    PipelineResult run(IFrameSource& source, float video_fps);

    PipelineConfig cfg_{};
    PipelineRunner runner_;
};
