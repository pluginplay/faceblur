import { fs } from "../cep/node";
import { getDefaultMaskXmlPath } from "./mogrt/config";

export interface MaskPathKeyframe {
  position: number;
  value: Uint8Array;
}

export interface MaskPathKeyframesResult {
  hasKeyframes: boolean;
  keyframes: MaskPathKeyframe[];
  startValue?: Uint8Array;
  startPosition?: number;
}

export interface ParsedMaskPoint {
  x: number;
  y: number;
  inTangentX?: number;
  inTangentY?: number;
  outTangentX?: number;
  outTangentY?: number;
}

export interface ParsedMaskPath {
  points: ParsedMaskPoint[];
  rawBytes: Uint8Array;
  analysis: {
    totalBytes: number;
    headerSize: number;
    bytesPerPoint: number;
    estimatedPointCount: number;
  };
}

/**
 * Gets the default XML file used for mask path parsing (FaceBlur Test project)
 */
export const getPresetFilePath = (): string => {
  return getDefaultMaskXmlPath();
};

/**
 * Helper function to find child elements by tag name (handles dots in tag names)
 */
const findChildElement = (parent: Element, tagName: string): Element | null => {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.tagName === tagName) {
      return child;
    }
  }
  return null;
};

/**
 * Reads a 32-bit float from a Uint8Array at the given offset (little-endian)
 */
const readFloat32LE = (buffer: Uint8Array, offset: number): number => {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
  return view.getFloat32(0, true); // true = little-endian, offset 0 relative to the slice
};

/**
 * Reads a 32-bit integer from a Uint8Array at the given offset (little-endian)
 */
const readInt32LE = (buffer: Uint8Array, offset: number): number => {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
  return view.getInt32(0, true); // true = little-endian
};

/**
 * Parses the binary mask path data from Premiere Pro's proprietary format
 * This attempts to decode the binary structure into readable point coordinates
 */
export const parseMaskPathBinary = (data: Uint8Array): ParsedMaskPath => {
  console.log("[parseMaskPathBinary] Starting binary parse...");
  console.log("[parseMaskPathBinary] Data length:", data.length, "bytes");

  // Log first few bytes to identify magic numbers/headers
  console.log("[parseMaskPathBinary] First 32 bytes (hex):");
  const hexPreview = Array.from(data.slice(0, 32))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  console.log(hexPreview);

  // Try to identify the format
  // Adobe often uses "kcin" or similar magic strings
  const magicString = String.fromCharCode(...data.slice(0, 4));
  console.log("[parseMaskPathBinary] First 4 bytes as string:", magicString);

  const points: ParsedMaskPoint[] = [];
  let headerSize = 0;
  let bytesPerPoint = 0;

  // Analyze the format structure
  // From the hex dump: "2cin" (4 bytes) + 2 (4 bytes) + 0 (4 bytes) + 4 (4 bytes) = 16 byte header
  // Point count appears to be at offset 12 (after magic + two 4-byte values)

  let pointCount = 0;

  // Strategy 1: Check for "2cin" or "kcin" magic string format
  if (magicString === "2cin" || magicString === "kcin") {
    console.log(
      "[parseMaskPathBinary] Detected Adobe format with magic:",
      magicString
    );

    // Read values at different offsets to find point count
    const valAt4 = readInt32LE(data, 4);
    const valAt8 = readInt32LE(data, 8);
    const valAt12 = readInt32LE(data, 12);

    console.log("[parseMaskPathBinary] Value at offset 4:", valAt4);
    console.log("[parseMaskPathBinary] Value at offset 8:", valAt8);
    console.log("[parseMaskPathBinary] Value at offset 12:", valAt12);

    // Point count is typically at offset 12 based on the hex dump
    // It should be a reasonable number (1-100 for mask paths)
    if (valAt12 > 0 && valAt12 < 100) {
      pointCount = valAt12;
      headerSize = 16; // Magic (4) + 3 int32s (12) = 16 bytes
      bytesPerPoint = (data.length - headerSize) / pointCount;

      console.log(
        `[parseMaskPathBinary] Found ${pointCount} points, header=${headerSize} bytes, ${bytesPerPoint.toFixed(1)} bytes per point`
      );

      // Parse each point
      for (let i = 0; i < pointCount; i++) {
        const pointOffset = headerSize + i * bytesPerPoint;

        if (pointOffset + 28 <= data.length) {
          const pointType = readInt32LE(data, pointOffset);
          const x = readFloat32LE(data, pointOffset + 4);
          const y = readFloat32LE(data, pointOffset + 8);

          console.log(
            `[parseMaskPathBinary] Reading point ${i} (type=${pointType}) at offset ${pointOffset}: raw x=${x}, y=${y}`
          );

          if (!isNaN(x) && !isNaN(y) && isFinite(x) && isFinite(y)) {
            const point: ParsedMaskPoint = { x, y };

            point.inTangentX = readFloat32LE(data, pointOffset + 12);
            point.inTangentY = readFloat32LE(data, pointOffset + 16);
            point.outTangentX = readFloat32LE(data, pointOffset + 20);
            point.outTangentY = readFloat32LE(data, pointOffset + 24);

            points.push(point);
            console.log(
              `[parseMaskPathBinary] Point ${i}: x=${x.toFixed(4)}, y=${y.toFixed(4)}`
            );
            if (
              point.inTangentX !== undefined &&
              point.inTangentY !== undefined
            ) {
              console.log(
                `[parseMaskPathBinary]   In tangent: (${point.inTangentX.toFixed(4)}, ${point.inTangentY.toFixed(4)})`
              );
            }
            if (
              point.outTangentX !== undefined &&
              point.outTangentY !== undefined
            ) {
              console.log(
                `[parseMaskPathBinary]   Out tangent: (${point.outTangentX.toFixed(4)}, ${point.outTangentY.toFixed(4)})`
              );
            }
          } else {
            console.warn(
              `[parseMaskPathBinary] Point ${i} at offset ${pointOffset} has invalid coordinates: x=${x}, y=${y}`
            );
          }
        }
      }
    }
  }

  // Fallback: If we didn't find a point count, try reading from offset 12 directly
  if (points.length === 0 && data.length >= 16) {
    const potentialPointCount = readInt32LE(data, 12);
    console.log(
      `[parseMaskPathBinary] Fallback: Trying point count ${potentialPointCount} from offset 12`
    );

    if (potentialPointCount > 0 && potentialPointCount < 100) {
      headerSize = 16;
      bytesPerPoint = (data.length - headerSize) / potentialPointCount;
      pointCount = potentialPointCount;

      for (let i = 0; i < potentialPointCount; i++) {
        const pointOffset = headerSize + i * bytesPerPoint;
        if (pointOffset + 8 <= data.length) {
          const x = readFloat32LE(data, pointOffset);
          const y = readFloat32LE(data, pointOffset + 4);

          if (!isNaN(x) && !isNaN(y) && isFinite(x) && isFinite(y)) {
            points.push({ x, y });
          }
        }
      }
    }
  }

  // If we didn't parse points successfully, try a simpler approach
  // Look for float patterns that might be coordinates
  if (points.length === 0) {
    console.log("[parseMaskPathBinary] Trying alternative parsing strategy...");

    // Try reading floats from various offsets
    // For 4 points, we might expect: header + (4 points * 8+ bytes each)
    // Let's try reading pairs of floats as coordinates
    let offset = 0;
    // Skip potential header (first 12-16 bytes often contain metadata)
    if (data.length > 16) {
      offset = 12; // Common header size
    }

    while (offset + 8 <= data.length && points.length < 10) {
      // Try reading two floats as X, Y
      const x = readFloat32LE(data, offset);
      const y = readFloat32LE(data, offset + 4);

      // Check if values are reasonable (not NaN, not infinity, reasonable range)
      if (
        !isNaN(x) &&
        !isNaN(y) &&
        isFinite(x) &&
        isFinite(y) &&
        Math.abs(x) < 100000 &&
        Math.abs(y) < 100000
      ) {
        points.push({ x, y });
        console.log(
          `[parseMaskPathBinary] Found potential point at offset ${offset}: x=${x.toFixed(3)}, y=${y.toFixed(3)}`
        );
        offset += 8; // Move to next potential point
      } else {
        offset += 4; // Try next float
      }
    }
  }

  const estimatedPointCount =
    points.length > 0
      ? points.length
      : pointCount > 0
        ? pointCount
        : Math.floor(data.length / 36);

  return {
    points,
    rawBytes: data,
    analysis: {
      totalBytes: data.length,
      headerSize,
      bytesPerPoint:
        bytesPerPoint || Math.floor(data.length / Math.max(points.length, 1)),
      estimatedPointCount,
    },
  };
};

/**
 * Parses the .prfpset XML file to extract Mask Path keyframe data
 */
export const parseMaskPathKeyframes = (): MaskPathKeyframesResult => {
  console.log("[parseMaskPathKeyframes] Starting parse...");
  const filePath = getPresetFilePath();
  console.log("[parseMaskPathKeyframes] File path:", filePath);

  // Validate file exists
  if (!fs.existsSync(filePath)) {
    const error = `Preset file not found: ${filePath}`;
    console.error("[parseMaskPathKeyframes]", error);
    throw new Error(error);
  }
  console.log("[parseMaskPathKeyframes] File exists, reading...");

  // Read file
  const fileContent = fs.readFileSync(filePath, "utf8");
  console.log(
    "[parseMaskPathKeyframes] File read, size:",
    fileContent.length,
    "chars"
  );

  // Parse XML
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(fileContent, "text/xml");

  // Check for parsing errors
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    const error = `Failed to parse XML: ${parseError.textContent}`;
    console.error("[parseMaskPathKeyframes]", error);
    throw new Error(error);
  }
  console.log("[parseMaskPathKeyframes] XML parsed successfully");

  // Find all ArbVideoComponentParam elements
  const arbParams = xmlDoc.querySelectorAll("ArbVideoComponentParam");
  console.log(
    "[parseMaskPathKeyframes] Found",
    arbParams.length,
    "ArbVideoComponentParam elements"
  );

  // Find the one with Name="Mask Path"
  let maskPathParam: Element | null = null;
  for (let i = 0; i < arbParams.length; i++) {
    const nameElement = arbParams[i].querySelector("Name");
    const nameText = nameElement?.textContent?.trim();
    console.log(`[parseMaskPathKeyframes] Param ${i} name:`, nameText);
    if (nameText === "Mask Path") {
      maskPathParam = arbParams[i];
      console.log(
        "[parseMaskPathKeyframes] Found Mask Path parameter at index",
        i
      );
      break;
    }
  }

  if (!maskPathParam) {
    const error = "Mask Path parameter not found in preset file";
    console.error("[parseMaskPathKeyframes]", error);
    throw new Error(error);
  }

  // Get KeyframeSetSize
  const keyframeSetSizeElement = maskPathParam.querySelector("KeyframeSetSize");
  const keyframeSetSize = keyframeSetSizeElement
    ? parseInt(keyframeSetSizeElement.textContent?.trim() || "0", 10)
    : 0;

  console.log("[parseMaskPathKeyframes] KeyframeSetSize:", keyframeSetSize);

  // List all child elements for debugging
  console.log("[parseMaskPathKeyframes] Child elements of Mask Path param:");
  for (let i = 0; i < maskPathParam.children.length; i++) {
    const child = maskPathParam.children[i];
    console.log(`  - ${child.tagName}`);
  }

  const hasKeyframes = keyframeSetSize > 0;
  console.log(
    `[parseMaskPathKeyframes] Preset has keyframes: ${hasKeyframes} (KeyframeSetSize: ${keyframeSetSize})`
  );

  if (hasKeyframes) {
    // Extract all keyframes
    const keyframes: MaskPathKeyframe[] = [];

    for (let i = 0; i < keyframeSetSize; i++) {
      console.log(`[parseMaskPathKeyframes] Processing keyframe ${i}...`);

      // Get keyframe value (base64 encoded) - use manual traversal since querySelector doesn't handle dots
      const valueTagName = `kf.${i}.value`;
      const valueElement = findChildElement(maskPathParam, valueTagName);
      if (!valueElement) {
        console.warn(
          `[parseMaskPathKeyframes] Keyframe ${i} value element '${valueTagName}' not found, skipping`
        );
        continue;
      }

      const base64Value = valueElement.textContent?.trim() || "";
      if (!base64Value) {
        console.warn(
          `[parseMaskPathKeyframes] Keyframe ${i} value is empty, skipping`
        );
        continue;
      }
      console.log(
        `[parseMaskPathKeyframes] Keyframe ${i} value length:`,
        base64Value.length,
        "chars"
      );

      // Get keyframe position
      const positionTagName = `kf.${i}.position`;
      const positionElement = findChildElement(maskPathParam, positionTagName);
      const position = positionElement
        ? parseFloat(positionElement.textContent?.trim() || "0")
        : 0;
      console.log(`[parseMaskPathKeyframes] Keyframe ${i} position:`, position);

      // Decode base64 to Uint8Array
      try {
        // In Node.js CEP context, Buffer is available
        const buffer = Buffer.from(base64Value, "base64");
        const value = new Uint8Array(buffer);
        console.log(
          `[parseMaskPathKeyframes] Keyframe ${i} decoded to`,
          value.length,
          "bytes"
        );

        keyframes.push({
          position,
          value,
        });
        console.log(
          `[parseMaskPathKeyframes] Keyframe ${i} added successfully`
        );
      } catch (error) {
        const errorMsg = `Failed to decode base64 for keyframe ${i}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[parseMaskPathKeyframes]`, errorMsg);
        throw new Error(errorMsg);
      }
    }

    if (keyframes.length === 0) {
      const error = "No valid keyframes could be extracted";
      console.error("[parseMaskPathKeyframes]", error);
      throw new Error(error);
    }

    console.log(
      "[parseMaskPathKeyframes] Successfully extracted",
      keyframes.length,
      "keyframe(s)"
    );
    return { hasKeyframes: true, keyframes };
  } else {
    // No keyframes - parse StartKeyframeValue
    console.log(
      "[parseMaskPathKeyframes] No keyframes found, parsing StartKeyframeValue..."
    );

    const startKeyframeValueElement =
      maskPathParam.querySelector("StartKeyframeValue");
    if (!startKeyframeValueElement) {
      const error = "StartKeyframeValue not found in Mask Path parameter";
      console.error("[parseMaskPathKeyframes]", error);
      throw new Error(error);
    }

    const base64Value = startKeyframeValueElement.textContent?.trim() || "";
    if (!base64Value) {
      const error = "StartKeyframeValue is empty";
      console.error("[parseMaskPathKeyframes]", error);
      throw new Error(error);
    }
    console.log(
      "[parseMaskPathKeyframes] StartKeyframeValue length:",
      base64Value.length,
      "chars"
    );

    // Get StartKeyframePosition
    const startKeyframePositionElement = maskPathParam.querySelector(
      "StartKeyframePosition"
    );
    const startPosition = startKeyframePositionElement
      ? parseFloat(startKeyframePositionElement.textContent?.trim() || "0")
      : 0;
    console.log(
      "[parseMaskPathKeyframes] StartKeyframePosition:",
      startPosition
    );

    // Decode base64 to Uint8Array
    try {
      const buffer = Buffer.from(base64Value, "base64");
      const startValue = new Uint8Array(buffer);
      console.log(
        "[parseMaskPathKeyframes] StartKeyframeValue decoded to",
        startValue.length,
        "bytes"
      );

      console.log(
        "[parseMaskPathKeyframes] Successfully extracted StartKeyframeValue"
      );
      return {
        hasKeyframes: false,
        keyframes: [],
        startValue,
        startPosition,
      };
    } catch (error) {
      const errorMsg = `Failed to decode base64 StartKeyframeValue: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[parseMaskPathKeyframes]`, errorMsg);
      throw new Error(errorMsg);
    }
  }
};
