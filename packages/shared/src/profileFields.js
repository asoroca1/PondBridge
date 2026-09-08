// The set of profile fields a camp can choose to collect and show.
//
// Name, email and password are deliberately absent: they are identity, they are
// managed by the auth provider, and a network cannot run without them. Anything
// listed here is optional to the platform, so a camp can turn it off and every
// surface that renders it has to cope with the field simply not existing.
//
// `requires` is a hard parent link, not a hint: a major with no college on file
// is unreadable, so resolveProfileFields() forces a child off whenever its
// parent is off rather than leaving the two settings to disagree.

export const PROFILE_FIELD_GROUPS = Object.freeze([
  {
    key: "identity",
    label: "Name & contact",
    blurb: "What members are called, and how they can be reached."
  },
  {
    key: "camp",
    label: "Camp history",
    blurb: "How a member is connected to camp."
  },
  {
    key: "education",
    label: "Education",
    blurb: "Schools members went to before and after camp."
  },
  {
    key: "work",
    label: "Work",
    blurb: "What members do now, and what they did before."
  },
  {
    key: "social",
    label: "Social links",
    blurb: "Where members can be followed off PondBridge."
  }
]);

// Kept alongside the catalog so the settings page can show a director what is
// collected no matter what they do here, instead of leaving them to wonder
// whether turning everything off would leave a profile with nothing on it.
export const ALWAYS_ON_PROFILE_FIELDS = Object.freeze([
  {
    key: "name",
    label: "First and last name",
    description: "Used to identify a member everywhere. Managed with the account."
  },
  {
    key: "email",
    label: "Email address",
    description: "The login itself. Members choose who can see it on their profile."
  },
  {
    key: "photo",
    label: "Profile photo",
    description: "Optional for each member, but always offered."
  }
]);

export const PROFILE_FIELD_CATALOG = Object.freeze([
  {
    key: "nickname",
    group: "identity",
    label: "Camp nickname",
    description: "The name people actually called them at camp.",
    shownOn: ["Member profile", "Search results"],
    defaultEnabled: true
  },
  {
    key: "maidenName",
    group: "identity",
    label: "Maiden name",
    description:
      "Shown next to the last name so alumni who changed their name are still findable by the one their friends remember.",
    shownOn: ["Member profile", "Name search"],
    defaultEnabled: false
  },
  {
    key: "phone",
    group: "identity",
    label: "Phone number",
    description: "Members still choose who can see it; this decides whether it is asked for at all.",
    shownOn: ["Member profile contact card"],
    defaultEnabled: true
  },
  {
    key: "location",
    group: "identity",
    label: "City & state",
    description: "Where a member lives now.",
    shownOn: ["Member profile", "Directory cards", "Advanced search", "Alumni map"],
    defaultEnabled: true,
    // The map plots city/state and has nothing to draw without it.
    poweredModules: ["map"]
  },
  {
    key: "campRoles",
    group: "camp",
    label: "Role at camp",
    description: "Camper, counselor, and the rest of your staff roles.",
    shownOn: ["Member profile", "Advanced search"],
    defaultEnabled: true
  },
  {
    key: "camperYears",
    group: "camp",
    label: "Camper years",
    description: "The summers a member was a camper, with age group.",
    shownOn: ["Member profile", "Advanced search"],
    defaultEnabled: true
  },
  {
    key: "staffYears",
    group: "camp",
    label: "Staff years",
    description: "The summers a member was on staff.",
    shownOn: ["Member profile"],
    defaultEnabled: true
  },
  {
    key: "highSchool",
    group: "education",
    label: "High school",
    description: "Where a member went to high school.",
    shownOn: ["Member profile"],
    defaultEnabled: true
  },
  {
    key: "college",
    group: "education",
    label: "College & grad year",
    description: "Where a member went to college, and when they graduated.",
    shownOn: ["Member profile", "Advanced search"],
    defaultEnabled: true
  },
  {
    key: "collegeMajor",
    group: "education",
    label: "Major",
    description: "What they studied.",
    shownOn: ["Member profile"],
    requires: "college",
    defaultEnabled: true
  },
  {
    key: "greekLife",
    group: "education",
    label: "Greek life",
    description: "The fraternity or sorority a member was in, per college.",
    shownOn: ["Member profile"],
    requires: "college",
    defaultEnabled: false
  },
  {
    key: "industry",
    group: "work",
    label: "Industry",
    description: "The field a member works in.",
    shownOn: ["Member profile", "Directory cards", "Advanced search"],
    defaultEnabled: true
  },
  {
    key: "currentJobs",
    group: "work",
    label: "Current role",
    description: "Job title and company today.",
    shownOn: ["Member profile", "Directory cards", "Advanced search"],
    defaultEnabled: true
  },
  {
    key: "pastJobs",
    group: "work",
    label: "Past roles",
    description: "Earlier jobs, shown under the current one.",
    shownOn: ["Member profile"],
    defaultEnabled: true
  },
  {
    key: "socialLinkedin",
    group: "social",
    label: "LinkedIn",
    description: "",
    shownOn: ["Member profile"],
    defaultEnabled: true
  },
  {
    key: "socialInstagram",
    group: "social",
    label: "Instagram",
    description: "",
    shownOn: ["Member profile"],
    defaultEnabled: true
  },
  {
    key: "socialFacebook",
    group: "social",
    label: "Facebook",
    description: "",
    shownOn: ["Member profile"],
    defaultEnabled: true
  }
]);

export const PROFILE_FIELD_KEYS = Object.freeze(PROFILE_FIELD_CATALOG.map((field) => field.key));

export const DEFAULT_PROFILE_FIELDS = Object.freeze(
  Object.fromEntries(PROFILE_FIELD_CATALOG.map((field) => [field.key, field.defaultEnabled]))
);

/**
 * Normalize whatever is stored on the tenant into a complete, self-consistent
 * map. Unknown keys are dropped, missing keys take the catalog default, and a
 * child of a disabled parent is forced off.
 */
export function resolveProfileFields(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const resolved = {};

  for (const field of PROFILE_FIELD_CATALOG) {
    resolved[field.key] = Object.prototype.hasOwnProperty.call(source, field.key)
      ? Boolean(source[field.key])
      : field.defaultEnabled;
  }

  for (const field of PROFILE_FIELD_CATALOG) {
    if (field.requires && !resolved[field.requires]) resolved[field.key] = false;
  }

  return resolved;
}

export function isProfileFieldEnabled(fields = {}, key = "") {
  const resolved = resolveProfileFields(fields);
  return Boolean(resolved[String(key || "")]);
}

/** True when every social network is switched off, so the card can be skipped. */
export function hasAnySocialProfileField(fields = {}) {
  const resolved = resolveProfileFields(fields);
  return Boolean(resolved.socialLinkedin || resolved.socialInstagram || resolved.socialFacebook);
}
