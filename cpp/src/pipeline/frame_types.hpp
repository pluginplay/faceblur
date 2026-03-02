#pragma once

#include <cstdint>
#include <vector>

struct FrameInfo {
    int index = 0;
    int width = 0;
    int height = 0;
};

struct FrameView {
    int index = 0;
    int width = 0;
    int height = 0;
    const uint8_t* rgb = nullptr;  // interleaved RGB

    bool isValid() const { return rgb != nullptr && width > 0 && height > 0; }
};

struct FrameBuffer {
    FrameInfo info{};
    std::vector<uint8_t> rgb;

    FrameView view() const {
        return FrameView{info.index, info.width, info.height, rgb.empty() ? nullptr : rgb.data()};
    }

    void reset() {
        info = FrameInfo{};
        rgb.clear();
    }
};
