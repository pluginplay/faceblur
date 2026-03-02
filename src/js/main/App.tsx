import { useFaceBlurApp } from "./hooks";
import {
  FramePreview,
  ActionButtons,
  MaskTools,
  Scrubber,
  MaskList,
  MaskProperties,
  StatusBar,
} from "./components";

export function App() {
  const app = useFaceBlurApp();

  const activeMask = app.masks.find((m) => m.id === app.activeMaskId) ?? null;
  const canApply =
    app.masks.length > 0 &&
    app.masks.every((m) => app.maskHasAnyValidShape(m));

  return (
    <div
      className="app h-full w-full min-h-0 flex flex-col"
      style={{ backgroundColor: app.bgColor }}
      onMouseEnter={() => {
        void app.handlePanelMouseEnter();
      }}
    >
      {/* Toolbar */}
      <div className="shrink-0 p-3 pb-0 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <ActionButtons
            isRendering={app.isRendering}
            isDetectingFaces={app.isDetectingFaces}
            selectedClipCount={app.selectedClipCount}
            confidenceThreshold={app.confidenceThreshold}
            onConfidenceChange={app.setConfidenceThreshold}
            onLoadAndRender={app.handleLoadAndRenderSequence}
            onCancel={app.handleCancel}
          />
          <div className="h-4 w-px bg-gray-600" aria-hidden />
          <MaskTools
            onApplyMasks={app.handleApplyMasks}
            canApply={canApply}
          />
        </div>
      </div>

      {/* Main content: sidebar + canvas */}
      <div className="flex flex-1 min-h-0 p-3 gap-3">
        {/* Left: Tracks sidebar */}
        <aside className="shrink-0 w-28 flex flex-col min-h-0 rounded-lg border border-gray-700/60 overflow-hidden bg-gray-800/50">
          <MaskList
              masks={app.masks}
              activeMaskId={app.activeMaskId}
              onSelectMask={(id) => {
                app.setActiveMaskId(id);
                app.setSelectedPointIndex(null);
              }}
              onRemove={app.removeMask}
            />
        </aside>

        {/* Center: Video canvas */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 gap-3">
          <FramePreview
            previewImage={app.previewImage}
            displayDimensions={app.displayDimensions}
            imageRef={app.imageRef}
            canvasRef={app.canvasRef}
            containerRef={app.containerRef}
            onImageLoad={app.handleImageLoad}
            onCanvasClick={app.handleCanvasClick}
            onCanvasMouseDown={app.handleCanvasMouseDown}
            onCanvasMouseMove={app.handleCanvasMouseMove}
            onCanvasMouseUp={app.handleCanvasMouseUp}
          />

          {/* Timeline */}
          {app.framePaths.length > 0 && (
            <div className="shrink-0">
              <Scrubber
                framePathsLength={app.framePaths.length}
                currentFrameIndex={app.currentFrameIndex}
                isPlaying={app.isPlaying}
                onFrameChange={(v) => {
                  app.setCurrentFrameIndex(v);
                  app.setIsPlaying(false);
                }}
                onPlayPause={() => app.setIsPlaying(!app.isPlaying)}
              />
            </div>
          )}

          {/* Mask properties (when a mask is selected) */}
          {activeMask && (
            <div className="shrink-0">
              <MaskProperties
                activeMask={activeMask}
                onBlurrinessChange={(v) =>
                  app.updateActiveMaskValue("blurriness", v)
                }
                onFeatherChange={(v) =>
                  app.updateActiveMaskValue("feather", v)
                }
                onExpansionChange={(v) =>
                  app.updateActiveMaskValue("expansion", v)
                }
              />
            </div>
          )}

          {/* Status */}
          <StatusBar message={app.statusMessage} />
        </main>
      </div>
    </div>
  );
}
