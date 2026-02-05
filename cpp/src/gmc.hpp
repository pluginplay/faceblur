#pragma once

#include <cstdint>
#include <memory>

#include "transform.hpp"

struct GmcConfig {
    enum class Model { Similarity, Homography };

    int downscale = 4;
    Model model = Model::Similarity;
};

class GmcEstimator {
public:
    explicit GmcEstimator(GmcConfig cfg = {});
    ~GmcEstimator();

    GmcEstimator(const GmcEstimator&) = delete;
    GmcEstimator& operator=(const GmcEstimator&) = delete;

    // Estimates warp that maps points from prev -> curr (pixel coordinates).
    // If estimation fails (or OpenCV videostab is unavailable), returns false and sets identity.
    bool Estimate(const uint8_t* curr_rgb, int curr_w, int curr_h,
                  const uint8_t* prev_rgb, int prev_w, int prev_h,
                  Mat3f& out_warp) noexcept;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    GmcConfig cfg_;
};

