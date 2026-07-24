import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, Input, Select } from "@pondbridge/ui";
import { ModalConfirm, ModalDialog, PageHeader } from "../../components/admin/AdminUi.jsx";
import { useConfirmDialog } from "../../components/admin/useConfirmDialog.js";
import DirectorEmailAgentPanel from "../../components/admin/DirectorEmailAgentPanel.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import useAdminApi from "./useAdminApi.js";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseIdsParam(value = "") {
  return [...new Set(
    String(value || "")
      .split(",")
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];
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
const EMAIL_RECIPIENT_GROUPS_STORAGE_PREFIX = "pb_admin_email_recipient_groups";
const EMAIL_DRAFT_STORAGE_PREFIX = "pb_admin_email_draft";
const EMAIL_TEMPLATE_STORAGE_PREFIX = "pb_admin_email_templates";
const DEFAULT_STAFF_ROLES = ["Camper", "Counselor", "JC", "CIT", "Admin"];
const GROWTH_SEGMENT_OPTIONS = [
  { value: "new_30", label: "New members · last 30 days" },
  { value: "inactive_30", label: "Inactive · 30+ days" },
  { value: "inactive_60", label: "Inactive · 60+ days" },
  { value: "inactive_90", label: "Inactive · 90+ days" },
  { value: "profile_incomplete", label: "Profiles under 75% complete" }
];

// ---------------------------------------------------------------------------
// Recipient group localStorage helpers (unchanged)
// ---------------------------------------------------------------------------

function emailRecipientGroupStorageKey(slug = "") {
  return `${EMAIL_RECIPIENT_GROUPS_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
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
      groups.push({ id, name, profileIds, updatedAt: String(item?.updatedAt || "") });
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
    normalized.push({ id, name, profileIds, updatedAt: String(item?.updatedAt || "") });
    if (normalized.length >= 60) break;
  }
  try {
    localStorage.setItem(emailRecipientGroupStorageKey(slug), JSON.stringify(normalized));
  } catch { /* Ignore */ }
}

// ---------------------------------------------------------------------------
// Draft localStorage helpers
// ---------------------------------------------------------------------------

function emailDraftStorageKey(slug = "") {
  return `${EMAIL_DRAFT_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
}

function readSavedEmailDraft(slug = "") {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(emailDraftStorageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      subject: String(parsed.subject || ""),
      preheader: String(parsed.preheader || ""),
      body: String(parsed.body || ""),
      aiGenerationId: String(parsed.aiGenerationId || ""),
      mode: String(parsed.mode || "all"),
      segment: String(parsed.segment || ""),
      profileIds: Array.isArray(parsed.profileIds) ? parsed.profileIds : [],
      selectedRoles: Array.isArray(parsed.selectedRoles) ? parsed.selectedRoles : [],
      selectedYears: Array.isArray(parsed.selectedYears) ? parsed.selectedYears : [],
      scheduleType: String(parsed.scheduleType || "now"),
      scheduledFor: String(parsed.scheduledFor || "")
    };
  } catch {
    return null;
  }
}

function writeSavedEmailDraft(slug = "", draft = {}) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(emailDraftStorageKey(slug), JSON.stringify(draft));
  } catch { /* Ignore */ }
}

function clearSavedEmailDraft(slug = "") {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(emailDraftStorageKey(slug));
  } catch { /* Ignore */ }
}

// ---------------------------------------------------------------------------
// Template localStorage helpers
// ---------------------------------------------------------------------------

function emailTemplateStorageKey(slug = "") {
  return `${EMAIL_TEMPLATE_STORAGE_PREFIX}:${String(slug || "").trim().toLowerCase()}`;
}

function readSavedEmailTemplates(slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(emailTemplateStorageKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && String(item?.id || "").trim() && String(item?.name || "").trim())
      .map((item) => ({
        id: String(item.id).trim(),
        name: String(item.name).trim().slice(0, 72),
        subject: String(item.subject || ""),
        preheader: String(item.preheader || ""),
        body: String(item.body || ""),
        updatedAt: String(item.updatedAt || "")
      }))
      .slice(0, 40);
  } catch {
    return [];
  }
}

function writeSavedEmailTemplates(slug = "", templates = []) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(emailTemplateStorageKey(slug), JSON.stringify(templates));
  } catch { /* Ignore */ }
}

// ---------------------------------------------------------------------------
// Footer helpers (unchanged)
// ---------------------------------------------------------------------------

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
    { signOff: "Warmly,", headerTagline: "Community update", senderName: "", senderRole: "Director", senderEmail: "", senderPhone: "", showLogo: true, logoUrl: "" }
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
    normalized.push({ id, name, footer: normalizeEmailFooter(item?.footer || {}, fallback), updatedAt: String(item?.updatedAt || "") });
    if (normalized.length >= 20) break;
  }
  if (normalized.length === 0) {
    normalized.push({ id: "default_footer", name: "Default Footer", footer: fallback, updatedAt: "" });
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
    { signOff: "Warmly,", headerTagline: "Community update", senderName, senderRole, senderEmail, senderPhone: "", showLogo: true, logoUrl: String(tenant?.theme?.logoUrl || "").trim() },
    {}
  );
}

// ---------------------------------------------------------------------------
// Rich Text Editor (lightweight contentEditable)
// ---------------------------------------------------------------------------

function RichTextEditor({ value = "", onChange, placeholder = "Write your message here..." }) {
  const editorRef = useRef(null);
  const linkSelectionRef = useRef(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    if (!editorRef.current) return;
    if (document.activeElement === editorRef.current) return;
    if (editorRef.current.innerHTML !== (value || "")) {
      editorRef.current.innerHTML = value || "";
    }
  }, [value]);

  function handleInput() {
    if (!editorRef.current) return;
    onChange(editorRef.current.innerHTML);
  }

  function exec(command, arg = null) {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    handleInput();
  }

  function handleBold() { exec("bold"); }
  function handleItalic() { exec("italic"); }
  function handleList() { exec("insertUnorderedList"); }
  function handleLink() {
    const selection = window.getSelection?.();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    linkSelectionRef.current = range && editorRef.current?.contains(range.commonAncestorContainer)
      ? range.cloneRange()
      : null;
    setLinkUrl("");
    setLinkError("");
    setLinkDialogOpen(true);
  }
  function closeLinkDialog() {
    setLinkDialogOpen(false);
    setLinkError("");
    linkSelectionRef.current = null;
  }
  function applyLink() {
    const rawUrl = String(linkUrl || "").trim();
    if (!rawUrl) {
      setLinkError("Enter a link URL.");
      return;
    }
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      setLinkError("Enter a valid URL.");
      return;
    }
    if (!new Set(["http:", "https:", "mailto:"]).has(parsed.protocol)) {
      setLinkError("Use an http, https, or mailto link.");
      return;
    }
    editorRef.current?.focus();
    if (linkSelectionRef.current) {
      const selection = window.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(linkSelectionRef.current);
    }
    exec("createLink", parsed.href);
    closeLinkDialog();
  }
  function insertMergeTag(tag) {
    editorRef.current?.focus();
    document.execCommand("insertText", false, `{{${tag}}}`);
    handleInput();
  }

  const isEmpty = !value || value === "<br>" || value === "<div><br></div>";

  return (
    <>
      <div className="director-admin-email-richtext-wrap">
      <div className="director-admin-email-richtext-toolbar">
        <button type="button" title="Bold" onClick={handleBold}><strong>B</strong></button>
        <button type="button" title="Italic" onClick={handleItalic}><em>I</em></button>
        <button type="button" title="Bullet list" onClick={handleList}>&#8226; List</button>
        <button type="button" title="Insert link" onClick={handleLink}>Link</button>
        <span className="director-admin-email-richtext-sep" />
        <button type="button" title="Insert first name merge tag" className="director-admin-email-merge-tag-btn" onClick={() => insertMergeTag("firstName")}>{"{{firstName}}"}</button>
        <button type="button" title="Insert last name merge tag" className="director-admin-email-merge-tag-btn" onClick={() => insertMergeTag("lastName")}>{"{{lastName}}"}</button>
      </div>
      <div
        ref={editorRef}
        className="director-admin-email-richtext-body"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        data-empty={isEmpty ? "true" : undefined}
      />
      </div>
      <ModalDialog
        open={linkDialogOpen}
        title="Insert Link"
        description="Add the destination for the selected text."
        onClose={closeLinkDialog}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeLinkDialog}>Cancel</Button>
            <Button type="button" onClick={applyLink}>Insert Link</Button>
          </>
        }
      >
        <label className="director-admin-dialog-field">
          Link URL
          <Input
            type="url"
            value={linkUrl}
            onChange={(event) => {
              setLinkUrl(event.target.value);
              setLinkError("");
            }}
            placeholder="https://example.org"
            aria-invalid={Boolean(linkError)}
          />
        </label>
        {linkError ? <p className="error-text" role="alert">{linkError}</p> : null}
      </ModalDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Year generator for year picker
// ---------------------------------------------------------------------------

function generateYearRange() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= currentYear - 40; y -= 1) {
    years.push(String(y));
  }
  return years;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DirectorAdminEmailComposePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { slug, request } = useAdminApi();
  const { tenant } = useTenant();
  const { user } = useAuth();
  const { confirm, confirmDialogProps } = useConfirmDialog();
  const initialSelectedIds = parseIdsParam(searchParams.get("selected") || "");
  const requestedAudience = String(searchParams.get("audience") || "").trim().toLowerCase();
  const initialSegment = GROWTH_SEGMENT_OPTIONS.some((item) => item.value === requestedAudience)
    ? requestedAudience
    : "";
  const hasUrlParams = Boolean(searchParams.get("subject") || searchParams.get("body") || initialSegment);

  // Core form state
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [emailReadiness, setEmailReadiness] = useState(null);

  // Recipient preview
  const [recipientPreview, setRecipientPreview] = useState({ count: 0, excludedCount: 0, preview: [] });

  // Member search (individual targeting)
  const [memberQuery, setMemberQuery] = useState("");
  const [memberSearchLoading, setMemberSearchLoading] = useState(false);
  const [memberSearchResults, setMemberSearchResults] = useState([]);
  const [selectedMemberById, setSelectedMemberById] = useState({});

  // Recipient groups
  const [savedRecipientGroups, setSavedRecipientGroups] = useState([]);
  const [selectedRecipientGroupId, setSelectedRecipientGroupId] = useState("");
  const [recipientGroupName, setRecipientGroupName] = useState("");

  // Role & year targeting
  const [selectedRoles, setSelectedRoles] = useState([]);
  const [selectedYears, setSelectedYears] = useState([]);
  const [availableRoles, setAvailableRoles] = useState(DEFAULT_STAFF_ROLES);
  const allYears = useMemo(() => generateYearRange(), []);

  // Footer
  const fallbackFooter = useMemo(() => createFallbackEmailFooter({ tenant, user }), [tenant, user]);
  const [footerPresets, setFooterPresets] = useState([]);
  const [selectedFooterPresetId, setSelectedFooterPresetId] = useState("");
  const [footerPresetName, setFooterPresetName] = useState("");
  const [footerDraft, setFooterDraft] = useState(fallbackFooter);
  const [footerSaving, setFooterSaving] = useState(false);
  const [loadingFooterPresets, setLoadingFooterPresets] = useState(true);
  const [footerPanelOpen, setFooterPanelOpen] = useState(false);

  // Templates
  const [savedTemplates, setSavedTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");

  // Draft auto-save
  const draftRestored = useRef(false);

  // Form state — restore from draft or URL params
  const [form, setForm] = useState(() => {
    if (hasUrlParams || initialSelectedIds.length > 0) {
      return {
        mode: initialSelectedIds.length > 0 ? "individual" : initialSegment ? "segment" : "all",
        segment: initialSegment,
        profileIds: initialSelectedIds,
        subject: String(searchParams.get("subject") || ""),
        preheader: String(searchParams.get("preheader") || ""),
        body: String(searchParams.get("body") || ""),
        aiGenerationId: "",
        scheduleType: "now",
        scheduledFor: ""
      };
    }
    return { mode: "all", segment: "", profileIds: [], subject: "", preheader: "", body: "", aiGenerationId: "", scheduleType: "now", scheduledFor: "" };
  });

  // ---------------------------------------------------------------------------
  // Init effects
  // ---------------------------------------------------------------------------

  // Restore draft on mount (only if no URL params)
  useEffect(() => {
    if (hasUrlParams || initialSelectedIds.length > 0 || draftRestored.current) return;
    const draft = readSavedEmailDraft(slug);
    if (draft && (draft.subject || draft.body)) {
      setForm({
        mode: draft.mode || "all",
        segment: draft.segment || "",
        profileIds: draft.profileIds || [],
        subject: draft.subject || "",
        preheader: draft.preheader || "",
        body: draft.body || "",
        aiGenerationId: draft.aiGenerationId || "",
        scheduleType: draft.scheduleType || "now",
        scheduledFor: draft.scheduledFor || ""
      });
      if (Array.isArray(draft.selectedRoles)) setSelectedRoles(draft.selectedRoles);
      if (Array.isArray(draft.selectedYears)) setSelectedYears(draft.selectedYears);
      setStatus("Draft restored.");
      draftRestored.current = true;
    }
  }, [slug, hasUrlParams, initialSelectedIds.length]);

  // Auto-save draft
  const debouncedForm = useDebouncedValue(form, 1500);
  const debouncedRoles = useDebouncedValue(selectedRoles, 1500);
  const debouncedYears = useDebouncedValue(selectedYears, 1500);
  useEffect(() => {
    if (!debouncedForm.subject && !debouncedForm.body) return;
    writeSavedEmailDraft(slug, {
      ...debouncedForm,
      selectedRoles: debouncedRoles,
      selectedYears: debouncedYears
    });
  }, [slug, debouncedForm, debouncedRoles, debouncedYears]);

  // Load recipient groups
  useEffect(() => {
    const groups = readSavedEmailRecipientGroups(slug);
    setSavedRecipientGroups(groups);
    setSelectedRecipientGroupId(groups[0]?.id || "");
  }, [slug]);

  // Load templates
  useEffect(() => {
    setSavedTemplates(readSavedEmailTemplates(slug));
  }, [slug]);

  // Fetch available roles
  useEffect(() => {
    let active = true;
    request("/email/available-roles")
      .then((payload) => {
        if (!active) return;
        if (Array.isArray(payload?.roles) && payload.roles.length > 0) {
          setAvailableRoles(payload.roles);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [request]);

  // Fetch footer presets
  useEffect(() => {
    let active = true;
    setLoadingFooterPresets(true);
    request("/email/footer-presets")
      .then((payload) => {
        if (!active) return;
        const presets = normalizeEmailFooterPresets(payload?.presets || [], fallbackFooter);
        const requestedDefaultId = String(payload?.defaultPresetId || "").trim();
        const selectedId = presets.some((item) => item.id === requestedDefaultId) ? requestedDefaultId : String(presets[0]?.id || "");
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
        setFooterPresets(presets);
        setSelectedFooterPresetId(String(presets[0]?.id || ""));
        setFooterPresetName(String(presets[0]?.name || ""));
        setFooterDraft(normalizeEmailFooter(presets[0]?.footer || {}, fallbackFooter));
      })
      .finally(() => { if (active) setLoadingFooterPresets(false); });
    return () => { active = false; };
  }, [fallbackFooter, request]);

  // ---------------------------------------------------------------------------
  // Targeting memo
  // ---------------------------------------------------------------------------

  const targeting = useMemo(() => {
    if (form.mode === "all") return { mode: "all", roles: [], years: [], profileIds: [], label: "All Members" };
    if (form.mode === "role") return { mode: "role", roles: selectedRoles, years: [], profileIds: [], label: selectedRoles.length ? `Roles: ${selectedRoles.join(", ")}` : "By Role (none selected)" };
    if (form.mode === "year") return { mode: "year", roles: [], years: selectedYears, profileIds: [], label: selectedYears.length ? `Years: ${selectedYears.join(", ")}` : "By Year (none selected)" };
    if (form.mode === "segment") {
      const segmentOption = GROWTH_SEGMENT_OPTIONS.find((item) => item.value === form.segment);
      return { mode: "segment", segment: form.segment, roles: [], years: [], profileIds: [], label: segmentOption?.label || "Engagement segment" };
    }
    const activePreset = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId);
    return {
      mode: "custom",
      roles: [],
      years: [],
      profileIds: form.mode === "individual" || form.mode === "custom_group" ? normalizeProfileIdList(form.profileIds) : [],
      label: form.mode === "all" ? "All Members" : form.mode === "individual" ? "Specific People" : normalizeEmailRecipientGroupName(recipientGroupName) || activePreset?.name || "Custom Group"
    };
  }, [form.mode, form.profileIds, form.segment, recipientGroupName, savedRecipientGroups, selectedRecipientGroupId, selectedRoles, selectedYears]);

  // ---------------------------------------------------------------------------
  // Member search & selection
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (form.mode !== "individual" && form.mode !== "custom_group") {
      setMemberSearchResults([]);
      setMemberSearchLoading(false);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(async () => {
      setMemberSearchLoading(true);
      try {
        const params = new URLSearchParams({ page: "1", pageSize: "12", q: String(memberQuery || "").trim(), role: "all", year: "all", status: "all", completion: "all", sort: "name_asc" });
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
    return () => { active = false; window.clearTimeout(timeout); };
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
            next[id] = { id, fullName: String(item?.fullName || "Member").trim() || "Member", email: String(item?.email || "").trim() };
          }
          return next;
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [form.profileIds, request, selectedMemberById]);

  // Recipient preview
  useEffect(() => {
    let active = true;
    request("/email/recipients-preview", { method: "POST", body: { targeting } })
      .then((payload) => { if (active) setRecipientPreview(payload); })
      .catch(() => { if (active) setRecipientPreview({ count: 0, excludedCount: 0, preview: [] }); });
    return () => { active = false; };
  }, [request, targeting]);

  // Deterministic preflight runs independently of provider AI. It checks the
  // physical-address and unsubscribe requirements the server will enforce.
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      request("/email-agent/quality", {
        method: "POST",
        body: {
          subject: form.subject,
          preheader: form.preheader,
          body: form.body,
          campaignType: "marketing",
          recipientCount: recipientPreview.count
        }
      })
        .then((payload) => { if (active) setEmailReadiness(payload); })
        .catch(() => { if (active) setEmailReadiness(null); });
    }, 260);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [form.body, form.preheader, form.subject, recipientPreview.count, request]);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const selectedRecipients = useMemo(
    () => normalizeProfileIdList(form.profileIds).map((id) => {
      const item = selectedMemberById[id];
      return { id, fullName: String(item?.fullName || `Member ${id.slice(0, 8)}`).trim(), email: String(item?.email || "").trim() };
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

  const networkName = String(tenant?.content?.networkDisplayName || tenant?.name || "Your Camp Network").trim();
  const previewHeaderLogoUrl = String(tenant?.theme?.logoUrl || "").trim();
  const previewFooterLogoUrl = activeFooter.showLogo ? String(tenant?.theme?.logoUrl || activeFooter.logoUrl || "").trim() : "";
  const previewInitials = (networkName || "PondBridge").split(/\s+/).filter(Boolean).slice(0, 2).map((item) => item[0]?.toUpperCase() || "").join("") || "PB";
  const footerContact = [activeFooter.senderEmail, activeFooter.senderPhone].filter(Boolean).join(" \u2022 ");

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function addRecipient(member) {
    const profileId = String(member?.id || "").trim();
    if (!profileId) return;
    setForm((prev) => {
      if (prev.profileIds.includes(profileId)) return prev;
      return { ...prev, profileIds: [...prev.profileIds, profileId] };
    });
    setSelectedMemberById((prev) => ({
      ...prev,
      [profileId]: { id: profileId, fullName: String(member?.fullName || member?.name || "Member").trim() || "Member", email: String(member?.email || "").trim() }
    }));
    setMemberSearchResults((prev) => prev.filter((item) => String(item?.id || "").trim() !== profileId));
  }

  function removeRecipient(profileId = "") {
    const normalized = String(profileId || "").trim();
    if (!normalized) return;
    setForm((prev) => ({ ...prev, profileIds: prev.profileIds.filter((id) => id !== normalized) }));
  }

  function saveRecipientGroup() {
    const name = normalizeEmailRecipientGroupName(recipientGroupName);
    const profileIds = normalizeProfileIdList(form.profileIds);
    if (!name) { setError("Enter a group name before saving."); return; }
    if (!profileIds.length) { setError("Add at least one recipient before saving a group."); return; }
    const now = new Date().toISOString();
    const nameKey = emailRecipientGroupNameKey(name);
    const selectedGroup = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId) || null;
    const selectedMatchesName = selectedGroup ? emailRecipientGroupNameKey(selectedGroup.name) === nameKey : false;
    const existingByName = savedRecipientGroups.find((item) => emailRecipientGroupNameKey(item.name) === nameKey) || null;
    const existing = selectedMatchesName ? selectedGroup : existingByName;
    const createdId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const targetId = existing?.id || createdId;
    const nextGroups = existing
      ? savedRecipientGroups.map((item) => item.id === targetId ? { ...item, name, profileIds, updatedAt: now } : item)
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
    setForm((prev) => ({ ...prev, mode: "custom_group", profileIds: normalizeProfileIdList(group.profileIds || []) }));
    setRecipientGroupName(group.name || "");
    setStatus(`Loaded group "${group.name}".`);
    setError("");
  }

  async function deleteRecipientGroup() {
    if (!selectedRecipientGroupId) return;
    const group = savedRecipientGroups.find((item) => item.id === selectedRecipientGroupId);
    if (!group) return;
    const confirmed = await confirm({
      title: `Delete “${group.name}”?`,
      description: "The saved recipient group will be removed. Members and their profiles are not affected.",
      confirmLabel: "Delete group",
    });
    if (!confirmed) return;
    const nextGroups = savedRecipientGroups.filter((item) => item.id !== selectedRecipientGroupId);
    writeSavedEmailRecipientGroups(slug, nextGroups);
    setSavedRecipientGroups(nextGroups);
    setSelectedRecipientGroupId(nextGroups[0]?.id || "");
    if (String(recipientGroupName || "").trim().toLowerCase() === String(group.name || "").trim().toLowerCase()) setRecipientGroupName("");
    setStatus(`Deleted group "${group.name}".`);
    setError("");
  }

  // Template actions
  function saveTemplate() {
    const name = String(templateName || "").trim().slice(0, 72);
    if (!name) { setError("Enter a template name before saving."); return; }
    if (!form.subject && !form.body) { setError("Add a subject or body before saving a template."); return; }
    const now = new Date().toISOString();
    const existing = savedTemplates.find((t) => t.id === selectedTemplateId && t.name.toLowerCase() === name.toLowerCase())
      || savedTemplates.find((t) => t.name.toLowerCase() === name.toLowerCase());
    const id = existing?.id || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const entry = { id, name, subject: form.subject, preheader: form.preheader, body: form.body, updatedAt: now };
    const nextTemplates = existing
      ? savedTemplates.map((t) => t.id === existing.id ? entry : t)
      : [entry, ...savedTemplates].slice(0, 40);
    writeSavedEmailTemplates(slug, nextTemplates);
    setSavedTemplates(nextTemplates);
    setSelectedTemplateId(id);
    setStatus(`Saved template "${name}".`);
    setError("");
  }

  function loadTemplate() {
    const tpl = savedTemplates.find((t) => t.id === selectedTemplateId);
    if (!tpl) return;
    setForm((prev) => ({ ...prev, subject: tpl.subject || "", preheader: tpl.preheader || "", body: tpl.body || "", aiGenerationId: "" }));
    setTemplateName(tpl.name || "");
    setStatus(`Loaded template "${tpl.name}".`);
    setError("");
  }

  async function deleteTemplate() {
    const tpl = savedTemplates.find((t) => t.id === selectedTemplateId);
    if (!tpl) return;
    const confirmed = await confirm({
      title: `Delete “${tpl.name}”?`,
      description: "The saved email template will be permanently removed.",
      confirmLabel: "Delete template",
    });
    if (!confirmed) return;
    const next = savedTemplates.filter((t) => t.id !== selectedTemplateId);
    writeSavedEmailTemplates(slug, next);
    setSavedTemplates(next);
    setSelectedTemplateId(next[0]?.id || "");
    setTemplateName("");
    setStatus(`Deleted template "${tpl.name}".`);
    setError("");
  }

  // Footer actions
  async function persistFooterPresets(nextPresets = [], defaultPresetId = "", nextSelectedId = "") {
    setFooterSaving(true);
    setError("");
    try {
      const payload = await request("/email/footer-presets", { method: "PATCH", body: { presets: nextPresets, defaultPresetId } });
      const presets = normalizeEmailFooterPresets(payload?.presets || nextPresets, fallbackFooter);
      const selectedIdCandidate = String(nextSelectedId || payload?.defaultPresetId || "").trim();
      const selectedId = presets.some((item) => item.id === selectedIdCandidate) ? selectedIdCandidate : String(payload?.defaultPresetId || presets[0]?.id || "");
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
    if (!name) { setError("Enter a footer preset name before saving."); return; }
    const now = new Date().toISOString();
    const existingById = footerPresets.find((item) => item.id === selectedFooterPresetId) || null;
    const existingByName = footerPresets.find((item) => item.name.toLowerCase() === name.toLowerCase()) || null;
    const existing = existingById || existingByName;
    const nextPreset = { id: existing?.id || `footer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name, footer: activeFooter, updatedAt: now };
    const nextPresets = existing ? footerPresets.map((item) => (item.id === existing.id ? nextPreset : item)) : [nextPreset, ...footerPresets].slice(0, 20);
    const defaultId = footerPresets.some((item) => item.id === selectedFooterPresetId) ? selectedFooterPresetId : String(nextPresets[0]?.id || "");
    const result = await persistFooterPresets(nextPresets, defaultId, nextPreset.id);
    if (result.ok) { setStatus(`Saved footer "${name}".`); setError(""); }
  }

  async function deleteFooterPreset() {
    if (!selectedFooterPresetId) return;
    const preset = footerPresets.find((item) => item.id === selectedFooterPresetId);
    if (!preset) return;
    const confirmed = await confirm({
      title: `Delete “${preset.name}”?`,
      description: "The footer preset will be permanently removed. Existing email history is not affected.",
      confirmLabel: "Delete footer",
    });
    if (!confirmed) return;
    const remaining = footerPresets.filter((item) => item.id !== selectedFooterPresetId);
    const nextPresets = remaining.length
      ? remaining
      : normalizeEmailFooterPresets([{ id: `footer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: "Default Footer", footer: fallbackFooter, updatedAt: new Date().toISOString() }], fallbackFooter);
    const nextDefaultId = String(nextPresets[0]?.id || "");
    const result = await persistFooterPresets(nextPresets, nextDefaultId, nextDefaultId);
    if (result.ok) { setStatus(`Deleted footer "${preset.name}".`); setError(""); }
  }

  async function makeFooterDefault() {
    if (!selectedFooterPresetId) return;
    const preset = footerPresets.find((item) => item.id === selectedFooterPresetId);
    if (!preset) return;
    const result = await persistFooterPresets(footerPresets, selectedFooterPresetId, selectedFooterPresetId);
    if (result.ok) { setStatus(`"${preset.name}" is now the default footer.`); setError(""); }
  }

  // Email actions
  async function sendTestEmail() {
    setError("");
    setStatus("");
    try {
      await request("/email/test", { method: "POST", body: { subject: form.subject, preheader: form.preheader, body: form.body, footer: activeFooter } });
      setStatus("Test email sent to your admin inbox.");
    } catch (requestError) {
      setError(requestError.message || "Failed to send test email.");
    }
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    if (!form.subject.trim() || !form.body.trim() || recipientPreview.count <= 0) {
      setError("Subject, body, and at least one recipient are required.");
      return;
    }
    if (emailReadiness && !emailReadiness.ready) {
      setError(emailReadiness.blockers?.[0]?.message || "Resolve the campaign readiness blockers before sending.");
      return;
    }
    if (form.scheduleType === "later") {
      const scheduledAt = new Date(form.scheduledFor);
      if (!form.scheduledFor || Number.isNaN(scheduledAt.getTime())) {
        setError("Choose a valid date and time for the scheduled email.");
        return;
      }
      if (scheduledAt <= new Date()) {
        setError("Scheduled email time must be in the future.");
        return;
      }
      if (scheduledAt.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000) {
        setError("Scheduled emails can be created up to 30 days in advance.");
        return;
      }
    }
    setError("");
    setShowSendConfirm(true);
  }

  async function confirmSendEmail(confirmDuplicate = false) {
    setShowSendConfirm(false);
    setShowDuplicateConfirm(false);
    setSending(true);
    setError("");
    setStatus("");
    try {
      await request("/email/send", {
        method: "POST",
        body: {
          subject: form.subject,
          preheader: form.preheader,
          body: form.body,
          aiGenerationId: form.aiGenerationId,
          targeting,
          scheduledFor: form.scheduleType === "later"
            ? new Date(form.scheduledFor).toISOString()
            : "",
          footer: activeFooter,
          confirmDuplicate
        }
      });
      setStatus(form.scheduleType === "later" ? "Email scheduled successfully." : "Email sent successfully.");
      clearSavedEmailDraft(slug);
      navigate(`/t/${slug}/admin/email/history`);
    } catch (requestError) {
      if (requestError?.status === 409 || requestError?.payload?.error?.code === "DUPLICATE_BROADCAST_WARNING") {
        setShowDuplicateConfirm(true);
      } else {
        setError(requestError.message || "Failed to send email.");
      }
    } finally {
      setSending(false);
    }
  }

  function handleClearDraft() {
    clearSavedEmailDraft(slug);
    setForm({ mode: "all", segment: "", profileIds: [], subject: "", preheader: "", body: "", aiGenerationId: "", scheduleType: "now", scheduledFor: "" });
    setSelectedRoles([]);
    setSelectedYears([]);
    setStatus("Draft cleared.");
    setError("");
  }

  function applyAgentDraft(draft = {}) {
    setForm((prev) => ({
      ...prev,
      subject: String(draft.subject || ""),
      preheader: String(draft.preheader || ""),
      body: String(draft.body || ""),
      aiGenerationId: String(draft.aiGenerationId || "")
    }));
    setError("");
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Card>
      <PageHeader
        title="Communications Studio"
        subtitle="Plan, draft, verify, and deliver a branded camp campaign from one workspace."
        actions={
          <Link className="link-button secondary" to={`/t/${slug}/admin/email/history`}>
            Sent History
          </Link>
        }
      />
      <DirectorEmailAgentPanel
        request={request}
        form={form}
        targeting={targeting}
        recipientPreview={recipientPreview}
        onApplyDraft={applyAgentDraft}
      />
      <form className="director-admin-email-layout" onSubmit={handleFormSubmit}>
        <section className="director-admin-email-composer director-admin-email-composer-full">

          {/* Targeting */}
          <label>
            To
            <Select
              value={form.mode}
              onChange={(event) => setForm((prev) => ({
                ...prev,
                mode: event.target.value,
                segment: event.target.value === "segment" ? prev.segment || "inactive_30" : prev.segment
              }))}
            >
              <option value="all">All Members</option>
              <option value="role">By Role</option>
              <option value="year">By Class Year</option>
              <option value="segment">By Engagement</option>
              <option value="individual">Specific People</option>
              <option value="custom_group">Custom Group</option>
            </Select>
          </label>

          {form.mode === "segment" ? (
            <label>
              Engagement audience
              <Select
                value={form.segment || "inactive_30"}
                onChange={(event) => setForm((prev) => ({ ...prev, segment: event.target.value }))}
              >
                {GROWTH_SEGMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
              <small className="muted">Audience membership is recalculated from current server activity before preview and send.</small>
            </label>
          ) : null}

          {/* Role picker */}
          {form.mode === "role" ? (
            <div className="director-admin-email-role-picker">
              <small className="muted">Select one or more roles:</small>
              <div className="director-admin-email-checkbox-grid">
                {availableRoles.map((role) => (
                  <label key={role} className="inline-check">
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(role)}
                      onChange={() => setSelectedRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role])}
                    />
                    {role}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {/* Year picker */}
          {form.mode === "year" ? (
            <div className="director-admin-email-year-picker">
              <small className="muted">Select one or more class years:</small>
              <div className="director-admin-email-checkbox-grid director-admin-email-year-grid">
                {allYears.slice(0, 20).map((year) => (
                  <label key={year} className="inline-check">
                    <input
                      type="checkbox"
                      checked={selectedYears.includes(year)}
                      onChange={() => setSelectedYears((prev) => prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year])}
                    />
                    {year}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {/* Individual / Custom Group member selection */}
          {form.mode === "individual" || form.mode === "custom_group" ? (
            <section className="director-admin-recipient-builder">
              {form.mode === "custom_group" ? (
                <div className="director-admin-email-group-bar">
                  <Input value={recipientGroupName} onChange={(event) => setRecipientGroupName(event.target.value)} placeholder="Group name (e.g., Reunion Outreach)" />
                  <Button type="button" variant="secondary" onClick={saveRecipientGroup}>Save Group</Button>
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
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                  </Select>
                  <Button type="button" variant="secondary" onClick={applyRecipientGroup} disabled={!selectedRecipientGroupId}>Use Group</Button>
                  <Button type="button" variant="secondary" onClick={deleteRecipientGroup} disabled={!selectedRecipientGroupId}>Delete Group</Button>
                </div>
              ) : null}

              <label>
                Find members
                <Input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="Search by name or email..." />
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
                      <Button type="button" variant="secondary" size="sm" onClick={() => addRecipient(member)}>Add</Button>
                    </div>
                  ))
                ) : (
                  <p className="muted">No matching members found.</p>
                )}
              </div>
              <div className="director-admin-selected-recipient-head">
                <strong>Selected recipients ({selectedRecipients.length})</strong>
                {selectedRecipients.length ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setForm((prev) => ({ ...prev, profileIds: [] }))}>Clear Selected</Button>
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
                      <button type="button" className="director-admin-inline-link" onClick={() => removeRecipient(member.id)}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">No members selected yet.</p>
              )}
            </section>
          ) : null}

          {/* Recipient preview */}
          <div className="director-admin-email-recipient-preview">
            <p className="muted">
              {recipientPreview.count || 0} members will receive this email.
              {recipientPreview.excludedCount ? ` ${recipientPreview.excludedCount} excluded.` : ""}
            </p>
            {recipientPreview.preview?.length > 0 ? (
              <div className="director-admin-email-recipient-sample">
                <small className="muted">Sample recipients:</small>
                <ul>
                  {recipientPreview.preview.map((p, i) => (
                    <li key={p.id || i}>{p.name || p.email} {p.email ? `(${p.email})` : ""}</li>
                  ))}
                </ul>
                {recipientPreview.count > recipientPreview.preview.length ? (
                  <small className="muted">...and {recipientPreview.count - recipientPreview.preview.length} more</small>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Templates */}
          <div className="director-admin-email-template-bar">
            <Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name" />
            <Select
              value={selectedTemplateId}
              onChange={(event) => {
                const nextId = event.target.value;
                setSelectedTemplateId(nextId);
                const tpl = savedTemplates.find((t) => t.id === nextId);
                if (tpl) setTemplateName(tpl.name || "");
              }}
            >
              <option value="">Saved templates</option>
              {savedTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
              ))}
            </Select>
            <Button type="button" variant="secondary" onClick={saveTemplate}>Save</Button>
            <Button type="button" variant="secondary" onClick={loadTemplate} disabled={!selectedTemplateId}>Use</Button>
            <Button type="button" variant="secondary" onClick={deleteTemplate} disabled={!selectedTemplateId}>Delete</Button>
          </div>

          {/* Subject */}
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
            Inbox preview text
            <Input
              value={form.preheader}
              maxLength={160}
              onChange={(event) => setForm((prev) => ({ ...prev, preheader: event.target.value }))}
              placeholder="A short line that appears beside the subject in the inbox"
            />
            <small className="muted">{form.preheader.length}/160 characters</small>
          </label>

          {/* Body — Rich Text Editor */}
          <label>
            Body
          </label>
          <RichTextEditor
            value={form.body}
            onChange={(html) => setForm((prev) => ({ ...prev, body: html }))}
            placeholder="Write your message here..."
          />

          {/* Footer builder */}
          <section className="director-admin-email-footer-builder">
            <div className="director-admin-email-footer-head">
              <div>
                <strong>Saved Footers</strong>
                <small>Personalize signature details and reuse footer presets anytime.</small>
              </div>
              <div className="director-admin-email-footer-head-actions">
                <span className="director-admin-email-footer-count">{footerPresets.length} saved</span>
                <Button type="button" variant="secondary" size="sm" onClick={() => setFooterPanelOpen((prev) => !prev)} aria-expanded={footerPanelOpen}>
                  {footerPanelOpen ? "Hide" : "Edit"}
                </Button>
              </div>
            </div>

            {footerPanelOpen ? (
              <>
                <div className="director-admin-email-footer-preset-bar">
                  <Input value={footerPresetName} onChange={(event) => setFooterPresetName(event.target.value)} placeholder="Footer preset name (e.g., Director Update)" />
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
                      <option key={preset.id} value={preset.id}>{preset.name}</option>
                    ))}
                  </Select>
                  <Button type="button" variant="secondary" onClick={applyFooterPreset} disabled={!selectedFooterPresetId || loadingFooterPresets}>Use Footer</Button>
                  <Button type="button" variant="secondary" onClick={saveFooterPreset} disabled={footerSaving}>Save Footer</Button>
                  <Button type="button" variant="secondary" onClick={deleteFooterPreset} disabled={!selectedFooterPresetId || footerSaving}>Delete Footer</Button>
                  <Button type="button" variant="secondary" onClick={makeFooterDefault} disabled={!selectedFooterPresetId || footerSaving}>Set Default</Button>
                </div>

                <div className="director-admin-email-footer-grid">
                  <label>Header label<Input value={activeFooter.headerTagline} onChange={(event) => setFooterDraft((prev) => normalizeEmailFooter({ ...prev, headerTagline: event.target.value }, fallbackFooter))} placeholder="Community update" /></label>
                  <label>Sign-off<Input value={activeFooter.signOff} onChange={(event) => setFooterDraft((prev) => normalizeEmailFooter({ ...prev, signOff: event.target.value }, fallbackFooter))} placeholder="Warmly," /></label>
                  <label>Name<Input value={activeFooter.senderName} onChange={(event) => setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderName: event.target.value }, fallbackFooter))} placeholder="Director name" /></label>
                  <label>Role<Input value={activeFooter.senderRole} onChange={(event) => setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderRole: event.target.value }, fallbackFooter))} placeholder="Director" /></label>
                  <label>Email<Input value={activeFooter.senderEmail} onChange={(event) => setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderEmail: event.target.value }, fallbackFooter))} placeholder="name@camp.org" /></label>
                  <label>Phone<Input value={activeFooter.senderPhone} onChange={(event) => setFooterDraft((prev) => normalizeEmailFooter({ ...prev, senderPhone: event.target.value }, fallbackFooter))} placeholder="(555) 555-5555" /></label>
                  <label className="inline-check director-admin-email-footer-toggle">
                    <input type="checkbox" checked={Boolean(activeFooter.showLogo)} onChange={(event) => setFooterDraft((prev) => normalizeEmailFooter({ ...prev, showLogo: event.target.checked }, fallbackFooter))} />
                    Include camp logo in footer
                  </label>
                  <p className="muted director-admin-email-footer-note">Footer logo uses your active camp branding logo automatically.</p>
                </div>
              </>
            ) : (
              <p className="muted director-admin-email-footer-collapsed-note">Footer details hidden. Click Edit to expand.</p>
            )}
          </section>

          <section className={`director-email-readiness ${emailReadiness?.ready ? "is-ready" : ""}`} aria-labelledby="email-readiness-title">
            <div className="director-email-readiness-head">
              <div>
                <span className="director-email-readiness-icon" aria-hidden="true">
                  {emailReadiness?.ready ? "✓" : "!"}
                </span>
                <div>
                  <strong id="email-readiness-title">Campaign readiness</strong>
                  <small>
                    {emailReadiness === null
                      ? "Checking recipients, compliance, and inbox quality…"
                      : emailReadiness.ready
                        ? "Required send checks pass. Review any suggestions below."
                        : `${emailReadiness.blockers?.length || 0} blocker${emailReadiness.blockers?.length === 1 ? "" : "s"} must be resolved.`}
                  </small>
                </div>
              </div>
              <span className="director-email-readiness-state">
                {emailReadiness?.ready ? "Ready for review" : "Not ready"}
              </span>
            </div>
            {emailReadiness?.blockers?.length ? (
              <ul className="director-email-readiness-list is-blocked">
                {emailReadiness.blockers.map((item) => <li key={item.code}>{item.message}</li>)}
              </ul>
            ) : null}
            {emailReadiness?.warnings?.length ? (
              <ul className="director-email-readiness-list is-warning">
                {emailReadiness.warnings.map((item) => <li key={item.code}>{item.message}</li>)}
              </ul>
            ) : null}
            {emailReadiness?.blockers?.some((item) => item.code === "postal_address_required") ? (
              <Link className="director-admin-inline-link" to={`/t/${slug}/admin/billing`}>Complete mailing address in Billing</Link>
            ) : null}
          </section>

          {/* Scheduling */}
          <label>
            Send timing
            <Select value={form.scheduleType} onChange={(event) => setForm((prev) => ({ ...prev, scheduleType: event.target.value }))}>
              <option value="now">Send now</option>
              <option value="later">Schedule for later</option>
            </Select>
          </label>
          {form.scheduleType === "later" ? (
            <label>
              Scheduled date/time
              <Input type="datetime-local" value={form.scheduledFor} onChange={(event) => setForm((prev) => ({ ...prev, scheduledFor: event.target.value }))} />
            </label>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}
          {status ? <p className="success-text">{status}</p> : null}
          <div className="inline-actions">
            <Button type="button" variant="secondary" onClick={handleClearDraft}>Clear Draft</Button>
            <Button type="button" variant="secondary" onClick={sendTestEmail}>Send Test Email</Button>
            <Button type="submit" disabled={sending || recipientPreview.count <= 0 || !emailReadiness?.ready}>
              {sending ? "Sending..." : form.scheduleType === "later" ? "Schedule Email" : "Send Email"}
            </Button>
          </div>
        </section>

        {/* Live preview */}
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
              <p className="director-admin-email-preheader-preview">
                {form.preheader.trim() || "Inbox preview text will appear here."}
              </p>
              <div
                className="director-admin-email-frame-body-html"
                dangerouslySetInnerHTML={{ __html: form.body || "<p>Write your message here and the preview updates in real time.</p>" }}
              />
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

      {/* Send confirmation modal */}
      <ModalConfirm
        open={showSendConfirm}
        title={form.scheduleType === "later" ? "Schedule Email?" : "Send Email?"}
        description={`Send "${form.subject}" to ${recipientPreview.count} recipient${recipientPreview.count !== 1 ? "s" : ""}${form.scheduleType === "later" ? ` scheduled for ${form.scheduledFor}` : " now"}?`}
        confirmLabel={form.scheduleType === "later" ? "Schedule" : "Send Now"}
        cancelLabel="Cancel"
        tone="danger"
        busy={sending}
        onConfirm={() => confirmSendEmail(false)}
        onCancel={() => setShowSendConfirm(false)}
      />

      {/* Duplicate broadcast warning modal */}
      <ModalConfirm
        open={showDuplicateConfirm}
        title="Duplicate Email Warning"
        description="An email with the same subject was sent within the last hour. Are you sure you want to send again?"
        confirmLabel="Send Anyway"
        cancelLabel="Cancel"
        tone="danger"
        busy={sending}
        onConfirm={() => confirmSendEmail(true)}
        onCancel={() => setShowDuplicateConfirm(false)}
      />
      <ModalConfirm {...confirmDialogProps} />
    </Card>
  );
}
