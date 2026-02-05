#pragma once

#include <array>
#include <map>
#include <optional>
#include <vector>

#include "transform.hpp"

/**
 * Simple matrix class for Kalman filter operations.
 * Uses row-major storage for small fixed-size matrices.
 */
class Matrix {
public:
    Matrix(int rows, int cols);
    Matrix(int rows, int cols, const std::vector<float>& data);
    
    int rows() const { return rows_; }
    int cols() const { return cols_; }
    
    float& operator()(int r, int c);
    float operator()(int r, int c) const;
    
    Matrix operator+(const Matrix& other) const;
    Matrix operator-(const Matrix& other) const;
    Matrix operator*(const Matrix& other) const;
    Matrix operator*(float scalar) const;
    
    Matrix transpose() const;
    Matrix inverse() const;  // For small matrices (up to 7x7)
    
    void setIdentity();
    void setZero();
    
    // Get/set column vector
    std::vector<float> getCol(int c) const;
    void setCol(int c, const std::vector<float>& v);

private:
    int rows_, cols_;
    std::vector<float> data_;
};

/**
 * Bounding box representation for tracking.
 */
struct BBox {
    float x1, y1, x2, y2;  // Coordinates (can be normalized or absolute)
    
    float width() const { return x2 - x1; }
    float height() const { return y2 - y1; }
    float centerX() const { return (x1 + x2) / 2.0f; }
    float centerY() const { return (y1 + y2) / 2.0f; }
    float area() const { return width() * height(); }
    
    // IoU calculation
    float iou(const BBox& other) const;
};

/**
 * A detection input for tracking (bbox + confidence).
 *
 * Notes:
 * - `bbox` is geometry only (x1,y1,x2,y2)
 * - `score` is used to weight OCM costs and output confidence
 */
struct Detection {
    BBox bbox;
    float score = 1.0f;

    // Optional appearance embedding for ReID-enabled association.
    // MobileFaceNet ArcFace checkpoint in this repo outputs 128-D.
    static constexpr int kReidDim = 128;
    std::array<float, kReidDim> reid{};
    bool has_reid = false;
    float reid_quality = 0.0f;  // [0,1], used to keep only high-quality samples
};

/**
 * Kalman filter-based single object tracker.
 * 
 * Uses a 7-state constant velocity model:
 *   State: [x, y, s, r, vx, vy, vs]
 *   where (x, y) = bbox center, s = area (scale), r = aspect ratio
 *         vx, vy, vs = velocities
 * 
 * Measurement: [x, y, s, r]
 */
class KalmanBoxTracker {
public:
    KalmanBoxTracker(const Detection& det, int track_id, int delta_t = 3);
    
    /**
     * Predict next state.
     * @return Predicted bounding box
     */
    BBox predict();
    
    /**
     * Update state with a detection (or no observation).
     *
     * This is called once per frame after `predict()`, even when
     * there is no matched detection (pass `std::nullopt`).
     */
    void update(const std::optional<Detection>& det);
    
    /**
     * Get current state as bounding box.
     */
    BBox getState() const;

    /**
     * Apply a global warp (prev -> curr) to the track state.
     *
     * Intended for Global Motion Compensation (GMC) in MOT pipelines.
     * `frame_width/height` are the pixel dimensions of the current frame.
     */
    void applyWarp(const Mat3f& warp, int frame_width, int frame_height);
    
    int trackId() const { return track_id_; }
    int timeSinceUpdate() const { return time_since_update_; }
    int hits() const { return hits_; }
    int hitStreak() const { return hit_streak_; }
    int age() const { return age_; }
    
    /**
     * Last observed detection (if any).
     *
     * When not observed yet, returns `std::nullopt`.
     */
    const std::optional<Detection>& lastObservation() const { return last_observation_; }

    bool hasAppearance() const { return has_appearance_; }
    const std::array<float, Detection::kReidDim>& appearance() const { return appearance_; }

    /**
     * Track inertia direction as (dy, dx) unit vector.
     *
     * Matches official OC-SORT convention: `velocity = [dy, dx]`.
     * Returns (0,0) if unavailable.
     */
    std::array<float, 2> velocityDir() const;

    /**
     * Return an observation from `k` steps ago (or last available).
     *
     * Used for OCM to compute observation-centric direction.
     * If no observations exist, returns placeholder with score < 0.
     */
    Detection kPreviousObservation(int k) const;

private:
    int track_id_;
    int time_since_update_;
    int hits_;
    int hit_streak_;
    int age_;
    int delta_t_;
    
    // Kalman filter matrices
    Matrix x_;  // State vector (7x1)
    Matrix P_;  // State covariance (7x7)
    Matrix F_;  // State transition matrix (7x7)
    Matrix H_;  // Measurement matrix (4x7)
    Matrix Q_;  // Process noise covariance (7x7)
    Matrix R_;  // Measurement noise covariance (4x4)
    
    // OC-SORT observation state
    std::optional<Detection> last_observation_;          // bbox + score
    std::map<int, Detection> observations_by_age_;       // key: age_
    std::optional<std::array<float, 2>> velocity_dir_;   // (dy, dx) unit vector

    // Appearance (ReID) state (L2-normalized). Updated with EMA on matched detections.
    std::array<float, Detection::kReidDim> appearance_{};
    bool has_appearance_ = false;

    // Keep only a tiny bank of high-quality appearance samples.
    static constexpr int kAppearanceBankK = 5;
    std::array<std::array<float, Detection::kReidDim>, kAppearanceBankK> appearance_bank_{};
    std::array<float, kAppearanceBankK> appearance_bank_q_{};
    int appearance_bank_size_ = 0;

    // ORU: history of measurements (per-frame), for gap detection
    using Measurement = std::array<float, 4>;  // [x, y, s, r]
    std::vector<std::optional<Measurement>> oru_history_;
    bool oru_observed_ = true;
    std::optional<Matrix> oru_saved_x_;
    std::optional<Matrix> oru_saved_P_;
    std::optional<int> oru_saved_age_;

    // Internal KF predict/update helpers (do not touch counters)
    void predictKF();
    void updateKF(const Measurement& z_arr);
    void maybeRunORU(const Measurement& current_meas);
    
    // Convert between bbox and state representation
    static Measurement bboxToMeasurement(const BBox& bbox);
    static BBox measurementToBbox(const Measurement& z);

    // Helpers for ORU virtual trajectory interpolation
    static void measurementToXYWH(const Measurement& z, float& x, float& y, float& w, float& h);
    static Measurement xywhToMeasurement(float x, float y, float w, float h);
    static std::array<float, 2> speedDirection(const BBox& from, const BBox& to);
};
