import { bboxToMaskPoints, type FaceTrack } from "../../lib/utils/faceDetection";
import type { MaskPoint } from "../../lib/utils/mogrt/encoder";
import type { MarkerMaskPayload, UIMask } from "../types";

export function getMaskPointsAtFrame(mask: UIMask, frameIndex: number): MaskPoint[] {
  if (mask.keyframes) {
    if (mask.keyframes[frameIndex]) return mask.keyframes[frameIndex];
    return [];
  }
  return mask.points;
}

export function faceTracksToMasks(tracks: FaceTrack[]): UIMask[] {
  return tracks.map((track, idx) => {
    const keyframes: Record<number, MaskPoint[]> = {};
    track.frames.forEach((frame) => {
      keyframes[frame.frameIndex] = bboxToMaskPoints(frame.bbox);
    });
    const first =
      track.frames.find((frame) => frame.frameIndex === 0) ?? track.frames[0];
    return {
      id: `track_${track.id}`,
      name: `Person ${idx + 1}`,
      points: first ? bboxToMaskPoints(first.bbox) : [],
      blurriness: 50,
      feather: 10,
      expansion: 0,
      keyframes,
    };
  });
}

export function markerMasksToUiMasks(markerMasks: MarkerMaskPayload[]): UIMask[] {
  return markerMasks.map((mask) => ({
    id: mask.id,
    name: mask.name,
    points: mask.points ?? [],
    blurriness: mask.blurriness,
    feather: mask.feather,
    expansion: mask.expansion,
    keyframes: mask.keyframes ?? {},
  }));
}

export function uiMasksToMarkerMasks(masks: UIMask[]): MarkerMaskPayload[] {
  return masks.map((mask) => ({
    id: mask.id,
    name: mask.name,
    points: mask.points,
    blurriness: mask.blurriness ?? 50,
    feather: mask.feather ?? 10,
    expansion: mask.expansion ?? 0,
    keyframes: mask.keyframes ?? {},
  }));
}
