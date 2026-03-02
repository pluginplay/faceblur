#include "pipeline.hpp"

FacePipeline::FacePipeline(const PipelineConfig& cfg)
    : cfg_(cfg), runner_(cfg_) {}

PipelineResult FacePipeline::process(const std::vector<std::string>& image_paths,
                                     float video_fps) {
    ImageSequenceSource source(image_paths);
    return run(source, video_fps);
}

PipelineResult FacePipeline::run(IFrameSource& source, float video_fps) {
    return runner_.Run(source, video_fps);
}
