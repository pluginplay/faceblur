#include "infer/image_ops.hpp"

#include <algorithm>
#include <cmath>

namespace infer {
namespace {

inline float Clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

inline int Clampi(int v, int lo, int hi) {
    return std::max(lo, std::min(hi, v));
}

inline void SampleBilinear(const uint8_t* src,
                           int src_width,
                           int src_height,
                           float x,
                           float y,
                           float out_rgb[3]) {
    x = Clampf(x, 0.0f, static_cast<float>(src_width - 1));
    y = Clampf(y, 0.0f, static_cast<float>(src_height - 1));

    const int x0 = static_cast<int>(std::floor(x));
    const int y0 = static_cast<int>(std::floor(y));
    const int x1 = std::min(x0 + 1, src_width - 1);
    const int y1 = std::min(y0 + 1, src_height - 1);

    const float dx = x - static_cast<float>(x0);
    const float dy = y - static_cast<float>(y0);

    const int idx00 = (y0 * src_width + x0) * 3;
    const int idx10 = (y0 * src_width + x1) * 3;
    const int idx01 = (y1 * src_width + x0) * 3;
    const int idx11 = (y1 * src_width + x1) * 3;

    for (int c = 0; c < 3; ++c) {
        const float v00 = static_cast<float>(src[idx00 + c]);
        const float v10 = static_cast<float>(src[idx10 + c]);
        const float v01 = static_cast<float>(src[idx01 + c]);
        const float v11 = static_cast<float>(src[idx11 + c]);
        const float v0 = v00 + (v10 - v00) * dx;
        const float v1 = v01 + (v11 - v01) * dx;
        out_rgb[c] = v0 + (v1 - v0) * dy;
    }
}

}  // namespace

void ResizeRgbBilinear(const uint8_t* src,
                       int src_width,
                       int src_height,
                       int dst_width,
                       int dst_height,
                       std::vector<float>& dst_hwc) {
    dst_hwc.assign(static_cast<size_t>(dst_width * dst_height * 3), 0.0f);
    if (!src || src_width <= 0 || src_height <= 0 || dst_width <= 0 || dst_height <= 0) return;

    const float scale_x = static_cast<float>(src_width) / static_cast<float>(dst_width);
    const float scale_y = static_cast<float>(src_height) / static_cast<float>(dst_height);

    for (int y = 0; y < dst_height; ++y) {
        const float src_y = (static_cast<float>(y) + 0.5f) * scale_y - 0.5f;
        for (int x = 0; x < dst_width; ++x) {
            const float src_x = (static_cast<float>(x) + 0.5f) * scale_x - 0.5f;
            float px[3]{};
            SampleBilinear(src, src_width, src_height, src_x, src_y, px);
            const size_t idx = static_cast<size_t>((y * dst_width + x) * 3);
            dst_hwc[idx + 0] = px[0];
            dst_hwc[idx + 1] = px[1];
            dst_hwc[idx + 2] = px[2];
        }
    }
}

void ResizeRgbRoiBilinear(const uint8_t* src,
                          int src_width,
                          int src_height,
                          int roi_x,
                          int roi_y,
                          int roi_width,
                          int roi_height,
                          int dst_width,
                          int dst_height,
                          std::vector<float>& dst_hwc) {
    dst_hwc.assign(static_cast<size_t>(dst_width * dst_height * 3), 0.0f);
    if (!src || src_width <= 0 || src_height <= 0 || dst_width <= 0 || dst_height <= 0) return;

    roi_x = Clampi(roi_x, 0, src_width - 1);
    roi_y = Clampi(roi_y, 0, src_height - 1);
    roi_width = std::max(1, std::min(roi_width, src_width - roi_x));
    roi_height = std::max(1, std::min(roi_height, src_height - roi_y));

    const float scale_x = static_cast<float>(roi_width) / static_cast<float>(dst_width);
    const float scale_y = static_cast<float>(roi_height) / static_cast<float>(dst_height);

    for (int y = 0; y < dst_height; ++y) {
        const float src_y = static_cast<float>(roi_y) + (static_cast<float>(y) + 0.5f) * scale_y - 0.5f;
        for (int x = 0; x < dst_width; ++x) {
            const float src_x = static_cast<float>(roi_x) + (static_cast<float>(x) + 0.5f) * scale_x - 0.5f;
            float px[3]{};
            SampleBilinear(src, src_width, src_height, src_x, src_y, px);
            const size_t idx = static_cast<size_t>((y * dst_width + x) * 3);
            dst_hwc[idx + 0] = px[0];
            dst_hwc[idx + 1] = px[1];
            dst_hwc[idx + 2] = px[2];
        }
    }
}

LetterboxInfo LetterboxResizeRgb(const uint8_t* src,
                                 int src_width,
                                 int src_height,
                                 int dst_width,
                                 int dst_height,
                                 std::vector<float>& dst_hwc,
                                 float pad_value) {
    LetterboxInfo info{};
    dst_hwc.assign(static_cast<size_t>(dst_width * dst_height * 3), pad_value);
    if (!src || src_width <= 0 || src_height <= 0 || dst_width <= 0 || dst_height <= 0) return info;

    info.scale = std::min(static_cast<float>(dst_width) / static_cast<float>(src_width),
                          static_cast<float>(dst_height) / static_cast<float>(src_height));
    info.resized_width = std::max(1, static_cast<int>(src_width * info.scale));
    info.resized_height = std::max(1, static_cast<int>(src_height * info.scale));

    std::vector<float> resized;
    ResizeRgbBilinear(src, src_width, src_height, info.resized_width, info.resized_height, resized);

    for (int y = 0; y < info.resized_height; ++y) {
        for (int x = 0; x < info.resized_width; ++x) {
            const size_t src_idx = static_cast<size_t>((y * info.resized_width + x) * 3);
            const size_t dst_idx = static_cast<size_t>((y * dst_width + x) * 3);
            dst_hwc[dst_idx + 0] = resized[src_idx + 0];
            dst_hwc[dst_idx + 1] = resized[src_idx + 1];
            dst_hwc[dst_idx + 2] = resized[src_idx + 2];
        }
    }

    return info;
}

void NormalizeByMeanStdInplace(std::vector<float>& hwc,
                               const std::array<float, 3>& mean,
                               const std::array<float, 3>& std) {
    if (hwc.empty()) return;
    for (size_t i = 0; i + 2 < hwc.size(); i += 3) {
        hwc[i + 0] = (hwc[i + 0] - mean[0]) / std[0];
        hwc[i + 1] = (hwc[i + 1] - mean[1]) / std[1];
        hwc[i + 2] = (hwc[i + 2] - mean[2]) / std[2];
    }
}

void NormalizeImageNetInplace(std::vector<float>& hwc) {
    static constexpr std::array<float, 3> kMean = {0.485f * 255.0f, 0.456f * 255.0f, 0.406f * 255.0f};
    static constexpr std::array<float, 3> kStd = {0.229f * 255.0f, 0.224f * 255.0f, 0.225f * 255.0f};
    NormalizeByMeanStdInplace(hwc, kMean, kStd);
}

void HwcToChw(const std::vector<float>& src_hwc,
              int width,
              int height,
              std::vector<float>& dst_chw) {
    const size_t count = static_cast<size_t>(width * height);
    dst_chw.assign(count * 3u, 0.0f);
    if (src_hwc.size() < count * 3u) return;

    for (size_t i = 0; i < count; ++i) {
        dst_chw[i] = src_hwc[i * 3u + 0];
        dst_chw[count + i] = src_hwc[i * 3u + 1];
        dst_chw[count * 2u + i] = src_hwc[i * 3u + 2];
    }
}

}  // namespace infer
