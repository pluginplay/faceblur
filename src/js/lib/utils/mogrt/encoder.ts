import { Buffer } from "buffer";

export interface MaskPoint {
  x: number;
  y: number;
  inTangentX?: number;
  inTangentY?: number;
  outTangentX?: number;
  outTangentY?: number;
}

/**
 * Writes a 32-bit float to a buffer at the given offset (little-endian)
 */
const writeFloat32LE = (
  buffer: Uint8Array,
  offset: number,
  value: number
): void => {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
  view.setFloat32(0, value, true); // true = little-endian
};

/**
 * Writes a 32-bit integer to a buffer at the given offset (little-endian)
 */
const writeInt32LE = (
  buffer: Uint8Array,
  offset: number,
  value: number
): void => {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
  view.setInt32(0, value, true); // true = little-endian
};

/**
 * Creates a 5-point pentagon mask path in normalized coordinates (0-1 range)
 * Accounts for aspect ratio to create a regular pentagon (not stretched)
 * @param centerX Optional center X coordinate (normalized). Defaults to 0.5 (center)
 * @param centerY Optional center Y coordinate (normalized). Defaults to 0.5 (center)
 * @param size Optional size factor (0-1). Defaults to 0.4 (40% of frame height)
 * @param aspectRatio Optional aspect ratio (width/height). Defaults to 16/9 (1280x720)
 * @returns Array of 5 points forming a pentagon (top point, then clockwise)
 */
export const createPentagonMaskPath = (
  centerX: number = 0.5,
  centerY: number = 0.5,
  size: number = 0.4,
  aspectRatio: number = 16 / 9
): MaskPoint[] => {
  const points: MaskPoint[] = [];
  const numPoints = 5;

  // Adjust size for aspect ratio to maintain regular shape
  const adjustedSize = size / aspectRatio;

  // Calculate pentagon vertices
  // Start from top point and go clockwise
  for (let i = 0; i < numPoints; i++) {
    // Angle for each vertex (pentagon: 72 degrees between points)
    // Start at -90 degrees (top) and rotate clockwise
    const angle = (-90 + (i * 360) / numPoints) * (Math.PI / 180);

    // Calculate x and y coordinates
    // Adjust x by aspect ratio to maintain regular shape
    const x = centerX + adjustedSize * Math.cos(angle);
    const y = centerY + size * Math.sin(angle);

    points.push({ x, y });
  }

  return points;
};

/**
 * Encodes mask path points into Premiere Pro's binary format
 * Format structure:
 * - Header: "2cin" magic (4 bytes) + 3 int32s (12 bytes) = 16 bytes total
 *   - Offset 4: closed path flag (2 = closed path)
 *   - Offset 8: padding (0)
 *   - Offset 12: point count
 * - Each point: 32 bytes containing:
 *   - pointType (4 bytes int32) - use 0
 *   - x coordinate (4 bytes float32) - normalized 0-1, stored at offset+4
 *   - y coordinate (4 bytes float32) - normalized 0-1, stored at offset+8
 *   - inTangentX (4 bytes float32) - same as x for straight lines, stored at offset+12
 *   - inTangentY (4 bytes float32) - same as y for straight lines, stored at offset+16
 *   - outTangentX (4 bytes float32) - same as x for straight lines, stored at offset+20
 *   - outTangentY (4 bytes float32) - same as y for straight lines, stored at offset+24
 *   - extra padding (4 bytes) - use 0x01000000
 * @param points Array of mask points with normalized coordinates (0-1 range)
 * @returns Uint8Array of encoded binary data
 */
export const encodeMaskPathBinary = (points: MaskPoint[]): Uint8Array => {
  console.log("[encodeMaskPathBinary] Encoding", points.length, "points");

  const pointCount = points.length;
  const headerSize = 16; // Magic (4) + 3 int32s (12) = 16 bytes
  const bytesPerPoint = 32;
  const totalSize = headerSize + pointCount * bytesPerPoint;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  // Write header
  // Magic string "2cin"
  buffer[0] = 0x32; // '2'
  buffer[1] = 0x63; // 'c'
  buffer[2] = 0x69; // 'i'
  buffer[3] = 0x6e; // 'n'

  // Header values at offsets 4, 8, 12
  // Based on actual data analysis:
  // - Offset 4: closed path flag (2 = closed path)
  // - Offset 8: padding/value (0)
  // - Offset 12: point count
  writeInt32LE(buffer, 4, 2); // Closed path flag
  writeInt32LE(buffer, 8, 0); // Padding
  writeInt32LE(buffer, 12, pointCount);

  // Write each point
  for (let i = 0; i < pointCount; i++) {
    const point = points[i];
    const pointOffset = headerSize + i * bytesPerPoint;

    // pointType (4 bytes) - use 0
    writeInt32LE(buffer, pointOffset, 0);

    // Coordinates stored at offset+4/+8 (Premiere reads from here)
    writeFloat32LE(buffer, pointOffset + 4, point.x);
    writeFloat32LE(buffer, pointOffset + 8, point.y);

    // Tangents - for straight lines, use same as point coordinates
    const inTanX = point.inTangentX ?? point.x;
    const inTanY = point.inTangentY ?? point.y;
    const outTanX = point.outTangentX ?? point.x;
    const outTanY = point.outTangentY ?? point.y;

    // Tangents stored at offset+12/+16/+20/+24
    writeFloat32LE(buffer, pointOffset + 12, inTanX);
    writeFloat32LE(buffer, pointOffset + 16, inTanY);
    writeFloat32LE(buffer, pointOffset + 20, outTanX);
    writeFloat32LE(buffer, pointOffset + 24, outTanY);

    // Extra padding (4 bytes) - use 0x01000000 based on existing data
    writeInt32LE(buffer, pointOffset + 28, 0x01000000);
  }

  console.log(
    `[encodeMaskPathBinary] Encoded ${pointCount} points, total size: ${totalSize} bytes`
  );
  return buffer;
};

/**
 * Encodes mask path points and converts to base64 string for XML insertion
 * @param points Array of mask points with normalized coordinates (0-1 range)
 * @returns Base64-encoded string
 */
export const encodeMaskPathToBase64 = (points: MaskPoint[]): string => {
  const binary = encodeMaskPathBinary(points);
  const buffer = Buffer.from(binary);
  return buffer.toString("base64");
};

/**
 * Converts canvas coordinates to normalized coordinates (0-1 range)
 * @param x Canvas X coordinate
 * @param y Canvas Y coordinate
 * @param imageWidth Image width in pixels
 * @param imageHeight Image height in pixels
 * @returns Normalized coordinates { x, y } in 0-1 range
 */
export const canvasToNormalized = (
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number } => {
  const normalizedX = Math.max(0, Math.min(1, x / imageWidth));
  const normalizedY = Math.max(0, Math.min(1, y / imageHeight));
  return { x: normalizedX, y: normalizedY };
};

/**
 * Creates a test box (rectangle) at specific normalized coordinates
 * Useful for debugging coordinate transformation between panel and Premiere
 * @param x1 Top-left X coordinate (normalized 0-1)
 * @param y1 Top-left Y coordinate (normalized 0-1)
 * @param x2 Bottom-right X coordinate (normalized 0-1)
 * @param y2 Bottom-right Y coordinate (normalized 0-1)
 * @returns Array of 4 points forming a rectangle (top-left, top-right, bottom-right, bottom-left)
 */
export const createTestBox = (
  x1: number = 0.1,
  y1: number = 0.1,
  x2: number = 0.9,
  y2: number = 0.9
): MaskPoint[] => {
  return [
    { x: x1, y: y1 }, // Top-left
    { x: x2, y: y1 }, // Top-right
    { x: x2, y: y2 }, // Bottom-right
    { x: x1, y: y2 }, // Bottom-left
  ];
};
