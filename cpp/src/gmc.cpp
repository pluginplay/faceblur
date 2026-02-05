#include "gmc.hpp"

#include <algorithm>
#include <limits>

namespace {
inline int clamp_downscale(int d) { return std::max(1, d); }
}  // namespace

#ifdef FACE_PIPELINE_GMC_OPENCV

#include "opencv2/core.hpp"
#include "opencv2/imgproc.hpp"
#include "opencv2/videostab.hpp"

struct GmcEstimator::Impl {
    cv::videostab::MotionModel motion_model = cv::videostab::MM_SIMILARITY;
    cv::Ptr<cv::videostab::MotionEstimatorRansacL2> est;
    cv::Ptr<cv::videostab::KeypointBasedMotionEstimator> kbest;

    explicit Impl(cv::videostab::MotionModel m) : motion_model(m) {
        est = cv::makePtr<cv::videostab::MotionEstimatorRansacL2>(motion_model);
        kbest = cv::makePtr<cv::videostab::KeypointBasedMotionEstimator>(est);
    }
};

static inline Mat3f CvMatToMat3f(const cv::Mat& M) {
    Mat3f out = Mat3f::Identity();
    if (M.rows != 3 || M.cols != 3) return out;
    for (int r = 0; r < 3; ++r) {
        for (int c = 0; c < 3; ++c) {
            out.m[static_cast<size_t>(r) * 3u + static_cast<size_t>(c)] = M.at<float>(r, c);
        }
    }
    return out;
}

GmcEstimator::GmcEstimator(GmcConfig cfg) : cfg_(cfg) {
    cv::videostab::MotionModel mm = cv::videostab::MM_SIMILARITY;
    if (cfg_.model == GmcConfig::Model::Homography) {
        mm = cv::videostab::MM_HOMOGRAPHY;
    }
    impl_ = std::make_unique<Impl>(mm);
}

GmcEstimator::~GmcEstimator() = default;

bool GmcEstimator::Estimate(const uint8_t* curr_rgb, int curr_w, int curr_h,
                            const uint8_t* prev_rgb, int prev_w, int prev_h,
                            Mat3f& out_warp) noexcept {
    out_warp = Mat3f::Identity();
    if (!impl_) return false;
    if (!curr_rgb || !prev_rgb) return false;
    if (curr_w <= 0 || curr_h <= 0 || prev_w <= 0 || prev_h <= 0) return false;
    if (curr_w != prev_w || curr_h != prev_h) return false;

    const int down = clamp_downscale(cfg_.downscale);
    const int ds_w = std::max(1, curr_w / down);
    const int ds_h = std::max(1, curr_h / down);

    // NOTE: stb_image loads RGB; videostab does not require a specific channel order.
    cv::Mat curr(curr_h, curr_w, CV_8UC3, const_cast<uint8_t*>(curr_rgb));
    cv::Mat prev(curr_h, curr_w, CV_8UC3, const_cast<uint8_t*>(prev_rgb));

    cv::Mat curr_ds, prev_ds;
    cv::resize(curr, curr_ds, cv::Size(ds_w, ds_h), 0, 0, cv::INTER_LINEAR);
    cv::resize(prev, prev_ds, cv::Size(ds_w, ds_h), 0, 0, cv::INTER_LINEAR);

    bool ok = false;
    cv::Mat warp = impl_->kbest->estimate(prev_ds, curr_ds, &ok);
    if (!ok || warp.empty()) {
        return false;
    }

    if (warp.rows == 2 && warp.cols == 3) {
        // Convert affine 2x3 to 3x3 (shouldn't happen for MM_SIMILARITY, but be safe).
        cv::Mat W = cv::Mat::eye(3, 3, warp.type());
        warp.copyTo(W(cv::Rect(0, 0, 3, 2)));
        warp = W;
    }

    warp.convertTo(warp, CV_32F);
    if (warp.rows != 3 || warp.cols != 3) return false;

    // Undo downscale on translation components (matches fast_gmc behavior).
    warp.at<float>(0, 2) *= static_cast<float>(down);
    warp.at<float>(1, 2) *= static_cast<float>(down);

    out_warp = CvMatToMat3f(warp);
    return true;
}

#else

struct GmcEstimator::Impl {};

GmcEstimator::GmcEstimator(GmcConfig cfg) : cfg_(cfg) {}
GmcEstimator::~GmcEstimator() = default;

namespace {
inline uint8_t luma_u8(const uint8_t* rgb) {
    // Integer approx of BT.601: 0.299 R + 0.587 G + 0.114 B
    const int r = rgb[0];
    const int g = rgb[1];
    const int b = rgb[2];
    return static_cast<uint8_t>((77 * r + 150 * g + 29 * b + 128) >> 8);
}

// Brute-force translation search on a downsampled luma grid.
// Returns true if a meaningful improvement over (0,0) is found.
static bool estimate_translation_gmc(const uint8_t* curr_rgb, int w, int h,
                                     const uint8_t* prev_rgb, int /*prev_w*/, int /*prev_h*/,
                                     int down,
                                     int& best_dx_px,
                                     int& best_dy_px) noexcept {
    best_dx_px = 0;
    best_dy_px = 0;
    if (!curr_rgb || !prev_rgb) return false;
    if (w <= 0 || h <= 0) return false;
    down = clamp_downscale(down);

    const int ds_w = std::max(1, w / down);
    const int ds_h = std::max(1, h / down);
    if (ds_w < 32 || ds_h < 32) return false;

    // Search range in downsampled pixels. At down=4, +/-8 => +/-32px at full-res.
    const int max_shift_ds = 8;
    const int step_ds = 12;   // sampling stride on downsampled grid
    const int margin_ds = 8;  // avoid boundaries

    auto sad_for = [&](int dx_ds, int dy_ds, uint64_t best_so_far) -> uint64_t {
        uint64_t sad = 0;
        const int y0 = margin_ds;
        const int y1 = ds_h - margin_ds;
        const int x0 = margin_ds;
        const int x1 = ds_w - margin_ds;
        for (int y = y0; y < y1; y += step_ds) {
            const int y2 = y + dy_ds;
            if (y2 < y0 || y2 >= y1) continue;
            const int py = y * down;
            const int cy = y2 * down;
            for (int x = x0; x < x1; x += step_ds) {
                const int x2 = x + dx_ds;
                if (x2 < x0 || x2 >= x1) continue;
                const int px = x * down;
                const int cx = x2 * down;
                const uint8_t* p = prev_rgb + (py * w + px) * 3;
                const uint8_t* c = curr_rgb + (cy * w + cx) * 3;
                const int dp = static_cast<int>(luma_u8(p));
                const int dc = static_cast<int>(luma_u8(c));
                sad += static_cast<uint64_t>(std::abs(dp - dc));
                if (sad >= best_so_far) return sad;  // early stop
            }
        }
        return sad;
    };

    // Baseline (no warp).
    const uint64_t sad0 = sad_for(0, 0, std::numeric_limits<uint64_t>::max());
    if (sad0 == 0) return false;

    uint64_t best = sad0;
    int best_dx_ds = 0;
    int best_dy_ds = 0;

    for (int dy = -max_shift_ds; dy <= max_shift_ds; ++dy) {
        for (int dx = -max_shift_ds; dx <= max_shift_ds; ++dx) {
            // Favor smaller motion slightly to reduce jitter in ambiguous cases.
            const uint64_t penalty = static_cast<uint64_t>((dx * dx + dy * dy) * 4);
            const uint64_t sad = sad_for(dx, dy, best) + penalty;
            if (sad < best) {
                best = sad;
                best_dx_ds = dx;
                best_dy_ds = dy;
            }
        }
    }

    const double improvement = (static_cast<double>(sad0) - static_cast<double>(best)) / static_cast<double>(sad0);
    if (!(improvement > 0.01)) {  // require at least 1% better than identity
        best_dx_px = 0;
        best_dy_px = 0;
        return false;
    }

    best_dx_px = best_dx_ds * down;
    best_dy_px = best_dy_ds * down;
    return true;
}
}  // namespace

bool GmcEstimator::Estimate(const uint8_t* curr_rgb, int curr_w, int curr_h,
                            const uint8_t* prev_rgb, int prev_w, int prev_h,
                            Mat3f& out_warp) noexcept {
    out_warp = Mat3f::Identity();
    // Dependency-free fallback: estimate a simple translation model.
    int dx_px = 0;
    int dy_px = 0;
    const bool ok = estimate_translation_gmc(
        curr_rgb, curr_w, curr_h,
        prev_rgb, prev_w, prev_h,
        cfg_.downscale,
        dx_px, dy_px
    );
    if (!ok) return false;

    out_warp = Mat3f::Identity();
    out_warp.m[2] = static_cast<float>(dx_px);
    out_warp.m[5] = static_cast<float>(dy_px);
    return true;
}

#endif

