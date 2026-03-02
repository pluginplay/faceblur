#include "detect/person_detector.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <initializer_list>
#include <utility>

#include "infer/image_ops.hpp"
#include "infer/ort_runtime.hpp"

namespace {

inline float clampf(float v, float lo, float hi) {
    return std::max(lo, std::min(hi, v));
}

inline float sigmoidf(float x) {
    if (x >= 0.0f) {
        const float z = std::exp(-x);
        return 1.0f / (1.0f + z);
    }
    const float z = std::exp(x);
    return z / (1.0f + z);
}

void nmsDetections(std::vector<Detection>& dets, float iou_thresh) {
    if (dets.size() <= 1 || iou_thresh <= 0.0f) return;
    std::sort(dets.begin(), dets.end(), [](const Detection& a, const Detection& b) {
        return a.score > b.score;
    });

    std::vector<Detection> kept;
    kept.reserve(dets.size());
    for (const Detection& det : dets) {
        bool suppress = false;
        for (const Detection& k : kept) {
            if (det.bbox.iou(k.bbox) > iou_thresh) {
                suppress = true;
                break;
            }
        }
        if (!suppress) kept.push_back(det);
    }
    dets.swap(kept);
}

size_t shapeElemCount(const std::vector<int64_t>& shape) {
    if (shape.empty()) return 0;
    size_t count = 1;
    for (const int64_t d : shape) {
        if (d <= 0) return 0;
        count *= static_cast<size_t>(d);
    }
    return count;
}

}  // namespace

PersonDetector::PersonDetector(const PersonDetectionConfig& cfg) : cfg_(cfg) {
    const std::string model_path = cfg_.model_dir + "/rf-detr-small.onnx";
    if (!std::filesystem::exists(model_path)) {
        return;
    }

    try {
        session_ = infer::CreateSession(model_path, cfg_.num_threads);
        const auto input_names = infer::GetInputNames(*session_);
        const auto output_names = infer::GetOutputNames(*session_);

        const std::string* input = infer::FindFirstAvailable(input_names, {"input", "images", "in0"});
        const std::string* boxes =
            infer::FindFirstAvailable(output_names, {"pred_boxes", "boxes", "out0", "output0"});
        const std::string* logits =
            infer::FindFirstAvailable(output_names, {"pred_logits", "logits", "scores", "out1", "output1"});

        if (!input || !boxes || !logits) {
            session_.reset();
            return;
        }

        input_name_ = *input;
        boxes_name_ = *boxes;
        logits_name_ = *logits;
        loaded_ = true;
    } catch (const std::exception&) {
        session_.reset();
    }
}

bool PersonDetector::decodeRfDetr(const float* boxes,
                                  const std::vector<int64_t>& box_shape,
                                  const float* logits,
                                  const std::vector<int64_t>& logit_shape,
                                  int frame_w,
                                  int frame_h,
                                  std::vector<Detection>& out) const {
    if (!boxes || !logits || box_shape.empty() || logit_shape.empty()) return false;

    int64_t box_rows = 0;
    bool box_transposed = false;
    if (box_shape.size() == 3 && box_shape[2] == 4) {
        box_rows = box_shape[1];
    } else if (box_shape.size() == 2 && box_shape[1] == 4) {
        box_rows = box_shape[0];
    } else if (box_shape.size() == 2 && box_shape[0] == 4) {
        box_rows = box_shape[1];
        box_transposed = true;
    } else {
        return false;
    }

    int64_t log_rows = 0;
    int64_t class_count = 0;
    if (logit_shape.size() == 3) {
        log_rows = logit_shape[1];
        class_count = logit_shape[2];
    } else if (logit_shape.size() == 2) {
        if (logit_shape[1] > 4) {
            log_rows = logit_shape[0];
            class_count = logit_shape[1];
        } else if (logit_shape[0] > 4) {
            log_rows = logit_shape[1];
            class_count = logit_shape[0];
        }
    }
    if (log_rows <= 0 || class_count <= 1) return false;

    const int person_class = cfg_.person_class_id;
    if (person_class < 0 || person_class >= class_count) return false;

    const int rows = static_cast<int>(std::min(box_rows, log_rows));
    if (rows <= 0) return true;

    bool normalized = true;
    const int check_rows = std::min(rows, 32);
    for (int i = 0; i < check_rows; ++i) {
        const float bx = box_transposed ? boxes[i] : boxes[i * 4 + 0];
        const float by = box_transposed ? boxes[box_rows + i] : boxes[i * 4 + 1];
        if (std::fabs(bx) > 2.5f || std::fabs(by) > 2.5f) {
            normalized = false;
            break;
        }
    }

    out.clear();
    out.reserve(static_cast<size_t>(rows));

    for (int i = 0; i < rows; ++i) {
        const float* logit_row = logits + static_cast<size_t>(i) * static_cast<size_t>(class_count);
        const float score = sigmoidf(logit_row[person_class]);
        if (score < cfg_.conf_thresh) continue;

        float cx = 0.0f;
        float cy = 0.0f;
        float bw = 0.0f;
        float bh = 0.0f;
        if (box_transposed) {
            cx = boxes[i];
            cy = boxes[static_cast<size_t>(box_rows) + i];
            bw = boxes[static_cast<size_t>(box_rows) * 2 + i];
            bh = boxes[static_cast<size_t>(box_rows) * 3 + i];
        } else {
            const float* box_row = boxes + static_cast<size_t>(i) * 4u;
            cx = box_row[0];
            cy = box_row[1];
            bw = box_row[2];
            bh = box_row[3];
        }

        if (normalized) {
            cx *= static_cast<float>(frame_w);
            cy *= static_cast<float>(frame_h);
            bw *= static_cast<float>(frame_w);
            bh *= static_cast<float>(frame_h);
        }

        bw = std::max(0.0f, bw);
        bh = std::max(0.0f, bh);

        BBox box{
            clampf(cx - 0.5f * bw, 0.0f, static_cast<float>(frame_w)),
            clampf(cy - 0.5f * bh, 0.0f, static_cast<float>(frame_h)),
            clampf(cx + 0.5f * bw, 0.0f, static_cast<float>(frame_w)),
            clampf(cy + 0.5f * bh, 0.0f, static_cast<float>(frame_h)),
        };
        if (box.width() <= 1.0f || box.height() <= 1.0f) continue;

        Detection det;
        det.bbox = box;
        det.score = score;
        out.push_back(det);
    }

    nmsDetections(out, cfg_.nms_thresh);
    return true;
}

void PersonDetector::Detect(const FrameView& frame,
                            std::vector<Detection>& out,
                            PersonDetectTimingMs* timing) const {
    if (timing) {
        *timing = PersonDetectTimingMs{};
    }
    out.clear();
    if (!loaded_ || !session_ || !frame.isValid()) return;

    const int input_w = std::max(1, cfg_.input_width);
    const int input_h = std::max(1, cfg_.input_height);

    const auto t_pre_0 = std::chrono::steady_clock::now();
    std::vector<float> input_hwc;
    infer::ResizeRgbBilinear(frame.rgb, frame.width, frame.height, input_w, input_h, input_hwc);
    infer::NormalizeImageNetInplace(input_hwc);

    std::vector<float> input_chw;
    infer::HwcToChw(input_hwc, input_w, input_h, input_chw);

    const std::array<int64_t, 4> input_shape = {
        1,
        3,
        static_cast<int64_t>(input_h),
        static_cast<int64_t>(input_w),
    };
    Ort::Value input_tensor = Ort::Value::CreateTensor<float>(
        infer::CpuMemoryInfo(),
        input_chw.data(),
        input_chw.size(),
        input_shape.data(),
        input_shape.size());
    const auto t_pre_1 = std::chrono::steady_clock::now();
    if (timing) {
        timing->preprocess += std::chrono::duration<double, std::milli>(t_pre_1 - t_pre_0).count();
    }

    const std::array<const char*, 1> input_names = {input_name_.c_str()};
    const std::array<const char*, 2> output_names = {boxes_name_.c_str(), logits_name_.c_str()};

    try {
        const auto t_infer_0 = std::chrono::steady_clock::now();
        auto outputs = session_->Run(Ort::RunOptions{nullptr},
                                     input_names.data(),
                                     &input_tensor,
                                     input_names.size(),
                                     output_names.data(),
                                     output_names.size());
        const auto t_infer_1 = std::chrono::steady_clock::now();
        if (timing) {
            timing->infer += std::chrono::duration<double, std::milli>(t_infer_1 - t_infer_0).count();
        }

        const auto t_decode_0 = std::chrono::steady_clock::now();
        if (outputs.size() != 2 || !outputs[0].IsTensor() || !outputs[1].IsTensor()) {
            if (timing) {
                timing->decode += std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - t_decode_0).count();
            }
            return;
        }
        const auto box_info = outputs[0].GetTensorTypeAndShapeInfo();
        const auto logit_info = outputs[1].GetTensorTypeAndShapeInfo();
        const std::vector<int64_t> box_shape = box_info.GetShape();
        const std::vector<int64_t> logit_shape = logit_info.GetShape();

        if (shapeElemCount(box_shape) == 0 || shapeElemCount(logit_shape) == 0) {
            if (timing) {
                timing->decode += std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - t_decode_0).count();
            }
            return;
        }

        const float* boxes = outputs[0].GetTensorData<float>();
        const float* logits = outputs[1].GetTensorData<float>();
        if (!boxes || !logits) {
            if (timing) {
                timing->decode += std::chrono::duration<double, std::milli>(
                    std::chrono::steady_clock::now() - t_decode_0).count();
            }
            return;
        }

        decodeRfDetr(boxes, box_shape, logits, logit_shape, frame.width, frame.height, out);
        if (timing) {
            timing->decode += std::chrono::duration<double, std::milli>(
                std::chrono::steady_clock::now() - t_decode_0).count();
        }
    } catch (const Ort::Exception&) {
        out.clear();
    }
}
