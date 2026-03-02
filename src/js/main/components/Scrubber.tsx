interface ScrubberProps {
  framePathsLength: number;
  currentFrameIndex: number;
  isPlaying: boolean;
  onFrameChange: (index: number) => void;
  onPlayPause: () => void;
}

export function Scrubber({
  framePathsLength,
  currentFrameIndex,
  isPlaying,
  onFrameChange,
  onPlayPause,
}: ScrubberProps) {
  if (framePathsLength === 0) return null;

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onPlayPause}
        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-md transition-colors shadow-sm flex items-center justify-center min-w-[60px]"
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <rect x="4" y="2" width="3" height="12" />
            <rect x="9" y="2" width="3" height="12" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M4 2 L14 8 L4 14 Z" />
          </svg>
        )}
      </button>
      <input
        type="range"
        min={0}
        max={Math.max(0, framePathsLength - 1)}
        value={currentFrameIndex}
        onChange={(e) => {
          onFrameChange(parseInt(e.target.value));
        }}
        className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-600"
      />
      <div className="text-gray-300 text-xs w-32 text-right font-mono">
        Frame {currentFrameIndex + 1} / {framePathsLength}
      </div>
    </div>
  );
}
