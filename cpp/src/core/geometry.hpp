#pragma once

#include <algorithm>

#include "core/types.hpp"

inline float clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

inline BBox clamp_bbox(const BBox& b, int w, int h) {
    const float x1 = clampf(b.x1, 0.0f, static_cast<float>(w));
    const float y1 = clampf(b.y1, 0.0f, static_cast<float>(h));
    const float x2 = clampf(b.x2, 0.0f, static_cast<float>(w));
    const float y2 = clampf(b.y2, 0.0f, static_cast<float>(h));
    return BBox{x1, y1, x2, y2};
}
