#pragma once

#include <vector>

#include "pipeline/frame_types.hpp"

class FramePool {
public:
    FrameBuffer Acquire() {
        if (pool_.empty()) return FrameBuffer{};
        FrameBuffer out = std::move(pool_.back());
        pool_.pop_back();
        return out;
    }

    void Release(FrameBuffer&& buffer) {
        buffer.reset();
        pool_.push_back(std::move(buffer));
    }

private:
    std::vector<FrameBuffer> pool_{};
};
