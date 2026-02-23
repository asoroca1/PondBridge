export const STORAGE_KEYS = {
  token: "pondbridgeToken",
  user: "pondbridgeUser",
  legacyToken: "token",
  legacyUser: "user"
};

export function readAuthFromStorage() {
  const token =
    localStorage.getItem(STORAGE_KEYS.token) || localStorage.getItem(STORAGE_KEYS.legacyToken) || "";
  const rawUser =
    localStorage.getItem(STORAGE_KEYS.user) || localStorage.getItem(STORAGE_KEYS.legacyUser) || "";
  let user = null;
  try {
    user = rawUser ? JSON.parse(rawUser) : null;
  } catch {
    user = null;
  }
  return { token, user };
}

export function writeAuthToStorage(token, user) {
  localStorage.setItem(STORAGE_KEYS.token, token || "");
  localStorage.setItem(STORAGE_KEYS.legacyToken, token || "");
  if (user) {
    const serialized = JSON.stringify(user);
    localStorage.setItem(STORAGE_KEYS.user, serialized);
    localStorage.setItem(STORAGE_KEYS.legacyUser, serialized);
  }
  window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
}

export function clearAuthStorage() {
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.user);
  localStorage.removeItem(STORAGE_KEYS.legacyToken);
  localStorage.removeItem(STORAGE_KEYS.legacyUser);
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
