import { useCallback, RefObject } from "react";
import { canvasToNormalized } from "../../lib/utils/mogrt/encoder";
import type { UIMask } from "../types";
import type { Dimensions } from "../types";

export function isPointInPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>
): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function useCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  imageDimensions: Dimensions | null,
  masks: UIMask[],
  activeMaskId: string | null,
  selectedPointIndex: number | null
) {
  const getCanvasCoordinates = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas || !imageDimensions) return null;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: clickX * scaleX, y: clickY * scaleY };
    },
    [canvasRef, imageDimensions]
  );

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageDimensions) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    masks.forEach((mask) => {
      const pts = mask.points;
      if (pts.length > 0) {
        const isActive = mask.id === activeMaskId;
        const strokeColor = isActive ? "#00ffff" : "#ffff00";
        const fillColor = isActive
          ? "rgba(0, 255, 255, 0.2)"
          : "rgba(255, 255, 0, 0.2)";

        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const x = pts[i].x * imageDimensions.width;
          const y = pts[i].y * imageDimensions.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        if (pts.length > 2) {
          const firstX = pts[0].x * imageDimensions.width;
          const firstY = pts[0].y * imageDimensions.height;
          ctx.lineTo(firstX, firstY);
        }
        ctx.fillStyle = fillColor;
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        pts.forEach((point, index) => {
          const x = point.x * imageDimensions.width;
          const y = point.y * imageDimensions.height;
          ctx.beginPath();
          const isSelected =
            mask.id === activeMaskId && index === selectedPointIndex;
          ctx.fillStyle = isSelected ? "#ff0000" : "#ffffff";
          ctx.arc(x, y, isSelected ? 6 : 4, 0, 2 * Math.PI);
          ctx.fill();
        });
      }
    });
  }, [
    canvasRef,
    imageDimensions,
    masks,
    activeMaskId,
    selectedPointIndex,
  ]);

  const toNormalized = useCallback(
    (x: number, y: number) =>
      canvasToNormalized(x, y, imageDimensions!.width, imageDimensions!.height),
    [imageDimensions]
  );

  return { getCanvasCoordinates, drawCanvas, toNormalized };
}
