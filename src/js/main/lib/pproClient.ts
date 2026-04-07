import { evalTSResult, type BridgeResult } from "../../lib/utils/bridge";
import type { MarkerPayload, SegmentDescriptor } from "../types";

type SegmentExportResult = {
  outputDir: string;
  baseName: string;
  count: number;
};

type MarkerUpsertResult = {
  markerGuid: string;
  replacedCount: number;
};

type MarkerAtCTIResult =
  | { found: false }
  | { found: true; markerGuid: string; payload: MarkerPayload };

const asError = <T>(error: string, raw?: unknown): BridgeResult<T> => ({
  ok: false,
  error,
  raw,
});

export const getSelectedClipSegments = async (): Promise<
  BridgeResult<SegmentDescriptor[]>
> => {
  const result = await evalTSResult("getSelectedClipSegments");
  if (!result.ok) return result;

  if (typeof result.data === "string") {
    return asError(result.data, result.data);
  }
  if (!Array.isArray(result.data)) {
    return asError("Invalid segment payload from ExtendScript.", result.data);
  }
  return { ok: true, data: result.data as SegmentDescriptor[] };
};

export const exportSegmentAsImageSequence = async (
  segment: SegmentDescriptor,
  folder: string,
): Promise<BridgeResult<SegmentExportResult>> => {
  const result = await evalTSResult("exportSegmentAsImageSequence", segment, folder);
  if (!result.ok) return result;

  if (typeof result.data === "string") {
    return asError(result.data, result.data);
  }
  if (!result.data || typeof result.data !== "object") {
    return asError("Invalid export payload from ExtendScript.", result.data);
  }

  const data = result.data as SegmentExportResult;
  if (!data.outputDir || typeof data.outputDir !== "string") {
    return asError("Missing outputDir in export payload.", result.data);
  }
  return { ok: true, data };
};

export const upsertSegmentMarker = async (
  payload: MarkerPayload,
): Promise<BridgeResult<MarkerUpsertResult>> => {
  const result = await evalTSResult("upsertSegmentMarker", payload);
  if (!result.ok) return result;

  if (typeof result.data === "string") {
    return asError(result.data, result.data);
  }
  if (
    !result.data ||
    typeof result.data !== "object" ||
    typeof (result.data as MarkerUpsertResult).markerGuid !== "string"
  ) {
    return asError("Invalid marker upsert payload.", result.data);
  }
  return { ok: true, data: result.data as MarkerUpsertResult };
};

export const findOwnedMarkerAtCTI = async (): Promise<
  BridgeResult<MarkerAtCTIResult>
> => {
  const result = await evalTSResult("findOwnedMarkerAtCTI");
  if (!result.ok) return result;

  if (typeof result.data === "string") {
    return asError(result.data, result.data);
  }
  if (!result.data || typeof result.data !== "object") {
    return asError("Invalid marker lookup payload.", result.data);
  }
  return { ok: true, data: result.data as MarkerAtCTIResult };
};
