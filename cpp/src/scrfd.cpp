#include "scrfd.hpp"

#include <algorithm>
#include <cmath>

// Strides used by SCRFD
static const int STRIDES[] = {8, 16, 32};
static const int NUM_ANCHORS = 2;

// Helper: compute IoU between two boxes
static float ComputeIoU(const std::array<float, 4>& a, const std::array<float, 4>& b) {
    float x1 = std::max(a[0], b[0]);
    float y1 = std::max(a[1], b[1]);
    float x2 = std::min(a[2], b[2]);
    float y2 = std::min(a[3], b[3]);

    float inter_w = std::max(0.0f, x2 - x1);
    float inter_h = std::max(0.0f, y2 - y1);
    float inter_area = inter_w * inter_h;

    float area_a = (a[2] - a[0]) * (a[3] - a[1]);
    float area_b = (b[2] - b[0]) * (b[3] - b[1]);

    return inter_area / (area_a + area_b - inter_area + 1e-6f);
}

// Helper: NMS
static std::vector<int> NMS(const std::vector<ScrfdFace>& faces, float threshold) {
    std::vector<int> indices(faces.size());
    for (size_t i = 0; i < faces.size(); ++i) indices[i] = static_cast<int>(i);

    // Sort by score descending
    std::sort(indices.begin(), indices.end(), [&faces](int a, int b) {
        return faces[a].score > faces[b].score;
    });

    std::vector<int> keep;
    std::vector<bool> suppressed(faces.size(), false);

    for (int idx : indices) {
        if (suppressed[idx]) continue;
        keep.push_back(idx);

        for (int other : indices) {
            if (suppressed[other] || other == idx) continue;
            if (ComputeIoU(faces[idx].bbox, faces[other].bbox) > threshold) {
                suppressed[other] = true;
            }
        }
    }

    return keep;
}

ScrfdDetector::ScrfdDetector(const std::string& param_path,
                             const std::string& bin_path,
                             int input_width,
                             int input_height,
                             float conf_thresh,
                             float nms_thresh)
    : input_width_(input_width),
      input_height_(input_height),
      conf_thresh_(conf_thresh),
      nms_thresh_(nms_thresh),
      loaded_(false) {
    
    int ret = net_.load_param(param_path.c_str());
    if (ret != 0) return;

    ret = net_.load_model(bin_path.c_str());
    if (ret != 0) return;

    loaded_ = true;
}

bool ScrfdDetector::IsLoaded() const {
    return loaded_;
}

std::vector<ScrfdFace> ScrfdDetector::Detect(const unsigned char* rgb,
                                              int width,
                                              int height) const {
    std::vector<ScrfdFace> faces;
    if (!loaded_) return faces;

    // Compute resize factor (letterbox style)
    float scale = std::min(static_cast<float>(input_width_) / width,
                           static_cast<float>(input_height_) / height);
    int new_w = static_cast<int>(width * scale);
    int new_h = static_cast<int>(height * scale);

    // Create input mat from RGB, resize to target
    ncnn::Mat in = ncnn::Mat::from_pixels_resize(rgb, ncnn::Mat::PIXEL_RGB, width, height, new_w, new_h);

    // Pad to input_width_ x input_height_ with letterbox
    int wpad = input_width_ - new_w;
    int hpad = input_height_ - new_h;
    ncnn::Mat in_pad;
    ncnn::copy_make_border(in, in_pad, 0, hpad, 0, wpad, ncnn::BORDER_CONSTANT, 0.f);

    // Normalize: (pixel - 127.5) / 127.5
    const float mean_vals[3] = {127.5f, 127.5f, 127.5f};
    const float norm_vals[3] = {1.0f / 127.5f, 1.0f / 127.5f, 1.0f / 127.5f};
    in_pad.substract_mean_normalize(mean_vals, norm_vals);

    // Run inference
    ncnn::Extractor ex = net_.create_extractor();
    ex.set_light_mode(true);
    ex.input("input.1", in_pad);

    // Extract outputs for each stride
    const char* score_names[] = {"score_8", "score_16", "score_32"};
    const char* bbox_names[] = {"bbox_8", "bbox_16", "bbox_32"};
    const char* kps_names[] = {"kps_8", "kps_16", "kps_32"};

    std::vector<ScrfdFace> all_faces;

    for (int s = 0; s < 3; ++s) {
        int stride = STRIDES[s];
        
        ncnn::Mat score_blob, bbox_blob, kps_blob;
        ex.extract(score_names[s], score_blob);
        ex.extract(bbox_names[s], bbox_blob);
        ex.extract(kps_names[s], kps_blob);

        int fm_h = score_blob.h;
        int fm_w = score_blob.w;

        // Process each anchor position
        // Model layout: score_blob [num_anchors, h, w], bbox_blob [num_anchors*4, h, w], kps_blob [num_anchors*10, h, w]
        for (int q = 0; q < NUM_ANCHORS; ++q) {
            const ncnn::Mat score = score_blob.channel(q);
            
            for (int y = 0; y < fm_h; ++y) {
                for (int x = 0; x < fm_w; ++x) {
                    int index = y * fm_w + x;
                    float prob = score[index];
                    
                    if (prob < conf_thresh_) continue;

                    // Anchor center
                    float cx = (x + 0.5f) * stride;
                    float cy = (y + 0.5f) * stride;

                    // Decode bbox using distance format (left, top, right, bottom from anchor)
                    // bbox_blob layout: [num_anchors*4, h, w] where channels are [dx, dy, dw, dh] per anchor
                    float dx = bbox_blob.channel(q * 4 + 0)[index] * stride;
                    float dy = bbox_blob.channel(q * 4 + 1)[index] * stride;
                    float dw = bbox_blob.channel(q * 4 + 2)[index] * stride;
                    float dh = bbox_blob.channel(q * 4 + 3)[index] * stride;

                    float x1 = (cx - dx) / scale;
                    float y1 = (cy - dy) / scale;
                    float x2 = (cx + dw) / scale;
                    float y2 = (cy + dh) / scale;

                    // Clamp to image bounds
                    x1 = std::max(0.0f, std::min(x1, static_cast<float>(width)));
                    y1 = std::max(0.0f, std::min(y1, static_cast<float>(height)));
                    x2 = std::max(0.0f, std::min(x2, static_cast<float>(width)));
                    y2 = std::max(0.0f, std::min(y2, static_cast<float>(height)));

                    ScrfdFace face;
                    face.bbox = {x1, y1, x2, y2};
                    face.score = prob;

                    // Decode keypoints (5 points, 2 coords each)
                    // kps_blob layout: [num_anchors*10, h, w]
                    for (int k = 0; k < 5; ++k) {
                        float kp_x = (cx + kps_blob.channel(q * 10 + k * 2)[index] * stride) / scale;
                        float kp_y = (cy + kps_blob.channel(q * 10 + k * 2 + 1)[index] * stride) / scale;
                        face.landmarks[k] = {kp_x, kp_y};
                    }

                    all_faces.push_back(face);
                }
            }
        }
    }

    // Apply NMS
    std::vector<int> keep = NMS(all_faces, nms_thresh_);
    
    faces.reserve(keep.size());
    for (int idx : keep) {
        faces.push_back(all_faces[idx]);
    }

    // Sort by score descending
    std::sort(faces.begin(), faces.end(), [](const ScrfdFace& a, const ScrfdFace& b) {
        return a.score > b.score;
    });

    return faces;
}
