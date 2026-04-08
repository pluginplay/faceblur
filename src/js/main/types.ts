import type { MaskPoint } from "../lib/utils/mogrt/encoder";

export interface UIMask {
  id: string;
  name: string;
  points: MaskPoint[];
  blurriness?: number;
  feather?: number;
  expansion?: number;
  keyframes?: Record<number, MaskPoint[]>;
}

export interface Dimensions {
  width: number;
  height: number;
}

export interface TimelineViewport {
  startFrameIndex: number;
  endFrameIndex: number;
}

export interface SegmentDescriptor {
  segmentId: string;
  startTicks: string;
  endTicks: string;
  ticksPerFrame: string;
  numFrames: number;
  trackIndex?: number;
  clipName?: string;
}

export interface MarkerMaskPayload {
  id: string;
  name: string;
  points: MaskPoint[];
  blurriness: number;
  feather: number;
  expansion: number;
  keyframes: Record<number, MaskPoint[]>;
}

export interface MarkerPayload {
  kind: "face-blur-segment";
  schemaVersion: 1;
  segment: SegmentDescriptor;
  pngDir: string;
  masks: MarkerMaskPayload[];
  createdAt: string;
  updatedAt: string;
}

export interface LoadedSegmentState {
  markerGuid: string;
  segment: SegmentDescriptor;
  pngDir: string;
}

export interface BatchJobState {
  running: boolean;
  totalSegments: number;
  completedSegments: number;
}
