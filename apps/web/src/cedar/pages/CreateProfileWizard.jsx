// src/pages/CreateProfileWizard.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import Navbar1 from "../components/Navbar1";
import AvatarCropper from "../components/AvatarCropper";
import ClerkCreateAccountFlow from "../components/ClerkCreateAccountFlow";
import { useNavigate, useSearchParams } from "react-router-dom";
import { API_BASE } from "../lib/api";
import { useTenant } from "../../context/TenantContext.jsx";
import { clerkConfigError, clerkModeRequested, clerkUiEnabled } from "../../lib/authMode.js";
import {
  resolveAgeGroupOptions,
  resolveStaffRoleOptions
} from "../../lib/campLabels.js";

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

const LEGAL_VERSION = "2026-01-05"; // matches “Last Updated: January 5, 2026”
const CREATE_PROFILE_DRAFT_KEY = "createProfileDraft:v1";

function normalizeErrorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.errors?.[0]?.msg === "string") return payload.errors[0].msg;
  return fallback;
}

// --- Location Modes ---
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

// --- Countries (from your list; we’ll display without trailing *) ---
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
  "Namibia","Nassau*","Nauru","Nepal","Netherlands, The","New Zealand","Nicaragua","Niger","Nigeria","Niue","North German Confederation*","North German Union*","North Macedonia","Norway",
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

/* ================= Social normalizers (top-level!) ================= */
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

// Keep your existing ensureUrl for LinkedIn (full link expected)
const normalizeUrl = (s) => {
  const v = (s || "").trim();
  if (!v) return "";
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
};
const ensureUrl = (s) => normalizeUrl(s);

/* ================= City/State/Country normalizers + helpers ================= */
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

// --- City/State/Country splitter ---
// Supports "City, ST" (US) OR "City, Country" (Intl) OR "City, Region, Country" (Intl-ish)
const splitCityState = (cityState = "") => {
  const parts = cityState.split(",").map(s => s.trim()).filter(Boolean);
  const city = parts[0] || "";

  if (parts.length < 2) return { city, state: "", country: "" };

  // If the 2nd token is a US state, treat as US.
  const second = parts[1] || "";
  const secondUpper = second.toUpperCase();
  if (US_STATES.includes(secondUpper)) {
    const state = secondUpper;
    // If there's a 3rd token, treat that as country (rare, but possible)
    const country = parts.length >= 3 ? parts[parts.length - 1] : "";
    return { city, state, country: normalizeCountry(country) };
  }

  // Otherwise treat last token as country, ignore middle tokens (region)
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

/* ================= Resume JSON -> Wizard form mapper ================= */
const mapResumeToForm = (prev, parsed) => {
  const safe = (v, fallback="") => (typeof v === "string" ? v : fallback);

  const { city, state, country } = splitCityState(parsed.cityState || "");
  const locationMode = state ? LOCATION_MODES.US : (country ? LOCATION_MODES.INTL : (prev.locationMode || LOCATION_MODES.US));

  const colleges = parsed.colleges || [];
  const years = parsed.collegeYears || [];
  const majors = parsed.collegeMajors || [];

  const education = colleges.map((c, i) => ({
    college: safe(c),
    year: safe(years[i] || ""),
    major: safe(majors[i] || ""),
  }));

  const currentJobs = Array.isArray(parsed.currentJobs) && parsed.currentJobs.length
    ? parsed.currentJobs.map(j => ({ role: j.role || "", company: j.company || "", years: j.years || "" }))
    : prev.currentJobs;

  const pastJobsRaw = Array.isArray(parsed.pastJobs) && parsed.pastJobs.length
    ? parsed.pastJobs.map(j => ({ role: j.role || "", company: j.company || "", years: j.years || "" }))
    : prev.pastJobs;

  const pastJobs = sortJobsByRecency(pastJobsRaw);

  return {
    ...prev,
    firstName: parsed.firstName || prev.firstName,
    lastName:  parsed.lastName  || prev.lastName,
    email:     parsed.email     || prev.email,
    phone:     parsed.phone ? normalizePhoneInput(parsed.phone) : prev.phone,

    locationMode,
    city: canonicalizeCity(city, { state, country }) || prev.city,
    state: state ? state.trim().toUpperCase() : "",
    country: country ? canonicalizeCountry(country) : (locationMode === LOCATION_MODES.INTL ? (prev.country || "") : ""),

    highSchool: parsed.highSchool || prev.highSchool,
    education:  education.length ? education : prev.education,
    currentJobs,
    pastJobs,
  };
};

const linesForEducation = (education = []) =>
  (education || [])
    .map((row) => {
      const college = (row.college || "").trim();
      const major = (row.major || "").trim();
      const year = (row.year || "").trim();
      if (!college && !major && !year) return "";
      const core = [college, major].filter(Boolean).join(" - ");
      return year ? `${core || "Education"} (${year})` : core;
    })
    .filter(Boolean);

const linesForJobs = (jobs = []) =>
  (jobs || [])
    .map((row) => {
      const role = (row.role || "").trim();
      const company = (row.company || "").trim();
      const years = (row.years || "").trim();
      if (!role && !company && !years) return "";
      const core = [role, company].filter(Boolean).join(" @ ");
      return years ? `${core || "Role"} (${years})` : core;
    })
    .filter(Boolean);

const renderComparable = (value) => JSON.stringify(value ?? "");

const displayValue = (value) => {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not provided";
  const v = String(value || "").trim();
  return v || "Not provided";
};

const buildResumeReviewGroups = (before, after) => {
  const makeItem = (label, from, to) => ({
    label,
    from: displayValue(from),
    to: displayValue(to),
    changed: renderComparable(from) !== renderComparable(to),
  });

  const educationItems = [
    makeItem("High School", before.highSchool, after.highSchool),
    makeItem("Colleges", linesForEducation(before.education), linesForEducation(after.education)),
  ];

  const experienceItems = [
    makeItem("Current Jobs", linesForJobs(before.currentJobs), linesForJobs(after.currentJobs)),
    makeItem("Past Jobs", linesForJobs(before.pastJobs), linesForJobs(after.pastJobs)),
  ];

  const locationItems = [
    makeItem("Location Type", before.locationMode, after.locationMode),
    makeItem("City", before.city, after.city),
    makeItem("State", before.state, after.state),
    makeItem("Country", before.country, after.country),
  ];

  const groups = [
    { title: "Education", items: educationItems },
    { title: "Experience", items: experienceItems },
    { title: "Location", items: locationItems },
  ]
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.changed || item.to !== "Not provided"),
    }))
    .filter((group) => group.items.length > 0);

  const changedCount = groups.reduce(
    (count, group) => count + group.items.filter((item) => item.changed).length,
    0
  );

  return { groups, changedCount };
};

/* ================= Phone formatting helpers ================= */
const digitsOnly = (s = "") => s.replace(/\D/g, "").slice(0, 10);

const formatPhoneNumber = (digits = "") => {
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  const areaCode = digits.slice(0, 3);
  const centralOffice = digits.slice(3, 6);
  const lineNumber = digits.slice(6, 10);
  return `(${areaCode}) ${centralOffice}-${lineNumber}`;
};

const normalizePhoneInput = (value = "") => formatPhoneNumber(digitsOnly(value));

/* ================= Password helpers ================= */
const getPasswordChecks = (password = "") => {
  const v = String(password || "");
  return {
    minLength: v.length >= 8,
    hasLetter: /[a-z]/i.test(v),
    hasNumber: /\d/.test(v),
    hasSpecial: /[^A-Za-z0-9]/.test(v),
  };
};

const getPasswordStrength = (password = "") => {
  const checks = getPasswordChecks(password);
  const score = Object.values(checks).filter(Boolean).length;
  if (!password) return { score: 0, label: "No password" };
  if (score <= 1) return { score, label: "Weak" };
  if (score <= 3) return { score, label: "Medium" };
  return { score, label: "Strong" };
};

/* Small multi-select dropdown */
function MultiSelect({ label, placeholder, options, value, onChange, id }) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
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
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);

  return (
    // ✅ Force full width so the field doesn't collapse
    <div className="wizard1-field" ref={ref} style={{ width: "100%" }}>
      <label className="wizard1-label" htmlFor={id}>
        {label}
      </label>

      <div
        id={id}
        className={`wizard1-mselect ${open ? "is-open" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        // ✅ Force trigger full width
        style={{ width: "100%", display: "block" }}
      >
        {value.length ? (
          <div className="wizard1-tags">
            {value.map((tag) => (
              <span
                key={tag}
                className="wizard1-tag"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(tag);
                }}
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
          // ✅ Force menu full width
          style={{ width: "100%" }}
        >
          {options.map((opt) => (
            <label key={opt} className="wizard1-option">
              <input
                type="checkbox"
                checked={value.includes(opt)}
                onChange={() => toggle(opt)}
              />
              <span>{opt}</span>
            </label>
          ))}

          {value.length > 0 && (
            <button
              type="button"
              className="wizard1-btn-text wizard1-menu-clear"
              onClick={() => onChange([])}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* Stepper that highlights the active step */
function Stepper({ activeStep = 0, canStepNavigate, onStepClick }) {
  const steps = ["Personal","Education","Experience","Social Media"];
  return (
    <div className="wizard1-stepper">
      <div className="wizard1-stepper-track" />
      <div className="wizard1-steps">
        {steps.map((t,i)=>(
          <button
            type="button"
            key={t}
            disabled={!canStepNavigate(i)}
            className={`wizard1-step ${
              i < activeStep ? "wizard1-done"
              : i === activeStep ? "wizard1-active"
              : "wizard1-todo"
            }`}
            onClick={() => onStepClick(i)}
          >
            <div className="wizard1-dot" />
            <div className="wizard1-step-title">Step {i+1}</div>
            <div className="wizard1-step-sub">{t}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CreateProfileWizard() {
  if (clerkUiEnabled()) {
    return <ClerkCreateAccountFlow />;
  }
  if (clerkModeRequested()) {
    return (
      <div className="wizard1">
        <Navbar1 />
        <section className="wizard1-main">
          <div className="wizard1-card">
            <h1 className="wizard1-h1">Create Profile</h1>
            <p className="login1-error">
              {clerkConfigError() || "Clerk auth is enabled but web auth configuration is incomplete."}
            </p>
            <p className="wizard1-sub">
              Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> and restart the web app.
            </p>
          </div>
        </section>
      </div>
    );
  }

  const navigate = useNavigate();
  const { tenant } = useTenant();
  const [searchParams] = useSearchParams();
  const inviteToken = String(searchParams.get("inviteToken") || "").trim();
  const staffRoleOptions = useMemo(() => resolveStaffRoleOptions(tenant), [tenant]);
  const ageGroupOptions = useMemo(() => resolveAgeGroupOptions(tenant), [tenant]);
  const [step, setStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const pdfInput = useRef(null);

  const [cityOptions, setCityOptions] = useState([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const staticUsCitiesCache = useRef(new Map());
  const [citySearchTerm, setCitySearchTerm] = useState("");

  const presignAndUploadProfile = React.useCallback(async (blob) => {
    const fileName = `avatar-${Date.now()}.png`;
    const fileType = "image/png";

    const r = await fetch(`${API_BASE}/uploads/presign-public`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

    setForm((p) => ({ ...p, uploads: { ...(p.uploads || {}), photoUrl: objectUrl } }));

    try {
      const cur = JSON.parse(localStorage.getItem("user") || "null");
      if (cur) {
        const next = { ...cur, uploads: { ...(cur.uploads || {}), photoUrl: objectUrl } };
        const serialized = JSON.stringify(next);
        localStorage.setItem("user", serialized);
        localStorage.setItem("pondbridgeUser", serialized);
        window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
        window.dispatchEvent(new Event("cedar:userChanged"));
      }
    } catch {
      return;
    }
  }, []);

  // --- FORM STATE ---
  const [form, setForm] = useState({
    uploads: { photo: null, pdfs: [], photoUrl: "" },

    // Step 1
    firstName: "", lastName: "", nickname: "",
    email: "", password: "", phone: "",

    // ✅ Location
    locationMode: LOCATION_MODES.US, // "US" | "INTL"
    city: "",
    state: "",
    country: "",

    roles: [],

    // ✅ NEW (Step 1): Camper Years
    camperYears: { firstYear: "", firstGroup: "", lastYear: "", lastGroup: "" },

    // Step 2
    highSchool: "",
    education: [{ college: "", year: "", major: "" }],

    // Step 3
    industry: "",
    currentJobs: [{ role: "", company: "", years: "" }],
    pastJobs: [{ role: "", company: "", years: "" }],

    // Step 4
    social: { linkedin: "", instagram: "", facebook: "" },
    legalAcceptance: { accepted: false, version: LEGAL_VERSION },
  });

  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [attemptedSteps, setAttemptedSteps] = useState({});
  const [errorSummary, setErrorSummary] = useState([]);
  const [emailStatus, setEmailStatus] = useState({ checked: false, error: "" });
  const [inviteMeta, setInviteMeta] = useState(null);
  const [inviteError, setInviteError] = useState("");
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeReview, setResumeReview] = useState({
    open: false,
    candidate: null,
    groups: [],
    changedCount: 0,
  });
  const setField = (patch) => setForm(f => ({ ...f, ...patch }));
  const setSocial = (patch) => setForm((f) => ({ ...f, social: { ...f.social, ...patch } }));
  const setCamperYears = (patch) =>
    setForm((f) => ({ ...f, camperYears: { ...(f.camperYears || {}), ...patch } }));
  const setLegal = (patch) =>
    setForm((f) => ({ ...f, legalAcceptance: { ...(f.legalAcceptance || {}), ...patch } }));
  const markTouched = (key) => setTouched((prev) => ({ ...prev, [key]: true }));
  const showFieldError = (key) => Boolean(errors[key] && (touched[key] || attemptedSteps[step]));

  const getErrorMeta = (key) => {
    const base = {
      firstName: { label: "First Name", fieldId: "firstName" },
      lastName: { label: "Last Name", fieldId: "lastName" },
      email: { label: "Email", fieldId: "email" },
      password: { label: "Password", fieldId: "password" },
      city: { label: "Current City", fieldId: (form.locationMode || LOCATION_MODES.US) === LOCATION_MODES.US ? "city" : "intl_city" },
      state: { label: "Current State", fieldId: "state" },
      country: { label: "Country", fieldId: "country" },
      camper_firstYear: { label: "First Camper Year", fieldId: "camper_firstYear" },
      camper_lastYear: { label: "Last Camper Year", fieldId: "camper_lastYear" },
      camper_firstPair: { label: "First Camper Year + Group", fieldId: "camper_firstYear" },
      camper_lastPair: { label: "Last Camper Year + Group", fieldId: "camper_lastYear" },
      camper_order: { label: "Camper Year Order", fieldId: "camper_firstYear" },
      industry: { label: "Industry", fieldId: "industry" },
      social_linkedin: { label: "LinkedIn", fieldId: "sm_linkedin" },
      social_instagram: { label: "Instagram", fieldId: "sm_instagram" },
      social_facebook: { label: "Facebook", fieldId: "sm_facebook" },
      legal_accept: { label: "Terms and Privacy", fieldId: "legal_accept" },
    };
    if (base[key]) return base[key];
    if (key.startsWith("edu_year_")) {
      const idx = Number(key.split("_")[2] || 0) + 1;
      return { label: `College ${idx} Graduation Year`, fieldId: key };
    }
    if (key.startsWith("cur_")) return { label: "Current Job", fieldId: key };
    if (key.startsWith("past_")) return { label: "Past Job", fieldId: key };
    return { label: "Field", fieldId: "" };
  };

  const buildErrorSummary = (stepErrors) =>
    Object.entries(stepErrors).map(([key, message]) => {
      const meta = getErrorMeta(key);
      return { key, message, label: meta.label, fieldId: meta.fieldId };
    });

  const goToField = (fieldId) => {
    if (!fieldId) return;
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof el.focus === "function") el.focus();
  };

  const validateCamperYears = (camperYears = {}) => {
    const e = {};
    const cy = camperYears || {};
    const yearOk = (y) => !y || /^\d{4}$/.test(String(y).trim());

    if (!yearOk(cy.firstYear)) e.camper_firstYear = "Use a 4-digit year (e.g., 2016).";
    if (!yearOk(cy.lastYear)) e.camper_lastYear = "Use a 4-digit year (e.g., 2022).";

    if ((cy.firstYear && !cy.firstGroup) || (!cy.firstYear && cy.firstGroup)) {
      e.camper_firstPair = "Please include both First Year and Age Group (or leave both blank).";
    }
    if ((cy.lastYear && !cy.lastGroup) || (!cy.lastYear && cy.lastGroup)) {
      e.camper_lastPair = "Please include both Last Year and Age Group (or leave both blank).";
    }

    const fy = cy.firstYear ? parseInt(cy.firstYear, 10) : null;
    const ly = cy.lastYear ? parseInt(cy.lastYear, 10) : null;
    if (fy && ly && fy > ly) e.camper_order = "First Year can’t be after Last Year.";
    return e;
  };

  const getStep1Errors = (values) => {
    const e = validateCamperYears(values.camperYears);
    if (!values.firstName.trim()) e.firstName = "First name is required.";
    if (!values.lastName.trim()) e.lastName = "Last name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) e.email = "Enter a valid email.";
    if (emailStatus.error) e.email = emailStatus.error;

    const pass = getPasswordChecks(values.password);
    if (!pass.minLength || !pass.hasLetter || !pass.hasNumber) {
      e.password = "Use 8+ characters and include at least one letter and one number.";
    }

    if (!normalizeCity(values.city)) e.city = "City is required.";
    if ((values.locationMode || LOCATION_MODES.US) === LOCATION_MODES.US) {
      if (!values.state) e.state = "Select a state.";
    } else {
      if (!normalizeCountry(values.country)) e.country = "Select a country.";
    }
    return e;
  };

  const getStep2Errors = (values) => {
    const e = {};
    values.education.forEach((row, idx) => {
      if ((row.year || "").trim() && !/^\d{4}$/.test(row.year.trim())) {
        e[`edu_year_${idx}`] = "Use a 4-digit year (e.g., 2024).";
      }
    });
    return e;
  };

  const getStep3Errors = (values) => {
    const e = {};
    if (!values.industry) e.industry = "Please select an industry.";

    const checkList = (list, prefix) => {
      values[list].forEach((j, i) => {
        const any = (j.role || "").trim() || (j.company || "").trim() || (j.years || "").trim();
        if (!any) return;
        const bothCore = (j.role || "").trim() && (j.company || "").trim();
        if (!bothCore) e[`${prefix}_${i}`] = "Please include role and company.";
        if (j.years && !/^[\w\s–-]{2,30}$/.test(j.years)) e[`${prefix}_years_${i}`] = "Use a short label (e.g., 2022–Present).";
      });
    };

    checkList("currentJobs", "cur");
    checkList("pastJobs", "past");
    return e;
  };

  const getStep4Errors = (values) => {
    const e = {};
    const S = values.social || {};

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
    if (!values.legalAcceptance?.accepted) {
      e.legal_accept = "You must agree to the Terms & Privacy to create an account.";
    }
    return e;
  };

  const getErrorsForStep = (stepNumber, values) => {
    if (stepNumber === 0) return getStep1Errors(values);
    if (stepNumber === 1) return getStep2Errors(values);
    if (stepNumber === 2) return getStep3Errors(values);
    return getStep4Errors(values);
  };

  const validateStep = (stepNumber) => {
    const stepErrors = getErrorsForStep(stepNumber, form);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) {
      setAttemptedSteps((prev) => ({ ...prev, [stepNumber]: true }));
      setErrorSummary(buildErrorSummary(stepErrors));
      return false;
    }
    setErrorSummary([]);
    return true;
  };

  const toDraftForm = (values) => ({
    ...values,
    uploads: {
      ...(values.uploads || {}),
      photo: null,
      pdfs: [],
    },
  });

  const saveDraft = () => {
    try {
      const payload = {
        version: 1,
        step,
        completedSteps,
        form: toDraftForm(form),
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(CREATE_PROFILE_DRAFT_KEY, JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error("Failed to save draft:", err);
      return false;
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CREATE_PROFILE_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !parsed.form) return;
      setForm((prev) => ({
        ...prev,
        ...parsed.form,
        uploads: {
          ...prev.uploads,
          ...(parsed.form.uploads || {}),
          photo: null,
          pdfs: [],
        },
      }));
      if (Number.isInteger(parsed.step)) {
        setStep(Math.min(3, Math.max(0, parsed.step)));
      }
      if (parsed.completedSteps && typeof parsed.completedSteps === "object") {
        setCompletedSteps(parsed.completedSteps);
      }
    } catch (err) {
      console.error("Failed to restore draft:", err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!inviteToken) {
      setInviteMeta(null);
      setInviteError("");
      return undefined;
    }

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/invite/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteToken }),
        });
        const text = await res.text();
        if (!res.ok) {
          let msg = "Invite link is invalid or expired.";
          try {
            const parsed = JSON.parse(text);
            msg = parsed?.error?.message || parsed?.message || msg;
          } catch {}
          if (!cancelled) setInviteError(msg);
          return;
        }

        const payload = JSON.parse(text);
        const invite = payload?.invite || null;
        if (!cancelled) {
          setInviteMeta(invite);
          setInviteError("");
          if (invite?.email) {
            setForm((prev) => ({ ...prev, email: String(invite.email || "").trim().toLowerCase() }));
          }
        }
      } catch {
        if (!cancelled) setInviteError("Could not verify invite link. Please try again.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

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

  // --- PDF handlers (Step 1) ---
  const addPDFs = (files) => {
    const picked = Array.from(files || []).filter(f => f.type === "application/pdf");
    setForm(p => {
      const next = [...(p.uploads.pdfs || []), ...picked].slice(0, 2);
      return { ...p, uploads: { ...p.uploads, pdfs: next } };
    });
  };
  const removePDF = (i) =>
    setForm(p => ({ ...p, uploads: { ...p.uploads, pdfs: (p.uploads.pdfs || []).filter((_, idx) => idx !== i) } }));

  useEffect(() => {
    const stepErrors =
      step === 0 ? getStep1Errors(form) :
      step === 1 ? getStep2Errors(form) :
      step === 2 ? getStep3Errors(form) :
      getStep4Errors(form);
    if (!attemptedSteps[step] && Object.keys(touched).length === 0) return;
    setErrors(stepErrors);
  }, [form, step, touched, attemptedSteps, emailStatus.error]);

  const handleEmailBlur = () => {
    markTouched("email");
    const normalized = String(form.email || "").trim().toLowerCase();
    setField({ email: normalized });
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setEmailStatus({ checked: false, error: "" });
      return;
    }
    // TODO: if backend adds GET /api/auth/check-email?email=... call it here to pre-check availability.
    setEmailStatus({ checked: true, error: "" });
  };

  const closeResumeReview = () =>
    setResumeReview({ open: false, candidate: null, groups: [], changedCount: 0 });

  const applyResumeChanges = () => {
    if (resumeReview.candidate) {
      setForm(resumeReview.candidate);
    }
    closeResumeReview();
  };

  // --- Resume autofill (Step 1) ---
  const handleResumeUpload = async (file) => {
    if (!file) return;
    try {
      setResumeBusy(true);
      const formData = new FormData();
      formData.append("resume", file);

      const res = await fetch(`${API_BASE}/resume/parse`, { method: "POST", body: formData });
      const text = await res.text();

      if (!res.ok) {
        let msg = "Resume parsing failed.";
        try {
          const parsed = JSON.parse(text);
          msg = normalizeErrorMessage(parsed, msg);
        } catch {
          msg = "Resume parsing failed.";
        }
        alert(msg);
        return;
      }

      const result = JSON.parse(text);
      const parsed = JSON.parse(result.data);
      const candidate = mapResumeToForm(form, parsed);
      const { groups, changedCount } = buildResumeReviewGroups(form, candidate);
      setResumeReview({
        open: true,
        candidate,
        groups,
        changedCount,
      });
    } catch (err) {
      console.error(err);
      alert("Network error while parsing your resume.");
    } finally {
      setResumeBusy(false);
    }
  };

  // --- Nav actions ---
  const canNavigateToStep = (targetStep) => {
    if (targetStep <= step) return true;
    for (let i = 0; i < targetStep; i += 1) {
      if (!completedSteps[i]) return false;
    }
    return true;
  };

  const onStepClick = (targetStep) => {
    if (!canNavigateToStep(targetStep)) return;
    setErrorSummary([]);
    setStep(targetStep);
  };

  const onNext = async () => {
    if (step === 0) {
      if (!validateStep(0)) return;
      setCompletedSteps((prev) => ({ ...prev, 0: true }));
      return setStep(1);
    }
    if (step === 1) {
      if (!validateStep(1)) return;
      setCompletedSteps((prev) => ({ ...prev, 1: true }));
      return setStep(2);
    }
    if (step === 2) {
      if (!validateStep(2)) return;
      setCompletedSteps((prev) => ({ ...prev, 2: true }));
      return setStep(3);
    }

    if (step === 3) {
      if (!validateStep(3)) return;

      try {
        setSubmitting(true);
        const payload = buildRegisterPayload(form);

        const res = await fetch(`${API_BASE}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const text = await res.text();

        if (!res.ok) {
          let msg = `Registration failed (${res.status}).`;
          try {
            const j = JSON.parse(text);
            msg = normalizeErrorMessage(j, msg);
          } catch { msg = `Registration failed (${res.status}).`; }
          if (res.status === 409) {
            setEmailStatus({ checked: true, error: "This email is already registered. Try another email." });
            setStep(0);
            const stepErrors = { email: "This email is already registered. Try another email." };
            setErrors(stepErrors);
            setAttemptedSteps((prev) => ({ ...prev, 0: true }));
            setErrorSummary(buildErrorSummary(stepErrors));
            return;
          }
          console.error("Register failed:", res.status, text);
          alert(msg);
          setSubmitting(false);
          return;
        }

        const data = JSON.parse(text);
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        localStorage.setItem("pondbridgeToken", data.token);
        localStorage.setItem("pondbridgeUser", JSON.stringify(data.user));
        window.dispatchEvent(new CustomEvent("pondbridge-auth-updated"));
        localStorage.removeItem(CREATE_PROFILE_DRAFT_KEY);
        navigate("/home");
      } catch (err) {
        console.error(err);
        alert("Network error. Please try again.");
      } finally {
        setSubmitting(false);
      }
    }
  };

  const onSaveExit = () => {
    const ok = saveDraft();
    if (!ok) {
      alert("Could not save your draft. Please try again.");
      return;
    }
    navigate("/login");
  };

  const onBack = () => {
    setErrorSummary([]);
    setStep(s => Math.max(0, s - 1));
  };

  // --- UI: Step 1 ---
  const Step1 = (
    <section className="wizard1-card">
      <div className="wizard1-grid wizard1-gap">
        <div className="wizard1-span-12">
          <h2 className="wizard1-h2">Personal</h2>
          <p className="wizard1-hint">Create your login, location, and camp details.</p>
          {inviteMeta?.email ? (
            <p className="wizard1-hint">
              Invite recognized for <strong>{inviteMeta.email}</strong>. You are signing up as{" "}
              <strong>{inviteMeta.roleToAssign || "user"}</strong>.
            </p>
          ) : null}
          {inviteError ? <p className="wizard1-error">{inviteError}</p> : null}
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label" htmlFor="firstName">
              First Name <span className="req">*</span>
            </label>
            <input
              id="firstName"
              className={`wizard1-input ${showFieldError("firstName") ? "has-error" : ""}`}
              value={form.firstName}
              onChange={(e) => setField({ firstName: e.target.value })}
              onBlur={() => markTouched("firstName")}
            />
            {showFieldError("firstName") && <p className="wizard1-error">{errors.firstName}</p>}
          </div>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label" htmlFor="lastName">
              Last Name <span className="req">*</span>
            </label>
            <input
              id="lastName"
              className={`wizard1-input ${showFieldError("lastName") ? "has-error" : ""}`}
              value={form.lastName}
              onChange={(e) => setField({ lastName: e.target.value })}
              onBlur={() => markTouched("lastName")}
            />
            {showFieldError("lastName") && <p className="wizard1-error">{errors.lastName}</p>}
          </div>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label" htmlFor="email">
              Email <span className="req">*</span>
            </label>
            <input
              id="email"
              type="email"
              className={`wizard1-input ${showFieldError("email") ? "has-error" : ""}`}
              value={form.email}
              onChange={(e) => setField({ email: e.target.value })}
              onBlur={handleEmailBlur}
              disabled={Boolean(inviteMeta?.email)}
            />
            {showFieldError("email") && <p className="wizard1-error">{errors.email}</p>}
          </div>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label" htmlFor="password">
              Password <span className="req">*</span>
            </label>
            <input
              id="password"
              type="password"
              className={`wizard1-input ${showFieldError("password") ? "has-error" : ""}`}
              value={form.password}
              onChange={(e) => setField({ password: e.target.value })}
              onBlur={() => markTouched("password")}
            />
            {!form.password ? (
              <p className="wizard1-hint">Use 8+ characters with at least one letter and one number.</p>
            ) : (
              <div className="wizard1-password-help">
                <span className={getPasswordChecks(form.password).minLength ? "ok" : ""}>8+ characters</span>
                <span className={getPasswordChecks(form.password).hasLetter ? "ok" : ""}>letter</span>
                <span className={getPasswordChecks(form.password).hasNumber ? "ok" : ""}>number</span>
                <span className={getPasswordChecks(form.password).hasSpecial ? "ok" : ""}>special character</span>
              </div>
            )}
            <p className="wizard1-hint">Strength: {getPasswordStrength(form.password).label}</p>
            {showFieldError("password") && <p className="wizard1-error">{errors.password}</p>}
          </div>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label" htmlFor="phone">Phone (Optional)</label>
            <input
              id="phone"
              className="wizard1-input"
              value={form.phone}
              onChange={(e) => setField({ phone: normalizePhoneInput(e.target.value) })}
              onBlur={(e) => {
                markTouched("phone");
                setField({ phone: normalizePhoneInput(e.target.value) });
              }}
              inputMode="tel"
            />
          </div>
        </div>

        <div className="wizard1-span-6">
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
                    country: normalizeCountry(form.country),
                  });
                  setCityOptions([]);
                  setCitiesLoading(false);
                }}
              >
                International
              </button>
            </div>
            <p className="wizard1-hint">
              Choose “International” if you live outside the U.S.
            </p>
          </div>
        </div>

        {(form.locationMode || LOCATION_MODES.US) === LOCATION_MODES.US && (
          <>
            <div className="wizard1-span-6">
              <div className="wizard1-field">
                <label className="wizard1-label" htmlFor="city">
                  Current City <span className="req">*</span>
                </label>

                <input
                  id="city"
                  className={`wizard1-input ${showFieldError("city") ? "has-error" : ""}`}
                  value={form.city}
                  disabled={!form.state}
                  placeholder={form.state ? "Start typing city…" : "Choose a state first"}
                  list={form.state ? "city-options" : undefined}
                  onChange={(e) => setField({ city: e.target.value })}
                  onBlur={(e) => {
                    markTouched("city");
                    setField({
                      city: canonicalizeCity(e.target.value, {
                        state: form.state,
                        country: "United States",
                        options: cityOptions
                      })
                    });
                  }}
                />

                {!form.state && (
                  <p className="wizard1-hint">Select a state first for city suggestions.</p>
                )}

                {form.state && (
                  <datalist id="city-options">
                    {cityOptions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                )}

                {citiesLoading && form.state && <p className="wizard1-hint">Loading cities…</p>}
                {form.state && cityOptions.length > 0 && (
                  <p className="wizard1-hint">Pick the standardized city result whenever possible.</p>
                )}

                {showFieldError("city") && <p className="wizard1-error">{errors.city}</p>}
              </div>
            </div>

            <div className="wizard1-span-6">
              <div className="wizard1-field">
                <label className="wizard1-label" htmlFor="state">
                  Current State <span className="req">*</span>
                </label>
                <select
                  id="state"
                  className={`wizard1-input wizard1-select ${showFieldError("state") ? "has-error" : ""}`}
                  value={form.state}
                  onChange={(e) => {
                    const st = (e.target.value || "").trim().toUpperCase();
                    setField({ state: st, city: "" });
                  }}
                  onBlur={() => markTouched("state")}
                >
                  <option value="">Select…</option>
                  {US_STATE_OPTIONS.map(({ code, label }) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
                {showFieldError("state") && <p className="wizard1-error">{errors.state}</p>}
              </div>
            </div>
          </>
        )}

        {(form.locationMode || LOCATION_MODES.US) === LOCATION_MODES.INTL && (
          <>
            <div className="wizard1-span-6">
              <div className="wizard1-field">
                <label className="wizard1-label" htmlFor="intl_city">
                  Current City <span className="req">*</span>
                </label>
                <input
                  id="intl_city"
                  className={`wizard1-input ${showFieldError("city") ? "has-error" : ""}`}
                  value={form.city}
                  placeholder={normalizeCountry(form.country) ? "Start typing city…" : "Choose country first"}
                  list={normalizeCountry(form.country) ? "intl-city-options" : undefined}
                  disabled={!normalizeCountry(form.country)}
                  onChange={(e) => setField({ city: e.target.value })}
                  onBlur={(e) => {
                    markTouched("city");
                    setField({
                      city: canonicalizeCity(e.target.value, {
                        country: form.country,
                        options: cityOptions
                      })
                    });
                  }}
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
                {showFieldError("city") && <p className="wizard1-error">{errors.city}</p>}
              </div>
            </div>

            <div className="wizard1-span-6">
              <div className="wizard1-field">
                <label className="wizard1-label" htmlFor="country">
                  Country <span className="req">*</span>
                </label>

                <input
                  id="country"
                  className={`wizard1-input ${showFieldError("country") ? "has-error" : ""}`}
                  value={form.country}
                  placeholder="Start typing…"
                  list="country-options"
                  onChange={(e) => setField({ country: e.target.value })}
                  onBlur={(e) => {
                    markTouched("country");
                    setField({ country: canonicalizeCountry(e.target.value) });
                  }}
                />

                <datalist id="country-options">
                  {COUNTRIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>

                {showFieldError("country") && <p className="wizard1-error">{errors.country}</p>}
              </div>
            </div>
          </>
        )}

        <div className="wizard1-span-12">
          <div className="wizard1-camp-section">
            <div className="wizard1-subtitle">Your camp</div>

            <div className="wizard1-grid wizard1-gap">
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

              <div className="wizard1-span-12" style={{ marginTop: 4 }}>
                <div className="wizard1-label">Years at Camp (As a Camper)</div>

                <div className="wizard1-grid wizard1-gap" style={{ alignItems: "end" }}>
                  <div className="wizard1-span-3">
                    <div className="wizard1-field">
                      <label className="wizard1-label">First Year</label>
                      <input
                        id="camper_firstYear"
                        className={`wizard1-input ${showFieldError("camper_firstYear") ? "has-error" : ""}`}
                        value={form.camperYears?.firstYear || ""}
                        onChange={(e) => setCamperYears({ firstYear: e.target.value })}
                        onBlur={() => markTouched("camper_firstYear")}
                        placeholder="e.g., 2016"
                        inputMode="numeric"
                      />
                      {showFieldError("camper_firstYear") && <p className="wizard1-error">{errors.camper_firstYear}</p>}
                    </div>
                  </div>

                  <div className="wizard1-span-3">
                    <div className="wizard1-field">
                      <label className="wizard1-label">Age Group</label>
                      <select
                        className={`wizard1-input wizard1-select ${showFieldError("camper_firstPair") ? "has-error" : ""}`}
                        value={form.camperYears?.firstGroup || ""}
                        onChange={(e) => setCamperYears({ firstGroup: e.target.value })}
                        onBlur={() => markTouched("camper_firstPair")}
                      >
                        <option value="">Select…</option>
                        {ageGroupOptions.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="wizard1-span-3">
                    <div className="wizard1-field">
                      <label className="wizard1-label">Last Year</label>
                      <input
                        id="camper_lastYear"
                        className={`wizard1-input ${showFieldError("camper_lastYear") ? "has-error" : ""}`}
                        value={form.camperYears?.lastYear || ""}
                        onChange={(e) => setCamperYears({ lastYear: e.target.value })}
                        onBlur={() => markTouched("camper_lastYear")}
                        placeholder="e.g., 2022"
                        inputMode="numeric"
                      />
                      {showFieldError("camper_lastYear") && <p className="wizard1-error">{errors.camper_lastYear}</p>}
                    </div>
                  </div>

                  <div className="wizard1-span-3">
                    <div className="wizard1-field">
                      <label className="wizard1-label">Age Group</label>
                      <select
                        className={`wizard1-input wizard1-select ${showFieldError("camper_lastPair") ? "has-error" : ""}`}
                        value={form.camperYears?.lastGroup || ""}
                        onChange={(e) => setCamperYears({ lastGroup: e.target.value })}
                        onBlur={() => markTouched("camper_lastPair")}
                      >
                        <option value="">Select…</option>
                        {ageGroupOptions.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {(showFieldError("camper_firstPair") || showFieldError("camper_lastPair") || showFieldError("camper_order")) && (
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

        <div className="wizard1-span-12">
          <details className="wizard1-optional">
            <summary>Optional time-savers: photo + resume autofill</summary>
            <div className="wizard1-optional-body">
              <div className="wizard1-grid wizard1-gap">
                <div className="wizard1-span-4 wizard1-optional-col">
                  <div className="wizard1-subtitle">Profile Photo (Optional)</div>

                  <div className="wizard1-dottedbox">
                    {form.uploads.photoUrl ? (
                      <div className="wizard1-photo-preview-row">
                        <div
                          className="wizard1-photo-thumb"
                          style={{ backgroundImage: `url(${form.uploads.photoUrl})` }}
                          aria-label="Saved avatar preview"
                        />
                        <div className="wizard1-inline-actions">
                          <button
                            type="button"
                            className="wizard1-btn-text"
                            onClick={() =>
                              setForm((p) => ({ ...p, uploads: { ...p.uploads, photoUrl: "" } }))
                            }
                          >
                            Replace photo
                          </button>
                        </div>
                      </div>
                    ) : (
                      <AvatarCropper
                        size={140}
                        imageFile={form.uploads.photo || null}
                        onPickFile={(f) =>
                          setForm((p) => ({ ...p, uploads: { ...p.uploads, photo: f } }))
                        }
                        onExport={presignAndUploadProfile}
                      />
                    )}
                  </div>
                </div>

                <div className="wizard1-span-8 wizard1-optional-col">
                  <div className="wizard1-subtitle">Resume Autofill (Optional)</div>
                  <div
                    className="wizard1-dottedbox wizard1-dotted-drop"
                    role="button"
                    tabIndex={0}
                    onClick={() => { if (!resumeBusy) pdfInput.current?.click(); }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      if (resumeBusy) return;
                      e.preventDefault();
                      const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type === "application/pdf");
                      if (files[0]) handleResumeUpload(files[0]);
                      addPDFs(files);
                    }}
                  >
                    <div className="wizard1-drop-title">Autofill from Resume (30 seconds)</div>
                    <div className="wizard1-drop-sub">Fills education, jobs, and locations.</div>
                    <div className="wizard1-hint">(PDF only • up to 2 files)</div>
                    <div className="wizard1-hint">
                      Your resume file is processed temporarily and deleted after extraction; only extracted profile fields are kept.
                    </div>
                    {resumeBusy && <div className="wizard1-hint">Parsing your resume…</div>}
                    <input
                      ref={pdfInput}
                      type="file"
                      accept="application/pdf"
                      multiple
                      disabled={resumeBusy}
                      hidden
                      onChange={(e) => {
                        if (resumeBusy) return;
                        const files = Array.from(e.target.files || []);
                        if (files[0]) handleResumeUpload(files[0]);
                        addPDFs(files);
                      }}
                    />
                  </div>

                  {(form.uploads?.pdfs?.length ?? 0) > 0 && (
                    <ul className="wizard1-filelist">
                      {(form.uploads?.pdfs ?? []).map((f, i) => (
                        <li key={i} className="wizard1-fileitem">
                          <span>{f.name}</span>
                          <button type="button" className="wizard1-btn-text" onClick={() => removePDF(i)}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
    </section>
  );

  // --- UI: Step 2 (Education) ---
  const updateEdu = (idx, patch) =>
    setForm(f => ({
      ...f,
      education: f.education.map((row, i) => i === idx ? { ...row, ...patch } : row)
    }));
  const addEdu = () => setForm(f => ({ ...f, education: [...f.education, { college: "", year: "", major: "" }] }));
  const removeEdu = (idx) =>
    setForm(f => ({ ...f, education: f.education.filter((_, i) => i !== idx) }));

  const Step2 = (
    <section className="wizard1-card">
      <div className="wizard1-grid wizard1-gap">
        <div className="wizard1-span-12">
          <h2 className="wizard1-h2">Education</h2>
          <p className="wizard1-hint">Add school details you want to show on your profile.</p>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label" htmlFor="highSchool">High School</label>
            <input
              id="highSchool"
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
                    id={`edu_year_${idx}`}
                    className={`wizard1-input ${showFieldError(`edu_year_${idx}`) ? "has-error" : ""}`}
                    value={row.year}
                    onChange={(e) => updateEdu(idx, { year: e.target.value })}
                    onBlur={() => markTouched(`edu_year_${idx}`)}
                    placeholder="e.g., 2026"
                    inputMode="numeric"
                  />
                  {showFieldError(`edu_year_${idx}`) && (
                    <p className="wizard1-error">{errors[`edu_year_${idx}`]}</p>
                  )}
                </div>

                <div className="wizard1-edu-actions">
                  {form.education.length > 1 && (
                    <button
                      type="button"
                      className="wizard1-btn-text"
                      onClick={() => removeEdu(idx)}
                    >
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

  // --- Experience helpers (Step 3) ---
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

  const Step3 = (
    <section className="wizard1-card">
      <div className="wizard1-grid wizard1-gap">
        <div className="wizard1-span-12">
          <h2 className="wizard1-h2">Experience</h2>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label" htmlFor="industry">
              Industry (Student if Student) <span className="req">*</span>
            </label>
            <select
              id="industry"
              className={`wizard1-input wizard1-select ${showFieldError("industry") ? "has-error" : ""}`}
              value={form.industry}
              onChange={(e) => setField({ industry: e.target.value })}
              onBlur={() => markTouched("industry")}
            >
              <option value="">Select…</option>
              {INDUSTRIES.map(ind => (
                <option key={ind} value={ind}>{ind}</option>
              ))}
            </select>
            {showFieldError("industry") && <p className="wizard1-error">{errors.industry}</p>}
          </div>
        </div>

        {/* Current Jobs */}
        <div className="wizard1-span-12">
          <div className="wizard1-subtitle">Current Job(s)</div>
          <div className="wizard1-job-list">
            {form.currentJobs.map((row, idx) => (
              <div key={idx} className="wizard1-job-row">
                <div className="wizard1-field">
                  <label className="wizard1-label">Role</label>
                  <input
                    id={`cur_${idx}`}
                    className={`wizard1-input ${showFieldError(`cur_${idx}`) ? "has-error" : ""}`}
                    value={row.role}
                    onChange={(e)=>updateJob("currentJobs", idx, { role: e.target.value })}
                    onBlur={() => markTouched(`cur_${idx}`)}
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
                    className={`wizard1-input ${showFieldError(`cur_${idx}`) ? "has-error" : ""}`}
                    value={row.company}
                    onChange={(e)=>updateJob("currentJobs", idx, { company: e.target.value })}
                    onBlur={() => markTouched(`cur_${idx}`)}
                    placeholder="e.g., Nike"
                  />
                </div>

                <div className="wizard1-field">
                  <label className="wizard1-label">Years</label>
                  <input
                    id={`cur_years_${idx}`}
                    className={`wizard1-input ${showFieldError(`cur_years_${idx}`) ? "has-error" : ""}`}
                    value={row.years}
                    onChange={(e)=>updateJob("currentJobs", idx, { years: e.target.value })}
                    onBlur={() => markTouched(`cur_years_${idx}`)}
                    placeholder="e.g., 2024–Present"
                  />
                  {(showFieldError(`cur_${idx}`) || showFieldError(`cur_years_${idx}`)) && (
                    <p className="wizard1-error">
                      {errors[`cur_${idx}`] || errors[`cur_years_${idx}`]}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="wizard1-btn-secondary" onClick={()=>addJob("currentJobs")}>
            + Add another current job
          </button>
        </div>

        {/* Past Jobs */}
        <div className="wizard1-span-12">
          <div className="wizard1-subtitle">Past Job(s)</div>
          <div className="wizard1-job-list">
            {form.pastJobs.map((row, idx) => (
              <div key={idx} className="wizard1-job-row">
                <div className="wizard1-field">
                  <label className="wizard1-label">Role</label>
                  <input
                    id={`past_${idx}`}
                    className={`wizard1-input ${showFieldError(`past_${idx}`) ? "has-error" : ""}`}
                    value={row.role}
                    onChange={(e)=>updateJob("pastJobs", idx, { role: e.target.value })}
                    onBlur={() => markTouched(`past_${idx}`)}
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
                    className={`wizard1-input ${showFieldError(`past_${idx}`) ? "has-error" : ""}`}
                    value={row.company}
                    onChange={(e)=>updateJob("pastJobs", idx, { company: e.target.value })}
                    onBlur={() => markTouched(`past_${idx}`)}
                    placeholder="e.g., Morgan Stanley"
                  />
                </div>

                <div className="wizard1-field">
                  <label className="wizard1-label">Years</label>
                  <input
                    id={`past_years_${idx}`}
                    className={`wizard1-input ${showFieldError(`past_years_${idx}`) ? "has-error" : ""}`}
                    value={row.years}
                    onChange={(e)=>updateJob("pastJobs", idx, { years: e.target.value })}
                    onBlur={() => markTouched(`past_years_${idx}`)}
                    placeholder="e.g., 2023"
                  />
                  {(showFieldError(`past_${idx}`) || showFieldError(`past_years_${idx}`)) && (
                    <p className="wizard1-error">
                      {errors[`past_${idx}`] || errors[`past_years_${idx}`]}
                    </p>
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

  function buildRegisterPayload(form) {
    const uploads = {
      photoUrl: form.uploads?.photoUrl || "",
      pdfUrls: form.uploads?.pdfsUrls || [],
    };

    const pastJobsSorted = sortJobsByRecency(form.pastJobs || []);
    const mode = form.locationMode || LOCATION_MODES.US;

    return {
      email: form.email,
      password: form.password,
      inviteToken: inviteToken || undefined,

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
      uploads,

      // ✅ Camper Years
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

      legalAcceptance: {
        accepted: !!form.legalAcceptance?.accepted,
        version: form.legalAcceptance?.version || LEGAL_VERSION,
      },
    };
  }

  const Step4 = (
    <section className="wizard1-card">
      <div className="wizard1-grid wizard1-gap">
        <div className="wizard1-span-12">
          <h2 className="wizard1-h2">Social Media</h2>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label" htmlFor="sm_linkedin">LinkedIn</label>
            <input
              id="sm_linkedin" type="url"
              className={`wizard1-input ${showFieldError("social_linkedin") ? "has-error" : ""}`}
              placeholder="https://linkedin.com/in/you"
              value={form.social.linkedin}
              onChange={(e)=>setSocial({ linkedin: e.target.value })}
              onBlur={(e)=>{
                markTouched("social_linkedin");
                setSocial({ linkedin: ensureUrl(e.target.value) });
              }}
            />
            {showFieldError("social_linkedin") && <p className="wizard1-error">{errors.social_linkedin}</p>}
          </div>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label" htmlFor="sm_instagram">Instagram</label>
            <input
              id="sm_instagram"
              type="text"
              className={`wizard1-input ${showFieldError("social_instagram") ? "has-error" : ""}`}
              placeholder="username (or paste a link)"
              value={form.social.instagram}
              onChange={(e)=>setSocial({ instagram: e.target.value })}
              onBlur={(e)=>{
                markTouched("social_instagram");
                setSocial({ instagram: toInstagramUrl(e.target.value) });
              }}
            />
            {showFieldError("social_instagram") && <p className="wizard1-error">{errors.social_instagram}</p>}
          </div>
        </div>

        <div className="wizard1-span-6">
          <div className="wizard1-field">
            <label className="wizard1-label" htmlFor="sm_facebook">Facebook</label>
            <input
              id="sm_facebook"
              type="text"
              className={`wizard1-input ${showFieldError("social_facebook") ? "has-error" : ""}`}
              placeholder="username (or paste a link)"
              value={form.social.facebook}
              onChange={(e)=>setSocial({ facebook: e.target.value })}
              onBlur={(e)=>{
                markTouched("social_facebook");
                setSocial({ facebook: toFacebookUrl(e.target.value) });
              }}
            />
            {showFieldError("social_facebook") && <p className="wizard1-error">{errors.social_facebook}</p>}
          </div>
        </div>

        {/* ✅ REQUIRED: Terms & Privacy agreement */}
        <div className="wizard1-span-12" style={{ marginTop: 8 }}>
          <div className={`wizard1-legal ${showFieldError("legal_accept") ? "has-error" : ""}`}>
            <label className="wizard1-legal-check">
              <input
                id="legal_accept"
                type="checkbox"
                checked={!!form.legalAcceptance?.accepted}
                onChange={(e) => {
                  markTouched("legal_accept");
                  setLegal({ accepted: e.target.checked });
                }}
              />
              <span>
                I agree to the <strong>Terms of Service</strong> and acknowledge the{" "}
                <strong>Privacy Policy</strong>. <span className="req">*</span>
              </span>
            </label>

            {showFieldError("legal_accept") && <p className="wizard1-error">{errors.legal_accept}</p>}

            <details className="wizard1-legal-details">
              <summary>View Terms & Privacy (Last Updated: January 5, 2026)</summary>

              <div className="wizard1-legal-scroll">
                <h3>Privacy Policy (Your Camp Alumni Network)</h3>
                <p><strong>Last Updated:</strong> January 5, 2026</p>
                <p>
                  This Privacy Policy explains how Your Camp Alumni Network (“we,” “us,” or “our”) collects,
                  uses, and shares information when you use our website and related services (the “Service”).
                </p>
                <p>
                  If you have questions or requests about privacy, contact us at{" "}
                  <a href="mailto:support@pondbridge.co">support@pondbridge.co</a>.
                </p>

                <h4>1) Information We Collect</h4>
                <p><strong>A. Information You Provide</strong></p>
                <ul>
                  <li><strong>Account information:</strong> name, email, password (stored in encrypted/hashed form)</li>
                  <li><strong>Profile information:</strong> phone number, city/state, camp role, high school, colleges, graduation years, jobs, industry, social links, and other details you add</li>
                  <li><strong>User content:</strong> photos you upload, posts/comments, messages, and other content you submit</li>
                  <li><strong>Communications:</strong> messages to support, feedback, and other communications</li>
                </ul>

                <p><strong>B. Information Collected Automatically</strong></p>
                <ul>
                  <li><strong>Device and usage data:</strong> IP address, browser type, device identifiers, pages viewed, timestamps, referring URLs</li>
                  <li><strong>Logs and diagnostics</strong> used for security and troubleshooting</li>
                </ul>

                <p><strong>C. Cookies and Similar Technologies</strong></p>
                <ul>
                  <li>keep you logged in</li>
                  <li>remember preferences</li>
                  <li>understand usage and improve the Service</li>
                </ul>

                <h4>2) How We Use Information</h4>
                <ul>
                  <li>provide, maintain, and improve the Service</li>
                  <li>create and manage accounts and profiles</li>
                  <li>enable community features (search, profile viewing, messaging, forums)</li>
                  <li>process uploads and display content you choose to share</li>
                  <li>send service-related messages (e.g., account verification, password resets, security alerts)</li>
                  <li>send announcements or newsletters (where applicable and permitted)</li>
                  <li>monitor, prevent, and address fraud, abuse, and security issues</li>
                  <li>comply with legal obligations</li>
                </ul>

                <h4>3) How We Share Information</h4>
                <p><strong>A. With Other Users (Community Visibility)</strong></p>
                <ul>
                  <li>your name, camp role, and profile details you provide</li>
                  <li>photos/posts you upload or share</li>
                  <li>messages you send to other users (visible to recipients)</li>
                </ul>
                <p><strong>Important:</strong> Please do not share information you do not want other members to see.</p>

                <p><strong>B. With Service Providers</strong></p>
                <p>
                  We may share information with vendors who help operate the Service (hosting, databases, storage, email delivery, analytics).
                </p>

                <p><strong>C. For Legal, Safety, and Security Reasons</strong></p>
                <ul>
                  <li>comply with law, regulation, or legal process</li>
                  <li>enforce our Terms of Service</li>
                  <li>protect the rights, safety, and security of the Service, our users, or others</li>
                  <li>prevent fraud or abuse</li>
                </ul>

                <p><strong>D. Business Transfers</strong></p>
                <p>If we’re involved in a merger, acquisition, financing, or sale of assets, your information may be transferred.</p>

                <h4>4) Your Choices and Rights</h4>
                <p><strong>A. Edit Your Information</strong> — You can update many profile details through your settings.</p>
                <p><strong>B. Delete Your Account</strong> — Request deletion at <a href="mailto:support@pondbridge.co">support@pondbridge.co</a>.</p>
                <p><strong>C. Email Preferences</strong> — You can opt out of non-essential emails. We may still send essential service emails.</p>

                <h4>5) Data Retention</h4>
                <p>We retain information as long as needed for the Service and legitimate business purposes.</p>

                <h4>6) Security</h4>
                <p>We use reasonable safeguards, but no system is 100% secure.</p>

                <h4>7) Children’s Privacy</h4>
                <p>The Service is intended for users 14 years of age or older.</p>

                <h4>8) International Users</h4>
                <p>Your information may be transferred to and processed in the United States or other jurisdictions.</p>

                <h4>9) Third-Party Links</h4>
                <p>We are not responsible for third-party privacy practices.</p>

                <h4>10) Changes</h4>
                <p>We may update this Privacy Policy from time to time.</p>

                <h4>11) Contact</h4>
                <p>Email: <a href="mailto:support@pondbridge.co">support@pondbridge.co</a></p>

                <hr style={{ margin: "16px 0" }} />

                <h3>Terms of Service (Your Camp Alumni Network)</h3>
                <p><strong>Last Updated:</strong> January 5, 2026</p>

                <h4>1) Eligibility</h4>
                <p>You must be at least 14 years old to use the Service.</p>

                <h4>2) Accounts and Security</h4>
                <ul>
                  <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
                  <li>You are responsible for all activity that occurs under your account.</li>
                  <li>You agree to provide accurate information and keep it updated.</li>
                  <li>We may suspend or terminate accounts for violations or security reasons.</li>
                </ul>

                <h4>3) Community Nature of the Service</h4>
                <ul>
                  <li>other users may be able to view your profile information and content you share</li>
                  <li>you should not post information you do not want other members to see</li>
                </ul>

                <h4>4) User Content</h4>
                <p><strong>A. Your Content</strong> — You retain ownership of your User Content.</p>
                <p><strong>B. License</strong> — You grant a license to host/display your content solely to operate and improve the Service.</p>
                <p><strong>C. Responsibilities</strong> — You must have rights to submit content and not violate laws/rights.</p>

                <h4>5) Prohibited Conduct</h4>
                <ul>
                  <li>harass, bully, threaten, or abuse others</li>
                  <li>impersonate any person or misrepresent affiliation</li>
                  <li>post unlawful, defamatory, hateful, or sexually explicit content</li>
                  <li>upload malware or disrupt the Service</li>
                  <li>scrape or harvest data without permission</li>
                  <li>spam or unsolicited promotions</li>
                  <li>access accounts/data without permission</li>
                  <li>share someone else’s personal information without permission</li>
                </ul>

                <h4>6) Moderation</h4>
                <p>We may review/remove content and enforce these Terms.</p>

                <h4>7) Intellectual Property</h4>
                <p>The Service’s design/branding/software is owned by us or licensors.</p>

                <h4>8) Copyright Complaints</h4>
                <p>Email: <a href="mailto:support@pondbridge.co">support@pondbridge.co</a></p>

                <h4>9) Disclaimers</h4>
                <p><strong>THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.”</strong></p>

                <h4>10) Limitation of Liability</h4>
                <p><strong>MAX LIABILITY: $100 OR AMOUNT PAID IN LAST 12 MONTHS (WHICHEVER IS GREATER).</strong></p>

                <h4>11) Governing Law</h4>
                <p>Commonwealth of Massachusetts.</p>

                <h4>12) Contact</h4>
                <p>Email: <a href="mailto:support@pondbridge.co">support@pondbridge.co</a></p>
              </div>
            </details>
          </div>
        </div>

      </div>
    </section>
  );

  return (
    <div className="wizard1 wizard1--create">
      <Navbar1 />
      <main className="wizard1-main">
        <div className="wizard1-container">
          <h1 className="wizard1-title">Create Profile</h1>
          <Stepper activeStep={step} canStepNavigate={canNavigateToStep} onStepClick={onStepClick} />

          {errorSummary.length > 0 && (
            <div className="wizard1-error-summary" role="alert" aria-live="polite">
              <p>Please fix these fields before continuing:</p>
              <ul>
                {errorSummary.map((item) => (
                  <li key={item.key}>
                    <button type="button" className="wizard1-btn-text" onClick={() => goToField(item.fieldId)}>
                      {item.label}: {item.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 0 ? Step1 : step === 1 ? Step2 : step === 2 ? Step3 : Step4}

          <div className="wizard1-actions">
            <button className="wizard1-btn-secondary" onClick={onSaveExit} disabled={submitting || resumeBusy}>
              Save & Exit
            </button>

            <div className="wizard1-actions-right">
              {step > 0 && (
                <button className="wizard1-btn-secondary" onClick={onBack} disabled={submitting || resumeBusy}>
                  Back
                </button>
              )}

              <button className="wizard1-btn-primary" onClick={onNext} disabled={submitting || resumeBusy}>
                {step < 3 ? "Next" : (submitting ? "Finishing..." : "Finish")}
              </button>
            </div>
          </div>

          {resumeReview.open && (
            <div className="wizard1-review-backdrop" role="presentation" onClick={closeResumeReview}>
              <div
                className="wizard1-review-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Review resume autofill changes"
                onClick={(e) => e.stopPropagation()}
              >
                <h3>Review Resume Changes</h3>
                <p className="wizard1-hint">
                  We found {resumeReview.changedCount} update{resumeReview.changedCount === 1 ? "" : "s"} from your resume.
                </p>

                {resumeReview.groups.map((group) => (
                  <section key={group.title} className="wizard1-review-group">
                    <h4>{group.title}</h4>
                    {group.items.map((item) => (
                      <div key={`${group.title}-${item.label}`} className={`wizard1-review-item ${item.changed ? "is-changed" : ""}`}>
                        <div className="wizard1-review-item-head">
                          <span>{item.label}</span>
                          {item.changed && <strong>Updated</strong>}
                        </div>
                        <div className="wizard1-review-values">
                          <p><strong>Current:</strong> {item.from}</p>
                          <p><strong>Resume:</strong> {item.to}</p>
                        </div>
                      </div>
                    ))}
                  </section>
                ))}

                {resumeReview.groups.length === 0 && (
                  <p className="wizard1-hint">No new details were extracted from this resume.</p>
                )}

                <div className="wizard1-review-actions">
                  <button type="button" className="wizard1-btn-secondary" onClick={closeResumeReview}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="wizard1-btn-primary"
                    disabled={resumeReview.changedCount === 0}
                    onClick={applyResumeChanges}
                  >
                    Apply changes
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
