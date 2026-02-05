#include "kalman_filter.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace {
inline void l2_normalize(std::array<float, Detection::kReidDim>& v) {
    double ss = 0.0;
    for (float x : v) ss += static_cast<double>(x) * static_cast<double>(x);
    const double inv = 1.0 / (std::sqrt(ss) + 1e-12);
    for (float& x : v) x = static_cast<float>(static_cast<double>(x) * inv);
}

constexpr float kMinReidUpdateQuality = 0.40f;

inline void warp_point_px(const Mat3f& M, float x, float y, float& ox, float& oy) {
    const float nx = M(0, 0) * x + M(0, 1) * y + M(0, 2);
    const float ny = M(1, 0) * x + M(1, 1) * y + M(1, 2);
    const float d  = M(2, 0) * x + M(2, 1) * y + M(2, 2);
    if (std::abs(d) < 1e-6f) {
        ox = nx;
        oy = ny;
        return;
    }
    ox = nx / d;
    oy = ny / d;
}

inline BBox warp_bbox_norm(const BBox& b_norm, const Mat3f& M, int w, int h) {
    if (w <= 0 || h <= 0) return b_norm;

    const float x1 = b_norm.x1 * static_cast<float>(w);
    const float y1 = b_norm.y1 * static_cast<float>(h);
    const float x2 = b_norm.x2 * static_cast<float>(w);
    const float y2 = b_norm.y2 * static_cast<float>(h);

    float px[4], py[4];
    warp_point_px(M, x1, y1, px[0], py[0]);
    warp_point_px(M, x2, y1, px[1], py[1]);
    warp_point_px(M, x2, y2, px[2], py[2]);
    warp_point_px(M, x1, y2, px[3], py[3]);

    float minx = px[0], maxx = px[0];
    float miny = py[0], maxy = py[0];
    for (int i = 1; i < 4; ++i) {
        minx = std::min(minx, px[i]);
        maxx = std::max(maxx, px[i]);
        miny = std::min(miny, py[i]);
        maxy = std::max(maxy, py[i]);
    }

    // Ensure non-degenerate ordering.
    if (maxx < minx) std::swap(maxx, minx);
    if (maxy < miny) std::swap(maxy, miny);

    const float inv_w = 1.0f / static_cast<float>(w);
    const float inv_h = 1.0f / static_cast<float>(h);
    return BBox{minx * inv_w, miny * inv_h, maxx * inv_w, maxy * inv_h};
}
}  // namespace

// =============================================================================
// Matrix Implementation
// =============================================================================

Matrix::Matrix(int rows, int cols)
    : rows_(rows), cols_(cols), data_(rows * cols, 0.0f) {}

Matrix::Matrix(int rows, int cols, const std::vector<float>& data)
    : rows_(rows), cols_(cols), data_(data) {
    if (static_cast<int>(data.size()) != rows * cols) {
        throw std::invalid_argument("Matrix data size mismatch");
    }
}

float& Matrix::operator()(int r, int c) {
    return data_[r * cols_ + c];
}

float Matrix::operator()(int r, int c) const {
    return data_[r * cols_ + c];
}

Matrix Matrix::operator+(const Matrix& other) const {
    if (rows_ != other.rows_ || cols_ != other.cols_) {
        throw std::invalid_argument("Matrix dimensions mismatch for addition");
    }
    Matrix result(rows_, cols_);
    for (int i = 0; i < rows_ * cols_; ++i) {
        result.data_[i] = data_[i] + other.data_[i];
    }
    return result;
}

Matrix Matrix::operator-(const Matrix& other) const {
    if (rows_ != other.rows_ || cols_ != other.cols_) {
        throw std::invalid_argument("Matrix dimensions mismatch for subtraction");
    }
    Matrix result(rows_, cols_);
    for (int i = 0; i < rows_ * cols_; ++i) {
        result.data_[i] = data_[i] - other.data_[i];
    }
    return result;
}

Matrix Matrix::operator*(const Matrix& other) const {
    if (cols_ != other.rows_) {
        throw std::invalid_argument("Matrix dimensions mismatch for multiplication");
    }
    Matrix result(rows_, other.cols_);
    for (int i = 0; i < rows_; ++i) {
        for (int j = 0; j < other.cols_; ++j) {
            float sum = 0.0f;
            for (int k = 0; k < cols_; ++k) {
                sum += (*this)(i, k) * other(k, j);
            }
            result(i, j) = sum;
        }
    }
    return result;
}

Matrix Matrix::operator*(float scalar) const {
    Matrix result(rows_, cols_);
    for (int i = 0; i < rows_ * cols_; ++i) {
        result.data_[i] = data_[i] * scalar;
    }
    return result;
}

Matrix Matrix::transpose() const {
    Matrix result(cols_, rows_);
    for (int i = 0; i < rows_; ++i) {
        for (int j = 0; j < cols_; ++j) {
            result(j, i) = (*this)(i, j);
        }
    }
    return result;
}

void Matrix::setIdentity() {
    setZero();
    int n = std::min(rows_, cols_);
    for (int i = 0; i < n; ++i) {
        (*this)(i, i) = 1.0f;
    }
}

void Matrix::setZero() {
    std::fill(data_.begin(), data_.end(), 0.0f);
}

std::vector<float> Matrix::getCol(int c) const {
    std::vector<float> col(rows_);
    for (int i = 0; i < rows_; ++i) {
        col[i] = (*this)(i, c);
    }
    return col;
}

void Matrix::setCol(int c, const std::vector<float>& v) {
    for (int i = 0; i < rows_ && i < static_cast<int>(v.size()); ++i) {
        (*this)(i, c) = v[i];
    }
}

// Gauss-Jordan elimination for matrix inverse (works for small matrices)
Matrix Matrix::inverse() const {
    if (rows_ != cols_) {
        throw std::invalid_argument("Cannot invert non-square matrix");
    }
    
    int n = rows_;
    Matrix aug(n, 2 * n);
    
    // Create augmented matrix [A | I]
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j) {
            aug(i, j) = (*this)(i, j);
        }
        aug(i, n + i) = 1.0f;
    }
    
    // Forward elimination with partial pivoting
    for (int col = 0; col < n; ++col) {
        // Find pivot
        int maxRow = col;
        float maxVal = std::abs(aug(col, col));
        for (int row = col + 1; row < n; ++row) {
            if (std::abs(aug(row, col)) > maxVal) {
                maxVal = std::abs(aug(row, col));
                maxRow = row;
            }
        }
        
        // Swap rows
        if (maxRow != col) {
            for (int j = 0; j < 2 * n; ++j) {
                std::swap(aug(col, j), aug(maxRow, j));
            }
        }
        
        // Check for singular matrix
        float pivot = aug(col, col);
        if (std::abs(pivot) < 1e-10f) {
            // Near-singular matrix, add small regularization
            pivot = 1e-6f;
            aug(col, col) = pivot;
        }
        
        // Scale pivot row
        for (int j = 0; j < 2 * n; ++j) {
            aug(col, j) /= pivot;
        }
        
        // Eliminate column
        for (int row = 0; row < n; ++row) {
            if (row != col) {
                float factor = aug(row, col);
                for (int j = 0; j < 2 * n; ++j) {
                    aug(row, j) -= factor * aug(col, j);
                }
            }
        }
    }
    
    // Extract inverse from right half
    Matrix inv(n, n);
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j) {
            inv(i, j) = aug(i, n + j);
        }
    }
    
    return inv;
}

// =============================================================================
// BBox Implementation
// =============================================================================

float BBox::iou(const BBox& other) const {
    float ix1 = std::max(x1, other.x1);
    float iy1 = std::max(y1, other.y1);
    float ix2 = std::min(x2, other.x2);
    float iy2 = std::min(y2, other.y2);
    
    if (ix2 < ix1 || iy2 < iy1) {
        return 0.0f;
    }
    
    float intersection = (ix2 - ix1) * (iy2 - iy1);
    float union_area = area() + other.area() - intersection;
    
    return union_area > 0 ? intersection / union_area : 0.0f;
}

// =============================================================================
// KalmanBoxTracker Implementation
// =============================================================================

KalmanBoxTracker::KalmanBoxTracker(const Detection& det, int track_id, int delta_t)
    : track_id_(track_id),
      time_since_update_(0),
      hits_(1),
      hit_streak_(1),
      age_(0),
      delta_t_(delta_t),
      x_(7, 1),
      P_(7, 7),
      F_(7, 7),
      H_(4, 7),
      Q_(7, 7),
      R_(4, 4) {
    
    // Initialize state from bbox [x, y, s, r, vx, vy, vs]
    auto z = bboxToMeasurement(det.bbox);
    x_(0, 0) = z[0];  // x (center)
    x_(1, 0) = z[1];  // y (center)
    x_(2, 0) = z[2];  // s (area)
    x_(3, 0) = z[3];  // r (aspect ratio)
    x_(4, 0) = 0.0f;  // vx
    x_(5, 0) = 0.0f;  // vy
    x_(6, 0) = 0.0f;  // vs
    
    // State transition matrix F (constant velocity model)
    // x' = x + vx, y' = y + vy, s' = s + vs, r' = r
    F_.setIdentity();
    F_(0, 4) = 1.0f;  // x += vx
    F_(1, 5) = 1.0f;  // y += vy
    F_(2, 6) = 1.0f;  // s += vs
    
    // Measurement matrix H (observe x, y, s, r)
    H_.setZero();
    H_(0, 0) = 1.0f;
    H_(1, 1) = 1.0f;
    H_(2, 2) = 1.0f;
    H_(3, 3) = 1.0f;
    
    // Process noise covariance Q (SORT / OC-SORT defaults)
    // Matches official: Q[-1,-1]*=0.01; Q[4:,4:]*=0.01
    Q_.setIdentity();
    Q_(6, 6) *= 0.01f;
    Q_(4, 4) *= 0.01f;
    Q_(5, 5) *= 0.01f;
    Q_(6, 6) *= 0.01f;  // applied twice as in the official implementation
    
    // Measurement noise covariance R (SORT / OC-SORT defaults)
    // Matches official: R[2:,2:] *= 10
    R_.setIdentity();
    R_(2, 2) *= 10.0f;
    R_(3, 3) *= 10.0f;
    
    // Initial state covariance P (SORT / OC-SORT defaults)
    // Matches official: P[4:,4:] *= 1000; P *= 10
    P_.setIdentity();
    P_(4, 4) *= 1000.0f;
    P_(5, 5) *= 1000.0f;
    P_(6, 6) *= 1000.0f;
    for (int i = 0; i < 7; ++i) {
        P_(i, i) *= 10.0f;
    }

    // OC-SORT observation state
    last_observation_ = det;
    observations_by_age_[age_] = det;
    velocity_dir_.reset();

    if (det.has_reid && det.reid_quality >= kMinReidUpdateQuality) {
        // Seed appearance bank with the first high-quality sample.
        appearance_bank_[0] = det.reid;
        l2_normalize(appearance_bank_[0]);
        appearance_bank_q_[0] = std::max(0.0f, det.reid_quality);
        appearance_bank_size_ = 1;
        appearance_ = appearance_bank_[0];
        has_appearance_ = true;
    }

    // ORU history starts with the initial observation
    oru_history_.push_back(z);
    oru_observed_ = true;
    oru_saved_x_ = x_;
    oru_saved_P_ = P_;
    oru_saved_age_ = age_;
}

BBox KalmanBoxTracker::predict() {
    predictKF();
    age_++;
    if (time_since_update_ > 0) {
        hit_streak_ = 0;
    }
    time_since_update_++;
    
    return getState();
}

void KalmanBoxTracker::update(const std::optional<Detection>& det) {
    if (!det.has_value()) {
        // No observation this frame (unmatched track)
        oru_history_.push_back(std::nullopt);
        oru_observed_ = false;
        return;
    }

    // Observation present
    const Detection& d = *det;
    Measurement z_arr = bboxToMeasurement(d.bbox);
    oru_history_.push_back(z_arr);

    if (!oru_observed_) {
        // Track was unobserved; re-activation triggers ORU
        maybeRunORU(z_arr);
    }

    // Compute inertia direction (dy, dx) using observations delta_t steps apart
    if (last_observation_.has_value() && last_observation_->score >= 0.0f) {
        Detection prev = *last_observation_;
        for (int i = 0; i < delta_t_; ++i) {
            int dt = delta_t_ - i;
            auto it = observations_by_age_.find(age_ - dt);
            if (it != observations_by_age_.end()) {
                prev = it->second;
                break;
            }
        }
        velocity_dir_ = speedDirection(prev.bbox, d.bbox);
    }

    // Update track counters
    time_since_update_ = 0;
    hits_++;
    hit_streak_++;

    // Store observation state for OCR/OCM
    last_observation_ = d;
    observations_by_age_[age_] = d;

    // Update appearance: keep only the best few samples (avoid drift from bad crops).
    if (d.has_reid) {
        const float q = std::max(0.0f, d.reid_quality);
        if (q >= kMinReidUpdateQuality) {
            // Insert into bank if it improves the set.
            int insert_at = -1;
            if (appearance_bank_size_ < kAppearanceBankK) {
                insert_at = appearance_bank_size_++;
            } else {
                int worst = 0;
                float worst_q = appearance_bank_q_[0];
                for (int i = 1; i < kAppearanceBankK; ++i) {
                    if (appearance_bank_q_[i] < worst_q) {
                        worst_q = appearance_bank_q_[i];
                        worst = i;
                    }
                }
                if (q > worst_q) insert_at = worst;
            }

            if (insert_at >= 0) {
                appearance_bank_[insert_at] = d.reid;
                l2_normalize(appearance_bank_[insert_at]);
                appearance_bank_q_[insert_at] = q;

                // Recompute prototype as a quality-weighted mean.
                std::array<float, Detection::kReidDim> proto{};
                double wsum = 0.0;
                for (int i = 0; i < appearance_bank_size_; ++i) {
                    const double w = static_cast<double>(std::max(0.0f, appearance_bank_q_[i]));
                    wsum += w;
                    for (int k = 0; k < Detection::kReidDim; ++k) {
                        proto[k] += static_cast<float>(w * static_cast<double>(appearance_bank_[i][k]));
                    }
                }
                if (wsum <= 1e-9) {
                    proto = appearance_bank_[0];
                }
                l2_normalize(proto);
                appearance_ = proto;
                has_appearance_ = true;
            } else if (!has_appearance_) {
                // Should be rare: if bank is empty but we rejected insert (e.g. q==0).
                appearance_bank_[0] = d.reid;
                l2_normalize(appearance_bank_[0]);
                appearance_bank_q_[0] = q;
                appearance_bank_size_ = 1;
                appearance_ = appearance_bank_[0];
                has_appearance_ = true;
            }
        }
    }

    // Standard KF update with the real measurement
    updateKF(z_arr);

    // Save state snapshot for future ORU rollback
    oru_saved_x_ = x_;
    oru_saved_P_ = P_;
    oru_saved_age_ = age_;
    oru_observed_ = true;
}

BBox KalmanBoxTracker::getState() const {
    Measurement z = {
        x_(0, 0),  // x
        x_(1, 0),  // y
        x_(2, 0),  // s
        x_(3, 0)   // r
    };
    return measurementToBbox(z);
}

void KalmanBoxTracker::applyWarp(const Mat3f& warp, int frame_width, int frame_height) {
    if (frame_width <= 0 || frame_height <= 0) return;

    // Warp current KF state bbox (normalized), then rewrite (x,y,s,r).
    const BBox cur = getState();
    const BBox warped = warp_bbox_norm(cur, warp, frame_width, frame_height);
    const Measurement z = bboxToMeasurement(warped);
    x_(0, 0) = z[0];
    x_(1, 0) = z[1];
    x_(2, 0) = z[2];
    x_(3, 0) = z[3];

    // Approximate velocity transform using affine part (ignore projective terms).
    const float vx_px = x_(4, 0) * static_cast<float>(frame_width);
    const float vy_px = x_(5, 0) * static_cast<float>(frame_height);
    const float nvx_px = warp(0, 0) * vx_px + warp(0, 1) * vy_px;
    const float nvy_px = warp(1, 0) * vx_px + warp(1, 1) * vy_px;
    x_(4, 0) = nvx_px / static_cast<float>(frame_width);
    x_(5, 0) = nvy_px / static_cast<float>(frame_height);

    // Scale vs by local area scale (determinant of 2x2 affine part).
    const float detA = warp(0, 0) * warp(1, 1) - warp(0, 1) * warp(1, 0);
    if (std::isfinite(detA) && detA > 0.0f) {
        x_(6, 0) *= detA;
    }

    // Transport observation state forward as well (OCR/OCM/ORU benefit from GMC).
    if (last_observation_.has_value() && last_observation_->score >= 0.0f) {
        last_observation_->bbox = warp_bbox_norm(last_observation_->bbox, warp, frame_width, frame_height);
    }
    for (auto& kv : observations_by_age_) {
        if (kv.second.score >= 0.0f) {
            kv.second.bbox = warp_bbox_norm(kv.second.bbox, warp, frame_width, frame_height);
        }
    }

    for (auto& opt : oru_history_) {
        if (!opt.has_value()) continue;
        const BBox hb = measurementToBbox(*opt);
        const BBox hw = warp_bbox_norm(hb, warp, frame_width, frame_height);
        *opt = bboxToMeasurement(hw);
    }

    if (oru_saved_x_.has_value()) {
        // Keep ORU rollback state in the same (camera-compensated) coordinate system.
        Measurement saved = {(*oru_saved_x_)(0, 0), (*oru_saved_x_)(1, 0), (*oru_saved_x_)(2, 0), (*oru_saved_x_)(3, 0)};
        const BBox sb = measurementToBbox(saved);
        const BBox sw = warp_bbox_norm(sb, warp, frame_width, frame_height);
        const Measurement zs = bboxToMeasurement(sw);
        (*oru_saved_x_)(0, 0) = zs[0];
        (*oru_saved_x_)(1, 0) = zs[1];
        (*oru_saved_x_)(2, 0) = zs[2];
        (*oru_saved_x_)(3, 0) = zs[3];
    }

    velocity_dir_.reset();
}

std::array<float, 2> KalmanBoxTracker::velocityDir() const {
    if (!velocity_dir_.has_value()) {
        return {0.0f, 0.0f};
    }
    return *velocity_dir_;
}

Detection KalmanBoxTracker::kPreviousObservation(int k) const {
    // Placeholder: score < 0 indicates invalid
    Detection placeholder{BBox{-1.0f, -1.0f, -1.0f, -1.0f}, -1.0f};
    if (observations_by_age_.empty()) {
        return placeholder;
    }

    for (int i = 0; i < k; ++i) {
        int dt = k - i;
        auto it = observations_by_age_.find(age_ - dt);
        if (it != observations_by_age_.end()) {
            return it->second;
        }
    }
    // Return the most recent observation
    return observations_by_age_.rbegin()->second;
}

void KalmanBoxTracker::predictKF() {
    // Handle potential negative scale prediction
    if ((x_(6, 0) + x_(2, 0)) <= 0) {
        x_(6, 0) = 0.0f;
    }

    // Predict state: x = F * x
    x_ = F_ * x_;

    // Predict covariance: P = F * P * F' + Q
    P_ = F_ * P_ * F_.transpose() + Q_;
}

void KalmanBoxTracker::updateKF(const Measurement& z_arr) {
    Matrix z(4, 1);
    z(0, 0) = z_arr[0];
    z(1, 0) = z_arr[1];
    z(2, 0) = z_arr[2];
    z(3, 0) = z_arr[3];

    // Kalman update equations
    // y = z - H * x (innovation)
    Matrix y = z - H_ * x_;

    // S = H * P * H' + R (innovation covariance)
    Matrix S = H_ * P_ * H_.transpose() + R_;

    // K = P * H' * S^-1 (Kalman gain)
    Matrix K = P_ * H_.transpose() * S.inverse();

    // x = x + K * y (state update)
    x_ = x_ + K * y;

    // P = (I - K * H) * P (covariance update)
    Matrix I(7, 7);
    I.setIdentity();
    P_ = (I - K * H_) * P_;
}

void KalmanBoxTracker::maybeRunORU(const Measurement& current_meas) {
    if (!oru_saved_x_.has_value() || !oru_saved_P_.has_value()) {
        return;
    }

    // Find the last two real observations in history (previous + current)
    int idx2 = -1;
    int idx1 = -1;
    for (int i = static_cast<int>(oru_history_.size()) - 1; i >= 0; --i) {
        if (oru_history_[i].has_value()) {
            if (idx2 < 0) {
                idx2 = i;
            } else {
                idx1 = i;
                break;
            }
        }
    }
    if (idx1 < 0 || idx2 < 0) {
        return;
    }

    const int gap = idx2 - idx1;
    if (gap < 2) {
        // No missing steps between observations
        return;
    }

    const Measurement& prev_meas = *oru_history_[idx1];

    // Restore KF to last observed state (paper: rollback to last matched obs)
    x_ = *oru_saved_x_;
    P_ = *oru_saved_P_;

    // Interpolate a virtual trajectory for intermediate timesteps (t1 < t < t2)
    float x1, y1, w1, h1;
    float x2, y2, w2, h2;
    measurementToXYWH(prev_meas, x1, y1, w1, h1);
    measurementToXYWH(current_meas, x2, y2, w2, h2);

    for (int i = 1; i <= gap - 1; ++i) {
        const float alpha = static_cast<float>(i) / static_cast<float>(gap);
        const float xi = x1 + alpha * (x2 - x1);
        const float yi = y1 + alpha * (y2 - y1);
        const float wi = w1 + alpha * (w2 - w1);
        const float hi = h1 + alpha * (h2 - h1);

        // Step forward one frame, then correct with virtual observation
        predictKF();
        updateKF(xywhToMeasurement(xi, yi, wi, hi));
    }

    // Finally, predict to the current frame; the caller will apply the real update
    predictKF();
}

KalmanBoxTracker::Measurement KalmanBoxTracker::bboxToMeasurement(const BBox& bbox) {
    float x = bbox.centerX();
    float y = bbox.centerY();
    float s = bbox.area();
    float r = bbox.width() / std::max(bbox.height(), 1e-6f);
    return {x, y, s, r};
}

BBox KalmanBoxTracker::measurementToBbox(const Measurement& z) {
    float x = z[0];
    float y = z[1];
    float s = std::max(z[2], 1e-6f);  // area
    float r = std::max(z[3], 1e-6f);  // aspect ratio
    
    float w = std::sqrt(std::max(0.0f, s * r));
    float h = w > 0 ? s / w : 0.0f;
    
    return BBox{x - w / 2.0f, y - h / 2.0f, x + w / 2.0f, y + h / 2.0f};
}

void KalmanBoxTracker::measurementToXYWH(const Measurement& z, float& x, float& y, float& w, float& h) {
    x = z[0];
    y = z[1];
    float s = std::max(z[2], 1e-6f);
    float r = std::max(z[3], 1e-6f);
    w = std::sqrt(std::max(0.0f, s * r));
    h = w > 0 ? s / w : 0.0f;
}

KalmanBoxTracker::Measurement KalmanBoxTracker::xywhToMeasurement(float x, float y, float w, float h) {
    w = std::max(w, 1e-6f);
    h = std::max(h, 1e-6f);
    float s = w * h;
    float r = w / h;
    return {x, y, s, r};
}

std::array<float, 2> KalmanBoxTracker::speedDirection(const BBox& from, const BBox& to) {
    const float cx1 = (from.x1 + from.x2) / 2.0f;
    const float cy1 = (from.y1 + from.y2) / 2.0f;
    const float cx2 = (to.x1 + to.x2) / 2.0f;
    const float cy2 = (to.y1 + to.y2) / 2.0f;
    const float dy = cy2 - cy1;
    const float dx = cx2 - cx1;
    const float norm = std::sqrt(dx * dx + dy * dy) + 1e-6f;
    return {dy / norm, dx / norm};
}
