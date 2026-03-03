#!/usr/bin/env python3
"""
Dev script: test the C++ face tracking pipeline and generate a debug video.

This script:
1. Extracts frames from an input video
2. Runs the C++ face_pipeline executable in tracking mode
3. Renders face bounding boxes onto the video using OpenCV
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import math
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple, Optional

try:
    import resource
except ImportError:  # Windows
    resource = None  # type: ignore[assignment]


# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

# Colors (OpenCV uses BGR)
FACE_COLORS: List[Tuple[int, int, int]] = [
    (0, 255, 0),      # Green
    (255, 0, 0),      # Blue
    (0, 0, 255),      # Red
    (255, 255, 0),    # Cyan
    (255, 0, 255),    # Magenta
    (0, 255, 255),    # Yellow
    (128, 0, 128),    # Purple
    (255, 165, 0),    # Orange
]

BORDER_THICKNESS = 2
LABEL_FONT_SCALE = 0.6
LABEL_FONT_THICKNESS = 1
LABEL_SHADOW_OFFSET = (1, 1)
COLOR_MUTING_FACTOR = 0.28


# -----------------------------------------------------------------------------
# Frame Extraction
# -----------------------------------------------------------------------------

def _get_env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    """Convert arbitrary value to float, or return default on failure."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def extract_frames(video_path: str, output_dir: Path) -> Tuple[List[str], float, int, int]:
    """Extract frames from video to output directory.
    
    Returns:
        Tuple of (frame_paths, fps, width, height)
    """
    try:
        import cv2
    except ImportError as e:
        raise RuntimeError(
            "opencv-python is not installed. Install with: pip install opencv-python"
        ) from e
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {video_path}")
    
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    
    frame_paths: List[str] = []
    frame_count = 0
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            frame_filename = output_dir / f"frame_{frame_count:06d}.jpg"
            cv2.imwrite(str(frame_filename), frame)
            frame_paths.append(str(frame_filename))
            frame_count += 1
            
            if frame_count % 30 == 0:
                print(f"Extracted {frame_count} frames...", file=sys.stderr)
    finally:
        cap.release()
    
    print(f"Extracted {frame_count} frames total", file=sys.stderr)
    return frame_paths, fps, width, height


# -----------------------------------------------------------------------------
# C++ Executable Interface
# -----------------------------------------------------------------------------

def run_face_pipeline(
    frame_paths: List[str],
    model_dir: str,
    body_reid_model_dir: str | None,
    video_fps: float,
    detection_fps: float = 10.0,
    gmc_fps: float = 0.0,
    conf_thresh: float = 0.5,
    iou_thresh: float = 0.15,
) -> Tuple[Dict[str, Any], Dict[int, Dict[str, float]], Dict[str, float]]:
    """Run the C++ face_pipeline executable and return tracking results.
    
    Args:
        frame_paths: List of frame image paths
        model_dir: Root model directory
        body_reid_model_dir: Optional directory containing OSNet ONNX files
        video_fps: Source video FPS
        detection_fps: Detection sampling rate
        gmc_fps: GMC sampling rate (0 = follow detection/video fps)
        conf_thresh: Confidence threshold
        iou_thresh: Tracking IoU threshold
    
    Returns:
        Parsed JSON output, GMC info map, and profile metrics
    """
    script_dir = Path(__file__).parent.parent
    if sys.platform == "darwin":
        executable_path = (
            script_dir
            / "src"
            / "bin"
            / "face_pipeline.app"
            / "Contents"
            / "MacOS"
            / "face_pipeline"
        )
    elif sys.platform == "win32":
        executable_path = script_dir / "src" / "bin" / "face_pipeline.exe"
    else:
        executable_path = script_dir / "src" / "bin" / "face_pipeline"
    
    if not executable_path.exists():
        raise FileNotFoundError(f"face_pipeline executable not found at {executable_path}")
    
    if not Path(model_dir).exists():
        raise FileNotFoundError(f"Model directory not found: {model_dir}")
    
    # Build command
    cmd = [
        str(executable_path),
        "--model", model_dir,
        "--person-model-dir", str(Path(model_dir) / "rf_detr_small"),
        "--face-model-dir", model_dir,
        "--track",
        "--video-fps", str(video_fps),
        "--detection-fps", str(detection_fps),
        "--conf", str(conf_thresh),
        "--iou", str(iou_thresh),
    ]

    if gmc_fps and gmc_fps > 0.0:
        cmd += ["--gmc-fps", str(gmc_fps)]

    if body_reid_model_dir and Path(body_reid_model_dir).exists():
        cmd += ["--body-reid-model-dir", body_reid_model_dir]
    
    # Prepare frame paths as input (one per line)
    frame_input = "\n".join(frame_paths).encode("utf-8")
    
    # Set up environment for dynamic library loading (macOS/Linux)
    env = os.environ.copy()
    executable_dir = str(Path(executable_path).parent)
    executable_lib_dir = str(Path(executable_path).parent / "lib")
    # Enable a single summary log line from the native pipeline (stderr).
    env["FACE_PIPELINE_LOG_GMC"] = "1"
    
    if sys.platform == "linux":
        # Linux: include executable and bundled lib/ in shared library search path
        existing_path = env.get("LD_LIBRARY_PATH", "")
        bundle_paths = (
            f"{executable_dir}:{executable_lib_dir}"
            if Path(executable_lib_dir).exists()
            else executable_dir
        )
        env["LD_LIBRARY_PATH"] = (
            f"{bundle_paths}:{existing_path}" if existing_path else bundle_paths
        )
    # Windows: DLLs in the same directory as .exe are found automatically
    
    print("Running face_pipeline executable...", file=sys.stderr)
    try:
        wall_start = time.perf_counter()
        cpu_start = resource.getrusage(resource.RUSAGE_CHILDREN) if resource else None
        result = subprocess.run(
            cmd,
            input=frame_input,
            capture_output=True,
            check=True,
            text=False,
            env=env,
        )
        wall_end = time.perf_counter()
        cpu_end = resource.getrusage(resource.RUSAGE_CHILDREN) if resource else None

        gmc_info: Dict[int, Dict[str, float]] = {}
        # Forward any native logs (stderr) to our stderr for dev visibility.
        if result.stderr:
            stderr_text = result.stderr.decode("utf-8", errors="replace").strip()
            if stderr_text:
                print(stderr_text, file=sys.stderr)
                gmc_pattern = re.compile(r"^GMC: frame=(\d+) ok=(\d+) m=\[([^\]]+)\]")
                for line in stderr_text.splitlines():
                    m = gmc_pattern.match(line.strip())
                    if not m:
                        continue
                    frame_idx = int(m.group(1))
                    ok = 1.0 if m.group(2) == "1" else 0.0
                    raw = m.group(3).replace(";", " ")
                    parts = raw.split()
                    if len(parts) != 9:
                        continue
                    vals = [float(p) for p in parts]
                    dx = vals[2]
                    dy = vals[5]
                    mag = math.hypot(dx, dy)
                    gmc_info[frame_idx] = {
                        "ok": ok,
                        "dx": dx,
                        "dy": dy,
                        "mag": mag,
                        "m00": vals[0],
                        "m01": vals[1],
                        "m02": vals[2],
                        "m10": vals[3],
                        "m11": vals[4],
                        "m12": vals[5],
                        "m20": vals[6],
                        "m21": vals[7],
                        "m22": vals[8],
                    }
        
        # Parse JSON output
        output_text = result.stdout.decode("utf-8")
        tracking_data = json.loads(output_text)

        wall_time = max(1e-9, wall_end - wall_start)
        if cpu_start is not None and cpu_end is not None:
            child_cpu = (
                (cpu_end.ru_utime - cpu_start.ru_utime)
                + (cpu_end.ru_stime - cpu_start.ru_stime)
            )
        else:
            child_cpu = 0.0
        processing_fps = float(len(frame_paths)) / wall_time
        realtime_factor = processing_fps / max(1e-6, video_fps)
        avg_cores = child_cpu / wall_time
        profile = {
            "wallTimeSec": wall_time,
            "childCpuTimeSec": child_cpu,
            "processingFps": processing_fps,
            "videoFps": float(video_fps),
            "realtimeFactor": realtime_factor,
            "avgCpuCores": avg_cores,
        }
        print(
            "Performance: "
            f"fps={processing_fps:.2f} "
            f"rtx={realtime_factor:.2f} "
            f"cpu_sec={child_cpu:.2f} "
            f"avg_cores={avg_cores:.2f}",
            file=sys.stderr,
        )

        print(
            f"Found {len(tracking_data.get('people', []))} people and "
            f"{len(tracking_data.get('faceTracks', []))} face tracks",
            file=sys.stderr,
        )
        return tracking_data, gmc_info, profile
        
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr.decode("utf-8") if e.stderr else "Unknown error"
        raise RuntimeError(f"face_pipeline failed: {error_msg}") from e
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse face_pipeline output: {e}") from e


# -----------------------------------------------------------------------------
# Video Rendering
# -----------------------------------------------------------------------------

def _draw_hollow_rectangle(
    frame: Any,  # numpy array
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    color: Tuple[int, int, int],
    thickness: int,
) -> None:
    """Draw a hollow rectangle on the frame."""
    import cv2
    
    cv2.line(frame, (x1, y1), (x2, y1), color, thickness)
    cv2.line(frame, (x1, y2), (x2, y2), color, thickness)
    cv2.line(frame, (x1, y1), (x1, y2), color, thickness)
    cv2.line(frame, (x2, y1), (x2, y2), color, thickness)


def _muted_color(color: Tuple[int, int, int], mix: float = COLOR_MUTING_FACTOR) -> Tuple[int, int, int]:
    """Blend a color with neutral gray to reduce saturation/brightness."""
    gray = 128
    mix_clamped = max(0.0, min(1.0, mix))
    return tuple(
        int(channel * (1.0 - mix_clamped) + gray * mix_clamped) for channel in color
    )


def _draw_text_with_shadow(
    frame: Any,
    text: str,
    org: Tuple[int, int],
    scale: float,
    text_color: Tuple[int, int, int],
    thickness: int,
    shadow_color: Tuple[int, int, int] = (0, 0, 0),
    shadow_offset: Tuple[int, int] = LABEL_SHADOW_OFFSET,
) -> None:
    """Draw readable text by rendering a subtle shadow first."""
    import cv2

    font_face = cv2.FONT_HERSHEY_DUPLEX
    x, y = org
    sx, sy = shadow_offset
    cv2.putText(
        frame,
        text,
        (x + sx, y + sy),
        font_face,
        scale,
        shadow_color,
        max(1, thickness + 1),
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        text,
        org,
        font_face,
        scale,
        text_color,
        thickness,
        cv2.LINE_AA,
    )


def render_debug_video(
    video_path: str,
    tracking_data: Dict[str, Any],
    output_path: str,
    fps: float,
    width: int,
    height: int,
    gmc_info: Optional[Dict[int, Dict[str, float]]] = None,
) -> None:
    """Render debug video with face bounding boxes overlaid.
    
    Args:
        video_path: Input video path
        tracking_data: JSON tracking data from face_pipeline
        output_path: Output video path
        fps: Video FPS
        width: Video width
        height: Video height
    """
    try:
        import cv2
    except ImportError as e:
        raise RuntimeError(
            "opencv-python is not installed. Install with: pip install opencv-python"
        ) from e
    
    # Ensure output directory exists and is writable
    output_dir = Path(output_path).parent
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        # Test write permissions
        test_file = output_dir / ".write_test"
        try:
            test_file.write_text("test")
            test_file.unlink()
        except (PermissionError, OSError) as e:
            # Fallback to current directory if Downloads isn't writable
            if "Downloads" in str(output_dir):
                output_path = str(Path.cwd() / Path(output_path).name)
                output_dir = Path(output_path).parent
                print(f"Downloads folder not writable, using: {output_path}", file=sys.stderr)
    except Exception as e:
        raise RuntimeError(f"Cannot create output directory {output_dir}: {e}") from e
    
    # Build frame maps from new schema:
    # people: [{id, frames:[{frameIndex,bbox,confidence}]}]
    # faceTracks: [{personId, frames:[{frameIndex,bbox,confidence,assocIou}]}]
    frame_people: Dict[int, List[Dict[str, Any]]] = {}
    frame_faces: Dict[int, List[Dict[str, Any]]] = {}

    for person in tracking_data.get("people", []):
        person_id = int(person["id"])
        for frame_data in person.get("frames", []):
            frame_idx = int(frame_data["frameIndex"])
            frame_people.setdefault(frame_idx, []).append({
                "person_id": person_id,
                "bbox": frame_data["bbox"],
                "confidence": frame_data.get("confidence", 0.0),
            })

    for track in tracking_data.get("faceTracks", []):
        person_id = int(track["personId"])
        color = _muted_color(FACE_COLORS[person_id % len(FACE_COLORS)])
        for frame_data in track.get("frames", []):
            frame_idx = int(frame_data["frameIndex"])
            frame_faces.setdefault(frame_idx, []).append({
                "person_id": person_id,
                "bbox": frame_data["bbox"],
                "confidence": frame_data.get("confidence", 0.0),
                "assoc_iou": frame_data.get("assocIou", 0.0),
                "color": color,
            })
    
    # Open input video
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {video_path}")
    
    # Create output video writer
    # Try multiple codecs in order of preference
    codecs = ["mp4v", "avc1", "XVID", "MJPG"]
    out = None
    fourcc = None
    
    for codec in codecs:
        try:
            fourcc = cv2.VideoWriter_fourcc(*codec)
            out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
            if out.isOpened():
                print(f"Using codec: {codec}", file=sys.stderr)
                break
            else:
                if out:
                    out.release()
                out = None
        except Exception as e:
            if out:
                out.release()
                out = None
            print(f"Codec {codec} failed: {e}", file=sys.stderr)
            continue
    
    if out is None or not out.isOpened():
        # Try with .avi extension as fallback
        if output_path.endswith('.mp4'):
            avi_path = output_path.replace('.mp4', '.avi')
            print(f"Trying AVI format: {avi_path}", file=sys.stderr)
            fourcc = cv2.VideoWriter_fourcc(*"XVID")
            out = cv2.VideoWriter(avi_path, fourcc, fps, (width, height))
            if out.isOpened():
                output_path = avi_path
                print(f"Using AVI format with XVID codec", file=sys.stderr)
            else:
                if out:
                    out.release()
                raise RuntimeError(
                    f"Failed to create output video: {output_path}. "
                    f"Tried codecs: {', '.join(codecs)}. "
                    f"Your OpenCV build may not support these codecs."
                )
        else:
            raise RuntimeError(
                f"Failed to create output video: {output_path}. "
                f"Tried codecs: {', '.join(codecs)}. "
                f"Your OpenCV build may not support these codecs."
            )
    
    frame_count = 0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Optional person boxes for diagnostics
            if frame_count in frame_people:
                for person_info in frame_people[frame_count]:
                    bbox_norm = person_info["bbox"]
                    person_id = person_info["person_id"]
                    person_color = _muted_color(FACE_COLORS[person_id % len(FACE_COLORS)])
                    x1 = int(bbox_norm[0] * width)
                    y1 = int(bbox_norm[1] * height)
                    x2 = int(bbox_norm[2] * width)
                    y2 = int(bbox_norm[3] * height)
                    _draw_hollow_rectangle(frame, x1, y1, x2, y2, person_color, 1)
                    _draw_text_with_shadow(
                        frame=frame,
                        text=f"P:{person_id}",
                        org=(x1 + 1, max(14, y1 - 2)),
                        scale=0.5,
                        text_color=(255, 255, 255),
                        thickness=1,
                    )

            # Associated face boxes (primary overlay)
            if frame_count in frame_faces:
                for face_info in frame_faces[frame_count]:
                    bbox_norm = face_info["bbox"]
                    color = face_info["color"]
                    person_id = face_info["person_id"]
                    confidence = face_info["confidence"]
                    assoc_iou = face_info["assoc_iou"]

                    x1 = int(bbox_norm[0] * width)
                    y1 = int(bbox_norm[1] * height)
                    x2 = int(bbox_norm[2] * width)
                    y2 = int(bbox_norm[3] * height)

                    _draw_hollow_rectangle(frame, x1, y1, x2, y2, color, BORDER_THICKNESS)

                    label = f"PID:{person_id} c={confidence:.2f} iou={assoc_iou:.2f}"
                    label_size, label_baseline = cv2.getTextSize(
                        label,
                        cv2.FONT_HERSHEY_DUPLEX,
                        LABEL_FONT_SCALE,
                        LABEL_FONT_THICKNESS,
                    )
                    label_y = max(y1 - 6, label_size[1] + label_baseline + 6)
                    label_x = x1
                    cv2.rectangle(
                        frame,
                        (label_x, label_y - label_size[1] - label_baseline - 6),
                        (label_x + label_size[0] + 8, label_y + 4),
                        color,
                        -1,
                    )
                    _draw_text_with_shadow(
                        frame=frame,
                        text=label,
                        org=(label_x + 4, label_y),
                        scale=LABEL_FONT_SCALE,
                        text_color=(255, 255, 255),
                        thickness=LABEL_FONT_THICKNESS,
                    )

            # Draw GMC overlay (if available for this frame)
            if gmc_info and frame_count in gmc_info:
                info = gmc_info[frame_count]
                gmc_label = (
                    f"GMC ok={int(info['ok'])} "
                    f"dx={info['dx']:.2f} dy={info['dy']:.2f} "
                    f"mag={info['mag']:.2f}"
                )
                gmc_scale = 0.55
                gmc_thickness = 1
                gmc_size, gmc_baseline = cv2.getTextSize(
                    gmc_label,
                    cv2.FONT_HERSHEY_DUPLEX,
                    gmc_scale,
                    gmc_thickness,
                )
                gx, gy = 10, 20
                cv2.rectangle(
                    frame,
                    (gx - 4, gy - gmc_size[1] - gmc_baseline - 6),
                    (gx + gmc_size[0] + 6, gy + 6),
                    (0, 0, 0),
                    -1,
                )
                _draw_text_with_shadow(
                    frame=frame,
                    text=gmc_label,
                    org=(gx, gy),
                    scale=gmc_scale,
                    text_color=(255, 255, 255),
                    thickness=gmc_thickness,
                )
            
            out.write(frame)
            frame_count += 1
            
            if frame_count % 30 == 0:
                progress = (frame_count / total_frames * 100.0) if total_frames > 0 else 0.0
                print(
                    f"Rendering frame {frame_count}/{total_frames} ({progress:.1f}%)",
                    file=sys.stderr,
                )
    finally:
        cap.release()
        out.release()
        print(f"Completed rendering {frame_count} frames", file=sys.stderr)


# -----------------------------------------------------------------------------
# Main Pipeline
# -----------------------------------------------------------------------------

def run_test(
    video_path: str,
    output_path: str,
    detection_fps: float = 10.0,
    gmc_fps: float = 0.0,
    conf_thresh: float = 0.5,
    iou_thresh: float = 0.15,
    keep_frames: bool = False,
) -> None:
    """Run the complete test pipeline."""
    total_start = time.perf_counter()
    stage_wall_sec: Dict[str, float] = {}

    script_dir = Path(__file__).parent.parent
    if sys.platform == "darwin":
        model_root = (
            script_dir
            / "src"
            / "bin"
            / "face_pipeline.app"
            / "Contents"
            / "Resources"
            / "models"
        )
    else:
        model_root = script_dir / "src" / "bin" / "models"
    model_dir = str(model_root)
    body_reid_dir = str(model_root / "osnet_ibn_x1_0")
    
    # Ensure output directory exists early (used for tracking JSON + video)
    output_dir = Path(output_path).parent
    output_dir.mkdir(parents=True, exist_ok=True)
    
    video_path_obj = Path(video_path)
    if not video_path_obj.exists():
        raise FileNotFoundError(f"Video not found: {video_path}")
    
    # Extract frames to temp directory
    with tempfile.TemporaryDirectory(prefix="face_pipeline_test_") as temp_dir:
        temp_path = Path(temp_dir)
        print(f"Extracting frames to {temp_path}...", file=sys.stderr)

        extract_start = time.perf_counter()
        frame_paths, fps, width, height = extract_frames(video_path, temp_path)
        stage_wall_sec["extractFrames"] = time.perf_counter() - extract_start
        
        if len(frame_paths) == 0:
            raise ValueError("No frames extracted from video")
        
        # Run face pipeline
        native_call_start = time.perf_counter()
        tracking_data, gmc_info, profile = run_face_pipeline(
            frame_paths=frame_paths,
            model_dir=model_dir,
            body_reid_model_dir=body_reid_dir,
            video_fps=fps,
            detection_fps=detection_fps,
            gmc_fps=gmc_fps,
            conf_thresh=conf_thresh,
            iou_thresh=iou_thresh,
        )
        stage_wall_sec["nativePipelineCall"] = time.perf_counter() - native_call_start
        stage_wall_sec["nativePipeline"] = _safe_float(
            profile.get("wallTimeSec"),
            stage_wall_sec["nativePipelineCall"],
        )

        # Save tracking data for debugging
        tracking_output_path = output_dir / f"{Path(output_path).stem}_tracking_output.json"
        if gmc_info:
            tracking_data["_gmc"] = [
                {"frameIndex": k, **v} for k, v in sorted(gmc_info.items())
            ]
        stats = tracking_data.get("stats", {})
        timing_ms = stats.get("timingMs", {})
        person_breakdown_sec = {
            "preprocess": _safe_float(timing_ms.get("personPreprocess")) / 1000.0,
            "infer": _safe_float(timing_ms.get("personInfer")) / 1000.0,
            "decode": _safe_float(timing_ms.get("personDecode")) / 1000.0,
        }
        person_breakdown_total_sec = sum(person_breakdown_sec.values())
        native_internal_sec = {
            "personDetect": _safe_float(timing_ms.get("personDetect")) / 1000.0,
            "bodyReid": _safe_float(timing_ms.get("bodyReid")) / 1000.0,
            "faceDetect": _safe_float(timing_ms.get("faceDetect")) / 1000.0,
            "associate": _safe_float(timing_ms.get("associate")) / 1000.0,
            "trackUpdate": _safe_float(timing_ms.get("trackUpdate")) / 1000.0,
        }
        native_internal_total_sec = sum(native_internal_sec.values())
        native_wall_sec = stage_wall_sec["nativePipeline"]
        native_overhead_sec = max(0.0, native_wall_sec - native_internal_total_sec)

        stage_wall_sec["nativePostProcess"] = max(
            0.0,
            stage_wall_sec["nativePipelineCall"] - stage_wall_sec["nativePipeline"],
        )

        save_start = time.perf_counter()
        tracking_data["profile"] = profile
        tracking_data["metrics"] = {
            "totalWallSec": 0.0,  # Filled after render stage.
            "frameCount": len(frame_paths),
            "videoFps": float(fps),
            "videoDurationSec": float(len(frame_paths)) / max(1e-9, float(fps)),
            "stagesSec": dict(stage_wall_sec),
            "nativeBreakdownSec": {
                **native_internal_sec,
                "internalTotal": native_internal_total_sec,
                "overhead": native_overhead_sec,
                "wall": native_wall_sec,
            },
            "personDetectBreakdownSec": {
                **person_breakdown_sec,
                "total": person_breakdown_total_sec,
            },
        }
        with open(tracking_output_path, 'w') as f:
            import json as json_module
            json_module.dump(tracking_data, f, indent=2)
        stage_wall_sec["saveTrackingJson"] = time.perf_counter() - save_start
        print(f"Saved tracking data to {tracking_output_path}", file=sys.stderr)
        
        # Render debug video
        print(f"Rendering debug video to {output_path}...", file=sys.stderr)
        render_start = time.perf_counter()
        render_debug_video(
            video_path=video_path,
            tracking_data=tracking_data,
            output_path=output_path,
            fps=fps,
            width=width,
            height=height,
            gmc_info=gmc_info,
        )
        stage_wall_sec["renderDebugVideo"] = time.perf_counter() - render_start
        
        # Optionally keep frames
        if keep_frames:
            keep_start = time.perf_counter()
            frames_dir = Path(output_path).parent / f"{Path(output_path).stem}_frames"
            frames_dir.mkdir(exist_ok=True)
            for frame_path in frame_paths:
                frame_name = Path(frame_path).name
                import shutil
                shutil.copy2(frame_path, frames_dir / frame_name)
            print(f"Frames saved to {frames_dir}", file=sys.stderr)
            stage_wall_sec["keepFrames"] = time.perf_counter() - keep_start

        total_wall_sec = time.perf_counter() - total_start
        stage_wall_sec["total"] = total_wall_sec
        total_stage_accounted = sum(v for k, v in stage_wall_sec.items() if k != "total")
        stage_wall_sec["unaccounted"] = max(0.0, total_wall_sec - total_stage_accounted)

        sorted_stages = sorted(
            ((k, v) for k, v in stage_wall_sec.items() if k != "total"),
            key=lambda kv: kv[1],
            reverse=True,
        )
        print("Timing breakdown (wall sec):", file=sys.stderr)
        for name, sec in sorted_stages:
            pct = (sec / total_wall_sec * 100.0) if total_wall_sec > 0 else 0.0
            fps_eff = (len(frame_paths) / sec) if sec > 0 and name not in {"saveTrackingJson", "unaccounted"} else 0.0
            if fps_eff > 0:
                print(
                    f"  {name:>18}: {sec:7.3f}s ({pct:5.1f}%) [{fps_eff:6.2f} fps]",
                    file=sys.stderr,
                )
            else:
                print(
                    f"  {name:>18}: {sec:7.3f}s ({pct:5.1f}%)",
                    file=sys.stderr,
                )
        print(f"  {'total':>18}: {total_wall_sec:7.3f}s (100.0%)", file=sys.stderr)

        print("Native pipeline internal timing (sec):", file=sys.stderr)
        native_sorted = sorted(native_internal_sec.items(), key=lambda kv: kv[1], reverse=True)
        for name, sec in native_sorted:
            pct = (sec / native_wall_sec * 100.0) if native_wall_sec > 0 else 0.0
            print(f"  {name:>18}: {sec:7.3f}s ({pct:5.1f}% of native wall)", file=sys.stderr)
        print(
            f"  {'overhead':>18}: {native_overhead_sec:7.3f}s "
            f"({(native_overhead_sec / native_wall_sec * 100.0) if native_wall_sec > 0 else 0.0:5.1f}% of native wall)",
            file=sys.stderr,
        )
        if native_internal_sec["personDetect"] > 0.0:
            print("Person detector breakdown (sec):", file=sys.stderr)
            for name, sec in sorted(person_breakdown_sec.items(), key=lambda kv: kv[1], reverse=True):
                pct = sec / native_internal_sec["personDetect"] * 100.0
                print(
                    f"  {name:>18}: {sec:7.3f}s ({pct:5.1f}% of personDetect)",
                    file=sys.stderr,
                )
            person_gap_sec = max(0.0, native_internal_sec["personDetect"] - person_breakdown_total_sec)
            print(
                f"  {'other':>18}: {person_gap_sec:7.3f}s "
                f"({(person_gap_sec / native_internal_sec['personDetect'] * 100.0):5.1f}% of personDetect)",
                file=sys.stderr,
            )

        # Refresh JSON with final timings including render + total.
        tracking_data["metrics"]["totalWallSec"] = total_wall_sec
        tracking_data["metrics"]["stagesSec"] = dict(stage_wall_sec)
        tracking_data["metrics"]["stagesPctOfTotal"] = {
            k: (v / total_wall_sec * 100.0) if total_wall_sec > 0 else 0.0
            for k, v in stage_wall_sec.items()
        }
        with open(tracking_output_path, 'w') as f:
            import json as json_module
            json_module.dump(tracking_data, f, indent=2)
        print(f"Updated metrics in {tracking_output_path}", file=sys.stderr)
    
    print(f"Success! Output video: {output_path}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test C++ face tracking pipeline and generate debug video"
    )
    parser.add_argument(
        "--video",
        required=True,
        help="Input video path",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output video path (default: <input>_faces_debug.mp4)",
    )
    parser.add_argument(
        "--detection-fps",
        type=float,
        default=10.0,
        help="Detection sampling rate (default: 10.0)",
    )
    parser.add_argument(
        "--gmc-fps",
        type=float,
        default=0.0,
        help="GMC sampling rate (0 = auto; default: 0.0)",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.5,
        help="Confidence threshold (default: 0.5)",
    )
    parser.add_argument(
        "--iou",
        type=float,
        default=0.15,
        help="Tracking IoU threshold (default: 0.15)",
    )
    parser.add_argument(
        "--keep-frames",
        action="store_true",
        help="Keep extracted frames in output directory",
    )
    
    args = parser.parse_args()
    
    # Determine output path - use temp directory by default on macOS
    if args.output:
        output_path = args.output
    else:
        video_path_obj = Path(args.video)
        output_filename = f"{video_path_obj.stem}_faces_debug.mp4"
        
        # Use temp directory by default
        import tempfile
        output_path = str(Path(tempfile.gettempdir()) / output_filename)
        print(f"Output will be saved to: {output_path}", file=sys.stderr)
    
    try:
        run_test(
            video_path=args.video,
            output_path=output_path,
            detection_fps=args.detection_fps,
            gmc_fps=args.gmc_fps,
            conf_thresh=args.conf,
            iou_thresh=args.iou,
            keep_frames=args.keep_frames,
        )
        
        # Print structured output
        print(
            json.dumps(
                {
                    "status": "success",
                    "output_video_path": output_path,
                    "input_video": args.video,
                },
                indent=2,
            )
        )
        
        # Open the folder containing the output video (macOS)
        if sys.platform == "darwin":
            try:
                # Use -R to reveal the file in Finder
                subprocess.run(["open", "-R", output_path], check=True)
                print(f"Opened folder containing: {output_path}", file=sys.stderr)
            except Exception as e:
                print(f"Could not open folder: {e}", file=sys.stderr)
    except Exception as e:
        print(
            json.dumps(
                {
                    "status": "error",
                    "error": str(e),
                },
                indent=2,
            ),
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
