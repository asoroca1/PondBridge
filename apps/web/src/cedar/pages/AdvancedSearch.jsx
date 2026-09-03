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
import { INDUSTRIES } from "@pondbridge/shared";

import { requestJson } from "../../lib/http.js";
import { resolveAlumniWord, resolveCampAiName, resolveStaffRoleOptions } from "../../lib/campLabels.js";
import { tenantRoute } from "../../lib/tenantRouting.js";
import { avatarUrl } from "../lib/helpers.js";
import CedarBackground from "../components/CedarBackground";
import CedarPageHeader from "../components/CedarPageHeader.jsx";
import "./advanced-search.css";

// The search API returns exactly one job shape: `currentJobs`, an array of
// { role, company } from mapSearchSummary. The previous version also parsed
// "Role @ Company" strings and read `jobs` / `employment` / six field aliases -
// none of which this endpoint has ever sent.
function pickCurrentJob(profile = {}) {
  const jobs = Array.isArray(profile.currentJobs) ? profile.currentJobs : [];
  const job = jobs.find((entry) => entry?.isCurrent || entry?.current) ?? jobs[0] ?? null;
  return {
    role: String(job?.role || job?.title || "").trim(),
    company: String(job?.company || job?.organization || "").trim()
  };
}

const DEBOUNCE = 400;
// Locations are stored as "City, ST", so the state filter offers the codes that can
// actually match rather than accepting free text that never will.
const US_STATES = Object.freeze([
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["PR", "Puerto Rico"],
  ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"]
]);
// Older shared links may carry a full state name from when this was a free-text field.
// Map it onto the code the picker uses so the selection shows correctly.
function normalizeStateParam(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (US_STATES.some(([code]) => code === upper)) return upper;
  const match = US_STATES.find(([, name]) => name.toLowerCase() === raw.toLowerCase());
  return match ? match[0] : raw;
}

const AI_SEARCH_PROMPTS = Object.freeze([
  "Former counselors in Boston who work in healthcare",
  "People from camp who work in technology",
  "Members who attended the same college as me"
]);

// Only free-text fields need debouncing. Paging, sorting and the pickers are discrete
// intents and should fire immediately.
const TEXT_FIELDS = Object.freeze([
  "q", "industries", "city", "state", "college", "role", "company",
  "gradMin", "gradMax", "camperMin", "camperMax"
]);

function useDebouncedForm(form, delay = DEBOUNCE) {
  const textSignature = TEXT_FIELDS.map((key) => String(form[key] ?? "")).join("\u0000");
  const formRef = useRef(form);
  formRef.current = form;
  const [settledText, setSettledText] = useState(() =>
    Object.fromEntries(TEXT_FIELDS.map((key) => [key, form[key]]))
  );

  useEffect(() => {
    const t = setTimeout(() => {
      setSettledText(Object.fromEntries(TEXT_FIELDS.map((key) => [key, formRef.current[key]])));
    }, delay);
    return () => clearTimeout(t);
  }, [textSignature, delay]);

  const { cedarRoles, sort, offset, limit, browseAll } = form;

  // Discrete fields take effect immediately; text fields lag by `delay`.
  return useMemo(
    () => ({ ...formRef.current, ...settledText }),
    [cedarRoles, sort, offset, limit, browseAll, settledText]
  );
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

// Options may be plain strings or {value, count} from /search/facets. When counts are
// present each row shows how many members it would return, so a member can tell a
// too-narrow filter from an empty directory before running it.
export function RolesMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select roles...",
  label = "Former or current role at camp",
  optionsId = "camp-role-options"
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = parseList(value);
  const normalized = useMemo(
    () =>
      (Array.isArray(options) ? options : []).map((option) =>
        typeof option === "string" ? { value: option, count: null } : option
      ),
    [options]
  );

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
    <div className={`as2-mwrap${open ? " is-open" : ""}`} ref={ref}>
      <button
        type="button"
        className={`as2-mselect ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={optionsId}
        aria-label={label}
      >
        {selected.length ? (
          <div className="as2-tags">
            {selected.map((tag) => (
              <span key={tag} className="as2-tag">{tag}</span>
            ))}
          </div>
        ) : (
          <span className="as2-placeholder">{placeholder}</span>
        )}
        <ChevronDown size={14} className="as2-caret" aria-hidden="true" />
      </button>

      {open && (
        <div id={optionsId} className="as2-menu" role="group" aria-label={label}>
          {normalized.length === 0 && (
            <p className="as2-help" style={{ padding: "6px 10px", margin: 0 }}>
              No options yet.
            </p>
          )}
          {normalized.map(({ value: option, count }) => (
            <label key={option} className="as2-option">
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => toggle(option)}
              />
              <span>{option}</span>
              {Number.isFinite(count) && <span className="as2-option-count">{count}</span>}
            </label>
          ))}
          {selected.length > 0 && (
            <button type="button" className="as2-menu-clear" onClick={() => onChange("")}>
              Clear
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
  const aiName = resolveCampAiName(tenant);
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
    state: normalizeStateParam(params.get("state") || ""),
    college: params.get("college") || "",
    gradMin: params.get("gradMin") || "",
    gradMax: params.get("gradMax") || "",
    camperMin: params.get("camperMin") || "",
    camperMax: params.get("camperMax") || "",
    role: params.get("role") || "",
    company: params.get("company") || "",
    sort: params.get("sort") || "relevance",
    browseAll: params.get("browseAll") === "1" ? "1" : "",
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
    settled: false,
    items: [],
    total: 0,
    error: null,
  });
  const [facets, setFacets] = useState(null);
  const [savedSearches, setSavedSearches] = useState([]);
  const [copiedLink, setCopiedLink] = useState(false);
  const [nameSuggestions, setNameSuggestions] = useState([]);
  const [aiCapability, setAiCapability] = useState(null);
  const [aiQuery, setAiQuery] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiMeta, setAiMeta] = useState(null);

  // Set when smart search has already applied a plan and fetched its results, so the
  // debounced effect does not immediately refetch the same query and overwrite them.
  const skipNextFetchRef = useRef(false);
  const nameInputRef = useRef(null);
  const resultsRef = useRef(null);
  const authTokenRef = useRef(token || "");
  const getAuthTokenRef = useRef(getAuthToken);

  const debounced = useDebouncedForm(form);

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

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    if (!authReady || !slug) {
      setFacets(null);
      return () => {
        alive = false;
        controller.abort();
      };
    }
    requestJson(`/api/t/${slug}/search/facets`, {
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
        if (alive) setFacets(payload || null);
      })
      .catch((error) => {
        if (error?.name !== "AbortError" && alive) setFacets(null);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [authReady, slug]);

  // Name typeahead, from the same endpoint the navbar and people-picker already use.
  useEffect(() => {
    const term = String(debounced.q || "").trim();
    if (!authReady || !slug || term.length < 2) {
      setNameSuggestions([]);
      return undefined;
    }
    let alive = true;
    const controller = new AbortController();
    requestJson(`/api/t/${slug}/search/names?q=${encodeURIComponent(term)}&limit=8`, {
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
        if (!alive) return;
        const items = Array.isArray(payload?.items) ? payload.items : [];
        setNameSuggestions(items.map((item) => String(item?.name || "").trim()).filter(Boolean));
      })
      .catch(() => {
        if (alive) setNameSuggestions([]);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [authReady, slug, debounced.q]);

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

    if (String(debounced.browseAll || "") === "1") return true;

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

  // Every picker is driven by what this camp's directory actually contains, so an
  // option can never be offered that returns nobody. The configured lists are the
  // fallback for a camp whose facets have not loaded yet.
  const industryOptions = useMemo(() => {
    if (facets?.industries?.length) return facets.industries;
    return INDUSTRIES.map((value) => ({ value, count: null }));
  }, [facets]);

  // Every role the director has configured is always offered, even at a count of
  // zero: a role added today has to be selectable before anyone has filled it in,
  // and dropping it made a brand-new role look broken. Anything else the directory
  // turned up (a role since renamed or removed) follows.
  const campRoleOptions = useMemo(() => {
    const counts = new Map(
      (facets?.campRoles || []).map((entry) => [String(entry.value).toLowerCase(), entry.count])
    );
    const configured = staffRoleOptions.map((value) => ({
      value,
      count: facets ? counts.get(value.toLowerCase()) ?? 0 : null
    }));
    const known = new Set(staffRoleOptions.map((role) => role.toLowerCase()));
    const extra = (facets?.campRoles || []).filter(
      (entry) => !known.has(String(entry.value).toLowerCase())
    );
    return [...configured, ...extra];
  }, [facets, staffRoleOptions]);

  const stateOptions = useMemo(() => {
    const byCode = new Map(US_STATES);
    if (facets?.states?.length) {
      const present = facets.states
        .filter(({ value }) => byCode.has(value))
        .map(({ value, count }) => [value, byCode.get(value), count]);
      if (present.length) {
        return present.sort((left, right) => String(left[1]).localeCompare(String(right[1])));
      }
    }
    return US_STATES.map(([code, name]) => [code, name, null]);
  }, [facets]);

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
      display: Boolean(form.sort !== "relevance" || Number(form.limit) !== 24),
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
      // Auth is still resolving. Stay unsettled so a shared ?q= link renders skeletons
      // instead of the "No matches" empty state.
      setState((curr) => ({ ...curr, loading: false, settled: false }));
      return () => {
        alive = false;
        controller.abort();
      };
    }

    if (!hasActiveFilters) {
      setState({ loading: false, settled: true, items: [], total: 0, error: null });
      return () => {
        alive = false;
        controller.abort();
      };
    }

    if (skipNextFetchRef.current) {
      // Smart search already fetched exactly this query.
      skipNextFetchRef.current = false;
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
          settled: true,
          items: Array.isArray(data.items) ? data.items : [],
          total: Number.isFinite(data.total) ? data.total : data.items?.length || 0,
          excluded: data.excluded && typeof data.excluded === "object" ? data.excluded : {},
          error: null,
        });
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (!alive) return;
        setState({ loading: false, settled: true, items: [], total: 0, error: "Failed to load results." });
      }
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [authReady, debounced, hasActiveFilters, slug]);

  // Any user-initiated form change invalidates a pending smart-search skip, so the
  // flag can never swallow an unrelated fetch such as a page change.
  const updateForm = (updater) => {
    skipNextFetchRef.current = false;
    setForm(updater);
  };

  const onField = (key) => (event) => {
    const value = event?.target?.value ?? event;
    setAiMeta(null);
    updateForm((curr) => ({ ...curr, [key]: value, offset: 0 }));
  };

  const setFields = (updates = {}) => {
    setAiMeta(null);
    updateForm((curr) => ({ ...curr, ...updates, offset: 0 }));
  };

  const clearAll = () => {
    skipNextFetchRef.current = false;
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
      sort: "relevance",
      browseAll: "",
      offset: 0,
      limit: 24,
    });
    setState({ loading: false, settled: true, items: [], total: 0, error: null });
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
      skipNextFetchRef.current = true;
      setForm((current) => ({ ...current, ...planToFormFields(plan) }));
      setState({
        loading: false,
        settled: true,
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
      skipNextFetchRef.current = false;
      setAiError(error?.message || "Smart search could not interpret that request. Try the filters instead.");
    } finally {
      setAiSearching(false);
    }
  };

  const removeIndustry = (value) => {
    const next = industriesList.filter(
      (entry) => entry.toLowerCase() !== String(value).toLowerCase()
    );
    updateForm((curr) => ({ ...curr, industries: next.join(", "), offset: 0 }));
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
    updateForm((curr) => ({ ...curr, offset: (nextPage - 1) * curr.limit }));
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

  // A filter on an optional field silently drops everyone missing that field. Say so.
  const exclusionNotice = useMemo(() => {
    const excluded = state.excluded || {};
    const labels = {
      college: "no college on file",
      gradYear: "no graduation year on file",
      camperYears: "no camper years on file",
      industry: "no industry on file",
      location: "no location on file",
      campRole: "no camp role on file"
    };
    const parts = Object.entries(labels)
      .filter(([key]) => Number(excluded[key]) > 0)
      .map(([key, label]) => `${excluded[key]} with ${label}`);
    if (!parts.length) return "";
    const joined =
      parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return `Not included: ${joined}.`;
  }, [state.excluded]);

  // Saved searches live in this browser only. That keeps them free of a schema change,
  // at the cost of not following a member to another device - the copy-link button
  // covers that case.
  const savedSearchKey = `pb.savedSearches.${slug || "unknown"}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(savedSearchKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setSavedSearches(Array.isArray(parsed) ? parsed.slice(0, 12) : []);
    } catch {
      setSavedSearches([]);
    }
  }, [savedSearchKey]);

  const persistSavedSearches = (next) => {
    setSavedSearches(next);
    try {
      window.localStorage.setItem(savedSearchKey, JSON.stringify(next));
    } catch {
      // A browser with storage blocked still searches fine; it just cannot remember.
    }
  };

  const saveCurrentSearch = () => {
    const name = activeFilterChips.map((chip) => chip.label).join(" · ") || "All members";
    const query = new URLSearchParams();
    Object.entries(form).forEach(([key, value]) => {
      if (value !== "" && value !== null && value !== undefined) query.set(key, String(value));
    });
    const entry = { id: `${Date.now()}`, name: name.slice(0, 80), query: query.toString() };
    persistSavedSearches([entry, ...savedSearches.filter((s) => s.query !== entry.query)].slice(0, 12));
  };

  const applySavedSearch = (entry) => {
    const next = new URLSearchParams(entry?.query || "");
    skipNextFetchRef.current = false;
    setAiMeta(null);
    setForm((curr) => {
      const merged = { ...curr };
      Object.keys(curr).forEach((key) => {
        merged[key] = next.get(key) ?? "";
      });
      merged.offset = parseInt(next.get("offset") || "0", 10);
      merged.limit = parseInt(next.get("limit") || "24", 10);
      merged.sort = next.get("sort") || "relevance";
      return merged;
    });
  };

  const removeSavedSearch = (id) => {
    persistSavedSearches(savedSearches.filter((entry) => entry.id !== id));
  };

  const copySearchLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      setCopiedLink(false);
    }
  };

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
                    list="advanced-search-name-options"
                    autoComplete="off"
                  />
                  <datalist id="advanced-search-name-options">
                    {nameSuggestions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
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
                    options={campRoleOptions}
                    value={form.cedarRoles}
                    onChange={(v) => updateForm((curr) => ({ ...curr, cedarRoles: v, offset: 0 }))}
                    placeholder="Select roles..."
                    label="Former or current role at camp"
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
                  <RolesMultiSelect
                    options={industryOptions}
                    value={form.industries}
                    onChange={(v) => updateForm((curr) => ({ ...curr, industries: v, offset: 0 }))}
                    placeholder="Select industries..."
                    label="Industries"
                    optionsId="industry-options"
                  />
                  <p className="as2-help">
                    Picking more than one matches any of them.
                    {facets?.missing?.industry
                      ? ` ${facets.missing.industry} members have no industry on file.`
                      : ""}
                  </p>

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
                    list="advanced-search-company-options"
                    autoComplete="off"
                  />
                  <datalist id="advanced-search-company-options">
                    {(facets?.companies || []).slice(0, 200).map(({ value }) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>
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
                    list="advanced-search-college-options"
                    autoComplete="off"
                  />
                  <datalist id="advanced-search-college-options">
                    {(facets?.colleges || []).slice(0, 200).map(({ value }) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>

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
                    <select
                      className="as2-input"
                      value={form.state}
                      onChange={onField("state")}
                      aria-label="State"
                    >
                      <option value="">Any state</option>
                      {stateOptions.map(([code, name, count]) => (
                        <option key={code} value={code}>
                          {Number.isFinite(count) ? `${name} (${count})` : name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </section>

            <section className="as2-sec open as2-sec-display">
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
                        <option value="relevance">Best match</option>
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
                          updateForm((curr) => ({
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
                    <div className="as2-ai-eyebrow">{aiName} search</div>
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
                  <div className="as2-sub" role="status" aria-live="polite">
                    {!state.loading && state.settled
                      ? `Showing ${fromN}-${toN} of ${state.total}`
                      : "Searching\u2026"}
                  </div>
                </div>

                <div className="as2-results-actions">
                  <button type="button" className="as2-btn as2-btn-ghost" onClick={copySearchLink}>
                    {copiedLink ? "Link copied" : "Copy link"}
                  </button>
                  <button type="button" className="as2-btn as2-btn-ghost" onClick={saveCurrentSearch}>
                    Save search
                  </button>
                </div>
              </div>
            )}

            {!!savedSearches.length && (
              <div className="as2-saved" aria-label="Saved searches">
                <span className="as2-saved-label">Saved</span>
                {savedSearches.map((entry) => (
                  <span key={entry.id} className="as2-saved-chip">
                    <button type="button" onClick={() => applySavedSearch(entry)}>
                      {entry.name}
                    </button>
                    <button
                      type="button"
                      className="x"
                      onClick={() => removeSavedSearch(entry.id)}
                      aria-label={`Delete saved search ${entry.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {exclusionNotice && (
              <p className="as2-exclusion" role="status">
                {exclusionNotice}
              </p>
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
                    <button
                      className="as2-btn as2-btn-outline"
                      type="button"
                      onClick={() =>
                        updateForm((curr) => ({
                          ...curr,
                          browseAll: "1",
                          sort: "recent",
                          offset: 0
                        }))
                      }
                    >
                      {`Browse all ${alumniWord}`}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {(state.loading || !state.settled) && !state.items.length && (
                  <div className="as2-grid" aria-busy="true">
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

                {!state.loading && state.settled && state.error && (
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

                {state.settled && !state.error && (
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
                        <div
                          className={`as2-grid${state.loading ? " is-refreshing" : ""}`}
                          aria-busy={state.loading ? "true" : "false"}
                        >
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

                                {Array.isArray(profile.matchReasons) && profile.matchReasons.length > 0 && (
                                  <div className="as2-why">
                                    {profile.matchReasons.map((reason) => (
                                      <span key={`${reason.kind}-${reason.label}`} className="as2-why-chip">
                                        {reason.label}
                                      </span>
                                    ))}
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
                                    aria-current={item === page ? "page" : undefined}
                                    aria-label={`Page ${item}`}
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
