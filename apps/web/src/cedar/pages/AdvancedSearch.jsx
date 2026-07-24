import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  GraduationCap,
  MapPin,
  Search,
  SearchX,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { requestJson } from "../../lib/http.js";
import { resolveAlumniWord, resolveStaffRoleOptions } from "../../lib/campLabels.js";
import { tenantRoute } from "../../lib/tenantRouting.js";
import { avatarUrl } from "../lib/helpers.js";
import CedarBackground from "../components/CedarBackground";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import "./advanced-search.css";

function pickCurrentJob(profile = {}) {
  if (profile.currentJob) {
    if (typeof profile.currentJob === "string") {
      const [rawRole, rawCompany] = profile.currentJob.split("@").map((value) => value?.trim());
      return { role: rawRole || "", company: rawCompany || "" };
    }
    if (typeof profile.currentJob === "object" && profile.currentJob !== null) {
      const role =
        profile.currentJob.role || profile.currentJob.title || profile.currentJob.jobTitle || "";
      const company =
        profile.currentJob.company ||
        profile.currentJob.organization ||
        profile.currentJob.org ||
        "";
      if (role || company) return { role, company };
    }
  }

  const singleRole =
    profile.currentJobTitle || profile.jobTitle || profile.title || profile.currentRole || "";
  const singleCompany = profile.currentCompany || profile.company || "";
  const arr =
    (Array.isArray(profile.currentJobs) && profile.currentJobs) ||
    (Array.isArray(profile.jobs) && profile.jobs) ||
    (Array.isArray(profile.employment) && profile.employment) ||
    [];
  const job = arr.find((entry) => entry?.isCurrent || entry?.current) ?? arr[0] ?? null;
  const arrayRole = job?.role || job?.title || "";
  const arrayCompany = job?.company || job?.organization || job?.org || "";

  return { role: singleRole || arrayRole || "", company: singleCompany || arrayCompany || "" };
}

const DEBOUNCE = 400;
const AI_SEARCH_PROMPTS = Object.freeze([
  "Former counselors in Boston who work in healthcare",
  "People from camp who work in technology",
  "Members who attended the same college as me"
]);

function useDebounced(value, delay = DEBOUNCE) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const parseList = (value) =>
  String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

function planToFormFields(plan = {}) {
  return {
    q: String(plan.q || ""),
    cedarRoles: Array.isArray(plan.cedarRoles) ? plan.cedarRoles.join(", ") : "",
    industries: Array.isArray(plan.industries) ? plan.industries.join(", ") : "",
    city: String(plan.city || ""),
    state: String(plan.state || ""),
    role: String(plan.role || ""),
    company: String(plan.company || ""),
    college: String(plan.college || ""),
    gradMin: plan.gradMin == null ? "" : String(plan.gradMin),
    gradMax: plan.gradMax == null ? "" : String(plan.gradMax),
    camperMin: plan.camperMin == null ? "" : String(plan.camperMin),
    camperMax: plan.camperMax == null ? "" : String(plan.camperMax),
    offset: 0
  };
}

function initials(first = "", last = "") {
  const f = first?.trim()[0] || "";
  const l = last?.trim()[0] || "";
  return (f + l).toUpperCase();
}

function buildPageItems(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, idx) => idx + 1);

  const items = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);

  if (start > 2) items.push("left-ellipsis");
  for (let value = start; value <= end; value += 1) items.push(value);
  if (end < pages - 1) items.push("right-ellipsis");

  items.push(pages);
  return items;
}

export function RolesMultiSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = parseList(value);

  useEffect(() => {
    const onDocClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const toggle = (option) => {
    const has = selected.includes(option);
    const next = has ? selected.filter((v) => v !== option) : [...selected, option];
    onChange(next.join(", "));
  };

  return (
    <div className="as2-mwrap" ref={ref}>
      <button
        type="button"
        className={`as2-mselect ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="camp-role-options"
        aria-label="Former or current role at camp"
      >
        {selected.length ? (
          <div className="as2-tags">
            {selected.map((tag) => (
              <span key={tag} className="as2-tag">{tag}</span>
            ))}
          </div>
        ) : (
          <span className="as2-placeholder">Select roles...</span>
        )}
        <ChevronDown size={14} className="as2-caret" aria-hidden="true" />
      </button>

      {open && (
        <div id="camp-role-options" className="as2-menu" role="group" aria-label="Camp roles">
          {options.map((option) => (
            <label key={option} className="as2-option">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => toggle(option)}
              />
              <span>{option}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" className="as2-menu-clear" onClick={() => onChange("")}>
              Clear roles
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function SectionHead({
  icon: Icon,
  label,
  active = false,
  onClick,
  open = false,
  nonCollapsible = false,
}) {
  const content = (
    <>
      <span className="as2-head-label">
        <Icon size={15} aria-hidden="true" />
        <span>{label}</span>
        {active && <span className="as2-active-dot" aria-hidden="true" />}
      </span>
      {!nonCollapsible && <ChevronDown size={15} className="chev" aria-hidden="true" />}
    </>
  );
  if (nonCollapsible) {
    return <div className="as2-sec-head static">{content}</div>;
  }
  return (
    <button
      className="as2-sec-head"
      onClick={onClick}
      type="button"
      aria-expanded={open}
    >
      {content}
    </button>
  );
}

export default function AdvancedSearch() {
  const { tenant, slug } = useTenant();
  const { token, getAuthToken, isReady: authReady } = useAuth();
  const alumniWord = resolveAlumniWord(tenant);
  const staffRoleOptions = useMemo(() => resolveStaffRoleOptions(tenant), [tenant]);

  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const currentParamsKey = params.toString();

  const [form, setForm] = useState(() => ({
    q: params.get("q") || "",
    cedarRoles: params.get("cedarRoles") || "",
    industries: params.get("industries") || "",
    city: params.get("city") || "",
    state: params.get("state") || "",
    college: params.get("college") || "",
    gradMin: params.get("gradMin") || "",
    gradMax: params.get("gradMax") || "",
    camperMin: params.get("camperMin") || "",
    camperMax: params.get("camperMax") || "",
    role: params.get("role") || "",
    company: params.get("company") || "",
    sort: params.get("sort") || "name",
    offset: parseInt(params.get("offset") || "0", 10),
    limit: parseInt(params.get("limit") || "24", 10),
  }));

  const [ui, setUi] = useState({
    drawerOpen: false,
    sections: {
      name: true,
      cedarRoles: false,
      industry: false,
      role: false,
      college: false,
      camperYears: false,
      location: false,
      company: false,
    },
  });

  const [state, setState] = useState({
    loading: false,
    items: [],
    total: 0,
    error: null,
  });
  const [aiCapability, setAiCapability] = useState(null);
  const [aiQuery, setAiQuery] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiMeta, setAiMeta] = useState(null);

  const nameInputRef = useRef(null);
  const resultsRef = useRef(null);
  const authTokenRef = useRef(token || "");
  const getAuthTokenRef = useRef(getAuthToken);

  const debounced = useDebounced(form);

  useEffect(() => {
    authTokenRef.current = token || "";
  }, [token]);

  useEffect(() => {
    getAuthTokenRef.current = getAuthToken;
  }, [getAuthToken]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    if (!authReady || !slug) {
      setAiCapability(null);
      return () => {
        alive = false;
        controller.abort();
      };
    }
    requestJson(`/api/t/${slug}/search/ai/capabilities`, {
      token: authTokenRef.current,
      getToken: async ({ forceRefresh = false } = {}) => {
        if (typeof getAuthTokenRef.current === "function") {
          return (await getAuthTokenRef.current({ forceRefresh })) || authTokenRef.current;
        }
        return authTokenRef.current;
      },
      signal: controller.signal
    })
      .then((payload) => {
        if (alive) setAiCapability(payload || null);
      })
      .catch((error) => {
        if (error?.name !== "AbortError" && alive) setAiCapability(null);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [authReady, slug]);

  const hasActiveFilters = useMemo(() => {
    const {
      q,
      cedarRoles,
      industries,
      city,
      state: stateField,
      college,
      gradMin,
      gradMax,
      camperMin,
      camperMax,
      role,
      company,
    } = debounced;

    return [
      q,
      cedarRoles,
      industries,
      city,
      stateField,
      college,
      gradMin,
      gradMax,
      camperMin,
      camperMax,
      role,
      company,
    ].some((value) => String(value || "").trim() !== "");
  }, [debounced]);

  const industriesList = useMemo(() => parseList(form.industries), [form.industries]);

  const sectionActive = useMemo(
    () => ({
      name: Boolean(form.q.trim()),
      cedarRoles: Boolean(form.cedarRoles.trim()),
      industry: Boolean(form.industries.trim()),
      role: Boolean(form.role.trim()),
      college: Boolean(form.college.trim() || form.gradMin || form.gradMax),
      camperYears: Boolean(form.camperMin || form.camperMax),
      location: Boolean(form.city.trim() || form.state.trim()),
      company: Boolean(form.company.trim()),
      display: Boolean(form.sort !== "name" || Number(form.limit) !== 24),
    }),
    [form]
  );

  const rolePreview = useMemo(() => {
    if (!staffRoleOptions.length) return "";
    const base = staffRoleOptions.slice(0, 3).join(", ");
    const extra = staffRoleOptions.length > 3 ? `, and ${staffRoleOptions.length - 3} more` : "";
    return `${base}${extra}`;
  }, [staffRoleOptions]);

  useEffect(() => {
    if (!ui.drawerOpen) return;
    const onEsc = (event) => {
      if (event.key === "Escape") setUi((curr) => ({ ...curr, drawerOpen: false }));
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [ui.drawerOpen]);

  useEffect(() => {
    const p = new URLSearchParams();
    Object.entries(debounced).forEach(([key, value]) => {
      if (value !== "" && value !== null && value !== undefined) p.set(key, String(value));
    });
    if (p.toString() === currentParamsKey) return;
    setParams(p, { replace: true });
  }, [currentParamsKey, debounced, setParams]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    if (!authReady || !slug) {
      setState((curr) => ({ ...curr, loading: false }));
      return () => {
        alive = false;
        controller.abort();
      };
    }

    if (!hasActiveFilters) {
      setState({ loading: false, items: [], total: 0, error: null });
      return () => {
        alive = false;
        controller.abort();
      };
    }

    (async () => {
      setState((curr) => ({ ...curr, loading: true, error: null }));
      try {
        const qs = new URLSearchParams();
        Object.entries(debounced).forEach(([key, value]) => {
          if (value !== "" && value !== null && value !== undefined) qs.set(key, String(value));
        });
        qs.set("fetchLimit", "1000");

        const data = await requestJson(`/api/t/${slug}/search/users?${qs.toString()}`, {
          token: authTokenRef.current,
          getToken: async ({ forceRefresh = false } = {}) => {
            if (typeof getAuthTokenRef.current === "function") {
              const next = await getAuthTokenRef.current({ forceRefresh });
              if (next) return next;
            }
            return authTokenRef.current;
          },
          signal: controller.signal
        });
        if (!alive) return;

        setState({
          loading: false,
          items: Array.isArray(data.items) ? data.items : [],
          total: Number.isFinite(data.total) ? data.total : data.items?.length || 0,
          error: null,
        });
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!alive) return;
        setState({ loading: false, items: [], total: 0, error: "Failed to load results." });
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [authReady, debounced, hasActiveFilters, slug]);

  const onField = (key) => (event) => {
    const value = event?.target?.value ?? event;
    setAiMeta(null);
    setForm((curr) => ({ ...curr, [key]: value, offset: 0 }));
  };

  const setFields = (updates = {}) => {
    setAiMeta(null);
    setForm((curr) => ({ ...curr, ...updates, offset: 0 }));
  };

  const clearAll = () => {
    setForm({
      q: "",
      cedarRoles: "",
      industries: "",
      city: "",
      state: "",
      college: "",
      gradMin: "",
      gradMax: "",
      camperMin: "",
      camperMax: "",
      role: "",
      company: "",
      sort: "name",
      offset: 0,
      limit: 24,
    });
    setState({ loading: false, items: [], total: 0, error: null });
    setAiMeta(null);
    setAiError("");
  };

  const runAiSearch = async (event, suggestedQuery = "") => {
    event?.preventDefault?.();
    const requestedQuery = String(suggestedQuery || aiQuery || "").trim();
    if (!requestedQuery || !aiCapability?.featureEnabled || aiSearching) return;
    setAiQuery(requestedQuery);
    setAiSearching(true);
    setAiError("");
    try {
      const data = await requestJson(`/api/t/${slug}/search/ai/query`, {
        method: "POST",
        token: authTokenRef.current,
        getToken: async ({ forceRefresh = false } = {}) => {
          if (typeof getAuthTokenRef.current === "function") {
            return (await getAuthTokenRef.current({ forceRefresh })) || authTokenRef.current;
          }
          return authTokenRef.current;
        },
        body: JSON.stringify({ query: requestedQuery, limit: form.limit, sort: form.sort })
      });
      const plan = data?.plan && typeof data.plan === "object" ? data.plan : {};
      setForm((current) => ({ ...current, ...planToFormFields(plan) }));
      setState({
        loading: false,
        items: Array.isArray(data?.items) ? data.items : [],
        total: Number.isFinite(data?.total) ? data.total : data?.items?.length || 0,
        error: null
      });
      setAiMeta({
        mode: data?.mode === "ai" ? "ai" : "guided_fallback",
        plan,
        query: requestedQuery
      });
      requestAnimationFrame(scrollToResults);
    } catch (error) {
      setAiError(error?.message || "Smart search could not interpret that request. Try the filters instead.");
    } finally {
      setAiSearching(false);
    }
  };

  const removeIndustry = (value) => {
    const next = industriesList.filter(
      (entry) => entry.toLowerCase() !== String(value).toLowerCase()
    );
    setForm((curr) => ({ ...curr, industries: next.join(", "), offset: 0 }));
  };

  const toggle = (key) => {
    setUi((curr) => ({
      ...curr,
      sections: {
        ...curr.sections,
        [key]: !curr.sections[key],
      },
    }));
  };

  const page = Math.floor((form.offset || 0) / (form.limit || 24)) + 1;
  const pages = Math.max(1, Math.ceil((state.total || 0) / (form.limit || 24)));
  const fromN = state.total ? form.offset + 1 : 0;
  const toN = state.total ? Math.min(form.offset + form.limit, state.total) : 0;

  const scrollToResults = () => {
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const gotoPage = (nextPage) => {
    if (nextPage < 1 || nextPage > pages || nextPage === page) return;
    setForm((curr) => ({ ...curr, offset: (nextPage - 1) * curr.limit }));
    scrollToResults();
  };

  const prevPage = () => gotoPage(page - 1);
  const nextPage = () => gotoPage(page + 1);
  const pageItems = useMemo(() => buildPageItems(page, pages), [page, pages]);

  const activeFilterChips = useMemo(() => {
    const chips = [];
    const push = (key, label) => chips.push({ key, label });

    if (form.q.trim()) push("q", `Name: ${form.q.trim()}`);
    if (form.cedarRoles.trim()) push("cedarRoles", `Camp role: ${form.cedarRoles.trim()}`);
    if (form.industries.trim()) push("industries", `Industry: ${form.industries.trim()}`);
    if (form.role.trim()) push("role", `Title: ${form.role.trim()}`);
    if (form.company.trim()) push("company", `Company: ${form.company.trim()}`);
    if (form.college.trim()) push("college", `College: ${form.college.trim()}`);

    if (form.gradMin || form.gradMax) {
      push("gradRange", `Grad: ${form.gradMin || "..."} - ${form.gradMax || "..."}`);
    }

    if (form.camperMin || form.camperMax) {
      push("camperRange", `Camper: ${form.camperMin || "..."} - ${form.camperMax || "..."}`);
    }

    if (form.city.trim() || form.state.trim()) {
      const loc = [form.city.trim(), form.state.trim()].filter(Boolean).join(", ");
      push("location", `Location: ${loc}`);
    }

    return chips;
  }, [form]);

  const removeFilterChip = (key) => {
    if (key === "gradRange") return setFields({ gradMin: "", gradMax: "" });
    if (key === "camperRange") return setFields({ camperMin: "", camperMax: "" });
    if (key === "location") return setFields({ city: "", state: "" });
    return setFields({ [key]: "" });
  };

  const header = useMemo(
    () => aiMeta ? "Smart search matches" : !form.q ? "Advanced Search" : `Results for "${form.q}"`,
    [aiMeta, form.q]
  );
  const skeletonCount = Math.min(Math.max(Number(form.limit || 8), 1), 12);
  const closeDrawer = () => setUi((curr) => ({ ...curr, drawerOpen: false }));

  return (
    <div className="as2-shell">
      <CedarBackground behavior="scroll" opacity={0.9} fixed zIndex={-1} />

      <main className="as2 nav2-page-shell" style={{ position: "relative", zIndex: 1 }}>
        <div className="as2-page-header">
          <CedarPageHeader
            icon={<SlidersHorizontal size={18} />}
            title="Advanced Search"
            subtitle={`Find ${alumniWord} by name, camp role, industry, education, and location.`}
          />
        </div>

        <button
          type="button"
          className="as2-filters-fab"
          onClick={() => setUi((curr) => ({ ...curr, drawerOpen: true }))}
        >
          <SlidersHorizontal size={15} />
          Filters
        </button>

        <div className="as2-wrap">
          <div
            className={`as2-drawer-backdrop${ui.drawerOpen ? " is-open" : ""}`}
            onClick={closeDrawer}
            aria-hidden="true"
          />

          <aside className={`as2-rail${ui.drawerOpen ? " is-open" : ""}`}>
            <div className="as2-rail-head">
              <div className="as2-rail-title">
                <SlidersHorizontal size={16} aria-hidden="true" />
                <h2>Search Filters</h2>
              </div>

              <div className="as2-rail-actions">
                <button className="as2-btn as2-btn-ghost" onClick={clearAll} type="button">
                  Reset
                </button>
                <button
                  className="as2-rail-close"
                  type="button"
                  onClick={closeDrawer}
                  aria-label="Close filters"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <section className={`as2-sec ${ui.sections.name ? "open" : ""}`}>
              <SectionHead
                icon={Search}
                label="Name"
                active={sectionActive.name}
                open={ui.sections.name}
                onClick={() => toggle("name")}
              />
              <div className="as2-sec-body">
                <div className="as2-sec-inner">
                  <input
                    ref={nameInputRef}
                    className="as2-input"
                    value={form.q}
                    onChange={onField("q")}
                    placeholder="e.g., Henry"
                    aria-label="Member name"
                  />
                </div>
              </div>
            </section>

            <section className={`as2-sec ${ui.sections.cedarRoles ? "open" : ""}`}>
              <SectionHead
                icon={Users}
                label="Former/Current Role at Camp"
                active={sectionActive.cedarRoles}
                open={ui.sections.cedarRoles}
                onClick={() => toggle("cedarRoles")}
              />
              <div className="as2-sec-body">
                <div className="as2-sec-inner">
                  <RolesMultiSelect
                    options={staffRoleOptions}
                    value={form.cedarRoles}
                    onChange={(v) => setForm((curr) => ({ ...curr, cedarRoles: v, offset: 0 }))}
                  />
                </div>
              </div>
            </section>

            <section className={`as2-sec ${ui.sections.camperYears ? "open" : ""}`}>
              <SectionHead
                icon={CalendarDays}
                label="Camper Years"
                active={sectionActive.camperYears}
                open={ui.sections.camperYears}
                onClick={() => toggle("camperYears")}
              />
              <div className="as2-sec-body">
                <div className="as2-sec-inner">
                  <div className="as2-row">
                    <div className="as2-col">
                      <label className="as2-label" htmlFor="advanced-search-camper-min">Min</label>
                      <input
                        id="advanced-search-camper-min"
                        className="as2-input"
                        type="number"
                        inputMode="numeric"
                        min="1900"
                        max="2100"
                        value={form.camperMin}
                        onChange={onField("camperMin")}
                        placeholder="year"
                      />
                    </div>
                    <div className="as2-col">
                      <label className="as2-label" htmlFor="advanced-search-camper-max">Max</label>
                      <input
                        id="advanced-search-camper-max"
                        className="as2-input"
                        type="number"
                        inputMode="numeric"
                        min="1900"
                        max="2100"
                        value={form.camperMax}
                        onChange={onField("camperMax")}
                        placeholder="year"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className={`as2-sec ${ui.sections.industry ? "open" : ""}`}>
              <SectionHead
                icon={Briefcase}
                label="Industry"
                active={sectionActive.industry}
                open={ui.sections.industry}
                onClick={() => toggle("industry")}
              />
              <div className="as2-sec-body">
                <div className="as2-sec-inner">
                  <input
                    className="as2-input"
                    value={form.industries}
                    onChange={onField("industries")}
                    placeholder="e.g., Finance, Law"
                    aria-label="Industries"
                  />
                  <p className="as2-help">Separate multiple industries with commas.</p>

                  {!!industriesList.length && (
                    <div className="as2-chips">
                      {industriesList.map((tag) => (
                        <span key={tag} className="as2-chip">
                          {tag}
                          <button
                            type="button"
                            className="x"
                            onClick={() => removeIndustry(tag)}
                            aria-label={`Remove ${tag}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className={`as2-sec ${ui.sections.role ? "open" : ""}`}>
              <SectionHead
                icon={Tag}
                label="Role / Title"
                active={sectionActive.role}
                open={ui.sections.role}
                onClick={() => toggle("role")}
              />
              <div className="as2-sec-body">
                <div className="as2-sec-inner">
                  <input
                    className="as2-input"
                    value={form.role}
                    onChange={onField("role")}
                    placeholder="e.g., Software Engineer"
                    aria-label="Professional role or title"
                  />
                </div>
              </div>
            </section>

            <section className={`as2-sec ${ui.sections.company ? "open" : ""}`}>
              <SectionHead
                icon={Building2}
                label="Company"
                active={sectionActive.company}
                open={ui.sections.company}
                onClick={() => toggle("company")}
              />
              <div className="as2-sec-body">
                <div className="as2-sec-inner">
                  <input
                    className="as2-input"
                    value={form.company}
                    onChange={onField("company")}
                    placeholder="e.g., KX Bank"
                    aria-label="Company"
                  />
                </div>
              </div>
            </section>

            <section className={`as2-sec ${ui.sections.college ? "open" : ""}`}>
              <SectionHead
                icon={GraduationCap}
                label="College & Grad Year"
                active={sectionActive.college}
                open={ui.sections.college}
                onClick={() => toggle("college")}
              />
              <div className="as2-sec-body">
                <div className="as2-sec-inner">
                  <input
                    className="as2-input"
                    value={form.college}
                    onChange={onField("college")}
                    placeholder="e.g., UCLA"
                    aria-label="College"
                  />

                  <div className="as2-row">
                    <div className="as2-col">
                      <label className="as2-label" htmlFor="advanced-search-grad-min">Min</label>
                      <input
                        id="advanced-search-grad-min"
                        className="as2-input"
                        type="number"
                        inputMode="numeric"
                        min="1900"
                        max="2100"
                        value={form.gradMin}
                        onChange={onField("gradMin")}
                        placeholder="year"
                      />
                    </div>
                    <div className="as2-col">
                      <label className="as2-label" htmlFor="advanced-search-grad-max">Max</label>
                      <input
                        id="advanced-search-grad-max"
                        className="as2-input"
                        type="number"
                        inputMode="numeric"
                        min="1900"
                        max="2100"
                        value={form.gradMax}
                        onChange={onField("gradMax")}
                        placeholder="year"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className={`as2-sec ${ui.sections.location ? "open" : ""}`}>
              <SectionHead
                icon={MapPin}
                label="Location"
                active={sectionActive.location}
                open={ui.sections.location}
                onClick={() => toggle("location")}
              />
              <div className="as2-sec-body">
                <div className="as2-sec-inner">
                  <div className="as2-row">
                    <input
                      className="as2-input"
                      value={form.city}
                      onChange={onField("city")}
                      placeholder="City"
                      aria-label="City"
                    />
                    <input
                      className="as2-input"
                      value={form.state}
                      onChange={onField("state")}
                      placeholder="State / Country"
                      aria-label="State or Country"
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="as2-sec open">
              <SectionHead
                icon={SlidersHorizontal}
                label="Display Options"
                active={sectionActive.display}
                nonCollapsible
              />
              <div className="as2-sec-body">
                <div className="as2-sec-inner">
                  <div className="as2-row">
                    <div className="as2-col">
                      <label className="as2-label" htmlFor="advanced-search-sort">Sort</label>
                      <select id="advanced-search-sort" className="as2-input" value={form.sort} onChange={onField("sort")}>
                        <option value="name">Name (A-Z)</option>
                        <option value="recent">Recently Added</option>
                      </select>
                    </div>
                    <div className="as2-col">
                      <label className="as2-label" htmlFor="advanced-search-page-size">Per Page</label>
                      <select
                        id="advanced-search-page-size"
                        className="as2-input"
                        value={form.limit}
                        onChange={(event) =>
                          setForm((curr) => ({
                            ...curr,
                            limit: parseInt(event.target.value, 10),
                            offset: 0,
                          }))
                        }
                      >
                        <option value={12}>12</option>
                        <option value={24}>24</option>
                        <option value={48}>48</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div className="as2-rail-footer">
              <button type="button" className="as2-rail-done" onClick={closeDrawer}>
                Done
              </button>
            </div>
          </aside>

          <section className="as2-results" ref={resultsRef}>
            {aiCapability?.featureEnabled ? (
              <section className="as2-ai-card" aria-labelledby="camp-search-ai-title">
                <div className="as2-ai-card-head">
                  <span className="as2-ai-icon" aria-hidden="true"><Sparkles size={19} /></span>
                  <div>
                    <div className="as2-ai-eyebrow">Camp Search AI</div>
                    <h2 id="camp-search-ai-title">Ask your camp directory</h2>
                    <p>Describe who you want to reconnect with. We’ll turn it into private, camp-only search filters.</p>
                  </div>
                </div>
                <form className="as2-ai-form" onSubmit={runAiSearch}>
                  <label className="sr-only" htmlFor="camp-ai-search-query">Describe who you want to find</label>
                  <div className="as2-ai-input-wrap">
                    <Sparkles size={18} aria-hidden="true" />
                    <input
                      id="camp-ai-search-query"
                      value={aiQuery}
                      onChange={(event) => setAiQuery(event.target.value)}
                      placeholder="e.g., Former counselors in Boston who work in healthcare"
                      maxLength={320}
                      autoComplete="off"
                      aria-invalid={Boolean(aiError)}
                      aria-describedby={aiError ? "camp-ai-search-privacy camp-ai-search-error" : "camp-ai-search-privacy"}
                    />
                    <button type="submit" disabled={aiSearching || !aiQuery.trim()}>
                      {aiSearching ? "Searching…" : "Find people"}
                    </button>
                  </div>
                </form>
                <div className="as2-ai-prompts" role="group" aria-label="Suggested searches">
                  {AI_SEARCH_PROMPTS.map((prompt) => (
                    <button key={prompt} type="button" onClick={(event) => runAiSearch(event, prompt)} disabled={aiSearching}>
                      {prompt}
                    </button>
                  ))}
                </div>
                <div className="as2-ai-privacy" id="camp-ai-search-privacy">
                  <ShieldCheck size={15} aria-hidden="true" />
                  <span>
                    {aiCapability.available
                      ? "AI sees only your search sentence—not member profiles or results."
                      : "Guided search is available while the AI provider is offline; member data stays inside PondBridge."}
                  </span>
                </div>
                {aiError ? <p className="as2-ai-error" id="camp-ai-search-error" role="alert">{aiError}</p> : null}
              </section>
            ) : null}

            {aiMeta ? (
              <div className={`as2-ai-applied ${aiMeta.mode === "ai" ? "is-ai" : "is-guided"}`} role="status">
                <Sparkles size={16} aria-hidden="true" />
                <span>
                  {aiMeta.mode === "ai"
                    ? "AI interpreted your request and applied the filters below. Results still come from this camp’s permission-checked directory."
                    : "AI was temporarily unavailable, so PondBridge applied a local guided-search plan. You can adjust any filter."}
                </span>
              </div>
            ) : null}

            {hasActiveFilters && (
              <div className="as2-results-head">
                <div className="lhs">
                  <h1 className="as2-title">{header}</h1>
                  {!state.loading && (
                    <div className="as2-sub">
                      Showing {fromN}-{toN} of {state.total}
                    </div>
                  )}
                </div>
              </div>
            )}

            {!!activeFilterChips.length && (
              <div className="as2-filter-chips">
                {activeFilterChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className="as2-filter-chip"
                    onClick={() => removeFilterChip(chip.key)}
                    title="Remove filter"
                    aria-label={`Remove ${chip.label} filter`}
                  >
                    <span>{chip.label}</span>
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}

            {!hasActiveFilters ? (
              <div className="as2-emptywrap">
                <div className="as2-emptycard">
                  <div className="as2-empty-icon" aria-hidden="true">
                    <Search size={56} />
                  </div>
                  <h3>Start an advanced search</h3>
                  <p className="muted">
                    {`Use filters to find ${alumniWord} by name, role, industry, college, years, or location.`}
                  </p>
                  <ul className="as2-emptylist">
                    <li>
                      Search by name with <span className="kbd">Name</span>
                    </li>
                    <li>
                      {`Find ${alumniWord} in `}<span className="kbd">Industry</span>
                    </li>
                    <li>
                      Discover who went to your <span className="kbd">College</span>
                    </li>
                    <li>
                      Filter by camp roles ({rolePreview || "counselor, division head, and more"})
                    </li>
                  </ul>
                  <div className="as2-empty-actions">
                    <button
                      className="as2-btn as2-btn-primary"
                      onClick={() => {
                        setUi((curr) => ({
                          ...curr,
                          drawerOpen: true,
                          sections: { ...curr.sections, name: true },
                        }));
                        requestAnimationFrame(() => nameInputRef.current?.focus());
                      }}
                    >
                      Start with a name search
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {state.loading && (
                  <div className="as2-grid">
                    {Array.from({ length: skeletonCount }).map((_, index) => (
                      <div
                        className="as2-card as2-skel"
                        key={index}
                        style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s` }}
                      >
                        <div className="ph avatar" />
                        <div className="ph name" />
                        <div className="ph industry" />
                        <div className="ph loc" />
                        <div className="ph job" />
                        <div className="as2-cta">
                          <div className="ph btn" />
                          <div className="ph btn" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!state.loading && state.error && (
                  <div className="as2-emptywrap">
                    <div className="as2-emptycard">
                      <div
                        className="as2-empty-icon"
                        style={{ color: "#dc2626" }}
                        aria-hidden="true"
                      >
                        <AlertCircle size={48} />
                      </div>
                      <h3>We couldn't load results</h3>
                      <p className="muted">{state.error}</p>
                      <button className="as2-btn as2-btn-outline" onClick={clearAll}>
                        Reset filters
                      </button>
                    </div>
                  </div>
                )}

                {!state.loading && !state.error && (
                  <>
                    {state.items.length === 0 ? (
                      <div className="as2-emptywrap">
                        <div className="as2-emptycard">
                          <div className="as2-empty-icon" aria-hidden="true">
                            <SearchX size={48} />
                          </div>
                          <h3>No matches</h3>
                          <p className="muted">Try widening or clearing your filters.</p>
                          <div className="as2-empty-actions">
                            <button className="as2-btn as2-btn-outline" onClick={clearAll}>
                              Clear all filters
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="as2-grid">
                          {state.items.map((profile, index) => {
                            const id = String(
                              profile.id || profile._id || profile.profileId || profile.userId || ""
                            ).trim();
                            if (!id || id === "undefined" || id === "null") return null;

                            const first = profile.firstName || profile.first || "";
                            const last = profile.lastName || profile.last || "";
                            const photo = avatarUrl(profile);

                            const industry =
                              profile.industry ||
                              profile.primaryIndustry ||
                              (Array.isArray(profile.industries) && profile.industries[0]) ||
                              profile.sector ||
                              "";

                            const { role, company } = pickCurrentJob(profile);
                            const jobLine = [role, company && `at ${company}`]
                              .filter(Boolean)
                              .join(" ");
                            const loc =
                              profile.location ||
                              [profile.city, profile.state || profile.region, profile.country]
                                .filter(Boolean)
                                .join(", ");

                            const profilePath = tenantRoute(slug, `/profile/${id}`);
                            const profileWithName = `${profilePath}?name=${encodeURIComponent(
                              `${first} ${last}`
                            )}`;
                            const hasMeta = Boolean(industry || loc || jobLine);

                            return (
                              <div
                                className="as2-card"
                                key={id}
                                style={{ animationDelay: `${Math.min(index * 0.04, 0.4)}s` }}
                              >
                                <Link
                                  to={profileWithName}
                                  state={{ preload: profile }}
                                  className="as2-card-link"
                                  aria-label={`${first} ${last} profile`}
                                >
                                  {photo ? (
                                    <img
                                      className="as2-avatar"
                                      src={photo}
                                      alt={`${first} ${last}`}
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  ) : (
                                    <div className="as2-avatar-fallback">
                                      {initials(first, last)}
                                    </div>
                                  )}
                                </Link>

                                <Link
                                  to={profileWithName}
                                  state={{ preload: profile }}
                                  className="as2-name"
                                  title={`${first} ${last}`}
                                >
                                  {first} {last}
                                </Link>

                                {industry && <div className="as2-industry">{industry}</div>}
                                {loc && (
                                  <div className="as2-loc" title={loc}>
                                    <MapPin size={13} aria-hidden="true" />
                                    <span>{loc}</span>
                                  </div>
                                )}
                                {jobLine && (
                                  <div className="as2-job" title={jobLine}>
                                    {jobLine}
                                  </div>
                                )}

                                {!hasMeta && (
                                  <div className="as2-loc as2-empty-meta">No details available</div>
                                )}

                                <div className="as2-cta">
                                  <Link to={profilePath} className="as2-btn as2-btn-primary">
                                    View Profile
                                  </Link>
                                  <button
                                    type="button"
                                    className="as2-btn as2-btn-outline"
                                    onClick={() =>
                                      navigate(tenantRoute(slug, `/chat-rooms?to=${encodeURIComponent(id)}`))
                                    }
                                  >
                                    Message
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {state.total > form.limit && (
                          <div className="as2-pager">
                            <button
                              className="as2-btn as2-btn-outline"
                              disabled={page <= 1}
                              onClick={prevPage}
                              type="button"
                            >
                              Prev
                            </button>

                            <div className="as2-pagebtns">
                              {pageItems.map((item) =>
                                typeof item === "number" ? (
                                  <button
                                    key={item}
                                    type="button"
                                    className={`as2-btn as2-pagebtn${item === page ? " is-current" : ""}`}
                                    onClick={() => gotoPage(item)}
                                  >
                                    {item}
                                  </button>
                                ) : (
                                  <span key={item} className="as2-page-ellipsis" aria-hidden="true">
                                    ...
                                  </span>
                                )
                              )}
                            </div>

                            <button
                              className="as2-btn as2-btn-outline"
                              disabled={page >= pages}
                              onClick={nextPage}
                              type="button"
                            >
                              Next
                            </button>

                            <div className="as2-pagecount">
                              Showing {fromN}-{toN} of {state.total}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
