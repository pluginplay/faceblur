import { useEffect, useState } from "react";
import type { UIMask } from "../types";
import { MaskProperties } from "./MaskProperties";

interface ActionButtonsProps {
  isRendering: boolean;
  isDetectingFaces: boolean;
  selectedClipCount: number;
  confidenceThreshold: number;
  activeMask: UIMask | null;
  onConfidenceChange: (v: number) => void;
  onBlurrinessChange: (v: number) => void;
  onFeatherChange: (v: number) => void;
  onExpansionChange: (v: number) => void;
  onLoadAndRender: () => void;
  onCancel: () => void;
}

export function ActionButtons({
  isRendering,
  isDetectingFaces,
  selectedClipCount,
  confidenceThreshold,
  activeMask,
  onConfidenceChange,
  onBlurrinessChange,
  onFeatherChange,
  onExpansionChange,
  onLoadAndRender,
  onCancel,
}: ActionButtonsProps) {
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const isBusy = isRendering || isDetectingFaces;
  const runLabel = isRendering
    ? "Rendering Segment..."
    : isDetectingFaces
      ? "Detecting Segment..."
      : `Run Selected Clips (${selectedClipCount})`;

  useEffect(() => {
    if (!showSettingsDialog) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowSettingsDialog(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showSettingsDialog]);

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onLoadAndRender}
          disabled={isBusy}
          className="s-button-primary min-w-[170px]"
        >
          {runLabel}
        </button>
        {isBusy && (
          <button
            onClick={onCancel}
            className="s-button-neutral text-[#e8b8b8]"
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => setShowSettingsDialog(true)}
          className={`s-button-ghost w-8 px-0 ${
            showSettingsDialog
              ? "bg-white/10 text-[#d7deea]"
              : "text-[#b5bcc6]"
          }`}
          title="Settings"
          aria-label="Settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
        </button>
      </div>

      {showSettingsDialog && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 p-3"
          onClick={() => setShowSettingsDialog(false)}
        >
          <div
            className="w-full max-w-[460px] rounded-lg border border-white/15 bg-[#232427] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="text-[15px] font-semibold tracking-tight text-[#dce2ec]">
                Settings
              </h2>
              <button
                onClick={() => setShowSettingsDialog(false)}
                className="s-button-ghost h-7 px-2"
                aria-label="Close settings"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 px-4 py-3">
              <div>
                <label
                  htmlFor="confidence-threshold-input"
                  className="s-text-caption"
                >
                  Detection confidence threshold
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="confidence-threshold-input"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={confidenceThreshold}
                    onChange={(e) =>
                      onConfidenceChange(parseFloat(e.target.value) || 0.5)
                    }
                    disabled={isDetectingFaces}
                    className="s-input w-16"
                  />
                  <span className="s-text-caption font-normal text-[#9da6b3]">
                    0 to 1, higher is stricter
                  </span>
                </div>
              </div>

              <div className="border-t border-white/10 pt-3">
                {activeMask ? (
                  <MaskProperties
                    activeMask={activeMask}
                    onBlurrinessChange={onBlurrinessChange}
                    onFeatherChange={onFeatherChange}
                    onExpansionChange={onExpansionChange}
                  />
                ) : (
                  <div>
                    <h3 className="s-panel-title">Mask Properties</h3>
                    <p className="mt-1 s-text-caption font-normal text-[#9da6b3]">
                      Select a track to edit mask properties.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
