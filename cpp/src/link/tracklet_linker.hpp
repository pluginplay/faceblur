#pragma once

#include <unordered_map>
#include <vector>

#include "core/config.hpp"
#include "core/types.hpp"

class TrackletLinker {
public:
    TrackletLinker(const LinkingConfig& cfg, const OutputConfig& out_cfg);

    std::unordered_map<int, std::vector<TrackFrame>> Link(
        std::unordered_map<int, std::vector<TrackFrame>> track_data,
        const std::unordered_map<int, Appearance>& appearances,
        float video_fps,
        float conf_thresh,
        float base_sim_thresh) const;

private:
    LinkingConfig cfg_{};
    OutputConfig out_cfg_{};
};
