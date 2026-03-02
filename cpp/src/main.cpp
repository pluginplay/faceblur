#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "stb_image.h"

#include "core/config.hpp"
#include "kalman_filter.hpp"
#include "pipeline.hpp"
#include "scrfd.hpp"

namespace {

bool HasModelFile(const std::string& dir, const std::vector<std::string>& names) {
    for (const auto& name : names) {
        const std::filesystem::path p = std::filesystem::path(dir) / name;
        if (std::filesystem::is_regular_file(p)) return true;
    }
    return false;
}

}  // namespace

// Exit codes
enum ExitCode {
    SUCCESS = 0,
    ERR_INVALID_ARGS = 1,
    ERR_MODEL_NOT_FOUND = 2,
    ERR_IMAGE_LOAD_FAILED = 3,
    ERR_INFERENCE_FAILED = 4,
    ERR_NO_INPUT = 5,
    ERR_SELF_TEST_FAILED = 6
};

void PrintUsage(const char* prog) {
    fprintf(stderr, "Face Detection and Tracking Pipeline\n\n");
    fprintf(stderr, "Usage:\n");
    fprintf(stderr, "  Single image detection:\n");
    fprintf(stderr, "    %s --model <dir> --image <path> [--conf <float>] [--nms <float>]\n\n", prog);
    fprintf(stderr, "  Multi-frame tracking:\n");
    fprintf(stderr, "    %s --model <dir> --track [options]\n", prog);
    fprintf(stderr, "    (reads image paths from stdin, one per line, or from --images-file)\n\n");
    fprintf(stderr, "Options:\n");
    fprintf(stderr, "  --model <dir>                Root model directory (ONNX assets)\n");
    fprintf(stderr, "  --person-model-dir <dir>     Optional RF-DETR ONNX dir (default: <model>/rf_detr_small)\n");
    fprintf(stderr, "  --body-reid-model-dir <dir>  Optional OSNet ONNX dir (default: <model>/osnet_ibn_x1_0)\n");
    fprintf(stderr, "  --face-model-dir <dir>       Optional SCRFD ONNX dir (default: <model>)\n");
    fprintf(stderr, "  --face-assoc-iou <float>     Face-person IoU threshold (default: 0.5)\n");
    fprintf(stderr, "  --image <path>               Single image path (detection mode)\n");
    fprintf(stderr, "  --track                      Enable tracking mode (reads paths from stdin)\n");
    fprintf(stderr, "  --images-file <path>         File containing image paths, one per line\n");
    fprintf(stderr, "  --conf <float>               Confidence threshold (default: 0.5)\n");
    fprintf(stderr, "  --nms <float>                NMS IoU threshold (default: 0.4)\n");
    fprintf(stderr, "  --iou <float>                Tracking IoU threshold (default: 0.15)\n");
    fprintf(stderr, "  --detection-fps <f>          Detection sampling rate (default: 5.0)\n");
    fprintf(stderr, "  --video-fps <float>          Source video FPS (default: 30.0)\n");
    fprintf(stderr, "  --gmc-fps <f>                GMC sampling rate (default: follow detection fps)\n");
    fprintf(stderr, "  --reid-model <dir>           Deprecated alias for --body-reid-model-dir\n");
    fprintf(stderr, "  --reid-weight <f>            Deprecated/ignored\n");
    fprintf(stderr, "  --reid-cos <f>               Deprecated/ignored\n");
    fprintf(stderr, "  --test-ocsort                Run a deterministic OC-SORT self-test\n");
    fprintf(stderr, "\nOutput: JSON to stdout\n");
    fprintf(stderr, "\nExit codes:\n");
    fprintf(stderr, "  0 - Success\n");
    fprintf(stderr, "  1 - Invalid arguments\n");
    fprintf(stderr, "  2 - Model files not found\n");
    fprintf(stderr, "  3 - Image load failed\n");
    fprintf(stderr, "  4 - Inference error\n");
    fprintf(stderr, "  5 - No input provided\n");
    fprintf(stderr, "  6 - Self-test failed\n");
}

// Read image paths from stdin (one per line)
std::vector<std::string> ReadPathsFromStdin() {
    std::vector<std::string> paths;
    std::string line;
    while (std::getline(std::cin, line)) {
        size_t start = line.find_first_not_of(" \t\r\n");
        size_t end = line.find_last_not_of(" \t\r\n");
        if (start != std::string::npos && end != std::string::npos) {
            paths.push_back(line.substr(start, end - start + 1));
        }
    }
    return paths;
}

// Read image paths from file
std::vector<std::string> ReadPathsFromFile(const std::string& filepath) {
    std::vector<std::string> paths;
    std::ifstream file(filepath);
    if (!file.is_open()) {
        return paths;
    }
    std::string line;
    while (std::getline(file, line)) {
        size_t start = line.find_first_not_of(" \t\r\n");
        size_t end = line.find_last_not_of(" \t\r\n");
        if (start != std::string::npos && end != std::string::npos) {
            paths.push_back(line.substr(start, end - start + 1));
        }
    }
    return paths;
}

std::string JsonEscape(const std::string& s) {
    std::ostringstream result;
    for (char c : s) {
        switch (c) {
            case '"': result << "\\\""; break;
            case '\\': result << "\\\\"; break;
            case '\b': result << "\\b"; break;
            case '\f': result << "\\f"; break;
            case '\n': result << "\\n"; break;
            case '\r': result << "\\r"; break;
            case '\t': result << "\\t"; break;
            default: result << c;
        }
    }
    return result.str();
}

// Run single image detection (SCRFD utility mode)
int RunDetection(const std::string& model_dir,
                 const std::string& image_path,
                 float conf_thresh,
                 float nms_thresh) {
    std::string onnx_path = model_dir + "/scrfd_2.5g_kps_640x640.onnx";
    if (!std::filesystem::exists(onnx_path)) {
        onnx_path = model_dir + "/scrfd.onnx";
    }

    ScrfdDetector detector(onnx_path, 640, 640, conf_thresh, nms_thresh);
    if (!detector.IsLoaded()) {
        fprintf(stderr, "Error: Failed to load SCRFD ONNX model from %s\n", model_dir.c_str());
        return ERR_MODEL_NOT_FOUND;
    }

    int width = 0;
    int height = 0;
    int channels = 0;
    unsigned char* rgb = stbi_load(image_path.c_str(), &width, &height, &channels, 3);
    if (!rgb) {
        fprintf(stderr, "Error: Failed to load image %s\n", image_path.c_str());
        return ERR_IMAGE_LOAD_FAILED;
    }

    std::vector<ScrfdFace> faces = detector.Detect(rgb, width, height);
    stbi_image_free(rgb);

    printf("{\n");
    printf("  \"image\": \"%s\",\n", JsonEscape(image_path).c_str());
    printf("  \"width\": %d,\n", width);
    printf("  \"height\": %d,\n", height);
    printf("  \"faces\": [\n");

    for (size_t i = 0; i < faces.size(); ++i) {
        const ScrfdFace& face = faces[i];
        printf("    {\n");
        printf("      \"bbox\": [%.2f, %.2f, %.2f, %.2f],\n",
               face.bbox[0], face.bbox[1], face.bbox[2], face.bbox[3]);
        printf("      \"confidence\": %.4f,\n", face.score);
        printf("      \"landmarks\": [\n");
        for (int k = 0; k < 5; ++k) {
            printf("        [%.2f, %.2f]%s\n",
                   face.landmarks[k][0], face.landmarks[k][1],
                   k < 4 ? "," : "");
        }
        printf("      ]\n");
        printf("    }%s\n", i < faces.size() - 1 ? "," : "");
    }

    printf("  ]\n");
    printf("}\n");

    return SUCCESS;
}

int RunTracking(const std::string& model_dir,
                const std::vector<std::string>& image_paths,
                float conf_thresh,
                float nms_thresh,
                float iou_thresh,
                float detection_fps,
                float video_fps,
                float gmc_fps,
                const std::string& person_model_dir,
                const std::string& body_reid_model_dir,
                const std::string& face_model_dir,
                float face_assoc_iou) {
    if (image_paths.empty()) {
        fprintf(stderr, "Error: No image paths provided\n");
        return ERR_NO_INPUT;
    }

    const std::vector<std::string> person_candidates = {"rf-detr-small.onnx"};
    const std::vector<std::string> body_candidates = {"osnet_ibn_x1_0.onnx", "model.onnx"};
    const std::vector<std::string> face_candidates = {"scrfd_2.5g_kps_640x640.onnx", "scrfd.onnx"};

    std::string person_dir = person_model_dir.empty()
                                 ? (model_dir + "/rf_detr_small")
                                 : person_model_dir;
    if (!HasModelFile(person_dir, person_candidates)) {
        fprintf(stderr,
                "Error: RF-DETR ONNX model not found in %s (expected rf-detr-small.onnx)\n",
                person_dir.c_str());
        return ERR_MODEL_NOT_FOUND;
    }

    const std::string body_dir = body_reid_model_dir.empty()
                                     ? (model_dir + "/osnet_ibn_x1_0")
                                     : body_reid_model_dir;
    const std::string face_dir = face_model_dir.empty() ? model_dir : face_model_dir;
    if (!HasModelFile(face_dir, face_candidates)) {
        fprintf(stderr,
                "Error: SCRFD ONNX model not found in %s (expected scrfd_2.5g_kps_640x640.onnx or scrfd.onnx)\n",
                face_dir.c_str());
        return ERR_MODEL_NOT_FOUND;
    }
    if (!body_reid_model_dir.empty() && !HasModelFile(body_dir, body_candidates)) {
        fprintf(stderr,
                "Error: OSNet ONNX model not found in %s (expected osnet_ibn_x1_0.onnx or model.onnx)\n",
                body_dir.c_str());
        return ERR_MODEL_NOT_FOUND;
    }

    PipelineConfig cfg;
    cfg.person_detection.model_dir = person_dir;
    cfg.person_detection.conf_thresh = conf_thresh;
    cfg.person_detection.nms_thresh = nms_thresh;
    cfg.person_detection.detection_fps = detection_fps;

    cfg.face_detection.model_dir = face_dir;
    cfg.face_detection.conf_thresh = conf_thresh;
    cfg.face_detection.nms_thresh = nms_thresh;

    cfg.body_reid.enabled = HasModelFile(body_dir, body_candidates);
    cfg.body_reid.model_dir = body_dir;

    cfg.association.face_person_iou_thresh = face_assoc_iou;

    cfg.tracker.iou_thresh = iou_thresh;
    cfg.gmc.gmc_fps = gmc_fps;

    FacePipeline pipeline(cfg);
    if (!pipeline.isLoaded()) {
        fprintf(stderr,
                "Error: Failed to load one or more models. person=%s body=%s face=%s\n",
                person_dir.c_str(),
                body_dir.c_str(),
                face_dir.c_str());
        return ERR_MODEL_NOT_FOUND;
    }

    PipelineResult result = pipeline.process(image_paths, video_fps);

    printf("{\n");

    // people
    printf("  \"people\": [\n");
    for (size_t p = 0; p < result.people.size(); ++p) {
        const PersonTrack& person = result.people[p];
        printf("    {\n");
        printf("      \"id\": %d,\n", person.id);
        printf("      \"frames\": [\n");
        for (size_t f = 0; f < person.frames.size(); ++f) {
            const TrackFrame& frame = person.frames[f];
            printf("        {\"frameIndex\": %d, \"bbox\": [%.6f, %.6f, %.6f, %.6f], \"confidence\": %.4f}%s\n",
                   frame.frame_index,
                   frame.bbox.x1,
                   frame.bbox.y1,
                   frame.bbox.x2,
                   frame.bbox.y2,
                   frame.confidence,
                   f + 1 < person.frames.size() ? "," : "");
        }
        printf("      ]\n");
        printf("    }%s\n", p + 1 < result.people.size() ? "," : "");
    }
    printf("  ],\n");

    // face tracks
    printf("  \"faceTracks\": [\n");
    for (size_t t = 0; t < result.face_tracks.size(); ++t) {
        const FaceTrack& track = result.face_tracks[t];
        printf("    {\n");
        printf("      \"personId\": %d,\n", track.person_id);
        printf("      \"frames\": [\n");
        for (size_t f = 0; f < track.frames.size(); ++f) {
            const FaceKeyframe& frame = track.frames[f];
            printf("        {\"frameIndex\": %d, \"bbox\": [%.6f, %.6f, %.6f, %.6f], \"confidence\": %.4f, \"assocIou\": %.4f}%s\n",
                   frame.frame_index,
                   frame.bbox.x1,
                   frame.bbox.y1,
                   frame.bbox.x2,
                   frame.bbox.y2,
                   frame.confidence,
                   frame.assoc_iou,
                   f + 1 < track.frames.size() ? "," : "");
        }
        printf("      ]\n");
        printf("    }%s\n", t + 1 < result.face_tracks.size() ? "," : "");
    }
    printf("  ],\n");

    printf("  \"frameCount\": %d,\n", result.frame_count);

    // stats
    printf("  \"stats\": {\n");
    printf("    \"personDetections\": %d,\n", result.stats.person_detections);
    printf("    \"faceDetections\": %d,\n", result.stats.face_detections);
    printf("    \"associatedFaces\": %d,\n", result.stats.associated_faces);
    printf("    \"unassociatedFaces\": %d,\n", result.stats.unassociated_faces);
    printf("    \"quality\": {\n");
    printf("      \"duplicateOverlapFrames\": %d,\n", result.stats.quality.duplicate_overlap_frames);
    printf("      \"personPresentNoFaceFrames\": %d,\n",
           result.stats.quality.person_present_no_face_frames);
    printf("      \"longestPersonPresentNoFaceRun\": %d,\n",
           result.stats.quality.longest_person_present_no_face_run);
    printf("      \"predictedTrackFrames\": %d,\n", result.stats.quality.predicted_track_frames);
    printf("      \"totalTrackFrames\": %d,\n", result.stats.quality.total_track_frames);
    printf("      \"estimatedSwitchBreakpoints\": %d,\n",
           result.stats.quality.estimated_switch_breakpoints);
    printf("      \"gmcRejectedFrames\": %d,\n", result.stats.quality.gmc_rejected_frames);
    printf("      \"adaptiveDetectionFrames\": %d,\n", result.stats.quality.adaptive_detection_frames);
    printf("      \"personFaceCoverage\": [\n");
    for (size_t i = 0; i < result.stats.quality.person_face_coverage.size(); ++i) {
        const auto& c = result.stats.quality.person_face_coverage[i];
        printf("        {\"personId\": %d, \"personFrames\": %d, \"faceFrames\": %d, \"blinkGaps\": %d, \"longestBlinkGap\": %d, \"coverage\": %.4f}%s\n",
               c.person_id,
               c.person_frames,
               c.face_frames,
               c.blink_gaps,
               c.longest_blink_gap,
               c.coverage,
               i + 1 < result.stats.quality.person_face_coverage.size() ? "," : "");
    }
    printf("      ]\n");
    printf("    },\n");
    printf("    \"timingMs\": {\n");
    printf("      \"personDetect\": %.3f,\n", result.stats.timing_ms.person_detect);
    printf("      \"personPreprocess\": %.3f,\n", result.stats.timing_ms.person_preprocess);
    printf("      \"personInfer\": %.3f,\n", result.stats.timing_ms.person_infer);
    printf("      \"personDecode\": %.3f,\n", result.stats.timing_ms.person_decode);
    printf("      \"bodyReid\": %.3f,\n", result.stats.timing_ms.body_reid);
    printf("      \"faceDetect\": %.3f,\n", result.stats.timing_ms.face_detect);
    printf("      \"associate\": %.3f,\n", result.stats.timing_ms.associate);
    printf("      \"trackUpdate\": %.3f\n", result.stats.timing_ms.track_update);
    printf("    }\n");
    printf("  }\n");

    printf("}\n");

    return SUCCESS;
}

// Minimal deterministic self-test for ORU behavior (paper parity)
int RunOcsortSelfTest() {
    auto make_det = [](float cx, float cy, float w, float h, float score) -> Detection {
        return Detection{BBox{cx - w / 2.0f, cy - h / 2.0f, cx + w / 2.0f, cy + h / 2.0f}, score};
    };

    KalmanBoxTracker trk(make_det(0.20f, 0.50f, 0.10f, 0.10f, 1.0f), /*track_id=*/0, /*delta_t=*/3);

    for (int f = 1; f <= 2; ++f) {
        (void)trk.predict();
        const float cx = 0.20f + 0.05f * static_cast<float>(f);
        trk.update(make_det(cx, 0.50f, 0.10f, 0.10f, 1.0f));
    }

    for (int f = 3; f <= 7; ++f) {
        (void)trk.predict();
        trk.update(std::nullopt);
    }

    (void)trk.predict();
    trk.update(make_det(0.80f, 0.50f, 0.10f, 0.10f, 1.0f));
    const BBox b8 = trk.getState();
    const float cx8 = (b8.x1 + b8.x2) / 2.0f;

    const BBox b9 = trk.predict();
    const float cx9 = (b9.x1 + b9.x2) / 2.0f;

    if (!(cx9 > cx8 + 0.02f)) {
        fprintf(stderr,
                "OC-SORT self-test failed: expected positive velocity after ORU (cx8=%.4f, cx9=%.4f)\n",
                cx8,
                cx9);
        return ERR_SELF_TEST_FAILED;
    }

    fprintf(stderr, "OC-SORT self-test passed (cx8=%.4f, cx9=%.4f)\n", cx8, cx9);
    return SUCCESS;
}

int main(int argc, char** argv) {
    std::string model_dir;
    std::string image_path;
    std::string images_file;
    std::string person_model_dir;
    std::string body_reid_model_dir;
    std::string face_model_dir;
    std::string deprecated_reid_model_dir;
    bool track_mode = false;
    bool test_ocsort = false;
    bool warned_reid = false;

    float conf_thresh = 0.5f;
    float nms_thresh = 0.4f;
    float iou_thresh = 0.15f;
    float detection_fps = 5.0f;
    float video_fps = 30.0f;
    float gmc_fps = 0.0f;
    float face_assoc_iou = 0.5f;

    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--model") == 0 && i + 1 < argc) {
            model_dir = argv[++i];
        } else if (strcmp(argv[i], "--image") == 0 && i + 1 < argc) {
            image_path = argv[++i];
        } else if (strcmp(argv[i], "--track") == 0) {
            track_mode = true;
        } else if (strcmp(argv[i], "--test-ocsort") == 0) {
            test_ocsort = true;
        } else if (strcmp(argv[i], "--images-file") == 0 && i + 1 < argc) {
            images_file = argv[++i];
            track_mode = true;
        } else if (strcmp(argv[i], "--person-model-dir") == 0 && i + 1 < argc) {
            person_model_dir = argv[++i];
        } else if (strcmp(argv[i], "--body-reid-model-dir") == 0 && i + 1 < argc) {
            body_reid_model_dir = argv[++i];
        } else if (strcmp(argv[i], "--face-model-dir") == 0 && i + 1 < argc) {
            face_model_dir = argv[++i];
        } else if (strcmp(argv[i], "--face-assoc-iou") == 0 && i + 1 < argc) {
            face_assoc_iou = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--conf") == 0 && i + 1 < argc) {
            conf_thresh = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--nms") == 0 && i + 1 < argc) {
            nms_thresh = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--iou") == 0 && i + 1 < argc) {
            iou_thresh = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--detection-fps") == 0 && i + 1 < argc) {
            detection_fps = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--video-fps") == 0 && i + 1 < argc) {
            video_fps = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--gmc-fps") == 0 && i + 1 < argc) {
            gmc_fps = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--reid-model") == 0 && i + 1 < argc) {
            deprecated_reid_model_dir = argv[++i];
            if (!warned_reid) {
                fprintf(stderr, "Warning: --reid-model is deprecated; use --body-reid-model-dir\n");
                warned_reid = true;
            }
        } else if ((strcmp(argv[i], "--reid-weight") == 0 || strcmp(argv[i], "--reid-cos") == 0) && i + 1 < argc) {
            ++i;
            if (!warned_reid) {
                fprintf(stderr, "Warning: --reid-weight/--reid-cos are deprecated and ignored\n");
                warned_reid = true;
            }
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            PrintUsage(argv[0]);
            return SUCCESS;
        }
    }

    if (!deprecated_reid_model_dir.empty() && body_reid_model_dir.empty()) {
        body_reid_model_dir = deprecated_reid_model_dir;
    }

    if (test_ocsort) {
        return RunOcsortSelfTest();
    }

    if (model_dir.empty()) {
        fprintf(stderr, "Error: --model is required\n\n");
        PrintUsage(argv[0]);
        return ERR_INVALID_ARGS;
    }

    if (track_mode) {
        std::vector<std::string> image_paths;
        if (!images_file.empty()) {
            image_paths = ReadPathsFromFile(images_file);
        } else {
            image_paths = ReadPathsFromStdin();
        }

        return RunTracking(model_dir,
                           image_paths,
                           conf_thresh,
                           nms_thresh,
                           iou_thresh,
                           detection_fps,
                           video_fps,
                           gmc_fps,
                           person_model_dir,
                           body_reid_model_dir,
                           face_model_dir,
                           face_assoc_iou);
    }

    if (!image_path.empty()) {
        return RunDetection(model_dir, image_path, conf_thresh, nms_thresh);
    }

    fprintf(stderr, "Error: Either --image or --track is required\n\n");
    PrintUsage(argv[0]);
    return ERR_INVALID_ARGS;
}
