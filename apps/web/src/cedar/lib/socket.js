// src/lib/socket.js
import { io } from "socket.io-client";
import { API_BASE } from "./api";

const SOCKET_URL = API_BASE.replace(/\/api\/t\/[^/]+$/i, "").replace(/\/+$/, "");

function tenantSlugFromPath() {
  const match = window.location.pathname.match(/^\/t\/([^/]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1]);
  return localStorage.getItem("pondbridgeTenantSlug") || "";
}

export function createSocket(token) {
  return io(SOCKET_URL, {
    path: "/socket.io",
    auth: { token, tenantSlug: tenantSlugFromPath() },
    autoConnect: false,
    // ✅ allow WS first, fallback to polling
    transports: ["websocket", "polling"],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    withCredentials: false,
  });
}
