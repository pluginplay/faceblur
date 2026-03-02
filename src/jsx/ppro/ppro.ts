// Premiere Pro Main Functions

import { sdkLog } from "./utils/logger";

/**
 * Helper: create a Time object from ticks string
 */
const timeFromTicks = (ticks: string): Time => {
  const t = new Time();
  t.ticks = ticks;
  return t;
};

const TICKS_PER_SECOND = 254016000000;
const FACE_BLUR_EFFECT_TRACKITEM_NAME = "FaceBlur_Effect";

const snapTicksToFrame = (
  ticks: number,
  ticksPerFrame: number,
  mode: "floor" | "ceil" | "round",
): number => {
  if (!isFinite(ticks) || !isFinite(ticksPerFrame) || ticksPerFrame <= 0) {
    return ticks;
  }
  const frames = ticks / ticksPerFrame;
  if (mode === "floor") return Math.floor(frames) * ticksPerFrame;
  if (mode === "ceil") return Math.ceil(frames) * ticksPerFrame;
  return Math.round(frames) * ticksPerFrame;
};

const trySetTrackItemEndTicks = (
  trackItem: TrackItem,
  endTicks: string,
): boolean => {
  try {
    // Premiere timeline TrackItem uses absolute sequence time for .end.
    trackItem.end = timeFromTicks(endTicks);
  } catch (e) {
    return false;
  }

  try {
    return trackItem.end && trackItem.end.ticks === endTicks;
  } catch (e) {
    return false;
  }
};

/**
 * Imports a modified MOGRT file into the active sequence
 * @param mogrtPath Complete path to .mogrt file
 * @param timeInTicks Time (in ticks) at which to insert. If not provided, uses playhead position
 * @param videoTrackOffset The offset from first video track to targeted track (default: 0)
 * @param audioTrackOffset The offset from first audio track to targeted track (default: 0)
 * @returns Success message or error description
 */
export const importModifiedMogrt = (
  mogrtPath: string,
  timeInTicks?: string,
  endTicks?: string,
  videoTrackOffset: number = 2,
  audioTrackOffset: number = 2,
): string => {
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }

    const activeSequence = app.project.activeSequence;
    const settings = activeSequence.getSettings();
    const tpf = parseInt(settings.videoFrameRate.ticks as string, 10);

    // Determine timeInTicks - use playhead position if not provided
    let insertTime: string;
    if (timeInTicks) {
      insertTime = timeInTicks;
    } else {
      // Get playhead position in ticks
      const playhead = activeSequence.getPlayerPosition();
      insertTime = playhead.toString();
    }
    const rawInsertTicksNum = parseInt(insertTime, 10);
    const insertTicksNum = isNaN(rawInsertTicksNum)
      ? rawInsertTicksNum
      : snapTicksToFrame(rawInsertTicksNum, tpf, "floor");
    if (!isNaN(insertTicksNum)) {
      insertTime = String(insertTicksNum);
    }

    sdkLog(
      `Importing MOGRT from: ${mogrtPath}\nTime: ${insertTime}\nEnd: ${endTicks || "(none)"}\nVideo track offset: ${videoTrackOffset}\nAudio track offset: ${audioTrackOffset}`,
    );

    // Import the MOGRT
    const trackItem = activeSequence.importMGT(
      mogrtPath,
      insertTime,
      videoTrackOffset,
      audioTrackOffset,
    );

    if (trackItem) {
      const messages: string[] = [];
      try {
        trackItem.name = FACE_BLUR_EFFECT_TRACKITEM_NAME;
      } catch (e) {
        // Non-fatal; continue if this host version disallows setting name.
        messages.push("Could not set standardized MOGRT name.");
      }

      if (!isNaN(insertTicksNum)) {
        // Step 1: force a short initial duration (1 second) right after import.
        const oneSecondEndTicks = String(insertTicksNum + TICKS_PER_SECOND);
        const oneSecondOk = trySetTrackItemEndTicks(
          trackItem,
          oneSecondEndTicks,
        );
        if (oneSecondOk) {
          messages.push("Initial duration set to 1s.");
        } else {
          messages.push("Could not force 1s initial duration.");
        }
      }

      // Step 2: stretch the clip to the requested final range.
      if (endTicks && endTicks.length > 0) {
        const rawEndTicksNum = parseInt(endTicks, 10);
        const endTicksNum = isNaN(rawEndTicksNum)
          ? rawEndTicksNum
          : snapTicksToFrame(rawEndTicksNum, tpf, "ceil");
        if (
          !isNaN(endTicksNum) &&
          !isNaN(insertTicksNum) &&
          endTicksNum > insertTicksNum
        ) {
          const finalOk = trySetTrackItemEndTicks(
            trackItem,
            String(endTicksNum),
          );
          if (finalOk) {
            messages.push("Adjusted to final selection duration.");
          } else {
            messages.push("Failed to apply final selection duration.");
          }
        } else {
          messages.push("Skipped final duration: invalid endTicks.");
        }
      }

      const details = messages.join(" ");
      return details.length > 0
        ? `MOGRT imported successfully at time ${insertTime}. ${details}`
        : `MOGRT imported successfully at time ${insertTime}.`;
    } else {
      return "Failed to import MOGRT - importMGT returned null.";
    }
  } catch (e: any) {
    return `Error importing MOGRT: ${e.toString()}`;
  }
};

const FACE_BLUR_MARKER_KIND = "face-blur-segment";
const FACE_BLUR_MARKER_SCHEMA_VERSION = 1;
const FACE_BLUR_MARKER_NAME_PREFIX = "FBSEG:";

interface SegmentDescriptor {
  segmentId: string;
  startTicks: string;
  endTicks: string;
  ticksPerFrame: string;
  numFrames: number;
  trackIndex?: number;
  clipName?: string;
}

interface SegmentMarkerPayload {
  kind: "face-blur-segment";
  schemaVersion: 1;
  segment: SegmentDescriptor;
  pngDir: string;
  masks: any[];
  createdAt: string;
  updatedAt: string;
}

const parseTicks = (ticks: string): number => {
  const n = parseInt(ticks, 10);
  return isNaN(n) ? 0 : n;
};

const ticksToSeconds = (ticks: string): number => {
  return parseTicks(ticks) / TICKS_PER_SECOND;
};

const getSelectedClips = (seq: Sequence): TrackItem[] => {
  let selection: TrackItem[] = [];
  try {
    //@ts-ignore
    const sel = seq.getSelection && seq.getSelection();
    if (sel && sel.length) {
      selection = sel;
    }
  } catch (e) {
    // ignore and fall back to scanning tracks
  }

  if (selection.length > 0) {
    const filtered: TrackItem[] = [];
    for (let i = 0; i < selection.length; i++) {
      const clip = selection[i];
      if (
        clip &&
        clip.name &&
        String(clip.name) === FACE_BLUR_EFFECT_TRACKITEM_NAME
      ) {
        continue;
      }
      filtered.push(clip);
    }
    return filtered;
  }

  for (let i = 0; i < seq.videoTracks.numTracks; i++) {
    const track = seq.videoTracks[i];
    for (let j = 0; j < track.clips.numItems; j++) {
      const clip = track.clips[j];
      //@ts-ignore
      if (clip && clip.isSelected) {
        //@ts-ignore
        if (clip.isSelected()) {
          if (
            clip.name &&
            String(clip.name) === FACE_BLUR_EFFECT_TRACKITEM_NAME
          ) {
            continue;
          }
          selection.push(clip);
        }
      }
    }
  }
  return selection;
};

const getTrackIndexForClip = (seq: Sequence, clipNodeId: string): number => {
  for (let i = 0; i < seq.videoTracks.numTracks; i++) {
    const track = seq.videoTracks[i];
    for (let j = 0; j < track.clips.numItems; j++) {
      if (track.clips[j].nodeId === clipNodeId) {
        return i;
      }
    }
  }
  return -1;
};

/**
 * Returns selected clips as independent segment descriptors.
 */
export const getSelectedClipSegments = (): SegmentDescriptor[] | string => {
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }
    const seq = app.project.activeSequence;
    const selection = getSelectedClips(seq);
    if (selection.length === 0) {
      return "No clips are selected in the active sequence.";
    }

    const settings = seq.getSettings();
    const tpf = parseInt(settings.videoFrameRate.ticks as string, 10);
    if (!isFinite(tpf) || tpf <= 0) {
      return "Unable to resolve sequence frame rate.";
    }

    const deduped: { [nodeId: string]: boolean } = {};
    const segments: SegmentDescriptor[] = [];
    for (let i = 0; i < selection.length; i++) {
      const clip = selection[i];
      const nodeId = clip.nodeId;
      if (!nodeId || deduped[nodeId]) {
        continue;
      }
      const trackIndex = getTrackIndexForClip(seq, nodeId);
      if (trackIndex < 0) {
        // Ignore audio-only or non-video selected items.
        continue;
      }
      deduped[nodeId] = true;

      const startRaw = parseInt(clip.start.ticks, 10);
      const endRaw = parseInt(clip.end.ticks, 10);
      const snappedStart = snapTicksToFrame(startRaw, tpf, "floor");
      const snappedEnd = snapTicksToFrame(endRaw, tpf, "ceil");
      if (
        !isFinite(snappedStart) ||
        !isFinite(snappedEnd) ||
        snappedEnd <= snappedStart
      ) {
        continue;
      }
      const numFrames = Math.max(
        1,
        Math.round((snappedEnd - snappedStart) / tpf),
      );
      segments.push({
        segmentId: String(nodeId),
        startTicks: String(snappedStart),
        endTicks: String(snappedEnd),
        ticksPerFrame: String(settings.videoFrameRate.ticks),
        numFrames,
        trackIndex,
        clipName: clip.name ? String(clip.name) : "",
      });
    }

    if (segments.length === 0) {
      return "No valid selected clips found.";
    }

    segments.sort((a, b) => {
      const startDiff = parseTicks(a.startTicks) - parseTicks(b.startTicks);
      if (startDiff !== 0) return startDiff;
      return (a.trackIndex || 0) - (b.trackIndex || 0);
    });
    return segments;
  } catch (e: any) {
    return `Error in getSelectedClipSegments: ${e.toString()}`;
  }
};

const applySequenceInOut = (segment: SegmentDescriptor): string | null => {
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }
    const seq = app.project.activeSequence;
    //@ts-ignore setInPoint expects ticks string
    seq.setInPoint(segment.startTicks);
    //@ts-ignore setOutPoint expects ticks string
    seq.setOutPoint(segment.endTicks);
    return null;
  } catch (e: any) {
    return `Error setting In/Out: ${e.toString()}`;
  }
};

/**
 * Gets the active sequence resolution (width and height)
 * @returns Object with width and height, or error message
 */
export const getSequenceResolution = ():
  | { width: number; height: number }
  | string => {
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }

    const activeSequence = app.project.activeSequence;

    return {
      width: activeSequence.frameSizeHorizontal,
      height: activeSequence.frameSizeVertical,
    };
  } catch (e: any) {
    return `Error getting sequence resolution: ${e.toString()}`;
  }
};

/**
 * Exports a single selected segment as PNG image sequence.
 * Returns the directory, base name, and file count (best-effort after render).
 */
export const exportSegmentAsImageSequence = (
  segment: SegmentDescriptor,
  outputDir: string,
  presetPathRel?: string,
):
  | {
      outputDir: string;
      baseName: string;
      count: number;
    }
  | string => {
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }
    const seq = app.project.activeSequence;
    const inOutErr = applySequenceInOut(segment);
    if (inOutErr) {
      return inOutErr;
    }

    // Resolve extension root → bin/FaceBlurPreset.epr
    // jsx file lives at <extRoot>/jsx/index.js[xbin]; navigate up one to <extRoot>
    const jsxFile = new File($.fileName);
    const jsxFolder = jsxFile.parent; // /jsx
    const extRoot = jsxFolder.parent; // extension root
    const presetPath =
      presetPathRel && presetPathRel.length
        ? new File(presetPathRel).fsName
        : new File(extRoot.fsName + "/bin/FaceBlurPreset.epr").fsName;

    // Ensure output directory exists
    const outFolder = new Folder(outputDir);
    if (!outFolder.exists) {
      const created = outFolder.create();
      if (!created) {
        return `Failed to create output directory: ${outputDir}`;
      }
    }

    const baseName = "frame";
    const outFilePath = outFolder.fsName + "/" + baseName + ".png";

    // WorkAreaType = 1 → between In and Out points
    const ok = seq.exportAsMediaDirect(outFilePath, presetPath, 1);
    if (!ok) {
      return "exportAsMediaDirect returned false.";
    }

    // Best-effort: count generated PNG files
    let count = 0;
    try {
      const files = outFolder.getFiles(function (f: File) {
        return (
          f instanceof File &&
          f.displayName.toLowerCase().match(/\.png$/) !== null
        );
      });
      count = files ? files.length : 0;
    } catch (e2) {
      // ignore
    }

    return {
      outputDir: outFolder.fsName,
      baseName,
      count,
    };
  } catch (e: any) {
    return `Error in exportSegmentAsImageSequence: ${e.toString()}`;
  }
};

const parsePayloadFromMarker = (
  marker: Marker,
): SegmentMarkerPayload | null => {
  try {
    const comments = marker.comments;
    if (!comments || typeof comments !== "string") return null;
    const raw: any = JSON.parse(comments);
    if (!raw || typeof raw !== "object") return null;
    if (raw.kind !== FACE_BLUR_MARKER_KIND) return null;
    if (raw.schemaVersion !== FACE_BLUR_MARKER_SCHEMA_VERSION) return null;
    if (!raw.segment || typeof raw.segment !== "object") return null;
    if (typeof raw.segment.segmentId !== "string") return null;
    if (typeof raw.segment.startTicks !== "string") return null;
    if (typeof raw.segment.endTicks !== "string") return null;
    if (typeof raw.segment.ticksPerFrame !== "string") return null;
    if (typeof raw.segment.numFrames !== "number") return null;
    return raw as SegmentMarkerPayload;
  } catch (e) {
    return null;
  }
};

const markerOverlapsSegment = (
  payload: SegmentMarkerPayload,
  segment: SegmentDescriptor,
): boolean => {
  if (payload.segment.segmentId === segment.segmentId) {
    return true;
  }
  const payloadStart = parseTicks(payload.segment.startTicks);
  const payloadEnd = parseTicks(payload.segment.endTicks);
  const segmentStart = parseTicks(segment.startTicks);
  const segmentEnd = parseTicks(segment.endTicks);
  return payloadStart < segmentEnd && payloadEnd > segmentStart;
};

const deleteMarkerBestEffort = (seq: Sequence, marker: Marker): void => {
  try {
    //@ts-ignore
    if (seq.markers.deleteMarker) {
      //@ts-ignore
      seq.markers.deleteMarker(marker);
      return;
    }
  } catch (e) {
    // ignore
  }
  try {
    //@ts-ignore
    if (seq.markers.removeMarker) {
      //@ts-ignore
      seq.markers.removeMarker(marker);
    }
  } catch (e2) {
    // ignore
  }
};

const ensurePayload = (payload: SegmentMarkerPayload): SegmentMarkerPayload => {
  const now = String(new Date().getTime());
  const segment: SegmentDescriptor = {
    segmentId: payload.segment.segmentId,
    startTicks: payload.segment.startTicks,
    endTicks: payload.segment.endTicks,
    ticksPerFrame: payload.segment.ticksPerFrame,
    numFrames: payload.segment.numFrames,
    trackIndex: payload.segment.trackIndex,
    clipName: payload.segment.clipName,
  };
  const masks = payload.masks ? payload.masks : [];
  return {
    kind: FACE_BLUR_MARKER_KIND as "face-blur-segment",
    schemaVersion: FACE_BLUR_MARKER_SCHEMA_VERSION as 1,
    segment,
    pngDir: payload.pngDir,
    masks,
    createdAt: payload.createdAt || now,
    updatedAt: now,
  };
};

const markerStartSeconds = (startTicks: string): number => {
  return ticksToSeconds(startTicks);
};

const markerEndSeconds = (endTicks: string): number => {
  return ticksToSeconds(endTicks);
};

/**
 * Upserts an owned marker for a segment and replaces overlapping owned markers.
 */
export const upsertSegmentMarker = (
  rawPayload: SegmentMarkerPayload,
):
  | {
      markerGuid: string;
      replacedCount: number;
    }
  | string => {
  try {
    if (!app.project.activeSequence) return "No active sequence found.";
    const seq = app.project.activeSequence;
    const payload = ensurePayload(rawPayload);
    if (!payload.segment || !payload.segment.segmentId) {
      return "Invalid marker payload: segment is required.";
    }

    const markersToReplace: Marker[] = [];
    let marker = seq.markers.getFirstMarker();
    while (marker) {
      const parsed = parsePayloadFromMarker(marker);
      if (parsed && markerOverlapsSegment(parsed, payload.segment)) {
        markersToReplace.push(marker);
      }
      marker = seq.markers.getNextMarker(marker);
    }

    let target: Marker | null = null;
    if (markersToReplace.length > 0) {
      target = markersToReplace[0];
      for (let i = 1; i < markersToReplace.length; i++) {
        deleteMarkerBestEffort(seq, markersToReplace[i]);
      }
    }

    if (!target) {
      //@ts-ignore TS defs are incomplete for marker create overload
      target = seq.markers.createMarker(
        markerStartSeconds(payload.segment.startTicks),
      );
    }
    if (!target) {
      return "Failed to create or resolve marker.";
    }

    target.name = FACE_BLUR_MARKER_NAME_PREFIX + payload.segment.segmentId;
    target.comments = JSON.stringify(payload);
    //@ts-ignore Marker.end expects seconds value
    target.end = markerEndSeconds(payload.segment.endTicks);

    return {
      markerGuid: target.guid,
      replacedCount: markersToReplace.length,
    };
  } catch (e: any) {
    return `Error in upsertSegmentMarker: ${e.toString()}`;
  }
};

/**
 * Returns the owned segment marker at CTI, if any.
 */
export const findOwnedMarkerAtCTI = ():
  | {
      found: false;
    }
  | {
      found: true;
      markerGuid: string;
      payload: SegmentMarkerPayload;
    }
  | string => {
  try {
    if (!app.project.activeSequence) return "No active sequence found.";
    const seq = app.project.activeSequence;
    const ctiTicks = parseInt(seq.getPlayerPosition().ticks, 10);
    if (!isFinite(ctiTicks)) return "Unable to resolve CTI ticks.";

    let marker = seq.markers.getFirstMarker();
    while (marker) {
      const payload = parsePayloadFromMarker(marker);
      if (payload) {
        const start = parseTicks(payload.segment.startTicks);
        const end = parseTicks(payload.segment.endTicks);
        if (ctiTicks >= start && ctiTicks < end) {
          return {
            found: true,
            markerGuid: marker.guid,
            payload,
          };
        }
      }
      marker = seq.markers.getNextMarker(marker);
    }
    return { found: false };
  } catch (e: any) {
    return `Error in findOwnedMarkerAtCTI: ${e.toString()}`;
  }
};

/**
 * Gets the CTI (Current Time Indicator) ticks and ticks per frame from the active sequence
 * @returns Object with ctiTicks and ticksPerFrame, or error message
 */
export const getCTITicksAndTicksPerFrame = ():
  | { ctiTicks: string; ticksPerFrame: string }
  | string => {
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }

    const activeSequence = app.project.activeSequence;

    // Get CTI position in ticks
    const cti = activeSequence.getPlayerPosition();
    const ctiTicks = cti.ticks;

    // Get ticks per frame from sequence settings
    const settings = activeSequence.getSettings();
    const ticksPerFrame = settings.videoFrameRate.ticks;

    sdkLog(`CTI ticks: ${ctiTicks}, Ticks per frame: ${ticksPerFrame}`);

    return {
      ctiTicks,
      ticksPerFrame,
    };
  } catch (e: any) {
    return `Error getting CTI ticks: ${e.toString()}`;
  }
};

/**
 * Exports the current frame at CTI (Current Time Indicator) as PNG
 * @returns Path to the exported PNG file, or error message
 */
export const exportFrameAtCTI = (): string => {
  try {
    // Enable QE and get QE sequence (must be active in PPro UI)
    app.enableQE();
    if (!qe) {
      return "QuickEdit API (qe) is not available after enabling it.";
    }

    const qeSequence = qe.project.getActiveSequence();
    if (!qeSequence) {
      return "Could not get QE sequence. Make sure a sequence is active in Premiere Pro.";
    }

    // Get CTI (Current Time Indicator) timecode directly from QE sequence
    const currentTime = qeSequence.CTI.timecode;
    sdkLog(`Exporting frame at CTI: ${currentTime}`);

    // Create temp file path for export
    const tempFile = new File("~/frame_export.png");
    tempFile.fsName; // Ensure fsName is set
    const filePath = tempFile.fsName;

    // Export frame - exportFramePNG expects timecode string
    qeSequence.exportFramePNG(currentTime, filePath);

    sdkLog(`Frame exported to: ${filePath}`);
    return filePath;
  } catch (e: any) {
    sdkLog(`Error in exportFrameAtCTI: ${e.toString()}`);
    return `Error exporting frame: ${e.toString()}`;
  }
};
