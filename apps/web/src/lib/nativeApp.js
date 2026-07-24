function readCapacitorGlobal() {
  if (typeof window === "undefined") return null;
  return window.Capacitor || null;
}

const NATIVE_APP_IDS = Object.freeze({
  ios: "com.pondbridge.ios",
  android: "com.pondbridge.android"
});

export function getNativePlatform() {
  const capacitor = readCapacitorGlobal();
  if (!capacitor) return "web";

  try {
    if (typeof capacitor.isNativePlatform === "function") {
      if (!capacitor.isNativePlatform()) return "web";
    }
  } catch {
    // Ignore runtime bridge issues and fall back to platform inspection.
  }

  const platform = String(capacitor.getPlatform?.() || "").trim().toLowerCase();
  return platform === "ios" || platform === "android" ? platform : "web";
}

export function getNativeAppId(platform = getNativePlatform()) {
  return NATIVE_APP_IDS[String(platform || "").trim().toLowerCase()] || "";
}

export function isNativeApp() {
  return getNativePlatform() !== "web";
}
