#pragma once

#include <array>
#include <string>
#include <vector>

#include "net.h"

struct ScrfdFace {
  std::array<float, 4> bbox;
  float score = 0.0f;
  std::array<std::array<float, 2>, 5> landmarks{};
};

class ScrfdDetector {
public:
  ScrfdDetector(const std::string& param_path,
                const std::string& bin_path,
                int input_width = 640,
                int input_height = 640,
                float conf_thresh = 0.5f,
                float nms_thresh = 0.4f);

  bool IsLoaded() const;

  std::vector<ScrfdFace> Detect(const unsigned char* rgb,
                                int width,
                                int height) const;

private:
  ncnn::Net net_;
  int input_width_ = 640;
  int input_height_ = 640;
  float conf_thresh_ = 0.5f;
  float nms_thresh_ = 0.4f;
  bool loaded_ = false;
};
