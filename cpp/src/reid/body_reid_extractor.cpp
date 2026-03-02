#include "reid/body_reid_extractor.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <filesystem>

#include "infer/image_ops.hpp"
#include "infer/ort_runtime.hpp"

namespace {

inline float clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

inline void l2_normalize(std::array<float, Detection::kReidDim>& v) {
    double ss = 0.0;
    for (float x : v) {
        ss += static_cast<double>(x) * static_cast<double>(x);
    }
    const double inv = 1.0 / (std::sqrt(ss) + 1e-12);
    for (float& x : v) {
        x = static_cast<float>(static_cast<double>(x) * inv);
    }
}

}  // namespace

BodyReidExtractor::BodyReidExtractor(const BodyReidConfig& cfg)
    : cfg_(cfg), enabled_(cfg.enabled && !cfg.model_dir.empty()) {
    if (!enabled_) return;

    const std::vector<std::string> candidates = {
        cfg_.model_dir + "/osnet_ibn_x1_0.onnx",
        cfg_.model_dir + "/model.onnx",
    };

    for (const std::string& model_path : candidates) {
        if (!std::filesystem::exists(model_path)) continue;

        try {
            session_ = infer::CreateSession(model_path, cfg_.num_threads);
            const auto input_names = infer::GetInputNames(*session_);
            const auto output_names = infer::GetOutputNames(*session_);

            const std::string* input = infer::FindFirstAvailable(input_names, {"input", "in0", "images"});
            const std::string* output = infer::FindFirstAvailable(output_names, {"output", "out0", "fc"});
            if (!input || !output) {
                session_.reset();
                continue;
            }

            input_name_ = *input;
            output_name_ = *output;
            loaded_ = true;
            break;
        } catch (const std::exception&) {
            session_.reset();
        }
    }

    if (!loaded_) enabled_ = false;
}

bool BodyReidExtractor::extractOne(const FrameView& frame,
                                   const BBox& bbox,
                                   std::array<float, Detection::kReidDim>& out_vec) const {
    if (!session_) return false;

    const int x1 = static_cast<int>(std::floor(clampf(bbox.x1, 0.0f, static_cast<float>(frame.width - 1))));
    const int y1 = static_cast<int>(std::floor(clampf(bbox.y1, 0.0f, static_cast<float>(frame.height - 1))));
    const int x2 = static_cast<int>(
        std::ceil(clampf(bbox.x2, static_cast<float>(x1 + 1), static_cast<float>(frame.width))));
    const int y2 = static_cast<int>(
        std::ceil(clampf(bbox.y2, static_cast<float>(y1 + 1), static_cast<float>(frame.height))));
    const int w = std::max(1, x2 - x1);
    const int h = std::max(1, y2 - y1);

    std::vector<float> roi_hwc;
    infer::ResizeRgbRoiBilinear(frame.rgb, frame.width, frame.height, x1, y1, w, h, 128, 256, roi_hwc);
    infer::NormalizeImageNetInplace(roi_hwc);

    std::vector<float> input_chw;
    infer::HwcToChw(roi_hwc, 128, 256, input_chw);

    const std::array<int64_t, 4> input_shape = {1, 3, 256, 128};
    Ort::Value input_tensor = Ort::Value::CreateTensor<float>(
        infer::CpuMemoryInfo(),
        input_chw.data(),
        input_chw.size(),
        input_shape.data(),
        input_shape.size());

    const std::array<const char*, 1> input_names = {input_name_.c_str()};
    const std::array<const char*, 1> output_names = {output_name_.c_str()};

    try {
        auto outputs = session_->Run(Ort::RunOptions{nullptr},
                                     input_names.data(),
                                     &input_tensor,
                                     input_names.size(),
                                     output_names.data(),
                                     output_names.size());
        if (outputs.size() != 1 || !outputs[0].IsTensor()) return false;

        const auto info = outputs[0].GetTensorTypeAndShapeInfo();
        const size_t elem_count = static_cast<size_t>(std::max<int64_t>(1, info.GetElementCount()));
        const float* feat = outputs[0].GetTensorData<float>();
        if (!feat || elem_count == 0) return false;

        std::fill(out_vec.begin(), out_vec.end(), 0.0f);
        const size_t copy_count = std::min(out_vec.size(), elem_count);
        std::memcpy(out_vec.data(), feat, copy_count * sizeof(float));
        l2_normalize(out_vec);
        return true;
    } catch (const Ort::Exception&) {
        return false;
    }
}

void BodyReidExtractor::Extract(const FrameView& frame, std::vector<Detection>& detections) const {
    if (!IsEnabled() || !frame.isValid()) return;

    for (auto& det : detections) {
        if (det.score < cfg_.min_det_conf) continue;
        if (cfg_.min_bbox_px > 0.0f &&
            (det.bbox.width() < cfg_.min_bbox_px || det.bbox.height() < cfg_.min_bbox_px)) {
            continue;
        }
        std::array<float, Detection::kReidDim> emb{};
        if (!extractOne(frame, det.bbox, emb)) continue;
        det.reid = emb;
        det.has_reid = true;
        det.reid_quality = 1.0f;
    }
}
