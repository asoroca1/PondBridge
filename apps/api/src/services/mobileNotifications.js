import crypto from "crypto";
import http2 from "http2";
import { env } from "../config/env.js";
import {
  hasFcmHttpV1Configuration,
  sendFcmHttpV1Message
} from "./fcmHttpV1.js";
import {
  MobileNotificationDeviceModel,
  MobileNotificationModel,
  MobileNotificationPreferenceModel,
  MobileNotificationScheduleModel,
  ProfileModel,
  TenantModel,
  UserModel
} from "../db/models/index.js";

export const DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS = {
  mobileEnabled: true,
  pushEnabled: true,
  inboxEnabled: true,
  newMemberJoined: true,
  approvalRequests: true,
  memberFlagged: true,
  eventPublished: true,
  eventCanceled: true,
  newsletterPublished: true,
  customBroadcasts: true,
  weeklySummary: false,
  soundEnabled: true
};

export const DEFAULT_USER_MOBILE_NOTIFICATION_PREFERENCES = {
  pushEnabled: true,
  categories: {
    announcements: true,
    events: true,
    community: true,
    account: true,
    admin: true
  }
};

const PUSHABLE_CATEGORIES = new Set(["announcements", "events", "community", "account", "admin"]);
const PERMANENT_APNS_ERRORS = new Set(["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"]);
const AUTOMATIC_NOTIFICATION_PREF_BY_KIND = new Map([
  ["member_joined", "newMemberJoined"],
  ["approval_request_submitted", "approvalRequests"],
  ["member_flagged", "memberFlagged"],
  ["content_report_created", "memberFlagged"]
]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeBoolean(value, fallback = false) {
  return value === undefined ? fallback : Boolean(value);
}

function normalizeText(value = "", max = 240) {
  return String(value || "").trim().slice(0, max);
}

function normalizeLongText(value = "", max = 1200) {
  return String(value || "").trim().slice(0, max);
}

function normalizeDeepLink(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw;

  try {
    const parsed = new URL(raw);
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return "";
  }
}

function normalizeCategory(value = "", fallback = "announcements") {
  const category = String(value || "").trim().toLowerCase();
  return PUSHABLE_CATEGORIES.has(category) ? category : fallback;
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizedApnsPrivateKey() {
  return String(env.APNS_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
}

function hasApnsConfiguration() {
  return Boolean(
    env.APNS_KEY_ID &&
      env.APNS_TEAM_ID &&
      env.APNS_BUNDLE_ID &&
      normalizedApnsPrivateKey()
  );
}

function createApnsJwt() {
  const header = base64UrlEncode(
    JSON.stringify({
      alg: "ES256",
      kid: env.APNS_KEY_ID
    })
  );
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: env.APNS_TEAM_ID,
      iat: Math.floor(Date.now() / 1000)
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: normalizedApnsPrivateKey(),
    dsaEncoding: "ieee-p1363"
  });
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

function toNotificationClient(row = {}) {
  return {
    id: String(row._id || row.id || ""),
    title: String(row.title || ""),
    body: String(row.body || ""),
    kind: String(row.kind || ""),
    category: normalizeCategory(row.category),
    deepLink: normalizeDeepLink(row.deepLink || row?.data?.deepLink || ""),
    data: isObject(row.data) ? row.data : {},
    delivery: isObject(row.delivery) ? row.delivery : {},
    readAt: row.readAt || null,
    archivedAt: row.archivedAt || null,
    openedAt: row.openedAt || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function createBatchId(prefix = "mobile") {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function mapByUserId(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const userId = String(row?.userId || "").trim();
    if (!userId) continue;
    const current = map.get(userId) || [];
    current.push(row);
    map.set(userId, current);
  }
  return map;
}

function chunk(values = [], size = 10) {
  const out = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

async function runWithConcurrency(items = [], worker, concurrency = 6) {
  const results = [];
  for (const slice of chunk(items, concurrency)) {
    const batch = await Promise.all(slice.map((item) => worker(item)));
    results.push(...batch);
  }
  return results;
}

async function sendApnsAlert({
  token,
  title,
  body,
  category,
  deepLink,
  data = {},
  soundEnabled = true
}) {
  if (!hasApnsConfiguration()) {
    return { ok: false, status: "skipped_no_provider", error: "APNS not configured", permanent: false };
  }

  const client = http2.connect(
    env.APNS_USE_SANDBOX ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com"
  );

  try {
    const payload = JSON.stringify({
      aps: {
        alert: {
          title: normalizeText(title, 120),
          body: normalizeLongText(body, 240)
        },
        sound: soundEnabled ? "default" : undefined
      },
      category,
      deepLink,
      ...data
    });

    const response = await new Promise((resolve, reject) => {
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${createApnsJwt()}`,
        "apns-topic": env.APNS_BUNDLE_ID,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json"
      });

      let bodyText = "";
      let headers = {};

      request.setEncoding("utf8");
      request.on("response", (nextHeaders) => {
        headers = nextHeaders;
      });
      request.on("data", (chunkValue) => {
        bodyText += chunkValue;
      });
      request.on("end", () => {
        resolve({ headers, bodyText });
      });
      request.on("error", reject);
      request.write(payload);
      request.end();
    });

    const statusCode = Number(response?.headers?.[":status"] || 0);
    const bodyPayload = response?.bodyText ? JSON.parse(response.bodyText || "{}") : {};
    const reason = String(bodyPayload?.reason || "");

    if (statusCode >= 200 && statusCode < 300) {
      return { ok: true, status: "delivered", error: "", permanent: false };
    }

    return {
      ok: false,
      status: "failed",
      error: reason || `APNS ${statusCode || "unknown"}`,
      permanent: PERMANENT_APNS_ERRORS.has(reason)
    };
  } finally {
    client.close();
  }
}

function hasFcmConfiguration() {
  return hasFcmHttpV1Configuration({
    projectId: env.FCM_PROJECT_ID,
    clientEmail: env.FCM_CLIENT_EMAIL,
    privateKey: env.FCM_PRIVATE_KEY
  });
}

export function getMobileNotificationProviderStatus() {
  const apnsConfigured = hasApnsConfiguration();
  const fcmConfigured = hasFcmConfiguration();
  return {
    available: apnsConfigured || fcmConfigured,
    apnsConfigured,
    fcmConfigured,
    fcmProtocol: "http_v1"
  };
}

async function sendFcmAlert({
  token,
  title,
  body,
  category,
  deepLink,
  data = {},
  soundEnabled = true
}) {
  if (!hasFcmConfiguration()) {
    return { ok: false, status: "skipped_no_provider", error: "FCM not configured", permanent: false };
  }

  try {
    return await sendFcmHttpV1Message({
      config: {
        projectId: env.FCM_PROJECT_ID,
        clientEmail: env.FCM_CLIENT_EMAIL,
        privateKey: env.FCM_PRIVATE_KEY
      },
      token,
      title: normalizeText(title, 120),
      body: normalizeLongText(body, 240),
      soundEnabled,
      data: {
        category: String(category || ""),
        deepLink: String(deepLink || ""),
        ...Object.fromEntries(
          Object.entries(isObject(data) ? data : {}).map(([key, value]) => [key, String(value ?? "")])
        )
      }
    });
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      error: String(error?.message || "FCM send failed"),
      permanent: false
    };
  }
}

async function updateNotificationDelivery(notificationId, delivery = {}) {
  return MobileNotificationModel.update(notificationId, {
    delivery
  });
}

export function normalizeTenantMobileNotificationPrefs(value = {}) {
  const source = isObject(value) ? value : {};
  return {
    ...DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS,
    mobileEnabled: normalizeBoolean(source.mobileEnabled, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.mobileEnabled),
    pushEnabled: normalizeBoolean(source.pushEnabled, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.pushEnabled),
    inboxEnabled: normalizeBoolean(source.inboxEnabled, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.inboxEnabled),
    newMemberJoined: normalizeBoolean(source.newMemberJoined, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.newMemberJoined),
    approvalRequests: normalizeBoolean(source.approvalRequests, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.approvalRequests),
    memberFlagged: normalizeBoolean(source.memberFlagged, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.memberFlagged),
    eventPublished: normalizeBoolean(source.eventPublished, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.eventPublished),
    eventCanceled: normalizeBoolean(source.eventCanceled, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.eventCanceled),
    newsletterPublished: normalizeBoolean(source.newsletterPublished, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.newsletterPublished),
    customBroadcasts: normalizeBoolean(source.customBroadcasts, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.customBroadcasts),
    weeklySummary: normalizeBoolean(source.weeklySummary, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.weeklySummary),
    soundEnabled: normalizeBoolean(source.soundEnabled, DEFAULT_TENANT_MOBILE_NOTIFICATION_PREFS.soundEnabled)
  };
}

export function tenantAllowsAutomaticMobileNotification(value = {}, kind = "") {
  const preferences = normalizeTenantMobileNotificationPrefs(value);
  if (!preferences.mobileEnabled) return false;
  const preferenceKey = AUTOMATIC_NOTIFICATION_PREF_BY_KIND.get(String(kind || "").trim().toLowerCase());
  return preferenceKey ? Boolean(preferences[preferenceKey]) : true;
}

export function normalizeUserMobileNotificationPreferences(value = {}) {
  const source = isObject(value) ? value : {};
  const categories = isObject(source.categories) ? source.categories : {};
  return {
    pushEnabled: normalizeBoolean(source.pushEnabled, DEFAULT_USER_MOBILE_NOTIFICATION_PREFERENCES.pushEnabled),
    categories: {
      announcements: normalizeBoolean(
        categories.announcements,
        DEFAULT_USER_MOBILE_NOTIFICATION_PREFERENCES.categories.announcements
      ),
      events: normalizeBoolean(categories.events, DEFAULT_USER_MOBILE_NOTIFICATION_PREFERENCES.categories.events),
      community: normalizeBoolean(
        categories.community,
        DEFAULT_USER_MOBILE_NOTIFICATION_PREFERENCES.categories.community
      ),
      account: normalizeBoolean(categories.account, DEFAULT_USER_MOBILE_NOTIFICATION_PREFERENCES.categories.account),
      admin: normalizeBoolean(categories.admin, DEFAULT_USER_MOBILE_NOTIFICATION_PREFERENCES.categories.admin)
    }
  };
}

export async function touchMobileDevicesForUser(tenantId, userId) {
  if (!tenantId || !userId) return;
  await MobileNotificationDeviceModel.updateMany(
    tenantId,
    { userId, isActive: true },
    { lastSeenAt: new Date() }
  ).catch(() => {});
}

export async function registerMobileDevice({
  tenantId,
  userId,
  token,
  platform = "ios",
  appId = "",
  environment = env.APNS_USE_SANDBOX ? "sandbox" : "production",
  permissionState = "granted"
}) {
  const normalizedToken = normalizeText(token, 4096);
  if (!tenantId || !userId || !normalizedToken) {
    throw new Error("tenantId, userId, and token are required.");
  }
  const normalizedPlatform = String(platform || "").trim().toLowerCase() === "android" ? "android" : "ios";
  const normalizedAppId = normalizeText(
    appId || (normalizedPlatform === "android" ? env.FCM_ANDROID_APP_ID : env.APNS_BUNDLE_ID),
    120
  );
  const normalizedEnvironment = normalizedPlatform === "android"
    ? "production"
    : normalizeText(environment, 32) || "sandbox";

  const existing = await MobileNotificationDeviceModel.acrossTenants().findOne({ token: normalizedToken });
  if (existing) {
    return MobileNotificationDeviceModel.update(existing._id, {
      tenantId,
      userId,
      platform: normalizedPlatform,
      appId: normalizedAppId,
      environment: normalizedEnvironment,
      permissionState: normalizeText(permissionState, 24) || "granted",
      isActive: true,
      lastSeenAt: new Date(),
      lastRegisteredAt: new Date(),
      lastError: ""
    });
  }

  return MobileNotificationDeviceModel.create({
    tenantId,
    userId,
    platform: normalizedPlatform,
    token: normalizedToken,
    appId: normalizedAppId,
    environment: normalizedEnvironment,
    permissionState: normalizeText(permissionState, 24) || "granted",
    isActive: true,
    lastSeenAt: new Date(),
    lastRegisteredAt: new Date()
  });
}

export async function getOrCreateUserMobileNotificationPreferences(tenantId, userId) {
  const existing = await MobileNotificationPreferenceModel.findOne(tenantId, { userId });
  if (existing) {
    return {
      ...existing,
      ...normalizeUserMobileNotificationPreferences(existing)
    };
  }

  const created = await MobileNotificationPreferenceModel.create({
    tenantId,
    userId,
    ...normalizeUserMobileNotificationPreferences({})
  });
  return {
    ...created,
    ...normalizeUserMobileNotificationPreferences(created)
  };
}

export async function updateUserMobileNotificationPreferences(tenantId, userId, patch = {}) {
  const existing = await getOrCreateUserMobileNotificationPreferences(tenantId, userId);
  const next = normalizeUserMobileNotificationPreferences({
    ...existing,
    ...patch,
    categories: {
      ...(existing.categories || {}),
      ...(isObject(patch.categories) ? patch.categories : {})
    }
  });

  const updated = await MobileNotificationPreferenceModel.update(existing._id, next);
  return {
    ...updated,
    ...normalizeUserMobileNotificationPreferences(updated)
  };
}

export async function listUserMobileNotifications(tenantId, userId, { limit = 40, unreadOnly = false } = {}) {
  const filter = {
    userId,
    archivedAt: null
  };
  if (unreadOnly) filter.readAt = null;

  const rows = await MobileNotificationModel.find(tenantId, filter, {
    sort: { createdAt: -1 },
    limit: Math.max(1, Math.min(Number(limit || 40) * 2, 200))
  });
  return rows
    .filter((row) => row?.delivery?.inboxVisible !== false)
    .slice(0, Math.max(1, Math.min(Number(limit || 40), 100)))
    .map((row) => toNotificationClient(row));
}

export async function countUnreadMobileNotifications(tenantId, userId) {
  const rows = await MobileNotificationModel.find(tenantId, {
    userId,
    archivedAt: null,
    readAt: null
  }, {
    select: ["id", "delivery"],
    limit: 5000
  });
  return rows.filter((row) => row?.delivery?.inboxVisible !== false).length;
}

export async function markMobileNotificationsRead(tenantId, userId, ids = []) {
  const normalizedIds = [...new Set((Array.isArray(ids) ? ids : [ids]).map((item) => String(item || "").trim()).filter(Boolean))];
  if (!normalizedIds.length) return [];

  const updated = await MobileNotificationModel.updateMany(
    tenantId,
    {
      _id: { $in: normalizedIds },
      userId,
      readAt: null
    },
    { readAt: new Date() }
  );
  return updated.map((row) => toNotificationClient(row));
}

export async function markAllMobileNotificationsRead(tenantId, userId) {
  const updated = await MobileNotificationModel.updateMany(
    tenantId,
    { userId, archivedAt: null, readAt: null },
    { readAt: new Date() }
  );
  return updated.length;
}

export async function archiveMobileNotifications(tenantId, userId, ids = []) {
  const normalizedIds = [...new Set((Array.isArray(ids) ? ids : [ids]).map((item) => String(item || "").trim()).filter(Boolean))];
  if (!normalizedIds.length) return [];

  const updated = await MobileNotificationModel.updateMany(
    tenantId,
    { _id: { $in: normalizedIds }, userId, archivedAt: null },
    { archivedAt: new Date(), readAt: new Date() }
  );
  return updated.map((row) => toNotificationClient(row));
}

export async function noteMobileNotificationOpened(tenantId, userId, id) {
  const existing = await MobileNotificationModel.findOne(tenantId, {
    _id: String(id || "").trim(),
    userId
  });
  if (!existing) return null;
  const updated = await MobileNotificationModel.update(existing._id, {
    openedAt: new Date(),
    readAt: existing.readAt || new Date()
  });
  return toNotificationClient(updated);
}

export async function listRecentMobileNotificationBatches(tenantId, { limit = 20 } = {}) {
  const rows = await MobileNotificationModel.find(tenantId, {}, {
    sort: { createdAt: -1 },
    limit: Math.max(50, Math.min(500, Number(limit || 20) * 20))
  });

  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.batchId || row._id || row.id || "").trim();
    if (!key) continue;
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key,
        batchId: key,
        kind: String(row.kind || ""),
        category: normalizeCategory(row.category),
        title: String(row.title || ""),
        body: String(row.body || ""),
        deepLink: normalizeDeepLink(row.deepLink || ""),
        createdAt: row.createdAt || null,
        createdByUserId: String(row.createdByUserId || ""),
        totalRecipients: 0,
        pushDelivered: 0,
        pushFailed: 0,
        unreadCount: 0
      });
    }
    const group = grouped.get(key);
    const delivery = isObject(row.delivery) ? row.delivery : {};
    group.totalRecipients += 1;
    if (String(delivery.pushStatus || "") === "delivered") group.pushDelivered += 1;
    if (String(delivery.pushStatus || "") === "failed") group.pushFailed += 1;
    if (delivery.inboxVisible !== false && !row.readAt && !row.archivedAt) group.unreadCount += 1;
  }

  return [...grouped.values()]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, Math.max(1, Math.min(Number(limit || 20), 50)));
}

function userAllowsPush(preferences = {}, category = "announcements") {
  const normalized = normalizeUserMobileNotificationPreferences(preferences);
  return Boolean(normalized.pushEnabled && normalized.categories[normalizeCategory(category)]);
}

/**
 * How many provider calls may be in flight at once for a single notification.
 * High enough that a member's two or three devices overlap completely, low
 * enough that a camp-wide broadcast does not open an unbounded number of
 * sockets to APNs/FCM and earn a rate limit.
 */
export const PUSH_FANOUT_CONCURRENCY = 8;

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runner)
  );
  return results;
}

/**
 * Write the delivery outcome for every device in as few statements as the
 * outcomes allow.
 *
 * This used to be one UPDATE per device, so a broadcast cost a database round
 * trip per recipient device on top of the provider call. In practice every
 * device shares one of a handful of outcomes — delivered, or failed with the
 * same provider error — so grouping by outcome turns N writes into two or
 * three regardless of how large the camp is.
 */
async function recordDeviceOutcomes({ tenantId, devices, results }) {
  const groups = new Map();

  devices.forEach((device, index) => {
    const result = results[index] || { ok: false, error: "", permanent: false };
    const patch = {
      lastDeliveredAt: result.ok ? new Date() : device.lastDeliveredAt || null,
      lastError: result.ok ? "" : result.error || "",
      isActive: result.permanent ? false : device.isActive
    };
    // Devices whose previous state differs still need their own statement,
    // because the patch carries that previous state forward.
    const key = JSON.stringify([
      result.ok,
      patch.lastError,
      patch.isActive,
      result.ok ? "" : String(patch.lastDeliveredAt || "")
    ]);
    const group = groups.get(key);
    if (group) group.ids.push(device._id);
    else groups.set(key, { patch, ids: [device._id] });
  });

  const scope = String(tenantId || "").trim();
  await Promise.all(
    [...groups.values()].map(({ patch, ids }) => {
      // A set-based write on a tenant-scoped table has to name its tenant, so
      // without one fall back to per-id writes rather than silently skipping
      // the bookkeeping.
      if (ids.length === 1 || !scope) {
        return Promise.all(
          ids.map((id) => MobileNotificationDeviceModel.update(id, patch).catch(() => {}))
        );
      }
      return MobileNotificationDeviceModel.updateMany(scope, { _id: { $in: ids } }, patch).catch(
        () => {}
      );
    })
  );
}

async function deliverNotificationToUser({
  notification,
  devices = [],
  tenantPrefs,
  userPrefs
}) {
  const delivery = {
    inboxVisible: Boolean(tenantPrefs.inboxEnabled),
    pushRequested: true,
    pushStatus: "pending",
    pushDeliveredAt: null,
    pushError: "",
    devicesAttempted: 0,
    devicesDelivered: 0
  };

  if (!tenantPrefs.mobileEnabled || !tenantPrefs.pushEnabled) {
    delivery.pushStatus = "tenant_disabled";
    return updateNotificationDelivery(notification._id, delivery);
  }
  if (!userAllowsPush(userPrefs, notification.category)) {
    delivery.pushStatus = "user_disabled";
    return updateNotificationDelivery(notification._id, delivery);
  }
  if (!devices.length) {
    delivery.pushStatus = "no_device";
    return updateNotificationDelivery(notification._id, delivery);
  }
  if (!hasApnsConfiguration() && !hasFcmConfiguration()) {
    delivery.pushStatus = "skipped_no_provider";
    return updateNotificationDelivery(notification._id, delivery);
  }

  delivery.devicesAttempted = devices.length;

  // One device at a time meant a member with a phone and a tablet waited for
  // two full provider round trips, and a broadcast waited for that times every
  // recipient. The provider calls are independent, so they overlap now — but
  // only PUSH_FANOUT_CONCURRENCY at a time, because an unbounded fan-out is
  // how a large camp gets itself rate-limited by APNs or FCM.
  const results = await mapWithConcurrency(devices, PUSH_FANOUT_CONCURRENCY, (device) => {
    const platform = String(device?.platform || "ios").trim().toLowerCase();
    const isAndroid = platform === "android" || platform === "fcm";
    const sender = isAndroid ? sendFcmAlert : sendApnsAlert;
    return sender({
      token: device.token,
      title: notification.title,
      body: notification.body,
      category: notification.category,
      deepLink: notification.deepLink,
      data: {
        notificationId: String(notification._id || notification.id || ""),
        kind: notification.kind,
        deepLink: notification.deepLink,
        ...(isObject(notification.data) ? notification.data : {})
      },
      soundEnabled: tenantPrefs.soundEnabled
    }).catch((error) => ({
      ok: false,
      status: "failed",
      error: String(error?.message || "Push send failed"),
      permanent: false
    }));
  });

  // Folded in device order, not completion order, so the reported status does
  // not depend on which provider happened to answer first.
  for (const result of results) {
    if (result.ok) {
      delivery.devicesDelivered += 1;
      delivery.pushStatus = "delivered";
      delivery.pushDeliveredAt = new Date().toISOString();
    } else if (delivery.pushStatus !== "delivered") {
      delivery.pushStatus = result.status || "failed";
      delivery.pushError = result.error || "";
    }
  }

  await recordDeviceOutcomes({ tenantId: notification.tenantId, devices, results });

  return updateNotificationDelivery(notification._id, delivery);
}

export async function sendMobileNotificationBatch({
  tenant,
  userIds = [],
  createdByUserId = "",
  kind = "custom_admin",
  category = "announcements",
  title,
  body,
  deepLink = "",
  data = {},
  batchId = createBatchId("mobile"),
  pushRequested = true
}) {
  const tenantId = String(tenant?._id || tenant?.id || "").trim();
  const normalizedUserIds = [...new Set((Array.isArray(userIds) ? userIds : []).map((item) => String(item || "").trim()).filter(Boolean))];
  if (!tenantId || !normalizedUserIds.length) {
    return { batchId, notifications: [], totalRecipients: 0 };
  }

  const tenantPrefs = normalizeTenantMobileNotificationPrefs(tenant?.notificationPrefs || {});
  if (!tenantPrefs.mobileEnabled || (!tenantPrefs.inboxEnabled && (!tenantPrefs.pushEnabled || !pushRequested))) {
    return { batchId, notifications: [], totalRecipients: 0, skipped: "tenant_disabled" };
  }
  const users = await UserModel.find(tenantId, { _id: { $in: normalizedUserIds } }, {
    select: ["id", "roles", "status", "email"]
  });
  const activeUsers = users.filter((user) => String(user?.status || "active").trim().toLowerCase() === "active");
  if (!activeUsers.length) {
    return { batchId, notifications: [], totalRecipients: 0 };
  }

  const activeUserIds = activeUsers.map((user) => String(user._id || user.id || "")).filter(Boolean);
  const [prefRows, deviceRows] = await Promise.all([
    MobileNotificationPreferenceModel.find(tenantId, { userId: { $in: activeUserIds } }),
    MobileNotificationDeviceModel.find(tenantId, { userId: { $in: activeUserIds }, isActive: true })
  ]);

  const prefsByUserId = new Map(
    prefRows.map((row) => [
      String(row.userId || ""),
      normalizeUserMobileNotificationPreferences(row)
    ])
  );
  const devicesByUserId = mapByUserId(deviceRows);
  const createdRows = await MobileNotificationModel.insertMany(
    activeUserIds.map((userId) => ({
      tenantId,
      userId,
      batchId,
      createdByUserId: createdByUserId || undefined,
      kind: normalizeText(kind, 80) || "custom_admin",
      category: normalizeCategory(category),
      title: normalizeText(title, 120),
      body: normalizeLongText(body, 500),
      deepLink: normalizeDeepLink(deepLink),
      data: isObject(data) ? data : {},
      delivery: {
        inboxVisible: Boolean(tenantPrefs.inboxEnabled),
        pushRequested: Boolean(pushRequested),
        pushStatus: pushRequested ? "pending" : "disabled"
      }
    }))
  );

  if (pushRequested) {
    await runWithConcurrency(createdRows, async (row) => {
      const notification = toNotificationClient(row);
      return deliverNotificationToUser({
        notification,
        devices: devicesByUserId.get(String(row.userId || "")) || [],
        tenantPrefs,
        userPrefs: prefsByUserId.get(String(row.userId || "")) || DEFAULT_USER_MOBILE_NOTIFICATION_PREFERENCES
      });
    });
  }

  const notifications = await MobileNotificationModel.find(tenantId, {
    batchId
  }, {
    sort: { createdAt: -1 },
    limit: createdRows.length
  });

  return {
    batchId,
    totalRecipients: notifications.length,
    notifications: notifications.map((row) => toNotificationClient(row))
  };
}

export async function notifyTenantAdmins({
  tenant,
  createdByUserId = "",
  kind,
  title,
  body,
  deepLink = "",
  data = {}
}) {
  const tenantId = String(tenant?._id || tenant?.id || "").trim();
  if (!tenantId) return { batchId: "", notifications: [], totalRecipients: 0 };
  if (!tenantAllowsAutomaticMobileNotification(tenant?.notificationPrefs || {}, kind)) {
    return { batchId: "", notifications: [], totalRecipients: 0, skipped: "automatic_trigger_disabled" };
  }

  const admins = await UserModel.find(tenantId, { status: "active" }, {
    select: ["id", "roles", "status", "email"]
  });
  const userIds = admins
    .filter((item) => Array.isArray(item.roles) && item.roles.some((role) => ["tenant_admin", "admin", "super_admin"].includes(String(role || "").trim().toLowerCase())))
    .map((item) => String(item._id || item.id || ""))
    .filter((userId) => userId && userId !== String(createdByUserId || "").trim());

  return sendMobileNotificationBatch({
    tenant,
    userIds,
    createdByUserId,
    kind,
    category: "admin",
    title,
    body,
    deepLink,
    data
  });
}

export async function resolveAudienceUserIds(tenantId, audience = "all_active_members", extra = {}) {
  const safeAudience = String(audience || "all_active_members").trim().toLowerCase();

  if (safeAudience === "specific_members") {
    const ids = Array.isArray(extra?.userIds) ? extra.userIds : [];
    const normalized = [...new Set(ids.map((item) => String(item || "").trim()).filter(Boolean))];
    if (!normalized.length) return [];
    const users = await UserModel.find(tenantId, { _id: { $in: normalized }, status: "active" }, {
      select: ["id", "status"]
    });
    return users.map((user) => String(user._id || user.id || "")).filter(Boolean);
  }

  const users = await UserModel.find(tenantId, { status: "active" }, {
    select: ["id", "roles", "status", "email"]
  });

  if (safeAudience === "admins") {
    return users
      .filter((user) => Array.isArray(user.roles) && user.roles.some((role) => ["tenant_admin", "admin", "super_admin"].includes(String(role || "").trim().toLowerCase())))
      .map((user) => String(user._id || user.id || ""))
      .filter(Boolean);
  }

  const profiles = await ProfileModel.find(tenantId, {}, {
    select: ["id", "userId", "status"]
  });
  const statusByUserId = new Map(
    profiles
      .map((profile) => [String(profile.userId || ""), String(profile.status || "").trim().toLowerCase()])
      .filter(([userId]) => userId)
  );

  return users
    .filter((user) => {
      const roles = Array.isArray(user.roles) ? user.roles.map((role) => String(role || "").trim().toLowerCase()) : [];
      const isAdmin = roles.includes("tenant_admin") || roles.includes("admin") || roles.includes("super_admin");
      const profileStatus = statusByUserId.get(String(user._id || user.id || "")) || "active";

      if (safeAudience === "all_users") return true;
      if (safeAudience === "flagged_members") return !isAdmin && profileStatus === "flagged";
      if (safeAudience === "pending_members") return !isAdmin && profileStatus === "pending";
      return !isAdmin;
    })
    .map((user) => String(user._id || user.id || ""))
    .filter(Boolean);
}

/**
 * A job left in `sending` by a process that died would otherwise sit there
 * forever, because nothing but a pending row is ever claimed. After the lease
 * expires the row is handed back to the pool; the claim itself is guarded on
 * the row still being `sending` with the same stale timestamp, so a worker
 * that is merely slow cannot have its job stolen twice over.
 */
export const SCHEDULE_LEASE_MS = 10 * 60 * 1000;

async function reclaimExpiredSchedules({ now = new Date(), limit = 25 } = {}) {
  const expiredBefore = new Date(now.getTime() - SCHEDULE_LEASE_MS);
  const stuck = await MobileNotificationScheduleModel.acrossTenants().find(
    { status: "sending", attemptedAt: { $lte: expiredBefore } },
    { sort: { attemptedAt: 1 }, limit }
  );

  let reclaimed = 0;
  for (const schedule of stuck) {
    const won = await MobileNotificationScheduleModel.claimOne(
      schedule._id,
      { status: "sending", attemptedAt: schedule.attemptedAt },
      { status: "pending" }
    );
    if (won) reclaimed += 1;
  }
  return reclaimed;
}

export async function runDueMobileNotificationSchedules({ now = new Date(), batchLimit = 25 } = {}) {
  const limit = Math.max(1, Math.min(Number(batchLimit || 25), 200));

  await reclaimExpiredSchedules({ now, limit });

  const due = await MobileNotificationScheduleModel.acrossTenants().find(
    {
      status: "pending",
      runAt: { $lte: now }
    },
    {
      sort: { runAt: 1 },
      limit
    }
  );

  const results = [];
  for (const schedule of due) {
    // Reading a row and then marking it `sending` is two statements, so two
    // API replicas polling this table both saw the same pending job and both
    // sent it — every member got the broadcast twice. The precondition now
    // lives inside the UPDATE, so exactly one replica can win the row and the
    // losers skip it.
    const claimed = await MobileNotificationScheduleModel.claimOne(
      schedule._id,
      { status: "pending" },
      { status: "sending", attemptedAt: new Date() }
    );
    if (!claimed) continue;

    try {
      const tenant = await TenantModel.findById(schedule.tenantId);
      if (!tenant) {
        await MobileNotificationScheduleModel.update(schedule._id, {
          status: "failed",
          error: "Tenant not found"
        });
        continue;
      }

      const tenantPrefs = normalizeTenantMobileNotificationPrefs(tenant.notificationPrefs || {});
      if (!tenantPrefs.mobileEnabled || !tenantPrefs.customBroadcasts) {
        await MobileNotificationScheduleModel.update(schedule._id, {
          status: "canceled",
          error: "Mobile broadcasts disabled"
        });
        continue;
      }

      const userIds = await resolveAudienceUserIds(schedule.tenantId, schedule.audience, {
        userIds: Array.isArray(schedule.userIds) ? schedule.userIds : []
      });

      const result = await sendMobileNotificationBatch({
        tenant,
        userIds,
        createdByUserId: schedule.createdByUserId || "",
        kind: "scheduled_admin",
        category: schedule.category,
        title: schedule.title,
        body: schedule.body,
        deepLink: schedule.deepLink || "",
        data: { audience: schedule.audience, scheduleId: String(schedule._id || "") },
        pushRequested: schedule.pushRequested !== false
      });

      await MobileNotificationScheduleModel.update(schedule._id, {
        status: "sent",
        batchId: result.batchId || "",
        error: ""
      });
      results.push({ id: schedule._id, batchId: result.batchId, recipients: result.totalRecipients });
    } catch (error) {
      await MobileNotificationScheduleModel.update(schedule._id, {
        status: "failed",
        error: String(error?.message || "Schedule run failed")
      }).catch(() => {});
    }
  }

  return results;
}

let schedulerTimer = null;
let schedulerTickPromise = null;

function runMobileNotificationSchedulerTick() {
  if (schedulerTickPromise) return schedulerTickPromise;

  schedulerTickPromise = runDueMobileNotificationSchedules()
    .catch((error) => {
      console.error("Mobile notification scheduler tick failed", error);
    })
    .finally(() => {
      schedulerTickPromise = null;
    });

  return schedulerTickPromise;
}

export function startMobileNotificationScheduler({ intervalMs = 30000 } = {}) {
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void runMobileNotificationSchedulerTick();
  }, Math.max(5000, intervalMs));
  if (typeof schedulerTimer.unref === "function") schedulerTimer.unref();
  void runMobileNotificationSchedulerTick();
}

export async function stopMobileNotificationScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  await schedulerTickPromise;
}

// Delivery fan-out is internal, but its concurrency and write-batching are
// behaviour worth pinning. `apps/api`'s integration suites need a real
// database, so these are reached directly instead.
export const __testables = {
  deliverNotificationToUser,
  recordDeviceOutcomes,
  mapWithConcurrency
};
