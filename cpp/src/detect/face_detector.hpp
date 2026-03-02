#pragma once

#include <vector>

#include "core/config.hpp"
#include "core/types.hpp"
#include "pipeline/frame_types.hpp"
#include "scrfd.hpp"

class FaceDetector {
public:
    explicit FaceDetector(const FaceDetectionConfig& cfg);

    bool IsLoaded() const { return detector_.IsLoaded(); }
    void Detect(const FrameView& frame, std::vector<FaceDetection>& out);

private:
    ScrfdDetector detector_;
};
