#pragma once

#include <array>
#include <cstdint>
#include <vector>

namespace infer {

struct LetterboxInfo {
    float scale = 1.0f;
    int resized_width = 0;
    int resized_height = 0;
};

void ResizeRgbBilinear(const uint8_t* src,
                       int src_width,
                       int src_height,
                       int dst_width,
                       int dst_height,
                       std::vector<float>& dst_hwc);

void ResizeRgbRoiBilinear(const uint8_t* src,
                          int src_width,
                          int src_height,
                          int roi_x,
                          int roi_y,
                          int roi_width,
                          int roi_height,
                          int dst_width,
                          int dst_height,
                          std::vector<float>& dst_hwc);

LetterboxInfo LetterboxResizeRgb(const uint8_t* src,
                                 int src_width,
                                 int src_height,
                                 int dst_width,
                                 int dst_height,
                                 std::vector<float>& dst_hwc,
                                 float pad_value = 0.0f);

void NormalizeByMeanStdInplace(std::vector<float>& hwc,
                               const std::array<float, 3>& mean,
                               const std::array<float, 3>& std);

void NormalizeImageNetInplace(std::vector<float>& hwc);

void HwcToChw(const std::vector<float>& src_hwc,
              int width,
              int height,
              std::vector<float>& dst_chw);

}  // namespace infer
