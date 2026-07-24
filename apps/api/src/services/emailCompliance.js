import { getEmailPreferenceStatus } from "./emailPreferences.js";

function text(value = "") {
  return String(value || "").trim();
}

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveCampPostalAddress(tenant = {}) {
  const live = tenant?.billingDetails?.mailingAddress || {};
  const draft = tenant?.onboardingDraft?.billingDetails?.mailingAddress || {};
  const source = Object.keys(live).length ? live : draft;
  const line1 = text(source?.line1);
  const line2 = text(source?.line2);
  const city = text(source?.city);
  const state = text(source?.state);
  const postalCode = text(source?.postalCode);
  const country = text(source?.country);
  const complete = Boolean(line1 && city && state && postalCode && country);
  const locality = [city, state, postalCode].filter(Boolean).join(", ").replace(/, ([^,]+)$/, " $1");
  return {
    complete,
    formatted: [line1, line2, locality, country].filter(Boolean).join(" · "),
    fields: { line1, line2, city, state, postalCode, country }
  };
}

function qualityItem(code, message, severity = "warning") {
  return { code, message, severity };
}

export function analyzeEmailDraft({
  tenant = {},
  subject = "",
  preheader = "",
  body = "",
  campaignType = "marketing",
  recipientCount = 0
} = {}) {
  const normalizedType = campaignType === "transactional" ? "transactional" : "marketing";
  const cleanSubject = text(subject);
  const cleanPreheader = text(preheader);
  const bodyText = stripHtml(body);
  const address = resolveCampPostalAddress(tenant);
  const preferenceStatus = getEmailPreferenceStatus();
  const blockers = [];
  const warnings = [];
  const passed = [];

  if (!cleanSubject) blockers.push(qualityItem("subject_required", "Add a subject line.", "blocker"));
  else passed.push(qualityItem("subject_present", "Subject line is present.", "passed"));
  if (!bodyText) blockers.push(qualityItem("body_required", "Add message content.", "blocker"));
  else passed.push(qualityItem("body_present", "Message content is present.", "passed"));
  if (Number(recipientCount || 0) <= 0) {
    blockers.push(qualityItem("recipients_required", "Choose at least one eligible recipient.", "blocker"));
  }

  if (normalizedType === "marketing") {
    if (!address.complete) {
      blockers.push(qualityItem(
        "postal_address_required",
        "Complete the camp mailing address in Billing before sending a community broadcast.",
        "blocker"
      ));
    } else {
      passed.push(qualityItem("postal_address_present", "Physical mailing address will be included.", "passed"));
    }
    if (!preferenceStatus.configured) {
      blockers.push(qualityItem(
        "preference_links_unavailable",
        "Email preference links are not configured for this environment.",
        "blocker"
      ));
    } else {
      passed.push(qualityItem("unsubscribe_present", "Preference and one-click unsubscribe links will be included.", "passed"));
    }
  }

  if (cleanSubject.length > 60) {
    warnings.push(qualityItem("subject_long", "Subject is over 60 characters and may be clipped on phones."));
  }
  if (!cleanPreheader) {
    warnings.push(qualityItem("preheader_missing", "Add preview text to improve inbox context."));
  } else if (cleanPreheader.length > 100) {
    warnings.push(qualityItem("preheader_long", "Preview text is over 100 characters and may be clipped."));
  }
  if (bodyText && bodyText.length < 40) {
    warnings.push(qualityItem("body_short", "The message is very short; confirm it includes the needed context."));
  }
  if (bodyText && !/<a\b[^>]*href=/i.test(String(body || ""))) {
    warnings.push(qualityItem("cta_missing", "No linked call to action was detected."));
  }

  return {
    ready: blockers.length === 0,
    campaignType: normalizedType,
    blockers,
    warnings,
    passed,
    compliance: {
      topicKey: preferenceStatus.topicKey,
      postalAddressPresent: address.complete,
      postalAddress: address.formatted,
      preferenceLinksConfigured: preferenceStatus.configured,
      checkedAt: new Date().toISOString()
    }
  };
}

export function assertEmailDraftReady(input = {}) {
  const result = analyzeEmailDraft(input);
  if (result.ready) return result;
  const error = new Error("Resolve the email readiness blockers before sending.");
  error.code = "EMAIL_COMPLIANCE_BLOCKED";
  error.statusCode = 409;
  error.details = { blockers: result.blockers };
  throw error;
}
