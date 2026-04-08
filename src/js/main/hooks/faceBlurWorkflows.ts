import { os, path, fs } from "../../lib/cep/node";
import { buildAndImportMogrtFromTracks } from "../../lib/utils/mogrt";
import { runFacePipeline, type FaceTrack } from "../../lib/utils/faceDetection";
import type { MarkerPayload, SegmentDescriptor, UIMask } from "../types";
import {
  exportSegmentAsImageSequence,
  findOwnedMarkerAtCTI,
  getSelectedClipSegments,
  upsertSegmentMarker,
} from "../lib/pproClient";
import {
  faceTracksToMasks,
  uiMasksToMarkerMasks,
} from "../lib/maskTransforms";
import { bboxToMaskPoints } from "../../lib/utils/faceDetection";

type NotifyFns = {
  info: (message: string) => void;
  success: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
  mogrtResult: (result: string, successMessage: string) => void;
};

export type BatchWorkflowDeps = {
  confidenceThreshold: number;
  readPngSequence: (dir: string) => string[];
  loadPayloadIntoPanel: (
    markerGuid: string,
    payload: MarkerPayload,
    sequencePathsOverride?: string[],
  ) => void;
  setFaceTracks: (tracks: FaceTrack[] | null) => void;
  setPipelineStatusMessage: (msg: string) => void;
  setBatchJob: (job: {
    running: boolean;
    totalSegments: number;
    completedSegments: number;
  }) => void;
  setBatchJobRunningDone: () => void;
  setIsRendering: (value: boolean) => void;
  setIsDetectingFaces: (value: boolean) => void;
  detectAbortRef: { current: { cancelled: boolean } };
  notify: NotifyFns;
  isBetaLocked: boolean;
};

const getVideoFps = (segment: SegmentDescriptor): number => {
  const ticksPerFrame = Number(segment.ticksPerFrame);
  if (!Number.isFinite(ticksPerFrame) || ticksPerFrame <= 0) return 30;
  const PREMIERE_TICKS_PER_SECOND = 254_016_000_000;
  const fps = PREMIERE_TICKS_PER_SECOND / ticksPerFrame;
  if (!Number.isFinite(fps) || fps <= 0) return 30;
  return Math.max(1, Math.min(240, fps));
};

export const runBatchFaceDetection = async ({
  confidenceThreshold,
  readPngSequence,
  loadPayloadIntoPanel,
  setFaceTracks,
  setPipelineStatusMessage,
  setBatchJob,
  setBatchJobRunningDone,
  setIsRendering,
  setIsDetectingFaces,
  detectAbortRef,
  notify,
  isBetaLocked,
}: BatchWorkflowDeps): Promise<void> => {
  if (isBetaLocked) {
    notify.warning("Face Blur beta has ended. This panel is locked.");
    return;
  }

  try {
    detectAbortRef.current.cancelled = false;
    setPipelineStatusMessage("Reading selected clips...");
    setBatchJob({ running: true, totalSegments: 0, completedSegments: 0 });
    setIsRendering(true);

    const segmentResult = await getSelectedClipSegments();
    if (!segmentResult.ok) {
      setPipelineStatusMessage(segmentResult.error);
      return;
    }
    const segments = segmentResult.data;
    if (segments.length === 0) {
      setPipelineStatusMessage("No selected clips found.");
      return;
    }
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
        `face_blur_seg_${safeSegmentId}_${Date.now().toString(36)}`,
      );
      if (!fs.existsSync(folder)) fs.mkdirSync(folder);

      setIsRendering(true);
      setIsDetectingFaces(false);
      setPipelineStatusMessage(
        `Rendering segment ${label} (${segment.numFrames} frames)...`,
      );
      const renderResult = await exportSegmentAsImageSequence(segment, folder);
      if (!renderResult.ok) {
        throw new Error(`Segment ${label} render failed: ${renderResult.error}`);
      }

      const pngs = readPngSequence(renderResult.data.outputDir);
      if (pngs.length === 0) {
        throw new Error(`Segment ${label} rendered no frames.`);
      }

      setIsRendering(false);
      setIsDetectingFaces(true);
      setPipelineStatusMessage(`Detecting faces in segment ${label}...`);
      const pipelineResult = await runFacePipeline(pngs, {
        confThresh: confidenceThreshold,
        videoFps: getVideoFps(segment),
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
        pngDir: renderResult.data.outputDir,
        masks: uiMasksToMarkerMasks(generatedMasks),
        createdAt: now,
        updatedAt: now,
      };
      const markerResult = await upsertSegmentMarker(markerPayload);
      if (!markerResult.ok) {
        throw new Error(
          `Segment ${label} marker write failed: ${markerResult.error}`,
        );
      }

      if (i === segments.length - 1) {
        loadPayloadIntoPanel(markerResult.data.markerGuid, markerPayload, pngs);
        setFaceTracks(pipelineResult.tracks);
      }

      setBatchJob({
        running: true,
        totalSegments: segments.length,
        completedSegments: i + 1,
      });
    }
    notify.success(`Batch complete. Processed ${segments.length} segment(s).`);
  } catch (e: unknown) {
    notify.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    setFaceTracks(null);
  } finally {
    setPipelineStatusMessage("");
    setBatchJobRunningDone();
    setIsRendering(false);
    setIsDetectingFaces(false);
  }
};

type ApplyMasksDeps = {
  loadedSegment: { segment: SegmentDescriptor } | null;
  masks: UIMask[];
  faceTracks: FaceTrack[] | null;
  frameCount: number;
  currentFrameIndex: number;
  persistCurrentMasksToLoadedMarker: () => Promise<void>;
  notify: NotifyFns;
};

export const applyMasksToTimeline = async ({
  loadedSegment,
  masks,
  faceTracks,
  frameCount,
  currentFrameIndex,
  persistCurrentMasksToLoadedMarker,
  notify,
}: ApplyMasksDeps): Promise<void> => {
  if (!loadedSegment) {
    notify.warning("Load a segment marker first.");
    return;
  }

  const segment = loadedSegment.segment;
  const numFrames = frameCount > 0 ? frameCount : segment.numFrames;
  const sharedOpts = {
    ticksPerFrame: segment.ticksPerFrame,
    timeInTicks: segment.startTicks,
    endTicks: segment.endTicks,
    videoTrackOffset: 1,
    audioTrackOffset: 0,
    numFrames,
  };

  if (masks.length > 0 && masks.some((m) => m.keyframes)) {
    try {
      notify.info("Building and importing MOGRT from edited masks...");
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
        notify.warning("No masks with keyframes found.");
        return;
      }
      const res = await buildAndImportMogrtFromTracks(trackSpecs, sharedOpts);
      await persistCurrentMasksToLoadedMarker();
      notify.mogrtResult(res, "Applied edited masks to timeline.");
      return;
    } catch (e: unknown) {
      notify.error(
        `Error building from edited masks: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
  }

  if (faceTracks) {
    try {
      notify.info("Building and importing MOGRT from tracked faces...");
      const trackSpecs = faceTracks.map((t) => ({
        frames: t.frames.map((f) => ({
          frameIndex: f.frameIndex,
          points: bboxToMaskPoints(f.bbox),
        })),
        blurriness: 50,
        feather: 10,
        expansion: 0,
      }));
      const res = await buildAndImportMogrtFromTracks(trackSpecs, sharedOpts);
      await persistCurrentMasksToLoadedMarker();
      notify.mogrtResult(res, "Applied tracked face masks to timeline.");
      return;
    } catch (e: unknown) {
      notify.error(
        `Error building from tracks: ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
  }

  if (masks.length === 0) {
    notify.warning("Please create at least one mask before applying.");
    return;
  }
  if (masks.some((m) => m.points.length < 3)) {
    notify.warning("Each mask must have at least 3 points.");
    return;
  }

  try {
    notify.info("Building and importing MOGRT with multiple masks...");
    const staticTrackSpecs = masks.map((m) => ({
      frames: [{ frameIndex: currentFrameIndex, points: m.points }],
      blurriness: m.blurriness ?? 50,
      feather: m.feather ?? 10,
      expansion: m.expansion ?? 0,
    }));
    const result = await buildAndImportMogrtFromTracks(staticTrackSpecs, sharedOpts);
    await persistCurrentMasksToLoadedMarker();
    notify.mogrtResult(result, "Applied masks to timeline.");
  } catch (e: unknown) {
    notify.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  }
};

type SyncDeps = {
  batchRunning: boolean;
  isRendering: boolean;
  isDetectingFaces: boolean;
  loadedSegment: { markerGuid: string; segment: SegmentDescriptor } | null;
  setSelectedClipCount: (n: number) => void;
  resetLoadedPanelState: () => void;
  loadPayloadIntoPanel: (markerGuid: string, payload: MarkerPayload) => void;
};

export const syncPanelStateFromPremiere = async ({
  batchRunning,
  isRendering,
  isDetectingFaces,
  loadedSegment,
  setSelectedClipCount,
  resetLoadedPanelState,
  loadPayloadIntoPanel,
}: SyncDeps): Promise<void> => {
  const selectedResult = await getSelectedClipSegments();
  if (!selectedResult.ok) {
    setSelectedClipCount(0);
  } else {
    setSelectedClipCount(selectedResult.data.length);
  }

  if (batchRunning || isRendering || isDetectingFaces) return;

  const markerResult = await findOwnedMarkerAtCTI();
  if (!markerResult.ok) return;
  if (!markerResult.data?.found) {
    resetLoadedPanelState();
    return;
  }

  const payload = markerResult.data.payload as MarkerPayload;
  if (!payload || payload.kind !== "face-blur-segment") return;
  if (payload.schemaVersion !== 1 || !payload.segment) return;
  if (
    loadedSegment &&
    (loadedSegment.markerGuid === markerResult.data.markerGuid ||
      loadedSegment.segment.segmentId === payload.segment.segmentId)
  ) {
    return;
  }
  loadPayloadIntoPanel(markerResult.data.markerGuid, payload);
};
