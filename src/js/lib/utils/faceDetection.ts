import { child_process, fs, os, path } from "../cep/node";
import { csi } from "./bolt";

// Cache for extension root and script path to avoid repeated resolution
let cachedExtensionRoot: string | null = null;
let cachedScriptPath: string | null = null;

/**
 * Get the extension root path (cached)
 */
const getExtensionRoot = (): string => {
  if (cachedExtensionRoot === null) {
    if (typeof window !== "undefined" && window.cep) {
      cachedExtensionRoot = csi.getSystemPath("extension");
    } else {
      cachedExtensionRoot = process.cwd();
    }
  }
  // @ts-ignore
  return cachedExtensionRoot;
};

/**
 * Get the Python script path (cached)
 */
const getScriptPath = (): string => {
  if (cachedScriptPath === null) {
    cachedScriptPath = path.join(
      getExtensionRoot(),
      "scripts",
      "detect_faces.py"
    );
  }
  return cachedScriptPath;
};

export interface FaceDetection {
  bbox: [number, number, number, number]; // [x1, y1, x2, y2] normalized 0-1
  confidence: number;
  landmarks?: Array<[number, number]>;
}

export interface FaceDetectionResult {
  success?: boolean;
  error?: string;
  faces: FaceDetection[];
  image_width?: number;
  image_height?: number;
  count?: number;
}

export interface FaceDetectionsPerFrame {
  frameIndex: number;
  faces: FaceDetection[];
}

export interface FaceTrackFrame {
  frameIndex: number;
  bbox: [number, number, number, number];
}

export interface FaceTrack {
  id: number;
  frames: FaceTrackFrame[];
}

/**
 * Detects faces in an image using UniFace Python script
 * @param imagePath Path to the image file
 * @param confThresh Confidence threshold for face detection (default: 0.5)
 * @returns Promise resolving to face detection results
 */
export const detectFaces = async (
  imagePath: string,
  confThresh: number = 0.5
): Promise<FaceDetectionResult> => {
  return new Promise((resolve, reject) => {
    try {
      // Clean up image path - remove file:// prefix if present
      let cleanImagePath = imagePath;
      if (cleanImagePath.startsWith("file://")) {
        cleanImagePath = cleanImagePath.replace("file://", "");
      }

      // Get the path to the Python script (using cached path)
      const scriptPath = getScriptPath();

      // Verify script exists
      if (!fs.existsSync(scriptPath)) {
        reject(
          new Error(
            `Python script not found at: ${scriptPath}. Make sure scripts/detect_faces.py exists.`
          )
        );
        return;
      }

      // Verify image file exists
      if (!fs.existsSync(cleanImagePath)) {
        reject(new Error(`Image file not found at: ${cleanImagePath}`));
        return;
      }

      // Use python3 command (works on macOS/Linux)
      // On Windows, might need to use 'python' instead
      // Try to use the full path to python3 that has packages installed
      // CEP extensions may not have access to PATH, so we need to find the right Python
      let pythonCmd: string;
      if (os.platform() === "win32") {
        pythonCmd = "python";
      } else {
        // On macOS/Linux, try common Python locations
        // Priority: pyenv shim > homebrew > system python3
        const homeDir = os.homedir();
        const commonPaths = [
          `${homeDir}/.pyenv/shims/python3`, // pyenv shim (most likely to have packages)
          "/opt/homebrew/bin/python3", // Apple Silicon Homebrew
          "/usr/local/bin/python3", // Intel Homebrew or system
          "/usr/bin/python3", // System Python
        ];

        pythonCmd = "python3"; // Default fallback

        // Try to find an existing Python executable
        for (const pyPath of commonPaths) {
          try {
            if (fs.existsSync && fs.existsSync(pyPath)) {
              pythonCmd = pyPath;
              break;
            }
          } catch (e) {
            // Continue to next path
          }
        }
      }

      // Execute Python script
      // Use shell execution to ensure pyenv and PATH are properly set up
      // This is necessary because CEP extensions may not have full shell environment
      const useShell = os.platform() !== "win32"; // Use shell on macOS/Linux
      const homeDirForShell = os.homedir(); // Get home dir for shell command

      let command: string;
      let args: string[];

      if (useShell) {
        // Use shell to execute Python, which ensures pyenv shims work correctly
        // The shell will properly resolve pyenv shims and set up the environment
        // Escape paths to handle special characters
        const escapeShell = (str: string) => str.replace(/'/g, "'\"'\"'");
        command = "/bin/bash";
        args = [
          "-c",
          `export PATH="${homeDirForShell}/.pyenv/shims:$PATH" && export PYENV_ROOT="${homeDirForShell}/.pyenv" && ${pythonCmd} '${escapeShell(scriptPath)}' '${escapeShell(cleanImagePath)}' ${confThresh.toString()}`,
        ];
      } else {
        // Windows: use Python directly
        command = pythonCmd;
        args = [scriptPath, cleanImagePath, confThresh.toString()];
      }

      const pythonProcess = child_process.spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      pythonProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `Python script exited with code ${code}. Error: ${stderr || stdout}`
            )
          );
          return;
        }

        try {
          const result = JSON.parse(stdout) as FaceDetectionResult;
          resolve(result);
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse Python output: ${stdout}. Error: ${parseError}`
            )
          );
        }
      });

      pythonProcess.on("error", (error) => {
        reject(
          new Error(
            `Failed to spawn Python process: ${error.message}. Make sure Python 3 and UniFace are installed.`
          )
        );
      });
    } catch (error: any) {
      reject(new Error(`Face detection error: ${error.message}`));
    }
  });
};

/**
 * Run face detection across many image paths in a single batch call.
 * This is much faster than individual calls because the model only loads once.
 * Returns an array aligned with input order: one result per frame index.
 */
export const detectFacesBatch = async (
  imagePaths: string[],
  confThresh: number = 0.5,
  concurrency?: number, // Deprecated - kept for API compatibility
  onProgress?: (done: number, total: number) => void,
  abortRef?: { cancelled: boolean }
): Promise<FaceDetectionsPerFrame[]> => {
  const total = imagePaths.length;

  if (total === 0) {
    return [];
  }

  // Check for cancellation before starting
  if (abortRef?.cancelled) {
    return imagePaths.map((_, idx) => ({ frameIndex: idx, faces: [] }));
  }

  return new Promise((resolve, reject) => {
    try {
      // Clean up image paths - remove file:// prefix if present
      const cleanImagePaths = imagePaths.map((imagePath) => {
        if (imagePath.startsWith("file://")) {
          return imagePath.replace("file://", "");
        }
        return imagePath;
      });

      // Get the path to the Python script (using cached path)
      const scriptPath = getScriptPath();

      // Verify script exists
      if (!fs.existsSync(scriptPath)) {
        reject(
          new Error(
            `Python script not found at: ${scriptPath}. Make sure scripts/detect_faces.py exists.`
          )
        );
        return;
      }

      // Verify all image files exist
      for (const imagePath of cleanImagePaths) {
        if (!fs.existsSync(imagePath)) {
          reject(new Error(`Image file not found at: ${imagePath}`));
          return;
        }
      }

      // Use python3 command (works on macOS/Linux)
      let pythonCmd: string;
      if (os.platform() === "win32") {
        pythonCmd = "python";
      } else {
        const homeDir = os.homedir();
        const commonPaths = [
          `${homeDir}/.pyenv/shims/python3`,
          "/opt/homebrew/bin/python3",
          "/usr/local/bin/python3",
          "/usr/bin/python3",
        ];

        pythonCmd = "python3";

        for (const pyPath of commonPaths) {
          try {
            if (fs.existsSync && fs.existsSync(pyPath)) {
              pythonCmd = pyPath;
              break;
            }
          } catch (e) {
            // Continue to next path
          }
        }
      }

      // Prepare batch request JSON
      const batchRequest = {
        image_paths: cleanImagePaths,
        conf_thresh: confThresh,
      };
      const inputJson = JSON.stringify(batchRequest);

      // Execute Python script with stdin input
      // For batch mode, we need to ensure stdin is properly forwarded
      // On macOS/Linux, we'll use a shell wrapper that properly forwards stdin
      const useShell = os.platform() !== "win32";
      const homeDirForShell = os.homedir();

      let command: string;
      let args: string[];
      let env: NodeJS.ProcessEnv | undefined;

      if (useShell) {
        // Use shell to execute Python with proper environment setup
        // The shell wrapper ensures pyenv works, and stdin forwarding works with spawn
        const escapeShell = (str: string) => str.replace(/'/g, "'\"'\"'");
        command = "/bin/bash";
        args = [
          "-c",
          `export PATH="${homeDirForShell}/.pyenv/shims:$PATH" && export PYENV_ROOT="${homeDirForShell}/.pyenv" && exec ${pythonCmd} '${escapeShell(scriptPath)}'`,
        ];
        // Set up environment for the shell
        env = {
          ...process.env,
          PATH: `${homeDirForShell}/.pyenv/shims:${process.env.PATH || ""}`,
          PYENV_ROOT: `${homeDirForShell}/.pyenv`,
        };
      } else {
        // Windows: use Python directly with stdin
        command = pythonCmd;
        args = [scriptPath];
        env = process.env;
      }

      const pythonProcess = child_process.spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"], // stdin, stdout, stderr
        env: env,
      });

      // Write JSON to stdin
      pythonProcess.stdin.write(inputJson);
      pythonProcess.stdin.end();

      let stdout = "";
      let stderr = "";

      pythonProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (abortRef?.cancelled) {
          resolve(imagePaths.map((_, idx) => ({ frameIndex: idx, faces: [] })));
          return;
        }

        if (code !== 0) {
          reject(
            new Error(
              `Python script exited with code ${code}. Error: ${stderr || stdout}`
            )
          );
          return;
        }

        try {
          const batchResult = JSON.parse(stdout) as {
            success?: boolean;
            error?: string;
            results?: FaceDetectionResult[];
            count?: number;
          };

          if (batchResult.error) {
            reject(new Error(batchResult.error));
            return;
          }

          if (!batchResult.results || batchResult.results.length !== total) {
            reject(
              new Error(
                `Expected ${total} results but got ${batchResult.results?.length || 0}`
              )
            );
            return;
          }

          // Convert to FaceDetectionsPerFrame format
          const results: FaceDetectionsPerFrame[] = batchResult.results.map(
            (result, idx) => ({
              frameIndex: idx,
              faces: result.faces || [],
            })
          );

          // Call progress callback for completion
          if (onProgress) {
            onProgress(total, total);
          }

          resolve(results);
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse Python output: ${stdout}. Error: ${parseError}`
            )
          );
        }
      });

      pythonProcess.on("error", (error) => {
        reject(
          new Error(
            `Failed to spawn Python process: ${error.message}. Make sure Python 3 and UniFace are installed.`
          )
        );
      });
    } catch (error: any) {
      reject(new Error(`Face detection batch error: ${error.message}`));
    }
  });
};

/**
 * Incrementally detect faces as frames are rendered.
 * Starts Python script in watch mode to process frames as they appear in the directory.
 * Returns results incrementally via callback as each frame is processed.
 *
 * @param watchDir Directory to watch for PNG frames
 * @param expectedFrameCount Expected number of frames (optional, for progress tracking)
 * @param confThresh Confidence threshold for face detection
 * @param onFrameDetected Callback called for each frame as it's detected: (frameIndex, result, totalProcessed) => void
 * @param onComplete Callback called when detection is complete: (allResults) => void
 * @param abortRef Optional ref object with cancelled flag to abort detection
 * @returns Promise resolving to all detection results
 */
export const detectFacesIncremental = async (
  watchDir: string,
  expectedFrameCount: number | null,
  confThresh: number = 0.5,
  onFrameDetected?: (
    frameIndex: number,
    result: FaceDetectionResult,
    totalProcessed: number
  ) => void,
  onComplete?: (results: FaceDetectionsPerFrame[]) => void,
  abortRef?: { cancelled: boolean }
): Promise<FaceDetectionsPerFrame[]> => {
  return new Promise((resolve, reject) => {
    try {
      // Check for cancellation before starting
      if (abortRef?.cancelled) {
        resolve([]);
        return;
      }

      // Get the path to the Python script (using cached path)
      const scriptPath = getScriptPath();

      // Verify script exists
      if (!fs.existsSync(scriptPath)) {
        reject(
          new Error(
            `Python script not found at: ${scriptPath}. Make sure scripts/detect_faces.py exists.`
          )
        );
        return;
      }

      // Verify watch directory exists
      if (!fs.existsSync(watchDir)) {
        reject(new Error(`Watch directory does not exist: ${watchDir}`));
        return;
      }

      // Use python3 command (works on macOS/Linux)
      let pythonCmd: string;
      if (os.platform() === "win32") {
        pythonCmd = "python";
      } else {
        const homeDir = os.homedir();
        const commonPaths = [
          `${homeDir}/.pyenv/shims/python3`,
          "/opt/homebrew/bin/python3",
          "/usr/local/bin/python3",
          "/usr/bin/python3",
        ];

        pythonCmd = "python3";

        for (const pyPath of commonPaths) {
          try {
            if (fs.existsSync && fs.existsSync(pyPath)) {
              pythonCmd = pyPath;
              break;
            }
          } catch (e) {
            // Continue to next path
          }
        }
      }

      // Prepare watch request JSON
      const watchRequest = {
        watch_dir: watchDir,
        conf_thresh: confThresh,
        expected_count: expectedFrameCount,
        poll_interval: 0.1, // Reduced from 0.5s to 0.1s for faster response
      };
      const inputJson = JSON.stringify(watchRequest);

      // Execute Python script with stdin input
      const useShell = os.platform() !== "win32";
      const homeDirForShell = os.homedir();

      let command: string;
      let args: string[];
      let env: NodeJS.ProcessEnv | undefined;

      if (useShell) {
        const escapeShell = (str: string) => str.replace(/'/g, "'\"'\"'");
        command = "/bin/bash";
        args = [
          "-c",
          `export PATH="${homeDirForShell}/.pyenv/shims:$PATH" && export PYENV_ROOT="${homeDirForShell}/.pyenv" && exec ${pythonCmd} '${escapeShell(scriptPath)}'`,
        ];
        env = {
          ...process.env,
          PATH: `${homeDirForShell}/.pyenv/shims:${process.env.PATH || ""}`,
          PYENV_ROOT: `${homeDirForShell}/.pyenv`,
        };
      } else {
        command = pythonCmd;
        args = [scriptPath];
        env = process.env;
      }

      const pythonProcess = child_process.spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: env,
      });

      // Write JSON to stdin
      pythonProcess.stdin.write(inputJson);
      pythonProcess.stdin.end();

      const results: FaceDetectionsPerFrame[] = [];
      const resultsByIndex = new Map<number, FaceDetectionsPerFrame>();
      let buffer = "";
      let totalProcessed = 0;
      let isDone = false;

      pythonProcess.stdout.on("data", (data) => {
        if (abortRef?.cancelled) {
          pythonProcess.kill();
          return;
        }

        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line);

            // Check if this is a completion message
            if (parsed.done === true) {
              isDone = true;
              totalProcessed = parsed.total_processed || totalProcessed;
              continue;
            }

            // Check for errors
            if (parsed.error && !parsed.frame_index) {
              reject(new Error(parsed.error));
              return;
            }

            // Process frame result
            if (parsed.frame_index !== undefined && parsed.result) {
              const frameIndex = parsed.frame_index;
              const result: FaceDetectionResult = parsed.result;
              const detection: FaceDetectionsPerFrame = {
                frameIndex,
                faces: result.faces || [],
              };

              resultsByIndex.set(frameIndex, detection);
              totalProcessed++;

              // Call incremental callback
              if (onFrameDetected) {
                onFrameDetected(frameIndex, result, totalProcessed);
              }
            }
          } catch (parseError) {
            // Skip malformed JSON lines (might be Python logging)
            console.warn("Failed to parse Python output line:", line);
          }
        }
      });

      pythonProcess.stderr.on("data", (data) => {
        // Python may write to stderr for logging, but we'll only treat it as an error
        // if the process exits with non-zero code
        const stderrText = data.toString();
        if (stderrText.includes("Error") || stderrText.includes("Traceback")) {
          console.error("Python stderr:", stderrText);
        }
      });

      pythonProcess.on("close", (code) => {
        if (abortRef?.cancelled) {
          resolve([]);
          return;
        }

        if (code !== 0 && !isDone) {
          reject(
            new Error(
              `Python script exited with code ${code}. Check console for details.`
            )
          );
          return;
        }

        // Convert map to sorted array
        const sortedResults: FaceDetectionsPerFrame[] = [];
        const indices = Array.from(resultsByIndex.keys()).sort((a, b) => a - b);
        for (const idx of indices) {
          sortedResults.push(resultsByIndex.get(idx)!);
        }

        // Call completion callback
        if (onComplete) {
          onComplete(sortedResults);
        }

        resolve(sortedResults);
      });

      pythonProcess.on("error", (error) => {
        reject(
          new Error(
            `Failed to spawn Python process: ${error.message}. Make sure Python 3 and UniFace are installed.`
          )
        );
      });
    } catch (error: any) {
      reject(new Error(`Face detection incremental error: ${error.message}`));
    }
  });
};

/**
 * Assign detections to stable tracks across frames via greedy nearest-centroid match.
 * Makes at most N tracks where N is the maximum number of faces seen in any frame.
 */
export const assignFacesToTracks = (
  detectionsPerFrame: FaceDetectionsPerFrame[],
  distanceThreshold: number = 0.25
): FaceTrack[] => {
  const tracks: FaceTrack[] = [];
  let nextId = 1;

  const centerOf = (bbox: [number, number, number, number]) => {
    const [x1, y1, x2, y2] = bbox;
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  };

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  for (const frame of detectionsPerFrame) {
    // Greedy: sort faces left-to-right to stabilize ordering
    const sortedFaces = [...frame.faces].sort(
      (fa, fb) => centerOf(fa.bbox).x - centerOf(fb.bbox).x
    );

    // Attempt to match to existing tracks using last known centers
    const available = new Set<number>();
    for (let i = 0; i < tracks.length; i++) available.add(i);

    const matches: Array<{ trackIdx: number; face: FaceDetection }> = [];

    for (const face of sortedFaces) {
      // Find nearest available track
      let bestTrack: number | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      const c = centerOf(face.bbox);
      available.forEach((trackIdx) => {
        const tr = tracks[trackIdx];
        const last = tr.frames[tr.frames.length - 1];
        const lc = centerOf(last.bbox);
        const d = dist(c, lc);
        if (d < bestDist) {
          bestDist = d;
          bestTrack = trackIdx;
        }
      });
      if (bestTrack !== null && bestDist <= distanceThreshold) {
        matches.push({ trackIdx: bestTrack, face });
        available.delete(bestTrack);
      } else {
        // Start a new track
        const id = nextId++;
        tracks.push({
          id,
          frames: [{ frameIndex: frame.frameIndex, bbox: face.bbox }],
        });
      }
    }

    // Apply matches
    for (const m of matches) {
      tracks[m.trackIdx].frames.push({
        frameIndex: frame.frameIndex,
        bbox: m.face.bbox,
      });
    }
  }

  // Normalize: ensure exactly N tracks (N = max faces over frames)
  const maxFaces = detectionsPerFrame.reduce(
    (acc, f) => Math.max(acc, f.faces.length),
    0
  );
  while (tracks.length < maxFaces) {
    tracks.push({ id: nextId++, frames: [] });
  }

  return tracks;
};

/**
 * Converts a face detection bounding box to mask points (rectangle)
 * @param bbox Bounding box [x1, y1, x2, y2] in normalized coordinates
 * @returns Array of 4 points forming a rectangle
 */
export const bboxToMaskPoints = (
  bbox: [number, number, number, number]
): Array<{ x: number; y: number }> => {
  const [x1, y1, x2, y2] = bbox;
  return [
    { x: x1, y: y1 }, // Top-left
    { x: x2, y: y1 }, // Top-right
    { x: x2, y: y2 }, // Bottom-right
    { x: x1, y: y2 }, // Bottom-left
  ];
};
