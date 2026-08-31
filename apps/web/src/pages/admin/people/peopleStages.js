// One person moves through these stages; the workspace rail is this list.
export const STAGES = [
  {
    key: "all",
    label: "Everyone",
    tone: "neutral",
    blurb: "Every person this camp knows about, at any stage."
  },
  {
    key: "member",
    label: "Members",
    tone: "success",
    blurb: "People who have joined and can sign in."
  },
  {
    key: "request",
    label: "Requests",
    tone: "attention",
    blurb: "Waiting on your approval to join.",
    urgent: true
  },
  {
    key: "invited",
    label: "Invited",
    tone: "info",
    blurb: "Invitation sent and still valid."
  },
  {
    key: "expired",
    label: "Expired",
    tone: "warning",
    blurb: "Invitation lapsed without being used."
  },
  {
    key: "prospect",
    label: "Prospects",
    tone: "neutral",
    blurb: "Known alumni who have not been invited yet."
  },
  {
    key: "on_hold",
    label: "On hold",
    tone: "muted",
    blurb: "Excluded from every invitation and campaign."
  }
];

export const STAGE_LABELS = Object.fromEntries(STAGES.map((stage) => [stage.key, stage.label]));

export function stageMeta(key = "") {
  return STAGES.find((stage) => stage.key === key) || STAGES[0];
}

export function stageTone(key = "") {
  return stageMeta(key).tone;
}

/** Stages whose people can be sent an invitation. */
export const INVITABLE_STAGES = new Set(["prospect", "expired"]);

export function isInvitable(person = {}) {
  return INVITABLE_STAGES.has(person.stage) && Boolean(person.email);
}

export function canApprove(person = {}) {
  return person.stage === "request" && Boolean(person.requestId);
}

export function personName(person = {}) {
  return String(person.fullName || "").trim() || String(person.email || "").trim() || "Unknown person";
}

export function personInitials(person = {}) {
  const name = personName(person);
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "?";
}

export function formatDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The one line that best explains where this person stands right now. */
export function stageSummary(person = {}) {
  if (person.stage === "member") {
    return person.lastActiveAt
      ? `Joined ${formatDate(person.joinedAt)} · last active ${formatDate(person.lastActiveAt)}`
      : `Joined ${formatDate(person.joinedAt)}`;
  }
  if (person.stage === "request") return `Requested ${formatDate(person.requestedAt)}`;
  if (person.stage === "invited") return `Invited ${formatDate(person.lastInvitedAt)} · expires ${formatDate(person.inviteExpiresAt)}`;
  if (person.stage === "expired") return `Invite expired ${formatDate(person.inviteExpiresAt)}`;
  if (person.stage === "on_hold") return "Excluded from invitations and campaigns";
  return person.inviteCount ? `${person.inviteCount} past invitation${person.inviteCount === 1 ? "" : "s"}` : "Never invited";
}

/**
 * When hundreds of people are waiting, the first question a director asks is
 * "did we ask this person to join?" — so every request row answers it before
 * anything else.
 */
export const RECOGNITION = {
  invited: {
    label: "On your invite list",
    tone: "success",
    blurb: "You sent this person an invitation."
  },
  known: {
    label: "Known alumni",
    tone: "info",
    blurb: "Matches an alumni record you uploaded, but no invitation was sent."
  },
  unrecognized: {
    label: "Unrecognized",
    tone: "warning",
    blurb: "No invitation and no matching alumni record. Worth a closer look."
  }
};

export function recognitionMeta(key = "") {
  return RECOGNITION[key] || RECOGNITION.unrecognized;
}
