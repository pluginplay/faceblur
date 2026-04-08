import type { TimelineViewport } from "../types";

export function getTotalFrameIndex(framePathsLength: number): number {
  return Math.max(0, framePathsLength - 1);
}

export function getTimelineViewportSpan(viewport: TimelineViewport): number {
  return Math.max(1, viewport.endFrameIndex - viewport.startFrameIndex + 1);
}

export function createFullTimelineViewport(
  totalFrameIndex: number,
): TimelineViewport {
  return {
    startFrameIndex: 0,
    endFrameIndex: Math.max(0, totalFrameIndex),
  };
}

export function getTimelineMinimumVisibleSpan(
  totalFrameIndex: number,
  playbackFps: number,
): number {
  const frameCount = Math.max(1, totalFrameIndex + 1);
  const preferred = Math.max(8, Math.ceil(playbackFps * 0.5));
  return Math.min(frameCount, preferred);
}

export function clampFrameIndex(frameIndex: number, totalFrameIndex: number): number {
  if (totalFrameIndex <= 0) return 0;
  if (!Number.isFinite(frameIndex)) return 0;
  return Math.max(0, Math.min(totalFrameIndex, Math.round(frameIndex)));
}

export function clampTimelineViewport(
  viewport: TimelineViewport,
  totalFrameIndex: number,
  minVisibleSpan = 1,
): TimelineViewport {
  if (totalFrameIndex <= 0) {
    return { startFrameIndex: 0, endFrameIndex: 0 };
  }

  const frameCount = totalFrameIndex + 1;
  const effectiveMinSpan = Math.max(
    1,
    Math.min(frameCount, Math.round(minVisibleSpan)),
  );
  const requestedSpan = Math.max(
    1,
    Math.round(viewport.endFrameIndex - viewport.startFrameIndex + 1),
  );
  const span = Math.max(effectiveMinSpan, Math.min(frameCount, requestedSpan));
  const maxStart = Math.max(0, totalFrameIndex - span + 1);
  const startFrameIndex = Math.max(
    0,
    Math.min(maxStart, Math.round(viewport.startFrameIndex)),
  );

  return {
    startFrameIndex,
    endFrameIndex: startFrameIndex + span - 1,
  };
}

export function ensureFrameVisibleInTimelineViewport(
  viewport: TimelineViewport,
  frameIndex: number,
  totalFrameIndex: number,
  minVisibleSpan = 1,
): TimelineViewport {
  const safeViewport = clampTimelineViewport(
    viewport,
    totalFrameIndex,
    minVisibleSpan,
  );
  const safeFrameIndex = clampFrameIndex(frameIndex, totalFrameIndex);

  if (
    safeFrameIndex >= safeViewport.startFrameIndex &&
    safeFrameIndex <= safeViewport.endFrameIndex
  ) {
    return safeViewport;
  }

  const span = getTimelineViewportSpan(safeViewport);
  const startFrameIndex =
    safeFrameIndex < safeViewport.startFrameIndex
      ? safeFrameIndex
      : safeFrameIndex - span + 1;

  return clampTimelineViewport(
    {
      startFrameIndex,
      endFrameIndex: startFrameIndex + span - 1,
    },
    totalFrameIndex,
    minVisibleSpan,
  );
}

export function panTimelineViewport(
  viewport: TimelineViewport,
  nextStartFrameIndex: number,
  totalFrameIndex: number,
  minVisibleSpan = 1,
): TimelineViewport {
  const safeViewport = clampTimelineViewport(
    viewport,
    totalFrameIndex,
    minVisibleSpan,
  );
  const span = getTimelineViewportSpan(safeViewport);

  return clampTimelineViewport(
    {
      startFrameIndex: nextStartFrameIndex,
      endFrameIndex: nextStartFrameIndex + span - 1,
    },
    totalFrameIndex,
    minVisibleSpan,
  );
}

export function recenterTimelineViewport(
  viewport: TimelineViewport,
  centerFrameIndex: number,
  totalFrameIndex: number,
  minVisibleSpan = 1,
): TimelineViewport {
  const safeViewport = clampTimelineViewport(
    viewport,
    totalFrameIndex,
    minVisibleSpan,
  );
  const span = getTimelineViewportSpan(safeViewport);
  const startFrameIndex = Math.round(
    clampFrameIndex(centerFrameIndex, totalFrameIndex) - (span - 1) / 2,
  );

  return clampTimelineViewport(
    {
      startFrameIndex,
      endFrameIndex: startFrameIndex + span - 1,
    },
    totalFrameIndex,
    minVisibleSpan,
  );
}

export function resizeTimelineViewportFromEdge(
  viewport: TimelineViewport,
  edge: "start" | "end",
  targetFrameIndex: number,
  totalFrameIndex: number,
  minVisibleSpan = 1,
): TimelineViewport {
  const safeViewport = clampTimelineViewport(
    viewport,
    totalFrameIndex,
    minVisibleSpan,
  );
  const frameCount = Math.max(1, totalFrameIndex + 1);
  const effectiveMinSpan = Math.max(
    1,
    Math.min(frameCount, Math.round(minVisibleSpan)),
  );
  const clampedTarget = clampFrameIndex(targetFrameIndex, totalFrameIndex);

  if (edge === "start") {
    const maxStart = safeViewport.endFrameIndex - effectiveMinSpan + 1;
    return clampTimelineViewport(
      {
        startFrameIndex: Math.min(clampedTarget, maxStart),
        endFrameIndex: safeViewport.endFrameIndex,
      },
      totalFrameIndex,
      minVisibleSpan,
    );
  }

  const minEnd = safeViewport.startFrameIndex + effectiveMinSpan - 1;
  return clampTimelineViewport(
    {
      startFrameIndex: safeViewport.startFrameIndex,
      endFrameIndex: Math.max(clampedTarget, minEnd),
    },
    totalFrameIndex,
    minVisibleSpan,
  );
}

export function zoomTimelineViewport(
  viewport: TimelineViewport,
  scaleFactor: number,
  anchorFrameIndex: number,
  totalFrameIndex: number,
  minVisibleSpan = 1,
): TimelineViewport {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
    return clampTimelineViewport(viewport, totalFrameIndex, minVisibleSpan);
  }

  const safeViewport = clampTimelineViewport(
    viewport,
    totalFrameIndex,
    minVisibleSpan,
  );
  const frameCount = Math.max(1, totalFrameIndex + 1);
  const effectiveMinSpan = Math.max(
    1,
    Math.min(frameCount, Math.round(minVisibleSpan)),
  );
  const currentSpan = getTimelineViewportSpan(safeViewport);
  const nextSpan = Math.max(
    effectiveMinSpan,
    Math.min(frameCount, Math.round(currentSpan * scaleFactor)),
  );

  if (nextSpan === currentSpan) return safeViewport;

  const safeAnchorFrameIndex = clampFrameIndex(anchorFrameIndex, totalFrameIndex);
  const anchorRatio =
    currentSpan <= 1
      ? 0.5
      : (safeAnchorFrameIndex - safeViewport.startFrameIndex) /
        Math.max(1, currentSpan - 1);
  const startFrameIndex = Math.round(
    safeAnchorFrameIndex - anchorRatio * (nextSpan - 1),
  );

  return clampTimelineViewport(
    {
      startFrameIndex,
      endFrameIndex: startFrameIndex + nextSpan - 1,
    },
    totalFrameIndex,
    minVisibleSpan,
  );
}

export function frameIndexToRangePercent(
  frameIndex: number,
  startFrameIndex: number,
  endFrameIndex: number,
): number {
  const span = Math.max(1, endFrameIndex - startFrameIndex);
  const clampedFrameIndex = Math.max(
    startFrameIndex,
    Math.min(endFrameIndex, frameIndex),
  );
  return ((clampedFrameIndex - startFrameIndex) / span) * 100;
}

export function positionToFrameIndex(
  x: number,
  width: number,
  startFrameIndex: number,
  endFrameIndex: number,
): number {
  if (width <= 0) return startFrameIndex;
  const clampedRatio = Math.max(0, Math.min(1, x / width));
  return Math.round(
    startFrameIndex + clampedRatio * Math.max(0, endFrameIndex - startFrameIndex),
  );
}
