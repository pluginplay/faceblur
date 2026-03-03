const WELCOME_COOKIE_PREFIX = "faceblur_welcome_seen_v";
const WELCOME_COOKIE_VALUE = "1";
const COOKIE_PERSIST_DAYS = 3650;

type WelcomeVersion = string | number;

interface WelcomeDialogPersistenceOptions {
  version?: WelcomeVersion;
  isDev?: boolean;
  alwaysShowInDev?: boolean;
}

function getWelcomeStorageKey(version?: WelcomeVersion): string {
  const normalized = String(version ?? "1").trim() || "1";
  return `${WELCOME_COOKIE_PREFIX}${normalized}`;
}

function readCookieValue(key: string): string | null {
  if (typeof document === "undefined") return null;
  const encodedKey = encodeURIComponent(key);
  const cookies = document.cookie ? document.cookie.split("; ") : [];
  for (const cookie of cookies) {
    const eqIndex = cookie.indexOf("=");
    if (eqIndex < 0) continue;
    const rawKey = cookie.slice(0, eqIndex);
    if (rawKey !== encodedKey) continue;
    const rawValue = cookie.slice(eqIndex + 1);
    return decodeURIComponent(rawValue);
  }
  return null;
}

export function hasSeenWelcomeDialog(
  options: WelcomeDialogPersistenceOptions = {},
): boolean {
  const {
    version = "1",
    isDev = false,
    alwaysShowInDev = false,
  } = options;

  if (isDev && alwaysShowInDev) {
    return false;
  }

  const storageKey = getWelcomeStorageKey(version);

  if (readCookieValue(storageKey) === WELCOME_COOKIE_VALUE) {
    return true;
  }
  try {
    return window.localStorage.getItem(storageKey) === WELCOME_COOKIE_VALUE;
  } catch {
    return false;
  }
}

export function markWelcomeDialogSeen(
  options: WelcomeDialogPersistenceOptions = {},
): void {
  const { version = "1" } = options;
  const storageKey = getWelcomeStorageKey(version);
  const expiresAt = new Date(
    Date.now() + COOKIE_PERSIST_DAYS * 24 * 60 * 60 * 1000,
  ).toUTCString();
  const encodedKey = encodeURIComponent(storageKey);
  const encodedValue = encodeURIComponent(WELCOME_COOKIE_VALUE);

  if (typeof document !== "undefined") {
    document.cookie = `${encodedKey}=${encodedValue}; expires=${expiresAt}; path=/; SameSite=Lax`;
  }

  // Fallback for hosts where CEP cookie persistence is restricted.
  try {
    window.localStorage.setItem(storageKey, WELCOME_COOKIE_VALUE);
  } catch {
    // noop
  }
}
