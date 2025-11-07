import { fs } from "../../cep/node";
import { parseMaskPathBinary, ParsedMaskPath } from "../prfpset";
import { MogrtMaskPathResult } from "./types";

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
 * Parses the MOGRT XML file to extract Mask Path StartKeyframeValue
 * Similar to parseMaskPathKeyframes but works with extracted XML files
 */
export const parseMogrtXmlMaskPath = (xmlPath: string): MogrtMaskPathResult => {
  console.log("[parseMogrtXmlMaskPath] Starting parse...");
  console.log("[parseMogrtXmlMaskPath] File path:", xmlPath);

  // Validate file exists
  if (!fs.existsSync(xmlPath)) {
    const error = `XML file not found: ${xmlPath}`;
    console.error("[parseMogrtXmlMaskPath]", error);
    throw new Error(error);
  }
  console.log("[parseMogrtXmlMaskPath] File exists, reading...");

  // Read file
  const fileContent = fs.readFileSync(xmlPath, "utf8");
  console.log(
    "[parseMogrtXmlMaskPath] File read, size:",
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
    console.error("[parseMogrtXmlMaskPath]", error);
    throw new Error(error);
  }
  console.log("[parseMogrtXmlMaskPath] XML parsed successfully");

  // Find all ArbVideoComponentParam elements
  const arbParams = xmlDoc.querySelectorAll("ArbVideoComponentParam");
  console.log(
    "[parseMogrtXmlMaskPath] Found",
    arbParams.length,
    "ArbVideoComponentParam elements"
  );

  // Find the one with Name="Mask Path"
  let maskPathParam: Element | null = null;
  for (let i = 0; i < arbParams.length; i++) {
    const nameElement = arbParams[i].querySelector("Name");
    const nameText = nameElement?.textContent?.trim();
    console.log(`[parseMogrtXmlMaskPath] Param ${i} name:`, nameText);
    if (nameText === "Mask Path") {
      maskPathParam = arbParams[i];
      console.log(
        "[parseMogrtXmlMaskPath] Found Mask Path parameter at index",
        i
      );
      break;
    }
  }

  if (!maskPathParam) {
    const error = "Mask Path parameter not found in XML file";
    console.error("[parseMogrtXmlMaskPath]", error);
    throw new Error(error);
  }

  // Get KeyframeSetSize to check if there are keyframes
  const keyframeSetSizeElement = maskPathParam.querySelector("KeyframeSetSize");
  const keyframeSetSize = keyframeSetSizeElement
    ? parseInt(keyframeSetSizeElement.textContent?.trim() || "0", 10)
    : 0;

  console.log("[parseMogrtXmlMaskPath] KeyframeSetSize:", keyframeSetSize);
  const hasKeyframes = keyframeSetSize > 0;

  if (hasKeyframes) {
    console.log(
      "[parseMogrtXmlMaskPath] Mask Path has keyframes (not implemented yet)"
    );
    // For MVP, we'll focus on StartKeyframeValue
    return {
      hasKeyframes: true,
      maskPathParam,
    };
  } else {
    // No keyframes - parse StartKeyframeValue
    console.log(
      "[parseMogrtXmlMaskPath] No keyframes found, parsing StartKeyframeValue..."
    );

    const startKeyframeValueElement =
      maskPathParam.querySelector("StartKeyframeValue");
    if (!startKeyframeValueElement) {
      const error = "StartKeyframeValue not found in Mask Path parameter";
      console.error("[parseMogrtXmlMaskPath]", error);
      throw new Error(error);
    }

    const base64Value = startKeyframeValueElement.textContent?.trim() || "";
    if (!base64Value) {
      const error = "StartKeyframeValue is empty";
      console.error("[parseMogrtXmlMaskPath]", error);
      throw new Error(error);
    }
    console.log(
      "[parseMogrtXmlMaskPath] StartKeyframeValue length:",
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
      "[parseMogrtXmlMaskPath] StartKeyframePosition:",
      startPosition
    );

    // Decode base64 to Uint8Array
    try {
      const buffer = Buffer.from(base64Value, "base64");
      const startValue = new Uint8Array(buffer);
      console.log(
        "[parseMogrtXmlMaskPath] StartKeyframeValue decoded to",
        startValue.length,
        "bytes"
      );

      // Parse the binary mask path data
      const parsedPath = parseMaskPathBinary(startValue);
      console.log(
        "[parseMogrtXmlMaskPath] Successfully parsed mask path with",
        parsedPath.points.length,
        "points"
      );

      return {
        hasKeyframes: false,
        maskPathParam,
        startValue,
        startPosition,
        parsedPath,
      };
    } catch (error) {
      const errorMsg = `Failed to decode base64 StartKeyframeValue: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[parseMogrtXmlMaskPath]`, errorMsg);
      throw new Error(errorMsg);
    }
  }
};
