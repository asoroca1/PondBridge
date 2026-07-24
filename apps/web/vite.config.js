import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoEnvPath = path.resolve(__dirname, "../../.env");
const webEnvPath = path.resolve(__dirname, ".env");
const isLocalStaging = process.env.PONDBRIDGE_LOCAL_STAGING === "1";

// Make root .env (Cloudflare/Clerk shared config) available to web builds,
// then allow apps/web/.env to fill in anything not present there.
// .env.local (git-ignored) can override any value for local development,
// but should not leak into production/native bundles.
const webEnvLocalPath = path.resolve(__dirname, ".env.local");
if (!isLocalStaging) {
  dotenv.config({ path: repoEnvPath, override: false });
  dotenv.config({ path: webEnvPath, override: false });
}

const envFallbackMap = {
  VITE_AUTH_PROVIDER: "AUTH_PROVIDER",
  VITE_CLERK_PUBLISHABLE_KEY: "CLERK_PUBLISHABLE_KEY",
  VITE_API_BASE: "API_BASE",
  VITE_APP_BASE_DOMAIN: "APP_BASE_DOMAIN"
};

for (const [viteKey, sharedKey] of Object.entries(envFallbackMap)) {
  if (!process.env[viteKey] && process.env[sharedKey]) {
    process.env[viteKey] = process.env[sharedKey];
  }
}

export default defineConfig(({ command }) => {
  if (command === "serve" && !isLocalStaging) {
    dotenv.config({ path: webEnvLocalPath, override: true });

    for (const [viteKey, sharedKey] of Object.entries(envFallbackMap)) {
      if (!process.env[viteKey] && process.env[sharedKey]) {
        process.env[viteKey] = process.env[sharedKey];
      }
    }
  }

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      hmr: isLocalStaging ? false : undefined
    },
    build: {
      // The map route intentionally carries a heavy map engine bundle behind lazy routing.
      // Raise warning threshold so CI surfaces actionable regressions instead of known route-isolated size.
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/maplibre-gl")) return "vendor-maplibre";
            if (id.includes("node_modules/@clerk")) return "vendor-clerk";
            return null;
          }
        }
      }
    }
  };
});
