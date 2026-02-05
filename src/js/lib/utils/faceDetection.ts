/**
 * Face Detection and Tracking Pipeline
 *
 * TypeScript wrapper for the C++ face pipeline.
 * Single export: runFacePipeline()
 */

import { child_process, fs, os, path } from "../cep/node";
import { csi } from "./bolt";

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

export interface PipelineResult {
  tracks: FaceTrack[];
  frameCount: number;
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

  // Try common locations
  const candidates: string[] = [];

  if (platform === "win32") {
    candidates.push(
      path.join(extRoot, "cpp", "build", "Release", "face_pipeline.exe"),
      path.join(extRoot, "cpp", "build", "face_pipeline.exe"),
      // Packaged CEP assets
      path.join(extRoot, "bin", "face_pipeline.exe"),
      // Repo/dev fallback
      path.join(extRoot, "src", "bin", "face_pipeline.exe")
    );
  } else {
    candidates.push(
      path.join(extRoot, "cpp", "build", "face_pipeline"),
      // Packaged CEP assets
      path.join(extRoot, "bin", "face_pipeline"),
      // Repo/dev fallback
      path.join(extRoot, "src", "bin", "face_pipeline")
    );
  }

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

/**
 * Get path to the SCRFD model directory.
 */
function getModelDir(): string {
  const extRoot = getExtensionRoot();

  const candidates = [
    path.join(extRoot, "bin", "models"),
    // Repo/dev fallback
    path.join(extRoot, "src", "bin", "models"),
    path.join(extRoot, "cpp", "models"),
    path.join(extRoot, "models"),
  ];

  for (const candidate of candidates) {
    try {
      const paramPath = path.join(candidate, "scrfd.param");
      const binPath = path.join(candidate, "scrfd.bin");
      if (fs.existsSync(paramPath) && fs.existsSync(binPath)) {
        return candidate;
      }
    } catch {
      // continue
    }
  }

  throw new Error(
    `SCRFD model files not found. Checked: ${candidates.join(", ")}`
  );
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
    const executable = getPipelineExecutable();
    const modelDir = getModelDir();

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
    const platform = os.platform();

    if (platform === "darwin") {
      // macOS: add executable directory to dylib search path
      const existingPath = spawnEnv.DYLD_LIBRARY_PATH || "";
      spawnEnv.DYLD_LIBRARY_PATH = existingPath
        ? `${executableDir}:${existingPath}`
        : executableDir;
    } else if (platform === "linux") {
      // Linux: add executable directory to shared library search path
      const existingPath = spawnEnv.LD_LIBRARY_PATH || "";
      spawnEnv.LD_LIBRARY_PATH = existingPath
        ? `${executableDir}:${existingPath}`
        : executableDir;
    }
    // Windows: DLLs in the same directory as .exe are found automatically

    const proc = child_process.spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: spawnEnv,
    });

    // Write image paths to stdin (one per line)
    for (const p of imagePaths) {
      proc.stdin.write(p + "\n");
    }
    proc.stdin.end();

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`Face pipeline exited with code ${code}: ${stderr || stdout}`)
        );
        return;
      }

      try {
        const result = JSON.parse(stdout) as RawResult;
        resolve(parseRawResult(result));
      } catch (e) {
        reject(new Error(`Failed to parse pipeline output: ${stdout}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn face pipeline: ${err.message}`));
    });
  });
}

/**
 * Raw result from C++ pipeline (bbox as array).
 */
interface RawResult {
  tracks: Array<{
    id: number;
    frames: Array<{
      frameIndex: number;
      bbox: [number, number, number, number];
      confidence: number;
    }>;
  }>;
  frameCount: number;
}

/**
 * Convert raw result to typed result (bbox as object).
 */
function parseRawResult(raw: RawResult): PipelineResult {
  const tracks: FaceTrack[] = raw.tracks.map((t) => ({
    id: t.id,
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

  return { tracks, frameCount: raw.frameCount };
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
    return { tracks: [], frameCount: 0 };
  }

  // Clean paths (remove file:// prefix if present)
  const cleanPaths = imagePaths.map((p) =>
    p.startsWith("file://") ? p.replace("file://", "") : p
  );

  return spawnPipeline(cleanPaths, {
    confThresh: options.confThresh ?? 0.5,
    detectionFps: options.detectionFps ?? 5.0,
    videoFps: options.videoFps ?? 30.0,
    iouThresh: options.iouThresh ?? 0.15,
  });
}
