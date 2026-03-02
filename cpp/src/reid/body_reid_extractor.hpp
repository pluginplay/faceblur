#pragma once

#include <array>
#include <memory>
#include <string>
#include <vector>

#include "infer/ort_headers.hpp"

#include "core/config.hpp"
#include "core/types.hpp"
#include "pipeline/frame_types.hpp"

class BodyReidExtractor {
public:
    explicit BodyReidExtractor(const BodyReidConfig& cfg);

    bool IsEnabled() const { return enabled_ && loaded_; }
    void Extract(const FrameView& frame, std::vector<Detection>& detections) const;

private:
    bool extractOne(const FrameView& frame,
                    const BBox& bbox,
                    std::array<float, Detection::kReidDim>& out_vec) const;

    BodyReidConfig cfg_{};
    std::unique_ptr<Ort::Session> session_;
    std::string input_name_;
    std::string output_name_;
    bool enabled_ = false;
    bool loaded_ = false;
};
