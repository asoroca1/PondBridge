import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext.jsx";
import { useTenant } from "./TenantContext.jsx";
import { requestJson } from "../lib/http.js";
import { isNativeApp } from "../lib/nativeApp.js";
import { normalizeTenantRouteForHost } from "../lib/tenantRouting.js";

const MobileNotificationsContext = createContext({
  supported: false,
  unreadCount: 0,
  items: [],
  loading: false,
  permissionState: "prompt",
  preferences: null,
  refresh: async () => null,
  loadInbox: async () => ({ items: [] }),
  enablePush: async () => "prompt",
  markRead: async () => null,
  markAllRead: async () => null,
  archiveItem: async () => null,
  updatePreferences: async () => null
});

function noop() {}

export function MobileNotificationsProvider({ children }) {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const { token, getAuthToken, isAuthenticated, isReady } = useAuth();
  const supported = isNativeApp();
  const slug = String(tenant?.slug || "").trim().toLowerCase();
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [permissionState, setPermissionState] = useState("prompt");
  const [preferences, setPreferences] = useState(null);

  const request = useCallback(
    async (path, options = {}) => {
      if (!slug) throw new Error("Missing tenant slug");
      return requestJson(`/api/t/${slug}/mobile-notifications${path}`, {
        token,
        getToken: ({ forceRefresh = false } = {}) =>
          typeof getAuthToken === "function" ? getAuthToken({ forceRefresh }) : Promise.resolve(token || ""),
        ...options
      });
    },
    [getAuthToken, slug, token]
  );

  const syncItems = useCallback((payload) => {
    if (!payload || typeof payload !== "object") return;
    if (Array.isArray(payload.items)) setItems(payload.items);
    if (Number.isFinite(Number(payload.unreadCount))) setUnreadCount(Number(payload.unreadCount || 0));
    if (payload.preferences) setPreferences(payload.preferences);
  }, []);

  const refresh = useCallback(async () => {
    if (!supported || !isReady || !isAuthenticated || !slug) return null;
    setLoading(true);
    try {
      const payload = await request("/bootstrap");
      syncItems(payload);
      return payload;
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, isReady, request, slug, supported, syncItems]);

  const loadInbox = useCallback(
    async ({ unreadOnly = false, limit = 40 } = {}) => {
      if (!supported || !isReady || !isAuthenticated || !slug) return { items: [] };
      const payload = await request(`/inbox?limit=${encodeURIComponent(limit)}&unreadOnly=${unreadOnly ? "1" : "0"}`);
      syncItems(payload);
      return payload;
    },
    [isAuthenticated, isReady, request, slug, supported, syncItems]
  );

  const markRead = useCallback(
    async (id) => {
      if (!id) return null;
      const payload = await request("/read", {
        method: "POST",
        body: { id }
      });
      syncItems(payload);
      return payload;
    },
    [request, syncItems]
  );

  const markAllRead = useCallback(async () => {
    const payload = await request("/read-all", { method: "POST" });
    setUnreadCount(Number(payload?.unreadCount || 0));
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
    return payload;
  }, [request]);

  const archiveItem = useCallback(
    async (id) => {
      if (!id) return null;
      const payload = await request("/archive", {
        method: "POST",
        body: { id }
      });
      setUnreadCount(Number(payload?.unreadCount || 0));
      setItems((current) => current.filter((item) => item.id !== id));
      return payload;
    },
    [request]
  );

  const updatePreferences = useCallback(
    async (nextPreferences = {}) => {
      const payload = await request("/preferences", {
        method: "PATCH",
        body: nextPreferences
      });
      if (payload?.preferences) setPreferences(payload.preferences);
      return payload;
    },
    [request]
  );

  const registerDevice = useCallback(
    async (pushToken) => {
      if (!pushToken) return null;
      return request("/devices/register", {
        method: "POST",
        body: {
          token: pushToken,
          platform: "ios",
          appId: "com.pondbridge.ios",
          environment: import.meta.env.DEV ? "sandbox" : "production",
          permissionState: "granted"
        }
      });
    },
    [request]
  );

  const enablePush = useCallback(async () => {
    if (!supported) return "prompt";
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let status = await PushNotifications.checkPermissions();
    if (status.receive === "prompt") {
      status = await PushNotifications.requestPermissions();
    }
    setPermissionState(status.receive || "prompt");
    if (status.receive === "granted") {
      await PushNotifications.register();
    }
    return status.receive || "prompt";
  }, [supported]);

  useEffect(() => {
    if (!supported || !isReady || !isAuthenticated || !slug) {
      setItems([]);
      setUnreadCount(0);
      setPreferences(null);
      return;
    }
    refresh().catch(noop);
    const intervalId = window.setInterval(() => {
      refresh().catch(noop);
    }, 30_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated, isReady, refresh, slug, supported]);

  useEffect(() => {
    if (!supported || !isReady || !isAuthenticated || !slug) return undefined;

    let disposed = false;
    const handles = [];

    async function setup() {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      const registrationHandle = await PushNotifications.addListener("registration", (nextToken) => {
        if (disposed) return;
        setPermissionState("granted");
        registerDevice(nextToken?.value || "")
          .then(() => refresh())
          .catch(noop);
      });
      handles.push(registrationHandle);

      const errorHandle = await PushNotifications.addListener("registrationError", () => {
        if (disposed) return;
      });
      handles.push(errorHandle);

      const receivedHandle = await PushNotifications.addListener("pushNotificationReceived", (notification) => {
        if (disposed) return;
        const notificationId = String(notification?.data?.notificationId || notification?.id || "").trim();
        setItems((current) => [
          {
            id: notificationId || `push-${Date.now()}`,
            title: String(notification?.title || "New notification"),
            body: String(notification?.body || ""),
            kind: String(notification?.data?.kind || "push"),
            category: String(notification?.data?.category || "announcements"),
            deepLink: String(notification?.data?.deepLink || ""),
            data: notification?.data || {},
            delivery: { pushStatus: "received_foreground" },
            readAt: null,
            archivedAt: null,
            openedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          ...current
        ]);
        setUnreadCount((count) => count + 1);
      });
      handles.push(receivedHandle);

      const actionHandle = await PushNotifications.addListener("pushNotificationActionPerformed", (event) => {
        if (disposed) return;
        const data = event?.notification?.data || {};
        const notificationId = String(data.notificationId || event?.notification?.id || "").trim();
        const deepLink = normalizeTenantRouteForHost(slug, String(data.deepLink || "/notifications"));
        if (notificationId) {
          request("/open", {
            method: "POST",
            body: { id: notificationId }
          })
            .then((payload) => {
              if (Number.isFinite(Number(payload?.unreadCount))) {
                setUnreadCount(Number(payload.unreadCount || 0));
              }
            })
            .catch(noop);
        }
        navigate(deepLink || normalizeTenantRouteForHost(slug, "/notifications"));
      });
      handles.push(actionHandle);

      const status = await PushNotifications.checkPermissions();
      if (disposed) return;
      setPermissionState(status.receive || "prompt");
      if (status.receive === "granted") {
        await PushNotifications.register();
      }
    }

    setup().catch(noop);

    return () => {
      disposed = true;
      for (const handle of handles) {
        handle?.remove?.().catch?.(noop);
      }
    };
  }, [isAuthenticated, isReady, navigate, refresh, registerDevice, request, slug, supported]);

  const value = useMemo(
    () => ({
      supported,
      unreadCount,
      items,
      loading,
      permissionState,
      preferences,
      refresh,
      loadInbox,
      enablePush,
      markRead,
      markAllRead,
      archiveItem,
      updatePreferences
    }),
    [
      supported,
      unreadCount,
      items,
      loading,
      permissionState,
      preferences,
      refresh,
      loadInbox,
      enablePush,
      markRead,
      markAllRead,
      archiveItem,
      updatePreferences
    ]
  );

  return <MobileNotificationsContext.Provider value={value}>{children}</MobileNotificationsContext.Provider>;
}

export function useMobileNotifications() {
  return useContext(MobileNotificationsContext);
}
