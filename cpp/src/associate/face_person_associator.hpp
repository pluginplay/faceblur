#pragma once

#include <unordered_map>
#include <vector>

#include "core/config.hpp"
#include "core/types.hpp"
#include "hungarian.hpp"

struct PersonTrackState {
    int person_id = -1;
    BBox bbox;
    float confidence = 0.0f;
};

struct FacePersonMatch {
    int person_id = -1;
    int face_index = -1;
    float iou = 0.0f;
    float face_overlap = 0.0f;
    bool center_inside = false;
    float score = 0.0f;
};

struct FacePersonCandidate {
    int face_index = -1;
    int person_id = -1;
    float iou = 0.0f;
    float face_overlap = 0.0f;
    bool center_inside = false;
    bool gate_pass = false;
    float score = 0.0f;
};

class FacePersonAssociator {
public:
    explicit FacePersonAssociator(const AssociationConfig& cfg) : cfg_(cfg) {}

    std::vector<FacePersonMatch> Associate(const std::vector<FaceDetection>& faces,
                                           const std::vector<PersonTrackState>& people,
                                           int frame_index,
                                           std::vector<FacePersonCandidate>* candidates = nullptr) const;

private:
    struct FaceMemory {
        BBox bbox;
        int frame_index = -1;
    };

    void pruneMemory(int frame_index) const;
    float temporalPrior(const BBox& face_box, int person_id, int frame_index) const;
    float switchPenalty(const BBox& face_box, int candidate_person_id, int frame_index) const;

    AssociationConfig cfg_{};
    mutable HungarianAlgorithm hungarian_;
    mutable std::unordered_map<int, FaceMemory> memory_by_person_;
};
