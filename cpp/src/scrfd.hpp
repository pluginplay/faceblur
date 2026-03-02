#pragma once

#include <array>
#include <memory>
#include <string>
#include <vector>

#include "infer/ort_headers.hpp"

struct ScrfdFace {
    std::array<float, 4> bbox;
    float score = 0.0f;
    std::array<std::array<float, 2>, 5> landmarks{};
};

class ScrfdDetector {
public:
    ScrfdDetector(const std::string& onnx_path,
                  int input_width = 640,
                  int input_height = 640,
                  float conf_thresh = 0.5f,
                  float nms_thresh = 0.4f,
                  int num_threads = 0);

    bool IsLoaded() const;

    std::vector<ScrfdFace> Detect(const unsigned char* rgb,
                                  int width,
                                  int height) const;

private:
    std::unique_ptr<Ort::Session> session_;
    std::string input_name_;
    std::array<std::string, 3> score_names_{};
    std::array<std::string, 3> bbox_names_{};
    std::array<std::string, 3> kps_names_{};
    int input_width_ = 640;
    int input_height_ = 640;
    float conf_thresh_ = 0.5f;
    float nms_thresh_ = 0.4f;
    bool loaded_ = false;
};
