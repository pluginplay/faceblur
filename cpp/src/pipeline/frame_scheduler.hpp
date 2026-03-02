#pragma once

#include <algorithm>
#include <cmath>
#include <vector>

class FrameScheduler {
public:
    FrameScheduler(int frame_count,
                   float video_fps,
                   float detection_fps,
                   float gmc_fps,
                   bool gmc_enabled) {
        const int count = std::max(0, frame_count);
        det_frames_.assign(static_cast<size_t>(count), false);
        gmc_frames_.assign(static_cast<size_t>(count), false);
        if (count == 0) return;

        const int det_stride = computeStride(video_fps, detection_fps, count);
        for (int i = 0; i < count; i += det_stride) {
            det_frames_[static_cast<size_t>(i)] = true;
        }
        det_frames_[static_cast<size_t>(count - 1)] = true;

        if (!gmc_enabled || count < 2) return;
        const float gmc_fps_eff = (gmc_fps > 0.0f)
                                      ? gmc_fps
                                      : ((detection_fps > 0.0f) ? detection_fps : video_fps);
        if (!(gmc_fps_eff > 0.0f)) return;
        const int gmc_stride = computeStride(video_fps, gmc_fps_eff, count);
        for (int i = 0; i < count; i += gmc_stride) {
            gmc_frames_[static_cast<size_t>(i)] = true;  // needs prev frame; frame 0 is safely ignored by runner
        }
    }

    bool IsDetectionFrame(int index) const {
        return inRange(det_frames_, index) ? det_frames_[static_cast<size_t>(index)] : false;
    }

    bool IsGmcFrame(int index) const {
        return inRange(gmc_frames_, index) ? gmc_frames_[static_cast<size_t>(index)] : false;
    }

private:
    static bool inRange(const std::vector<bool>& v, int index) {
        return index >= 0 && index < static_cast<int>(v.size());
    }

    static int computeStride(float video_fps, float target_fps, int frame_count) {
        if (!(target_fps > 0.0f)) return std::max(1, frame_count);
        if (!(video_fps > 0.0f)) return 1;
        // Use ceil so scheduled sampling never exceeds requested target_fps.
        const int stride = static_cast<int>(std::ceil(video_fps / target_fps));
        return std::max(1, stride);
    }

    std::vector<bool> det_frames_;
    std::vector<bool> gmc_frames_;
};
