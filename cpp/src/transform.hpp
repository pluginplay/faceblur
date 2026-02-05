#pragma once

#include <array>

struct Mat3f {
    std::array<float, 9> m{};

    static Mat3f Identity() {
        Mat3f I;
        I.m = {1.0f, 0.0f, 0.0f,
               0.0f, 1.0f, 0.0f,
               0.0f, 0.0f, 1.0f};
        return I;
    }

    float operator()(int r, int c) const { return m[static_cast<size_t>(r) * 3u + static_cast<size_t>(c)]; }
};

