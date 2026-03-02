import type { RefObject } from "react";
import type { Dimensions } from "../types";

interface FramePreviewProps {
  previewImage: string | null;
  displayDimensions: Dimensions | null;
  imageRef: RefObject<HTMLImageElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  onImageLoad: () => void;
  onCanvasClick: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onCanvasMouseUp: () => void;
}

export function FramePreview({
  previewImage,
  displayDimensions,
  imageRef,
  canvasRef,
  containerRef,
  onImageLoad,
  onCanvasClick,
  onCanvasMouseDown,
  onCanvasMouseMove,
  onCanvasMouseUp,
}: FramePreviewProps) {
  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center bg-gray-900 rounded-lg overflow-hidden relative min-h-0"
    >
      {previewImage ? (
        <div className="relative w-full h-full flex items-center justify-center">
          <img
            ref={imageRef}
            src={
              previewImage.startsWith("data:")
                ? previewImage
                : `file://${previewImage}`
            }
            alt="Frame preview"
            className="max-w-full max-h-full object-contain"
            onLoad={onImageLoad}
          />
          {displayDimensions && (
            <canvas
              ref={canvasRef}
              className="absolute cursor-crosshair"
              style={{
                width: `${displayDimensions.width}px`,
                height: `${displayDimensions.height}px`,
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                pointerEvents: "auto",
              }}
              onClick={onCanvasClick}
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={onCanvasMouseUp}
            />
          )}
        </div>
      ) : (
        <div className="w-full max-w-4xl aspect-video flex items-center justify-center rounded-md border border-dashed border-gray-700/70 bg-gray-900/60 px-4">
          <div className="text-gray-400 text-center">
            <p className="text-base font-medium text-gray-300">No video loaded</p>
            <p className="text-sm mt-2">
              Click &quot;Render & Detect Faces&quot; to begin
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
