#pragma once

#include <string>

struct PersonDetectionConfig {
    std::string model_dir;
    float conf_thresh = 0.5f;
    float nms_thresh = 0.4f;
    float detection_fps = 5.0f;
    int input_width = 512;
    int input_height = 512;
    int person_class_id = 1;
    int num_threads = 0;  // 0 = auto
};

struct FaceDetectionConfig {
    std::string model_dir;
    float conf_thresh = 0.5f;
    float nms_thresh = 0.4f;
    int num_threads = 0;  // 0 = auto
};

struct TrackerConfig {
    float iou_thresh = 0.15f;
    float rescue_iou_thresh = 0.05f;
    float assoc_max_center_dist = 1.25f;
    float assoc_max_area_ratio = 4.0f;
    float assoc_dist_weight = 0.08f;
    float assoc_area_weight = 0.04f;
    int max_return_pred_age = 15;
    int max_age = 90;
    int min_hits = 1;
    int delta_t = 3;
    float inertia = 0.2f;
};

struct BodyReidConfig {
    bool enabled = false;
    std::string model_dir;
    float weight = 0.35f;
    float cos_thresh = 0.35f;
    float min_det_conf = 0.0f;
    float min_bbox_px = 0.0f;
    int num_threads = 0;  // 0 = auto
};

struct AssociationConfig {
    float face_person_iou_thresh = 0.5f;
    float face_person_overlap_thresh = 0.7f;
    bool require_face_center_in_person = true;
    int temporal_memory_frames = 4;
    float temporal_bonus = 0.10f;
    float switch_penalty = 0.08f;
    float switch_margin = 0.05f;
    float track_iou_gate = 0.20f;
};

// Backward-compat aliases for legacy modules not used in v1 path.
using DetectionConfig = PersonDetectionConfig;
using ReidConfig = BodyReidConfig;

struct GmcConfig {
    enum class Model { Similarity, Homography };
    bool enabled = true;
    int downscale = 4;
    Model model = Model::Similarity;
    float gmc_fps = 0.0f;  // 0 = follow detection_fps or video_fps
    bool enable_sanity_gate = true;
    float max_translation_frac = 0.10f;
    float max_scale_deviation = 0.25f;
    float max_rotation_deg = 20.0f;
};

struct LinkingConfig {
    bool enabled = true;
    float short_gap_sec = 2.0f;
    float long_gap_sec = 10.0f;
    float max_center_dist = 2.0f;
    float max_area_ratio = 4.0f;
    int long_gap_min_conf_frames = 6;
    float long_gap_min_sim = 0.50f;
};

struct OutputConfig {
    bool normalize_output = true;
    int min_track_frames = 10;
    int min_conf_frames = 3;
    float min_conf_frac = 0.15f;
    float span_conf_floor = 0.20f;
    float span_conf_scale = 0.60f;
    float min_output_conf = 0.05f;
    float min_bbox_frac = 0.01f;
};

struct PipelineConfig {
    PersonDetectionConfig person_detection;
    FaceDetectionConfig face_detection;
    BodyReidConfig body_reid;
    AssociationConfig association;
    TrackerConfig tracker;
    GmcConfig gmc;
    LinkingConfig linking;
    OutputConfig output;
};
