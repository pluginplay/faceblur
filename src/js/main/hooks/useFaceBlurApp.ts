import {
  useEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { subscribeBackgroundColor } from "../../lib/utils/bolt";
import { buildAndImportMogrtFromTracks } from "../../lib/utils/mogrt";
import { evalTS } from "../../lib/utils/bolt";
import type { MaskPoint } from "../../lib/utils/mogrt/encoder";
import { fs, os, path } from "../../lib/cep/node";
import {
  bboxToMaskPoints,
  cancelFacePipeline,
  runFacePipeline,
  type FaceTrack,
} from "../../lib/utils/faceDetection";
import type {
  UIMask,
  Dimensions,
  SegmentDescriptor,
  MarkerPayload,
  MarkerMaskPayload,
  LoadedSegmentState,
  BatchJobState,
} from "../types";
import { usePipelineEvents } from "./usePipelineEvents";
import { useCanvas, isPointInPolygon } from "./useCanvas";

const POINT_HIT_THRESHOLD = 10;

function maskHasAnyValidShape(mask: UIMask): boolean {
  if (mask.keyframes) {
    return Object.values(mask.keyframes).some((pts) => pts.length >= 3);
  }
  return mask.points.length >= 3;
}

function getMaskPointsAtFrame(mask: UIMask, frameIndex: number): MaskPoint[] {
  if (mask.keyframes) {
    if (mask.keyframes[frameIndex]) return mask.keyframes[frameIndex];
    return [];
  }
  return mask.points;
}

function faceTracksToMasks(tracks: FaceTrack[]): UIMask[] {
  return tracks.map((track, idx) => {
    const keyframes: Record<number, MaskPoint[]> = {};
    track.frames.forEach((frame) => {
      keyframes[frame.frameIndex] = bboxToMaskPoints(frame.bbox);
    });
    const first = track.frames.find((frame) => frame.frameIndex === 0) ?? track.frames[0];
    return {
      id: `track_${track.id}`,
      name: `Person ${idx + 1}`,
      points: first ? bboxToMaskPoints(first.bbox) : [],
      blurriness: 50,
      feather: 10,
      expansion: 0,
      keyframes,
    };
  });
}

function markerMasksToUiMasks(markerMasks: MarkerMaskPayload[]): UIMask[] {
  return markerMasks.map((mask) => ({
    id: mask.id,
    name: mask.name,
    points: mask.points ?? [],
    blurriness: mask.blurriness,
    feather: mask.feather,
    expansion: mask.expansion,
    keyframes: mask.keyframes ?? {},
  }));
}

function uiMasksToMarkerMasks(masks: UIMask[]): MarkerMaskPayload[] {
  return masks.map((mask) => ({
    id: mask.id,
    name: mask.name,
    points: mask.points,
    blurriness: mask.blurriness ?? 50,
    feather: mask.feather ?? 10,
    expansion: mask.expansion ?? 0,
    keyframes: mask.keyframes ?? {},
  }));
}

export function useFaceBlurApp() {
  const [bgColor, setBgColor] = useState("#282c34");
  const [statusMessage, setStatusMessage] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [masks, setMasks] = useState<UIMask[]>([]);
  const [activeMaskId, setActiveMaskId] = useState<string | null>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(
    null
  );
  const [isDrawing, setIsDrawing] = useState(false);
  const [menuOpenMaskId, setMenuOpenMaskId] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<Dimensions | null>(
    null
  );
  const [displayDimensions, setDisplayDimensions] =
    useState<Dimensions | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDetectingFaces, setIsDetectingFaces] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [faceTracks, setFaceTracks] = useState<FaceTrack[] | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [loadedSegment, setLoadedSegment] = useState<LoadedSegmentState | null>(
    null
  );
  const [batchJob, setBatchJob] = useState<BatchJobState>({
    running: false,
    totalSegments: 0,
    completedSegments: 0,
  });
  const [selectedClipCount, setSelectedClipCount] = useState(0);
  const [framePaths, setFramePaths] = useState<string[]>([]);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playbackIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const detectAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const { getCanvasCoordinates, drawCanvas, toNormalized } = useCanvas(
    canvasRef,
    imageDimensions,
    masks,
    activeMaskId,
    selectedPointIndex
  );

  usePipelineEvents(setStatusMessage);

  useEffect(() => {
    if (window.cep) subscribeBackgroundColor(setBgColor);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuOpenMaskId) {
        const target = e.target as HTMLElement;
        if (!target.closest("[data-mask-menu]")) setMenuOpenMaskId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpenMaskId]);

  useEffect(() => {
    drawCanvas();
  }, [masks, activeMaskId, selectedPointIndex, previewImage, imageDimensions, drawCanvas]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !previewImage || !imageDimensions) return;
    const update = () => {
      const img = imageRef.current;
      if (!img) return;
      const rect = container.getBoundingClientRect();
      const scale = Math.min(
        rect.width / imageDimensions.width,
        rect.height / imageDimensions.height
      );
      setDisplayDimensions({
        width: imageDimensions.width * scale,
        height: imageDimensions.height * scale,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [previewImage, imageDimensions]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageDimensions) return;
    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;
    drawCanvas();
  }, [displayDimensions, imageDimensions, drawCanvas]);

  useEffect(() => {
    if (framePaths.length === 0) return;
    const clamped = Math.max(0, Math.min(currentFrameIndex, framePaths.length - 1));
    const nextPath = framePaths[clamped];
    try {
      if (fs.existsSync?.(nextPath)) {
        const buf = fs.readFileSync(nextPath);
        const base64 = Buffer.from(buf as unknown as Uint8Array).toString("base64");
        setPreviewImage(`data:image/png;base64,${base64}`);
      } else {
        setPreviewImage(nextPath);
      }
    } catch {
      setPreviewImage(nextPath);
    }
  }, [currentFrameIndex, framePaths]);

  useEffect(() => {
    if (isDragging) return;
    setMasks((prev) =>
      prev.map((m) => {
        if (!m.keyframes) return m;
        const pts = getMaskPointsAtFrame(m, currentFrameIndex);
        if (
          m.points.length === pts.length &&
          m.points.every(
            (p, i) =>
              Math.abs(p.x - pts[i].x) < 1e-6 &&
              Math.abs(p.y - pts[i].y) < 1e-6
          )
        )
          return m;
        return { ...m, points: pts };
      })
    );
  }, [currentFrameIndex, isDragging]);

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
      }, 1000 / 30);
    } else if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
        playbackIntervalRef.current = null;
      }
    };
  }, [isPlaying, framePaths.length]);

  const readPngSequence = useCallback((dir: string): string[] => {
    try {
      if (!dir || !fs.existsSync(dir)) return [];
      const entries = fs.readdirSync(dir) as string[];
      return entries
        .filter((name) => name.toLowerCase().endsWith(".png"))
        .map((name) => path.join(dir, name))
        .sort((a, b) => {
          const na = parseInt(a.replace(/[^0-9]/g, ""), 10) || 0;
          const nb = parseInt(b.replace(/[^0-9]/g, ""), 10) || 0;
          return na - nb;
        });
    } catch {
      return [];
    }
  }, []);

  const loadPayloadIntoPanel = useCallback(
    (
      markerGuid: string,
      payload: MarkerPayload,
      sequencePathsOverride?: string[]
    ) => {
      const nextFramePaths = sequencePathsOverride ?? readPngSequence(payload.pngDir);
      setFramePaths(nextFramePaths);
      setCurrentFrameIndex(0);
      const nextMasks = markerMasksToUiMasks(payload.masks);
      setMasks(nextMasks);
      setActiveMaskId(nextMasks[0]?.id ?? null);
      setSelectedPointIndex(null);
      setFaceTracks(null);
      setLoadedSegment({
        markerGuid,
        segment: payload.segment,
        pngDir: payload.pngDir,
      });
    },
    [readPngSequence]
  );

  const resetLoadedPanelState = useCallback(() => {
    setLoadedSegment(null);
    setFaceTracks(null);
    setMasks([]);
    setActiveMaskId(null);
    setSelectedPointIndex(null);
    setFramePaths([]);
    setCurrentFrameIndex(0);
    setPreviewImage(null);
    setIsPlaying(false);
  }, []);

  const persistCurrentMasksToLoadedMarker = useCallback(
    async (overrideMasks?: UIMask[]) => {
      if (!loadedSegment) return;
      const now = new Date().toISOString();
      const payload: MarkerPayload = {
        kind: "face-blur-segment",
        schemaVersion: 1,
        segment: loadedSegment.segment,
        pngDir: loadedSegment.pngDir,
        masks: uiMasksToMarkerMasks(overrideMasks ?? masks),
        createdAt: now,
        updatedAt: now,
      };
      const upsertResult = await evalTS("upsertSegmentMarker", payload);
      if (typeof upsertResult !== "string") {
        setLoadedSegment((prev) =>
          prev
            ? {
                ...prev,
                markerGuid: upsertResult.markerGuid,
              }
            : prev
        );
      }
    },
    [loadedSegment, masks]
  );

  const handleImageLoad = useCallback(() => {
    const img = imageRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setImageDimensions({ width: w, height: h });
    const rect = container.getBoundingClientRect();
    const scale = Math.min(rect.width / w, rect.height / h);
    setDisplayDimensions({ width: w * scale, height: h * scale });
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = w;
      canvas.height = h;
    }
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!imageDimensions || isDragging) return;
      const coords = getCanvasCoordinates(e);
      if (!coords) return;
      const normalized = {
        x: coords.x / imageDimensions.width,
        y: coords.y / imageDimensions.height,
      };

      if (isDrawing) {
        if (!activeMaskId) return;
        setMasks((prev) =>
          prev.map((m) =>
            m.id === activeMaskId
              ? { ...m, points: [...m.points, normalized] }
              : m
          )
        );
        return;
      }

      if (activeMaskId) {
        const active = masks.find((m) => m.id === activeMaskId);
        if (active) {
          for (let i = 0; i < active.points.length; i++) {
            const px = active.points[i].x * imageDimensions.width;
            const py = active.points[i].y * imageDimensions.height;
            const dist = Math.hypot(coords.x - px, coords.y - py);
            if (dist <= POINT_HIT_THRESHOLD) {
              setSelectedPointIndex(i);
              return;
            }
          }
        }
      }

      for (let i = masks.length - 1; i >= 0; i--) {
        const mask = masks[i];
        if (mask.points.length >= 3 && isPointInPolygon(normalized, mask.points)) {
          setActiveMaskId(mask.id);
          setSelectedPointIndex(null);
          return;
        }
      }
      setSelectedPointIndex(null);
    },
    [
      imageDimensions,
      isDragging,
      isDrawing,
      activeMaskId,
      masks,
      getCanvasCoordinates,
    ]
  );

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!imageDimensions || isDrawing || !activeMaskId) return;
      const coords = getCanvasCoordinates(e);
      if (!coords) return;
      const active = masks.find((m) => m.id === activeMaskId);
      if (!active) return;
      for (let i = 0; i < active.points.length; i++) {
        const px = active.points[i].x * imageDimensions.width;
        const py = active.points[i].y * imageDimensions.height;
        if (Math.hypot(coords.x - px, coords.y - py) <= POINT_HIT_THRESHOLD) {
          setSelectedPointIndex(i);
          setIsDragging(true);
          e.preventDefault();
          break;
        }
      }
    },
    [imageDimensions, isDrawing, activeMaskId, masks, getCanvasCoordinates]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (
        !isDragging ||
        selectedPointIndex === null ||
        !imageDimensions ||
        !activeMaskId
      )
        return;
      const coords = getCanvasCoordinates(e);
      if (!coords) return;
      const normalized = toNormalized(coords.x, coords.y);
      setMasks((prev) =>
        prev.map((m) => {
          if (m.id !== activeMaskId) return m;
          const newPoints = [...m.points];
          newPoints[selectedPointIndex] = normalized;
          const updated = { ...m, points: newPoints };
          if (m.keyframes && framePaths.length > 0) {
            updated.keyframes = {
              ...m.keyframes,
              [currentFrameIndex]: newPoints,
            };
          }
          return updated;
        })
      );
    },
    [
      isDragging,
      selectedPointIndex,
      imageDimensions,
      activeMaskId,
      framePaths.length,
      currentFrameIndex,
      getCanvasCoordinates,
      toNormalized,
    ]
  );

  const handleCanvasMouseUp = useCallback(() => setIsDragging(false), []);

  const handleLoadAndRenderSequence = useCallback(async () => {
    try {
      detectAbortRef.current.cancelled = false;
      setBatchJob({ running: true, totalSegments: 0, completedSegments: 0 });
      setIsRendering(true);
      setStatusMessage("Reading selected clips…");

      const rawSegments = await evalTS("getSelectedClipSegments");
      if (typeof rawSegments === "string") {
        setStatusMessage(rawSegments);
        return;
      }
      if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
        setStatusMessage("No selected clips found.");
        return;
      }
      const segments = rawSegments as SegmentDescriptor[];
      setBatchJob({
        running: true,
        totalSegments: segments.length,
        completedSegments: 0,
      });

      for (let i = 0; i < segments.length; i++) {
        if (detectAbortRef.current.cancelled) {
          throw new Error("Cancelled.");
        }
        const segment = segments[i];
        const label = `${i + 1}/${segments.length}`;
        const safeSegmentId = segment.segmentId.replace(/[^a-zA-Z0-9_-]/g, "_");
        const folder = path.join(
          os.tmpdir(),
          `face_blur_seg_${safeSegmentId}_${Date.now().toString(36)}`
        );
        if (!fs.existsSync(folder)) fs.mkdirSync(folder);

        setIsRendering(true);
        setIsDetectingFaces(false);
        setStatusMessage(`Rendering segment ${label} (${segment.numFrames} frames)…`);
        const renderResult = await evalTS(
          "exportSegmentAsImageSequence",
          segment,
          folder
        );
        if (typeof renderResult === "string") {
          throw new Error(`Segment ${label} render failed: ${renderResult}`);
        }

        const pngs = readPngSequence(renderResult.outputDir);
        if (pngs.length === 0) {
          throw new Error(`Segment ${label} rendered no frames.`);
        }

        setIsRendering(false);
        setIsDetectingFaces(true);
        setStatusMessage(`Detecting faces in segment ${label}…`);
        const pipelineResult = await runFacePipeline(pngs, {
          confThresh: confidenceThreshold,
          videoFps: 30.0,
          detectionFps: 5.0,
        });

        if (detectAbortRef.current.cancelled) {
          throw new Error("Cancelled.");
        }

        const generatedMasks = faceTracksToMasks(pipelineResult.tracks);
        const now = new Date().toISOString();
        const markerPayload: MarkerPayload = {
          kind: "face-blur-segment",
          schemaVersion: 1,
          segment,
          pngDir: renderResult.outputDir,
          masks: uiMasksToMarkerMasks(generatedMasks),
          createdAt: now,
          updatedAt: now,
        };
        const markerResult = await evalTS("upsertSegmentMarker", markerPayload);
        if (typeof markerResult === "string") {
          throw new Error(`Segment ${label} marker write failed: ${markerResult}`);
        }

        if (i === segments.length - 1) {
          loadPayloadIntoPanel(markerResult.markerGuid, markerPayload, pngs);
          setFaceTracks(pipelineResult.tracks);
        }

        setBatchJob({
          running: true,
          totalSegments: segments.length,
          completedSegments: i + 1,
        });
      }
      setStatusMessage(`Batch complete. Processed ${segments.length} segment(s).`);
    } catch (e: unknown) {
      setStatusMessage(`Error: ${e instanceof Error ? e.message : String(e)}`);
      setFaceTracks(null);
    } finally {
      setBatchJob((prev) => ({ ...prev, running: false }));
      setIsRendering(false);
      setIsDetectingFaces(false);
    }
  }, [confidenceThreshold, loadPayloadIntoPanel, readPngSequence]);

  const handleApplyMasks = useCallback(async () => {
    if (!loadedSegment) {
      setStatusMessage("Load a segment marker first.");
      return;
    }
    const segment = loadedSegment.segment;

    if (masks.length > 0 && masks.some((m) => m.keyframes)) {
      try {
        setStatusMessage("Building and importing MOGRT from edited masks…");
        const trackSpecs = masks
          .filter((m) => m.keyframes && Object.keys(m.keyframes).length > 0)
          .map((m) => {
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
          ticksPerFrame: segment.ticksPerFrame,
          timeInTicks: segment.startTicks,
          endTicks: segment.endTicks,
          videoTrackOffset: 1,
          audioTrackOffset: 0,
          numFrames:
            framePaths.length > 0 ? framePaths.length : segment.numFrames,
        });
        await persistCurrentMasksToLoadedMarker();
        setStatusMessage(res);
        return;
      } catch (e: unknown) {
        setStatusMessage(`Error building from edited masks: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }

    if (faceTracks) {
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
          ticksPerFrame: segment.ticksPerFrame,
          timeInTicks: segment.startTicks,
          endTicks: segment.endTicks,
          videoTrackOffset: 1,
          audioTrackOffset: 0,
          numFrames:
            framePaths.length > 0 ? framePaths.length : segment.numFrames,
        });
        await persistCurrentMasksToLoadedMarker();
        setStatusMessage(res);
        return;
      } catch (e: unknown) {
        setStatusMessage(`Error building from tracks: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

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
      const staticTrackSpecs = masks.map((m) => ({
        frames: [{ frameIndex: 0, points: m.points }],
        blurriness: m.blurriness ?? 50,
        feather: m.feather ?? 10,
        expansion: m.expansion ?? 0,
      }));
      const result = await buildAndImportMogrtFromTracks(staticTrackSpecs, {
        ticksPerFrame: segment.ticksPerFrame,
        timeInTicks: segment.startTicks,
        endTicks: segment.endTicks,
        videoTrackOffset: 1,
        audioTrackOffset: 0,
        numFrames: framePaths.length > 0 ? framePaths.length : segment.numFrames,
      });
      await persistCurrentMasksToLoadedMarker();
      setStatusMessage(result);
    } catch (error: unknown) {
      setStatusMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [
    masks,
    faceTracks,
    loadedSegment,
    framePaths.length,
    persistCurrentMasksToLoadedMarker,
  ]);

  const handlePanelMouseEnter = useCallback(async () => {
    const selectedSegments = await evalTS("getSelectedClipSegments");
    if (typeof selectedSegments === "string" || !Array.isArray(selectedSegments)) {
      setSelectedClipCount(0);
    } else {
      setSelectedClipCount(selectedSegments.length);
    }

    if (batchJob.running || isRendering || isDetectingFaces) return;
    const markerAtCti = await evalTS("findOwnedMarkerAtCTI");
    if (typeof markerAtCti === "string") {
      return;
    }
    if (!markerAtCti?.found) {
      resetLoadedPanelState();
      setStatusMessage("No segment marker at CTI.");
      return;
    }

    const payload = markerAtCti.payload as MarkerPayload;
    if (!payload || payload.kind !== "face-blur-segment") return;
    if (payload.schemaVersion !== 1 || !payload.segment) return;
    if (
      loadedSegment &&
      (loadedSegment.markerGuid === markerAtCti.markerGuid ||
        loadedSegment.segment.segmentId === payload.segment.segmentId)
    ) {
      return;
    }

    loadPayloadIntoPanel(markerAtCti.markerGuid, payload);
    setStatusMessage(
      `Loaded segment ${payload.segment.segmentId} from sequence marker.`
    );
  }, [
    batchJob.running,
    isRendering,
    isDetectingFaces,
    loadedSegment,
    loadPayloadIntoPanel,
    resetLoadedPanelState,
  ]);

  const addMask = useCallback(() => {
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
  }, [masks.length]);

  const removeMask = useCallback((maskId: string) => {
    setMasks((prev) => {
      const filtered = prev.filter((m) => m.id !== maskId);
      if (activeMaskId === maskId) {
        setActiveMaskId(filtered.length ? filtered[filtered.length - 1].id : null);
      }
      return filtered;
    });
    setSelectedPointIndex(null);
  }, [activeMaskId]);

  const splitMask = useCallback((maskId: string, splitFrame: number) => {
    setMasks((prev) => {
      const mask = prev.find((m) => m.id === maskId);
      if (!mask || !mask.keyframes) {
        setStatusMessage("Cannot split mask: no keyframes found.");
        return prev;
      }

      const keyframesToMove: Record<number, MaskPoint[]> = {};
      const keyframesToKeep: Record<number, MaskPoint[]> = {};

      Object.keys(mask.keyframes).forEach((frameStr) => {
        const fi = Number(frameStr);
        if (fi >= splitFrame) keyframesToMove[fi] = mask.keyframes![fi];
        else keyframesToKeep[fi] = mask.keyframes![fi];
      });

      if (Object.keys(keyframesToMove).length === 0) {
        setStatusMessage("No keyframes to split at this frame.");
        return prev;
      }

      const newMaskId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const firstSplitFrame = Math.min(...Object.keys(keyframesToMove).map(Number));
      const newMask: UIMask = {
        id: newMaskId,
        name: `${mask.name} (split)`,
        points: keyframesToMove[firstSplitFrame] || mask.points,
        blurriness: mask.blurriness ?? 50,
        feather: mask.feather ?? 10,
        expansion: mask.expansion ?? 0,
        keyframes: keyframesToMove,
      };

      const updatedMasks = prev.map((m) => {
        if (m.id !== maskId) return m;
        const lastKeptFrame = Math.max(
          ...Object.keys(keyframesToKeep).map(Number),
          -1
        );
        return {
          ...m,
          keyframes: keyframesToKeep,
          points:
            lastKeptFrame >= 0 ? keyframesToKeep[lastKeptFrame] : m.points,
        };
      });

      setActiveMaskId(newMaskId);
      setSelectedPointIndex(null);
      setStatusMessage(`Split mask at frame ${splitFrame + 1}.`);
      return [...updatedMasks, newMask];
    });
  }, []);

  const mergeMask = useCallback((sourceMaskId: string, targetMaskId: string) => {
    setMasks((prev) => {
      const source = prev.find((m) => m.id === sourceMaskId);
      const target = prev.find((m) => m.id === targetMaskId);
      if (!source || !target) {
        setStatusMessage("Cannot merge: mask not found.");
        return prev;
      }

      const mergedKeyframes: Record<number, MaskPoint[]> = {
        ...target.keyframes,
      };
      if (source.keyframes) {
        Object.keys(source.keyframes).forEach((frameStr) => {
          const fi = Number(frameStr);
          if (fi >= currentFrameIndex && !mergedKeyframes[fi]) {
            mergedKeyframes[fi] = source.keyframes![fi];
          }
        });
      }

      const updated = prev
        .map((m) => {
          if (m.id !== targetMaskId) return m;
          const pts = getMaskPointsAtFrame(
            { ...m, keyframes: mergedKeyframes },
            currentFrameIndex
          );
          return { ...m, keyframes: mergedKeyframes, points: pts };
        })
        .filter((m) => m.id !== sourceMaskId);

      if (activeMaskId === sourceMaskId) setActiveMaskId(targetMaskId);
      setSelectedPointIndex(null);
      setStatusMessage(
        `Merged ${source.name} into ${target.name} from frame ${currentFrameIndex + 1} forward.`
      );
      return updated;
    });
  }, [currentFrameIndex, activeMaskId]);

  const updateActiveMaskValue = useCallback(
    (field: "blurriness" | "feather" | "expansion", value: number) => {
      if (!activeMaskId) return;
      setMasks((prev) =>
        prev.map((m) => (m.id === activeMaskId ? { ...m, [field]: value } : m))
      );
    },
    [activeMaskId]
  );

  const handleCancel = useCallback(() => {
    detectAbortRef.current.cancelled = true;
    const cancelled = cancelFacePipeline();
    if (cancelled) setStatusMessage("Cancelling face detection...");
    else if (isRendering)
      setStatusMessage(
        "Cancel requested. Waiting for Premiere render export to finish..."
      );
    else setStatusMessage("Cancel requested.");
  }, [isRendering]);

  const jobRunning = batchJob.running || isRendering || isDetectingFaces;

  return {
    // State
    bgColor,
    statusMessage,
    previewImage,
    masks,
    activeMaskId,
    selectedPointIndex,
    isDrawing,
    setIsDrawing,
    menuOpenMaskId,
    setMenuOpenMaskId,
    imageDimensions,
    displayDimensions,
    isDetectingFaces,
    isRendering,
    jobRunning,
    batchJob,
    loadedSegment,
    selectedClipCount,
    confidenceThreshold,
    setConfidenceThreshold,
    framePaths,
    currentFrameIndex,
    setCurrentFrameIndex,
    isPlaying,
    setIsPlaying,

    // Refs
    canvasRef,
    imageRef,
    containerRef,

    // Handlers
    handleImageLoad,
    handleCanvasClick,
    handleCanvasMouseDown,
    handleCanvasMouseMove,
    handleCanvasMouseUp,
    handleLoadAndRenderSequence,
    handlePanelMouseEnter,
    handleApplyMasks,
    handleCancel,

    // Mask actions
    addMask,
    removeMask,
    splitMask,
    mergeMask,
    updateActiveMaskValue,
    setActiveMaskId,
    setSelectedPointIndex,

    // Helpers
    maskHasAnyValidShape,
  };
}
