interface ScrubberProps {
  framePathsLength: number;
  currentFrameIndex: number;
  playbackFps: number;
  isPlaying: boolean;
  activeMaskFrameSegments: { startFrameIndex: number; endFrameIndex: number }[];
  zoomLevel: number;
  onFrameChange: (index: number) => void;
  onPlayPause: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

function formatTimecode(frame: number, fps = 30): string {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const clampedFrame = Math.max(0, Math.floor(frame));
  const wholeSeconds = Math.floor(clampedFrame / safeFps);
  const elapsedSeconds = clampedFrame / safeFps;
  let ff = Math.round((elapsedSeconds - wholeSeconds) * safeFps);
  let totalSeconds = wholeSeconds;

  if (ff >= Math.round(safeFps)) {
    ff = 0;
    totalSeconds += 1;
  }

  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(
    ss
  ).padStart(2, "0")}:${String(ff).padStart(2, "0")}`;
}

export function Scrubber({
  framePathsLength,
  currentFrameIndex,
  playbackFps,
  isPlaying,
  activeMaskFrameSegments,
  zoomLevel,
  onFrameChange,
  onPlayPause,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: ScrubberProps) {
  if (framePathsLength === 0) return null;

  const totalFrameIndex = Math.max(0, framePathsLength - 1);
  const progressPercent =
    totalFrameIndex > 0 ? (currentFrameIndex / totalFrameIndex) * 100 : 0;
  const selectedTrackSegments =
    totalFrameIndex > 0
      ? activeMaskFrameSegments.map((segment) => {
          const startPercent = (segment.startFrameIndex / totalFrameIndex) * 100;
          const endPercent = (segment.endFrameIndex / totalFrameIndex) * 100;
          return {
            left: `${startPercent}%`,
            width: `${Math.max(0, endPercent - startPercent)}%`,
          };
        })
      : [];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="s-text-mono text-[#5da7ff]">
          {formatTimecode(currentFrameIndex, playbackFps)}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded border border-white/15 bg-black/20 px-1 py-0.5">
            <button
              onClick={onZoomOut}
              className="s-button-neutral h-5 w-5 min-w-0 px-0 text-[12px]"
              title="Zoom out"
              aria-label="Zoom out"
            >
              -
            </button>
            <button
              onClick={onZoomReset}
              className="h-5 rounded px-1.5 text-[12px] leading-none font-semibold tracking-tight text-[#d5dbe5] hover:text-white"
              title="Reset zoom to fit"
              aria-label="Reset zoom"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              onClick={onZoomIn}
              className="s-button-neutral h-5 w-5 min-w-0 px-0 text-[12px]"
              title="Zoom in"
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
          <button
            onClick={() => onFrameChange(Math.max(0, currentFrameIndex - 1))}
            className="s-button-neutral h-6 w-6 min-w-0 px-0"
            title="Previous frame"
            aria-label="Previous frame"
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11.5 2.5 5 8l6.5 5.5V2.5zM3 2h1.5v12H3V2z" />
            </svg>
          </button>
          <button
            onClick={onPlayPause}
            className="s-button-primary h-6 w-8 min-w-0 px-0"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <rect x="4" y="2" width="3" height="12" />
                <rect x="9" y="2" width="3" height="12" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4 2 L14 8 L4 14 Z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => onFrameChange(Math.min(totalFrameIndex, currentFrameIndex + 1))}
            className="s-button-neutral h-6 w-6 min-w-0 px-0"
            title="Next frame"
            aria-label="Next frame"
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.5 2.5 11 8l-6.5 5.5V2.5zM11.5 2H13v12h-1.5V2z" />
            </svg>
          </button>
        </div>
        <span className="s-text-mono text-[#afb6c0]">
          {formatTimecode(totalFrameIndex, playbackFps)}
        </span>
      </div>

      <div className="relative mt-0.5 h-5">
        <div className="absolute left-0 right-0 top-2 h-px bg-white/15" />
        {selectedTrackSegments.map((segment, index) => (
          <div
            key={`${segment.left}-${segment.width}-${index}`}
            className="absolute top-[7px] h-1 rounded-sm bg-[#5da7ff]/80"
            style={{
              left: segment.left,
              width: segment.width,
              minWidth: "2px",
            }}
          />
        ))}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage: [
              "repeating-linear-gradient(to right, rgba(184,191,201,0.9), rgba(184,191,201,0.9) 1px, transparent 1px, transparent 15px)",
              "repeating-linear-gradient(to right, rgba(194,201,209,0.95), rgba(194,201,209,0.95) 1px, transparent 1px, transparent 75px)",
            ].join(","),
            backgroundSize: "100% 8px, 100% 14px",
            backgroundPosition: "0 10px, 0 4px",
            backgroundRepeat: "repeat-x",
          }}
        />
        <div
          className="absolute top-1.5 h-3.5 w-0.5 bg-[#5da7ff]"
          style={{ left: `calc(${progressPercent}% - 1px)` }}
        />
        <div
          className="absolute top-0 h-0 w-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-[#5da7ff]"
          style={{ left: `calc(${progressPercent}% - 5px)` }}
        />
        <input
          type="range"
          min={0}
          max={totalFrameIndex}
          value={currentFrameIndex}
          onChange={(e) => {
            onFrameChange(parseInt(e.target.value, 10));
          }}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
          aria-label="Timeline"
        />
      </div>
    </div>
  );
}
