#include "infer/ort_runtime.hpp"

#include <algorithm>
#include <filesystem>
#include <stdexcept>
#include <thread>

namespace infer {
namespace {

int ResolveThreadCount(int num_threads) {
    if (num_threads > 0) return num_threads;
    const unsigned hw = std::thread::hardware_concurrency();
    return static_cast<int>(std::max(1u, std::min(4u, hw > 0 ? hw : 1u)));
}

}  // namespace

Ort::Env& SharedOrtEnv() {
    static Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "face_pipeline");
    return env;
}

Ort::SessionOptions MakeSessionOptions(int num_threads) {
    Ort::SessionOptions options;
    options.SetIntraOpNumThreads(ResolveThreadCount(num_threads));
    options.SetInterOpNumThreads(1);
    options.SetExecutionMode(ExecutionMode::ORT_SEQUENTIAL);
    options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_EXTENDED);
    return options;
}

std::unique_ptr<Ort::Session> CreateSession(const std::string& model_path,
                                            int num_threads) {
    if (!std::filesystem::exists(model_path)) {
        throw std::runtime_error("Model file not found: " + model_path);
    }
    Ort::SessionOptions options = MakeSessionOptions(num_threads);
    return std::make_unique<Ort::Session>(SharedOrtEnv(), model_path.c_str(), options);
}

std::vector<std::string> GetInputNames(const Ort::Session& session) {
    std::vector<std::string> names;
    Ort::AllocatorWithDefaultOptions allocator;
    const size_t count = session.GetInputCount();
    names.reserve(count);
    for (size_t i = 0; i < count; ++i) {
        auto name = session.GetInputNameAllocated(i, allocator);
        names.emplace_back(name.get() ? name.get() : "");
    }
    return names;
}

std::vector<std::string> GetOutputNames(const Ort::Session& session) {
    std::vector<std::string> names;
    Ort::AllocatorWithDefaultOptions allocator;
    const size_t count = session.GetOutputCount();
    names.reserve(count);
    for (size_t i = 0; i < count; ++i) {
        auto name = session.GetOutputNameAllocated(i, allocator);
        names.emplace_back(name.get() ? name.get() : "");
    }
    return names;
}

bool HasName(const std::vector<std::string>& names, const std::string& target) {
    return std::find(names.begin(), names.end(), target) != names.end();
}

const std::string* FindFirstAvailable(const std::vector<std::string>& names,
                                      std::initializer_list<const char*> candidates) {
    for (const char* candidate : candidates) {
        if (!candidate) continue;
        auto it = std::find(names.begin(), names.end(), candidate);
        if (it != names.end()) return &(*it);
    }
    return nullptr;
}

const Ort::MemoryInfo& CpuMemoryInfo() {
    static const Ort::MemoryInfo info =
        Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    return info;
}

}  // namespace infer
