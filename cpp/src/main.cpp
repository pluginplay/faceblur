#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "stb_image.h"

#include "scrfd.hpp"
#include "pipeline.hpp"

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
    fprintf(stderr, "  --model <dir>        Directory containing scrfd.param and scrfd.bin\n");
    fprintf(stderr, "  --image <path>       Single image path (detection mode)\n");
    fprintf(stderr, "  --track              Enable tracking mode (reads paths from stdin)\n");
    fprintf(stderr, "  --images-file <path> File containing image paths, one per line\n");
    fprintf(stderr, "  --conf <float>       Confidence threshold (default: 0.5)\n");
    fprintf(stderr, "  --nms <float>        NMS IoU threshold (default: 0.4)\n");
    fprintf(stderr, "  --iou <float>        Tracking IoU threshold (default: 0.15)\n");
    fprintf(stderr, "  --detection-fps <f>  Detection sampling rate (default: 5.0)\n");
    fprintf(stderr, "  --video-fps <float>  Source video FPS (default: 30.0)\n");
    fprintf(stderr, "  --reid-model <dir>   Optional dir containing mobilefacenet-*.param/.bin\n");
    fprintf(stderr, "  --reid-weight <f>    ReID appearance weight (default: 0.35)\n");
    fprintf(stderr, "  --reid-cos <f>       ReID cosine gate threshold (default: 0.35)\n");
    fprintf(stderr, "  --test-ocsort        Run a deterministic OC-SORT self-test\n");
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
        // Trim whitespace
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

// Escape string for JSON
std::string JsonEscape(const std::string& s) {
    std::ostringstream result;
    for (char c : s) {
        switch (c) {
            case '\"': result << "\\\""; break;
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

// Run single image detection (original mode)
int RunDetection(const std::string& model_dir, const std::string& image_path,
                 float conf_thresh, float nms_thresh) {
    // Build model paths
    std::string param_path = model_dir + "/scrfd.param";
    std::string bin_path = model_dir + "/scrfd.bin";

    // Load model
    ScrfdDetector detector(param_path, bin_path, 640, 640, conf_thresh, nms_thresh);
    if (!detector.IsLoaded()) {
        fprintf(stderr, "Error: Failed to load model from %s\n", model_dir.c_str());
        return ERR_MODEL_NOT_FOUND;
    }

    // Load image
    int width, height, channels;
    unsigned char* rgb = stbi_load(image_path.c_str(), &width, &height, &channels, 3);
    if (!rgb) {
        fprintf(stderr, "Error: Failed to load image %s\n", image_path.c_str());
        return ERR_IMAGE_LOAD_FAILED;
    }

    // Run detection
    std::vector<ScrfdFace> faces = detector.Detect(rgb, width, height);
    stbi_image_free(rgb);

    // Output JSON
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

// Run multi-frame tracking
int RunTracking(const std::string& model_dir,
                const std::vector<std::string>& image_paths,
                float conf_thresh, float iou_thresh,
                float detection_fps, float video_fps,
                const std::string& reid_model_dir,
                float reid_weight,
                float reid_cos_thresh) {
    
    if (image_paths.empty()) {
        fprintf(stderr, "Error: No image paths provided\n");
        return ERR_NO_INPUT;
    }
    
    // Create pipeline
    FacePipeline pipeline(model_dir, conf_thresh, detection_fps, iou_thresh,
                          reid_model_dir, reid_weight, reid_cos_thresh);
    
    if (!pipeline.isLoaded()) {
        fprintf(stderr, "Error: Failed to load model from %s\n", model_dir.c_str());
        return ERR_MODEL_NOT_FOUND;
    }
    
    // Process frames
    PipelineResult result = pipeline.process(image_paths, video_fps);
    
    // Output JSON
    printf("{\n");
    printf("  \"tracks\": [\n");
    
    for (size_t t = 0; t < result.tracks.size(); ++t) {
        const FaceTrack& track = result.tracks[t];
        printf("    {\n");
        printf("      \"id\": %d,\n", track.id);
        printf("      \"frames\": [\n");
        
        for (size_t f = 0; f < track.frames.size(); ++f) {
            const TrackFrame& frame = track.frames[f];
            printf("        {\"frameIndex\": %d, \"bbox\": [%.6f, %.6f, %.6f, %.6f], \"confidence\": %.4f}%s\n",
                   frame.frame_index,
                   frame.bbox.x1, frame.bbox.y1, frame.bbox.x2, frame.bbox.y2,
                   frame.confidence,
                   f < track.frames.size() - 1 ? "," : "");
        }
        
        printf("      ]\n");
        printf("    }%s\n", t < result.tracks.size() - 1 ? "," : "");
    }
    
    printf("  ],\n");
    printf("  \"frameCount\": %d\n", result.frame_count);
    printf("}\n");
    
    return SUCCESS;
}

// Minimal deterministic self-test for ORU behavior (paper parity)
int RunOcsortSelfTest() {
    // Deterministic ORU unit-ish test on a single track (bypasses association).
    //
    // Scenario:
    // - observe object moving right (frames 0-2)
    // - occlusion gap (frames 3-7) -> update(nullopt)
    // - re-observe at frame 8 far to the right -> triggers ORU
    // - next prediction (frame 9) should continue moving right (vx > 0)
    auto make_det = [](float cx, float cy, float w, float h, float score) -> Detection {
        return Detection{BBox{cx - w / 2.0f, cy - h / 2.0f, cx + w / 2.0f, cy + h / 2.0f}, score};
    };

    KalmanBoxTracker trk(make_det(0.20f, 0.50f, 0.10f, 0.10f, 1.0f), /*track_id=*/0, /*delta_t=*/3);

    // Frames 1-2: observe motion
    for (int f = 1; f <= 2; ++f) {
        (void)trk.predict();
        const float cx = 0.20f + 0.05f * static_cast<float>(f);
        trk.update(make_det(cx, 0.50f, 0.10f, 0.10f, 1.0f));
    }

    // Frames 3-7: occlusion
    for (int f = 3; f <= 7; ++f) {
        (void)trk.predict();
        trk.update(std::nullopt);
    }

    // Frame 8: re-activation
    (void)trk.predict();
    trk.update(make_det(0.80f, 0.50f, 0.10f, 0.10f, 1.0f));
    const BBox b8 = trk.getState();
    const float cx8 = (b8.x1 + b8.x2) / 2.0f;

    // Frame 9: prediction should move right (vx > 0)
    const BBox b9 = trk.predict();
    const float cx9 = (b9.x1 + b9.x2) / 2.0f;

    if (!(cx9 > cx8 + 0.02f)) {
        fprintf(stderr,
                "OC-SORT self-test failed: expected positive velocity after ORU (cx8=%.4f, cx9=%.4f)\n",
                cx8, cx9);
        return ERR_SELF_TEST_FAILED;
    }

    fprintf(stderr, "OC-SORT self-test passed (cx8=%.4f, cx9=%.4f)\n", cx8, cx9);
    return SUCCESS;
}

int main(int argc, char** argv) {
    std::string model_dir;
    std::string image_path;
    std::string images_file;
    std::string reid_model_dir;
    bool track_mode = false;
    bool test_ocsort = false;
    float conf_thresh = 0.5f;
    float nms_thresh = 0.4f;
    float iou_thresh = 0.15f;
    float detection_fps = 5.0f;
    float video_fps = 30.0f;
    float reid_weight = 0.35f;
    float reid_cos_thresh = 0.35f;

    // Parse arguments
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
        } else if (strcmp(argv[i], "--reid-model") == 0 && i + 1 < argc) {
            reid_model_dir = argv[++i];
        } else if (strcmp(argv[i], "--reid-weight") == 0 && i + 1 < argc) {
            reid_weight = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--reid-cos") == 0 && i + 1 < argc) {
            reid_cos_thresh = static_cast<float>(atof(argv[++i]));
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            PrintUsage(argv[0]);
            return SUCCESS;
        }
    }

    if (test_ocsort) {
        return RunOcsortSelfTest();
    }

    // Validate required arguments
    if (model_dir.empty()) {
        fprintf(stderr, "Error: --model is required\n\n");
        PrintUsage(argv[0]);
        return ERR_INVALID_ARGS;
    }

    // Determine mode and run
    if (track_mode) {
        // Tracking mode
        std::vector<std::string> image_paths;
        
        if (!images_file.empty()) {
            image_paths = ReadPathsFromFile(images_file);
        } else {
            image_paths = ReadPathsFromStdin();
        }
        
        return RunTracking(model_dir, image_paths, conf_thresh, iou_thresh,
                          detection_fps, video_fps,
                          reid_model_dir, reid_weight, reid_cos_thresh);
    } else if (!image_path.empty()) {
        // Single image detection mode
        return RunDetection(model_dir, image_path, conf_thresh, nms_thresh);
    } else {
        fprintf(stderr, "Error: Either --image or --track is required\n\n");
        PrintUsage(argv[0]);
        return ERR_INVALID_ARGS;
    }
}
