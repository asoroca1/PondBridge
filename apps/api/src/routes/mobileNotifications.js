import { Router } from "express";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import { sanitizeText } from "../utils/sanitize.js";
import {
  archiveMobileNotifications,
  countUnreadMobileNotifications,
  getOrCreateUserMobileNotificationPreferences,
  listUserMobileNotifications,
  markAllMobileNotificationsRead,
  markMobileNotificationsRead,
  normalizeTenantMobileNotificationPrefs,
  noteMobileNotificationOpened,
  registerMobileDevice,
  touchMobileDevicesForUser,
  updateUserMobileNotificationPreferences
} from "../services/mobileNotifications.js";

const router = Router({ mergeParams: true });

router.use(...requireTenantAuthScope);

router.get("/bootstrap", async (req, res) => {
  await touchMobileDevicesForUser(req.tenant._id, req.user.id);
  const [items, unreadCount, preferences] = await Promise.all([
    listUserMobileNotifications(req.tenant._id, req.user.id, { limit: 20 }),
    countUnreadMobileNotifications(req.tenant._id, req.user.id),
    getOrCreateUserMobileNotificationPreferences(req.tenant._id, req.user.id)
  ]);

  return res.json({
    items,
    unreadCount,
    preferences,
    tenantPreferences: normalizeTenantMobileNotificationPrefs(req.tenant.notificationPrefs || {})
  });
});

router.get("/inbox", async (req, res) => {
  const unreadOnly = String(req.query.unreadOnly || "").trim() === "1";
  const items = await listUserMobileNotifications(req.tenant._id, req.user.id, {
    limit: req.query.limit || 40,
    unreadOnly
  });
  const unreadCount = await countUnreadMobileNotifications(req.tenant._id, req.user.id);
  return res.json({ items, unreadCount });
});

router.post("/devices/register", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) {
    return res.status(400).json({
      error: { code: "TOKEN_REQUIRED", message: "Push token is required." }
    });
  }

  const device = await registerMobileDevice({
    tenantId: req.tenant._id,
    userId: req.user.id,
    token,
    platform: String(req.body?.platform || "ios").trim().toLowerCase() || "ios",
    appId: String(req.body?.appId || "").trim(),
    environment: String(req.body?.environment || "").trim().toLowerCase() || "sandbox",
    permissionState: String(req.body?.permissionState || "granted").trim().toLowerCase() || "granted"
  });

  return res.json({
    ok: true,
    device: {
      id: String(device._id || device.id || ""),
      platform: String(device.platform || ""),
      permissionState: String(device.permissionState || ""),
      lastRegisteredAt: device.lastRegisteredAt || null
    }
  });
});

router.patch("/preferences", async (req, res) => {
  const preferences = await updateUserMobileNotificationPreferences(req.tenant._id, req.user.id, {
    pushEnabled: req.body?.pushEnabled,
    categories: req.body?.categories || {}
  });
  return res.json({ ok: true, preferences });
});

router.post("/read", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : req.body?.id ? [req.body.id] : [];
  const items = await markMobileNotificationsRead(req.tenant._id, req.user.id, ids);
  const unreadCount = await countUnreadMobileNotifications(req.tenant._id, req.user.id);
  return res.json({ ok: true, items, unreadCount });
});

router.post("/read-all", async (req, res) => {
  const count = await markAllMobileNotificationsRead(req.tenant._id, req.user.id);
  return res.json({ ok: true, updatedCount: count, unreadCount: 0 });
});

router.post("/archive", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : req.body?.id ? [req.body.id] : [];
  const items = await archiveMobileNotifications(req.tenant._id, req.user.id, ids);
  const unreadCount = await countUnreadMobileNotifications(req.tenant._id, req.user.id);
  return res.json({ ok: true, items, unreadCount });
});

router.post("/open", async (req, res) => {
  const id = sanitizeText(String(req.body?.id || "").trim());
  if (!id) {
    return res.status(400).json({
      error: { code: "ID_REQUIRED", message: "Notification id is required." }
    });
  }

  const item = await noteMobileNotificationOpened(req.tenant._id, req.user.id, id);
  if (!item) {
    return res.status(404).json({
      error: { code: "NOTIFICATION_NOT_FOUND", message: "Notification not found." }
    });
  }

  const unreadCount = await countUnreadMobileNotifications(req.tenant._id, req.user.id);
  return res.json({ ok: true, item, unreadCount });
});

export default router;
