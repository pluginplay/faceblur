import { useCallback, useEffect, useMemo, useState } from "react";
import { useFaceBlurApp } from "./hooks";
import {
  FramePreview,
  ActionButtons,
  HelpGuideDialog,
  WelcomeDialog,
  MoveKeyframesDialog,
} from "./components";
import { MaskList } from "./components/MaskList";
import {
  hasSeenWelcomeDialog,
  markWelcomeDialogSeen,
} from "../lib/utils/cepCookie";

const WELCOME_DIALOG_VERSION =
  import.meta.env.VITE_WELCOME_DIALOG_VERSION ?? "1";
const ALWAYS_SHOW_WELCOME_IN_DEV = false;

function buildActiveMaskFrameSegments(
  activeMask: {
    points: { x: number; y: number }[];
    keyframes?: Record<number, { x: number; y: number }[]>;
  } | null,
  totalFrameIndex: number,
): { startFrameIndex: number; endFrameIndex: number }[] {
  if (!activeMask || totalFrameIndex < 0) return [];

  const keyframeIndices = activeMask.keyframes
    ? Object.keys(activeMask.keyframes)
        .map((frameStr) => Number(frameStr))
        .filter((frame) => Number.isFinite(frame))
        .map((frame) => Math.max(0, Math.min(totalFrameIndex, frame)))
    : [];

  if (keyframeIndices.length === 0) {
    if (activeMask.points.length >= 3) {
      return [{ startFrameIndex: 0, endFrameIndex: totalFrameIndex }];
    }
    return [];
  }

  const sortedFrames = [...new Set(keyframeIndices)].sort((a, b) => a - b);
  const segments: { startFrameIndex: number; endFrameIndex: number }[] = [];
  let startFrameIndex = sortedFrames[0];
  let prevFrameIndex = sortedFrames[0];

  for (let i = 1; i < sortedFrames.length; i++) {
    const frameIndex = sortedFrames[i];
    if (frameIndex === prevFrameIndex + 1) {
      prevFrameIndex = frameIndex;
      continue;
    }
    segments.push({ startFrameIndex, endFrameIndex: prevFrameIndex });
    startFrameIndex = frameIndex;
    prevFrameIndex = frameIndex;
  }

  segments.push({ startFrameIndex, endFrameIndex: prevFrameIndex });
  return segments;
}

export function App() {
  const app = useFaceBlurApp();
  const [isTracksCollapsed, setIsTracksCollapsed] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const [selectedKeyframeFrames, setSelectedKeyframeFrames] = useState<number[]>(
    [],
  );
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [moveSourceMaskId, setMoveSourceMaskId] = useState<string | null>(null);
  const [moveTargetMaskId, setMoveTargetMaskId] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("faceblur:tracks-collapsed");
    setIsTracksCollapsed(saved === "1");
  }, []);

  useEffect(() => {
    setIsWelcomeOpen(
      !hasSeenWelcomeDialog({
        version: WELCOME_DIALOG_VERSION,
        isDev: import.meta.env.DEV,
        alwaysShowInDev: ALWAYS_SHOW_WELCOME_IN_DEV,
      }),
    );
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "faceblur:tracks-collapsed",
      isTracksCollapsed ? "1" : "0",
    );
  }, [isTracksCollapsed]);

  const activeMask = useMemo(
    () => app.masks.find((m) => m.id === app.activeMaskId) ?? null,
    [app.masks, app.activeMaskId],
  );
  const totalFrameIndex = useMemo(
    () => Math.max(0, app.framePaths.length - 1),
    [app.framePaths.length],
  );
  const activeMaskFrameSegments = useMemo(
    () => buildActiveMaskFrameSegments(activeMask, totalFrameIndex),
    [activeMask, totalFrameIndex],
  );
  const activeMaskKeyframeFrames = useMemo(() => {
    if (!activeMask?.keyframes || totalFrameIndex < 0) return [];
    const frames = Object.keys(activeMask.keyframes)
      .map((frameStr) => Number(frameStr))
      .filter((frame) => Number.isFinite(frame))
      .map((frame) => Math.max(0, Math.min(totalFrameIndex, frame)));
    return [...new Set(frames)].sort((a, b) => a - b);
  }, [activeMask, totalFrameIndex]);
  const canApply = useMemo(
    () =>
      app.masks.length > 0 &&
      app.masks.every((m) => app.maskHasAnyValidShape(m)),
    [app.masks, app.maskHasAnyValidShape],
  );
  const previewSequenceId = app.loadedSegment?.markerGuid ?? "";
  const deleteActiveMaskKeyframes = app.deleteActiveMaskKeyframes;
  const moveMaskKeyframes = app.moveMaskKeyframes;
  const moveSourceMask = useMemo(
    () => app.masks.find((m) => m.id === moveSourceMaskId) ?? null,
    [app.masks, moveSourceMaskId],
  );
  const destinationMasks = useMemo(
    () => app.masks.filter((m) => m.id !== moveSourceMaskId),
    [app.masks, moveSourceMaskId],
  );
  const canMoveSelectedKeyframes =
    selectedKeyframeFrames.length > 0 && app.masks.length > 1;

  useEffect(() => {
    setSelectedKeyframeFrames([]);
  }, [activeMask?.id, previewSequenceId]);

  const resetMoveDialog = useCallback(() => {
    setIsMoveDialogOpen(false);
    setMoveSourceMaskId(null);
    setMoveTargetMaskId(null);
  }, []);

  useEffect(() => {
    setSelectedKeyframeFrames((prev) => {
      if (prev.length === 0) return prev;
      const validFrames = new Set(activeMaskKeyframeFrames);
      const next = prev.filter((frameIndex) => validFrames.has(frameIndex));
      return next.length === prev.length ? prev : next;
    });
  }, [activeMaskKeyframeFrames]);

  useEffect(() => {
    if (!isMoveDialogOpen) return;
    if (!moveSourceMask || destinationMasks.length === 0) {
      resetMoveDialog();
      return;
    }
    if (
      moveTargetMaskId &&
      !destinationMasks.some((mask) => mask.id === moveTargetMaskId)
    ) {
      setMoveTargetMaskId(null);
    }
  }, [
    destinationMasks,
    isMoveDialogOpen,
    moveSourceMask,
    moveTargetMaskId,
    resetMoveDialog,
  ]);

  const handleDeleteSelectedKeyframes = useCallback(() => {
    if (selectedKeyframeFrames.length === 0) return;
    deleteActiveMaskKeyframes(selectedKeyframeFrames);
    setSelectedKeyframeFrames([]);
  }, [deleteActiveMaskKeyframes, selectedKeyframeFrames]);

  const handleOpenMoveDialog = useCallback(() => {
    if (!activeMask?.id || !canMoveSelectedKeyframes) return;
    setMoveSourceMaskId(activeMask.id);
    setMoveTargetMaskId(null);
    setIsMoveDialogOpen(true);
  }, [activeMask?.id, canMoveSelectedKeyframes]);

  const handleConfirmMoveKeyframes = useCallback(() => {
    if (!moveSourceMaskId || !moveTargetMaskId || selectedKeyframeFrames.length === 0) {
      return;
    }
    moveMaskKeyframes(moveSourceMaskId, moveTargetMaskId, selectedKeyframeFrames);
    setSelectedKeyframeFrames([]);
    resetMoveDialog();
  }, [
    moveMaskKeyframes,
    moveSourceMaskId,
    moveTargetMaskId,
    resetMoveDialog,
    selectedKeyframeFrames,
  ]);

  const handleDismissWelcome = () => {
    markWelcomeDialogSeen({ version: WELCOME_DIALOG_VERSION });
    setIsWelcomeOpen(false);
    setIsHelpOpen(true);
  };

  const handleContinueToDocumentation = () => {
    markWelcomeDialogSeen({ version: WELCOME_DIALOG_VERSION });
    setIsWelcomeOpen(false);
    setIsHelpOpen(true);
  };

  return (
    <div
      className="app s-shell"
      style={{ backgroundColor: app.bgColor }}
      onMouseEnter={() => {
        void app.handlePanelMouseEnter();
      }}
    >
      <header className="s-topbar shrink-0">
        <div className="min-w-0 flex-1">
          <h1 className="s-topbar-title">Face Blur</h1>
          <p className="s-topbar-subtitle">
            Refine tracks, tune mask quality, and apply to timeline clips.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsHelpOpen(true)}
            className="s-button-ghost w-8 px-0"
            title="Open quick help"
            aria-label="Open quick help"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M9.6 9a2.4 2.4 0 0 1 4.8 0c0 2-2.4 2.1-2.4 4" />
              <circle
                cx="12"
                cy="17.3"
                r=".9"
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </button>
          <ActionButtons
            isRendering={app.isRendering}
            isDetectingFaces={app.isDetectingFaces}
            selectedClipCount={app.selectedClipCount}
            confidenceThreshold={app.confidenceThreshold}
            activeMask={activeMask}
            onConfidenceChange={app.setConfidenceThreshold}
            onBlurrinessChange={(v) =>
              app.updateActiveMaskValue("blurriness", v)
            }
            onFeatherChange={(v) => app.updateActiveMaskValue("feather", v)}
            onExpansionChange={(v) => app.updateActiveMaskValue("expansion", v)}
            onLoadAndRender={app.handleLoadAndRenderSequence}
            onCancel={app.handleCancel}
          />
        </div>
      </header>

      <div className="flex-1 min-h-0 px-3 py-2.5">
        <div
          className={`grid h-full min-h-0 gap-3 ${
            isTracksCollapsed
              ? "grid-cols-[68px_minmax(0,1fr)]"
              : "grid-cols-[188px_minmax(0,1fr)]"
          }`}
        >
          <aside className="s-panel min-h-0 overflow-hidden">
            <MaskList
              masks={app.masks}
              activeMaskId={app.activeMaskId}
              isCollapsed={isTracksCollapsed}
              onToggleCollapse={() => {
                setIsTracksCollapsed((prev) => !prev);
              }}
              canApply={canApply}
              onApplyMasks={app.handleApplyMasks}
              canUndo={app.canUndo}
              canRedo={app.canRedo}
              onUndo={app.undoMasks}
              onRedo={app.redoMasks}
              onSelectMask={(id) => {
                app.setActiveMaskId(id);
                app.setSelectedPointIndex(null);
              }}
              onRemove={app.removeMask}
            />
          </aside>

          <main className="flex min-w-0 min-h-0 flex-col gap-3">
            <FramePreview
              previewImage={app.previewImage}
              showStatusView={app.jobRunning}
              statusMessage={app.pipelineStatusMessage}
              imageDimensions={app.imageDimensions}
              imageRef={app.imageRef}
              canvasRef={app.canvasRef}
              containerRef={app.containerRef}
              onImageLoad={app.handleImageLoad}
              onCanvasClick={app.handleCanvasClick}
              onCanvasMouseDown={app.handleCanvasMouseDown}
              onCanvasMouseMove={app.handleCanvasMouseMove}
              onCanvasMouseUp={app.handleCanvasMouseUp}
              framePathsLength={app.framePaths.length}
              playbackFps={app.playbackFps}
              previewSequenceId={previewSequenceId}
              currentFrameIndex={app.currentFrameIndex}
              isPlaying={app.isPlaying}
              activeMaskFrameSegments={activeMaskFrameSegments}
              activeMaskKeyframeFrames={activeMaskKeyframeFrames}
              selectedKeyframeFrames={selectedKeyframeFrames}
              onSelectedKeyframeFramesChange={setSelectedKeyframeFrames}
              onDeleteSelectedKeyframes={handleDeleteSelectedKeyframes}
              onMoveSelectedKeyframes={handleOpenMoveDialog}
              canMoveSelectedKeyframes={canMoveSelectedKeyframes}
              onFrameChange={(v) => {
                app.setCurrentFrameIndex(v);
                app.setIsPlaying(false);
              }}
              onPlayPause={() => app.setIsPlaying(!app.isPlaying)}
            />
          </main>
        </div>
      </div>

      <HelpGuideDialog
        open={isHelpOpen}
        panelBgColor={app.bgColor}
        onOpenChange={setIsHelpOpen}
      />
      <WelcomeDialog
        open={isWelcomeOpen}
        panelBgColor={app.bgColor}
        onDismiss={handleDismissWelcome}
        onContinueToDocumentation={handleContinueToDocumentation}
      />
      <MoveKeyframesDialog
        open={isMoveDialogOpen}
        panelBgColor={app.bgColor}
        sourceMask={moveSourceMask}
        destinationMasks={destinationMasks}
        selectedTargetMaskId={moveTargetMaskId}
        selectedKeyframeCount={selectedKeyframeFrames.length}
        onSelectedTargetMaskIdChange={setMoveTargetMaskId}
        onConfirm={handleConfirmMoveKeyframes}
        onCancel={resetMoveDialog}
      />
    </div>
  );
}
