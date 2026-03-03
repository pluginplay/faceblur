import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Dimensions } from "../types";
import { Scrubber } from "./Scrubber";

interface FramePreviewProps {
  previewImage: string | null;
  showStatusView: boolean;
  statusMessage: string;
  imageDimensions: Dimensions | null;
  imageRef: RefObject<HTMLImageElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  onImageLoad: () => void;
  onCanvasClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasMouseUp: () => void;
  framePathsLength: number;
  playbackFps: number;
  previewSequenceId: string;
  currentFrameIndex: number;
  isPlaying: boolean;
  activeMaskFrameSegments: { startFrameIndex: number; endFrameIndex: number }[];
  onFrameChange: (index: number) => void;
  onPlayPause: () => void;
}

export function FramePreview({
  previewImage,
  showStatusView,
  statusMessage,
  imageDimensions,
  imageRef,
  canvasRef,
  containerRef,
  onImageLoad,
  onCanvasClick,
  onCanvasMouseDown,
  onCanvasMouseMove,
  onCanvasMouseUp,
  framePathsLength,
  playbackFps,
  previewSequenceId,
  currentFrameIndex,
  isPlaying,
  activeMaskFrameSegments,
  onFrameChange,
  onPlayPause,
}: FramePreviewProps) {
  const disableViewportTransforms = isPlaying;
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [stageDimensions, setStageDimensions] = useState<Dimensions | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const zoomModifierKey =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
      ? "Cmd"
      : "Ctrl";

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !imageDimensions) {
      setStageDimensions(null);
      return;
    }
    const updateStageDimensions = () => {
      const scale = Math.min(
        viewport.clientWidth / imageDimensions.width,
        viewport.clientHeight / imageDimensions.height,
      );
      const width = Math.max(1, Math.round(imageDimensions.width * scale));
      const height = Math.max(1, Math.round(imageDimensions.height * scale));
      setStageDimensions((prev) =>
        prev && prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };
    updateStageDimensions();
    const ro = new ResizeObserver(updateStageDimensions);
    ro.observe(viewport);
    return () => ro.disconnect();
  }, [imageDimensions, previewImage]);

  const getPanLimits = useCallback(
    (nextZoom: number) => {
      const viewport = viewportRef.current;
      if (!viewport || !stageDimensions) return { x: 0, y: 0 };
      const maxX = Math.max(
        0,
        (stageDimensions.width * nextZoom - viewport.clientWidth) / 2,
      );
      const maxY = Math.max(
        0,
        (stageDimensions.height * nextZoom - viewport.clientHeight) / 2,
      );
      return { x: maxX, y: maxY };
    },
    [stageDimensions],
  );

  const clampPan = useCallback(
    (nextPan: { x: number; y: number }, nextZoom: number) => {
      const limits = getPanLimits(nextZoom);
      return {
        x: Math.max(-limits.x, Math.min(limits.x, nextPan.x)),
        y: Math.max(-limits.y, Math.min(limits.y, nextPan.y)),
      };
    },
    [getPanLimits],
  );

  const resetZoom = useCallback(() => {
    setZoomLevel((prev) => (prev === 1 ? prev : 1));
    setPanOffset((prev) =>
      prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 },
    );
  }, []);

  const applyZoomAtClientPoint = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const pointerX = clientX - rect.left;
      const pointerY = clientY - rect.top;

      setZoomLevel((prevZoom) => {
        const nextZoom = Math.max(1, Math.min(6, prevZoom * factor));
        if (Math.abs(nextZoom - prevZoom) < 1e-3) return prevZoom;
        setPanOffset((prevPan) => {
          const relativeX = pointerX - centerX - prevPan.x;
          const relativeY = pointerY - centerY - prevPan.y;
          const scale = nextZoom / prevZoom;
          const nextPan = {
            x: pointerX - centerX - relativeX * scale,
            y: pointerY - centerY - relativeY * scale,
          };
          const clamped = clampPan(nextPan, nextZoom);
          if (clamped.x === prevPan.x && clamped.y === prevPan.y) {
            return prevPan;
          }
          return clamped;
        });
        return nextZoom;
      });
    },
    [clampPan],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingContext =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.tagName === "BUTTON" ||
        target?.isContentEditable;
      if (isTypingContext) return;
      if (event.code === "Space") setIsSpacePressed(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    resetZoom();
  }, [previewSequenceId, resetZoom]);

  useEffect(() => {
    if (!disableViewportTransforms) return;
    setIsPanning(false);
  }, [disableViewportTransforms]);

  useEffect(() => {
    setPanOffset((prev) => {
      const next = clampPan(prev, zoomLevel);
      if (next.x === prev.x && next.y === prev.y) return prev;
      return next;
    });
  }, [stageDimensions, zoomLevel, clampPan]);

  const handleViewportWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      if (disableViewportTransforms) return;
      const isZoomGesture = e.ctrlKey || e.metaKey;
      if (isZoomGesture) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0022);
        applyZoomAtClientPoint(factor, e.clientX, e.clientY);
        return;
      }
      if (zoomLevel > 1) {
        e.preventDefault();
        setPanOffset((prev) => {
          const next = clampPan(
            {
              x: prev.x - e.deltaX,
              y: prev.y - e.deltaY,
            },
            zoomLevel,
          );
          if (next.x === prev.x && next.y === prev.y) return prev;
          return next;
        });
      }
    },
    [disableViewportTransforms, zoomLevel, applyZoomAtClientPoint, clampPan],
  );

  const handleViewportMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (disableViewportTransforms) return;
      if (!isSpacePressed || zoomLevel <= 1) return;
      event.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        panX: panOffset.x,
        panY: panOffset.y,
      };
    },
    [disableViewportTransforms, isSpacePressed, zoomLevel, panOffset],
  );

  const handleViewportMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (disableViewportTransforms) return;
      if (!isPanning) return;
      const dx = event.clientX - panStartRef.current.x;
      const dy = event.clientY - panStartRef.current.y;
      setPanOffset((prev) => {
        const next = clampPan(
          {
            x: panStartRef.current.panX + dx,
            y: panStartRef.current.panY + dy,
          },
          zoomLevel,
        );
        if (next.x === prev.x && next.y === prev.y) return prev;
        return next;
      });
    },
    [disableViewportTransforms, isPanning, clampPan, zoomLevel],
  );

  const handleViewportMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleZoomIn = useCallback(() => {
    if (disableViewportTransforms) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    applyZoomAtClientPoint(1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [disableViewportTransforms, applyZoomAtClientPoint]);

  const handleZoomOut = useCallback(() => {
    if (disableViewportTransforms) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    applyZoomAtClientPoint(1 / 1.2, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [disableViewportTransforms, applyZoomAtClientPoint]);

  return (
    <div
      ref={containerRef}
      className="s-surface relative min-h-0 flex-1 overflow-hidden p-1.5 flex flex-col"
    >
      {showStatusView ? (
        <div className="flex h-full min-h-0 w-full items-center justify-center rounded-sm border border-dashed border-white/20 bg-[#171717] px-4">
          <div className="text-center text-[#939ba8]">
            <p className="text-[16px] leading-tight font-semibold tracking-tight text-[#d4dae2]">
              Processing pipeline...
            </p>
            <p className="mt-2 s-text-body text-[#939ba8]">
              {statusMessage || "Preparing render and detection..."}
            </p>
          </div>
        </div>
      ) : previewImage ? (
        <div className="relative h-full w-full min-h-0 rounded-sm bg-[#111111]">
          <div className="pointer-events-none absolute left-3 top-3 z-10 s-text-caption font-normal text-[#a7afba]">
            Zoom: pinch or {zoomModifierKey}+scroll.
          </div>
          <div
            ref={viewportRef}
            className="relative flex h-full w-full items-center justify-center overflow-hidden"
            onWheel={handleViewportWheel}
            onMouseDown={handleViewportMouseDown}
            onMouseMove={handleViewportMouseMove}
            onMouseUp={handleViewportMouseUp}
            onMouseLeave={handleViewportMouseUp}
          >
            <div
              className="relative"
              style={{
                width: `${stageDimensions?.width ?? 0}px`,
                height: `${stageDimensions?.height ?? 0}px`,
                transform: disableViewportTransforms
                  ? "translate(0px, 0px) scale(1)"
                  : `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                transformOrigin: "center center",
              }}
            >
              <img
                ref={imageRef}
                src={
                  previewImage.startsWith("data:") ||
                  previewImage.startsWith("blob:") ||
                  previewImage.startsWith("file://")
                    ? previewImage
                    : `file://${previewImage}`
                }
                alt="Frame preview"
                className="h-full w-full"
                onLoad={onImageLoad}
              />
              {stageDimensions && (
                <canvas
                  ref={canvasRef}
                  className={`absolute left-0 top-0 ${
                    !disableViewportTransforms && isSpacePressed && zoomLevel > 1
                      ? isPanning
                        ? "cursor-grabbing"
                        : "cursor-grab"
                      : "cursor-crosshair"
                  }`}
                  style={{
                    width: `${stageDimensions.width}px`,
                    height: `${stageDimensions.height}px`,
                    pointerEvents: "auto",
                  }}
                  onClick={onCanvasClick}
                  onMouseDown={(event) => {
                    if (
                      !disableViewportTransforms &&
                      isSpacePressed &&
                      zoomLevel > 1
                    )
                      return;
                    onCanvasMouseDown(event);
                  }}
                  onMouseMove={(event) => {
                    if (
                      !disableViewportTransforms &&
                      isSpacePressed &&
                      zoomLevel > 1
                    )
                      return;
                    onCanvasMouseMove(event);
                  }}
                  onMouseUp={onCanvasMouseUp}
                  onMouseLeave={onCanvasMouseUp}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-0 w-full items-center justify-center rounded-sm border border-dashed border-white/20 bg-[#171717] px-4">
          <div className="text-center text-[#939ba8]">
            <p className="text-[16px] leading-tight font-semibold tracking-tight text-[#d4dae2]">
              No segment loaded
            </p>
            <p className="mt-2 s-text-body text-[#939ba8]">
              Run selected clips to create frame previews and tracks.
            </p>
          </div>
        </div>
      )}
      {!showStatusView && framePathsLength > 0 && (
        <div className="mt-1.5 shrink-0 border-t border-white/10 pt-1.5 px-0.5">
          <Scrubber
            framePathsLength={framePathsLength}
            currentFrameIndex={currentFrameIndex}
            playbackFps={playbackFps}
            isPlaying={isPlaying}
            activeMaskFrameSegments={activeMaskFrameSegments}
            zoomLevel={zoomLevel}
            onFrameChange={onFrameChange}
            onPlayPause={onPlayPause}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onZoomReset={resetZoom}
          />
        </div>
      )}
    </div>
  );
}
