#pragma once

#include <initializer_list>
#include <memory>
#include <string>
#include <vector>

#include "infer/ort_headers.hpp"

namespace infer {

Ort::Env& SharedOrtEnv();

Ort::SessionOptions MakeSessionOptions(int num_threads);

std::unique_ptr<Ort::Session> CreateSession(const std::string& model_path,
                                            int num_threads);

std::vector<std::string> GetInputNames(const Ort::Session& session);
std::vector<std::string> GetOutputNames(const Ort::Session& session);

bool HasName(const std::vector<std::string>& names, const std::string& target);

const std::string* FindFirstAvailable(const std::vector<std::string>& names,
                                      std::initializer_list<const char*> candidates);

const Ort::MemoryInfo& CpuMemoryInfo();

}  // namespace infer
