/**
 * Face Detection and Tracking Pipeline
 *
 * TypeScript wrapper for the C++ face pipeline.
 * Single export: runFacePipeline()
 */

import { child_process, fs, os, path } from "../cep/node";
import { csi, dispatchTS } from "./bolt";
import type { ChildProcessWithoutNullStreams } from "child_process";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TrackFrame {
  frameIndex: number;
  bbox: BBox;
  confidence: number;
}

export interface FaceTrack {
  id: number;
  frames: TrackFrame[];
}

export interface PipelineStats {
  personDetections: number;
  faceDetections: number;
  associatedFaces: number;
  unassociatedFaces: number;
  timingMs: {
    personDetect: number;
    personPreprocess: number;
    personInfer: number;
    personDecode: number;
    bodyReid: number;
    faceDetect: number;
    associate: number;
    trackUpdate: number;
  };
}

export interface PipelineResult {
  tracks: FaceTrack[];
  frameCount: number;
  stats: PipelineStats;
}

export interface PipelineOptions {
  /** Confidence threshold for face detection (default: 0.5) */
  confThresh?: number;
  /** Detection FPS - faces detected at this rate, tracked between (default: 5.0) */
  detectionFps?: number;
  /** Source video FPS for stride calculation (default: 30.0) */
  videoFps?: number;
  /** IoU threshold for tracking (default: 0.15) */
  iouThresh?: number;
}

// -----------------------------------------------------------------------------
// Internal Helpers
// -----------------------------------------------------------------------------

let _extensionRoot: string | null = null;
let _activePipelineProcess: ChildProcessWithoutNullStreams | null = null;
let _activePipelineCancelled = false;
const PROGRESS_PREFIX = "FB_PROGRESS ";
const LOG_PREFIX = "[face_pipeline]";
const PIPELINE_TIMEOUT_MS = 20 * 60 * 1000;
const PIPELINE_STALL_TIMEOUT_MS = 90 * 1000;
const MAX_STDOUT_BYTES = 5 * 1024 * 1024;
const MAX_STDERR_BYTES = 2 * 1024 * 1024;

type ProgressStage =
  | "startup"
  | "processing"
  | "linking"
  | "finalizing"
  | "parsing";

interface ProgressPayload {
  stage: ProgressStage;
  currentFrame?: number;
  totalFrames?: number;
  percent?: number;
  message: string;
}

function debugLog(message: string, data?: unknown) {
  if (typeof console === "undefined") return;
  if (typeof data === "undefined") {
    console.debug(`${LOG_PREFIX} ${message}`);
    return;
  }
  console.debug(`${LOG_PREFIX} ${message}`, data);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseProgressLine(line: string): ProgressPayload | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  const raw = line.slice(PROGRESS_PREFIX.length).trim();
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<ProgressPayload>;
    if (!data || typeof data !== "object") return null;
    if (typeof data.stage !== "string") return null;
    if (typeof data.message !== "string") return null;
    const stage = data.stage as ProgressStage;
    if (!["startup", "processing", "linking", "finalizing", "parsing"].includes(stage)) {
      return null;
    }
    return {
      stage,
      currentFrame:
        typeof data.currentFrame === "number"
          ? Math.max(0, Math.round(data.currentFrame))
          : undefined,
      totalFrames:
        typeof data.totalFrames === "number"
          ? Math.max(0, Math.round(data.totalFrames))
          : undefined,
      percent:
        typeof data.percent === "number" ? clampPercent(data.percent) : undefined,
      message: data.message,
    };
  } catch {
    return null;
  }
}

function dispatchPipelineEvent(
  event:
    | "pipelineStarted"
    | "pipelineProgress"
    | "pipelineCompleted"
    | "pipelineError",
  data: any
) {
  if (typeof window === "undefined" || !window.cep) {
    return;
  }

  try {
    debugLog(`dispatch ${event}`, data);
    dispatchTS(event as any, data);
  } catch {
    // Event dispatch should never block pipeline execution.
  }
}

function getExtensionRoot(): string {
  if (_extensionRoot === null) {
    _extensionRoot =
      typeof window !== "undefined" && window.cep
        ? csi.getSystemPath("extension")
        : process.cwd();
  }
  return _extensionRoot!;
}

/**
 * Get path to the face_pipeline executable.
 */
function getPipelineExecutable(): string {
  const extRoot = getExtensionRoot();
  const platform = os.platform();

  if (platform === "win32") {
    const candidates: string[] = [];
    candidates.push(
      path.join(extRoot, "cpp", "build", "Release", "face_pipeline.exe"),
      path.join(extRoot, "cpp", "build", "face_pipeline.exe"),
      // Packaged CEP assets
      path.join(extRoot, "bin", "face_pipeline.exe"),
      // Repo/dev fallback
      path.join(extRoot, "src", "bin", "face_pipeline.exe")
    );
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // continue
      }
    }
    throw new Error(
      `Face pipeline executable not found. Checked: ${candidates.join(", ")}`
    );
  }

  const appExecutable = path.join(
    extRoot,
    "bin",
    "face_pipeline.app",
    "Contents",
    "MacOS",
    "face_pipeline"
  );
  if (fs.existsSync(appExecutable)) {
    return appExecutable;
  }

  throw new Error(
    `Face pipeline executable not found at required macOS app path: ${appExecutable}`
  );
}

/**
 * Get path to the SCRFD model directory.
 */
function getModelDir(): string {
  const extRoot = getExtensionRoot();
  const platform = os.platform();

  if (platform === "win32") {
    const candidates = [
      path.join(extRoot, "bin", "models"),
      // Repo/dev fallback
      path.join(extRoot, "src", "bin", "models"),
      path.join(extRoot, "cpp", "models"),
      path.join(extRoot, "models"),
    ];

    for (const candidate of candidates) {
      try {
        const scrfdCandidates = [
          path.join(candidate, "scrfd_2.5g_kps_640x640.onnx"),
          path.join(candidate, "scrfd.onnx"),
        ];
        if (scrfdCandidates.some((p) => fs.existsSync(p))) {
          return candidate;
        }
      } catch {
        // continue
      }
    }
    throw new Error(
      `SCRFD ONNX model file not found. Checked: ${candidates.join(", ")}`
    );
  }

  const macModelDir = path.join(
    extRoot,
    "bin",
    "face_pipeline.app",
    "Contents",
    "Resources",
    "models"
  );
  if (fs.existsSync(path.join(macModelDir, "scrfd_2.5g_kps_640x640.onnx"))) {
    return macModelDir;
  }
  throw new Error(
    `SCRFD ONNX model file not found at required macOS app path: ${macModelDir}`
  );
}

function requireNativeAssets(executable: string, modelDir: string) {
  if (!fs.existsSync(executable)) {
    throw new Error(`Native executable missing: ${executable}`);
  }
  if (os.platform() !== "win32") {
    try {
      fs.accessSync(executable, fs.constants.X_OK);
    } catch {
      throw new Error(`Native executable is not executable: ${executable}`);
    }
    const expectedMacSuffix = path.join(
      "face_pipeline.app",
      "Contents",
      "MacOS",
      "face_pipeline"
    );
    if (os.platform() === "darwin" && !executable.endsWith(expectedMacSuffix)) {
      throw new Error(
        `Invalid macOS native executable path. Expected .../${expectedMacSuffix}, got: ${executable}`
      );
    }
    if (os.platform() === "darwin") {
      const appContentsDir = path.resolve(executable, "..", "..");
      const frameworksDir = path.join(appContentsDir, "Frameworks");
      if (!fs.existsSync(frameworksDir)) {
        throw new Error(
          `Missing macOS app Frameworks directory: ${frameworksDir}`
        );
      }
    }
  }
  const requiredModels = [
    path.join(modelDir, "scrfd_2.5g_kps_640x640.onnx"),
    path.join(modelDir, "rf_detr_small", "rf-detr-small.onnx"),
  ];
  const missing = requiredModels.filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    throw new Error(`Missing required model file(s): ${missing.join(", ")}`);
  }
}

function appendLimited(
  current: string,
  chunk: string,
  maxBytes: number
): string {
  const next = current + chunk;
  if (next.length <= maxBytes) return next;
  return next.slice(next.length - maxBytes);
}

function getExitHint(exitCode: number | null): string {
  switch (exitCode) {
    case 1:
      return "invalid native arguments";
    case 2:
      return "missing or unreadable model files";
    case 3:
      return "input frame read failure";
    case 4:
      return "inference runtime failure";
    default:
      return "native runtime error";
  }
}

/**
 * Spawn the C++ face pipeline executable.
 */
function spawnPipeline(
  imagePaths: string[],
  options: {
    confThresh: number;
    detectionFps: number;
    videoFps: number;
    iouThresh: number;
  }
): Promise<PipelineResult> {
  return new Promise((resolve, reject) => {
    if (_activePipelineProcess) {
      reject(
        new Error(
          "Face pipeline is already running. Cancel or wait for completion."
        )
      );
      return;
    }

    const executable = getPipelineExecutable();
    const modelDir = getModelDir();
    requireNativeAssets(executable, modelDir);
    const startTime = Date.now();
    debugLog("spawn pipeline executable", {
      executable,
      modelDir,
      frameCount: imagePaths.length,
      options,
    });

    const args = [
      "--model",
      modelDir,
      "--track",
      "--conf",
      options.confThresh.toString(),
      "--detection-fps",
      options.detectionFps.toString(),
      "--video-fps",
      options.videoFps.toString(),
      "--iou",
      options.iouThresh.toString(),
    ];

    // Set up environment for dynamic library loading
    const spawnEnv = { ...process.env };
    const executableDir = path.dirname(executable);
    const executableLibDir = path.join(executableDir, "lib");
    const platform = os.platform();

    if (platform === "linux") {
      // Linux: include executable and bundled lib/ in shared library search path
      const existingPath = spawnEnv.LD_LIBRARY_PATH || "";
      const bundlePaths = fs.existsSync(executableLibDir)
        ? `${executableDir}:${executableLibDir}`
        : executableDir;
      spawnEnv.LD_LIBRARY_PATH = existingPath
        ? `${bundlePaths}:${existingPath}`
        : bundlePaths;
    }
    // Windows: DLLs in the same directory as .exe are found automatically

    const proc = child_process.spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: spawnEnv,
    });
    debugLog("process spawned", { pid: proc.pid, args });
    _activePipelineProcess = proc;
    _activePipelineCancelled = false;
    dispatchPipelineEvent("pipelineStarted", {
      frameCount: imagePaths.length,
      detectionFps: options.detectionFps,
      videoFps: options.videoFps,
      confThresh: options.confThresh,
      iouThresh: options.iouThresh,
    });
    dispatchPipelineEvent("pipelineProgress", {
      stage: "startup",
      currentFrame: 0,
      totalFrames: imagePaths.length,
      percent: 0,
      message: "Pipeline process started.",
    });

    // Write image paths to stdin (one per line)
    for (const p of imagePaths) {
      proc.stdin.write(p + "\n");
    }
    proc.stdin.end();

    let stdout = "";
    let stderr = "";
    let stderrLineBuffer = "";
    let hardTimeout: ReturnType<typeof setTimeout> | null = null;
    let stallTimeout: ReturnType<typeof setTimeout> | null = null;
    let timeoutReason: "hard" | "stall" | null = null;

    const clearTimers = () => {
      if (hardTimeout) clearTimeout(hardTimeout);
      if (stallTimeout) clearTimeout(stallTimeout);
      hardTimeout = null;
      stallTimeout = null;
    };
    const armStallTimeout = () => {
      if (stallTimeout) clearTimeout(stallTimeout);
      stallTimeout = setTimeout(() => {
        timeoutReason = "stall";
        try {
          proc.kill("SIGKILL");
        } catch {
          // Ignore kill failure.
        }
      }, PIPELINE_STALL_TIMEOUT_MS);
    };
    hardTimeout = setTimeout(() => {
      timeoutReason = "hard";
      try {
        proc.kill("SIGKILL");
      } catch {
        // Ignore kill failure.
      }
    }, PIPELINE_TIMEOUT_MS);
    armStallTimeout();

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout = appendLimited(stdout, chunk, MAX_STDOUT_BYTES);
      armStallTimeout();
      debugLog("stdout chunk", chunk);
    });

    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      debugLog("stderr chunk", chunk);
      stderr = appendLimited(stderr, chunk, MAX_STDERR_BYTES);
      stderrLineBuffer += chunk;
      armStallTimeout();

      const lines = stderrLineBuffer.split(/\r?\n/);
      stderrLineBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        debugLog("stderr line", trimmed);
        const parsed = parseProgressLine(trimmed);
        if (parsed) {
          debugLog("parsed progress", parsed);
          dispatchPipelineEvent("pipelineProgress", parsed);
          continue;
        }
        // Legacy fallback for non-structured native logs during migration.
        const frameMatch = trimmed.match(/frame=(\d+)/);
        const frameValue = frameMatch ? Number(frameMatch[1]) : undefined;
        const totalFrames = imagePaths.length;
        const currentFrame =
          typeof frameValue === "number" && Number.isFinite(frameValue)
            ? Math.max(0, frameValue + 1)
            : undefined;
        const percent =
          typeof currentFrame === "number" && totalFrames > 0
            ? clampPercent((currentFrame / totalFrames) * 100)
            : undefined;
        dispatchPipelineEvent("pipelineProgress", {
          stage: "processing",
          currentFrame,
          totalFrames,
          percent,
          message: trimmed,
        });
      }
    });

    proc.on("close", (code, signal) => {
      _activePipelineProcess = null;
      clearTimers();
      debugLog("process closed", { code, signal });

      if (_activePipelineCancelled) {
        _activePipelineCancelled = false;
        dispatchPipelineEvent("pipelineError", {
          stage: "cancelled",
          message: "Face pipeline cancelled.",
          exitCode: code,
          signal: signal ?? null,
        });
        reject(new Error("Face pipeline cancelled."));
        return;
      }

      if (code !== 0) {
        const timeoutMessage =
          timeoutReason === "hard"
            ? `pipeline timed out after ${PIPELINE_TIMEOUT_MS}ms`
            : timeoutReason === "stall"
              ? `pipeline stalled for ${PIPELINE_STALL_TIMEOUT_MS}ms`
              : null;
        const hint = getExitHint(code);
        dispatchPipelineEvent("pipelineError", {
          stage: "runtime",
          message:
            timeoutMessage ||
            `${hint}: ${stderr || stdout || "Unknown pipeline runtime error."}`,
          exitCode: code,
          signal: signal ?? null,
        });
        reject(
          new Error(
            timeoutMessage ||
              `Face pipeline exited with code ${String(code)} signal ${String(signal)} (${hint}): ${stderr || stdout}`
          )
        );
        return;
      }

      try {
        dispatchPipelineEvent("pipelineProgress", {
          stage: "parsing",
          currentFrame: imagePaths.length,
          totalFrames: imagePaths.length,
          percent: 100,
          message: "Parsing pipeline output...",
        });
        debugLog("parse stdout json start");
        const result = JSON.parse(stdout) as RawResult;
        const parsed = parseRawResult(result);
        debugLog("parse stdout json success", {
          frameCount: parsed.frameCount,
          trackCount: parsed.tracks.length,
        });
        dispatchPipelineEvent("pipelineCompleted", {
          frameCount: parsed.frameCount,
          trackCount: parsed.tracks.length,
          personDetections: parsed.stats.personDetections,
          faceDetections: parsed.stats.faceDetections,
          associatedFaces: parsed.stats.associatedFaces,
          unassociatedFaces: parsed.stats.unassociatedFaces,
          elapsedMs: Date.now() - startTime,
        });
        resolve(parsed);
      } catch (e) {
        debugLog("parse stdout json failed", { error: String(e) });
        dispatchPipelineEvent("pipelineError", {
          stage: "parse",
          message: `Failed to parse pipeline output: ${stdout}`,
          exitCode: code,
          signal: signal ?? null,
        });
        reject(new Error(`Failed to parse pipeline output: ${stdout}`));
      }
    });

    proc.on("error", (err) => {
      _activePipelineProcess = null;
      clearTimers();
      debugLog("process error", err);
      dispatchPipelineEvent("pipelineError", {
        stage: "spawn",
        message: `Failed to spawn face pipeline: ${err.message}`,
        exitCode: null,
        signal: null,
      });
      reject(new Error(`Failed to spawn face pipeline: ${err.message}`));
    });
  });
}

export function cancelFacePipeline(): boolean {
  if (!_activePipelineProcess) {
    return false;
  }

  _activePipelineCancelled = true;
  try {
    _activePipelineProcess.kill("SIGTERM");
  } catch {
    // Ignore and fall through to SIGKILL fallback.
  }

  const proc = _activePipelineProcess;
  setTimeout(() => {
    if (proc === _activePipelineProcess) {
      try {
        _activePipelineProcess.kill("SIGKILL");
      } catch {
        // Ignore failures; process may have exited.
      }
    }
  }, 1000);

  return true;
}

/**
 * Raw result from C++ pipeline (bbox as array).
 */
interface RawResult {
  faceTracks: Array<{
    personId: number;
    frames: Array<{
      frameIndex: number;
      bbox: [number, number, number, number];
      confidence: number;
      assocIou: number;
    }>;
  }>;
  frameCount: number;
  stats: PipelineStats;
}

/**
 * Convert raw result to typed result (bbox as object).
 */
function parseRawResult(raw: RawResult): PipelineResult {
  const tracks: FaceTrack[] = raw.faceTracks.map((t) => ({
    id: t.personId,
    frames: t.frames.map((f) => ({
      frameIndex: f.frameIndex,
      bbox: {
        x1: f.bbox[0],
        y1: f.bbox[1],
        x2: f.bbox[2],
        y2: f.bbox[3],
      },
      confidence: f.confidence,
    })),
  }));

  return { tracks, frameCount: raw.frameCount, stats: raw.stats };
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Convert a normalized bounding box to mask points (4 corners).
 * Used for converting face detection bboxes to MOGRT mask format.
 */
export function bboxToMaskPoints(
  bbox: BBox | [number, number, number, number]
): Array<{ x: number; y: number }> {
  // Handle both object and array formats
  const x1 = Array.isArray(bbox) ? bbox[0] : bbox.x1;
  const y1 = Array.isArray(bbox) ? bbox[1] : bbox.y1;
  const x2 = Array.isArray(bbox) ? bbox[2] : bbox.x2;
  const y2 = Array.isArray(bbox) ? bbox[3] : bbox.y2;

  // Return 4 corners as mask points (clockwise from top-left)
  return [
    { x: x1, y: y1 }, // Top-left
    { x: x2, y: y1 }, // Top-right
    { x: x2, y: y2 }, // Bottom-right
    { x: x1, y: y2 }, // Bottom-left
  ];
}

/**
 * Run the face detection and tracking pipeline.
 *
 * Detects faces at sparse intervals (default 5fps) and tracks them across
 * all frames using OC-SORT with Kalman filtering.
 *
 * @param imagePaths - Array of frame image paths to process
 * @param options - Pipeline configuration options
 * @returns Promise resolving to tracks across all frames
 *
 * @example
 * ```typescript
 * const result = await runFacePipeline(framePaths, { videoFps: 29.97 });
 * for (const track of result.tracks) {
 *   console.log(`Track ${track.id}: ${track.frames.length} frames`);
 * }
 * ```
 */
export async function runFacePipeline(
  imagePaths: string[],
  options: PipelineOptions = {}
): Promise<PipelineResult> {
  if (imagePaths.length === 0) {
    return {
      tracks: [],
      frameCount: 0,
      stats: {
        personDetections: 0,
        faceDetections: 0,
        associatedFaces: 0,
        unassociatedFaces: 0,
        timingMs: {
          personDetect: 0,
          personPreprocess: 0,
          personInfer: 0,
          personDecode: 0,
          bodyReid: 0,
          faceDetect: 0,
          associate: 0,
          trackUpdate: 0,
        },
      },
    };
  }

  // Clean paths (remove file:// prefix if present)
  const cleanPaths = imagePaths
    .map((rawPath) => {
      if (!rawPath.startsWith("file://")) return rawPath;
      try {
        const parsed = new URL(rawPath);
        const decoded = decodeURIComponent(parsed.pathname);
        if (os.platform() === "win32") {
          return decoded.replace(/^\/([A-Za-z]:\/)/, "$1");
        }
        return decoded;
      } catch {
        return rawPath.replace("file://", "");
      }
    })
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .sort((a, b) => {
      const aBase = path.basename(a);
      const bBase = path.basename(b);
      const aMatch = aBase.match(/(\d+)(?!.*\d)/);
      const bMatch = bBase.match(/(\d+)(?!.*\d)/);
      if (aMatch && bMatch) {
        const diff = Number(aMatch[1]) - Number(bMatch[1]);
        if (diff !== 0) return diff;
      }
      return a.localeCompare(b);
    });

  return spawnPipeline(cleanPaths, {
    confThresh: options.confThresh ?? 0.5,
    detectionFps: options.detectionFps ?? 5.0,
    videoFps: options.videoFps ?? 30.0,
    iouThresh: options.iouThresh ?? 0.15,
  });
}
