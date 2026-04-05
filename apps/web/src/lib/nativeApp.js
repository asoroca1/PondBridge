function readCapacitorGlobal() {
  if (typeof window === "undefined") return null;
  return window.Capacitor || null;
}

export function isNativeApp() {
  const capacitor = readCapacitorGlobal();
  if (!capacitor) return false;

  try {
    if (typeof capacitor.isNativePlatform === "function") {
      return Boolean(capacitor.isNativePlatform());
    }
  } catch {
    // Ignore runtime bridge issues and fall back to platform inspection.
  }

  const platform = String(capacitor.getPlatform?.() || "").trim().toLowerCase();
  return platform === "ios" || platform === "android";
}
