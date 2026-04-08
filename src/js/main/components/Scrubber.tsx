import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Tooltip } from "../../components/ui/Tooltip";
import type { TimelineViewport } from "../types";
import {
  ensureFrameVisibleInTimelineViewport,
  frameIndexToRangePercent,
  getTimelineMinimumVisibleSpan,
  getTimelineViewportSpan,
  getTotalFrameIndex,
  panTimelineViewport,
  positionToFrameIndex,
  recenterTimelineViewport,
  zoomTimelineViewport,
} from "../lib/timelineViewport";

type SelectionBox = {
  startX: number;
  currentX: number;
  laneWidth: number;
};

type OverviewInteraction = {
  mode: "start-handle" | "end-handle" | "window";
  startClientX: number;
  barWidth: number;
  startViewport: TimelineViewport;
};

type RulerScrubState = {
  width: number;
};

const HANDLE_ZOOM_SENSITIVITY = 1.2;

interface ScrubberProps {
  framePathsLength: number;
  currentFrameIndex: number;
  playbackFps: number;
  isPlaying: boolean;
  visibleStartFrameIndex: number;
  visibleEndFrameIndex: number;
  activeMaskFrameSegments: { startFrameIndex: number; endFrameIndex: number }[];
  activeMaskKeyframeFrames: number[];
  selectedKeyframeFrames: number[];
  onSelectedKeyframeFramesChange: (frameIndices: number[]) => void;
  onDeleteSelectedKeyframes: () => void;
  onMoveSelectedKeyframes: () => void;
  canMoveSelectedKeyframes: boolean;
  onFrameChange: (index: number) => void;
  onVisibleRangeChange: (viewport: TimelineViewport) => void;
  onPlayPause: () => void;
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
    ss,
  ).padStart(2, "0")}:${String(ff).padStart(2, "0")}`;
}

export function Scrubber({
  framePathsLength,
  currentFrameIndex,
  playbackFps,
  isPlaying,
  visibleStartFrameIndex,
  visibleEndFrameIndex,
  activeMaskFrameSegments,
  activeMaskKeyframeFrames,
  selectedKeyframeFrames,
  onSelectedKeyframeFramesChange,
  onDeleteSelectedKeyframes,
  onMoveSelectedKeyframes,
  canMoveSelectedKeyframes,
  onFrameChange,
  onVisibleRangeChange,
  onPlayPause,
}: ScrubberProps) {
  const overviewBarRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const keyframeLaneRef = useRef<HTMLDivElement | null>(null);
  const selectionBoxRef = useRef<SelectionBox | null>(null);
  const overviewInteractionRef = useRef<OverviewInteraction | null>(null);
  const rulerScrubRef = useRef<RulerScrubState | null>(null);
  const viewportRef = useRef<TimelineViewport>({
    startFrameIndex: visibleStartFrameIndex,
    endFrameIndex: visibleEndFrameIndex,
  });

  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [activeOverviewMode, setActiveOverviewMode] = useState<
    OverviewInteraction["mode"] | null
  >(null);
  const [isRulerScrubbing, setIsRulerScrubbing] = useState(false);

  const selectedKeyframes = useMemo(
    () => new Set(selectedKeyframeFrames),
    [selectedKeyframeFrames],
  );
  const visibleViewport = useMemo<TimelineViewport>(
    () => ({
      startFrameIndex: visibleStartFrameIndex,
      endFrameIndex: visibleEndFrameIndex,
    }),
    [visibleEndFrameIndex, visibleStartFrameIndex],
  );
  const totalFrameIndex = getTotalFrameIndex(framePathsLength);
  const minimumVisibleSpan = useMemo(
    () => getTimelineMinimumVisibleSpan(totalFrameIndex, playbackFps),
    [playbackFps, totalFrameIndex],
  );
  const totalFrameCount = Math.max(1, totalFrameIndex + 1);
  const visibleFrameCount = getTimelineViewportSpan(visibleViewport);
  const canZoomIn = visibleFrameCount > minimumVisibleSpan;
  const canZoomOut = visibleFrameCount < totalFrameCount;
  const moveSelectedKeyframesTooltip = useMemo(() => {
    if (selectedKeyframeFrames.length === 0) {
      return "Select one or more keyframes to move them to another track.";
    }
    if (!canMoveSelectedKeyframes) {
      return "Create another track before moving the selected keyframes.";
    }
    return "Move the selected keyframes to a different track.";
  }, [canMoveSelectedKeyframes, selectedKeyframeFrames.length]);
  const deleteSelectedKeyframesTooltip =
    selectedKeyframeFrames.length === 0
      ? "Select one or more keyframes to delete them from the current track."
      : "Delete the selected keyframes from the current track.";

  useEffect(() => {
    viewportRef.current = visibleViewport;
  }, [visibleViewport]);

  const setActiveSelectionBox = useCallback((next: SelectionBox | null) => {
    selectionBoxRef.current = next;
    setSelectionBox(next);
  }, []);

  const getRelativeX = useCallback(
    (ref: RefObject<HTMLDivElement | null>, clientX: number): number | null => {
      const element = ref.current;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return Math.max(0, Math.min(rect.width, clientX - rect.left));
    },
    [],
  );

  const getRawRelativeX = useCallback(
    (ref: RefObject<HTMLDivElement | null>, clientX: number): number | null => {
      const element = ref.current;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return clientX - rect.left;
    },
    [],
  );

  const mapXToVisibleFrame = useCallback(
    (x: number, width: number) =>
      positionToFrameIndex(
        x,
        width,
        viewportRef.current.startFrameIndex,
        viewportRef.current.endFrameIndex,
      ),
    [],
  );

  const commitVisibleFrameAtClientX = useCallback(
    (clientX: number) => {
      const x = getRawRelativeX(rulerRef, clientX);
      const width = rulerRef.current?.getBoundingClientRect().width ?? 0;
      if (x === null || width <= 0) return;
      const currentViewport = viewportRef.current;
      const visibleSpan = Math.max(
        1,
        currentViewport.endFrameIndex - currentViewport.startFrameIndex,
      );
      const unclampedFrameIndex = Math.round(
        currentViewport.startFrameIndex + (x / width) * visibleSpan,
      );
      const nextFrameIndex = Math.max(
        0,
        Math.min(totalFrameIndex, unclampedFrameIndex),
      );

      if (
        nextFrameIndex < currentViewport.startFrameIndex ||
        nextFrameIndex > currentViewport.endFrameIndex
      ) {
        onVisibleRangeChange(
          ensureFrameVisibleInTimelineViewport(
            currentViewport,
            nextFrameIndex,
            totalFrameIndex,
            minimumVisibleSpan,
          ),
        );
      }

      onFrameChange(nextFrameIndex);
    },
    [
      getRawRelativeX,
      minimumVisibleSpan,
      onFrameChange,
      onVisibleRangeChange,
      totalFrameIndex,
    ],
  );

  const selectKeyframesInRange = useCallback(
    (startX: number, endX: number) => {
      const lane = keyframeLaneRef.current;
      if (!lane) return;
      const width = lane.getBoundingClientRect().width;
      if (width <= 0) return;

      const minFrame = mapXToVisibleFrame(Math.min(startX, endX), width);
      const maxFrame = mapXToVisibleFrame(Math.max(startX, endX), width);

      onSelectedKeyframeFramesChange(
        activeMaskKeyframeFrames.filter(
          (frameIndex) => frameIndex >= minFrame && frameIndex <= maxFrame,
        ),
      );
    },
    [activeMaskKeyframeFrames, mapXToVisibleFrame, onSelectedKeyframeFramesChange],
  );

  const marqueeRect = selectionBox
    ? {
        left: Math.min(selectionBox.startX, selectionBox.currentX),
        width: Math.abs(selectionBox.currentX - selectionBox.startX),
      }
    : null;
  const marqueeSelectedKeyframes = useMemo(() => {
    if (!selectionBox || selectionBox.laneWidth <= 0) return new Set<number>();
    const minFrame = mapXToVisibleFrame(
      Math.min(selectionBox.startX, selectionBox.currentX),
      selectionBox.laneWidth,
    );
    const maxFrame = mapXToVisibleFrame(
      Math.max(selectionBox.startX, selectionBox.currentX),
      selectionBox.laneWidth,
    );
    return new Set(
      activeMaskKeyframeFrames.filter(
        (frameIndex) => frameIndex >= minFrame && frameIndex <= maxFrame,
      ),
    );
  }, [activeMaskKeyframeFrames, mapXToVisibleFrame, selectionBox]);

  useEffect(() => {
    const isPointerDragActive =
      selectionBox !== null ||
      activeOverviewMode !== null ||
      isRulerScrubbing;
    if (!isPointerDragActive) return;

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previousUserSelect;
    };
  }, [activeOverviewMode, isRulerScrubbing, selectionBox]);

  useEffect(() => {
    if (!selectionBox) return;

    const handleMouseMove = (event: MouseEvent) => {
      const current = selectionBoxRef.current;
      const x = getRelativeX(keyframeLaneRef, event.clientX);
      if (!current || x === null) return;
      setActiveSelectionBox({ ...current, currentX: x });
    };

    const handleMouseUp = (event: MouseEvent) => {
      const current = selectionBoxRef.current;
      if (!current) return;
      const x = getRelativeX(keyframeLaneRef, event.clientX) ?? current.currentX;
      selectKeyframesInRange(current.startX, x);
      setActiveSelectionBox(null);
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
    };
  }, [getRelativeX, selectKeyframesInRange, selectionBox, setActiveSelectionBox]);

  useEffect(() => {
    if (!activeOverviewMode) return;

    const handleMouseMove = (event: MouseEvent) => {
      const interaction = overviewInteractionRef.current;
      if (!interaction || interaction.barWidth <= 0) return;

      if (interaction.mode === "window") {
        const deltaFrames = Math.round(
          ((event.clientX - interaction.startClientX) / interaction.barWidth) *
            Math.max(0, totalFrameIndex),
        );
        onVisibleRangeChange(
          panTimelineViewport(
            interaction.startViewport,
            interaction.startViewport.startFrameIndex + deltaFrames,
            totalFrameIndex,
            minimumVisibleSpan,
          ),
        );
        return;
      }

      const direction = interaction.mode === "start-handle" ? -1 : 1;
      const normalizedDelta =
        ((event.clientX - interaction.startClientX) / interaction.barWidth) *
        HANDLE_ZOOM_SENSITIVITY *
        direction;
      const scaleFactor = Math.exp(normalizedDelta);
      onVisibleRangeChange(
        zoomTimelineViewport(
          interaction.startViewport,
          scaleFactor,
          currentFrameIndex,
          totalFrameIndex,
          minimumVisibleSpan,
        ),
      );
    };

    const handleMouseUp = () => {
      overviewInteractionRef.current = null;
      setActiveOverviewMode(null);
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
    };
  }, [activeOverviewMode, getRelativeX, minimumVisibleSpan, onVisibleRangeChange, totalFrameIndex]);

  useEffect(() => {
    if (!isRulerScrubbing) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!rulerScrubRef.current) return;
      commitVisibleFrameAtClientX(event.clientX);
    };

    const handleMouseUp = () => {
      rulerScrubRef.current = null;
      setIsRulerScrubbing(false);
    };

    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
    };
  }, [commitVisibleFrameAtClientX, isRulerScrubbing]);

  if (framePathsLength === 0) return null;

  const visibleProgressPercent = frameIndexToRangePercent(
    currentFrameIndex,
    visibleStartFrameIndex,
    visibleEndFrameIndex,
  );
  const overviewWindowLeftPercent =
    totalFrameIndex > 0
      ? frameIndexToRangePercent(visibleStartFrameIndex, 0, totalFrameIndex)
      : 0;
  const overviewWindowWidthPercent =
    totalFrameIndex > 0
      ? ((visibleEndFrameIndex - visibleStartFrameIndex) / totalFrameIndex) * 100
      : 100;
  const overviewCtiPercent =
    totalFrameIndex > 0
      ? frameIndexToRangePercent(currentFrameIndex, 0, totalFrameIndex)
      : 0;
  const visibleTrackSegments = activeMaskFrameSegments
    .map((segment) => ({
      startFrameIndex: Math.max(segment.startFrameIndex, visibleStartFrameIndex),
      endFrameIndex: Math.min(segment.endFrameIndex, visibleEndFrameIndex),
    }))
    .filter((segment) => segment.startFrameIndex <= segment.endFrameIndex)
    .map((segment) => {
      const left = frameIndexToRangePercent(
        segment.startFrameIndex,
        visibleStartFrameIndex,
        visibleEndFrameIndex,
      );
      const width =
        visibleFrameCount > 1
          ? ((segment.endFrameIndex - segment.startFrameIndex) /
              Math.max(1, visibleFrameCount - 1)) *
            100
          : 100;
      return {
        left: `${left}%`,
        width: `${Math.max(0, width)}%`,
      };
    });
  const visibleKeyframes = activeMaskKeyframeFrames
    .filter(
      (frameIndex) =>
        frameIndex >= visibleStartFrameIndex &&
        frameIndex <= visibleEndFrameIndex,
    )
    .map((frameIndex) => ({
      frameIndex,
      left: `${frameIndexToRangePercent(
        frameIndex,
        visibleStartFrameIndex,
        visibleEndFrameIndex,
      )}%`,
    }));

  const handleOverviewTrackMouseDown = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    const width = overviewBarRef.current?.getBoundingClientRect().width ?? 0;
    const x = getRelativeX(overviewBarRef, event.clientX);
    if (x === null || width <= 0) return;
    event.preventDefault();
    const centerFrameIndex = positionToFrameIndex(x, width, 0, totalFrameIndex);
    onVisibleRangeChange(
      recenterTimelineViewport(
        visibleViewport,
        centerFrameIndex,
        totalFrameIndex,
        minimumVisibleSpan,
      ),
    );
  };

  const beginOverviewInteraction = (
    event: React.MouseEvent<HTMLDivElement>,
    mode: OverviewInteraction["mode"],
  ) => {
    if (event.button !== 0) return;
    const barWidth = overviewBarRef.current?.getBoundingClientRect().width ?? 0;
    if (barWidth <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    overviewInteractionRef.current = {
      mode,
      startClientX: event.clientX,
      barWidth,
      startViewport: visibleViewport,
    };
    setActiveOverviewMode(mode);
  };

  const handleRulerMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const width = rulerRef.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    event.preventDefault();
    commitVisibleFrameAtClientX(event.clientX);
    rulerScrubRef.current = { width };
    setIsRulerScrubbing(true);
  };

  const handleKeyframeMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const x = getRelativeX(keyframeLaneRef, event.clientX);
    if (x === null) return;
    const laneWidth = keyframeLaneRef.current?.getBoundingClientRect().width ?? 0;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    onSelectedKeyframeFramesChange([]);
    setActiveSelectionBox({ startX: x, currentX: x, laneWidth });
  };

  const handleZoomIn = () => {
    if (!canZoomIn) return;
    onVisibleRangeChange(
      zoomTimelineViewport(
        visibleViewport,
        0.8,
        currentFrameIndex,
        totalFrameIndex,
        minimumVisibleSpan,
      ),
    );
  };

  const handleZoomOut = () => {
    if (!canZoomOut) return;
    onVisibleRangeChange(
      zoomTimelineViewport(
        visibleViewport,
        1.25,
        currentFrameIndex,
        totalFrameIndex,
        minimumVisibleSpan,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="s-text-mono text-[#5da7ff]">
          {formatTimecode(currentFrameIndex, playbackFps)}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 rounded border border-white/15 bg-black/20 px-1 py-0.5">
            <button
              onClick={handleZoomOut}
              disabled={!canZoomOut}
              className="s-button-neutral h-5 w-5 min-w-0 px-0 text-[12px]"
              title="Zoom timeline out"
              aria-label="Zoom timeline out"
            >
              -
            </button>
            <button
              onClick={handleZoomIn}
              disabled={!canZoomIn}
              className="s-button-neutral h-5 w-5 min-w-0 px-0 text-[12px]"
              title="Zoom timeline in"
              aria-label="Zoom timeline in"
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-1 rounded border border-white/15 bg-black/20 px-1 py-0.5">
            <Tooltip content={moveSelectedKeyframesTooltip}>
              <button
                onClick={onMoveSelectedKeyframes}
                disabled={!canMoveSelectedKeyframes}
                className="s-button-neutral h-5 min-w-[28px] px-1.5 text-[11px]"
                aria-label="Move selected keyframes"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M2.5 5.5h8m0 0-2.5-2.5m2.5 2.5-2.5 2.5M13.5 10.5h-8m0 0 2.5-2.5m-2.5 2.5 2.5 2.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </Tooltip>
            <Tooltip content={deleteSelectedKeyframesTooltip}>
              <button
                onClick={onDeleteSelectedKeyframes}
                disabled={selectedKeyframeFrames.length === 0}
                className="s-button-neutral h-5 w-5 min-w-0 px-0"
                aria-label="Delete selected keyframes"
              >
                <Trash2 size={11} />
              </button>
            </Tooltip>
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

      <div className="relative mt-0.5 flex flex-col gap-1.5">
        <div
          className="pointer-events-none absolute left-0 top-0 z-30 w-0.5 bg-[#00a8ff]"
          style={{
            left: `calc(${visibleProgressPercent}% - 1px)`,
            height: "100%",
          }}
        />
        <div
          className="pointer-events-none absolute top-0 z-30 h-0 w-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-[#00a8ff]"
          style={{ left: `calc(${visibleProgressPercent}% - 5px)` }}
        />

        <div className="relative flex flex-col gap-1.5">
          <div
            ref={rulerRef}
            className="relative h-5 cursor-pointer"
            aria-label="Timeline ruler"
            onMouseDown={handleRulerMouseDown}
            onDragStart={(event) => event.preventDefault()}
          >
            <div className="absolute left-0 right-0 top-2 h-px bg-white/15" />
            {visibleTrackSegments.map((segment, index) => (
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
          </div>
        </div>

        <div
          ref={keyframeLaneRef}
          className="relative h-7 cursor-crosshair rounded-sm border border-white/[0.06] bg-black/10 outline-none focus:border-[#5da7ff]/40"
          aria-label="Keyframe selection lane"
          tabIndex={0}
          onMouseDown={handleKeyframeMouseDown}
          onDragStart={(event) => event.preventDefault()}
        >
          <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
          {visibleKeyframes.map((keyframe) => {
            const isSelected =
              selectedKeyframes.has(keyframe.frameIndex) ||
              marqueeSelectedKeyframes.has(keyframe.frameIndex);
            return (
              <div
                key={keyframe.frameIndex}
                className={`pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${
                  isSelected
                    ? "border-[#8fd8ff] bg-[#00a8ff]"
                    : "border-white/70 bg-[#eef3f8]/80"
                }`}
                style={{ left: keyframe.left }}
                title={`Keyframe ${keyframe.frameIndex + 1}`}
              />
            );
          })}
          {marqueeRect && (
            <div
              className="pointer-events-none absolute top-0 h-full rounded-sm border border-[#5da7ff]/80 bg-[#5da7ff]/20"
              style={{
                left: `${marqueeRect.left}px`,
                width: `${marqueeRect.width}px`,
              }}
            />
          )}
        </div>

        <div className="pt-0.5">
          <div
            ref={overviewBarRef}
            className="group relative h-7 cursor-pointer"
            aria-label="Timeline zoom bar"
            onMouseDown={handleOverviewTrackMouseDown}
            onDragStart={(event) => event.preventDefault()}
          >
            <div className="absolute inset-x-0 top-1/2 h-[14px] -translate-y-1/2 rounded-[2px] bg-[#34373c]" />
            <div
              className="pointer-events-none absolute bottom-[5px] top-[5px] z-20 w-px bg-[#2d8cff]"
              style={{ left: `calc(${overviewCtiPercent}% - 0.5px)` }}
            />
            <div
              className={`absolute top-1/2 z-10 h-[14px] -translate-y-1/2 rounded-[2px] border border-white/[0.07] bg-[#5a5f67] ${
                activeOverviewMode === "window" ? "cursor-grabbing" : "cursor-grab"
              }`}
              style={{
                left: `${overviewWindowLeftPercent}%`,
                width: `${Math.max(0, overviewWindowWidthPercent)}%`,
                minWidth: "20px",
              }}
              onMouseDown={(event) => beginOverviewInteraction(event, "window")}
            >
              <div
                className="absolute left-0 top-1/2 z-20 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center cursor-ew-resize"
                onMouseDown={(event) =>
                  beginOverviewInteraction(event, "start-handle")
                }
              >
                <div className="h-4 w-4 rounded-full border-[3px] border-[#d5d8de] bg-[#2b2e33]" />
              </div>
              <div
                className="absolute right-0 top-1/2 z-20 flex h-5 w-5 translate-x-1/2 -translate-y-1/2 items-center justify-center cursor-ew-resize"
                onMouseDown={(event) =>
                  beginOverviewInteraction(event, "end-handle")
                }
              >
                <div className="h-4 w-4 rounded-full border-[3px] border-[#d5d8de] bg-[#2b2e33]" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
