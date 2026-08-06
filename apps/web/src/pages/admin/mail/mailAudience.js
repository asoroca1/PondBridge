// Audience helpers for the director mail composer.
//
// The composer models recipients the way a mail client does: the "To" line is a
// list of chips. Each chip carries one or more targeting rules (a saved group
// can hold several), and the send payload is the union of every chip.

export const GROWTH_SEGMENT_OPTIONS = [
  { value: "new_30", label: "New members (last 30 days)" },
  { value: "inactive_30", label: "Inactive 30+ days" },
  { value: "inactive_60", label: "Inactive 60+ days" },
  { value: "inactive_90", label: "Inactive 90+ days" },
  { value: "profile_incomplete", label: "Incomplete profiles" }
];

export const DEFAULT_STAFF_ROLES = ["Camper", "Counselor", "JC", "CIT", "Admin"];

export const EMPTY_TARGETING = { mode: "composite", groups: [], label: "" };

export function generateYearRange(count = 40) {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let year = currentYear; year >= currentYear - count; year -= 1) {
    years.push(String(year));
  }
  return years;
}

export function normalizeIdList(value = []) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
}

export function normalizeRule(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const mode = String(source.mode || "all").trim().toLowerCase();
  return {
    mode: ["all", "role", "year", "segment", "custom"].includes(mode) ? mode : "all",
    roles: Array.isArray(source.roles) ? source.roles.map((item) => String(item || "").trim()).filter(Boolean) : [],
    years: Array.isArray(source.years) ? source.years.map((item) => String(item || "").trim()).filter(Boolean) : [],
    profileIds: normalizeIdList(source.profileIds || []),
    segment: String(source.segment || "").trim().toLowerCase()
  };
}

export function isUsableRule(rule = {}) {
  const normalized = normalizeRule(rule);
  if (normalized.mode === "role") return normalized.roles.length > 0;
  if (normalized.mode === "year") return normalized.years.length > 0;
  if (normalized.mode === "custom") return normalized.profileIds.length > 0;
  if (normalized.mode === "segment") {
    return GROWTH_SEGMENT_OPTIONS.some((item) => item.value === normalized.segment);
  }
  return normalized.mode === "all";
}

export function normalizeRules(value = []) {
  return (Array.isArray(value) ? value : [value])
    .map((rule) => normalizeRule(rule))
    .filter((rule) => isUsableRule(rule));
}

export function ruleKey(rule = {}) {
  const normalized = normalizeRule(rule);
  return [
    normalized.mode,
    [...normalized.roles].sort().join("|"),
    [...normalized.years].sort().join("|"),
    [...normalized.profileIds].sort().join("|"),
    normalized.segment
  ].join("::");
}

export function rulesKey(rules = []) {
  return normalizeRules(rules).map(ruleKey).sort().join("&&");
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export function everyoneChip() {
  return { key: "all", kind: "all", label: "All members", rules: [{ mode: "all" }] };
}

export function roleChip(role = "") {
  const name = String(role || "").trim();
  return {
    key: `role:${name.toLowerCase()}`,
    kind: "role",
    label: name,
    rules: [{ mode: "role", roles: [name] }]
  };
}

export function yearChip(year = "") {
  const value = String(year || "").trim();
  return {
    key: `year:${value}`,
    kind: "year",
    label: `Class of ${value}`,
    rules: [{ mode: "year", years: [value] }]
  };
}

export function segmentChip(segment = "") {
  const value = String(segment || "").trim().toLowerCase();
  const option = GROWTH_SEGMENT_OPTIONS.find((item) => item.value === value);
  return {
    key: `segment:${value}`,
    kind: "segment",
    label: option?.label || "Engagement group",
    rules: [{ mode: "segment", segment: value }]
  };
}

export function personChip(member = {}) {
  const id = String(member?.id || "").trim();
  const name = String(member?.fullName || member?.name || "").trim();
  const email = String(member?.email || "").trim();
  return {
    key: `person:${id}`,
    kind: "person",
    label: name || email || "Member",
    detail: name ? email : "",
    rules: [{ mode: "custom", profileIds: [id] }]
  };
}

export function groupChip(group = {}) {
  const id = String(group?.id || "").trim();
  const rules = normalizeRules(group?.rules || []);
  return {
    key: `group:${id}`,
    kind: "group",
    groupId: id,
    label: String(group?.name || "Saved group"),
    detail: String(group?.description || "") || describeRules(rules),
    rules
  };
}

export function dedupeChips(chips = []) {
  const seen = new Set();
  const output = [];
  for (const chip of chips) {
    if (!chip?.key || seen.has(chip.key) || !normalizeRules(chip.rules).length) continue;
    seen.add(chip.key);
    output.push(chip);
  }
  return output;
}

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------

export function describeRule(rule = {}) {
  const normalized = normalizeRule(rule);
  if (normalized.mode === "all") return "Everyone in the network";
  if (normalized.mode === "role") return normalized.roles.join(", ");
  if (normalized.mode === "year") {
    return normalized.years.length > 3
      ? `${normalized.years.length} class years`
      : normalized.years.map((year) => `Class of ${year}`).join(", ");
  }
  if (normalized.mode === "segment") {
    return GROWTH_SEGMENT_OPTIONS.find((item) => item.value === normalized.segment)?.label || "Engagement group";
  }
  const count = normalized.profileIds.length;
  return `${count} hand-picked ${count === 1 ? "member" : "members"}`;
}

export function describeRules(rules = []) {
  const normalized = normalizeRules(rules);
  if (!normalized.length) return "No audience yet";
  return normalized.map(describeRule).join(" · ");
}

export function describeChips(chips = []) {
  const usable = dedupeChips(chips);
  if (!usable.length) return "No recipients yet";
  if (usable.length <= 3) return usable.map((chip) => chip.label).join(", ");
  return `${usable.slice(0, 2).map((chip) => chip.label).join(", ")} +${usable.length - 2} more`;
}

// ---------------------------------------------------------------------------
// Targeting payload
// ---------------------------------------------------------------------------

/**
 * Collapses rules into the smallest targeting payload the API can resolve.
 * Rules of the same kind merge into one, so a 40-person "To" line costs one
 * query rather than 40, and any rule meaning "everyone" absorbs the rest.
 */
export function buildTargeting(rules = [], label = "") {
  const normalized = normalizeRules(rules);
  if (!normalized.length) return { ...EMPTY_TARGETING, label: "" };

  const roles = new Set();
  const years = new Set();
  const profileIds = new Set();
  const segments = new Set();
  let includesEveryone = false;

  for (const rule of normalized) {
    if (rule.mode === "all") includesEveryone = true;
    else if (rule.mode === "role") rule.roles.forEach((role) => roles.add(role));
    else if (rule.mode === "year") rule.years.forEach((year) => years.add(year));
    else if (rule.mode === "custom") rule.profileIds.forEach((id) => profileIds.add(id));
    else if (rule.mode === "segment" && rule.segment) segments.add(rule.segment);
  }

  // Every other rule is a subset of "all members", so the union is just everyone.
  if (includesEveryone) return { mode: "all", roles: [], years: [], profileIds: [], segment: "", label };

  const merged = [];
  if (roles.size) merged.push({ mode: "role", roles: [...roles] });
  if (years.size) merged.push({ mode: "year", years: [...years] });
  if (profileIds.size) merged.push({ mode: "custom", profileIds: [...profileIds] });
  for (const segment of segments) merged.push({ mode: "segment", segment });

  if (merged.length === 1) return { ...normalizeRule(merged[0]), label };
  return { mode: "composite", groups: merged.map((rule) => normalizeRule(rule)), label };
}

export function buildTargetingFromChips(chips = []) {
  const usable = dedupeChips(chips);
  return buildTargeting(usable.flatMap((chip) => chip.rules), describeChips(usable));
}

/**
 * Rebuilds chips from a stored targeting payload (a saved draft, "copy as new",
 * or a deep link from the members table).
 */
export function chipsFromTargeting(targeting = {}, { groups = [], memberById = {} } = {}) {
  const source = targeting && typeof targeting === "object" ? targeting : {};
  const rules = String(source.mode || "").toLowerCase() === "composite"
    ? (Array.isArray(source.groups) ? source.groups : [])
    : [source];

  // When the whole audience is exactly one saved group, keep it as a group chip
  // so editing that group later still updates the message. Anything else is
  // shown as its individual parts, which stay editable one at a time.
  const incomingKey = rulesKey(buildTargeting(rules).mode === "composite"
    ? buildTargeting(rules).groups
    : [buildTargeting(rules)]);
  const exactGroup = groups.find((group) => {
    const groupTargeting = buildTargeting(group?.rules || []);
    const groupRules = groupTargeting.mode === "composite" ? groupTargeting.groups : [groupTargeting];
    return normalizeRules(groupRules).length > 0 && rulesKey(groupRules) === incomingKey;
  });
  if (exactGroup) return [groupChip(exactGroup)];

  const chips = [];
  for (const item of rules) {
    const rule = normalizeRule(item);
    if (!isUsableRule(rule)) continue;
    if (rule.mode === "all") chips.push(everyoneChip());
    else if (rule.mode === "role") rule.roles.forEach((role) => chips.push(roleChip(role)));
    else if (rule.mode === "year") rule.years.forEach((year) => chips.push(yearChip(year)));
    else if (rule.mode === "segment") chips.push(segmentChip(rule.segment));
    else if (rule.mode === "custom") {
      rule.profileIds.forEach((id) => chips.push(personChip({ id, ...(memberById[id] || {}) })));
    }
  }

  return dedupeChips(chips);
}

export function profileIdsFromChips(chips = []) {
  const ids = new Set();
  for (const chip of dedupeChips(chips)) {
    for (const rule of normalizeRules(chip.rules)) {
      if (rule.mode === "custom") rule.profileIds.forEach((id) => ids.add(id));
    }
  }
  return [...ids];
}

export function chipsToGroupRules(chips = []) {
  const targeting = buildTargetingFromChips(chips);
  if (targeting.mode === "composite") return targeting.groups;
  if (!isUsableRule(targeting)) return [];
  return [normalizeRule(targeting)];
}
