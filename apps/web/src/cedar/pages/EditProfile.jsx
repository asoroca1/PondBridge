// src/pages/EditProfile.jsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useTenant } from "../../context/TenantContext.jsx";
import {
  resolveAgeGroupOptions,
  resolveStaffRoleOptions
} from "../../lib/campLabels.js";
import AvatarCropper from "../components/AvatarCropper";
import CedarBackground from "../components/CedarBackground";
import { API_BASE, getMe } from "../lib/api";
import { getToken } from "../lib/helpers";
import { useNavigate } from "react-router-dom";

/* Data */
const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
];
const US_STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming"
};
const US_STATE_OPTIONS = US_STATES.map((code) => ({
  code,
  label: `${US_STATE_NAMES[code] || code} (${code})`
}));

const INDUSTRIES = [
  "Accounting", "Advertising", "Aerospace", "Agriculture",
  "Architecture", "Arts", "Automotive", "Banking",
  "Biotechnology", "Consulting", "Consumer Goods", "Education",
  "Energy", "Engineering", "Entertainment", "Fashion", "Finance", "Food", "Government",
  "Healthcare", "Hospitality", "Insurance", "Journalism", "Legal", "Logistics",
  "Manufacturing", "Marketing", "Media", "Non-Profit", "Pharmaceuticals",
  "Private Equity", "Real Estate", "Retail", "Sports", "Student", "Technology",
  "Telecommunications", "Transportation", "Venture Capital", "Other"
];

function normalizeErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.errors?.[0]?.msg === "string") return payload.errors[0].msg;
  return fallback;
}

// --- Location Modes (match CreateProfileWizard) ---
const LOCATION_MODES = {
  US: "US",
  INTL: "INTL",
};

const COUNTRY_ALIASES = new Map([
  ["usa", "United States"],
  ["u s a", "United States"],
  ["us", "United States"],
  ["u s", "United States"],
  ["united states of america", "United States"],
  ["uk", "United Kingdom"],
  ["u k", "United Kingdom"],
  ["great britain", "United Kingdom"],
  ["uae", "United Arab Emirates"],
  ["u a e", "United Arab Emirates"]
]);

const CITY_ALIASES_GLOBAL = new Map([
  ["nyc", "New York"],
  ["new york city", "New York"],
  ["san fran", "San Francisco"],
  ["sf", "San Francisco"],
  ["philly", "Philadelphia"],
  ["vegas", "Las Vegas"],
  ["nola", "New Orleans"]
]);

const CITY_ALIASES_BY_STATE = new Map([
  ["CA|la", "Los Angeles"],
  ["CA|l a", "Los Angeles"],
  ["CA|l.a.", "Los Angeles"],
  ["DC|washington dc", "Washington"],
  ["DC|washington d c", "Washington"],
  ["DC|d c", "Washington"],
  ["DC|d.c.", "Washington"]
]);

// --- Countries (copied from CreateProfileWizard; display without trailing *) ---
const cleanCountryName = (s = "") => String(s || "").trim().replace(/\*+$/g, "").trim();

const RAW_COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Austrian Empire*","Azerbaijan",
  "Baden*","Bahamas, The","Bahrain","Bangladesh","Barbados","Bavaria*","Belarus","Belgium","Belize","Benin (Dahomey)","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Brunswick and Lüneburg*","Bulgaria","Burkina Faso (Upper Volta)","Burma","Burundi",
  "Cabo Verde","Cambodia","Cameroon","Canada","Cayman Islands, The","Central African Republic","Central American Federation*","Chad","Chile","China","Colombia","Comoros","Congo Free State, The*","Cook Islands","Costa Rica","Cote d’Ivoire (Ivory Coast)","Croatia","Cuba","Cyprus","Czechia","Czechoslovakia*",
  "Democratic Republic of the Congo","Denmark","Djibouti","Dominica","Dominican Republic","Duchy of Parma, The*",
  "East Germany (German Democratic Republic)*","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia",
  "Federal Government of Germany (1848-49)*","Fiji","Finland","France",
  "Gabon","Gambia, The","Georgia","Germany","Ghana","Grand Duchy of Tuscany, The*","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana",
  "Haiti","Hanover*","Hanseatic Republics*","Hawaii*","Hesse*","Holy See","Honduras","Hungary",
  "Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy",
  "Jamaica","Japan","Jordan",
  "Kazakhstan","Kenya","Kingdom of Serbia/Yugoslavia*","Kiribati","Korea","Kosovo","Kuwait","Kyrgyzstan",
  "Laos","Latvia","Lebanon","Lesotho","Lew Chew (Loochoo)*","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg",
  "Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mecklenburg-Schwerin*","Mecklenburg-Strelitz*","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique",
  "Namibia","Nassau*","Nauru","Nepal","Netherlands, The","New Zealand","Nicaragua","Niger","Nigeria","Niue","North German Confederation*","North German Union*","North German Union*","North German Union*","North Macedonia","Norway",
  "Oldenburg*","Oman","Orange Free State*",
  "Pakistan","Palau","Panama","Papal States*","Papua New Guinea","Paraguay","Peru","Philippines","Piedmont-Sardinia*","Poland","Portugal",
  "Qatar",
  "Republic of Genoa*","Republic of Korea (South Korea)","Republic of the Congo","Romania","Russia","Rwanda",
  "Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Sao Tome and Principe","Saudi Arabia","Schaumburg-Lippe*","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands, The","Somalia","South Africa","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria",
  "Tajikistan","Tanzania","Texas*","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Two Sicilies*",
  "Uganda","Ukraine","Union of Soviet Socialist Republics*","United Arab Emirates, The","United Kingdom, The","Uruguay","Uzbekistan",
  "Vanuatu","Venezuela","Vietnam",
  "Württemberg*",
  "Yemen",
  "Zambia","Zimbabwe"
];

const COUNTRIES = Array.from(new Set(RAW_COUNTRIES.map(cleanCountryName)))
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b));

/* ================= Social normalizers ================= */
const isUrl = (s="") => /^https?:\/\//i.test(s) || /^www\./i.test(s);
const withScheme = (s="") => /^https?:\/\//i.test(s) ? s : `https://${s}`;
const stripAtAndSlashes = (s="") => s.trim().replace(/^@/, "").replace(/^\/+|\/+$/g, "");

const toInstagramUrl = (input="") => {
  const v = input.trim();
  if (!v) return "";
  if (isUrl(v)) {
    try {
      const u = new URL(withScheme(v));
      const user = stripAtAndSlashes(u.pathname.split("/")[1] || "");
      return user ? `https://www.instagram.com/${user}/` : "";
    } catch { return ""; }
  }
  const handle = stripAtAndSlashes(v);
  return handle ? `https://www.instagram.com/${handle}/` : "";
};

const toFacebookUrl = (input="") => {
  const v = input.trim();
  if (!v) return "";
  if (isUrl(v)) {
    try {
      const u = new URL(withScheme(v));
      if (u.pathname.startsWith("/profile.php")) {
        const qs = u.search ? u.search : "";
        return `https://www.facebook.com/profile.php${qs}`;
      }
      const user = stripAtAndSlashes(u.pathname.split("/")[1] || "");
      return user ? `https://www.facebook.com/${user}` : "";
    } catch { return ""; }
  }
  const handle = stripAtAndSlashes(v);
  return handle ? `https://www.facebook.com/${handle}` : "";
};

const normalizeUrl = (s) => {
  const v = (s || "").trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
};
const ensureUrl = (s) => normalizeUrl(s);

/* ================= City/State/Country helpers ================= */
const normalizeLocationToken = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toTitleCase = (value = "") => {
  const smallWords = new Set(["and", "or", "the", "of", "de", "da", "la", "le"]);
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      return lower.slice(0, 1).toUpperCase() + lower.slice(1);
    })
    .join(" ");
};

const normalizeCity = (s = "") => (s || "").replace(/\s+/g, " ").trim();

const canonicalizeCountry = (value = "") => {
  const raw = normalizeCity(value);
  if (!raw) return "";
  const token = normalizeLocationToken(raw);
  const aliased = COUNTRY_ALIASES.get(token) || raw;
  const matchedCountry = COUNTRIES.find((country) => normalizeLocationToken(country) === normalizeLocationToken(aliased));
  if (matchedCountry) return matchedCountry;
  return toTitleCase(aliased);
};

const normalizeCountry = (s = "") => canonicalizeCountry(s);

const canonicalizeCity = (value = "", { state = "", country = "", options = [] } = {}) => {
  const raw = normalizeCity(value);
  if (!raw) return "";
  const stateCode = String(state || "").trim().toUpperCase();
  const countryName = canonicalizeCountry(country);
  const token = normalizeLocationToken(raw);

  const matchedOption = (Array.isArray(options) ? options : []).find(
    (option) => normalizeLocationToken(option) === token
  );
  if (matchedOption) return matchedOption;

  const stateAliasKey = `${stateCode}|${token}`;
  if (CITY_ALIASES_BY_STATE.has(stateAliasKey)) return CITY_ALIASES_BY_STATE.get(stateAliasKey) || "";
  if (CITY_ALIASES_GLOBAL.has(token)) return CITY_ALIASES_GLOBAL.get(token) || "";

  if (
    countryName === "United States" &&
    stateCode === "DC" &&
    (token === "washington dc" || token === "washington d c" || token === "d c")
  ) {
    return "Washington";
  }

  return toTitleCase(raw);
};

const mergeCityOptions = (...sources) => {
  const seen = new Set();
  const merged = [];
  for (const source of sources) {
    for (const city of Array.isArray(source) ? source : []) {
      const normalized = normalizeCity(city);
      const key = normalizeLocationToken(normalized);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(normalized);
    }
  }
  return merged.sort((a, b) => a.localeCompare(b));
};

// Supports "City, ST" OR "City, Country" OR "City, Region, Country"
const splitCityState = (cityState = "") => {
  const parts = String(cityState || "").split(",").map(s => s.trim()).filter(Boolean);
  const city = parts[0] || "";

  if (parts.length < 2) return { city, state: "", country: "" };

  const second = parts[1] || "";
  const secondUpper = second.toUpperCase();

  if (US_STATES.includes(secondUpper)) {
    const state = secondUpper;
    const country = parts.length >= 3 ? parts[parts.length - 1] : "";
    return { city, state, country: normalizeCountry(country) };
  }

  const country = parts[parts.length - 1] || second;
  return { city, state: "", country: normalizeCountry(country) };
};

/* ================= Year parsing + job sort ================= */
function parseYears(years = "") {
  const s = (years || "").trim();
  const parts = s.replace(/—/g, "–").replace(/-/g, "–").split("–").map(p => p.trim());
  const toNum = (str) => {
    const m = str && str.match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0], 10) : undefined;
  };

  if (parts.length === 1) {
    const y = toNum(parts[0]);
    return { start: y, end: y, isPresent: false };
  }

  const start = toNum(parts[0]);
  const endRaw = parts[1];
  const isPresent = /present/i.test(endRaw || "");
  const end = isPresent ? Infinity : toNum(endRaw);

  return { start, end, isPresent };
}

function sortJobsByRecency(list = []) {
  const score = (j) => {
    const { start, end } = parseYears(j.years || "");
    const e = (typeof end === "number" ? end : end === Infinity ? Number.MAX_SAFE_INTEGER : -1);
    const s = (typeof start === "number" ? start : -1);
    return { e, s };
  };
  return [...list].sort((a, b) => {
    const A = score(a), B = score(b);
    if (B.e !== A.e) return B.e - A.e;
    return B.s - A.s;
  });
}

/* Small multi-select dropdown */
function MultiSelect({ label, placeholder, options, value, onChange, id }) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!open || !ref.current) return;
    const trigger = ref.current.querySelector(".wizard1-mselect");
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setDropUp(spaceBelow < 260);
  }, [open]);

  const toggle = (opt) =>
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]);

  return (
    <div className="wizard1-field" ref={ref} style={{ width: "100%" }}>
      <label className="wizard1-label" htmlFor={id}>{label}</label>

      <div
        id={id}
        className={`wizard1-mselect ${open ? "is-open" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e)=> (e.key==="Enter"||e.key===" ") && setOpen(o=>!o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{ width: "100%" }}
      >
        {value.length ? (
          <div className="wizard1-tags">
            {value.map(tag => (
              <span
                key={tag}
                className="wizard1-tag"
                onClick={(e)=>{e.stopPropagation(); toggle(tag);}}
              >
                {tag} <span className="wizard1-tag-x">×</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="wizard1-placeholder">{placeholder}</span>
        )}
        <span className="wizard1-caret">▾</span>
      </div>

      {open && (
        <div
          className={`wizard1-menu ${dropUp ? "drop-up" : ""}`}
          role="listbox"
          style={{ width: "100%" }}
        >
          {options.map(opt => (
            <label key={opt} className="wizard1-option">
              <input type="checkbox" checked={value.includes(opt)} onChange={()=>toggle(opt)} />
              <span>{opt}</span>
            </label>
          ))}
          {value.length > 0 && (
            <button type="button" className="wizard1-btn-text wizard1-menu-clear" onClick={()=>onChange([])}>
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* Stepper */
function Stepper({ activeStep = 0 }) {
  const steps = ["Personal","Education","Experience","Social Media"];
  return (
    <div className="wizard1-stepper">
      <div className="wizard1-stepper-track" />
      <div className="wizard1-steps">
        {steps.map((t,i)=>(
          <div
            key={t}
            className={`wizard1-step ${
              i < activeStep ? "wizard1-done"
              : i === activeStep ? "wizard1-active"
              : "wizard1-todo"
            }`}
          >
            <div className="wizard1-dot" />
            <div className="wizard1-step-title">Step {i+1}</div>
            <div className="wizard1-step-sub">{t}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatPhoneNumber(value) {
  if (!value) return value;
  const phoneNumber = String(value).replace(/\D/g, '');
  if (phoneNumber.length < 10) return value;
  const areaCode = phoneNumber.slice(0, 3);
  const centralOffice = phoneNumber.slice(3, 6);
  const lineNumber = phoneNumber.slice(6, 10);
  return `(${areaCode}) ${centralOffice}-${lineNumber}`;
}
const digitsOnly = (s = "") => String(s).replace(/\D/g, "").slice(0, 10);

export default function EditProfile() {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const staffRoleOptions = useMemo(() => resolveStaffRoleOptions(tenant), [tenant]);
  const ageGroupOptions = useMemo(() => resolveAgeGroupOptions(tenant), [tenant]);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const [errors, setErrors] = useState({});

  const [cityOptions, setCityOptions] = useState([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const staticUsCitiesCache = useRef(new Map());
  const [citySearchTerm, setCitySearchTerm] = useState("");

  const [form, setForm] = useState({
    uploads: { photo: null, photoUrl: "", pdfs: [] },

    firstName: "", lastName: "", nickname: "",
    email: "", // read-only in UI
    phone: "",

    // ✅ Location (match CreateProfileWizard)
    locationMode: LOCATION_MODES.US,
    city: "",
    state: "",
    country: "",

    roles: [],

    camperYears: { firstYear: "", firstGroup: "", lastYear: "", lastGroup: "" },

    highSchool: "",
    education: [{ college: "", year: "", major: "" }],

    industry: "",
    currentJobs: [{ role: "", company: "", years: "" }],
    pastJobs: [{ role: "", company: "", years: "" }],

    social: { linkedin: "", instagram: "", facebook: "" },
  });

  const setField = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setSocial = (patch) => setForm((f) => ({ ...f, social: { ...f.social, ...patch } }));
  const setCamperYears = (patch) =>
    setForm((f) => ({ ...f, camperYears: { ...(f.camperYears || {}), ...patch } }));

  /**
   * ✅ FIX: immediately persist photoUrl to backend (and localStorage) the moment upload finishes.
   * This mirrors “signup feels saved” behavior and prevents losing photo if user exits before final Save,
   * and also handles backends that accept top-level photoUrl instead of nested uploads.photoUrl.
   */
  const savePhotoUrlNow = useCallback(async (photoUrl) => {
    const token = getToken();
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/me`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          // send BOTH for backward compatibility
          uploads: { photoUrl: photoUrl || "" },
          photoUrl: photoUrl || "",
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        console.warn("Photo autosave failed:", res.status, text);
        return;
      }

      const data = JSON.parse(text);
      const updatedUser = data.user || data.profile || data;

      // Keep UI + navbar consistent immediately
      const serialized = JSON.stringify(updatedUser);
      localStorage.setItem("user", serialized);
      localStorage.setItem("pondbridgeUser", serialized);
      window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
      window.dispatchEvent(new Event("cedar:userChanged"));
    } catch (e) {
      console.warn("Photo autosave network error:", e);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCitySearchTerm(normalizeCity(form.city));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [form.city]);

  // --- Load city options for US state or international country ---
  useEffect(() => {
    const mode = form.locationMode || LOCATION_MODES.US;
    const state = String(form.state || "").trim().toUpperCase();
    const country = canonicalizeCountry(form.country);

    if (mode === LOCATION_MODES.US && !state) {
      setCityOptions([]);
      setCitiesLoading(false);
      return;
    }
    if (mode === LOCATION_MODES.INTL && !country) {
      setCityOptions([]);
      setCitiesLoading(false);
      return;
    }

    let alive = true;
    setCitiesLoading(true);

    const q = citySearchTerm;
    const params = new URLSearchParams();
    params.set("limit", "150");
    if (q.length >= 2) params.set("q", q);
    if (mode === LOCATION_MODES.US) {
      params.set("state", state);
    } else {
      params.set("country", country);
    }

    const remotePromise = fetch(`${API_BASE}/locations/cities?${params.toString()}`)
      .then((response) => (response.ok ? response.json() : []))
      .catch(() => []);

    const staticPromise =
      mode === LOCATION_MODES.US
        ? (async () => {
            if (staticUsCitiesCache.current.has(state)) {
              return staticUsCitiesCache.current.get(state) || [];
            }
            const response = await fetch(`/cities/${state}.json`);
            const items = response.ok ? await response.json() : [];
            const normalized = Array.isArray(items) ? items : [];
            staticUsCitiesCache.current.set(state, normalized);
            return normalized;
          })().catch(() => [])
        : Promise.resolve([]);

    Promise.all([staticPromise, remotePromise])
      .then(([baseCities, remoteCities]) => {
        if (!alive) return;
        const merged = mergeCityOptions(baseCities, remoteCities);
        const typed = canonicalizeCity(citySearchTerm, {
          state,
          country,
          options: merged
        });
        const next = typed ? mergeCityOptions([typed], merged) : merged;
        setCityOptions(next);
      })
      .finally(() => {
        if (!alive) return;
        setCitiesLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [form.locationMode, form.state, form.country, citySearchTerm]);

  // load current profile
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const token = getToken();
        let fresh = null;

        if (token) {
          try {
            const data = await getMe(token);
            fresh = data?.user || data?.profile || data;
          } catch {}
        }
        if (!fresh) {
          try { fresh = JSON.parse(localStorage.getItem("user") || "null"); } catch {}
        }

        if (!fresh || cancelled) return;

        // Determine location mode based on stored fields (or legacy cityState string if present)
        let locMode = fresh.locationMode;
        let city = fresh.city || "";
        let state = fresh.state || "";
        let country = fresh.country || "";

        // Legacy fallback if some old "cityState" exists (safe noop if missing)
        if ((!city && !state && !country) && fresh.cityState) {
          const split = splitCityState(fresh.cityState);
          city = split.city || "";
          state = split.state || "";
          country = split.country || "";
        }

        // If backend doesn't store locationMode yet, infer it
        if (locMode !== LOCATION_MODES.US && locMode !== LOCATION_MODES.INTL) {
          locMode = state ? LOCATION_MODES.US : (country ? LOCATION_MODES.INTL : LOCATION_MODES.US);
        }

        const normalized = {
          uploads: { photo: null, pdfs: [], photoUrl: fresh?.uploads?.photoUrl || fresh?.photoUrl || "" },

          firstName: fresh.firstName || "",
          lastName: fresh.lastName || "",
          nickname: String(
            fresh.nickname || fresh.social?.nickname || fresh.socials?.nickname || fresh.socials?.campNickname || ""
          ).trim(),
          email: fresh.email || "",
          phone: fresh.phone || "",

          locationMode: locMode,
          city: canonicalizeCity(city, { state, country }) || "",
          state: (state || "").trim().toUpperCase(),
          country: canonicalizeCountry(country) || "",

          roles: Array.isArray(fresh.roles) ? fresh.roles : (fresh.roles ? [fresh.roles] : []),

          camperYears: fresh.camperYears || { firstYear: "", firstGroup: "", lastYear: "", lastGroup: "" },

          highSchool: fresh.highSchool || "",
          education:
            Array.isArray(fresh.education) && fresh.education.length
              ? fresh.education
              : [{ college: "", year: "", major: "" }],

          industry: fresh.industry || "",
          currentJobs:
            Array.isArray(fresh.currentJobs) && fresh.currentJobs.length
              ? fresh.currentJobs
              : [{ role: "", company: "", years: "" }],
          pastJobs:
            Array.isArray(fresh.pastJobs) && fresh.pastJobs.length
              ? sortJobsByRecency(fresh.pastJobs)
              : [{ role: "", company: "", years: "" }],

          social: fresh.social || { linkedin: "", instagram: "", facebook: "" },
        };

        setForm(normalized);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // photo upload (same presign route)
  const presignAndUploadProfile = useCallback(async (blob) => {
    const fileName = `avatar-${Date.now()}.png`;
    const fileType = "image/png";

    const token = getToken();

    const r = await fetch(`${API_BASE}/uploads/presign-public`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // harmless if endpoint ignores auth; helpful if you later lock it down
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ fileName, fileType, fileSize: Number(blob?.size || 0) }),
    });
    if (!r.ok) throw new Error("Presign failed");
    const { uploadUrl, objectUrl, headers } = await r.json();
    const up = await fetch(uploadUrl, {
      method: "PUT",
      ...(headers && typeof headers === "object" ? { headers } : {}),
      body: blob
    });
    if (!up.ok) throw new Error("Upload failed");

    // Update UI immediately
    setForm((p) => ({ ...p, uploads: { ...(p.uploads || {}), photoUrl: objectUrl, photo: null } }));

    // ✅ FIX: autosave photoUrl immediately so it behaves like signup + survives navigation
    savePhotoUrlNow(objectUrl);

    return objectUrl;
  }, [savePhotoUrlNow]);

  const validateStep1 = () => {
    const e = {};
    if (!form.firstName.trim()) e.firstName = "First name is required.";
    if (!form.lastName.trim())  e.lastName  = "Last name is required.";

    // ✅ Location validation (match CreateProfileWizard)
    if (!normalizeCity(form.city)) e.city = "City is required.";
    if ((form.locationMode || LOCATION_MODES.US) === LOCATION_MODES.US) {
      if (!form.state) e.state = "Select a state.";
    } else {
      if (!normalizeCountry(form.country)) e.country = "Select a country.";
    }

    // camper years (optional)
    const cy = form.camperYears || {};
    const yearOk = (y) => !y || /^\d{4}$/.test(String(y).trim());

    if (!yearOk(cy.firstYear)) e.camper_firstYear = "Use a 4-digit year (e.g., 2016).";
    if (!yearOk(cy.lastYear))  e.camper_lastYear  = "Use a 4-digit year (e.g., 2022).";

    if ((cy.firstYear && !cy.firstGroup) || (!cy.firstYear && cy.firstGroup)) {
      e.camper_firstPair = "Please include both First Year and Age Group (or leave both blank).";
    }
    if ((cy.lastYear && !cy.lastGroup) || (!cy.lastYear && cy.lastGroup)) {
      e.camper_lastPair = "Please include both Last Year and Age Group (or leave both blank).";
    }

    const fy = cy.firstYear ? parseInt(cy.firstYear, 10) : null;
    const ly = cy.lastYear ? parseInt(cy.lastYear, 10) : null;
    if (fy && ly && fy > ly) e.camper_order = "First Year can’t be after Last Year.";

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e = {};
    form.education.forEach((row, idx) => {
      if ((row.year || "").trim() && !/^\d{4}$/.test(row.year.trim())) {
        e[`edu_year_${idx}`] = "Use a 4-digit year (e.g., 2024).";
      }
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep3 = () => {
    const e = {};
    if (!form.industry) e.industry = "Please select an industry.";

    const checkList = (list, prefix) => {
      form[list].forEach((j, i) => {
        const any = (j.role || "").trim() || (j.company || "").trim() || (j.years || "").trim();
        if (!any) return;
        const bothCore = (j.role || "").trim() && (j.company || "").trim();
        if (!bothCore) e[`${prefix}_${i}`] = "Please include role and company.";
        if (j.years && !/^[\w\s–-]{2,30}$/.test(j.years)) e[`${prefix}_years_${i}`] = "Use a short label (e.g., 2022–Present).";
      });
    };

    checkList("currentJobs", "cur");
    checkList("pastJobs", "past");

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep4 = () => {
    const e = {};
    const S = form.social || {};

    if (S.linkedin) {
      try { new URL(ensureUrl(S.linkedin)); }
      catch { e.social_linkedin = "Enter a valid LinkedIn URL (include http/https)."; }
    }
    if (S.instagram) {
      const ig = toInstagramUrl(S.instagram);
      try { new URL(ig); } catch { e.social_instagram = "Enter a valid Instagram username or URL."; }
    }
    if (S.facebook) {
      const fb = toFacebookUrl(S.facebook);
      try { new URL(fb); } catch { e.social_facebook = "Enter a valid Facebook username or URL."; }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const updateEdu = (idx, patch) =>
    setForm(f => ({
      ...f,
      education: f.education.map((row, i) => i === idx ? { ...row, ...patch } : row)
    }));
  const addEdu = () => setForm(f => ({ ...f, education: [...f.education, { college: "", year: "", major: "" }] }));
  const removeEdu = (idx) =>
    setForm(f => ({ ...f, education: f.education.filter((_, i) => i !== idx) }));

  const updateJob = (list, idx, patch) =>
    setForm(f => {
      const updated = f[list].map((row, i) => i === idx ? { ...row, ...patch } : row);
      return { ...f, [list]: list === "pastJobs" ? sortJobsByRecency(updated) : updated };
    });

  const addJob = (list) =>
    setForm(f => {
      const next = [...f[list], { role: "", company: "", years: "" }];
      return { ...f, [list]: list === "pastJobs" ? sortJobsByRecency(next) : next };
    });

  const removeJob = (list, idx) =>
    setForm(f => {
      const next = f[list].filter((_, i) => i !== idx);
      return { ...f, [list]: list === "pastJobs" ? sortJobsByRecency(next) : next };
    });

  const moveJob = (from, to, idx) =>
    setForm(f => {
      const item = f[from][idx];
      const fromNext = f[from].filter((_, i) => i !== idx);
      const toNext = [...f[to], item];
      return { ...f, [from]: fromNext, [to]: to === "pastJobs" ? sortJobsByRecency(toNext) : toNext };
    });

  const onNext = async () => {
    if (step === 0) { if (!validateStep1()) return; return setStep(1); }
    if (step === 1) { if (!validateStep2()) return; return setStep(2); }
    if (step === 2) { if (!validateStep3()) return; return setStep(3); }

    if (step === 3) {
      if (!validateStep4()) return;
      await persistProfile({ exitAfterSave: true });
    }
  };

  const onBack = () => setStep((s) => Math.max(0, s - 1));

  async function persistProfile({ exitAfterSave = false } = {}) {
    try {
      setSubmitting(true);
      const token = getToken();
      const payload = buildUpdatePayload(form);

      const res = await fetch(`${API_BASE}/me`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      if (!res.ok) {
        let msg = `Update failed (${res.status}).`;
        try {
          const j = JSON.parse(text);
          msg = normalizeErrorMessage(j, msg);
        } catch {}
        console.error("Update failed:", res.status, text);
        alert(msg);
        return false;
      }

      const data = JSON.parse(text);
      const updatedUser = data.user || data.profile || data;

      const serialized = JSON.stringify(updatedUser);
      localStorage.setItem("user", serialized);
      localStorage.setItem("pondbridgeUser", serialized);
      window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
      window.dispatchEvent(new Event("cedar:userChanged"));

      if (exitAfterSave) {
        navigate("/my-profile");
      }
      return true;
    } catch (err) {
      console.error(err);
      alert("Network error. Please try again.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  const onSaveAndExit = async () => {
    await persistProfile({ exitAfterSave: true });
  };

  function buildUpdatePayload(form) {
    const pastJobsSorted = sortJobsByRecency(form.pastJobs || []);
    const mode = form.locationMode || LOCATION_MODES.US;

    const photoUrl = form.uploads?.photoUrl || "";

    return {
      firstName: form.firstName,
      lastName: form.lastName,
      nickname: form.nickname,
      phone: form.phone,

      // ✅ Location payload (US: city+state, Intl: city+country)
      locationMode: mode,
      city: canonicalizeCity(form.city, {
        state: mode === LOCATION_MODES.US ? (form.state || "").trim().toUpperCase() : "",
        country: mode === LOCATION_MODES.INTL ? canonicalizeCountry(form.country) : "",
        options: cityOptions
      }),
      state: mode === LOCATION_MODES.US ? (form.state || "").trim().toUpperCase() : "",
      country: mode === LOCATION_MODES.INTL ? canonicalizeCountry(form.country) : "",

      roles: form.roles,

      // ✅ FIX: send both nested + legacy top-level photoUrl (covers backend differences)
      uploads: { photoUrl },
      photoUrl,

      camperYears: {
        firstYear: (form.camperYears?.firstYear || "").trim(),
        firstGroup: (form.camperYears?.firstGroup || "").trim(),
        lastYear: (form.camperYears?.lastYear || "").trim(),
        lastGroup: (form.camperYears?.lastGroup || "").trim(),
      },

      highSchool: form.highSchool,
      education: (form.education || [])
        .filter((e) => (e.college || e.major || e.year || "").toString().trim())
        .map((e) => ({
          college: (e.college || "").trim(),
          major: (e.major || "").trim(),
          year: (e.year || "").trim(),
        })),

      industry: form.industry || "",
      currentJobs: (form.currentJobs || []).map((j) => ({ role: j.role || "", company: j.company || "", years: j.years || "" })),
      pastJobs: (pastJobsSorted || []).map((j) => ({ role: j.role || "", company: j.company || "", years: j.years || "" })),

      social: {
        linkedin: normalizeUrl(form.social?.linkedin),
        instagram: normalizeUrl(form.social?.instagram),
        facebook: normalizeUrl(form.social?.facebook),
      },
    };
  }

  const Step1 = (
    <section className="wizard1-card">
      <div className="wizard1-grid wizard1-gap">
        <div className="wizard1-span-4">
          <h2 className="wizard1-h2">Profile Photo</h2>
          <div className="wizard1-dottedbox">
            {form.uploads.photoUrl ? (
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: "50%",
                    backgroundImage: `url(${form.uploads.photoUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    border: "2px solid #e2e8f0",
                  }}
                  aria-label="Saved avatar preview"
                />
                <button
                  type="button"
                  className="wizard1-btn-text"
                  onClick={() => {
                    // Clear in UI
                    setForm((p) => ({ ...p, uploads: { ...p.uploads, photoUrl: "", photo: null } }));
                    // ✅ FIX: also clear on server immediately (optional but keeps parity)
                    savePhotoUrlNow("");
                  }}
                >
                  Replace photo
                </button>
              </div>
            ) : (
              <AvatarCropper
                imageFile={form.uploads.photo || null}
                onPickFile={(f) => setForm((p) => ({ ...p, uploads: { ...p.uploads, photo: f } }))}
                onExport={presignAndUploadProfile}
              />
            )}
          </div>
        </div>

        <div className="wizard1-span-8">
          <h2 className="wizard1-h2">Personal Info</h2>
          <div className="wizard1-grid wizard1-gap">
            <div className="wizard1-span-6">
              <div className="wizard1-field">
                <label className="wizard1-label">First Name <span className="req">*</span></label>
                <input
                  className={`wizard1-input ${errors.firstName ? "has-error" : ""}`}
                  value={form.firstName}
                  onChange={(e) => setField({ firstName: e.target.value })}
                />
                {errors.firstName && <p className="wizard1-error">{errors.firstName}</p>}
              </div>
            </div>

            <div className="wizard1-span-6">
              <div className="wizard1-field">
                <label className="wizard1-label">Last Name <span className="req">*</span></label>
                <input
                  className={`wizard1-input ${errors.lastName ? "has-error" : ""}`}
                  value={form.lastName}
                  onChange={(e) => setField({ lastName: e.target.value })}
                />
                {errors.lastName && <p className="wizard1-error">{errors.lastName}</p>}
              </div>
            </div>

            <div className="wizard1-span-6">
              <div className="wizard1-field">
                <label className="wizard1-label">Camp Nickname</label>
                <input
                  className="wizard1-input"
                  value={form.nickname}
                  onChange={(e) => setField({ nickname: e.target.value })}
                />
              </div>
            </div>

            <div className="wizard1-span-6">
              <div className="wizard1-field">
                <label className="wizard1-label">Email</label>
                <input className="wizard1-input" value={form.email} disabled />
              </div>
            </div>

            <div className="wizard1-span-6">
              <div className="wizard1-field">
                <label className="wizard1-label">Phone</label>
                <input
                  className="wizard1-input"
                  value={form.phone}
                  onChange={(e) => {
                    const d = digitsOnly(e.target.value);
                    const view = d.length === 10 ? formatPhoneNumber(d) : d;
                    setField({ phone: view });
                  }}
                  onBlur={(e) => {
                    const d = digitsOnly(e.target.value);
                    setField({ phone: d.length === 10 ? formatPhoneNumber(d) : d });
                  }}
                  inputMode="tel"
                />
              </div>
            </div>

            {/* ✅ Location mode toggle */}
            <div className="wizard1-span-12">
              <div className="wizard1-field">
                <label className="wizard1-label">Current Location Type</label>
                <div className="wizard1-segment">
                  <button
                    type="button"
                    className={`wizard1-segment-btn ${(form.locationMode || LOCATION_MODES.US) === LOCATION_MODES.US ? "is-active" : ""}`}
                    onClick={() => {
                      setField({
                        locationMode: LOCATION_MODES.US,
                        country: "",
                        state: (form.state || "").trim().toUpperCase(),
                        city: canonicalizeCity(form.city, {
                          state: form.state,
                          country: "United States",
                          options: cityOptions
                        }),
                      });
                    }}
                  >
                    United States
                  </button>

                  <button
                    type="button"
                    className={`wizard1-segment-btn ${(form.locationMode || LOCATION_MODES.US) === LOCATION_MODES.INTL ? "is-active" : ""}`}
                    onClick={() => {
                      setField({
                        locationMode: LOCATION_MODES.INTL,
                        state: "",
                        country: canonicalizeCountry(form.country),
                        city: canonicalizeCity(form.city, {
                          country: form.country,
                          options: cityOptions
                        }),
                      });
                      setCityOptions([]);
                      setCitiesLoading(false);
                    }}
                  >
                    International
                  </button>
                </div>
                <p className="wizard1-hint" style={{ marginTop: 6 }}>
                  Choose “International” if you live outside the U.S.
                </p>
              </div>
            </div>

            {/* ✅ US location: City + State */}
            {(form.locationMode || LOCATION_MODES.US) === LOCATION_MODES.US && (
              <>
                <div className="wizard1-span-6">
                  <div className="wizard1-field">
                    <label className="wizard1-label">
                      Current City <span className="req">*</span>
                    </label>

                    <input
                      className={`wizard1-input ${errors.city ? "has-error" : ""}`}
                      value={form.city}
                      disabled={!form.state}
                      placeholder={form.state ? "Start typing city…" : "Select a state first"}
                      list={form.state ? "city-options" : undefined}
                      onChange={(e) => setField({ city: e.target.value })}
                      onBlur={(e) =>
                        setField({
                          city: canonicalizeCity(e.target.value, {
                            state: form.state,
                            country: "United States",
                            options: cityOptions
                          })
                        })
                      }
                    />

                    {form.state && (
                      <datalist id="city-options">
                        {cityOptions.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    )}

                    {citiesLoading && form.state && (
                      <p className="wizard1-hint">Loading cities…</p>
                    )}

                    {form.state && cityOptions.length > 0 && (
                      <p className="wizard1-hint">Pick the standardized city result whenever possible.</p>
                    )}

                    {errors.city && <p className="wizard1-error">{errors.city}</p>}
                  </div>
                </div>

                <div className="wizard1-span-3">
                  <div className="wizard1-field">
                    <label className="wizard1-label">
                      Current State <span className="req">*</span>
                    </label>
                    <select
                      className={`wizard1-input wizard1-select ${errors.state ? "has-error" : ""}`}
                      value={form.state}
                      onChange={(e) => {
                        const st = (e.target.value || "").trim().toUpperCase();
                        setField({ state: st, city: "" });
                      }}
                    >
                      <option value="">Select…</option>
                      {US_STATE_OPTIONS.map(({ code, label }) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {errors.state && <p className="wizard1-error">{errors.state}</p>}
                  </div>
                </div>
              </>
            )}

            {/* ✅ International location: City + Country */}
            {(form.locationMode || LOCATION_MODES.US) === LOCATION_MODES.INTL && (
              <>
                <div className="wizard1-span-6">
                  <div className="wizard1-field">
                    <label className="wizard1-label">
                      Current City <span className="req">*</span>
                    </label>
                    <input
                      className={`wizard1-input ${errors.city ? "has-error" : ""}`}
                      value={form.city}
                      placeholder={normalizeCountry(form.country) ? "Start typing city…" : "Select country first"}
                      list={normalizeCountry(form.country) ? "intl-city-options" : undefined}
                      disabled={!normalizeCountry(form.country)}
                      onChange={(e) => setField({ city: e.target.value })}
                      onBlur={(e) =>
                        setField({
                          city: canonicalizeCity(e.target.value, {
                            country: form.country,
                            options: cityOptions
                          })
                        })
                      }
                    />
                    {normalizeCountry(form.country) && (
                      <datalist id="intl-city-options">
                        {cityOptions.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    )}
                    {!normalizeCountry(form.country) && (
                      <p className="wizard1-hint">Select your country first for city suggestions.</p>
                    )}
                    {errors.city && <p className="wizard1-error">{errors.city}</p>}
                  </div>
                </div>

                <div className="wizard1-span-6">
                  <div className="wizard1-field">
                    <label className="wizard1-label">
                      Country <span className="req">*</span>
                    </label>

                    <input
                      className={`wizard1-input ${errors.country ? "has-error" : ""}`}
                      value={form.country}
                      placeholder="Start typing…"
                      list="country-options"
                      onChange={(e) => setField({ country: e.target.value })}
                      onBlur={(e) => setField({ country: canonicalizeCountry(e.target.value) })}
                    />

                    <datalist id="country-options">
                      {COUNTRIES.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>

                    {errors.country && <p className="wizard1-error">{errors.country}</p>}
                  </div>
                </div>
              </>
            )}

            {/* ✅ Roles */}
            <div className="wizard1-span-12">
              <MultiSelect
                id="roles"
                label="Former/Current Role at Camp"
                placeholder="Select roles…"
                options={staffRoleOptions}
                value={form.roles}
                onChange={(v) => setField({ roles: v })}
              />
            </div>

            {/* ✅ Camper Years */}
            <div className="wizard1-span-12" style={{ marginTop: 4 }}>
              <div className="wizard1-subtitle">Years at Camp (Camper)</div>

              <div className="wizard1-grid wizard1-gap" style={{ alignItems: "end" }}>
                <div className="wizard1-span-3">
                  <div className="wizard1-field">
                    <label className="wizard1-label">First Year</label>
                    <input
                      className={`wizard1-input ${errors.camper_firstYear ? "has-error" : ""}`}
                      value={form.camperYears?.firstYear || ""}
                      onChange={(e) => setCamperYears({ firstYear: e.target.value })}
                      placeholder="e.g., 2016"
                      inputMode="numeric"
                    />
                    {errors.camper_firstYear && <p className="wizard1-error">{errors.camper_firstYear}</p>}
                  </div>
                </div>

                <div className="wizard1-span-3">
                  <div className="wizard1-field">
                    <label className="wizard1-label">Age Group</label>
                    <select
                      className={`wizard1-input wizard1-select ${errors.camper_firstPair ? "has-error" : ""}`}
                      value={form.camperYears?.firstGroup || ""}
                      onChange={(e) => setCamperYears({ firstGroup: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {ageGroupOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>

                <div className="wizard1-span-3">
                  <div className="wizard1-field">
                    <label className="wizard1-label">Last Year</label>
                    <input
                      className={`wizard1-input ${errors.camper_lastYear ? "has-error" : ""}`}
                      value={form.camperYears?.lastYear || ""}
                      onChange={(e) => setCamperYears({ lastYear: e.target.value })}
                      placeholder="e.g., 2022"
                      inputMode="numeric"
                    />
                    {errors.camper_lastYear && <p className="wizard1-error">{errors.camper_lastYear}</p>}
                  </div>
                </div>

                <div className="wizard1-span-3">
                  <div className="wizard1-field">
                    <label className="wizard1-label">Age Group</label>
                    <select
                      className={`wizard1-input wizard1-select ${errors.camper_lastPair ? "has-error" : ""}`}
                      value={form.camperYears?.lastGroup || ""}
                      onChange={(e) => setCamperYears({ lastGroup: e.target.value })}
                    >
                      <option value="">Select…</option>
                      {ageGroupOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                </div>

                {(errors.camper_firstPair || errors.camper_lastPair || errors.camper_order) && (
                  <div className="wizard1-span-12">
                    <p className="wizard1-error">
                      {errors.camper_firstPair || errors.camper_lastPair || errors.camper_order}
                    </p>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );

  const Step2 = (
    <section className="wizard1-card">
      <div className="wizard1-grid wizard1-gap">
        <div className="wizard1-span-12">
          <h2 className="wizard1-h2">Education</h2>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label">High School</label>
            <input
              className="wizard1-input"
              value={form.highSchool}
              onChange={(e) => setField({ highSchool: e.target.value })}
              placeholder="e.g., Brunswick"
            />
          </div>
        </div>

        <div className="wizard1-span-12">
          <div className="wizard1-edu-list">
            {form.education.map((row, idx) => (
              <div key={idx} className="wizard1-edu-row">
                <div className="wizard1-field">
                  <label className="wizard1-label">College</label>
                  <input
                    className="wizard1-input"
                    value={row.college}
                    onChange={(e) => updateEdu(idx, { college: e.target.value })}
                    placeholder="e.g., University of Michigan"
                  />
                </div>

                <div className="wizard1-field">
                  <label className="wizard1-label">Major</label>
                  <input
                    className="wizard1-input"
                    value={row.major || ""}
                    onChange={(e) => updateEdu(idx, { major: e.target.value })}
                    placeholder="e.g., Economics"
                  />
                </div>

                <div className="wizard1-field">
                  <label className="wizard1-label">Grad Year</label>
                  <input
                    className={`wizard1-input ${errors[`edu_year_${idx}`] ? "has-error" : ""}`}
                    value={row.year}
                    onChange={(e) => updateEdu(idx, { year: e.target.value })}
                    placeholder="e.g., 2026"
                    inputMode="numeric"
                  />
                  {errors[`edu_year_${idx}`] && <p className="wizard1-error">{errors[`edu_year_${idx}`]}</p>}
                </div>

                <div className="wizard1-edu-actions">
                  {form.education.length > 1 && (
                    <button type="button" className="wizard1-btn-text" onClick={() => removeEdu(idx)}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button type="button" className="wizard1-btn-secondary" onClick={addEdu}>
            + Add another college
          </button>
        </div>
      </div>
    </section>
  );

  const Step3 = (
    <section className="wizard1-card">
      <div className="wizard1-grid wizard1-gap">
        <div className="wizard1-span-12">
          <h2 className="wizard1-h2">Experience</h2>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label">Industry <span className="req">*</span></label>
            <select
              className={`wizard1-input wizard1-select ${errors.industry ? "has-error" : ""}`}
              value={form.industry}
              onChange={(e) => setField({ industry: e.target.value })}
            >
              <option value="">Select…</option>
              {INDUSTRIES.map(ind => <option key={ind} value={ind}>{ind}</option>)}
            </select>
            {errors.industry && <p className="wizard1-error">{errors.industry}</p>}
          </div>
        </div>

        <div className="wizard1-span-12">
          <div className="wizard1-subtitle">Current Job(s)</div>
          <div className="wizard1-job-list">
            {form.currentJobs.map((row, idx) => (
              <div key={idx} className="wizard1-job-row">
                <div className="wizard1-field">
                  <label className="wizard1-label">Role</label>
                  <input
                    className={`wizard1-input ${errors[`cur_${idx}`] ? "has-error" : ""}`}
                    value={row.role}
                    onChange={(e)=>updateJob("currentJobs", idx, { role: e.target.value })}
                    placeholder="e.g., Associate"
                  />
                  <div className="wizard1-inline-actions">
                    <button type="button" className="wizard1-btn-text" onClick={() => moveJob("currentJobs", "pastJobs", idx)}>
                      Move to Past
                    </button>
                    {form.currentJobs.length > 1 && (
                      <button type="button" className="wizard1-btn-text" onClick={() => removeJob("currentJobs", idx)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="wizard1-field">
                  <label className="wizard1-label">Company</label>
                  <input
                    className={`wizard1-input ${errors[`cur_${idx}`] ? "has-error" : ""}`}
                    value={row.company}
                    onChange={(e)=>updateJob("currentJobs", idx, { company: e.target.value })}
                    placeholder="e.g., Nike"
                  />
                </div>

                <div className="wizard1-field">
                  <label className="wizard1-label">Years</label>
                  <input
                    className={`wizard1-input ${errors[`cur_years_${idx}`] ? "has-error" : ""}`}
                    value={row.years}
                    onChange={(e)=>updateJob("currentJobs", idx, { years: e.target.value })}
                    placeholder="e.g., 2024–Present"
                  />
                  {(errors[`cur_${idx}`] || errors[`cur_years_${idx}`]) && (
                    <p className="wizard1-error">{errors[`cur_${idx}`] || errors[`cur_years_${idx}`]}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="wizard1-btn-secondary" onClick={()=>addJob("currentJobs")}>
            + Add another current job
          </button>
        </div>

        <div className="wizard1-span-12">
          <div className="wizard1-subtitle">Past Job(s)</div>
          <div className="wizard1-job-list">
            {form.pastJobs.map((row, idx) => (
              <div key={idx} className="wizard1-job-row">
                <div className="wizard1-field">
                  <label className="wizard1-label">Role</label>
                  <input
                    className={`wizard1-input ${errors[`past_${idx}`] ? "has-error" : ""}`}
                    value={row.role}
                    onChange={(e)=>updateJob("pastJobs", idx, { role: e.target.value })}
                    placeholder="e.g., Intern"
                  />
                  <div className="wizard1-inline-actions">
                    <button type="button" className="wizard1-btn-text" onClick={() => moveJob("pastJobs", "currentJobs", idx)}>
                      Move to Current
                    </button>
                    {form.pastJobs.length > 1 && (
                      <button type="button" className="wizard1-btn-text" onClick={() => removeJob("pastJobs", idx)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                <div className="wizard1-field">
                  <label className="wizard1-label">Company</label>
                  <input
                    className={`wizard1-input ${errors[`past_${idx}`] ? "has-error" : ""}`}
                    value={row.company}
                    onChange={(e)=>updateJob("pastJobs", idx, { company: e.target.value })}
                    placeholder="e.g., Morgan Stanley"
                  />
                </div>

                <div className="wizard1-field">
                  <label className="wizard1-label">Years</label>
                  <input
                    className={`wizard1-input ${errors[`past_years_${idx}`] ? "has-error" : ""}`}
                    value={row.years}
                    onChange={(e)=>updateJob("pastJobs", idx, { years: e.target.value })}
                    placeholder="e.g., 2023"
                  />
                  {(errors[`past_${idx}`] || errors[`past_years_${idx}`]) && (
                    <p className="wizard1-error">{errors[`past_${idx}`] || errors[`past_years_${idx}`]}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="wizard1-btn-secondary" onClick={()=>addJob("pastJobs")}>
            + Add another past job
          </button>
        </div>
      </div>
    </section>
  );

  const Step4 = (
    <section className="wizard1-card">
      <div className="wizard1-grid wizard1-gap">
        <div className="wizard1-span-12">
          <h2 className="wizard1-h2">Social Media</h2>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label">LinkedIn</label>
            <input
              type="url"
              className={`wizard1-input ${errors.social_linkedin ? "has-error" : ""}`}
              placeholder="https://linkedin.com/in/you"
              value={form.social.linkedin}
              onChange={(e)=>setSocial({ linkedin: e.target.value })}
              onBlur={(e)=>setSocial({ linkedin: ensureUrl(e.target.value) })}
            />
            {errors.social_linkedin && <p className="wizard1-error">{errors.social_linkedin}</p>}
          </div>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label">Instagram</label>
            <input
              type="text"
              className={`wizard1-input ${errors.social_instagram ? "has-error" : ""}`}
              placeholder="username (or paste a link)"
              value={form.social.instagram}
              onChange={(e)=>setSocial({ instagram: e.target.value })}
              onBlur={(e)=>setSocial({ instagram: toInstagramUrl(e.target.value) })}
            />
            {errors.social_instagram && <p className="wizard1-error">{errors.social_instagram}</p>}
          </div>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label">Facebook</label>
            <input
              type="text"
              className={`wizard1-input ${errors.social_facebook ? "has-error" : ""}`}
              placeholder="username (or paste a link)"
              value={form.social.facebook}
              onChange={(e)=>setSocial({ facebook: e.target.value })}
              onBlur={(e)=>setSocial({ facebook: toFacebookUrl(e.target.value) })}
            />
            {errors.social_facebook && <p className="wizard1-error">{errors.social_facebook}</p>}
          </div>
        </div>
      </div>
    </section>
  );

  if (loading) {
    return (
      <div style={{ position: "relative", minHeight: "100vh" }}>
        <CedarBackground behavior="scroll" opacity={0.9} fixed zIndex={-1} />
        <main className="wizard1-main nav2-page-shell" style={{ position: "relative", zIndex: 1 }}>
          <div className="wizard1-container">
            <h1 className="wizard1-title">Edit Profile</h1>
            <div className="wizard1-card">Loading…</div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <CedarBackground behavior="scroll" opacity={0.9} fixed zIndex={-1} />
      <main className="wizard1-main nav2-page-shell" style={{ position: "relative", zIndex: 1 }}>
        <div className="wizard1-container">
          <h1 className="wizard1-title">Edit Profile</h1>
          <Stepper activeStep={step} />

          {step === 0 ? Step1 : step === 1 ? Step2 : step === 2 ? Step3 : Step4}

          <div className="wizard1-actions">
            {step > 0 ? (
              <button className="wizard1-btn-primary" onClick={onBack} disabled={submitting}>
                Back
              </button>
            ) : (
              <span />
            )}

            <div className="wizard1-actions-right">
              <button className="wizard1-btn-secondary" onClick={onSaveAndExit} disabled={submitting}>
                {submitting ? "Saving..." : "Save & Exit"}
              </button>
              <button className="wizard1-btn-primary" onClick={onNext} disabled={submitting}>
                {step < 3 ? "Next" : (submitting ? "Saving..." : "Save")}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
