export const CATEGORY_OPTIONS = [
  { value: "announcements", label: "Announcement" },
  { value: "events", label: "Events & info sessions" },
  { value: "community", label: "Community" },
  { value: "account", label: "Account" },
  { value: "admin", label: "Admin" }
];

export const AUDIENCE_OPTIONS = [
  { value: "all_active_members", label: "All active members" },
  { value: "all_users", label: "Everyone, including pending" },
  { value: "admins", label: "Admins only" },
  { value: "pending_members", label: "Pending members" },
  { value: "flagged_members", label: "Flagged members" },
  { value: "specific_members", label: "Specific people" }
];

// How anything reaches a phone at all. These gate every alert, automatic or not.
export const DELIVERY_TOGGLES = [
  {
    key: "pushEnabled",
    label: "Push to lock screens",
    blurb: "Without this, alerts only appear once someone opens the app."
  },
  {
    key: "inboxEnabled",
    label: "Keep a copy in the app inbox",
    blurb: "Members can scroll back through what they missed."
  },
  {
    key: "soundEnabled",
    label: "Play a sound",
    blurb: "Silent pushes still show on the lock screen."
  },
  {
    key: "customBroadcasts",
    label: "Allow one-off alerts",
    blurb: "Turn off to lock this down to automatic alerts only."
  }
];

// Split by who gets interrupted, because that is the thing worth thinking about.
export const AUTOMATIC_GROUPS = [
  {
    key: "staff",
    label: "Sent to you and your admins",
    blurb: "Things you would want to know about as they happen.",
    items: [
      { key: "newMemberJoined", label: "Someone joins the network" },
      { key: "approvalRequests", label: "Someone requests access" },
      { key: "memberFlagged", label: "A member gets flagged" }
    ]
  },
  {
    key: "members",
    label: "Sent to your members",
    blurb: "Keep these on unless you would rather announce things yourself.",
    items: [
      { key: "eventPublished", label: "An event or info session is published" },
      { key: "eventCanceled", label: "An event or info session is canceled" },
      { key: "newsletterPublished", label: "A newsletter goes out" }
    ]
  }
];

export const DEFAULT_PREFS = {
  mobileEnabled: true,
  pushEnabled: true,
  inboxEnabled: true,
  soundEnabled: true,
  newMemberJoined: true,
  approvalRequests: true,
  memberFlagged: true,
  weeklySummary: false,
  eventPublished: true,
  eventCanceled: true,
  newsletterPublished: true,
  customBroadcasts: true
};

export const DEFAULT_COMPOSE = {
  audience: "all_active_members",
  category: "announcements",
  title: "",
  body: "",
  deepLink: "",
  pushRequested: true,
  scheduleAt: "",
  userIds: []
};

export function audienceLabel(value = "") {
  return AUDIENCE_OPTIONS.find((option) => option.value === value)?.label || "Selected audience";
}

export function categoryLabel(value = "") {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label || value || "—";
}

export function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatScheduleStatus(status) {
  const key = String(status || "").trim().toLowerCase();
  if (key === "pending") return "Scheduled";
  if (key === "sent") return "Sent";
  if (key === "failed") return "Failed";
  if (key === "canceled") return "Canceled";
  if (key === "sending") return "Sending…";
  return status || "—";
}

/**
 * The server refuses a send outright when the network is off or one-off alerts
 * are disabled, so the UI has to know the same rule to explain it up front
 * instead of surfacing a 400 after the form is filled in.
 */
export function sendBlockReason(settings = {}) {
  if (!settings.mobileEnabled) return "off";
  if (!settings.customBroadcasts) return "broadcasts";
  if (!settings.pushEnabled && !settings.inboxEnabled) return "nowhere";
  return "";
}
