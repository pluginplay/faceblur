// Shared Types for Effects

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface EffectPropertyKeyframe {
  time: number;
  interpolationType?: number;
  [propertyName: string]:
    | number
    | boolean
    | [number, number]
    | RgbColor
    | undefined;
}

export interface EffectDataItem {
  effectMatchName: string;
  staticProperties?: {
    [propertyName: string]: number | boolean | [number, number] | RgbColor;
  };
  keyframes?: EffectPropertyKeyframe[];
}

export type EffectData = EffectDataItem[];
