import { fs, os, path } from "../../cep/node";
import { evalTS } from "../bolt";
import { parseMogrtXmlMaskPath } from "./parser";
import { buildMogrtFile } from "./builder";
import { selectMogrtFile, selectAndImportMogrt } from "./file-selector";
import { getDefaultMaskXmlPath } from "./config";
import {
  createSquareMaskPath,
  createPentagonMaskPath,
  encodeMaskPathToBase64,
} from "./encoder";

// Re-export types
export type { MogrtMaskPathResult, IOpenDialogResult } from "./types";

/**
 * Helper function to serialize XML document back to string
 * Preserves the XML declaration if present in the original
 */
const serializeXmlDocument = (
  doc: Document,
  originalContent: string
): string => {
  // Extract XML declaration from original if present
  const xmlDeclarationMatch = originalContent.match(/^<\?xml[^>]*\?>/);
  const xmlDeclaration = xmlDeclarationMatch ? xmlDeclarationMatch[0] : "";

  // Use XMLSerializer if available (browser/CEP environment)
  let serialized: string;
  if (typeof XMLSerializer !== "undefined") {
    const serializer = new XMLSerializer();
    serialized = serializer.serializeToString(doc);
  } else {
    // Fallback: use outerHTML of document element
    serialized = doc.documentElement.outerHTML;
  }

  // Prepend XML declaration if it existed in the original
  if (xmlDeclaration && !serialized.startsWith("<?xml")) {
    return xmlDeclaration + "\n" + serialized;
  }

  return serialized;
};

/**
 * Updates the mask path in the XML document with a new encoded square path
 */
const updateXmlMaskPath = (xmlPath: string, newBase64Value: string): string => {
  console.log("[updateXmlMaskPath] Reading XML file...");
  const fileContent = fs.readFileSync(xmlPath, "utf8");

  // Parse XML
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(fileContent, "text/xml");

  // Check for parsing errors
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    const error = `Failed to parse XML: ${parseError.textContent}`;
    console.error("[updateXmlMaskPath]", error);
    throw new Error(error);
  }

  // Find the Mask Path parameter
  const arbParams = xmlDoc.querySelectorAll("ArbVideoComponentParam");
  let maskPathParam: Element | null = null;
  for (let i = 0; i < arbParams.length; i++) {
    const nameElement = arbParams[i].querySelector("Name");
    const nameText = nameElement?.textContent?.trim();
    if (nameText === "Mask Path") {
      maskPathParam = arbParams[i];
      break;
    }
  }

  if (!maskPathParam) {
    throw new Error("Mask Path parameter not found in XML file");
  }

  // Find and update StartKeyframeValue element
  const startKeyframeValueElement =
    maskPathParam.querySelector("StartKeyframeValue");
  if (!startKeyframeValueElement) {
    throw new Error("StartKeyframeValue not found in Mask Path parameter");
  }

  // Update the text content with new base64 value
  startKeyframeValueElement.textContent = newBase64Value;
  console.log(
    "[updateXmlMaskPath] Updated StartKeyframeValue with new base64 data"
  );

  // Serialize XML back to string (preserve XML declaration)
  const modifiedXml = serializeXmlDocument(xmlDoc, fileContent);

  // Write to temporary file
  const tempDir = os.tmpdir();
  const tempXmlPath = path.join(tempDir, `modified_${path.basename(xmlPath)}`);
  fs.writeFileSync(tempXmlPath, modifiedXml, "utf8");
  console.log("[updateXmlMaskPath] Wrote modified XML to:", tempXmlPath);

  return tempXmlPath;
};

/**
 * Main orchestration function to parse, validate, modify, and build MOGRT
 * @param xmlPath Path to the extracted XML file
 * @returns Promise that resolves to the path of the created .mogrt file
 */
export const modifyAndBuildMogrt = async (xmlPath: string): Promise<string> => {
  console.log("[modifyAndBuildMogrt] Starting pipeline...");

  // Step 1: Parse and validate mask path
  console.log("[modifyAndBuildMogrt] Step 1: Parsing mask path...");
  const maskPathResult = parseMogrtXmlMaskPath(xmlPath);
  console.log(
    "[modifyAndBuildMogrt] Mask path parsed successfully. Points:",
    maskPathResult.parsedPath?.points.length || 0
  );

  // Step 2: Create and encode new pentagon mask path (more complex shape for testing)
  console.log(
    "[modifyAndBuildMogrt] Step 2: Creating and encoding new pentagon mask path..."
  );
  const maskPoints = createPentagonMaskPath();
  const encodedBase64 = encodeMaskPathToBase64(maskPoints);
  console.log(
    "[modifyAndBuildMogrt] Encoded pentagon mask path:",
    maskPoints.length,
    "points"
  );

  // Step 3: Update XML with new mask path
  console.log(
    "[modifyAndBuildMogrt] Step 3: Updating XML with new mask path..."
  );
  const modifiedXmlPath = updateXmlMaskPath(xmlPath, encodedBase64);

  // Step 4: Build MOGRT file using modified XML
  console.log("[modifyAndBuildMogrt] Step 4: Building MOGRT file...");
  const tempDir = os.tmpdir();
  const mogrtPath = await buildMogrtFile(modifiedXmlPath, tempDir);

  console.log("[modifyAndBuildMogrt] Pipeline completed successfully");
  return mogrtPath;
};

/**
 * Main integration function that orchestrates the complete pipeline:
 * 1. Parse and validate mask path from XML
 * 2. Build MOGRT file structure
 * 3. Import into Premiere Pro sequence
 * @param xmlPath Optional path to XML file. If not provided, uses default from bin folder
 * @param timeInTicks Optional time position for import. If not provided, uses playhead position
 * @param videoTrackOffset Track offset for video (default: 1)
 * @param audioTrackOffset Track offset for audio (default: 0)
 * @returns Success message or error description
 */
export const buildAndImportMogrt = async (
  xmlPath?: string,
  timeInTicks?: string,
  videoTrackOffset: number = 1,
  audioTrackOffset: number = 0
): Promise<string> => {
  try {
    console.log("[buildAndImportMogrt] Starting complete pipeline...");

    // Get XML file path if not provided
    let xmlFilePath: string;
    if (xmlPath) {
      xmlFilePath = xmlPath;
    } else {
      // Use default XML file from bin folder
      xmlFilePath = getDefaultMaskXmlPath();
      console.log("[buildAndImportMogrt] Using default XML path:", xmlFilePath);
    }

    // Validate XML file exists
    if (!fs.existsSync(xmlFilePath)) {
      const error = `XML file not found: ${xmlFilePath}`;
      console.error("[buildAndImportMogrt]", error);
      return error;
    }

    // Step 1: Parse and build MOGRT
    console.log("[buildAndImportMogrt] Step 1: Building MOGRT file...");
    const mogrtPath = await modifyAndBuildMogrt(xmlFilePath);
    console.log("[buildAndImportMogrt] MOGRT built:", mogrtPath);

    // Step 2: Import into Premiere Pro
    console.log(
      "[buildAndImportMogrt] Step 2: Importing MOGRT into Premiere Pro..."
    );
    const importResult = await evalTS(
      "importModifiedMogrt",
      mogrtPath,
      timeInTicks,
      videoTrackOffset,
      audioTrackOffset
    );

    console.log("[buildAndImportMogrt] Pipeline completed");
    return `MOGRT built and imported successfully.\nBuild: ${mogrtPath}\nImport: ${importResult}`;
  } catch (error: any) {
    const errorMsg = `Error in buildAndImportMogrt: ${error instanceof Error ? error.message : String(error)}`;
    console.error("[buildAndImportMogrt]", errorMsg);
    return errorMsg;
  }
};

// Re-export all public functions
export { parseMogrtXmlMaskPath } from "./parser";
export { getDefaultMaskXmlPath } from "./config";
export { buildMogrtFile } from "./builder";
export { selectMogrtFile, selectAndImportMogrt } from "./file-selector";
