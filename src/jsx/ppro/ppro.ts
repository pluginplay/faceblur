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
  videoTrackOffset: number = 2,
  audioTrackOffset: number = 2
): string => {
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }

    const activeSequence = app.project.activeSequence;

    // Determine timeInTicks - use playhead position if not provided
    let insertTime: string;
    if (timeInTicks) {
      insertTime = timeInTicks;
    } else {
      // Get playhead position in ticks
      const playhead = activeSequence.getPlayerPosition();
      insertTime = playhead.toString();
    }

    sdkLog(
      `Importing MOGRT from: ${mogrtPath}\nTime: ${insertTime}\nVideo track offset: ${videoTrackOffset}\nAudio track offset: ${audioTrackOffset}`
    );

    // Import the MOGRT
    const trackItem = activeSequence.importMGT(
      mogrtPath,
      insertTime,
      videoTrackOffset,
      audioTrackOffset
    );

    if (trackItem) {
      return `MOGRT imported successfully at time ${insertTime}.`;
    } else {
      return "Failed to import MOGRT - importMGT returned null.";
    }
  } catch (e: any) {
    return `Error importing MOGRT: ${e.toString()}`;
  }
};

/**
 * Finds the selected clips, computes the min start and max end, and sets the
 * sequence In/Out to that range. Returns timing info useful to CEP.
 */
export const getSelectionRangeAndSetInOut = ():
  | {
      startTicks: string;
      endTicks: string;
      ticksPerFrame: string;
      numFrames: number;
    }
  | string => {
  try {
    if (!app.project.activeSequence) {
      return "No active sequence found.";
    }
    const seq = app.project.activeSequence;

    // Prefer native getSelection() if available
    let selection: TrackItem[] = [];
    try {
      //@ts-ignore
      const sel = seq.getSelection && seq.getSelection();
      if (sel && sel.length) {
        selection = sel;
      }
    } catch (e) {
      // ignore and fall back to scan tracks
    }

    // Fallback: scan all video tracks for selected clips
    if (selection.length === 0) {
      for (let i = 0; i < seq.videoTracks.numTracks; i++) {
        const track = seq.videoTracks[i];
        for (let j = 0; j < track.clips.numItems; j++) {
          const clip = track.clips[j];
          //@ts-ignore
          if (clip && clip.isSelected) {
            //@ts-ignore
            if (clip.isSelected()) {
              selection.push(clip);
            }
          }
        }
      }
    }

    if (selection.length === 0) {
      return "No clips are selected in the active sequence.";
    }

    // Compute start/end in ticks
    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = 0;
    for (let i = 0; i < selection.length; i++) {
      const item = selection[i];
      const s = parseInt(item.start.ticks, 10);
      const e = parseInt(item.end.ticks, 10);
      if (!isNaN(s) && s < minStart) minStart = s;
      if (!isNaN(e) && e > maxEnd) maxEnd = e;
    }
    if (!isFinite(minStart) || maxEnd <= minStart) {
      return "Failed to compute a valid selection range.";
    }

    // Set sequence In/Out
    const inTicks = String(minStart);
    const outTicks = String(maxEnd);
    //@ts-ignore setInPoint expects ticks string
    seq.setInPoint(inTicks);
    //@ts-ignore
    seq.setOutPoint(outTicks);

    // Provide timing info
    const settings = seq.getSettings();
    const tpf = settings.videoFrameRate.ticks as string;
    const frames = Math.max(
      1,
      Math.round((maxEnd - minStart) / parseInt(tpf, 10))
    );

    return {
      startTicks: inTicks,
      endTicks: outTicks,
      ticksPerFrame: tpf,
      numFrames: frames,
    };
  } catch (e: any) {
    return `Error in getSelectionRangeAndSetInOut: ${e.toString()}`;
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
 * Exports the current selection (between In/Out points) as a PNG image sequence
 * using the provided FaceBlur preset. The outputDir will be created if needed.
 * Returns the directory, base name, and file count (best-effort after render).
 */
export const exportSelectionAsImageSequence = (
  outputDir: string,
  presetPathRel?: string
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
    return `Error in exportSelectionAsImageSequence: ${e.toString()}`;
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
