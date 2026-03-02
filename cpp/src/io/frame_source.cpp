#include "io/frame_source.hpp"

#include "stb_image.h"

namespace {
bool LoadRgbFrame(const std::string& path, FrameBuffer& out) {
    out.reset();
    int w = 0, h = 0, ch = 0;
    unsigned char* rgb = stbi_load(path.c_str(), &w, &h, &ch, 3);
    if (!rgb || w <= 0 || h <= 0) {
        if (rgb) stbi_image_free(rgb);
        return false;
    }
    out.info.width = w;
    out.info.height = h;
    out.rgb.assign(rgb, rgb + static_cast<size_t>(w) * static_cast<size_t>(h) * 3u);
    stbi_image_free(rgb);
    return true;
}
}  // namespace

ImageSequenceSource::ImageSequenceSource(std::vector<std::string> paths)
    : paths_(std::move(paths)) {}

int ImageSequenceSource::FrameCount() const {
    return static_cast<int>(paths_.size());
}

bool ImageSequenceSource::GetFrameInfo(int index, FrameInfo& out) {
    if (index < 0 || index >= static_cast<int>(paths_.size())) return false;
    int w = 0, h = 0, ch = 0;
    if (!stbi_info(paths_[static_cast<size_t>(index)].c_str(), &w, &h, &ch)) return false;
    if (w <= 0 || h <= 0) return false;
    out = FrameInfo{index, w, h};
    return true;
}

bool ImageSequenceSource::ReadFrame(int index, FrameBuffer& out) {
    if (index < 0 || index >= static_cast<int>(paths_.size())) return false;
    const bool ok = LoadRgbFrame(paths_[static_cast<size_t>(index)], out);
    out.info.index = index;
    return ok;
}
