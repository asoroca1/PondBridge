const DAY_MS = 24 * 60 * 60 * 1000;

const MODULE_CATALOG = [
  { key: "directory", name: "Directory", eventTypes: ["directory_search"] },
  { key: "search", name: "Advanced Search", eventTypes: ["directory_search"] },
  { key: "events", name: "Events", eventTypes: ["event_detail_viewed", "event_rsvp_updated"] },
  { key: "photoStream", name: "Photo Stream", eventTypes: [] },
  { key: "chat", name: "Messaging", eventTypes: [] },
  { key: "map", name: "Location Map", eventTypes: [] },
  { key: "familyTrees", name: "Family Trees", eventTypes: [] },
  { key: "relatedProfiles", name: "Related Profiles", eventTypes: [] },
  { key: "newsletter", name: "Newsletter", eventTypes: [] },
  { key: "merchShop", name: "Merch Shop", eventTypes: [] }
];

function idOf(value) {
  return value ? String(value) : "";
}

function dateValue(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function dayKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function recipientDomain(value = "") {
  const email = normalizeEmail(value);
  return email.includes("@") ? email.split("@").pop() : "unknown";
}

function normalizedTags(payload = {}) {
  const tags = payload?.data?.tags;
  if (Array.isArray(tags)) {
    return tags.map((tag) => ({
      name: String(tag?.name || "").trim().toLowerCase(),
      value: String(tag?.value || "").trim()
    }));
  }
  if (tags && typeof tags === "object") {
    return Object.entries(tags).map(([name, value]) => ({
      name: String(name || "").trim().toLowerCase(),
      value: String(value || "").trim()
    }));
  }
  return [];
}

function tagValue(payload, name) {
  const target = String(name || "").trim().toLowerCase();
  return normalizedTags(payload).find((tag) => tag.name === target)?.value || "";
}

function deliveryStatus(eventType = "") {
  const normalized = String(eventType || "").trim().toLowerCase();
  return normalized.startsWith("email.") ? normalized.slice("email.".length) : normalized;
}

function deliveryTone(status = "") {
  if (["delivered", "clicked"].includes(status)) return "success";
  if (status === "sent") return "info";
  if (["delivery_delayed", "suppressed"].includes(status)) return "warning";
  if (["bounced", "complained", "failed"].includes(status)) return "danger";
  return "neutral";
}

function seriesForLastSevenDays(now, buckets, valueForBucket) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const points = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(start.getTime() - offset * DAY_MS);
    const key = dayKey(date);
    points.push({ date: key, value: valueForBucket(buckets.get(key) || []) });
  }
  return points;
}

export function buildModuleAdoption({ tenants = [], analyticsEvents = [] } = {}) {
  const eventsByType = new Map();
  for (const event of analyticsEvents) {
    const type = String(event?.eventType || "").trim();
    const tenantId = idOf(event?.tenantId);
    if (!type || !tenantId) continue;
    if (!eventsByType.has(type)) eventsByType.set(type, new Set());
    eventsByType.get(type).add(tenantId);
  }

  return MODULE_CATALOG.map((module) => {
    const enabledTenantIds = new Set(
      tenants
        .filter((tenant) => tenant?.modules?.[module.key] !== false)
        .map((tenant) => idOf(tenant?._id))
        .filter(Boolean)
    );
    const measured = module.eventTypes.length > 0;
    const activeTenantIds = new Set();
    if (measured) {
      for (const eventType of module.eventTypes) {
        for (const tenantId of eventsByType.get(eventType) || []) {
          if (enabledTenantIds.has(tenantId)) activeTenantIds.add(tenantId);
        }
      }
    }

    const enabledTenants = enabledTenantIds.size;
    const activelyUsedTenants = measured ? activeTenantIds.size : null;
    return {
      moduleKey: module.key,
      moduleName: module.name,
      enabledTenants,
      activelyUsedTenants,
      adoptionPercent:
        measured && enabledTenants > 0 ? (activelyUsedTenants / enabledTenants) * 100 : null,
      measurementStatus: measured ? "measured" : "not_instrumented"
    };
  });
}

export function buildResendDeliveryTelemetry({
  events = [],
  tenants = [],
  now = new Date()
} = {}) {
  const tenantById = new Map();
  const tenantBySlug = new Map();
  for (const tenant of tenants) {
    tenantById.set(idOf(tenant?._id), tenant);
    tenantBySlug.set(String(tenant?.slug || "").trim().toLowerCase(), tenant);
  }

  const latestByDelivery = new Map();
  const sortedEvents = [...events].sort(
    (a, b) =>
      dateValue(b?.occurredAt || b?.createdAt) - dateValue(a?.occurredAt || a?.createdAt)
  );
  for (const event of sortedEvents) {
    const emailId = String(event?.emailId || "").trim();
    const recipient = normalizeEmail(event?.recipientEmail || "");
    const fallbackId = idOf(event?._id);
    const key = emailId ? `${emailId}:${recipient}` : fallbackId;
    if (!key || latestByDelivery.has(key)) continue;
    latestByDelivery.set(key, event);
  }

  const rows = Array.from(latestByDelivery.values()).map((event) => {
    const tenant =
      tenantById.get(idOf(event?.tenantId)) ||
      tenantBySlug.get(String(event?.tenantSlug || "").trim().toLowerCase());
    const status = deliveryStatus(event?.eventType);
    const emailId = String(event?.emailId || "").trim();
    const category = tagValue(event?.payload, "category") || "transactional";
    return {
      id: idOf(event?._id) || `${emailId}:${dateValue(event?.occurredAt || event?.createdAt)}`,
      timestamp: event?.occurredAt || event?.createdAt,
      tenantName: tenant?.name || event?.tenantSlug || "Unresolved camp",
      emailType: category,
      recipientDomain: recipientDomain(event?.recipientEmail),
      status,
      statusTone: deliveryTone(status),
      messageId: emailId || "unavailable",
      canRetry: false
    };
  });

  const totalSent = rows.length;
  const deliveredCount = rows.filter((row) => ["delivered", "clicked"].includes(row.status)).length;
  const bouncedCount = rows.filter((row) => row.status === "bounced").length;
  const complainedCount = rows.filter((row) => row.status === "complained").length;
  const buckets = new Map();
  const domainCounts = new Map();
  const tenantVolume = new Map();

  for (const row of rows) {
    const key = dayKey(row.timestamp);
    if (key) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    }
    tenantVolume.set(row.tenantName, (tenantVolume.get(row.tenantName) || 0) + 1);
    if (row.status === "bounced") {
      domainCounts.set(row.recipientDomain, (domainCounts.get(row.recipientDomain) || 0) + 1);
    }
  }

  const deliverySeries = seriesForLastSevenDays(now, buckets, (dayRows) => {
    if (!dayRows.length) return 0;
    const successful = dayRows.filter((row) => ["delivered", "clicked"].includes(row.status)).length;
    return (successful / dayRows.length) * 100;
  });
  const bounceSeries = seriesForLastSevenDays(now, buckets, (dayRows) => {
    if (!dayRows.length) return 0;
    return (dayRows.filter((row) => row.status === "bounced").length / dayRows.length) * 100;
  });

  return {
    asOf: new Date(now).toISOString(),
    source: "resend_webhooks",
    telemetryAvailable: events.length > 0,
    stats: {
      deliveryRate: totalSent > 0 ? (deliveredCount / totalSent) * 100 : null,
      bounceRate: totalSent > 0 ? (bouncedCount / totalSent) * 100 : null,
      spamRate: totalSent > 0 ? (complainedCount / totalSent) * 100 : null,
      totalSent
    },
    charts: {
      deliverySeries,
      bounceSeries,
      volumeByTenant: Array.from(tenantVolume.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([tenantName, sent]) => ({ tenantName, sent }))
    },
    topBouncingDomains: Array.from(domainCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, bounces]) => ({
        domain,
        bounces,
        rate: totalSent > 0 ? (bounces / totalSent) * 100 : 0
      })),
    rows,
    notice:
      events.length > 0
        ? "Metrics come from verified Resend webhook events. Recipient addresses remain hidden."
        : "No Resend webhook events were recorded in this period. Delivery health is unavailable, not zero."
  };
}
