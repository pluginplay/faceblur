import { useState } from "react";

interface ActionButtonsProps {
  isRendering: boolean;
  isDetectingFaces: boolean;
  selectedClipCount: number;
  confidenceThreshold: number;
  onConfidenceChange: (v: number) => void;
  onLoadAndRender: () => void;
  onCancel: () => void;
}

export function ActionButtons({
  isRendering,
  isDetectingFaces,
  selectedClipCount,
  confidenceThreshold,
  onConfidenceChange,
  onLoadAndRender,
  onCancel,
}: ActionButtonsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isBusy = isRendering || isDetectingFaces;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2 items-center flex-wrap">
        <button
          onClick={onLoadAndRender}
          disabled={isBusy}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
        >
          {isRendering
            ? "Rendering Segment…"
            : isDetectingFaces
              ? "Detecting Segment…"
              : `Run Selected Clips (${selectedClipCount})`}
        </button>
        {isBusy && (
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md transition-colors shadow-sm"
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`p-2 rounded-md transition-colors ${
            showAdvanced
              ? "bg-gray-600 text-gray-200"
              : "text-gray-400 hover:text-gray-300 hover:bg-gray-700/50"
          }`}
          title="Detection settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
          </svg>
        </button>
      </div>
      {showAdvanced && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-800/50 rounded-md border border-gray-700/50">
          <label className="text-gray-400 text-xs font-medium whitespace-nowrap">
            Confidence threshold:
          </label>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={confidenceThreshold}
            onChange={(e) =>
              onConfidenceChange(parseFloat(e.target.value) || 0.5)
            }
            disabled={isDetectingFaces}
            className="w-16 px-2 py-1 bg-gray-700 text-gray-200 text-xs rounded border border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          />
          <span className="text-gray-500 text-xs">
            (0–1, higher = stricter)
          </span>
        </div>
      )}
    </div>
  );
}
