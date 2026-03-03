const DEFAULT_BETA_EXPIRES_AT_ISO = "2026-04-01T00:00:00Z";

export const BETA_EXPIRES_AT_ISO =
  import.meta.env.VITE_BETA_EXPIRES_AT ?? DEFAULT_BETA_EXPIRES_AT_ISO;

export function isBetaLocked(nowMs: number = Date.now()): boolean {
  const expiresAtMs = Date.parse(BETA_EXPIRES_AT_ISO);
  if (Number.isNaN(expiresAtMs)) {
    return !import.meta.env.DEV;
  }
  return nowMs >= expiresAtMs;
}

export function getBetaExpiryLabel(): string {
  const expiresAtMs = Date.parse(BETA_EXPIRES_AT_ISO);
  if (Number.isNaN(expiresAtMs)) {
    return BETA_EXPIRES_AT_ISO;
  }
  return new Date(expiresAtMs).toUTCString();
}
