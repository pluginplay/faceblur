import { evalTS } from "./bolt";
import type { Scripts } from "@esTypes/index";

type ArgTypes<F extends Function> = F extends (...args: infer A) => any
  ? A
  : never;
type Return<F extends Function> = F extends (...args: any[]) => infer R ? R : never;

export type BridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; raw?: unknown };

const toErrorMessage = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0) return msg;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const evalTSResult = async <
  Key extends string & keyof Scripts,
  Func extends Function & Scripts[Key],
>(
  functionName: Key,
  ...args: ArgTypes<Func>
): Promise<BridgeResult<Return<Func>>> => {
  try {
    const data = await evalTS(functionName, ...args);
    return { ok: true, data: data as Return<Func> };
  } catch (error: unknown) {
    return {
      ok: false,
      error: toErrorMessage(error),
      raw: error,
    };
  }
};
