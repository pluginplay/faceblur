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
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple


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
    reid_model_dir: str | None,
    video_fps: float,
    detection_fps: float = 10.0,
    conf_thresh: float = 0.5,
    iou_thresh: float = 0.15,
) -> Dict[str, Any]:
    """Run the C++ face_pipeline executable and return tracking results.
    
    Args:
        frame_paths: List of frame image paths
        model_dir: Directory containing scrfd.param and scrfd.bin
        reid_model_dir: Optional directory containing MobileFaceNet ncnn files
        video_fps: Source video FPS
        detection_fps: Detection sampling rate
        conf_thresh: Confidence threshold
        iou_thresh: Tracking IoU threshold
    
    Returns:
        Parsed JSON output with tracks
    """
    script_dir = Path(__file__).parent.parent
    executable_path = script_dir / "src" / "bin" / "face_pipeline"
    
    if not executable_path.exists():
        raise FileNotFoundError(f"face_pipeline executable not found at {executable_path}")
    
    if not Path(model_dir).exists():
        raise FileNotFoundError(f"Model directory not found: {model_dir}")
    
    # Build command
    cmd = [
        str(executable_path),
        "--model", model_dir,
        "--track",
        "--video-fps", str(video_fps),
        "--detection-fps", str(detection_fps),
        "--conf", str(conf_thresh),
        "--iou", str(iou_thresh),
    ]

    if reid_model_dir and Path(reid_model_dir).exists():
        cmd += ["--reid-model", reid_model_dir]
    
    # Prepare frame paths as input (one per line)
    frame_input = "\n".join(frame_paths).encode("utf-8")
    
    # Set up environment for dynamic library loading (macOS/Linux)
    env = os.environ.copy()
    executable_dir = str(Path(executable_path).parent)
    # Enable a single summary log line from the native pipeline (stderr).
    env["FACE_PIPELINE_LOG_GMC"] = "1"
    env["FACE_PIPELINE_LOG_REID"] = "1"

    blur_skip = _get_env_float("FACE_PIPELINE_REID_BLUR_SKIP_VAR", 12.0)
    blur_sharpen = _get_env_float("FACE_PIPELINE_REID_BLUR_SHARPEN_VAR", 50.0)
    lap_alpha = _get_env_float("FACE_PIPELINE_REID_LAPLACIAN_ALPHA", 0.6)
    env.setdefault("FACE_PIPELINE_REID_BLUR_SKIP_VAR", str(blur_skip))
    env.setdefault("FACE_PIPELINE_REID_BLUR_SHARPEN_VAR", str(blur_sharpen))
    env.setdefault("FACE_PIPELINE_REID_LAPLACIAN_ALPHA", str(lap_alpha))
    print(
        "ReID blur gates: "
        f"skip_var={env['FACE_PIPELINE_REID_BLUR_SKIP_VAR']} "
        f"sharpen_var={env['FACE_PIPELINE_REID_BLUR_SHARPEN_VAR']} "
        f"lap_alpha={env['FACE_PIPELINE_REID_LAPLACIAN_ALPHA']}",
        file=sys.stderr,
    )
    
    if sys.platform == "darwin":
        # macOS: add executable directory to dylib search path
        existing_path = env.get("DYLD_LIBRARY_PATH", "")
        env["DYLD_LIBRARY_PATH"] = (
            f"{executable_dir}:{existing_path}" if existing_path else executable_dir
        )
    elif sys.platform == "linux":
        # Linux: add executable directory to shared library search path
        existing_path = env.get("LD_LIBRARY_PATH", "")
        env["LD_LIBRARY_PATH"] = (
            f"{executable_dir}:{existing_path}" if existing_path else executable_dir
        )
    # Windows: DLLs in the same directory as .exe are found automatically
    
    print("Running face_pipeline executable...", file=sys.stderr)
    try:
        result = subprocess.run(
            cmd,
            input=frame_input,
            capture_output=True,
            check=True,
            text=False,
            env=env,
        )

        # Forward any native logs (stderr) to our stderr for dev visibility.
        if result.stderr:
            stderr_text = result.stderr.decode("utf-8", errors="replace").strip()
            if stderr_text:
                print(stderr_text, file=sys.stderr)
                reid_lines = [
                    line for line in stderr_text.splitlines()
                    if line.startswith("ReID:")
                ]
                if reid_lines:
                    print("ReID summary:", file=sys.stderr)
                    for line in reid_lines:
                        print(f"  {line}", file=sys.stderr)
        
        # Parse JSON output
        output_text = result.stdout.decode("utf-8")
        tracking_data = json.loads(output_text)
        
        print(f"Found {len(tracking_data.get('tracks', []))} tracks", file=sys.stderr)
        return tracking_data
        
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


def render_debug_video(
    video_path: str,
    tracking_data: Dict[str, Any],
    output_path: str,
    fps: float,
    width: int,
    height: int,
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
    
    # Build frame index -> tracks mapping
    # tracks: [{"id": 0, "frames": [{"frameIndex": 0, "bbox": [x1, y1, x2, y2], "confidence": 0.9}]}]
    frame_tracks: Dict[int, List[Dict[str, Any]]] = {}
    
    for track in tracking_data.get("tracks", []):
        track_id = track["id"]
        color = FACE_COLORS[track_id % len(FACE_COLORS)]
        
        for frame_data in track.get("frames", []):
            frame_idx = frame_data["frameIndex"]
            if frame_idx not in frame_tracks:
                frame_tracks[frame_idx] = []
            
            frame_tracks[frame_idx].append({
                "track_id": track_id,
                "bbox": frame_data["bbox"],  # Normalized [x1, y1, x2, y2]
                "confidence": frame_data.get("confidence", 0.0),
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
            
            # Draw bounding boxes for this frame
            if frame_count in frame_tracks:
                for track_info in frame_tracks[frame_count]:
                    bbox_norm = track_info["bbox"]
                    color = track_info["color"]
                    track_id = track_info["track_id"]
                    confidence = track_info["confidence"]
                    
                    # Convert normalized coordinates to pixels
                    x1 = int(bbox_norm[0] * width)
                    y1 = int(bbox_norm[1] * height)
                    x2 = int(bbox_norm[2] * width)
                    y2 = int(bbox_norm[3] * height)
                    
                    # Draw bounding box
                    _draw_hollow_rectangle(frame, x1, y1, x2, y2, color, BORDER_THICKNESS)
                    
                    # Draw track ID and confidence
                    label = f"ID:{track_id} ({confidence:.2f})"
                    label_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                    label_y = max(y1 - 5, label_size[1] + 5)
                    
                    # Draw label background
                    cv2.rectangle(
                        frame,
                        (x1, label_y - label_size[1] - 5),
                        (x1 + label_size[0] + 5, label_y + 5),
                        color,
                        -1,
                    )
                    # Draw label text
                    cv2.putText(
                        frame,
                        label,
                        (x1 + 2, label_y),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.5,
                        (255, 255, 255),
                        1,
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
    conf_thresh: float = 0.5,
    iou_thresh: float = 0.15,
    keep_frames: bool = False,
) -> None:
    """Run the complete test pipeline."""
    script_dir = Path(__file__).parent.parent
    model_dir = str(script_dir / "src" / "bin" / "models")
    reid_dir = str(script_dir / "src" / "bin" / "models" / "mobilefacenet_arcface")
    
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
        
        frame_paths, fps, width, height = extract_frames(video_path, temp_path)
        
        if len(frame_paths) == 0:
            raise ValueError("No frames extracted from video")
        
        # Run face pipeline
        tracking_data = run_face_pipeline(
            frame_paths=frame_paths,
            model_dir=model_dir,
            reid_model_dir=reid_dir,
            video_fps=fps,
            detection_fps=detection_fps,
            conf_thresh=conf_thresh,
            iou_thresh=iou_thresh,
        )
        
        # Save tracking data for debugging
        tracking_output_path = output_dir / "tracking_output.json"
        with open(tracking_output_path, 'w') as f:
            import json as json_module
            json_module.dump(tracking_data, f, indent=2)
        print(f"Saved tracking data to {tracking_output_path}", file=sys.stderr)
        
        # Render debug video
        print(f"Rendering debug video to {output_path}...", file=sys.stderr)
        render_debug_video(
            video_path=video_path,
            tracking_data=tracking_data,
            output_path=output_path,
            fps=fps,
            width=width,
            height=height,
        )
        
        # Optionally keep frames
        if keep_frames:
            frames_dir = Path(output_path).parent / f"{Path(output_path).stem}_frames"
            frames_dir.mkdir(exist_ok=True)
            for frame_path in frame_paths:
                frame_name = Path(frame_path).name
                import shutil
                shutil.copy2(frame_path, frames_dir / frame_name)
            print(f"Frames saved to {frames_dir}", file=sys.stderr)
    
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
