import { ParsedMaskPath } from "../prfpset";

export interface MogrtMaskPathResult {
  hasKeyframes: boolean;
  maskPathParam: Element;
  startValue?: Uint8Array;
  startPosition?: number;
  parsedPath?: ParsedMaskPath;
}

export interface IOpenDialogResult {
  data: string[];
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export interface ZipOptions {
  forceZip64?: boolean;
  zlibLevel?: number;
}
