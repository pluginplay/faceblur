#pragma once

#include <cstdint>
#include <vector>

struct Frame {
    int index = 0;
    int width = 0;
    int height = 0;
    std::vector<uint8_t> rgb;  // interleaved RGB
};
