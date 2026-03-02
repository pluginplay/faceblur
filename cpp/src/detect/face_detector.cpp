#include "detect/face_detector.hpp"

FaceDetector::FaceDetector(const FaceDetectionConfig& cfg)
    : detector_(cfg.model_dir + "/scrfd_2.5g_kps_640x640.onnx",
                640, 640,
                cfg.conf_thresh,
                cfg.nms_thresh,
                cfg.num_threads) {
    if (!detector_.IsLoaded()) {
        detector_ = ScrfdDetector(cfg.model_dir + "/scrfd.onnx",
                                  640, 640,
                                  cfg.conf_thresh,
                                  cfg.nms_thresh,
                                  cfg.num_threads);
    }
}

void FaceDetector::Detect(const FrameView& frame, std::vector<FaceDetection>& out) {
    out.clear();
    if (!detector_.IsLoaded() || !frame.isValid()) {
        return;
    }

    const std::vector<ScrfdFace> faces = detector_.Detect(frame.rgb, frame.width, frame.height);
    out.reserve(faces.size());
    for (const auto& face : faces) {
        FaceDetection det;
        det.bbox = BBox{face.bbox[0], face.bbox[1], face.bbox[2], face.bbox[3]};
        det.score = face.score;
        det.has_landmarks = true;
        det.landmarks = face.landmarks;
        out.push_back(det);
    }
}
