import { useEffect } from "react";
import { listenTS } from "../../lib/utils/bolt";

const LOG_PREFIX = "[face_pipeline]";

export function usePipelineEvents(setStatusMessage: (msg: string) => void) {
  useEffect(() => {
    if (!window.cep) return;

    listenTS("pipelineStarted", (data) => {
      console.debug(`${LOG_PREFIX} event pipelineStarted`, data);
      setStatusMessage(`Face pipeline started (${data.frameCount} frames).`);
    });

    listenTS("pipelineProgress", (data) => {
      console.debug(`${LOG_PREFIX} event pipelineProgress`, data);
      if (
        data.stage === "processing" &&
        typeof data.currentFrame === "number" &&
        typeof data.totalFrames === "number" &&
        data.totalFrames > 0
      ) {
        const current = Math.max(0, data.currentFrame);
        const total = Math.max(1, data.totalFrames);
        const percent =
          typeof data.percent === "number"
            ? Math.min(100, Math.max(0, Math.round(data.percent)))
            : Math.min(100, Math.max(0, Math.round((current / total) * 100)));
        setStatusMessage(
          `Detecting faces... ${current}/${total} (${percent}%)`
        );
        return;
      }
      if (data.stage === "linking") {
        setStatusMessage(data.message || "Linking track fragments...");
        return;
      }
      if (data.stage === "finalizing") {
        setStatusMessage(data.message || "Finalizing output...");
        return;
      }
      if (data.stage === "parsing") {
        setStatusMessage("Parsing pipeline output...");
        return;
      }
      if (typeof data.message === "string" && data.message) {
        setStatusMessage(data.message);
      }
    });

    listenTS("pipelineCompleted", (data) => {
      console.debug(`${LOG_PREFIX} event pipelineCompleted`, data);
      setStatusMessage(
        `Detection complete. ${data.trackCount} track(s), ${data.frameCount} frames.`
      );
    });

    listenTS("pipelineError", (data) => {
      console.debug(`${LOG_PREFIX} event pipelineError`, data);
      if (data.stage === "cancelled") {
        setStatusMessage("Detection cancelled.");
        return;
      }
      setStatusMessage(`Pipeline error: ${data.message}`);
    });
  }, [setStatusMessage]);
}
