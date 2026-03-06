import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { PageHeader } from "../../components/admin/AdminUi.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import useAdminApi from "./useAdminApi.js";

function parseIdsParam(value = "") {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

function normalizeMemberRowId(member = null) {
  return String(member?.id || "").trim();
}

function useDebouncedValue(value, delayMs = 220) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), Math.max(0, Number(delayMs) || 0));
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

const INVITE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MEMBER_EXPORT_STORAGE_PREFIX = "pb_admin_members_export_fields";
const MEMBER_EXPORT_PRESET_STORAGE_PREFIX = "pb_admin_members_export_presets";
const INVITE_HIDDEN_STORAGE_PREFIX = "pb_admin_hidden_invites";
const EMAIL_RECIPIENT_GROUPS_STORAGE_PREFIX = "pb_admin_email_recipient_groups";
const FALLBACK_MEMBER_EXPORT_FIELDS = [
  { key: "profileId", label: "Profile ID", description: "Internal profile identifier." },
  { key: "userId", label: "User ID", description: "Account user identifier linked to this profile." },
  { key: "firstName", label: "First Name", description: "Profile first name." },
  { key: "nickname", label: "Nickname", description: "Camp nickname from profile/social fields." },
  { key: "lastName", label: "Last Name", description: "Profile last name." },
  { key: "fullName", label: "Full Name", description: "Combined first and last name." },
  { key: "status", label: "Status", description: "Member access status." },
  { key: "primaryEmail", label: "Primary Email", description: "First email on the profile." },
  { key: "allEmails", label: "All Emails", description: "All profile emails." },
  { key: "primaryPhone", label: "Primary Phone", description: "First phone on the profile." },
  { key: "allPhones", label: "All Phones", description: "All profile phones." },
  { key: "cityState", label: "Location", description: "City and state/country value." },
  { key: "city", label: "City", description: "City parsed from location." },
  { key: "state", label: "State", description: "State/region parsed from location." },
  { key: "country", label: "Country", description: "Country parsed from location." },
  { key: "roleAtCamp", label: "Role At Camp", description: "Member's role at camp." },
  { key: "allRoles", label: "All Roles", description: "Primary role plus additional role tags." },
  { key: "industry", label: "Industry", description: "Industry from profile." },
  { key: "highSchool", label: "High School", description: "High school field from profile." },
  { key: "colleges", label: "Colleges", description: "College history from profile." },
  { key: "collegeYears", label: "College Years", description: "College graduation/class years." },
  { key: "collegeMajors", label: "College Majors", description: "Majors captured on the profile." },
  { key: "educationRows", label: "Education Rows", description: "Combined college, year, and major rows." },
  { key: "currentCompany", label: "Current Company", description: "Current company from first job entry." },
  { key: "currentTitle", label: "Current Title", description: "Current title from first job entry." },
  { key: "currentJobs", label: "Current Jobs", description: "All current job entries." },
  { key: "pastJobs", label: "Past Jobs", description: "All past job entries." },
  { key: "camperFirstYear", label: "Camper First Year", description: "First camper year from profile stints." },
  { key: "camperLastYear", label: "Camper Last Year", description: "Last camper year from profile stints." },
  { key: "camperYearStints", label: "Camper Year Stints", description: "Camper year ranges." },
  { key: "staffFirstYear", label: "Staff First Year", description: "First staff year from profile stints." },
  { key: "staffLastYear", label: "Staff Last Year", description: "Last staff year from profile stints." },
  { key: "staffYearStints", label: "Staff Year Stints", description: "Staff year ranges." },
  { key: "linkedin", label: "LinkedIn", description: "LinkedIn URL from social links." },
  { key: "instagram", label: "Instagram", description: "Instagram URL from social links." },
  { key: "facebook", label: "Facebook", description: "Facebook URL from social links." },
  { key: "avatarUrl", label: "Avatar URL", description: "Profile avatar image URL." },
  { key: "bio", label: "Bio", description: "Profile bio text." },
  { key: "joinDate", label: "Join Date", description: "Profile creation date (ISO)." },
  { key: "updatedAt", label: "Last Updated", description: "Profile last update timestamp (ISO)." },
  { key: "socialsJson", label: "Socials JSON", description: "Raw socials object for full fidelity export." },
  { key: "profileJson", label: "Profile JSON", description: "Raw profile object for full fidelity export." }
];
const FALLBACK_MEMBER_EXPORT_DEFAULT_FIELDS = [
  "firstName",
  "lastName",
  "primaryEmail"
];

function createInviteRow() {
  return {
    id: `invite_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    firstName: "",
    lastName: "",
    email: ""
  };
}

function normalizeInviteName(value = "") {
  return String(value || "").trim().slice(0, 80);
}

function normalizeInviteEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isValidInviteEmail(value = "") {
  return INVITE_EMAIL_REGEX.test(normalizeInviteEmail(value));
}

function memberExportStorageKey(slug = "") {
  return `${MEMBER_EXPORT_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
}

function memberExportPresetStorageKey(slug = "") {
  return `${MEMBER_EXPORT_PRESET_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
}

function hiddenInviteStorageKey(slug = "") {
  return `${INVITE_HIDDEN_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
}

function emailRecipientGroupStorageKey(slug = "") {
  return `${EMAIL_RECIPIENT_GROUPS_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
}

function readSavedMemberExportFields(slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(memberExportStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedMemberExportFields(slug = "", keys = []) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(memberExportStorageKey(slug), JSON.stringify(keys));
  } catch {
    // Ignore storage failures.
  }
}

function normalizeExportPresetName(value = "") {
  return String(value || "").trim().slice(0, 64);
}

function readSavedMemberExportPresets(slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(memberExportPresetStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedMemberExportPresets(slug = "", presets = []) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(memberExportPresetStorageKey(slug), JSON.stringify(presets));
  } catch {
    // Ignore storage failures.
  }
}

function readHiddenInviteIds(slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(hiddenInviteStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeHiddenInviteIds(slug = "", ids = []) {
  if (typeof window === "undefined") return;
  const normalized = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )].slice(-5000);
  try {
    localStorage.setItem(hiddenInviteStorageKey(slug), JSON.stringify(normalized));
  } catch {
    // Ignore storage failures.
  }
}

function normalizeProfileIdList(value = []) {
  const source = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",")
        .map((item) => String(item || "").trim());
  return [...new Set(
    source
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
}

function normalizeEmailRecipientGroupName(value = "") {
  return String(value || "").trim().slice(0, 72);
}

function emailRecipientGroupNameKey(value = "") {
  return normalizeEmailRecipientGroupName(value).toLowerCase();
}

function readSavedEmailRecipientGroups(slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(emailRecipientGroupStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const groups = [];
    for (const item of parsed) {
      const id = String(item?.id || "").trim();
      const name = normalizeEmailRecipientGroupName(item?.name || "");
      const profileIds = normalizeProfileIdList(item?.profileIds || []);
      if (!id || !name || !profileIds.length) continue;
      groups.push({
        id,
        name,
        profileIds,
        updatedAt: String(item?.updatedAt || "")
      });
    }
    return groups.slice(0, 60);
  } catch {
    return [];
  }
}

function writeSavedEmailRecipientGroups(slug = "", groups = []) {
  if (typeof window === "undefined") return;
  const normalized = [];
  const seen = new Set();
  for (const item of Array.isArray(groups) ? groups : []) {
    const id = String(item?.id || "").trim();
    const name = normalizeEmailRecipientGroupName(item?.name || "");
    const profileIds = normalizeProfileIdList(item?.profileIds || []);
    if (!id || !name || !profileIds.length || seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      id,
      name,
      profileIds,
      updatedAt: String(item?.updatedAt || "")
    });
    if (normalized.length >= 60) break;
  }
  try {
    localStorage.setItem(emailRecipientGroupStorageKey(slug), JSON.stringify(normalized));
  } catch {
    // Ignore storage failures.
  }
}

function normalizeEmailFooterPresetName(value = "") {
  return String(value || "").trim().slice(0, 72);
}

function normalizeEmailFooterField(value = "", max = 140, options = {}) {
  const { trimMode = "both" } = options || {};
  const clipped = String(value || "").slice(0, max);
  if (trimMode === "none") return clipped;
  if (trimMode === "start") return clipped.trimStart();
  if (trimMode === "end") return clipped.trimEnd();
  return clipped.trim();
}

function normalizeEmailFooter(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const senderEmailRaw = normalizeEmailFooterField(source.senderEmail ?? base.senderEmail ?? "", 160).trim().toLowerCase();
  const senderEmail = INVITE_EMAIL_REGEX.test(senderEmailRaw) ? senderEmailRaw : "";
  return {
    headerTagline: normalizeEmailFooterField(source.headerTagline ?? base.headerTagline ?? "Community update", 72) || "Community update",
    signOff: normalizeEmailFooterField(source.signOff ?? base.signOff ?? "Warmly,", 80) || "Warmly,",
    senderName: normalizeEmailFooterField(source.senderName ?? base.senderName ?? "", 120, { trimMode: "start" }),
    senderRole: normalizeEmailFooterField(source.senderRole ?? base.senderRole ?? "Director", 120, { trimMode: "start" }),
    senderEmail,
    senderPhone: normalizeEmailFooterField(source.senderPhone ?? base.senderPhone ?? "", 48),
    showLogo: source.showLogo !== undefined ? Boolean(source.showLogo) : base.showLogo !== false,
    logoUrl: normalizeEmailFooterField(source.logoUrl ?? base.logoUrl ?? "", 1200)
  };
}

function normalizeEmailFooterPresets(presets = [], fallbackFooter = {}) {
  const source = Array.isArray(presets) ? presets : [];
  const fallback = normalizeEmailFooter(
    fallbackFooter,
    {
      signOff: "Warmly,",
      headerTagline: "Community update",
      senderName: "",
      senderRole: "Director",
      senderEmail: "",
      senderPhone: "",
      showLogo: true,
      logoUrl: ""
    }
  );
  const normalized = [];
  const seenIds = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const id = String(item?.id || "").trim().slice(0, 90) || `footer_${index + 1}`;
    if (!id || seenIds.has(id)) continue;
    const name = normalizeEmailFooterPresetName(item?.name || "");
    if (!name) continue;
    seenIds.add(id);
    normalized.push({
      id,
      name,
      footer: normalizeEmailFooter(item?.footer || {}, fallback),
      updatedAt: String(item?.updatedAt || "")
    });
    if (normalized.length >= 20) break;
  }
  if (normalized.length === 0) {
    normalized.push({
      id: "default_footer",
      name: "Default Footer",
      footer: fallback,
      updatedAt: ""
    });
  }
  return normalized;
}

function composeName(value = {}) {
  const firstName = String(value?.firstName || "").trim();
  const lastName = String(value?.lastName || "").trim();
  const full = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return String(value?.name || "").trim();
}

function createFallbackEmailFooter({ tenant = null, user = null } = {}) {
  const senderName = composeName(user);
  const senderRole = Array.isArray(user?.roles) && user.roles.some((role) => String(role || "").toLowerCase() === "tenant_admin")
    ? "Director"
    : "Admin";
  const senderEmail = String(user?.email || tenant?.content?.contactEmail || "").trim().toLowerCase();
  return normalizeEmailFooter(
    {
      signOff: "Warmly,",
      headerTagline: "Community update",
      senderName,
      senderRole,
      senderEmail,
      senderPhone: "",
      showLogo: true,
      logoUrl: String(tenant?.theme?.logoUrl || "").trim()
    },
    {}
  );
}

function previewTextFromHtmlLike(value = "") {
  return String(value || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}


export default function DirectorAdminEmailComposePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { slug, request } = useAdminApi();
  const { tenant } = useTenant();
  const { user } = useAuth();
  const initialSelectedIds = parseIdsParam(searchParams.get("selected") || "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [recipientPreview, setRecipientPreview] = useState({ count: 0, excludedCount: 0, preview: [] });
  const [memberQuery, setMemberQuery] = useState("");
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchResults, setMemberSearchResults] = useState([]);
  const [selectedMemberById, setSelectedMemberById] = useState({});
  const [savedRecipientGroups, setSavedRecipientGroups] = useState([]);
  const [selectedRecipientGroupId, setSelectedRecipientGroupId] = useState("");
  const [recipientGroupName, setRecipientGroupName] = useState("");
  const fallbackFooter = useMemo(
    () => createFallbackEmailFooter({ tenant, user }),
    [tenant, user]
  );
  const [footerPresets, setFooterPresets] = useState([]);
  const [selectedFooterPresetId, setSelectedFooterPresetId] = useState("");
  const [footerPresetName, setFooterPresetName] = useState("");
  const [footerDraft, setFooterDraft] = useState(fallbackFooter);
  const [footerSaving, setFooterSaving] = useState(false);
  const [loadingFooterPresets, setLoadingFooterPresets] = useState(true);
  const [footerPanelOpen, setFooterPanelOpen] = useState(false);
  const [form, setForm] = useState({
    mode: initialSelectedIds.length > 0 ? "individual" : "all",
    profileIds: initialSelectedIds,
    subject: String(searchParams.get("subject") || ""),
    body: String(searchParams.get("body") || ""),
    scheduleType: "now",
    scheduledFor: ""
  });

  useEffect(() => {
    const groups = readSavedEmailRecipientGroups(slug);
    setSavedRecipientGroups(groups);
    setSelectedRecipientGroupId(groups[0]?.id || "");
  }, [slug]);

  useEffect(() => {
    let active = true;
    setLoadingFooterPresets(true);
    request("/email/footer-presets")
      .then((payload) => {
        if (!active) return;
        const presets = normalizeEmailFooterPresets(payload?.presets || [], fallbackFooter);
        const requestedDefaultId = String(payload?.defaultPresetId || "").trim();
        const selectedId = presets.some((item) => item.id === requestedDefaultId)
          ? requestedDefaultId
          : String(presets[0]?.id || "");
        const selectedPreset = presets.find((item) => item.id === selectedId);
        const nextFooter = normalizeEmailFooter(payload?.activeFooter || {}, selectedPreset?.footer || fallbackFooter);
        setFooterPresets(presets);
        setSelectedFooterPresetId(selectedId);
        setFooterPresetName(selectedPreset?.name || "");
        setFooterDraft(nextFooter);
      })
      .catch(() => {
        if (!active) return;
        const presets = normalizeEmailFooterPresets([], fallbackFooter);
        const selectedId = String(presets[0]?.id || "");
        setFooterPresets(presets);
        setSelectedFooterPresetId(selectedId);
        setFooterPresetName(String(presets[0]?.name || ""));
        setFooterDraft(normalizeEmailFooter(presets[0]?.footer || {}, fallbackFooter));
      })
      .finally(() => {
        if (active) setLoadingFooterPresets(false);
      });

    return () => {
      active = false;
    };
  }, [fallbackFooter, request]);

  const targeting = useMemo(() => {
    const mode = form.mode === "all" ? "all" : "custom";
    const activePreset = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId);
    return {
      mode,
      roles: [],
      years: [],
      profileIds: mode === "custom" ? normalizeProfileIdList(form.profileIds) : [],
      label: form.mode === "all"
        ? "All Members"
        : form.mode === "individual"
        ? "Specific People"
        : normalizeEmailRecipientGroupName(recipientGroupName) || activePreset?.name || "Custom Group"
    };
  }, [form.mode, form.profileIds, recipientGroupName, savedRecipientGroups, selectedRecipientGroupId]);

  useEffect(() => {
    if (form.mode === "all") {
      setMemberSearchResults([]);
      setMemberSearchLoading(false);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(async () => {
      setMemberSearchLoading(true);
      try {
        const params = new URLSearchParams({
          page: "1",
          pageSize: "12",
          q: String(memberQuery || "").trim(),
          role: "all",
          year: "all",
          status: "all",
          completion: "all",
          sort: "name_asc"
        });
        const payload = await request(`/members?${params.toString()}`);
        if (!active) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setMemberSearchResults(items.filter((item) => !form.profileIds.includes(item.id)).slice(0, 12));
      } catch {
        if (!active) return;
        setMemberSearchResults([]);
      } finally {
        if (active) setMemberSearchLoading(false);
      }
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [form.mode, form.profileIds, memberQuery, request]);

  useEffect(() => {
    if (!form.profileIds.length) return;
    const missing = form.profileIds.filter((id) => !selectedMemberById[id]);
    if (!missing.length) return;
    let active = true;
    request(`/members/lookup?ids=${encodeURIComponent(missing.join(","))}`)
      .then((payload) => {
        if (!active) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        if (!items.length) return;
        setSelectedMemberById((current) => {
          const next = { ...current };
          for (const item of items) {
            const id = String(item?.id || "").trim();
            if (!id) continue;
            next[id] = {
              id,
              fullName: String(item?.fullName || "Member").trim() || "Member",
              email: String(item?.email || "").trim()
            };
          }
          return next;
        });
      })
      .catch(() => {})
      .finally(() => {});
    return () => {
      active = false;
    };
  }, [form.profileIds, request, selectedMemberById]);

  useEffect(() => {
    let active = true;
    request("/email/recipients-preview", {
      method: "POST",
      body: { targeting }
    })
      .then((payload) => {
        if (!active) return;
        setRecipientPreview(payload);
      })
      .catch(() => {
        if (!active) return;
        setRecipientPreview({ count: 0, excludedCount: 0, preview: [] });
      });

    return () => {
      active = false;
    };
  }, [request, targeting]);

  const selectedRecipients = useMemo(
    () =>
      normalizeProfileIdList(form.profileIds).map((id) => {
        const item = selectedMemberById[id];
        return {
          id,
          fullName: String(item?.fullName || `Member ${id.slice(0, 8)}`).trim(),
          email: String(item?.email || "").trim()
        };
      }),
    [form.profileIds, selectedMemberById]
  );

  const selectedFooterPreset = useMemo(
    () => footerPresets.find((item) => item.id === selectedFooterPresetId) || null,
    [footerPresets, selectedFooterPresetId]
  );

  const activeFooter = useMemo(
    () => normalizeEmailFooter(footerDraft, selectedFooterPreset?.footer || fallbackFooter),
    [fallbackFooter, footerDraft, selectedFooterPreset]
  );

  const networkName = String(tenant?.content?.networkDisplayName || tenant?.name || "Your Camp Network")
    .trim();
  const previewHeaderLogoUrl = String(tenant?.theme?.logoUrl || "").trim();
  const previewFooterLogoUrl = activeFooter.showLogo
    ? String(tenant?.theme?.logoUrl || activeFooter.logoUrl || "").trim()
    : "";
  const previewInitials = (networkName || "PondBridge")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase() || "")
    .join("") || "PB";
  const previewBody = previewTextFromHtmlLike(form.body);
  const footerContact = [activeFooter.senderEmail, activeFooter.senderPhone].filter(Boolean).join(" • ");

  function addRecipient(member) {
    const profileId = String(member?.id || "").trim();
    if (!profileId) return;
    setForm((prev) => {
      if (prev.profileIds.includes(profileId)) return prev;
      return { ...prev, profileIds: [...prev.profileIds, profileId] };
    });
    setSelectedMemberById((prev) => ({
      ...prev,
      [profileId]: {
        id: profileId,
        fullName: String(member?.fullName || member?.name || "Member").trim() || "Member",
        email: String(member?.email || "").trim()
      }
    }));
    setMemberSearchResults((prev) => prev.filter((item) => String(item?.id || "").trim() !== profileId));
  }

  function removeRecipient(profileId = "") {
    const normalized = String(profileId || "").trim();
    if (!normalized) return;
    setForm((prev) => ({
      ...prev,
      profileIds: prev.profileIds.filter((id) => id !== normalized)
    }));
  }

  function saveRecipientGroup() {
    const name = normalizeEmailRecipientGroupName(recipientGroupName);
    const profileIds = normalizeProfileIdList(form.profileIds);
    if (!name) {
      setError("Enter a group name before saving.");
      return;
    }
    if (!profileIds.length) {
      setError("Add at least one recipient before saving a group.");
      return;
    }
    const now = new Date().toISOString();
    const nameKey = emailRecipientGroupNameKey(name);
    const selectedGroup = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId) || null;
    const selectedMatchesName = selectedGroup
      ? emailRecipientGroupNameKey(selectedGroup.name) === nameKey
      : false;
    const existingByName = savedRecipientGroups.find(
      (item) => emailRecipientGroupNameKey(item.name) === nameKey
    ) || null;
    const existing = selectedMatchesName ? selectedGroup : existingByName;
    const createdId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const targetId = existing?.id || createdId;
    const nextGroups = existing
      ? savedRecipientGroups.map((item) =>
          item.id === targetId
            ? { ...item, name, profileIds, updatedAt: now }
            : item
        )
      : [{ id: targetId, name, profileIds, updatedAt: now }, ...savedRecipientGroups].slice(0, 60);
    writeSavedEmailRecipientGroups(slug, nextGroups);
    setSavedRecipientGroups(nextGroups);
    setSelectedRecipientGroupId(targetId);
    setStatus(`${existing ? "Updated" : "Saved"} group "${name}".`);
    setError("");
  }

  function applyRecipientGroup() {
    if (!selectedRecipientGroupId) return;
    const group = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId);
    if (!group) return;
    setForm((prev) => ({
      ...prev,
      mode: "custom_group",
      profileIds: normalizeProfileIdList(group.profileIds || [])
    }));
    setRecipientGroupName(group.name || "");
    setStatus(`Loaded group "${group.name}".`);
    setError("");
  }

  function deleteRecipientGroup() {
    if (!selectedRecipientGroupId) return;
    const group = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId);
    if (!group) return;
    const confirmed = window.confirm(`Delete recipient group "${group.name}"?`);
    if (!confirmed) return;
    const nextGroups = savedRecipientGroups.filter((item) => item.id !== selectedRecipientGroupId);
    writeSavedEmailRecipientGroups(slug, nextGroups);
    setSavedRecipientGroups(nextGroups);
    setSelectedRecipientGroupId(nextGroups[0]?.id || "");
    if (String(recipientGroupName || "").trim().toLowerCase() === String(group.name || "").trim().toLowerCase()) {
      setRecipientGroupName("");
    }
    setStatus(`Deleted group "${group.name}".`);
    setError("");
  }

  async function persistFooterPresets(nextPresets = [], defaultPresetId = "", nextSelectedId = "") {
    setFooterSaving(true);
    setError("");
    try {
      const payload = await request("/email/footer-presets", {
        method: "PATCH",
        body: {
          presets: nextPresets,
          defaultPresetId
        }
      });
      const presets = normalizeEmailFooterPresets(payload?.presets || nextPresets, fallbackFooter);
      const selectedIdCandidate = String(nextSelectedId || payload?.defaultPresetId || "").trim();
      const selectedId = presets.some((item) => item.id === selectedIdCandidate)
        ? selectedIdCandidate
        : String(payload?.defaultPresetId || presets[0]?.id || "");
      const selectedPreset = presets.find((item) => item.id === selectedId) || presets[0];
      const activeFooterPayload = normalizeEmailFooter(payload?.activeFooter || selectedPreset?.footer || {}, fallbackFooter);
      setFooterPresets(presets);
      setSelectedFooterPresetId(selectedId);
      setFooterPresetName(selectedPreset?.name || "");
      setFooterDraft(activeFooterPayload);
      return { ok: true, presets, selectedId, activeFooterPayload };
    } catch (requestError) {
      setError(requestError.message || "Failed to save footer presets.");
      return { ok: false };
    } finally {
      setFooterSaving(false);
    }
  }

  function applyFooterPreset() {
    if (!selectedFooterPresetId) return;
    const preset = footerPresets.find((item) => item.id === selectedFooterPresetId);
    if (!preset) return;
    setFooterPresetName(preset.name || "");
    setFooterDraft(normalizeEmailFooter(preset.footer || {}, fallbackFooter));
    setStatus(`Loaded footer "${preset.name}".`);
    setError("");
  }

  async function saveFooterPreset() {
    const name = normalizeEmailFooterPresetName(footerPresetName);
    if (!name) {
      setError("Enter a footer preset name before saving.");
      return;
    }
    const now = new Date().toISOString();
    const existingById = footerPresets.find((item) => item.id === selectedFooterPresetId) || null;
    const existingByName = footerPresets.find((item) => item.name.toLowerCase() === name.toLowerCase()) || null;
    const existing = existingById || existingByName;
    const nextPreset = {
      id: existing?.id || `footer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      footer: activeFooter,
      updatedAt: now
    };
    const nextPresets = existing
      ? footerPresets.map((item) => (item.id === existing.id ? nextPreset : item))
      : [nextPreset, ...footerPresets].slice(0, 20);
    const defaultId = footerPresets.some((item) => item.id === selectedFooterPresetId)
      ? selectedFooterPresetId
      : String(nextPresets[0]?.id || "");
    const result = await persistFooterPresets(nextPresets, defaultId, nextPreset.id);
    if (result.ok) {
      setStatus(`Saved footer "${name}".`);
      setError("");
    }
  }

  async function deleteFooterPreset() {
    if (!selectedFooterPresetId) return;
    const preset = footerPresets.find((item) => item.id === selectedFooterPresetId);
    if (!preset) return;
    const confirmed = window.confirm(`Delete footer "${preset.name}"?`);
    if (!confirmed) return;
    const remaining = footerPresets.filter((item) => item.id !== selectedFooterPresetId);
    const nextPresets = remaining.length
      ? remaining
      : normalizeEmailFooterPresets(
          [
            {
              id: `footer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: "Default Footer",
              footer: fallbackFooter,
              updatedAt: new Date().toISOString()
            }
          ],
          fallbackFooter
        );
    const nextDefaultId = String(nextPresets[0]?.id || "");
    const result = await persistFooterPresets(nextPresets, nextDefaultId, nextDefaultId);
    if (result.ok) {
      setStatus(`Deleted footer "${preset.name}".`);
      setError("");
    }
  }

  async function makeFooterDefault() {
    if (!selectedFooterPresetId) return;
    const preset = footerPresets.find((item) => item.id === selectedFooterPresetId);
    if (!preset) return;
    const result = await persistFooterPresets(footerPresets, selectedFooterPresetId, selectedFooterPresetId);
    if (result.ok) {
      setStatus(`"${preset.name}" is now the default footer.`);
      setError("");
    }
  }

  async function sendTestEmail() {
    setError("");
    setStatus("");
    try {
      await request("/email/test", {
        method: "POST",
        body: {
          subject: form.subject,
          body: form.body,
          footer: activeFooter
        }
      });
      setStatus("Test email sent to your admin inbox.");
    } catch (requestError) {
      setError(requestError.message || "Failed to send test email.");
    }
  }

  async function sendEmail(event) {
    event.preventDefault();
    if (!form.subject.trim() || !form.body.trim() || recipientPreview.count <= 0) {
      setError("Subject, body, and at least one recipient are required.");
      return;
    }

    setSending(true);
    setError("");
    setStatus("");
    try {
      await request("/email/send", {
        method: "POST",
        body: {
          subject: form.subject,
          body: form.body,
          targeting,
          scheduledFor: form.scheduleType === "later" ? form.scheduledFor : "",
          footer: activeFooter
        }
      });
      setStatus("Email queued successfully.");
      navigate(`/t/${slug}/admin/email/history`);
    } catch (requestError) {
      setError(requestError.message || "Failed to send email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Send Email"
        subtitle="Compose and send a branded email to your network."
        actions={
          <Link className="link-button secondary" to={`/t/${slug}/admin/email/history`}>
            Sent History
          </Link>
        }
      />
      <form className="director-admin-email-layout" onSubmit={sendEmail}>
        <section className="director-admin-email-composer director-admin-email-composer-full">
          <label>
            To
            <Select
              value={form.mode}
              onChange={(event) => setForm((prev) => ({ ...prev, mode: event.target.value }))}
            >
              <option value="all">All Members</option>
              <option value="individual">Specific People</option>
              <option value="custom_group">Custom Group</option>
            </Select>
          </label>
          {form.mode !== "all" ? (
            <section className="director-admin-recipient-builder">
              {form.mode === "custom_group" ? (
                <div className="director-admin-email-group-bar">
                  <Input
                    value={recipientGroupName}
                    onChange={(event) => setRecipientGroupName(event.target.value)}
                    placeholder="Group name (e.g., Reunion Outreach)"
                  />
                  <Button type="button" variant="secondary" onClick={saveRecipientGroup}>
                    Save Group
                  </Button>
                  <Select
                    value={selectedRecipientGroupId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setSelectedRecipientGroupId(nextId);
                      const group = savedRecipientGroups.find((item) => item.id === nextId);
                      if (group) setRecipientGroupName(group.name || "");
                    }}
                    disabled={!savedRecipientGroups.length}
                  >
                    <option value="">Saved groups</option>
                    {savedRecipientGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={applyRecipientGroup}
                    disabled={!selectedRecipientGroupId}
                  >
                    Use Group
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={deleteRecipientGroup}
                    disabled={!selectedRecipientGroupId}
                  >
                    Delete Group
                  </Button>
                </div>
              ) : null}

              <label>
                Find members
                <Input
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  placeholder="Search by name or email..."
                />
              </label>
              <div className="director-admin-member-search-results">
                {memberSearchLoading ? (
                  <p className="muted">Searching members...</p>
                ) : memberSearchResults.length ? (
                  memberSearchResults.map((member) => (
                    <div key={member.id} className="director-admin-member-search-item">
                      <div>
                        <strong>{member.fullName || "Member"}</strong>
                        <small>{member.email || "No email"}</small>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => addRecipient(member)}
                      >
                        Add
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="muted">No matching members found.</p>
                )}
              </div>
              <div className="director-admin-selected-recipient-head">
                <strong>Selected recipients ({selectedRecipients.length})</strong>
                {selectedRecipients.length ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setForm((prev) => ({ ...prev, profileIds: [] }))}
                  >
                    Clear Selected
                  </Button>
                ) : null}
              </div>
              {selectedRecipients.length ? (
                <div className="director-admin-selected-recipient-list">
                  {selectedRecipients.map((member) => (
                    <div key={member.id} className="director-admin-selected-chip">
                      <div>
                        <strong>{member.fullName || "Member"}</strong>
                        <small>{member.email || member.id}</small>
                      </div>
                      <button
                        type="button"
                        className="director-admin-inline-link"
                        onClick={() => removeRecipient(member.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No members selected yet.</p>
              )}
            </section>
          ) : null}
          <p className="muted">
            {recipientPreview.count || 0} members will receive this email.
            {recipientPreview.excludedCount ? ` ${recipientPreview.excludedCount} excluded.` : ""}
          </p>

          <label>
            Subject
            <Input
              value={form.subject}
              maxLength={120}
              onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
              placeholder="Subject line"
            />
          </label>
          <label>
            Body
            <Textarea
              value={form.body}
              onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
              placeholder="Write your message here..."
            />
          </label>

          <section className="director-admin-email-footer-builder">
            <div className="director-admin-email-footer-head">
              <div>
                <strong>Saved Footers</strong>
                <small>Personalize signature details and reuse footer presets anytime.</small>
              </div>
              <div className="director-admin-email-footer-head-actions">
                <span className="director-admin-email-footer-count">{footerPresets.length} saved</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setFooterPanelOpen((prev) => !prev)}
                  aria-expanded={footerPanelOpen}
                >
                  {footerPanelOpen ? "Hide" : "Edit"}
                </Button>
              </div>
            </div>

            {footerPanelOpen ? (
              <>
                <div className="director-admin-email-footer-preset-bar">
                  <Input
                    value={footerPresetName}
                    onChange={(event) => setFooterPresetName(event.target.value)}
                    placeholder="Footer preset name (e.g., Director Update)"
                  />
                  <Select
                    value={selectedFooterPresetId}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setSelectedFooterPresetId(nextId);
                      const preset = footerPresets.find((item) => item.id === nextId);
                      if (preset) setFooterPresetName(preset.name || "");
                    }}
                    disabled={!footerPresets.length}
                  >
                    <option value="">Saved footers</option>
                    {footerPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={applyFooterPreset}
                    disabled={!selectedFooterPresetId || loadingFooterPresets}
                  >
                    Use Footer
                  </Button>
                  <Button type="button" variant="secondary" onClick={saveFooterPreset} disabled={footerSaving}>
                    Save Footer
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={deleteFooterPreset}
                    disabled={!selectedFooterPresetId || footerSaving}
                  >
                    Delete Footer
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={makeFooterDefault}
                    disabled={!selectedFooterPresetId || footerSaving}
                  >
                    Set Default
                  </Button>
                </div>

                <div className="director-admin-email-footer-grid">
                  <label>
                    Header label
                    <Input
                      value={activeFooter.headerTagline}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, headerTagline: event.target.value }, fallbackFooter))
                      }
                      placeholder="Community update"
                    />
                  </label>
                  <label>
                    Sign-off
                    <Input
                      value={activeFooter.signOff}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, signOff: event.target.value }, fallbackFooter))
                      }
                      placeholder="Warmly,"
                    />
                  </label>
                  <label>
                    Name
                    <Input
                      value={activeFooter.senderName}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderName: event.target.value }, fallbackFooter))
                      }
                      placeholder="Director name"
                    />
                  </label>
                  <label>
                    Role
                    <Input
                      value={activeFooter.senderRole}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderRole: event.target.value }, fallbackFooter))
                      }
                      placeholder="Director"
                    />
                  </label>
                  <label>
                    Email
                    <Input
                      value={activeFooter.senderEmail}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderEmail: event.target.value }, fallbackFooter))
                      }
                      placeholder="name@camp.org"
                    />
                  </label>
                  <label>
                    Phone
                    <Input
                      value={activeFooter.senderPhone}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderPhone: event.target.value }, fallbackFooter))
                      }
                      placeholder="(555) 555-5555"
                    />
                  </label>
                  <label className="inline-check director-admin-email-footer-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(activeFooter.showLogo)}
                      onChange={(event) =>
                        setFooterDraft((prev) => normalizeEmailFooter({ ...prev, showLogo: event.target.checked }, fallbackFooter))
                      }
                    />
                    Include camp logo in footer
                  </label>
                  <p className="muted director-admin-email-footer-note">Footer logo uses your active camp branding logo automatically.</p>
                </div>
              </>
            ) : (
              <p className="muted director-admin-email-footer-collapsed-note">
                Footer details hidden. Click Edit to expand.
              </p>
            )}
          </section>

          <label>
            Send timing
            <Select
              value={form.scheduleType}
              onChange={(event) => setForm((prev) => ({ ...prev, scheduleType: event.target.value }))}
            >
              <option value="now">Send now</option>
              <option value="later">Schedule for later</option>
            </Select>
          </label>
          {form.scheduleType === "later" ? (
            <label>
              Scheduled date/time
              <Input
                type="datetime-local"
                value={form.scheduledFor}
                onChange={(event) => setForm((prev) => ({ ...prev, scheduledFor: event.target.value }))}
              />
            </label>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}
          {status ? <p className="success-text">{status}</p> : null}
          <div className="inline-actions">
            <Button type="button" variant="secondary" onClick={sendTestEmail}>
              Send Test Email
            </Button>
            <Button type="submit" disabled={sending || recipientPreview.count <= 0}>
              {sending ? "Sending..." : form.scheduleType === "later" ? "Schedule Email" : "Send Email"}
            </Button>
          </div>
        </section>
        <aside className="director-admin-email-preview">
          <h3>Live Preview</h3>
          <div className="director-admin-email-frame">
            <div className="director-admin-email-frame-head" style={{ background: "var(--brand-primary)" }}>
              {previewHeaderLogoUrl ? (
                <img src={previewHeaderLogoUrl} alt="" />
              ) : (
                <span className="director-admin-logo-fallback">{previewInitials}</span>
              )}
              <div>
                <strong>{networkName || "Your Camp Network"}</strong>
                <small>{activeFooter.headerTagline || "Community update"}</small>
              </div>
            </div>
            <div className="director-admin-email-frame-body">
              <h4>{form.subject.trim() || "Subject line preview"}</h4>
              <p>{previewBody || "Write your message here and the preview updates in real time."}</p>
            </div>
            <div className="director-admin-email-frame-foot">
              <div className="director-admin-email-signature-preview">
                <p>{activeFooter.signOff || "Warmly,"}</p>
                {activeFooter.senderName ? <p><strong>{activeFooter.senderName}</strong></p> : null}
                {activeFooter.senderRole ? <p>{activeFooter.senderRole}</p> : null}
                {footerContact ? <p>{footerContact}</p> : null}
              </div>
              {previewFooterLogoUrl ? (
                <img className="director-admin-email-signature-logo" src={previewFooterLogoUrl} alt="" />
              ) : null}
            </div>
          </div>
        </aside>
      </form>
    </Card>
  );
}
