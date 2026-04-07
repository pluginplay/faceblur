import { fs, os, path } from "../../cep/node";
import { evalTSResult } from "../bridge";
import {
  parseMogrtXmlMaskPath,
  findGaussianBlurMaskTuples,
  collectUsedObjectIds,
  makeObjectIdAllocator,
} from "./parser";
import { buildMogrtFile } from "./builder";
import { getDefaultMaskXmlPath } from "./config";
import {
  createPentagonMaskPath,
  encodeMaskPathToBase64,
  type MaskPoint,
} from "./encoder";
import { bboxToMaskPoints } from "../faceDetection";

// Re-export types
export type { MogrtMaskPathResult } from "./types";

// Time constants per Adobe ExtendScript Time.
const TICKS_PER_SECOND = 254016000000n;
// Many AE/MOGRT templates start comp time at 01:00:00:00; native XML keyframes
// are typically around this base. Anchor generated keyframes to this base time.
const COMP_BASE_TICKS = 914457600000000n; // 01:00:00:00

const getFrameAlignedBaseTicks = (ticksPerFrame: bigint): bigint => {
  // COMP_BASE_TICKS is exact for integer rates (24/25/30/60) but can be off-grid
  // for fractional rates (e.g. 29.97). Snap to nearest frame boundary.
  const remainder = COMP_BASE_TICKS % ticksPerFrame;
  if (remainder === 0n) return COMP_BASE_TICKS;
  const lower = COMP_BASE_TICKS - remainder;
  const upper = lower + ticksPerFrame;
  return remainder * 2n < ticksPerFrame ? lower : upper;
};

const toFrameAlignedTicks = (frameIndex: number, ticksPerFrame: string): string => {
  if (!Number.isFinite(frameIndex)) {
    throw new Error(`Invalid frame index '${frameIndex}' for keyframe generation`);
  }
  const roundedFrameIndex = Math.round(frameIndex);
  if (roundedFrameIndex < 0) {
    throw new Error(`Negative frame index '${roundedFrameIndex}' is not supported`);
  }
  const tpf = BigInt(ticksPerFrame);
  if (tpf <= 0n) {
    throw new Error(`Invalid ticksPerFrame '${ticksPerFrame}'`);
  }
  const baseTicks = getFrameAlignedBaseTicks(tpf);
  return (baseTicks + BigInt(roundedFrameIndex) * tpf).toString();
};

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
 * Updates the mask path in the XML document with a new encoded path (single).
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
 * Sets the numeric in StartKeyframe string (second comma-separated value).
 */
const setStartKeyframeNumericValue = (paramEl: Element, value: number) => {
  const keyEl = paramEl.querySelector("StartKeyframe");
  if (!keyEl || !keyEl.textContent) return;
  const parts = keyEl.textContent.split(",");
  if (parts.length < 2) return;
  parts[1] = String(value);
  keyEl.textContent = parts.join(",");
};

/**
 * Creates a morphing variation of mask points for animation
 * @param originalPoints Original mask points
 * @param variationFactor How much to vary the shape (0-1)
 * @param frameIndex Current frame in the animation sequence
 * @param totalFrames Total number of frames in animation
 */
const createMorphingMaskPoints = (
  originalPoints: MaskPoint[],
  variationFactor: number,
  frameIndex: number,
  totalFrames: number
): MaskPoint[] => {
  const progress = frameIndex / (totalFrames - 1); // 0 to 1
  const morphAmount = Math.sin(progress * Math.PI * 2) * variationFactor; // Sine wave for smooth morphing

  return originalPoints.map((point, index) => {
    // Create a unique variation for each point based on its index
    const angle = (index / originalPoints.length) * Math.PI * 2;
    const variationX =
      Math.cos(angle + progress * Math.PI * 4) * morphAmount * 0.05;
    const variationY =
      Math.sin(angle + progress * Math.PI * 4) * morphAmount * 0.05;

    // Also add a small overall translation that moves over time
    const translateX =
      Math.sin(progress * Math.PI * 2) * variationFactor * 0.03;
    const translateY =
      Math.cos(progress * Math.PI * 2) * variationFactor * 0.03;

    return {
      x: Math.max(0, Math.min(1, point.x + variationX + translateX)),
      y: Math.max(0, Math.min(1, point.y + variationY + translateY)),
    };
  });
};

/**
 * Updates a mask path parameter to use keyframes instead of static values
 * @param maskPathParam The ArbVideoComponentParam element for the mask path
 * @param base64Value The base64-encoded mask path data
 * @param ticksPerFrame The ticks per frame as string
 * @param animate Whether to create multiple animated keyframes
 * @param originalPoints Original mask points for animation generation
 */
const updateMaskPathWithKeyframes = (
  maskPathParam: Element,
  base64Value: string,
  ticksPerFrame: string,
  animate: boolean = false,
  originalPoints?: MaskPoint[]
) => {
  // Remove IsTimeVarying tag if it exists (should not be present with keyframes)
  const isTimeVarying = maskPathParam.querySelector("IsTimeVarying");
  if (isTimeVarying) {
    maskPathParam.removeChild(isTimeVarying);
  }

  // Ensure StartKeyframeValue is set
  let startKeyframeValue = maskPathParam.querySelector("StartKeyframeValue");
  if (!startKeyframeValue) {
    startKeyframeValue =
      maskPathParam.ownerDocument.createElement("StartKeyframeValue");
    startKeyframeValue.setAttribute("Encoding", "base64");
    // For new elements, we'll generate a simple hash or use a placeholder
    // In practice, Premiere might generate this, but for now we'll use a consistent placeholder
    startKeyframeValue.setAttribute(
      "BinaryHash",
      "00000000-0000-0000-0000-000000000000"
    );
    maskPathParam.appendChild(startKeyframeValue);
  } else {
    // Preserve existing BinaryHash if present
    const existingHash = startKeyframeValue.getAttribute("BinaryHash");
    if (!existingHash) {
      startKeyframeValue.setAttribute(
        "BinaryHash",
        "00000000-0000-0000-0000-000000000000"
      );
    }
  }
  startKeyframeValue.textContent = base64Value;

  let keyframesText: string;

  if (animate && originalPoints) {
    // Create animated keyframes over ~2 seconds, aligned to frame boundaries
    const animationFrames = 8; // 8 keyframes over ~2 seconds
    const tpf = BigInt(ticksPerFrame);
    const baseTicks = getFrameAlignedBaseTicks(tpf);
    const totalTicks = 2n * TICKS_PER_SECOND; // strictly 2 seconds
    const totalFrames = Math.max(1, Math.round(Number(totalTicks / tpf)));
    const stepFrames = Math.max(
      1,
      Math.round(totalFrames / (animationFrames - 1))
    );

    const keyframePairs: string[] = [];
    for (let i = 0; i < animationFrames; i++) {
      const frameTicks = (baseTicks + BigInt(i * stepFrames) * tpf).toString();
      let frameBase64 = base64Value;

      if (i > 0) {
        // First frame uses original shape
        const morphingPoints = createMorphingMaskPoints(
          originalPoints,
          10,
          i,
          animationFrames
        );
        frameBase64 = encodeMaskPathToBase64(morphingPoints);
      }

      keyframePairs.push(`${frameTicks},${frameBase64}`);
    }
    keyframesText = keyframePairs.join(";") + ";";
  } else {
    // Static keyframes at layer start (0) and +1 frame, aligned to exact frame ticks
    const t0 = toFrameAlignedTicks(0, ticksPerFrame);
    const t1 = toFrameAlignedTicks(1, ticksPerFrame);
    keyframesText = `${t0},${base64Value};${t1},${base64Value};`;
  }

  // Add or update Keyframes element
  let keyframesEl = maskPathParam.querySelector("Keyframes");
  if (!keyframesEl) {
    keyframesEl = maskPathParam.ownerDocument.createElement("Keyframes");
    // Insert after StartKeyframePosition but before StartKeyframeValue
    const startKeyframePosition = maskPathParam.querySelector(
      "StartKeyframePosition"
    );
    if (startKeyframePosition && startKeyframePosition.nextSibling) {
      maskPathParam.insertBefore(
        keyframesEl,
        startKeyframePosition.nextSibling
      );
    } else {
      maskPathParam.appendChild(keyframesEl);
    }
  }
  keyframesEl.textContent = keyframesText;
};

/**
 * Updates a mask path parameter with explicit keyframes (ticks + base64).
 */
const updateMaskPathWithExplicitKeyframes = (
  maskPathParam: Element,
  keyframes: Array<{ ticks: string; base64: string }>
) => {
  const isTimeVarying = maskPathParam.querySelector("IsTimeVarying");
  if (isTimeVarying) {
    maskPathParam.removeChild(isTimeVarying);
  }

  let startKeyframeValue = maskPathParam.querySelector("StartKeyframeValue");
  if (!startKeyframeValue) {
    startKeyframeValue =
      maskPathParam.ownerDocument.createElement("StartKeyframeValue");
    startKeyframeValue.setAttribute("Encoding", "base64");
    startKeyframeValue.setAttribute(
      "BinaryHash",
      "00000000-0000-0000-0000-000000000000"
    );
    maskPathParam.appendChild(startKeyframeValue);
  }
  if (keyframes.length > 0) {
    startKeyframeValue.textContent = keyframes[0].base64;
  }

  const text = keyframes.map((k) => `${k.ticks},${k.base64}`).join(";") + ";";
  let keyframesEl = maskPathParam.querySelector("Keyframes");
  if (!keyframesEl) {
    keyframesEl = maskPathParam.ownerDocument.createElement("Keyframes");
    const startKeyframePosition =
      maskPathParam.querySelector("StartKeyframePosition");
    if (startKeyframePosition && startKeyframePosition.nextSibling) {
      maskPathParam.insertBefore(keyframesEl, startKeyframePosition.nextSibling);
    } else {
      maskPathParam.appendChild(keyframesEl);
    }
  }
  keyframesEl.textContent = text;
};

/**
 * Locates the VideoComponentChain Components container that lists effect components.
 */
const getVideoComponentChainComponents = (doc: Document): Element | null => {
  const chains = Array.from(doc.querySelectorAll("VideoComponentChain"));
  for (const chain of chains) {
    const components = chain.querySelector("ComponentChain > Components");
    if (components) return components;
  }
  return null;
};

/**
 * Deep-clone a component and all referenced Param object nodes with fresh ObjectIDs.
 * Returns the cloned component and a map from oldParamId -> newParamNode.
 */
const cloneComponentWithParams = (
  doc: Document,
  componentEl: Element,
  allocateId: () => number
): {
  clonedComponent: Element;
  newComponentId: number;
  newParamMap: Map<string, Element>;
} => {
  const root = doc.documentElement;
  const newParamMap = new Map<string, Element>();

  // Clone the component
  const cloned = componentEl.cloneNode(true) as Element;
  const newCompId = allocateId();
  cloned.setAttribute("ObjectID", String(newCompId));

  // Remap Params
  const paramEntries = cloned.querySelectorAll("Component > Params > Param");
  paramEntries.forEach((p) => {
    const oldRef = p.getAttribute("ObjectRef");
    if (!oldRef) return;
    // Clone the referenced node
    const referenced = doc.querySelector(`*[ObjectID="${oldRef}"]`);
    if (!referenced) return;
    const newNode = referenced.cloneNode(true) as Element;
    const newId = allocateId();
    newNode.setAttribute("ObjectID", String(newId));
    root.appendChild(newNode);
    newParamMap.set(oldRef, newNode);
    // Point the Param to new id
    p.setAttribute("ObjectRef", String(newId));
  });

  // Append cloned component to root
  root.appendChild(cloned);
  return { clonedComponent: cloned, newComponentId: newCompId, newParamMap };
};

/**
 * Creates additional Gaussian Blur + AE Mask pairs by cloning a template pair,
 * remapping all ObjectIDs, wiring SubComponents, and returning new mask path param.
 */
const cloneGaussianBlurAndMaskPair = (
  doc: Document,
  templateBlur: Element,
  templateMask: Element,
  allocateId: () => number
): {
  newBlur: Element;
  newMask: Element;
  newMaskPathParam: Element | null;
  newBlurrinessParam: Element | null;
  newMaskFeatherParam: Element | null;
  newMaskExpansionParam: Element | null;
} => {
  // Clone mask first to get its new id
  const {
    clonedComponent: newMask,
    newComponentId: newMaskId,
    newParamMap: newMaskParams,
  } = cloneComponentWithParams(doc, templateMask, allocateId);

  // Find mask path, feather, expansion in cloned params
  let newMaskPathParam: Element | null = null;
  let newMaskFeatherParam: Element | null = null;
  let newMaskExpansionParam: Element | null = null;
  newMaskParams.forEach((node) => {
    const name = node.querySelector("Name")?.textContent?.trim();
    if (node.tagName === "ArbVideoComponentParam" && name === "Mask Path") {
      newMaskPathParam = node;
    } else if (
      node.tagName === "VideoComponentParam" &&
      name === "Mask Feather"
    ) {
      newMaskFeatherParam = node;
    } else if (
      node.tagName === "VideoComponentParam" &&
      name === "Mask Expansion"
    ) {
      newMaskExpansionParam = node;
    }
  });

  // Clone blur component and its params
  const { clonedComponent: newBlur, newParamMap: newBlurParams } =
    cloneComponentWithParams(doc, templateBlur, allocateId);

  // Wire SubComponents to point to the new mask id
  const sub = newBlur.querySelector("SubComponents");
  if (sub) {
    const subComp = sub.querySelector("SubComponent");
    if (subComp) {
      subComp.setAttribute("ObjectRef", String(newMaskId));
    } else {
      // Create if missing
      const newSubComp = doc.createElement("SubComponent");
      newSubComp.setAttribute("Index", "0");
      newSubComp.setAttribute("ObjectRef", String(newMaskId));
      sub.appendChild(newSubComp);
    }
  }

  // Locate blurriness param in cloned blur params
  let newBlurrinessParam: Element | null = null;
  newBlurParams.forEach((node) => {
    const name = node.querySelector("Name")?.textContent?.trim();
    if (node.tagName === "VideoComponentParam" && name === "Blurriness") {
      newBlurrinessParam = node;
    }
  });

  return {
    newBlur,
    newMask,
    newMaskPathParam,
    newBlurrinessParam,
    newMaskFeatherParam,
    newMaskExpansionParam,
  };
};

export interface MaskSpec {
  points: MaskPoint[];
  blurriness?: number;
  feather?: number;
  expansion?: number;
  animate?: boolean;
}

/**
 * Updates multiple mask paths. Updates existing pairs in-order; if more masks than existing,
 * clones template pairs and appends them. Leaves extra pre-existing effects untouched.
 */
export const updateXmlMaskPathsOrAdd = async (
  xmlPath: string,
  masks: Array<{
    base64: string;
    blurriness?: number;
    feather?: number;
    expansion?: number;
    animate?: boolean;
    points?: MaskPoint[];
    keyframes?: Array<{ ticks: string; base64: string }>;
  }>
): Promise<string> => {
  const fileContent = fs.readFileSync(xmlPath, "utf8");
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(fileContent, "text/xml");
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Failed to parse XML: ${parseError.textContent}`);
  }

  // Get ticks per frame from Premiere
  const timeInfo = await evalTSResult("getCTITicksAndTicksPerFrame");
  if (!timeInfo.ok) {
    throw new Error(`Failed to get CTI time info: ${timeInfo.error}`);
  }
  if (typeof timeInfo.data === "string") {
    throw new Error(`Failed to get CTI time info: ${timeInfo.data}`);
  }
  const { ticksPerFrame } = timeInfo.data;

  const existing = findGaussianBlurMaskTuples(xmlDoc);
  const componentsContainer = getVideoComponentChainComponents(xmlDoc);
  if (!componentsContainer) {
    throw new Error(
      "Could not locate VideoComponentChain Components container"
    );
  }

  // Prepare ID allocator
  const usedIds = collectUsedObjectIds(xmlDoc);
  const allocateId = makeObjectIdAllocator(usedIds);

  // Template from the first tuple (if we need to create more)
  const templateTuple = existing[0];

  // Update existing
  const updateCount = Math.min(existing.length, masks.length);
  for (let i = 0; i < updateCount; i++) {
    const tuple = existing[i];
    const spec = masks[i];
    if (tuple.maskPathParam) {
      if (spec.keyframes && spec.keyframes.length > 0) {
        updateMaskPathWithExplicitKeyframes(tuple.maskPathParam, spec.keyframes);
      } else {
        // Use new keyframe-based update instead of just setting StartKeyframeValue
        updateMaskPathWithKeyframes(
          tuple.maskPathParam,
          spec.base64,
          ticksPerFrame,
          spec.animate,
          spec.points
        );
      }
    }
    if (tuple.blurrinessParam && typeof spec.blurriness === "number") {
      setStartKeyframeNumericValue(tuple.blurrinessParam, spec.blurriness);
    }
    if (tuple.maskFeatherParam && typeof spec.feather === "number") {
      setStartKeyframeNumericValue(tuple.maskFeatherParam, spec.feather);
    }
    if (tuple.maskExpansionParam && typeof spec.expansion === "number") {
      setStartKeyframeNumericValue(tuple.maskExpansionParam, spec.expansion);
    }
  }

  // Create additional pairs if needed
  if (masks.length > existing.length) {
    if (!templateTuple) {
      throw new Error(
        "No existing Gaussian Blur + Mask found to use as a cloning template"
      );
    }

    const currentCount =
      componentsContainer.querySelectorAll("Component").length;
    let nextIndex = currentCount;

    for (let i = existing.length; i < masks.length; i++) {
      const spec = masks[i];
      const cloned = cloneGaussianBlurAndMaskPair(
        xmlDoc,
        templateTuple.blurComponent,
        templateTuple.maskComponent,
        allocateId
      );

      // Set values
      if (cloned.newMaskPathParam) {
        if (spec.keyframes && spec.keyframes.length > 0) {
          updateMaskPathWithExplicitKeyframes(cloned.newMaskPathParam, spec.keyframes);
        } else {
          // Use new keyframe-based update for new mask path parameters too
          updateMaskPathWithKeyframes(
            cloned.newMaskPathParam,
            spec.base64,
            ticksPerFrame,
            spec.animate,
            spec.points
          );
        }
      }
      if (cloned.newBlurrinessParam && typeof spec.blurriness === "number") {
        setStartKeyframeNumericValue(
          cloned.newBlurrinessParam,
          spec.blurriness
        );
      }
      if (cloned.newMaskFeatherParam && typeof spec.feather === "number") {
        setStartKeyframeNumericValue(cloned.newMaskFeatherParam, spec.feather);
      }
      if (cloned.newMaskExpansionParam && typeof spec.expansion === "number") {
        setStartKeyframeNumericValue(
          cloned.newMaskExpansionParam,
          spec.expansion
        );
      }

      // Append reference to ComponentChain/Components
      const newCompRef = xmlDoc.createElement("Component");
      newCompRef.setAttribute("Index", String(nextIndex));
      const newBlurId = cloned.newBlur.getAttribute("ObjectID") || "";
      newCompRef.setAttribute("ObjectRef", newBlurId);
      componentsContainer.appendChild(newCompRef);
      nextIndex++;
    }
  }

  // Serialize back to file
  const modifiedXml = serializeXmlDocument(xmlDoc, fileContent);
  const tempDir = os.tmpdir();
  const tempXmlPath = path.join(tempDir, `modified_${path.basename(xmlPath)}`);
  fs.writeFileSync(tempXmlPath, modifiedXml, "utf8");
  return tempXmlPath;
};

/**
 * Creates a tiny mask path that is effectively invisible (1x1 pixel at 0,0)
 * Used for frames where no face detection exists
 */
const createTinyMaskPath = (): MaskPoint[] => {
  // Create a tiny rectangle at (0,0) with minimal size
  // Using a very small size (0.001) so it's effectively invisible
  const size = 0.001;
  return [
    { x: 0, y: 0 }, // Top-left
    { x: size, y: 0 }, // Top-right
    { x: size, y: size }, // Bottom-right
    { x: 0, y: size }, // Bottom-left
  ];
};

const HIDDEN_TINY_EPSILON = 0.002;

const isMaskHidden = (points: MaskPoint[]): boolean => {
  if (!points || points.length === 0) return true;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      continue;
    }
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return true;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const tinyInvisible = width <= HIDDEN_TINY_EPSILON && height <= HIDDEN_TINY_EPSILON;
  if (tinyInvisible) {
    return true;
  }

  const fullyOutsideFrame = maxX <= 0 || minX >= 1 || maxY <= 0 || minY >= 1;
  return fullyOutsideFrame;
};

const compressHiddenRuns = (
  keyframes: Array<{ ticks: string; base64: string; hidden: boolean }>
): Array<{ ticks: string; base64: string }> => {
  if (keyframes.length <= 2) {
    return keyframes.map(({ ticks, base64 }) => ({ ticks, base64 }));
  }

  const out: Array<{ ticks: string; base64: string }> = [];
  let i = 0;
  while (i < keyframes.length) {
    const curr = keyframes[i];
    if (!curr.hidden) {
      out.push({ ticks: curr.ticks, base64: curr.base64 });
      i++;
      continue;
    }

    let j = i;
    while (
      j + 1 < keyframes.length &&
      keyframes[j + 1].hidden &&
      keyframes[j + 1].base64 === curr.base64
    ) {
      j++;
    }

    // Always keep first hidden frame to move mask off-screen.
    out.push({ ticks: curr.ticks, base64: curr.base64 });

    // If a visible frame follows this hidden run, keep one extra hidden hold keyframe.
    const hasVisibleAfter = j + 1 < keyframes.length && !keyframes[j + 1].hidden;
    if (hasVisibleAfter && j > i) {
      out.push({ ticks: keyframes[j].ticks, base64: keyframes[j].base64 });
    }

    i = j + 1;
  }

  return out;
};

/**
 * Build and import a MOGRT from tracked masks with explicit per-frame keyframes.
 * Fills in missing frames with tiny masks to prevent masks from "hanging around".
 */
export const buildAndImportMogrtFromTracks = async (
  tracks: Array<{
    frames: Array<{ frameIndex: number; points: MaskPoint[] }>;
    blurriness?: number;
    feather?: number;
    expansion?: number;
  }>,
  opts: {
    xmlPath?: string;
    ticksPerFrame: string;
    timeInTicks?: string;
    endTicks?: string;
    videoTrackOffset?: number;
    audioTrackOffset?: number;
    numFrames?: number; // Total number of frames in the sequence
  }
): Promise<string> => {
  try {
    // Resolve XML path
    const xmlFilePath = opts.xmlPath ?? getDefaultMaskXmlPath();
    if (!fs.existsSync(xmlFilePath)) {
      return `XML file not found: ${xmlFilePath}`;
    }

    const toTicks = (frameIndex: number) =>
      toFrameAlignedTicks(frameIndex, opts.ticksPerFrame);

    // Determine the frame range
    // Find min and max frame indices across all tracks
    let minFrameIndex = Infinity;
    let maxFrameIndex = -1;
    for (const t of tracks) {
      for (const f of t.frames) {
        minFrameIndex = Math.min(minFrameIndex, f.frameIndex);
        maxFrameIndex = Math.max(maxFrameIndex, f.frameIndex);
      }
    }

    // If no frames found, default to 0
    if (minFrameIndex === Infinity) {
      minFrameIndex = 0;
    }

    // Determine total frame range
    // If numFrames is provided, use it (assumes sequence starts at 0)
    // Otherwise, use the range from min to max frame index
    const startFrame = opts.numFrames !== undefined ? 0 : minFrameIndex;
    const endFrame = opts.numFrames !== undefined 
      ? opts.numFrames - 1
      : maxFrameIndex;

    // Prepare specs - fill in missing frames with tiny masks
    const specs = tracks.map((t) => {
      // Create a map of frameIndex -> points for quick lookup
      const frameMap = new Map<number, MaskPoint[]>();
      t.frames.forEach((f) => {
        frameMap.set(f.frameIndex, f.points);
      });

      // Create keyframes for all frames in the range, then collapse long hidden spans.
      const frameKeyframes: Array<{ ticks: string; base64: string; hidden: boolean }> = [];
      const tinyMaskBase64 = encodeMaskPathToBase64(createTinyMaskPath());

      for (let frameIndex = startFrame; frameIndex <= endFrame; frameIndex++) {
        const points = frameMap.get(frameIndex);
        if (points) {
          // Use actual detection points
          frameKeyframes.push({
            ticks: toTicks(frameIndex),
            base64: encodeMaskPathToBase64(points),
            hidden: isMaskHidden(points),
          });
        } else {
          // Fill with tiny mask for frames without detection
          frameKeyframes.push({
            ticks: toTicks(frameIndex),
            base64: tinyMaskBase64,
            hidden: true,
          });
        }
      }

      const keyframes = compressHiddenRuns(frameKeyframes);

      // Fallback: if no frames at all, create at least one keyframe
      if (keyframes.length === 0) {
        const zero = encodeMaskPathToBase64(createPentagonMaskPath());
        keyframes.push({ ticks: toTicks(0), base64: zero });
      }

      return {
        base64: keyframes[0].base64,
        keyframes,
        blurriness: t.blurriness,
        feather: t.feather,
        expansion: t.expansion,
      };
    });

    const modifiedXmlPath = await updateXmlMaskPathsOrAdd(xmlFilePath, specs);
    const tempDir = os.tmpdir();
    const mogrtPath = await buildMogrtFile(modifiedXmlPath, tempDir);
    const importResult = await evalTSResult(
      "importModifiedMogrt",
      mogrtPath,
      opts.timeInTicks,
      opts.endTicks,
      opts.videoTrackOffset ?? 1,
      opts.audioTrackOffset ?? 0
    );
    const importMessage = importResult.ok
      ? String(importResult.data)
      : importResult.error;
    return `MOGRT built and imported successfully.\nBuild: ${mogrtPath}\nImport: ${importMessage}`;
  } catch (e: any) {
    return `Error in buildAndImportMogrtFromTracks: ${e instanceof Error ? e.message : String(e)}`;
  }
};

/**
 * Main orchestration function to parse, validate, modify, and build MOGRT
 * @param xmlPath Path to the extracted XML file
 * @param points Optional array of mask points. If not provided, uses default pentagon
 * @returns Promise that resolves to the path of the created .mogrt file
 */
export const modifyAndBuildMogrt = async (
  xmlPath: string,
  points?: MaskPoint[]
): Promise<string> => {
  console.log("[modifyAndBuildMogrt] Starting pipeline...");

  // Step 1: Parse and validate mask path
  console.log("[modifyAndBuildMogrt] Step 1: Parsing mask path...");
  const maskPathResult = parseMogrtXmlMaskPath(xmlPath);
  console.log(
    "[modifyAndBuildMogrt] Mask path parsed successfully. Points:",
    maskPathResult.parsedPath?.points.length || 0
  );

  // Step 2: Create and encode mask path
  console.log(
    "[modifyAndBuildMogrt] Step 2: Creating and encoding mask path..."
  );
  const maskPoints = points || createPentagonMaskPath();
  const encodedBase64 = encodeMaskPathToBase64(maskPoints);
  console.log(
    "[modifyAndBuildMogrt] Encoded mask path:",
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
 * Multi-mask orchestration: encodes multiple mask paths and applies settings,
 * updates XML (adding additional blur+mask pairs as needed), builds and imports.
 */
export const buildAndImportMogrtMulti = async (
  xmlPath?: string,
  timeInTicks?: string,
  endTicks?: string,
  videoTrackOffset: number = 1,
  audioTrackOffset: number = 0,
  masks: MaskSpec[] = []
): Promise<string> => {
  try {
    // Resolve XML path
    let xmlFilePath: string;
    if (xmlPath) {
      xmlFilePath = xmlPath;
    } else {
      xmlFilePath = getDefaultMaskXmlPath();
    }
    if (!fs.existsSync(xmlFilePath)) {
      return `XML file not found: ${xmlFilePath}`;
    }

    // Encode all masks
    const encoded = masks.map((m) => ({
      base64: encodeMaskPathToBase64(m.points),
      blurriness: m.blurriness,
      feather: m.feather,
      expansion: m.expansion,
      animate: m.animate,
      points: m.points, // Pass original points for animation generation
    }));

    // Apply to XML (update or add)
    const modifiedXmlPath = await updateXmlMaskPathsOrAdd(xmlFilePath, encoded);

    // Build mogrt
    const tempDir = os.tmpdir();
    const mogrtPath = await buildMogrtFile(modifiedXmlPath, tempDir);

    // Import
    const importResult = await evalTSResult(
      "importModifiedMogrt",
      mogrtPath,
      timeInTicks,
      endTicks,
      videoTrackOffset,
      audioTrackOffset
    );

    const importMessage = importResult.ok
      ? String(importResult.data)
      : importResult.error;
    return `MOGRT built and imported successfully.\nBuild: ${mogrtPath}\nImport: ${importMessage}`;
  } catch (e: any) {
    return `Error in buildAndImportMogrtMulti: ${e instanceof Error ? e.message : String(e)}`;
  }
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
 * @param points Optional array of mask points. If not provided, uses default pentagon
 * @returns Success message or error description
 */
export const buildAndImportMogrt = async (
  xmlPath?: string,
  timeInTicks?: string,
  endTicks?: string,
  videoTrackOffset: number = 1,
  audioTrackOffset: number = 0,
  points?: MaskPoint[]
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
    const mogrtPath = await modifyAndBuildMogrt(xmlFilePath, points);
    console.log("[buildAndImportMogrt] MOGRT built:", mogrtPath);

    // Step 2: Import into Premiere Pro
    console.log(
      "[buildAndImportMogrt] Step 2: Importing MOGRT into Premiere Pro..."
    );
    const importResult = await evalTSResult(
      "importModifiedMogrt",
      mogrtPath,
      timeInTicks,
      endTicks,
      videoTrackOffset,
      audioTrackOffset
    );

    console.log("[buildAndImportMogrt] Pipeline completed");
    const importMessage = importResult.ok
      ? String(importResult.data)
      : importResult.error;
    return `MOGRT built and imported successfully.\nBuild: ${mogrtPath}\nImport: ${importMessage}`;
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
