#!/usr/bin/env python3
"""
Face Detection Script using UniFace
Detects faces in an image and returns bounding boxes in normalized coordinates (0-1)

Optimized for Apple Silicon with CoreML acceleration.
Supports both single image and batch processing modes.
"""

import sys
import json
import cv2
import numpy as np
from uniface import RetinaFace
from uniface.constants import RetinaFaceWeights

# Maximum image dimension for processing (resize larger images for speed)
# Set to None to disable resizing, or a number like 1920 to limit max dimension
MAX_IMAGE_DIMENSION = 1920  # Resize images larger than this for faster processing

def detect_faces_in_image(detector, image_path, conf_thresh=0.5):
    """
    Detect faces in a single image using a pre-loaded detector
    
    Args:
        detector: Pre-initialized RetinaFace detector
        image_path: Path to the image file
        conf_thresh: Confidence threshold (for compatibility, detector already has this set)
    
    Returns:
        Detection result dictionary containing:
        - success: Boolean
        - faces: List of detections with bbox, confidence, landmarks
        - image_width, image_height: Original image dimensions
        - count: Number of faces detected
    """
    try:
        # Read image
        image = cv2.imread(image_path)
        if image is None:
            return {
                "error": f"Could not read image from {image_path}",
                "faces": []
            }
        
        # Get original image dimensions
        original_height, original_width = image.shape[:2]
        
        # Resize very large images for faster processing (maintains aspect ratio)
        # Detection accuracy remains good even on resized images
        scale_factor = 1.0
        if MAX_IMAGE_DIMENSION and max(original_width, original_height) > MAX_IMAGE_DIMENSION:
            if original_width > original_height:
                scale_factor = MAX_IMAGE_DIMENSION / original_width
                new_width = MAX_IMAGE_DIMENSION
                new_height = int(original_height * scale_factor)
            else:
                scale_factor = MAX_IMAGE_DIMENSION / original_height
                new_height = MAX_IMAGE_DIMENSION
                new_width = int(original_width * scale_factor)
            
            image = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
        
        # Get current image dimensions (may be resized)
        height, width = image.shape[:2]
        
        # Detect faces
        faces = detector.detect(image)
        
        # Convert to normalized coordinates and format results
        # If image was resized, we need to scale coordinates back to original size
        results = []
        for face in faces:
            bbox = face.get('bbox', [])
            confidence = face.get('confidence', 0.0)
            
            if len(bbox) >= 4:
                # bbox format from RetinaFace: [x1, y1, x2, y2] in pixel coordinates
                # Scale back to original dimensions if image was resized
                x1, y1, x2, y2 = bbox[0] / scale_factor, bbox[1] / scale_factor, bbox[2] / scale_factor, bbox[3] / scale_factor
                
                # Normalize to 0-1 range using original dimensions
                normalized_bbox = [
                    x1 / original_width,   # x1 normalized
                    y1 / original_height,  # y1 normalized
                    x2 / original_width,   # x2 normalized
                    y2 / original_height   # y2 normalized
                ]
                
                # Get landmarks if available
                landmarks = face.get('landmarks', [])
                normalized_landmarks = []
                if landmarks:
                    for landmark in landmarks:
                        if len(landmark) >= 2:
                            # Scale landmarks back to original dimensions
                            normalized_landmarks.append([
                                (landmark[0] / scale_factor) / original_width,
                                (landmark[1] / scale_factor) / original_height
                            ])
                
                results.append({
                    "bbox": normalized_bbox,
                    "confidence": float(confidence),
                    "landmarks": normalized_landmarks if normalized_landmarks else None
                })
        
        return {
            "success": True,
            "faces": results,
            "image_width": original_width,
            "image_height": original_height,
            "count": len(results)
        }
        
    except Exception as e:
        return {
            "error": str(e),
            "faces": []
        }

def detect_faces(image_path, conf_thresh=0.5):
    """
    Legacy single-image function (creates detector each time)
    For batch processing, use detect_faces_batch instead
    """
    detector = RetinaFace(conf_thresh=conf_thresh)
    return detect_faces_in_image(detector, image_path, conf_thresh)

def detect_faces_batch(image_paths, conf_thresh=0.5):
    """
    Process multiple images with a single detector instance (much faster!)
    
    Args:
        image_paths: List of image file paths
        conf_thresh: Confidence threshold for face detection
    
    Returns:
        List of detection results, one per image (in same order as input)
    """
    # Initialize detector once for all images
    detector = RetinaFace(conf_thresh=conf_thresh)
    
    results = []
    for idx, image_path in enumerate(image_paths):
        try:
            result = detect_faces_in_image(detector, image_path, conf_thresh)
            results.append(result)
        except Exception as e:
            # If one image fails, return error for that image but continue
            results.append({
                "error": str(e),
                "faces": [],
                "image_index": idx
            })
    
    return results

if __name__ == "__main__":
    # Check if we're receiving JSON input via stdin (batch mode)
    # or command line arguments (single image mode for backward compatibility)
    
    if not sys.stdin.isatty():
        # Batch mode: read JSON from stdin
        try:
            input_data = json.load(sys.stdin)
            
            if isinstance(input_data, dict) and "image_paths" in input_data:
                # Batch request format: {"image_paths": [...], "conf_thresh": 0.5}
                image_paths = input_data["image_paths"]
                conf_thresh = input_data.get("conf_thresh", 0.5)
                
                if not isinstance(image_paths, list) or len(image_paths) == 0:
                    print(json.dumps({
                        "error": "image_paths must be a non-empty array",
                        "results": []
                    }))
                    sys.exit(1)
                
                results = detect_faces_batch(image_paths, conf_thresh)
                print(json.dumps({
                    "success": True,
                    "results": results,
                    "count": len(results)
                }))
            else:
                print(json.dumps({
                    "error": "Invalid input format. Expected: {\"image_paths\": [...], \"conf_thresh\": 0.5}",
                    "results": []
                }))
                sys.exit(1)
        except json.JSONDecodeError as e:
            print(json.dumps({
                "error": f"Invalid JSON input: {e}",
                "results": []
            }))
            sys.exit(1)
        except Exception as e:
            print(json.dumps({
                "error": str(e),
                "results": []
            }))
            sys.exit(1)
    else:
        # Single image mode (backward compatibility)
        if len(sys.argv) < 2:
            print(json.dumps({
                "error": "Usage: python detect_faces.py <image_path> [conf_thresh]",
                "error_alt": "Or pipe JSON: echo '{\"image_paths\": [...], \"conf_thresh\": 0.5}' | python detect_faces.py",
                "faces": []
            }))
            sys.exit(1)
        
        image_path = sys.argv[1]
        conf_thresh = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
        
        result = detect_faces(image_path, conf_thresh)
        print(json.dumps(result))
