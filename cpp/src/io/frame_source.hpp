#pragma once

#include <string>
#include <vector>

#include "pipeline/frame_types.hpp"

class IFrameSource {
public:
    virtual ~IFrameSource() = default;
    virtual int FrameCount() const = 0;
    virtual bool GetFrameInfo(int index, FrameInfo& out) = 0;
    virtual bool ReadFrame(int index, FrameBuffer& out) = 0;
};

class ImageSequenceSource : public IFrameSource {
public:
    explicit ImageSequenceSource(std::vector<std::string> paths);

    int FrameCount() const override;
    bool GetFrameInfo(int index, FrameInfo& out) override;
    bool ReadFrame(int index, FrameBuffer& out) override;

private:
    std::vector<std::string> paths_;
};
