import { useEffect, useState, useRef, useCallback } from "react";
import { subscribeBackgroundColor } from "../lib/utils/bolt";
import { buildAndImportMogrtMulti } from "../lib/utils/mogrt";
import { buildAndImportMogrtFromTracks } from "../lib/utils/mogrt";
import { evalTS } from "../lib/utils/bolt";
import { canvasToNormalized, type MaskPoint } from "../lib/utils/mogrt/encoder";
import { fs, os, path } from "../lib/cep/node";
import {
  bboxToMaskPoints,
  detectFacesBatch,
  detectFacesIncremental,
  assignFacesToTracks,
  type FaceTrack,
} from "../lib/utils/faceDetection";

export const App = () => {
  const [bgColor, setBgColor] = useState("#282c34");
  const [statusMessage, setStatusMessage] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  type UIMask = {
    id: string;
    name: string;
    points: MaskPoint[];
    blurriness?: number;
    feather?: number;
    expansion?: number;
    keyframes?: Record<number, MaskPoint[]>; // frameIndex -> points mapping
  };
  const [masks, setMasks] = useState<UIMask[]>([]);
  const [activeMaskId, setActiveMaskId] = useState<string | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(
    null
  );
  const [isDrawing, setIsDrawing] = useState(false);
  const [menuOpenMaskId, setMenuOpenMaskId] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [displayDimensions, setDisplayDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDetectingFaces, setIsDetectingFaces] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const detectAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [faceTracks, setFaceTracks] = useState<FaceTrack[] | null>(null);
  const [detectionProgress, setDetectionProgress] = useState<{
    processed: number;
    total: number | null;
  }>({ processed: 0, total: null });
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.5);
  const [selectionInfo, setSelectionInfo] = useState<{
    startTicks: string;
    endTicks: string;
    ticksPerFrame: string;
    numFrames: number;
  } | null>(null);
  const [framePaths, setFramePaths] = useState<string[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playbackIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (window.cep) {
      subscribeBackgroundColor(setBgColor);
    }
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuOpenMaskId) {
        const target = e.target as HTMLElement;
        if (!target.closest("[data-mask-menu]")) {
          setMenuOpenMaskId(null);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpenMaskId]);

  // Redraw canvas whenever points, selection, or detected faces change
  useEffect(() => {
    drawCanvas();
  }, [masks, activeMaskId, selectedPointIndex, previewImage, imageDimensions]);

  // Update display dimensions when container resizes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !previewImage || !imageDimensions) return;

    const updateDisplayDimensions = () => {
      const img = imageRef.current;
      if (!img) return;

      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;

      const scale = Math.min(
        containerWidth / imageDimensions.width,
        containerHeight / imageDimensions.height
      );

      const displayWidth = imageDimensions.width * scale;
      const displayHeight = imageDimensions.height * scale;

      setDisplayDimensions({ width: displayWidth, height: displayHeight });
    };

    // Initial calculation
    updateDisplayDimensions();

    // Set up resize observer
    const resizeObserver = new ResizeObserver(updateDisplayDimensions);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [previewImage, imageDimensions]);

  // Ensure canvas drawing buffer matches the natural image size
  // This runs after the canvas element is actually mounted (when displayDimensions is set)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageDimensions) return;
    // Set the internal pixel size used for drawing; CSS sizing is handled separately
    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;
    // Redraw after resizing
    drawCanvas();
  }, [displayDimensions, imageDimensions]);

  // When user scrubs, update the displayed image to the selected frame
  useEffect(() => {
    if (framePaths.length === 0) return;
    const clamped = Math.max(
      0,
      Math.min(currentFrameIndex, framePaths.length - 1)
    );
    const nextPath = framePaths[clamped];
    // Update preview image (read as data URL if possible)
    try {
      if (fs.existsSync && fs.existsSync(nextPath)) {
        const imageBuffer = fs.readFileSync(nextPath);
        const base64 = Buffer.from(
          imageBuffer as unknown as Uint8Array
        ).toString("base64");
        const dataUrl = `data:image/png;base64,${base64}`;
        setPreviewImage(dataUrl);
      } else {
        setPreviewImage(nextPath);
      }
    } catch {
      setPreviewImage(nextPath);
    }
  }, [currentFrameIndex, framePaths]);

  // Helper to find frame for index (exact match, nearest previous, or earliest)
  const findFrameForIndex = (
    frames: Array<{
      frameIndex: number;
      bbox: [number, number, number, number];
    }>,
    index: number
  ) => {
    // exact match
    let f = frames.find((fr) => fr.frameIndex === index);
    if (f) return f;
    // nearest previous
    let prev = null as null | (typeof frames)[number];
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i].frameIndex <= index) {
        prev = frames[i];
        break;
      }
    }
    if (prev) return prev;
    // fallback to earliest
    return frames.length ? frames[0] : null;
  };

  // Helper to get points for a mask at a given frame index
  const getMaskPointsAtFrame = useCallback(
    (mask: UIMask, frameIndex: number): MaskPoint[] => {
      // If mask has keyframes, use them
      if (mask.keyframes) {
        // Try exact match first
        if (mask.keyframes[frameIndex]) {
          return mask.keyframes[frameIndex];
        }
        // Find nearest previous keyframe
        const frameIndices = Object.keys(mask.keyframes)
          .map(Number)
          .sort((a, b) => a - b);
        for (let i = frameIndices.length - 1; i >= 0; i--) {
          if (frameIndices[i] <= frameIndex) {
            return mask.keyframes[frameIndices[i]];
          }
        }
        // Fallback to earliest keyframe
        if (frameIndices.length > 0) {
          return mask.keyframes[frameIndices[0]];
        }
      }
      // Fallback to current points
      return mask.points;
    },
    []
  );

  // When scrubbing, update masks that have keyframes
  useEffect(() => {
    if (isDragging) return; // avoid fighting user while they drag a point

    setMasks((prev) => {
      return prev.map((m) => {
        // If mask has keyframes, update points from keyframes
        if (m.keyframes) {
          const pts = getMaskPointsAtFrame(m, currentFrameIndex);
          if (
            m.points.length === pts.length &&
            m.points.every(
              (p, i) =>
                Math.abs(p.x - pts[i].x) < 1e-6 &&
                Math.abs(p.y - pts[i].y) < 1e-6
            )
          ) {
            return m;
          }
          return { ...m, points: pts };
        }
        return m;
      });
    });
  }, [currentFrameIndex, isDragging, getMaskPointsAtFrame]);

  // Handle playback
  useEffect(() => {
    if (isPlaying && framePaths.length > 0) {
      playbackIntervalRef.current = setInterval(() => {
        setCurrentFrameIndex((prev) => {
          const next = prev + 1;
          if (next >= framePaths.length) {
            setIsPlaying(false);
            return prev;
          }
          return next;
        });
      }, 1000 / 30); // 30 fps playback
    } else {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    }

    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    };
  }, [isPlaying, framePaths.length]);

  // Helper function to check if a point is inside a polygon
  const isPointInPolygon = (
    point: { x: number; y: number },
    polygon: Array<{ x: number; y: number }>
  ): boolean => {
    if (polygon.length < 3) return false;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      const intersect =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !imageDimensions) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw each mask
    masks.forEach((mask) => {
      const pts = mask.points;
      if (pts.length > 0) {
        const isActive = mask.id === activeMaskId;
        const strokeColor = isActive ? "#00ffff" : "#ffff00";
        const fillColor = isActive
          ? "rgba(0, 255, 255, 0.2)"
          : "rgba(255, 255, 0, 0.2)";

        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = pts[i].x * imageDimensions.width;
          const y = pts[i].y * imageDimensions.height;
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        if (pts.length > 2) {
          const firstX = pts[0].x * imageDimensions.width;
          const firstY = pts[0].y * imageDimensions.height;
          ctx.lineTo(firstX, firstY);
        }

        // Fill the mask with translucent color
        ctx.fillStyle = fillColor;
        ctx.fill();

        // Draw the stroke
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw points
        pts.forEach((point, index) => {
          const x = point.x * imageDimensions.width;
          const y = point.y * imageDimensions.height;
          ctx.beginPath();
          const isSelected =
            mask.id === activeMaskId && index === selectedPointIndex;
          ctx.fillStyle = isSelected ? "#ff0000" : "#ffffff";
          ctx.arc(x, y, isSelected ? 6 : 4, 0, 2 * Math.PI);
          ctx.fill();
        });
      }
    });
  };

  const handleLoadAndRenderSequence = async () => {
    try {
      setIsRendering(true);
      setIsDetectingFaces(true);
      detectAbortRef.current.cancelled = false;
      setDetectionProgress({ processed: 0, total: null });
      setStatusMessage("Reading selection and setting In/Out…");

      const info = await evalTS("getSelectionRangeAndSetInOut");
      if (typeof info === "string") {
        setStatusMessage(info);
        setIsRendering(false);
        setIsDetectingFaces(false);
        return;
      }
      setSelectionInfo(info);

      // Create a temp folder for this render
      const tmpRoot = os.tmpdir();
      const folder = path.join(
        tmpRoot,
        `face_blur_seq_${Date.now().toString(36)}`
      );
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder);
      }

      // Start face detection in watch mode BEFORE rendering starts
      // This way detection begins as soon as first frame appears
      const detectionPromise = detectFacesIncremental(
        folder,
        info.numFrames,
        confidenceThreshold,
        (frameIndex, result, totalProcessed) => {
          // Update progress as each frame is detected
          setDetectionProgress({
            processed: totalProcessed,
            total: info.numFrames,
          });
          setStatusMessage(
            `Rendering & detecting faces… ${totalProcessed}/${info.numFrames} frames processed`
          );
        },
        async (allResults) => {
          // All frames detected - create tracks and update UI
          if (detectAbortRef.current.cancelled) {
            setIsDetectingFaces(false);
            setIsRendering(false);
            return;
          }

          const tracks = assignFacesToTracks(allResults);
          setFaceTracks(tracks);

          // Initialize editable masks from tracks with all keyframes stored
          const newMasks: UIMask[] = tracks.map((t, idx) => {
            const keyframes: Record<number, MaskPoint[]> = {};
            t.frames.forEach((f) => {
              keyframes[f.frameIndex] = bboxToMaskPoints(f.bbox);
            });

            let use = t.frames.find((f) => f.frameIndex === currentFrameIndex);
            if (!use) {
              use = t.frames[t.frames.length - 1];
            }
            const pts = use ? bboxToMaskPoints(use.bbox) : [];
            return {
              id: `track_${t.id}`,
              name: `Person ${idx + 1}`,
              points: pts,
              blurriness: 50,
              feather: 10,
              expansion: 0,
              keyframes,
            };
          });
          setMasks(newMasks);
          setActiveMaskId(newMasks[0]?.id ?? null);
          setSelectedPointIndex(null);

          setIsDetectingFaces(false);
          const finalFrameCount =
            allResults.length > 0 ? allResults.length : framePaths.length;
          setStatusMessage(
            `Complete! Rendered ${finalFrameCount} frames. Detected ${tracks.length} face track(s).`
          );
        },
        detectAbortRef.current
      ).catch((error) => {
        if (!detectAbortRef.current.cancelled) {
          setStatusMessage(`Face detection error: ${error.message}`);
          console.error("Face detection failed:", error);
          setIsDetectingFaces(false);
        }
      });

      // Start rendering (this happens in parallel with detection)
      setStatusMessage(
        `Rendering PNG sequence and detecting faces… (0/${info.numFrames} frames detected)`
      );

      const result = await evalTS("exportSelectionAsImageSequence", folder);
      setIsRendering(false);

      if (typeof result === "string") {
        setStatusMessage(result);
        detectAbortRef.current.cancelled = true;
        setIsDetectingFaces(false);
        return;
      }

      // Read all .png files
      const entries = fs.readdirSync(result.outputDir) as string[];
      const pngs = entries
        .filter((n) => n.toLowerCase().endsWith(".png"))
        .map((n) => path.join(result.outputDir, n));
      // Sort by numeric suffix if present
      pngs.sort((a, b) => {
        const na = parseInt(a.replace(/[^0-9]/g, "")) || 0;
        const nb = parseInt(b.replace(/[^0-9]/g, "")) || 0;
        return na - nb;
      });
      setFramePaths(pngs);
      setCurrentFrameIndex(0);

      // Wait for detection to complete
      await detectionPromise;
    } catch (e: any) {
      setStatusMessage(`Error: ${e.toString()}`);
      setIsRendering(false);
      setIsDetectingFaces(false);
      detectAbortRef.current.cancelled = true;
    }
  };

  const handleImageLoad = () => {
    const img = imageRef.current;
    const container = containerRef.current;
    if (img && container) {
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      setImageDimensions({ width: naturalWidth, height: naturalHeight });

      // Calculate displayed size (accounting for object-contain scaling)
      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;

      const scale = Math.min(
        containerWidth / naturalWidth,
        containerHeight / naturalHeight
      );

      const displayWidth = naturalWidth * scale;
      const displayHeight = naturalHeight * scale;

      setDisplayDimensions({ width: displayWidth, height: displayHeight });

      // Set canvas size to match natural image size (for drawing)
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = naturalWidth;
        canvas.height = naturalHeight;
      }
    }
  };

  const getCanvasCoordinates = (
    e: React.MouseEvent<HTMLCanvasElement>
  ): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || !imageDimensions) return null;

    // Get canvas bounding rect (accounts for CSS scaling)
    const rect = canvas.getBoundingClientRect();

    // Calculate click position relative to canvas
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Convert to natural canvas coordinates (accounting for CSS scaling)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = clickX * scaleX;
    const y = clickY * scaleY;

    return { x, y };
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imageDimensions) return;

    // Don't handle clicks if we're dragging (to avoid conflicts)
    if (isDragging) return;

    const coords = getCanvasCoordinates(e);
    if (!coords) return;

    // Normalize coordinates for point-in-polygon check
    const normalizedPoint = {
      x: coords.x / imageDimensions.width,
      y: coords.y / imageDimensions.height,
    };

    if (isDrawing) {
      if (!activeMaskId) return;
      // Normalize based on image dimensions (what we're drawing on)
      // We'll convert to sequence resolution when applying the mask
      setMasks((prev) =>
        prev.map((m) =>
          m.id === activeMaskId
            ? { ...m, points: [...m.points, normalizedPoint] }
            : m
        )
      );
    } else {
      // First, check if clicking on a point of the active mask
      if (activeMaskId) {
        const active = masks.find((m) => m.id === activeMaskId);
        if (active) {
          const threshold = 10;
          let found: number | null = null;
          for (let i = 0; i < active.points.length; i++) {
            const pointX = active.points[i].x * imageDimensions.width;
            const pointY = active.points[i].y * imageDimensions.height;
            const distance = Math.sqrt(
              Math.pow(coords.x - pointX, 2) + Math.pow(coords.y - pointY, 2)
            );
            if (distance <= threshold) {
              found = i;
              break;
            }
          }
          if (found !== null) {
            setSelectedPointIndex(found);
            return;
          }
        }
      }

      // Check if clicking inside any mask (from last to first to prioritize top masks)
      for (let i = masks.length - 1; i >= 0; i--) {
        const mask = masks[i];
        if (mask.points.length >= 3) {
          if (isPointInPolygon(normalizedPoint, mask.points)) {
            setActiveMaskId(mask.id);
            setSelectedPointIndex(null);
            return;
          }
        }
      }

      // If clicking outside all masks, clear selection
      setSelectedPointIndex(null);
    }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imageDimensions || isDrawing) return;
    if (!activeMaskId) return;

    const coords = getCanvasCoordinates(e);
    if (!coords) return;

    // Check if clicking on a point
    const active = masks.find((m) => m.id === activeMaskId);
    if (!active) return;
    const threshold = 10;
    let found: number | null = null;
    for (let i = 0; i < active.points.length; i++) {
      const pointX = active.points[i].x * imageDimensions.width;
      const pointY = active.points[i].y * imageDimensions.height;
      const distance = Math.sqrt(
        Math.pow(coords.x - pointX, 2) + Math.pow(coords.y - pointY, 2)
      );
      if (distance <= threshold) {
        found = i;
        break;
      }
    }
    if (found !== null) {
      setSelectedPointIndex(found);
      setIsDragging(true);
      e.preventDefault(); // Prevent default to avoid text selection
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || selectedPointIndex === null || !imageDimensions) return;
    if (!activeMaskId) return;

    const coords = getCanvasCoordinates(e);
    if (!coords) return;

    // Normalize based on image dimensions (what we're drawing on)
    const normalized = canvasToNormalized(
      coords.x,
      coords.y,
      imageDimensions.width,
      imageDimensions.height
    );

    setMasks((prev) =>
      prev.map((m) => {
        if (m.id !== activeMaskId) return m;
        const newPoints = [...m.points];
        newPoints[selectedPointIndex] = normalized;

        // Update keyframes if they exist - update current frame's keyframe
        const updatedMask = { ...m, points: newPoints };
        if (m.keyframes && framePaths.length > 0) {
          updatedMask.keyframes = {
            ...m.keyframes,
            [currentFrameIndex]: newPoints,
          };
        }

        return updatedMask;
      })
    );
  };

  const handleCanvasMouseUp = () => {
    setIsDragging(false);
  };

  const addMask = () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newMask: UIMask = {
      id,
      name: `Mask ${masks.length + 1}`,
      points: [],
      blurriness: 50,
      feather: 10,
      expansion: 0,
    };
    setMasks((prev) => [...prev, newMask]);
    setActiveMaskId(id);
    setSelectedPointIndex(null);
  };

  const removeMask = (maskId: string) => {
    setMasks((prev) => {
      const filtered = prev.filter((m) => m.id !== maskId);
      // Update active mask if the removed mask was active
      if (activeMaskId === maskId) {
        const remaining = filtered;
        setActiveMaskId(
          remaining.length ? remaining[remaining.length - 1].id : null
        );
      }
      return filtered;
    });
    setSelectedPointIndex(null);
  };

  const splitMask = (maskId: string, splitFrame: number) => {
    setMasks((prev) => {
      const mask = prev.find((m) => m.id === maskId);
      if (!mask || !mask.keyframes) {
        setStatusMessage("Cannot split mask: no keyframes found.");
        return prev;
      }

      // Get all keyframes at or after split frame
      const keyframesToMove: Record<number, MaskPoint[]> = {};
      const keyframesToKeep: Record<number, MaskPoint[]> = {};

      Object.keys(mask.keyframes).forEach((frameStr) => {
        const frameIndex = Number(frameStr);
        if (frameIndex >= splitFrame) {
          keyframesToMove[frameIndex] = mask.keyframes![frameIndex];
        } else {
          keyframesToKeep[frameIndex] = mask.keyframes![frameIndex];
        }
      });

      if (Object.keys(keyframesToMove).length === 0) {
        setStatusMessage("No keyframes to split at this frame.");
        return prev;
      }

      // Create new mask with keyframes from split point forward
      const newMaskId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const splitFrameIndices = Object.keys(keyframesToMove)
        .map(Number)
        .sort((a, b) => a - b);
      const firstSplitFrame = splitFrameIndices[0];
      const newMask: UIMask = {
        id: newMaskId,
        name: `${mask.name} (split)`,
        points: keyframesToMove[firstSplitFrame] || mask.points,
        blurriness: mask.blurriness ?? 50,
        feather: mask.feather ?? 10,
        expansion: mask.expansion ?? 0,
        keyframes: keyframesToMove,
      };

      // Update original mask to keep only keyframes before split
      const updatedMasks = prev.map((m) => {
        if (m.id !== maskId) return m;
        const lastKeptFrame = Object.keys(keyframesToKeep)
          .map(Number)
          .sort((a, b) => b - a)[0];
        return {
          ...m,
          keyframes: keyframesToKeep,
          points:
            lastKeptFrame !== undefined
              ? keyframesToKeep[lastKeptFrame]
              : m.points,
        };
      });

      setActiveMaskId(newMaskId);
      setSelectedPointIndex(null);
      setStatusMessage(`Split mask at frame ${splitFrame + 1}.`);
      return [...updatedMasks, newMask];
    });
  };

  const mergeMask = (sourceMaskId: string, targetMaskId: string) => {
    setMasks((prev) => {
      const sourceMask = prev.find((m) => m.id === sourceMaskId);
      const targetMask = prev.find((m) => m.id === targetMaskId);

      if (!sourceMask || !targetMask) {
        setStatusMessage("Cannot merge: mask not found.");
        return prev;
      }

      // Merge keyframes: only merge keyframes from current frame forward
      const mergedKeyframes: Record<number, MaskPoint[]> = {
        ...targetMask.keyframes,
      };

      if (sourceMask.keyframes) {
        Object.keys(sourceMask.keyframes).forEach((frameStr) => {
          const frameIndex = Number(frameStr);
          // Only merge keyframes from current frame forward
          if (frameIndex >= currentFrameIndex) {
            // Target takes precedence for overlapping frames
            if (!mergedKeyframes[frameIndex]) {
              mergedKeyframes[frameIndex] = sourceMask.keyframes![frameIndex];
            }
          }
        });
      }

      // Update target mask with merged keyframes
      const updatedMasks = prev
        .map((m) => {
          if (m.id === targetMaskId) {
            const currentFramePoints = getMaskPointsAtFrame(
              { ...m, keyframes: mergedKeyframes },
              currentFrameIndex
            );
            return {
              ...m,
              keyframes: mergedKeyframes,
              points: currentFramePoints,
            };
          }
          return m;
        })
        .filter((m) => m.id !== sourceMaskId); // Remove source mask

      // Update active mask if source was active
      if (activeMaskId === sourceMaskId) {
        setActiveMaskId(targetMaskId);
      }
      setSelectedPointIndex(null);
      setStatusMessage(
        `Merged ${sourceMask.name} into ${targetMask.name} from frame ${currentFrameIndex + 1} forward.`
      );
      return updatedMasks;
    });
  };

  const updateActiveMaskValue = (
    field: "blurriness" | "feather" | "expansion",
    value: number
  ) => {
    if (!activeMaskId) return;
    setMasks((prev) =>
      prev.map((m) => (m.id === activeMaskId ? { ...m, [field]: value } : m))
    );
  };

  const handleDetectFaces = async () => {
    if (framePaths.length === 0) {
      setStatusMessage("Render image sequence first.");
      return;
    }
    try {
      setIsDetectingFaces(true);
      detectAbortRef.current.cancelled = false;
      setStatusMessage("Running face detection on sequence…");
      const results = await detectFacesBatch(
        framePaths,
        confidenceThreshold,
        4,
        (done, total) => {
          setStatusMessage(`Detecting faces… ${done}/${total}`);
        },
        detectAbortRef.current
      );
      if (detectAbortRef.current.cancelled) {
        setStatusMessage("Detection cancelled.");
        return;
      }
      const tracks = assignFacesToTracks(results);
      setFaceTracks(tracks);

      // Initialize editable masks from tracks with all keyframes stored
      const newMasks: UIMask[] = tracks.map((t, idx) => {
        // Store all keyframes from the track
        const keyframes: Record<number, MaskPoint[]> = {};
        t.frames.forEach((f) => {
          keyframes[f.frameIndex] = bboxToMaskPoints(f.bbox);
        });

        // pick the bbox for the current frame if present, else nearest previous
        let use = t.frames.find((f) => f.frameIndex === currentFrameIndex);
        if (!use) {
          // fallback to last available
          use = t.frames[t.frames.length - 1];
        }
        const pts = use ? bboxToMaskPoints(use.bbox) : [];
        return {
          id: `track_${t.id}`,
          name: `Person ${idx + 1}`,
          points: pts,
          blurriness: 50,
          feather: 10,
          expansion: 0,
          keyframes,
        };
      });
      setMasks(newMasks);
      setActiveMaskId(newMasks[0]?.id ?? null);
      setSelectedPointIndex(null);
      setStatusMessage(
        `Detection complete. Tracks: ${tracks.length}. Masks initialized for current frame.`
      );
    } catch (error: any) {
      setStatusMessage(`Error detecting faces: ${error.message}`);
      console.error("Face detection failed:", error);
      setFaceTracks(null);
    } finally {
      setIsDetectingFaces(false);
    }
  };

  const handleApplyMasks = async () => {
    if (!selectionInfo) {
      setStatusMessage("Please load and render sequence first.");
      return;
    }

    // Use edited masks with keyframes if available
    if (masks.length > 0 && masks.some((m) => m.keyframes)) {
      try {
        setStatusMessage("Building and importing MOGRT from edited masks…");

        // Convert UI masks to track specs, using edited keyframes
        const trackSpecs = masks
          .filter((m) => m.keyframes && Object.keys(m.keyframes).length > 0)
          .map((m) => {
            // Convert keyframes object to array of { frameIndex, points }
            const frames = Object.keys(m.keyframes!)
              .map((frameStr) => ({
                frameIndex: Number(frameStr),
                points: m.keyframes![Number(frameStr)],
              }))
              .sort((a, b) => a.frameIndex - b.frameIndex);

            return {
              frames,
              blurriness: m.blurriness ?? 50,
              feather: m.feather ?? 10,
              expansion: m.expansion ?? 0,
            };
          });

        if (trackSpecs.length === 0) {
          setStatusMessage("No masks with keyframes found.");
          return;
        }

        const res = await buildAndImportMogrtFromTracks(trackSpecs, {
          ticksPerFrame: selectionInfo.ticksPerFrame,
          timeInTicks: selectionInfo.startTicks,
          videoTrackOffset: 1,
          audioTrackOffset: 0,
          numFrames:
            framePaths.length > 0 ? framePaths.length : selectionInfo.numFrames,
        });
        setStatusMessage(res);
        return;
      } catch (e: any) {
        setStatusMessage(`Error building from edited masks: ${e.toString()}`);
        console.error(e);
        // fall through to legacy if needed
      }
    }

    // Fallback: use original faceTracks if masks don't have keyframes
    if (faceTracks && selectionInfo) {
      try {
        setStatusMessage("Building and importing MOGRT from tracked faces…");
        const trackSpecs = faceTracks.map((t) => ({
          frames: t.frames.map((f) => ({
            frameIndex: f.frameIndex,
            points: bboxToMaskPoints(f.bbox),
          })),
          blurriness: 50,
          feather: 10,
          expansion: 0,
        }));
        const res = await buildAndImportMogrtFromTracks(trackSpecs, {
          ticksPerFrame: selectionInfo.ticksPerFrame,
          timeInTicks: selectionInfo.startTicks,
          videoTrackOffset: 1,
          audioTrackOffset: 0,
          numFrames:
            framePaths.length > 0 ? framePaths.length : selectionInfo.numFrames,
        });
        setStatusMessage(res);
        return;
      } catch (e: any) {
        setStatusMessage(`Error building from tracks: ${e.toString()}`);
        console.error(e);
        // fall through to legacy if needed
      }
    }

    // Legacy single-frame mask flow fallback
    if (masks.length === 0) {
      setStatusMessage("Please create at least one mask before applying.");
      return;
    }
    if (masks.some((m) => m.points.length < 3)) {
      setStatusMessage("Each mask must have at least 3 points.");
      return;
    }
    try {
      setStatusMessage("Building and importing MOGRT with multiple masks...");
      const maskSpecs = masks.map((m) => ({
        points: m.points,
        blurriness: m.blurriness ?? 50,
        feather: m.feather ?? 10,
        expansion: m.expansion ?? 0,
      }));
      const result = await buildAndImportMogrtMulti(
        undefined,
        undefined,
        1,
        0,
        maskSpecs
      );
      setStatusMessage(result);
    } catch (error: any) {
      setStatusMessage(`Error: ${error.toString()}`);
      console.error("Failed to build and import MOGRT:", error);
    }
  };

  return (
    <div className="app" style={{ backgroundColor: bgColor }}>
      <div className="flex flex-col h-full p-3 gap-3">
        {/* Image Preview Container */}
        <div
          ref={containerRef}
          className="flex-1 flex items-center justify-center bg-gray-900 rounded-lg overflow-hidden relative min-h-0"
        >
          {previewImage ? (
            <div className="relative w-full h-full flex items-center justify-center">
              <img
                ref={imageRef}
                src={
                  previewImage.startsWith("data:")
                    ? previewImage
                    : `file://${previewImage}`
                }
                alt="Frame preview"
                className="max-w-full max-h-full object-contain"
                onLoad={handleImageLoad}
              />
              {displayDimensions && (
                <canvas
                  ref={canvasRef}
                  className="absolute cursor-crosshair"
                  style={{
                    width: `${displayDimensions.width}px`,
                    height: `${displayDimensions.height}px`,
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    pointerEvents: "auto",
                  }}
                  onClick={handleCanvasClick}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                />
              )}
            </div>
          ) : (
            <div className="text-gray-400 text-center">
              <p>No preview image loaded</p>
              <p className="text-sm mt-2">
                Click "Load & Render Sequence" to begin
              </p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3">
          {/* Primary Actions */}
          <div className="flex gap-2 flex-wrap items-center">
            <button
              onClick={handleLoadAndRenderSequence}
              disabled={isRendering || isDetectingFaces}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
            >
              {isRendering || isDetectingFaces
                ? `Rendering & Detecting${detectionProgress.total ? ` (${detectionProgress.processed}/${detectionProgress.total})` : ""}...`
                : "Render & Detect Faces"}
            </button>
            <div className="flex items-center gap-2">
              <label className="text-gray-300 text-xs font-medium whitespace-nowrap">
                Confidence:
              </label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={confidenceThreshold}
                onChange={(e) =>
                  setConfidenceThreshold(parseFloat(e.target.value) || 0.5)
                }
                disabled={isDetectingFaces}
                className="w-20 px-2 py-1.5 bg-gray-700 text-gray-200 text-xs rounded-md border border-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <button
              onClick={handleDetectFaces}
              disabled={
                framePaths.length === 0 || isDetectingFaces || isRendering
              }
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
            >
              {isDetectingFaces ? "Detecting..." : "Detect Faces (Manual)"}
            </button>
            {(isDetectingFaces || isRendering) && (
              <button
                onClick={() => {
                  detectAbortRef.current.cancelled = true;
                  setIsDetectingFaces(false);
                  setIsRendering(false);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Mask Tools */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setIsDrawing(!isDrawing)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors shadow-sm ${
                isDrawing
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-gray-600 hover:bg-gray-700 text-white"
              }`}
            >
              {isDrawing ? "Stop Drawing" : "Start Drawing"}
            </button>
            <button
              onClick={addMask}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
            >
              Add Mask
            </button>
            <button
              onClick={handleApplyMasks}
              disabled={
                masks.length === 0 || masks.some((m) => m.points.length < 3)
              }
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
            >
              Apply Masks
            </button>
          </div>

          {/* Scrubber */}
          {framePaths.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md transition-colors shadow-sm flex items-center justify-center min-w-[60px]"
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <rect x="4" y="2" width="3" height="12" />
                    <rect x="9" y="2" width="3" height="12" />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M4 2 L14 8 L4 14 Z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, framePaths.length - 1)}
                value={currentFrameIndex}
                onChange={(e) => {
                  setCurrentFrameIndex(parseInt(e.target.value));
                  setIsPlaying(false);
                }}
                className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="text-gray-300 text-xs w-32 text-right font-mono">
                Frame {currentFrameIndex + 1} / {framePaths.length}
              </div>
            </div>
          )}

          {/* Mask List with Menu Buttons */}
          {masks.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 flex-wrap">
                {masks.map((m, idx) => (
                  <div
                    key={m.id}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors relative ${
                      m.id === activeMaskId
                        ? "bg-teal-600 text-white shadow-sm"
                        : "bg-gray-700 text-gray-200 hover:bg-gray-600"
                    }`}
                  >
                    <button
                      onClick={() => {
                        setActiveMaskId(m.id);
                        setSelectedPointIndex(null);
                      }}
                      className="text-sm font-medium"
                    >
                      {m.name || `Mask ${idx + 1}`} ({m.points.length})
                    </button>
                    {/* 3-dot menu button */}
                    {framePaths.length > 0 && (
                      <div className="relative" data-mask-menu>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpenMaskId(
                              menuOpenMaskId === m.id ? null : m.id
                            );
                          }}
                          className="px-1.5 py-0.5 hover:bg-black/20 rounded transition-colors"
                          title="Mask options"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 16 16"
                            fill="currentColor"
                          >
                            <circle cx="8" cy="4" r="1.5" />
                            <circle cx="8" cy="8" r="1.5" />
                            <circle cx="8" cy="12" r="1.5" />
                          </svg>
                        </button>
                        {menuOpenMaskId === m.id && (
                          <div className="absolute right-0 mt-1 bg-gray-800 border border-gray-700 rounded-md shadow-lg z-10 min-w-[180px]">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (m.keyframes) {
                                  splitMask(m.id, currentFrameIndex);
                                } else {
                                  setStatusMessage(
                                    "Cannot split: mask has no keyframes."
                                  );
                                }
                                setMenuOpenMaskId(null);
                              }}
                              disabled={!m.keyframes}
                              className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              Split at Frame {currentFrameIndex + 1}
                            </button>
                            <div className="border-t border-gray-700">
                              <div className="px-3 py-2 text-xs text-gray-400">
                                Merge into:
                              </div>
                              {masks
                                .filter((other) => other.id !== m.id)
                                .map((other) => (
                                  <button
                                    key={other.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      mergeMask(m.id, other.id);
                                      setMenuOpenMaskId(null);
                                    }}
                                    className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
                                  >
                                    {other.name ||
                                      `Mask ${masks.indexOf(other) + 1}`}
                                  </button>
                                ))}
                              {masks.filter((other) => other.id !== m.id)
                                .length === 0 && (
                                <div className="px-3 py-2 text-xs text-gray-500">
                                  No other masks available
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeMask(m.id);
                      }}
                      className="ml-0.5 hover:bg-red-600 rounded px-1.5 py-0.5 text-xs font-bold transition-colors"
                      title="Delete mask"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              {/* Mask Properties */}
              {activeMaskId && (
                <div className="flex gap-4 items-center flex-wrap pt-1 border-t border-gray-700">
                  <div className="flex items-center gap-2">
                    <label className="text-gray-300 text-xs font-medium min-w-[70px]">
                      Blurriness
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={300}
                      step={1}
                      value={
                        masks.find((m) => m.id === activeMaskId)?.blurriness ??
                        50
                      }
                      onChange={(e) =>
                        updateActiveMaskValue(
                          "blurriness",
                          Number(e.target.value)
                        )
                      }
                      className="w-32 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-600"
                    />
                    <span className="text-gray-400 text-xs w-8 text-right">
                      {masks.find((m) => m.id === activeMaskId)?.blurriness ??
                        50}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-gray-300 text-xs font-medium min-w-[70px]">
                      Feather
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={300}
                      step={1}
                      value={
                        masks.find((m) => m.id === activeMaskId)?.feather ?? 10
                      }
                      onChange={(e) =>
                        updateActiveMaskValue("feather", Number(e.target.value))
                      }
                      className="w-32 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-600"
                    />
                    <span className="text-gray-400 text-xs w-8 text-right">
                      {masks.find((m) => m.id === activeMaskId)?.feather ?? 10}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-gray-300 text-xs font-medium min-w-[70px]">
                      Expansion
                    </label>
                    <input
                      type="range"
                      min={-300}
                      max={300}
                      step={1}
                      value={
                        masks.find((m) => m.id === activeMaskId)?.expansion ?? 0
                      }
                      onChange={(e) =>
                        updateActiveMaskValue(
                          "expansion",
                          Number(e.target.value)
                        )
                      }
                      className="w-32 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-600"
                    />
                    <span className="text-gray-400 text-xs w-8 text-right">
                      {masks.find((m) => m.id === activeMaskId)?.expansion ?? 0}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Status Message */}
          {statusMessage && (
            <div className="px-3 py-2 bg-gray-800 rounded-md border border-gray-700">
              <p className="text-xs text-gray-300 whitespace-pre-wrap">
                {statusMessage}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
