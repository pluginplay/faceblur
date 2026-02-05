#pragma once

#include "kalman_filter.hpp"

#include <array>
#include <string>

#include "net.h"

/**
 * MobileFaceNet (ArcFace) embedding extractor.
 *
 * - Input: RGB face crop (expected ~112x112)
 * - Output: L2-normalized embedding vector (kDim)
 *
 * Notes:
 * - This project currently uses the MXNet-converted model where input blob is
 *   "data" and output blob is "fc1".
 * - The converted graph already contains mean/norm preprocessing.
 */
class MobileFaceNetReid {
public:
    static constexpr int kDim = 128;

    MobileFaceNetReid() = default;
    MobileFaceNetReid(const std::string& param_path, const std::string& bin_path);

    bool Load(const std::string& param_path, const std::string& bin_path);
    bool IsLoaded() const { return loaded_; }

    /**
     * Extract an embedding for a face region, optionally using 5-point landmark alignment.
     *
     * @param rgb Interleaved RGB pixels (uint8)
     * @param width Image width
     * @param height Image height
     * @param face_bbox_abs Face bbox in absolute pixel coordinates
     * @param landmarks_abs Optional SCRFD 5-point landmarks in absolute pixels (x,y)
     * @param ok Output: true if embedding was produced
     * @param quality_out Optional output: lightweight quality score in [0,1]
     */
    std::array<float, kDim> Extract(const unsigned char* rgb,
                                    int width,
                                    int height,
                                    const BBox& face_bbox_abs,
                                    const std::array<std::array<float, 2>, 5>* landmarks_abs,
                                    bool& ok,
                                    float* quality_out = nullptr) const;

private:
    ncnn::Net net_;
    bool loaded_ = false;
    int input_w_ = 112;
    int input_h_ = 112;
};

