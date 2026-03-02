#pragma once

#include <memory>
#include <string>
#include <vector>

#include "infer/ort_headers.hpp"

#include "core/config.hpp"
#include "core/types.hpp"
#include "pipeline/frame_types.hpp"

struct PersonDetectTimingMs {
    double preprocess = 0.0;
    double infer = 0.0;
    double decode = 0.0;
};

class PersonDetector {
public:
    explicit PersonDetector(const PersonDetectionConfig& cfg);

    bool IsLoaded() const { return loaded_; }
    void Detect(const FrameView& frame,
                std::vector<Detection>& out,
                PersonDetectTimingMs* timing = nullptr) const;

private:
    bool decodeRfDetr(const float* boxes,
                      const std::vector<int64_t>& box_shape,
                      const float* logits,
                      const std::vector<int64_t>& logit_shape,
                      int frame_w,
                      int frame_h,
                      std::vector<Detection>& out) const;

    PersonDetectionConfig cfg_{};
    std::unique_ptr<Ort::Session> session_;
    std::string input_name_;
    std::string boxes_name_;
    std::string logits_name_;
    bool loaded_ = false;
};
