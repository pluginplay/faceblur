#include "scrfd.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <vector>

#include "infer/image_ops.hpp"
#include "infer/ort_runtime.hpp"

namespace {

static constexpr std::array<int, 3> STRIDES = {8, 16, 32};
static constexpr int NUM_ANCHORS = 2;

float ComputeIoU(const std::array<float, 4>& a, const std::array<float, 4>& b) {
    const float x1 = std::max(a[0], b[0]);
    const float y1 = std::max(a[1], b[1]);
    const float x2 = std::min(a[2], b[2]);
    const float y2 = std::min(a[3], b[3]);

    const float inter_w = std::max(0.0f, x2 - x1);
    const float inter_h = std::max(0.0f, y2 - y1);
    const float inter_area = inter_w * inter_h;

    const float area_a = (a[2] - a[0]) * (a[3] - a[1]);
    const float area_b = (b[2] - b[0]) * (b[3] - b[1]);

    return inter_area / (area_a + area_b - inter_area + 1e-6f);
}

std::vector<int> NMS(const std::vector<ScrfdFace>& faces, float threshold) {
    std::vector<int> indices(faces.size());
    for (size_t i = 0; i < faces.size(); ++i) indices[i] = static_cast<int>(i);

    std::sort(indices.begin(), indices.end(), [&faces](int a, int b) {
        return faces[a].score > faces[b].score;
    });

    std::vector<int> keep;
    std::vector<bool> suppressed(faces.size(), false);

    for (const int idx : indices) {
        if (suppressed[idx]) continue;
        keep.push_back(idx);

        for (const int other : indices) {
            if (suppressed[other] || other == idx) continue;
            if (ComputeIoU(faces[idx].bbox, faces[other].bbox) > threshold) {
                suppressed[other] = true;
            }
        }
    }

    return keep;
}

inline float clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

}  // namespace

ScrfdDetector::ScrfdDetector(const std::string& onnx_path,
                             int input_width,
                             int input_height,
                             float conf_thresh,
                             float nms_thresh,
                             int num_threads)
    : input_width_(input_width),
      input_height_(input_height),
      conf_thresh_(conf_thresh),
      nms_thresh_(nms_thresh),
      loaded_(false) {
    if (!std::filesystem::exists(onnx_path)) return;

    try {
        session_ = infer::CreateSession(onnx_path, num_threads);
        const auto input_names = infer::GetInputNames(*session_);
        const auto output_names = infer::GetOutputNames(*session_);

        const std::string* input = infer::FindFirstAvailable(input_names, {"input.1", "input", "in0"});
        if (!input) {
            session_.reset();
            return;
        }
        input_name_ = *input;

        for (size_t i = 0; i < STRIDES.size(); ++i) {
            const int stride = STRIDES[i];
            const std::string score_name = "score_" + std::to_string(stride);
            const std::string bbox_name = "bbox_" + std::to_string(stride);
            const std::string kps_name = "kps_" + std::to_string(stride);

            if (!infer::HasName(output_names, score_name) ||
                !infer::HasName(output_names, bbox_name) ||
                !infer::HasName(output_names, kps_name)) {
                session_.reset();
                return;
            }
            score_names_[i] = score_name;
            bbox_names_[i] = bbox_name;
            kps_names_[i] = kps_name;
        }

        loaded_ = true;
    } catch (const std::exception&) {
        session_.reset();
    }
}

bool ScrfdDetector::IsLoaded() const {
    return loaded_;
}

std::vector<ScrfdFace> ScrfdDetector::Detect(const unsigned char* rgb,
                                             int width,
                                             int height) const {
    std::vector<ScrfdFace> faces;
    if (!loaded_ || !session_ || !rgb || width <= 0 || height <= 0) return faces;

    std::vector<float> input_hwc;
    const infer::LetterboxInfo lb = infer::LetterboxResizeRgb(
        rgb, width, height, input_width_, input_height_, input_hwc, 0.0f);
    if (lb.scale <= 0.0f) return faces;

    static constexpr std::array<float, 3> kMean = {127.5f, 127.5f, 127.5f};
    static constexpr std::array<float, 3> kStd = {127.5f, 127.5f, 127.5f};
    infer::NormalizeByMeanStdInplace(input_hwc, kMean, kStd);

    std::vector<float> input_chw;
    infer::HwcToChw(input_hwc, input_width_, input_height_, input_chw);

    const std::array<int64_t, 4> input_shape = {
        1,
        3,
        static_cast<int64_t>(input_height_),
        static_cast<int64_t>(input_width_),
    };
    Ort::Value input_tensor = Ort::Value::CreateTensor<float>(
        infer::CpuMemoryInfo(),
        input_chw.data(),
        input_chw.size(),
        input_shape.data(),
        input_shape.size());

    const std::array<const char*, 1> input_names = {input_name_.c_str()};
    std::array<const char*, 9> output_names = {
        score_names_[0].c_str(), score_names_[1].c_str(), score_names_[2].c_str(),
        bbox_names_[0].c_str(),  bbox_names_[1].c_str(),  bbox_names_[2].c_str(),
        kps_names_[0].c_str(),   kps_names_[1].c_str(),   kps_names_[2].c_str(),
    };

    try {
        auto outputs = session_->Run(Ort::RunOptions{nullptr},
                                     input_names.data(),
                                     &input_tensor,
                                     input_names.size(),
                                     output_names.data(),
                                     output_names.size());
        if (outputs.size() != output_names.size()) return faces;

        std::vector<ScrfdFace> all_faces;

        for (size_t s = 0; s < STRIDES.size(); ++s) {
            const int stride = STRIDES[s];
            const int fm_w = input_width_ / stride;
            const int fm_h = input_height_ / stride;
            const size_t expected_locations = static_cast<size_t>(fm_w * fm_h * NUM_ANCHORS);

            const auto& score_tensor = outputs[s];
            const auto& bbox_tensor = outputs[3 + s];
            const auto& kps_tensor = outputs[6 + s];
            if (!score_tensor.IsTensor() || !bbox_tensor.IsTensor() || !kps_tensor.IsTensor()) continue;

            const float* score_data = score_tensor.GetTensorData<float>();
            const float* bbox_data = bbox_tensor.GetTensorData<float>();
            const float* kps_data = kps_tensor.GetTensorData<float>();
            if (!score_data || !bbox_data || !kps_data) continue;

            const auto score_info = score_tensor.GetTensorTypeAndShapeInfo();
            const auto bbox_info = bbox_tensor.GetTensorTypeAndShapeInfo();
            const auto kps_info = kps_tensor.GetTensorTypeAndShapeInfo();
            const size_t score_count = static_cast<size_t>(score_info.GetElementCount());
            const size_t bbox_count = static_cast<size_t>(bbox_info.GetElementCount());
            const size_t kps_count = static_cast<size_t>(kps_info.GetElementCount());

            if (score_count < expected_locations ||
                bbox_count < expected_locations * 4u ||
                kps_count < expected_locations * 10u) {
                continue;
            }

            for (size_t idx = 0; idx < expected_locations; ++idx) {
                const float prob = score_data[idx];
                if (prob < conf_thresh_) continue;

                const int loc = static_cast<int>(idx / static_cast<size_t>(NUM_ANCHORS));
                const int x = loc % fm_w;
                const int y = loc / fm_w;

                const float cx = (static_cast<float>(x) + 0.5f) * static_cast<float>(stride);
                const float cy = (static_cast<float>(y) + 0.5f) * static_cast<float>(stride);

                const float* bb = bbox_data + idx * 4u;
                const float dx = bb[0] * static_cast<float>(stride);
                const float dy = bb[1] * static_cast<float>(stride);
                const float dw = bb[2] * static_cast<float>(stride);
                const float dh = bb[3] * static_cast<float>(stride);

                float x1 = (cx - dx) / lb.scale;
                float y1 = (cy - dy) / lb.scale;
                float x2 = (cx + dw) / lb.scale;
                float y2 = (cy + dh) / lb.scale;

                x1 = clampf(x1, 0.0f, static_cast<float>(width));
                y1 = clampf(y1, 0.0f, static_cast<float>(height));
                x2 = clampf(x2, 0.0f, static_cast<float>(width));
                y2 = clampf(y2, 0.0f, static_cast<float>(height));
                if (x2 - x1 <= 1.0f || y2 - y1 <= 1.0f) continue;

                ScrfdFace face;
                face.bbox = {x1, y1, x2, y2};
                face.score = prob;

                const float* kp = kps_data + idx * 10u;
                for (int k = 0; k < 5; ++k) {
                    const float kp_x = (cx + kp[k * 2 + 0] * static_cast<float>(stride)) / lb.scale;
                    const float kp_y = (cy + kp[k * 2 + 1] * static_cast<float>(stride)) / lb.scale;
                    face.landmarks[k] = {
                        clampf(kp_x, 0.0f, static_cast<float>(width)),
                        clampf(kp_y, 0.0f, static_cast<float>(height)),
                    };
                }

                all_faces.push_back(face);
            }
        }

        const std::vector<int> keep = NMS(all_faces, nms_thresh_);
        faces.reserve(keep.size());
        for (const int idx : keep) {
            faces.push_back(all_faces[static_cast<size_t>(idx)]);
        }

        std::sort(faces.begin(), faces.end(), [](const ScrfdFace& a, const ScrfdFace& b) {
            return a.score > b.score;
        });
    } catch (const Ort::Exception&) {
        faces.clear();
    }

    return faces;
}
