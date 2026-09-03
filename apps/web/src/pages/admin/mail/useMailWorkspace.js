import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_STAFF_ROLES } from "./mailAudience.js";
import { createFallbackFooter, normalizeFooter, normalizeFooterPresets } from "./mailFooter.js";

const LEGACY_GROUP_STORAGE_PREFIX = "pb_admin_email_recipient_groups";
const LEGACY_TEMPLATE_STORAGE_PREFIX = "pb_admin_email_templates";

function readLegacyList(prefix = "", slug = "") {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${prefix}:${String(slug || "").trim().toLowerCase()}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearLegacyList(prefix = "", slug = "") {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`${prefix}:${String(slug || "").trim().toLowerCase()}`);
  } catch { /* Ignore */ }
}

/**
 * Loads everything the mail workspace shares across folders: saved recipient
 * groups, templates, signatures and the role list used for targeting.
 */
export default function useMailWorkspace({ request, slug, tenant, user }) {
  const [groups, setGroups] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [availableRoles, setAvailableRoles] = useState(DEFAULT_STAFF_ROLES);
  const [availableIndustries, setAvailableIndustries] = useState([]);
  const [footerPresets, setFooterPresets] = useState([]);
  const [defaultFooterPresetId, setDefaultFooterPresetId] = useState("");
  const [activeFooter, setActiveFooter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fallbackFooter = useMemo(() => createFallbackFooter({ tenant, user }), [tenant, user]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.allSettled([
      request("/email/groups"),
      request("/email/templates"),
      request("/email/available-roles"),
      request("/email/available-industries"),
      request("/email/footer-presets")
    ])
      .then(([groupsResult, templatesResult, rolesResult, industriesResult, footerResult]) => {
        if (!active) return;

        const loadedGroups = groupsResult.status === "fulfilled" && Array.isArray(groupsResult.value?.groups)
          ? groupsResult.value.groups
          : [];
        const loadedTemplates = templatesResult.status === "fulfilled" && Array.isArray(templatesResult.value?.templates)
          ? templatesResult.value.templates
          : [];
        setGroups(loadedGroups);
        setTemplates(loadedTemplates);

        if (rolesResult.status === "fulfilled" && Array.isArray(rolesResult.value?.roles) && rolesResult.value.roles.length) {
          setAvailableRoles(rolesResult.value.roles);
        }
        if (industriesResult.status === "fulfilled" && Array.isArray(industriesResult.value?.industries)) {
          setAvailableIndustries(industriesResult.value.industries);
        }

        const footerPayload = footerResult.status === "fulfilled" ? footerResult.value : null;
        const presets = normalizeFooterPresets(footerPayload?.presets || [], fallbackFooter);
        const requestedId = String(footerPayload?.defaultPresetId || "").trim();
        const selectedId = presets.some((item) => item.id === requestedId) ? requestedId : String(presets[0]?.id || "");
        const selectedPreset = presets.find((item) => item.id === selectedId);
        setFooterPresets(presets);
        setDefaultFooterPresetId(selectedId);
        setActiveFooter(normalizeFooter(footerPayload?.activeFooter || {}, selectedPreset?.footer || fallbackFooter));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [fallbackFooter, request]);

  // One-time lift of anything a director saved before groups and templates were
  // stored on the server, so nothing silently disappears on this release.
  const migratedSlugRef = useRef("");
  useEffect(() => {
    if (loading || !slug || migratedSlugRef.current === slug) return;
    migratedSlugRef.current = slug;
    const legacyGroups = readLegacyList(LEGACY_GROUP_STORAGE_PREFIX, slug);
    const legacyTemplates = readLegacyList(LEGACY_TEMPLATE_STORAGE_PREFIX, slug);
    if (!legacyGroups.length && !legacyTemplates.length) return;

    const now = new Date().toISOString();
    const existingGroupNames = new Set(groups.map((item) => item.name.toLowerCase()));
    const migratedGroups = legacyGroups
      .filter((item) => String(item?.name || "").trim() && Array.isArray(item?.profileIds) && item.profileIds.length)
      .filter((item) => !existingGroupNames.has(String(item.name).trim().toLowerCase()))
      .map((item) => ({
        id: String(item.id || `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        name: String(item.name).trim().slice(0, 72),
        description: "",
        rules: [{ mode: "custom", roles: [], years: [], profileIds: item.profileIds, segment: "" }],
        updatedAt: String(item.updatedAt || now)
      }));

    const existingTemplateNames = new Set(templates.map((item) => item.name.toLowerCase()));
    const migratedTemplates = legacyTemplates
      .filter((item) => String(item?.name || "").trim())
      .filter((item) => !existingTemplateNames.has(String(item.name).trim().toLowerCase()))
      .map((item) => ({
        id: String(item.id || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        name: String(item.name).trim().slice(0, 72),
        subject: String(item.subject || ""),
        preheader: String(item.preheader || ""),
        body: String(item.body || ""),
        updatedAt: String(item.updatedAt || now)
      }));

    async function migrate() {
      try {
        if (migratedGroups.length) {
          const payload = await request("/email/groups", {
            method: "PUT",
            body: { groups: [...migratedGroups, ...groups].slice(0, 60) }
          });
          setGroups(Array.isArray(payload?.groups) ? payload.groups : groups);
        }
        if (migratedTemplates.length) {
          const payload = await request("/email/templates", {
            method: "PUT",
            body: { templates: [...migratedTemplates, ...templates].slice(0, 40) }
          });
          setTemplates(Array.isArray(payload?.templates) ? payload.templates : templates);
        }
        clearLegacyList(LEGACY_GROUP_STORAGE_PREFIX, slug);
        clearLegacyList(LEGACY_TEMPLATE_STORAGE_PREFIX, slug);
      } catch { /* Keep the local copy so the next visit can retry. */ }
    }
    migrate();
    // groups/templates are read once here, guarded by migratedSlugRef, so they
    // are intentionally not dependencies.
  }, [groups, loading, request, slug, templates]);

  const saveGroups = useCallback(async (nextGroups = []) => {
    setSaving(true);
    setError("");
    try {
      const payload = await request("/email/groups", { method: "PUT", body: { groups: nextGroups } });
      const saved = Array.isArray(payload?.groups) ? payload.groups : nextGroups;
      setGroups(saved);
      return { ok: true, groups: saved };
    } catch (requestError) {
      setError(requestError.message || "Failed to save recipient groups.");
      return { ok: false, groups };
    } finally {
      setSaving(false);
    }
  }, [groups, request]);

  const saveTemplates = useCallback(async (nextTemplates = []) => {
    setSaving(true);
    setError("");
    try {
      const payload = await request("/email/templates", { method: "PUT", body: { templates: nextTemplates } });
      const saved = Array.isArray(payload?.templates) ? payload.templates : nextTemplates;
      setTemplates(saved);
      return { ok: true, templates: saved };
    } catch (requestError) {
      setError(requestError.message || "Failed to save templates.");
      return { ok: false, templates };
    } finally {
      setSaving(false);
    }
  }, [request, templates]);

  const saveFooterPresets = useCallback(async (nextPresets = [], nextDefaultId = "") => {
    setSaving(true);
    setError("");
    try {
      const payload = await request("/email/footer-presets", {
        method: "PATCH",
        body: { presets: nextPresets, defaultPresetId: nextDefaultId }
      });
      const presets = normalizeFooterPresets(payload?.presets || nextPresets, fallbackFooter);
      const requestedId = String(nextDefaultId || payload?.defaultPresetId || "").trim();
      const selectedId = presets.some((item) => item.id === requestedId)
        ? requestedId
        : String(payload?.defaultPresetId || presets[0]?.id || "");
      setFooterPresets(presets);
      setDefaultFooterPresetId(selectedId);
      return { ok: true, presets, defaultPresetId: selectedId };
    } catch (requestError) {
      setError(requestError.message || "Failed to save signatures.");
      return { ok: false };
    } finally {
      setSaving(false);
    }
  }, [fallbackFooter, request]);

  return {
    loading,
    saving,
    error,
    setError,
    groups,
    templates,
    availableRoles,
    availableIndustries,
    footerPresets,
    defaultFooterPresetId,
    fallbackFooter,
    activeFooter: activeFooter || fallbackFooter,
    setActiveFooter,
    saveGroups,
    saveTemplates,
    saveFooterPresets
  };
}
