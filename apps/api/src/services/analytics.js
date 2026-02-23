import { AnalyticsEventModel } from "../db/models/index.js";
import { ProfileModel } from "../db/models/index.js";
import { UserModel } from "../db/models/index.js";

const ACTIVE_EVENT_TYPES = [
  "auth_login_password",
  "auth_login_magic_link",
  "profile_updated",
  "directory_search"
];

function normalizeSearchTerm(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "")
    .slice(0, 80);
}

function parseState(cityState = "") {
  const raw = String(cityState || "").trim();
  if (!raw) return "";

  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const candidate = (parts.length > 1 ? parts[parts.length - 1] : raw).toUpperCase();
  if (/^[A-Z]{2}$/.test(candidate)) return candidate;

  const tokens = raw.split(/\s+/g).filter(Boolean);
  const maybeAbbrev = String(tokens[tokens.length - 1] || "").toUpperCase();
  if (/^[A-Z]{2}$/.test(maybeAbbrev)) return maybeAbbrev;

  return candidate.slice(0, 20);
}

function completionPercentForProfile(profile) {
  const checks = [
    Boolean(profile?.firstName),
    Boolean(profile?.lastName),
    Array.isArray(profile?.emails) && profile.emails.some(Boolean),
    Array.isArray(profile?.phones) && profile.phones.some(Boolean),
    Boolean(profile?.cityState),
    Boolean(profile?.roleAtCamp),
    Boolean(profile?.highSchool),
    Array.isArray(profile?.colleges) && profile.colleges.some(Boolean),
    Array.isArray(profile?.currentJobs) && profile.currentJobs.length > 0,
    Boolean(profile?.bio)
  ];

  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

function suppressSmallBuckets(items, { minCount = 2, otherLabel = "Other (<2)" } = {}) {
  const visible = [];
  let suppressedTotal = 0;

  for (const item of items) {
    if (Number(item.count || 0) >= minCount) {
      visible.push(item);
    } else {
      suppressedTotal += Number(item.count || 0);
    }
  }

  if (suppressedTotal > 0) {
    visible.push({ label: otherLabel, count: suppressedTotal });
  }

  return visible;
}

export async function logTenantEvent({ tenantId, userId = null, eventType, metadata = {} }) {
  if (!tenantId || !eventType) return;

  const safeMetadata = { ...(metadata || {}) };
  if (eventType === "directory_search") {
    safeMetadata.term = normalizeSearchTerm(metadata?.term || "");
  }

  await AnalyticsEventModel.create({
    tenantId,
    userId: userId || null,
    eventType: String(eventType),
    metadata: safeMetadata
  });
}

export async function getTenantAnalyticsSnapshot({ tenantId }) {
  const now = new Date();
  const since7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [totalUsers, totalProfiles, signupsLast7Days, signupsLast30Days] = await Promise.all([
    UserModel.count(tenantId),
    ProfileModel.count(tenantId),
    UserModel.count(tenantId, { createdAt: { $gte: since7Days } }),
    UserModel.count(tenantId, { createdAt: { $gte: since30Days } })
  ]);

  const [activeUserIds, activeLoginUsers] = await Promise.all([
    AnalyticsEventModel.distinctActiveUserIds(tenantId, ACTIVE_EVENT_TYPES, since7Days),
    UserModel.find(tenantId, { lastLoginAt: { $gte: since7Days } }, { select: ["id"] })
  ]);

  const wauSet = new Set([
    ...(activeUserIds || []).map((id) => String(id)),
    ...activeLoginUsers.map((user) => String(user._id))
  ]);

  const profiles = await ProfileModel.find(tenantId);
  const completionPercents = profiles.map((profile) => completionPercentForProfile(profile));
  const averageCompletionPercent = completionPercents.length
    ? Math.round(
        completionPercents.reduce((sum, value) => sum + value, 0) / completionPercents.length
      )
    : 0;

  const topSearchAgg = await AnalyticsEventModel.topSearchTerms(tenantId, since30Days, 25);

  const topSearchTerms = suppressSmallBuckets(
    (topSearchAgg || []).map((item) => ({
      label: String(item.term || ""),
      count: Number(item.count || 0)
    })),
    { minCount: 2, otherLabel: "Other Searches (<2)" }
  ).slice(0, 10);

  const stateCounts = new Map();
  for (const profile of profiles) {
    const state = parseState(profile.cityState || "");
    const key = state || "Unknown";
    stateCounts.set(key, (stateCounts.get(key) || 0) + 1);
  }

  const geographicDistribution = suppressSmallBuckets(
    [...stateCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    { minCount: 2, otherLabel: "Other States (<2)" }
  ).slice(0, 12);

  return {
    generatedAt: now.toISOString(),
    totals: {
      users: totalUsers,
      profiles: totalProfiles
    },
    engagement: {
      weeklyActiveUsers: wauSet.size,
      signupsLast7Days,
      signupsLast30Days
    },
    profileCompletion: {
      averagePercent: averageCompletionPercent,
      profileCount: totalProfiles
    },
    topSearchTerms,
    geographicDistribution
  };
}
