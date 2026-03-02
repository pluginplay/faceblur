/**
 * @description Declare event types for listening with listenTS() and dispatching with dispatchTS()
 */
export type EventTS = {
  pipelineStarted: {
    frameCount: number;
    detectionFps: number;
    videoFps: number;
    confThresh: number;
    iouThresh: number;
  };
  pipelineProgress: {
    stage: "startup" | "processing" | "linking" | "finalizing" | "parsing";
    currentFrame?: number;
    totalFrames?: number;
    percent?: number;
    message: string;
  };
  pipelineCompleted: {
    frameCount: number;
    trackCount: number;
    personDetections: number;
    faceDetections: number;
    associatedFaces: number;
    unassociatedFaces: number;
    elapsedMs: number;
  };
  pipelineError: {
    stage: "spawn" | "runtime" | "parse" | "cancelled";
    message: string;
    exitCode?: number | null;
    signal?: string | null;
  };
};
