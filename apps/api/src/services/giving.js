import { sanitizeText } from "../utils/sanitize.js";

export const GIVING_CATEGORIES = [
  "camperships",
  "facilities",
  "traditions",
  "programs",
  "memorial",
  "other"
];

export const GIVING_STATUSES = [
  "pending",
  "changes_requested",
  "active",
  "completed",
  "rejected",
  "archived"
];

export const GIVING_DISPLAY_PREFERENCES = ["public", "hide_amount", "anonymous"];

function cleanText(value, maxLength = 1000) {
  return sanitizeText(String(value || "").trim()).slice(0, maxLength);
}

function cleanEnum(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeDate(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw createGivingError("Enter a valid date.", "GIVING_DATE_INVALID");
  }
  const parsed = new Date(`${normalized}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw createGivingError("Enter a valid date.", "GIVING_DATE_INVALID");
  }
  return normalized;
}

function normalizeCents(value, { allowZero = false, field = "amount" } = {}) {
  const parsed = Number(value);
  const minimum = allowZero ? 0 : 100;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw createGivingError(
      field === "goal" ? "Enter a fundraising goal of at least $1." : "Enter a valid donation amount.",
      field === "goal" ? "GIVING_GOAL_INVALID" : "GIVING_AMOUNT_INVALID"
    );
  }
  return parsed;
}

function normalizeHttpUrl(value, { checkout = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
    if (checkout && url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
      throw new Error("secure");
    }
    if (url.username || url.password) throw new Error("credentials");
    return url.toString();
  } catch {
    throw createGivingError(
      checkout ? "Enter a secure checkout URL." : "Enter a valid image URL.",
      checkout ? "GIVING_CHECKOUT_URL_INVALID" : "GIVING_IMAGE_URL_INVALID"
    );
  }
}

export function createGivingError(message, code = "GIVING_INVALID", status = 400, details = null) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

export function resolveGivingSlug(title = "", fallback = "cause") {
  return cleanText(title, 120)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

export function normalizeGivingWritePayload(source = {}, { partial = false, allowGeneralFund = false } = {}) {
  const payload = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(source || {}, key);

  if (!partial || has("title")) {
    payload.title = cleanText(source.title, 120);
    if (!payload.title) throw createGivingError("Add a name for this cause.", "GIVING_TITLE_REQUIRED");
  }

  if (!partial || has("shortDescription")) {
    payload.shortDescription = cleanText(source.shortDescription, 220);
    if (!payload.shortDescription) {
      throw createGivingError("Add a short description for this cause.", "GIVING_SUMMARY_REQUIRED");
    }
  }

  if (!partial || has("description")) {
    payload.description = cleanText(source.description, 6000);
    if (!payload.description) {
      throw createGivingError("Tell alumni what this cause will accomplish.", "GIVING_DESCRIPTION_REQUIRED");
    }
  }

  if (!partial || has("whyItMatters")) {
    payload.whyItMatters = cleanText(source.whyItMatters, 4000);
  }

  if (!partial || has("category")) {
    payload.category = cleanEnum(source.category, GIVING_CATEGORIES, "");
    if (!payload.category) throw createGivingError("Choose a cause category.", "GIVING_CATEGORY_INVALID");
  }

  if (!partial || has("coverImageUrl")) {
    payload.coverImageUrl = normalizeHttpUrl(source.coverImageUrl || "");
  }

  if (!partial || has("goalAmountCents")) {
    const isGeneralFund = allowGeneralFund && Boolean(source.isGeneralFund);
    payload.goalAmountCents = normalizeCents(source.goalAmountCents, {
      allowZero: isGeneralFund,
      field: "goal"
    });
  }

  if (!partial || has("endDate")) payload.endDate = normalizeDate(source.endDate);
  if (!partial || has("startDate")) payload.startDate = normalizeDate(source.startDate);

  if (payload.startDate && payload.endDate && payload.endDate < payload.startDate) {
    throw createGivingError("The end date must be after the start date.", "GIVING_TIMELINE_INVALID");
  }

  if (allowGeneralFund && (!partial || has("isGeneralFund"))) {
    payload.isGeneralFund = Boolean(source.isGeneralFund);
  }

  if (allowGeneralFund && (!partial || has("charityDesignationId"))) {
    payload.charityDesignationId = cleanText(source.charityDesignationId, 160);
  }

  if (allowGeneralFund && (!partial || has("externalCheckoutUrl"))) {
    payload.externalCheckoutUrl = normalizeHttpUrl(source.externalCheckoutUrl || "", { checkout: true });
  }

  if (allowGeneralFund && has("fundraisingOpen")) payload.fundraisingOpen = Boolean(source.fundraisingOpen);
  if (allowGeneralFund && has("featured")) payload.featured = Boolean(source.featured);

  return payload;
}

export function normalizeCheckoutPreferences(source = {}) {
  const amountCents = normalizeCents(source.amountCents);
  const displayPreference = cleanEnum(
    source.displayPreference,
    GIVING_DISPLAY_PREFERENCES,
    "public"
  );
  return {
    amountCents,
    displayPreference,
    donorMessage: cleanText(source.donorMessage, 280),
    showAffiliation: source.showAffiliation !== false
  };
}

function isoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function serializeGivingCause(cause = {}, { viewerUserId = "", admin = false } = {}) {
  const goalAmountCents = Math.max(0, Number(cause.goalAmountCents) || 0);
  const amountRaisedCents = Math.max(0, Number(cause.amountRaisedCents) || 0);
  const progressPercent = goalAmountCents > 0
    ? Math.min(100, Math.max(0, Math.round((amountRaisedCents / goalAmountCents) * 100)))
    : null;

  const item = {
    id: String(cause._id || cause.id || ""),
    slug: String(cause.slug || ""),
    title: String(cause.title || ""),
    shortDescription: String(cause.shortDescription || ""),
    description: String(cause.description || ""),
    whyItMatters: String(cause.whyItMatters || ""),
    category: cleanEnum(cause.category, GIVING_CATEGORIES, "other"),
    coverImageUrl: String(cause.coverImageUrl || ""),
    creatorName: String(cause.creatorName || ""),
    creatorAffiliation: String(cause.creatorAffiliation || ""),
    origin: cause.origin === "official" ? "official" : "alumni_led",
    status: cleanEnum(cause.status, GIVING_STATUSES, "pending"),
    goalAmountCents,
    amountRaisedCents,
    donorCount: Math.max(0, Number(cause.donorCount) || 0),
    progressPercent,
    featured: Boolean(cause.featured),
    fundraisingOpen: Boolean(cause.fundraisingOpen),
    isGeneralFund: Boolean(cause.isGeneralFund),
    checkoutConnected: Boolean(String(cause.externalCheckoutUrl || "").trim()),
    startDate: cause.startDate || null,
    endDate: cause.endDate || null,
    approvedAt: isoDate(cause.approvedAt),
    createdAt: isoDate(cause.createdAt),
    updatedAt: isoDate(cause.updatedAt),
    createdByMe: Boolean(viewerUserId && String(cause.createdByUserId || "") === String(viewerUserId))
  };

  if (item.createdByMe) item.reviewNote = String(cause.reviewNote || "");

  if (admin) {
    Object.assign(item, {
      createdByUserId: String(cause.createdByUserId || ""),
      createdByProfileId: String(cause.createdByProfileId || ""),
      reviewNote: String(cause.reviewNote || ""),
      approvedByUserId: String(cause.approvedByUserId || ""),
      charityDesignationId: String(cause.charityDesignationId || ""),
      externalCheckoutUrl: String(cause.externalCheckoutUrl || "")
    });
  }

  return item;
}

export function serializeGivingUpdate(update = {}) {
  return {
    id: String(update._id || update.id || ""),
    title: String(update.title || ""),
    body: String(update.body || ""),
    milestoneType: String(update.milestoneType || "update"),
    publishedAt: isoDate(update.publishedAt || update.createdAt)
  };
}

export function serializePublicDonation(donation = {}) {
  const preference = cleanEnum(
    donation.displayPreference,
    GIVING_DISPLAY_PREFERENCES,
    "public"
  );
  return {
    id: String(donation._id || donation.id || ""),
    donorName: preference === "anonymous" ? "Anonymous" : String(donation.donorDisplayName || "Alumni supporter"),
    donorProfileId: preference === "anonymous" ? "" : String(donation.donorProfileId || ""),
    donorAffiliation: preference === "anonymous" ? "" : String(donation.donorAffiliation || ""),
    amountCents: preference === "hide_amount" ? null : Math.max(0, Number(donation.amountCents) || 0),
    donorMessage: String(donation.donorMessage || ""),
    completedAt: isoDate(donation.completedAt || donation.createdAt),
    anonymous: preference === "anonymous",
    amountHidden: preference === "hide_amount"
  };
}

export function serializeAdminDonation(donation = {}, cause = null) {
  return {
    id: String(donation._id || donation.id || ""),
    causeId: String(donation.causeId || ""),
    causeTitle: String(cause?.title || ""),
    provider: String(donation.provider || ""),
    providerDonationId: String(donation.providerDonationId || ""),
    donorUserId: String(donation.donorUserId || ""),
    donorProfileId: String(donation.donorProfileId || ""),
    donorName: String(donation.donorDisplayName || ""),
    donorAffiliation: String(donation.donorAffiliation || ""),
    donorEmail: String(donation.donorEmail || ""),
    amountCents: Math.max(0, Number(donation.amountCents) || 0),
    displayPreference: cleanEnum(donation.displayPreference, GIVING_DISPLAY_PREFERENCES, "public"),
    donorMessage: String(donation.donorMessage || ""),
    status: String(donation.status || ""),
    completedAt: isoDate(donation.completedAt || donation.createdAt)
  };
}

export function buildGivingSummary(causes = []) {
  const visible = causes.filter((cause) => ["active", "completed"].includes(String(cause.status || "")));
  return visible.reduce(
    (summary, cause) => ({
      amountRaisedCents: summary.amountRaisedCents + Math.max(0, Number(cause.amountRaisedCents) || 0),
      donorCount: summary.donorCount + Math.max(0, Number(cause.donorCount) || 0),
      completedCauseCount: summary.completedCauseCount + (cause.status === "completed" ? 1 : 0),
      activeCauseCount: summary.activeCauseCount + (cause.status === "active" ? 1 : 0)
    }),
    { amountRaisedCents: 0, donorCount: 0, completedCauseCount: 0, activeCauseCount: 0 }
  );
}
