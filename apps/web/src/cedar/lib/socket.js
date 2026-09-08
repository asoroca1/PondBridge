// src/lib/socket.js
import { io } from "socket.io-client";
import { API_BASE } from "../../lib/http.js";
import { getToken } from "./helpers.js";
import { getVolatileAuthToken } from "../../lib/authMemory.js";
import { whenAuthSettled } from "../../lib/authReadiness.js";

const SOCKET_URL = API_BASE.replace(/\/+$/, "").replace(/\/api$/i, "");

function tenantSlugFromPath() {
  const match = window.location.pathname.match(/^\/t\/([^/]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return localStorage.getItem("pondbridgeTenantSlug") || "";
}

export function createSocket() {
  return io(SOCKET_URL, {
    path: "/socket.io",
    // Resolve credentials for every handshake, after the app restores its session.
    // A token captured while the page mounts can already be stale at connection time.
    auth: async (done) => {
      await whenAuthSettled();
      let token = getVolatileAuthToken() || getToken() || "";
      try {
        token = (await window.Clerk?.session?.getToken({ skipCache: true })) || token;
      } catch {
        // Legacy sessions use the current in-memory token instead of Clerk.
      }
      done({ token, tenantSlug: tenantSlugFromPath() });
    },
    autoConnect: false,
    // Try polling too when a network/browser blocks WebSockets.
    transports: ["websocket", "polling"],
    tryAllTransports: true,
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    withCredentials: false,
  });
}

// Namespace authentication failures do not trigger Socket.IO's transport retry.
// Retry once with newly resolved credentials, without creating an endless auth loop.
export function attachSocketStatus(socket, onStatus) {
  let retried = false;
  let retryTimer;
  const onConnect = () => {
    clearTimeout(retryTimer);
    retried = false;
    onStatus("connected");
  };
  const onDisconnect = () => onStatus("reconnecting");
  const onConnectError = () => {
    if (socket.active) {
      onStatus("reconnecting");
      return;
    }
    if (retried) {
      onStatus("unavailable");
      return;
    }
    retried = true;
    onStatus("reconnecting");
    retryTimer = setTimeout(() => socket.connect(), 1000);
  };
  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  socket.on("connect_error", onConnectError);
  return () => {
    clearTimeout(retryTimer);
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("connect_error", onConnectError);
  };
}
