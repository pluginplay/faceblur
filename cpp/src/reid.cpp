#include "reid.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <thread>

namespace {
inline int clampi(int v, int lo, int hi) {
    return std::max(lo, std::min(hi, v));
}

inline float clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

inline float GetEnvFloat(const char* name, float fallback) {
    const char* v = std::getenv(name);
    if (!v || !*v) return fallback;
    char* end = nullptr;
    const float out = std::strtof(v, &end);
    if (end == v || !std::isfinite(out)) return fallback;
    return out;
}

inline void l2_normalize(std::array<float, MobileFaceNetReid::kDim>& v) {
    double ss = 0.0;
    for (float x : v) ss += static_cast<double>(x) * static_cast<double>(x);
    const double inv = 1.0 / (std::sqrt(ss) + 1e-12);
    for (float& x : v) x = static_cast<float>(static_cast<double>(x) * inv);
}

struct Similarity2x3 {
    // [ a -b tx ]
    // [ b  a ty ]
    float a = 1.0f;
    float b = 0.0f;
    float tx = 0.0f;
    float ty = 0.0f;
};

inline bool EstimateSimilarity5pt(const std::array<std::array<float, 2>, 5>& src,
                                 const std::array<std::array<float, 2>, 5>& dst,
                                 Similarity2x3& out) {
    // Least-squares similarity transform from src -> dst:
    // dst ≈ s*R*src + t where R is rotation and s uniform scale.
    float sxm = 0.0f, sym = 0.0f, dxm = 0.0f, dym = 0.0f;
    for (int i = 0; i < 5; ++i) {
        sxm += src[i][0];
        sym += src[i][1];
        dxm += dst[i][0];
        dym += dst[i][1];
    }
    sxm /= 5.0f; sym /= 5.0f;
    dxm /= 5.0f; dym /= 5.0f;

    double a = 0.0;
    double b = 0.0;
    double den = 0.0;
    for (int i = 0; i < 5; ++i) {
        const double xs = static_cast<double>(src[i][0] - sxm);
        const double ys = static_cast<double>(src[i][1] - sym);
        const double xd = static_cast<double>(dst[i][0] - dxm);
        const double yd = static_cast<double>(dst[i][1] - dym);
        a += xd * xs + yd * ys;
        b += yd * xs - xd * ys;
        den += xs * xs + ys * ys;
    }
    if (!(den > 1e-8)) return false;

    const double r = std::sqrt(a * a + b * b);
    if (!(r > 1e-12)) return false;

    const double scale = r / den;
    const double c = a / r;
    const double s = b / r;

    out.a = static_cast<float>(scale * c);
    out.b = static_cast<float>(scale * s);
    out.tx = static_cast<float>(dxm - out.a * sxm + out.b * sym);
    out.ty = static_cast<float>(dym - out.b * sxm - out.a * sym);
    return std::isfinite(out.a) && std::isfinite(out.b) && std::isfinite(out.tx) && std::isfinite(out.ty);
}

inline void InvertSimilarity(const Similarity2x3& M, Similarity2x3& inv) {
    // M: [ a -b tx; b a ty ]
    const float det = M.a * M.a + M.b * M.b;
    if (!(det > 1e-12f)) {
        inv = Similarity2x3{};
        return;
    }
    // A^{-1} = 1/det * [ a  b; -b  a ] which in our (a,-b;b,a) form is:
    // invA = [ p -q; q p ] where p=a/det, q=-b/det.
    const float p = M.a / det;
    const float q = -M.b / det;
    inv.a = p;
    inv.b = q;

    // inv translation: -A^{-1} * t
    inv.tx = -(p * M.tx - q * M.ty);
    inv.ty = -(q * M.tx + p * M.ty);
}

inline void SampleBilinearRGB(const unsigned char* rgb, int w, int h,
                              float x, float y, unsigned char out_rgb[3]) {
    x = clampf(x, 0.0f, static_cast<float>(w - 1));
    y = clampf(y, 0.0f, static_cast<float>(h - 1));

    const int x0 = static_cast<int>(std::floor(x));
    const int y0 = static_cast<int>(std::floor(y));
    const int x1 = std::min(x0 + 1, w - 1);
    const int y1 = std::min(y0 + 1, h - 1);
    const float dx = x - static_cast<float>(x0);
    const float dy = y - static_cast<float>(y0);

    const int idx00 = (y0 * w + x0) * 3;
    const int idx10 = (y0 * w + x1) * 3;
    const int idx01 = (y1 * w + x0) * 3;
    const int idx11 = (y1 * w + x1) * 3;

    for (int c = 0; c < 3; ++c) {
        const float v00 = static_cast<float>(rgb[idx00 + c]);
        const float v10 = static_cast<float>(rgb[idx10 + c]);
        const float v01 = static_cast<float>(rgb[idx01 + c]);
        const float v11 = static_cast<float>(rgb[idx11 + c]);
        const float v0 = v00 + (v10 - v00) * dx;
        const float v1 = v01 + (v11 - v01) * dx;
        const float v = v0 + (v1 - v0) * dy;
        out_rgb[c] = static_cast<unsigned char>(clampf(v, 0.0f, 255.0f));
    }
}

inline float Luma(const unsigned char rgb[3]) {
    // Rec. 601-ish luma
    return 0.299f * rgb[0] + 0.587f * rgb[1] + 0.114f * rgb[2];
}

inline float LumaAt(const std::vector<unsigned char>& rgb, int idx) {
    const unsigned char px[3] = {rgb[idx], rgb[idx + 1], rgb[idx + 2]};
    return Luma(px);
}

inline float ComputeLaplacianVariance112(const std::vector<unsigned char>& aligned_rgb112) {
    constexpr int W = 112;
    constexpr int H = 112;
    if (aligned_rgb112.size() < static_cast<size_t>(W * H * 3)) return 0.0f;
    double sum = 0.0;
    double sum_sq = 0.0;
    int count = 0;
    for (int y = 1; y < H - 1; ++y) {
        for (int x = 1; x < W - 1; ++x) {
            const int idx = (y * W + x) * 3;
            const float c = LumaAt(aligned_rgb112, idx);
            const float n = LumaAt(aligned_rgb112, idx - W * 3);
            const float s = LumaAt(aligned_rgb112, idx + W * 3);
            const float w = LumaAt(aligned_rgb112, idx - 3);
            const float e = LumaAt(aligned_rgb112, idx + 3);
            const float lap = 4.0f * c - n - s - w - e;
            sum += static_cast<double>(lap);
            sum_sq += static_cast<double>(lap) * static_cast<double>(lap);
            count++;
        }
    }
    if (count <= 0) return 0.0f;
    const double mean = sum / static_cast<double>(count);
    const double var = (sum_sq / static_cast<double>(count)) - (mean * mean);
    return static_cast<float>(std::max(0.0, var));
}

inline void ApplyLaplacianSharpen112(const std::vector<unsigned char>& src,
                                     std::vector<unsigned char>& dst,
                                     float alpha) {
    constexpr int W = 112;
    constexpr int H = 112;
    if (src.size() < static_cast<size_t>(W * H * 3)) return;
    dst.resize(src.size());
    // Copy borders unchanged.
    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            if (x == 0 || y == 0 || x == W - 1 || y == H - 1) {
                const int idx = (y * W + x) * 3;
                dst[idx + 0] = src[idx + 0];
                dst[idx + 1] = src[idx + 1];
                dst[idx + 2] = src[idx + 2];
            }
        }
    }
    for (int y = 1; y < H - 1; ++y) {
        for (int x = 1; x < W - 1; ++x) {
            const int idx = (y * W + x) * 3;
            const float c = LumaAt(src, idx);
            const float n = LumaAt(src, idx - W * 3);
            const float s = LumaAt(src, idx + W * 3);
            const float w = LumaAt(src, idx - 3);
            const float e = LumaAt(src, idx + 3);
            const float lap = 4.0f * c - n - s - w - e;
            for (int ch = 0; ch < 3; ++ch) {
                const float v = static_cast<float>(src[idx + ch]) + alpha * lap;
                dst[idx + ch] = static_cast<unsigned char>(clampf(v, 0.0f, 255.0f));
            }
        }
    }
}

inline float ComputeQuality112(const std::vector<unsigned char>& aligned_rgb112,
                              float box_w, float box_h, int img_w, int img_h) {
    // Size score (favor reasonably large faces; keep conservative for LivePD low-light).
    const float min_dim = static_cast<float>(std::max(1, std::min(img_w, img_h)));
    const float diag_norm = std::sqrt(std::max(1.0f, box_w * box_h)) / min_dim;
    const float size_score = clampf((diag_norm - 0.03f) / (0.15f - 0.03f), 0.0f, 1.0f);

    // Brightness + sharpness on aligned crop.
    double mean_l = 0.0;
    double mean_grad = 0.0;
    const int W = 112, H = 112;
    for (int y = 0; y < H; ++y) {
        for (int x = 0; x < W; ++x) {
            const int idx = (y * W + x) * 3;
            unsigned char px[3] = {aligned_rgb112[idx], aligned_rgb112[idx + 1], aligned_rgb112[idx + 2]};
            const float l = Luma(px);
            mean_l += l;

            if (x + 1 < W) {
                unsigned char pxr[3] = {aligned_rgb112[idx + 3], aligned_rgb112[idx + 4], aligned_rgb112[idx + 5]};
                mean_grad += std::abs(Luma(pxr) - l);
            }
            if (y + 1 < H) {
                const int idy = ((y + 1) * W + x) * 3;
                unsigned char pxb[3] = {aligned_rgb112[idy], aligned_rgb112[idy + 1], aligned_rgb112[idy + 2]};
                mean_grad += std::abs(Luma(pxb) - l);
            }
        }
    }
    mean_l /= static_cast<double>(W * H);
    mean_grad /= static_cast<double>((W - 1) * H + (H - 1) * W);

    const float brightness_score = clampf((static_cast<float>(mean_l) - 40.0f) / (180.0f - 40.0f), 0.0f, 1.0f);
    const float sharpness_score = clampf((static_cast<float>(mean_grad) - 2.0f) / 10.0f, 0.0f, 1.0f);

    // Weighted sum; size dominates, the rest stabilizes in dim scenes.
    return clampf(0.50f * size_score + 0.25f * brightness_score + 0.25f * sharpness_score, 0.0f, 1.0f);
}
}  // namespace

MobileFaceNetReid::MobileFaceNetReid(const std::string& param_path, const std::string& bin_path) {
    (void)Load(param_path, bin_path);
}

bool MobileFaceNetReid::Load(const std::string& param_path, const std::string& bin_path) {
    loaded_ = false;

    // Ensure CPU-only. (This project ships CPU ncnn dylibs.)
    net_.opt.use_vulkan_compute = false;
    net_.opt.num_threads = static_cast<int>(std::max(1u, std::min(4u, std::thread::hardware_concurrency())));

    if (net_.load_param(param_path.c_str()) != 0) return false;
    if (net_.load_model(bin_path.c_str()) != 0) return false;

    loaded_ = true;
    return true;
}

std::array<float, MobileFaceNetReid::kDim> MobileFaceNetReid::Extract(const unsigned char* rgb,
                                                                      int width,
                                                                      int height,
                                                                      const BBox& face_bbox_abs,
                                                                      const std::array<std::array<float, 2>, 5>* landmarks_abs,
                                                                      bool& ok,
                                                                      float* quality_out) const {
    ok = false;
    std::array<float, kDim> out_feat{};
    if (!loaded_ || !rgb || width <= 0 || height <= 0) return out_feat;
    // Default: unknown quality unless requested.
    float quality = 0.0f;

    // ArcFace 112x112 canonical 5-point template.
    const std::array<std::array<float, 2>, 5> kDst = {{
        {38.2946f, 51.6963f},
        {73.5318f, 51.5014f},
        {56.0252f, 71.7366f},
        {41.5493f, 92.3655f},
        {70.7299f, 92.2041f},
    }};

    ncnn::Mat in;
    std::vector<unsigned char> aligned_rgb;

    const float x1 = face_bbox_abs.x1;
    const float y1 = face_bbox_abs.y1;
    const float x2 = face_bbox_abs.x2;
    const float y2 = face_bbox_abs.y2;
    const float bw = std::max(1.0f, x2 - x1);
    const float bh = std::max(1.0f, y2 - y1);

    bool used_alignment = false;
    if (landmarks_abs) {
        // Validate landmarks are reasonably inside the image and not degenerate.
        bool ok_pts = true;
        for (int i = 0; i < 5; ++i) {
            const float lx = (*landmarks_abs)[i][0];
            const float ly = (*landmarks_abs)[i][1];
            if (!(std::isfinite(lx) && std::isfinite(ly))) ok_pts = false;
            if (lx < 0.0f || lx > static_cast<float>(width - 1) ||
                ly < 0.0f || ly > static_cast<float>(height - 1)) ok_pts = false;
        }
        // Eye distance sanity (avoid tiny/flat landmarks).
        const float ex = (*landmarks_abs)[1][0] - (*landmarks_abs)[0][0];
        const float ey = (*landmarks_abs)[1][1] - (*landmarks_abs)[0][1];
        const float eye_dist = std::sqrt(ex * ex + ey * ey);
        if (eye_dist < 4.0f) ok_pts = false;

        if (ok_pts) {
            Similarity2x3 M;
            if (EstimateSimilarity5pt(*landmarks_abs, kDst, M)) {
                Similarity2x3 invM;
                InvertSimilarity(M, invM);  // maps dst -> src

                aligned_rgb.resize(static_cast<size_t>(input_w_) * static_cast<size_t>(input_h_) * 3u);
                for (int v = 0; v < input_h_; ++v) {
                    for (int u = 0; u < input_w_; ++u) {
                        // src = invA * [u,v] + invt (packed into invM)
                        const float x = invM.a * static_cast<float>(u) - invM.b * static_cast<float>(v) + invM.tx;
                        const float y = invM.b * static_cast<float>(u) + invM.a * static_cast<float>(v) + invM.ty;
                        unsigned char px[3];
                        SampleBilinearRGB(rgb, width, height, x, y, px);
                        const size_t idx = (static_cast<size_t>(v) * static_cast<size_t>(input_w_) + static_cast<size_t>(u)) * 3u;
                        aligned_rgb[idx + 0] = px[0];
                        aligned_rgb[idx + 1] = px[1];
                        aligned_rgb[idx + 2] = px[2];
                    }
                }
                used_alignment = true;
                quality = ComputeQuality112(aligned_rgb, bw, bh, width, height);
            }
        }
    }

    if (!used_alignment) {
        // Fallback: expand and square the bbox a bit (more robust crops).
        const float cx = (x1 + x2) * 0.5f;
        const float cy = (y1 + y2) * 0.5f;
        const float side = std::max(bw, bh) * 1.30f;  // ~15% padding each side

        int roix = static_cast<int>(std::floor(cx - side * 0.5f));
        int roiy = static_cast<int>(std::floor(cy - side * 0.5f));
        int roiw = static_cast<int>(std::ceil(side));
        int roih = static_cast<int>(std::ceil(side));

        // Clamp ROI to image bounds.
        roix = clampi(roix, 0, width - 1);
        roiy = clampi(roiy, 0, height - 1);
        roiw = clampi(roiw, 1, width - roix);
        roih = clampi(roih, 1, height - roiy);

        aligned_rgb.resize(static_cast<size_t>(input_w_) * static_cast<size_t>(input_h_) * 3u);
        for (int v = 0; v < input_h_; ++v) {
            for (int u = 0; u < input_w_; ++u) {
                const float fx = (input_w_ > 1) ? (static_cast<float>(u) / static_cast<float>(input_w_ - 1)) : 0.0f;
                const float fy = (input_h_ > 1) ? (static_cast<float>(v) / static_cast<float>(input_h_ - 1)) : 0.0f;
                const float x = static_cast<float>(roix) + fx * static_cast<float>(std::max(1, roiw - 1));
                const float y = static_cast<float>(roiy) + fy * static_cast<float>(std::max(1, roih - 1));
                unsigned char px[3];
                SampleBilinearRGB(rgb, width, height, x, y, px);
                const size_t idx = (static_cast<size_t>(v) * static_cast<size_t>(input_w_) + static_cast<size_t>(u)) * 3u;
                aligned_rgb[idx + 0] = px[0];
                aligned_rgb[idx + 1] = px[1];
                aligned_rgb[idx + 2] = px[2];
            }
        }
        quality = 0.75f * ComputeQuality112(aligned_rgb, bw, bh, width, height);  // less trust without alignment
    }

    const float blur_var = ComputeLaplacianVariance112(aligned_rgb);
    const float kBlurSharpenVar = GetEnvFloat("FACE_PIPELINE_REID_BLUR_SHARPEN_VAR", 50.0f);
    const float kBlurSkipVar = GetEnvFloat("FACE_PIPELINE_REID_BLUR_SKIP_VAR", 12.0f);
    const float kSharpenAlpha = GetEnvFloat("FACE_PIPELINE_REID_LAPLACIAN_ALPHA", 0.6f);

    if (blur_var < kBlurSkipVar) {
        if (quality_out) {
            *quality_out = 0.0f;
        }
        return out_feat;
    }

    const bool apply_sharpen = blur_var < kBlurSharpenVar;
    std::vector<unsigned char> sharpened_rgb;
    const unsigned char* input_rgb = aligned_rgb.data();
    if (apply_sharpen) {
        ApplyLaplacianSharpen112(aligned_rgb, sharpened_rgb, kSharpenAlpha);
        input_rgb = sharpened_rgb.data();
        const float denom = std::max(1e-3f, kBlurSharpenVar - kBlurSkipVar);
        const float blur_factor = clampf((blur_var - kBlurSkipVar) / denom, 0.0f, 1.0f);
        quality *= blur_factor;
    }

    in = ncnn::Mat::from_pixels(input_rgb, ncnn::Mat::PIXEL_RGB, input_w_, input_h_);

    ncnn::Extractor ex = net_.create_extractor();
    ex.set_light_mode(true);

    if (ex.input("data", in) != 0) return out_feat;

    ncnn::Mat feat;
    if (ex.extract("fc1", feat) != 0) return out_feat;
    if (feat.total() != kDim) return out_feat;

    for (int i = 0; i < kDim; ++i) {
        out_feat[i] = feat[i];
    }
    l2_normalize(out_feat);
    ok = true;
    if (quality_out) {
        *quality_out = clampf(quality, 0.0f, 1.0f);
    }
    return out_feat;
}

