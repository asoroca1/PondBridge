import { isNativeApp } from "./nativeApp.js";

export async function openExternalUrl(value = "") {
  const url = String(value || "").trim();
  if (!url || typeof window === "undefined") return false;

  if (isNativeApp() && /^https?:\/\//i.test(url)) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url, presentationStyle: "popover" });
    return true;
  }

  const popup = window.open(url, "_blank", "noopener,noreferrer");
  return Boolean(popup);
}
