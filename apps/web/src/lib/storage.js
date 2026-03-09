import { clearVolatileAuthToken, getVolatileAuthToken, setVolatileAuthToken } from "./authMemory.js";

export const STORAGE_KEYS = {
  user: "pondbridgeUser",
  legacyUser: "user",
  sessionToken: "pondbridgeSessionToken",
  legacyToken: "token",
  legacyPondbridgeToken: "pondbridgeToken",
  legacyCedarToken: "cedarToken"
};

function readStorageValue(storage, key) {
  try {
    return String(storage?.getItem?.(key) || "").trim();
  } catch {
    return "";
  }
}

function writeSessionToken(value = "") {
  try {
    if (value) {
      sessionStorage.setItem(STORAGE_KEYS.sessionToken, value);
    } else {
      sessionStorage.removeItem(STORAGE_KEYS.sessionToken);
    }
  } catch {
    // Ignore private mode / quota errors.
  }
}

export function readAuthFromStorage() {
  const token =
    getVolatileAuthToken() ||
    readStorageValue(sessionStorage, STORAGE_KEYS.sessionToken) ||
    readStorageValue(localStorage, STORAGE_KEYS.legacyPondbridgeToken) ||
    readStorageValue(localStorage, STORAGE_KEYS.legacyToken) ||
    readStorageValue(localStorage, STORAGE_KEYS.legacyCedarToken);
  if (token) {
    setVolatileAuthToken(token);
    writeSessionToken(token);
  }
  const rawUser =
    readStorageValue(localStorage, STORAGE_KEYS.user) ||
    readStorageValue(localStorage, STORAGE_KEYS.legacyUser) ||
    "";
  let user = null;
  try {
    user = rawUser ? JSON.parse(rawUser) : null;
  } catch {
    user = null;
  }
  return { token, user };
}

export function writeAuthToStorage(token, user) {
  const normalizedToken = String(token || "").trim();
  setVolatileAuthToken(normalizedToken);
  writeSessionToken(normalizedToken);
  if (user) {
    const serialized = JSON.stringify(user);
    localStorage.setItem(STORAGE_KEYS.user, serialized);
    localStorage.setItem(STORAGE_KEYS.legacyUser, serialized);
  } else {
    localStorage.removeItem(STORAGE_KEYS.user);
    localStorage.removeItem(STORAGE_KEYS.legacyUser);
  }
  window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
}

export function clearAuthStorage() {
  clearVolatileAuthToken();
  writeSessionToken("");
  localStorage.removeItem(STORAGE_KEYS.user);
  localStorage.removeItem(STORAGE_KEYS.legacyUser);
  localStorage.removeItem(STORAGE_KEYS.legacyPondbridgeToken);
  localStorage.removeItem(STORAGE_KEYS.legacyToken);
  localStorage.removeItem(STORAGE_KEYS.legacyCedarToken);
  window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
}

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

function wizardDraftKey(slug) {
  return `pondbridge-wizard-draft-${slug}`;
}

export function readWizardDraft(slug) {
  try {
    const raw = localStorage.getItem(wizardDraftKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.savedAt) return null;
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      localStorage.removeItem(wizardDraftKey(slug));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeWizardDraft(slug, data) {
  try {
    localStorage.setItem(
      wizardDraftKey(slug),
      JSON.stringify({ ...data, savedAt: Date.now() })
    );
  } catch {
    /* quota exceeded — ignore */
  }
}

export function clearWizardDraft(slug) {
  try {
    localStorage.removeItem(wizardDraftKey(slug));
  } catch {
    /* ignore */
  }
}
