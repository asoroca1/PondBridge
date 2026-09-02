// The native shells load the live PondBridge web app rather than bundled assets,
// so a feature shipped to web reaches iOS without an App Store release. Point
// PONDBRIDGE_APP_URL at another origin to build a shell against staging or a LAN
// dev server; a physical device can never reach localhost, so use the machine's
// LAN address (for example http://192.168.1.20:5174).

const DEFAULT_APP_URL = "https://app.pondbridgealumni.com";

const appUrl = String(process.env.PONDBRIDGE_APP_URL || "").trim() || DEFAULT_APP_URL;

let parsedAppUrl;
try {
  parsedAppUrl = new URL(appUrl);
} catch {
  throw new Error(`[capacitor.config] PONDBRIDGE_APP_URL is not a valid URL: ${appUrl}`);
}

const isPlainHttp = parsedAppUrl.protocol === "http:";
if (
  isPlainHttp &&
  parsedAppUrl.hostname !== "localhost" &&
  !/^\d+\.\d+\.\d+\.\d+$/.test(parsedAppUrl.hostname)
) {
  throw new Error(
    `[capacitor.config] Refusing to build a shell against insecure ${appUrl}. ` +
      "Plain http is only allowed for localhost and LAN addresses during development."
  );
}

if (appUrl !== DEFAULT_APP_URL) {
  console.warn(`[capacitor.config] Building native shell against ${appUrl} (not production).`);
}

module.exports = {
  appId: "com.pondbridge.ios",
  appName: "PondBridge",
  webDir: "../web/dist",
  bundledWebRuntime: false,
  server: {
    url: appUrl,
    iosScheme: "https",
    // Shown when the remote app cannot be reached, including a first-ever cold
    // start with no connectivity. Served from the bundled webDir, so
    // `npm run ios:sync` must run before any release build.
    errorPath: "offline.html",
    // Required for a debug build against an http LAN origin; the App Transport
    // Security exception must never be present in a production shell.
    ...(isPlainHttp ? { cleartext: true } : {}),
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    StatusBar: {
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#002b5c",
    },
  },
};
