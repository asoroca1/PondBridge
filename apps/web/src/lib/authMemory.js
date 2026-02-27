let volatileAuthToken = "";

function normalizeToken(value = "") {
  return String(value || "").trim();
}

export function setVolatileAuthToken(token = "") {
  volatileAuthToken = normalizeToken(token);
}

export function getVolatileAuthToken() {
  return volatileAuthToken;
}

export function clearVolatileAuthToken() {
  volatileAuthToken = "";
}
