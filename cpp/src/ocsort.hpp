#pragma once

#include "kalman_filter.hpp"
#include "hungarian.hpp"

#include <map>
#include <memory>
#include <vector>

/**
 * Result for a single tracked object.
 */
struct TrackResult {
    BBox bbox;
    float confidence;
};

/**
 * OC-SORT: Observation-Centric SORT multi-object tracker.
 * 
 * Implements OC-SORT (Cao et al., CVPR 2023) with:
 * - Kalman filter motion prediction
 * - Hungarian algorithm for optimal assignment
 * - Observation-Centric Re-Update (ORU) for occlusion recovery
 * - Observation-Centric Momentum (OCM) in association cost
 * - Observation-Centric Recovery (OCR) second-pass association
 * 
 * Usage:
 *   OCSort tracker(0.3f, 30, 3);
 *   for each frame:
 *     auto tracks = tracker.update(detections);
 *     // tracks[track_id] = {bbox, confidence}
 */
class OCSort {
public:
    /**
     * Initialize OC-SORT tracker.
     * 
     * @param iou_thresh Minimum IoU for matching detections to tracks (default: 0.15)
     * @param max_age Maximum frames a track can be missing before deletion (default: 30)
     * @param min_hits Minimum detections before track is confirmed (default: 3)
     * @param delta_t Number of past observations for ORU lookback window (default: 3)
     * @param inertia OCM velocity-direction-consistency weight (default: 0.2)
     */
    OCSort(float iou_thresh = 0.3f,
           int max_age = 30,
           int min_hits = 3,
           int delta_t = 3,
           float inertia = 0.2f,
           bool use_reid = false,
           float reid_weight = 0.35f,
           float reid_cos_thresh = 0.35f);
    
    /**
     * Update tracker with new detections.
     * 
     * @param detections List of detected bounding boxes (+ scores) for current frame
     * @param return_all If true, return all confirmed tracks including those not updated this frame
     * @param warp_prev_to_curr Optional global warp (prev -> curr) for GMC
     * @param frame_width Pixel width of current frame (required if warp provided)
     * @param frame_height Pixel height of current frame (required if warp provided)
     * @return Map of track_id -> TrackResult for confirmed tracks
     */
    std::map<int, TrackResult> update(const std::vector<Detection>& detections,
                                       bool return_all = false,
                                       const Mat3f* warp_prev_to_curr = nullptr,
                                       int frame_width = 0,
                                       int frame_height = 0);
    
    /**
     * Reset tracker state (call at scene boundaries).
     */
    void reset();
    
    /**
     * Get current number of active trackers.
     */
    size_t numTrackers() const { return trackers_.size(); }

    // Appearance summaries for offline tracklet linking.
    using AppearanceMap = std::map<int, std::array<float, Detection::kReidDim>>;
    AppearanceMap takeFinishedAppearances();     // drains
    AppearanceMap getActiveAppearances() const;  // snapshot

private:
    float iou_thresh_;
    int max_age_;
    int min_hits_;
    int delta_t_;
    float inertia_;

    // Optional appearance (ReID) association.
    bool use_reid_ = false;
    float reid_weight_ = 0.35f;       // how much to trust appearance vs motion/IoU
    float reid_cos_thresh_ = 0.35f;   // cosine similarity gate for low-IoU matches
    
    std::vector<std::unique_ptr<KalmanBoxTracker>> trackers_;
    int next_id_ = 0;
    int frame_count_ = 0;

    AppearanceMap finished_appearances_;
    
    HungarianAlgorithm hungarian_;
    
    /**
     * Associate detections to trackers using Hungarian algorithm.
     * 
     * @param detections List of detected bounding boxes
     * @param matched_indices Output: pairs of (detection_idx, tracker_idx)
     * @param unmatched_detections Output: indices of unmatched detections
     */
    void associate(const std::vector<Detection>& detections,
                   std::vector<std::pair<int, int>>& matched_indices,
                   std::vector<int>& unmatched_detections,
                   std::vector<int>& unmatched_trackers);

    void associateOCR(const std::vector<Detection>& detections,
                      std::vector<std::pair<int, int>>& matched_indices,
                      std::vector<int>& unmatched_detections,
                      std::vector<int>& unmatched_trackers);
};
