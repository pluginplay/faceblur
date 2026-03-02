#pragma once

#include <algorithm>
#include <array>
#include <vector>

/**
 * Bounding box representation for tracking.
 * Coordinates are in pixel space unless explicitly normalized at output.
 */
struct BBox {
    float x1 = 0.0f;
    float y1 = 0.0f;
    float x2 = 0.0f;
    float y2 = 0.0f;

    float width() const { return x2 - x1; }
    float height() const { return y2 - y1; }
    float centerX() const { return (x1 + x2) / 2.0f; }
    float centerY() const { return (y1 + y2) / 2.0f; }
    float area() const { return width() * height(); }

    float iou(const BBox& other) const {
        const float ix1 = (x1 > other.x1) ? x1 : other.x1;
        const float iy1 = (y1 > other.y1) ? y1 : other.y1;
        const float ix2 = (x2 < other.x2) ? x2 : other.x2;
        const float iy2 = (y2 < other.y2) ? y2 : other.y2;
        if (ix2 < ix1 || iy2 < iy1) return 0.0f;
        const float intersection = (ix2 - ix1) * (iy2 - iy1);
        const float union_area = area() + other.area() - intersection;
        return union_area > 0.0f ? (intersection / union_area) : 0.0f;
    }
};

/**
 * A detection input for tracking (bbox + confidence + optional appearance).
 */
struct Detection {
    BBox bbox;
    float score = 1.0f;

    static constexpr int kReidDim = 512;
    std::array<float, kReidDim> reid{};
    bool has_reid = false;
    float reid_quality = 0.0f;  // [0,1]
};

/**
 * Face detection output on one frame.
 */
struct FaceDetection {
    BBox bbox;
    float score = 0.0f;
    static constexpr int kLandmarkCount = 5;
    std::array<std::array<float, 2>, kLandmarkCount> landmarks{};
    bool has_landmarks = false;
};

/**
 * Single frame data for a person track.
 */
struct TrackFrame {
    int frame_index = 0;
    BBox bbox;  // pixel coordinates
    float confidence = 0.0f;
};

/**
 * Single face keyframe associated to a person track.
 */
struct FaceKeyframe {
    int frame_index = 0;
    BBox bbox;  // pixel coordinates
    float confidence = 0.0f;
    float assoc_iou = 0.0f;
};

/**
 * Complete person track across multiple frames.
 */
struct PersonTrack {
    int id = -1;
    std::vector<TrackFrame> frames;
};

/**
 * Complete face keyframe sequence associated with one person track.
 */
struct FaceTrack {
    int person_id = -1;
    std::vector<FaceKeyframe> frames;
};

struct PipelineTimingMs {
    double person_detect = 0.0;
    double person_preprocess = 0.0;
    double person_infer = 0.0;
    double person_decode = 0.0;
    double body_reid = 0.0;
    double face_detect = 0.0;
    double associate = 0.0;
    double track_update = 0.0;
};

struct PersonFaceCoverage {
    int person_id = -1;
    int person_frames = 0;
    int face_frames = 0;
    int blink_gaps = 0;
    int longest_blink_gap = 0;
    float coverage = 0.0f;
};

struct PipelineQualityMetrics {
    int duplicate_overlap_frames = 0;
    int person_present_no_face_frames = 0;
    int longest_person_present_no_face_run = 0;
    int predicted_track_frames = 0;
    int total_track_frames = 0;
    int estimated_switch_breakpoints = 0;
    int gmc_rejected_frames = 0;
    int adaptive_detection_frames = 0;
    std::vector<PersonFaceCoverage> person_face_coverage;
};

struct PipelineStats {
    int person_detections = 0;
    int face_detections = 0;
    int associated_faces = 0;
    int unassociated_faces = 0;
    PipelineTimingMs timing_ms{};
    PipelineQualityMetrics quality{};
};

/**
 * Pipeline output result.
 */
struct PipelineResult {
    std::vector<PersonTrack> people;
    std::vector<FaceTrack> face_tracks;
    int frame_count = 0;
    PipelineStats stats{};
};

using Appearance = std::array<float, Detection::kReidDim>;
