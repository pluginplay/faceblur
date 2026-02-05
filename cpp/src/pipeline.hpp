#pragma once

#include "scrfd.hpp"
#include "ocsort.hpp"
#include "reid.hpp"

#include <map>
#include <memory>
#include <string>
#include <vector>

/**
 * Single frame data for a track.
 */
struct TrackFrame {
    int frame_index;
    BBox bbox;  // Normalized coordinates (0-1)
    float confidence;
};

/**
 * Complete face track across multiple frames.
 */
struct FaceTrack {
    int id;
    std::vector<TrackFrame> frames;
};

/**
 * Pipeline output result.
 */
struct PipelineResult {
    std::vector<FaceTrack> tracks;
    int frame_count;
};

/**
 * Face detection and tracking pipeline.
 * 
 * Combines SCRFD face detection with OC-SORT tracking:
 * - Sparse detection at configurable FPS (default 5fps)
 * - Kalman filter tracking interpolates between detections
 * - Outputs tracks with normalized bounding boxes
 * 
 * Usage:
 *   FacePipeline pipeline(model_dir, 0.5f, 5.0f);
 *   PipelineResult result = pipeline.process(image_paths, 30.0f);
 */
class FacePipeline {
public:
    /**
     * Initialize face pipeline.
     * 
     * @param model_dir Directory containing scrfd.param and scrfd.bin
     * @param conf_thresh Face detection confidence threshold (default: 0.5)
     * @param detection_fps FPS for sparse face detection (default: 5.0)
     * @param iou_thresh IoU threshold for tracking (default: 0.15)
     */
    FacePipeline(const std::string& model_dir,
                 float conf_thresh = 0.5f,
                 float detection_fps = 5.0f,
                 float iou_thresh = 0.15f,
                 const std::string& reid_model_dir = "",
                 float reid_weight = 0.35f,
                 float reid_cos_thresh = 0.35f);
    
    /**
     * Check if pipeline is ready (model loaded successfully).
     */
    bool isLoaded() const { return detector_.IsLoaded(); }
    
    /**
     * Process a list of image frames.
     * 
     * @param image_paths List of paths to frame images
     * @param video_fps Source video FPS (for sparse detection stride calculation)
     * @return PipelineResult containing all face tracks
     */
    PipelineResult process(const std::vector<std::string>& image_paths,
                           float video_fps = 30.0f);
    
    /**
     * Detect faces in a single image.
     * 
     * @param image_path Path to image file
     * @param width Output: image width
     * @param height Output: image height
     * @return List of detected faces as normalized detections (bbox + score)
     */
    std::vector<Detection> detectSingle(const std::string& image_path,
                                        int& width, int& height);

private:
    ScrfdDetector detector_;
    float conf_thresh_;
    float detection_fps_;
    float iou_thresh_;

    std::unique_ptr<MobileFaceNetReid> reid_;
    bool use_reid_ = false;
    float reid_weight_ = 0.35f;
    float reid_cos_thresh_ = 0.35f;
    
    /**
     * Convert ScrfdFace to BBox with normalized coordinates.
     */
    static BBox scrfdToBBox(const ScrfdFace& face, int width, int height);
};
