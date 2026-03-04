// src/pages/PublicProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import coverPhoto from "../assets/profile-cover.jpg";
import CedarBackground from "../components/CedarBackground";
import AutoFitText from "../components/AutoFitText";
import { API_BASE } from "../lib/api";
import { authHeaders, displayName, initialsOf, avatarUrl, getToken } from "../lib/helpers.js";
import "./my-profile.css";
import { MapPin, Mail, Phone, Linkedin, Instagram, Facebook } from "lucide-react";

function safeUrl(u) { if (!u) return ""; return /^https?:\/\//i.test(u) ? u : `https://${u}`; }
function telHref(s = "") { return `tel:${String(s).replace(/[^\d+]/g, "")}`; }

// ✅ City/State formatting (fixes "City , ST" even if city has trailing spaces)
function normalizeCity(s = "") { return (s || "").replace(/\s+/g, " ").trim(); }
function splitCityState(value = "") {
  const parts = String(value || "")
    .split(",")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (!parts.length) return { city: "", state: "" };
  return { city: parts[0] || "", state: (parts[1] || "").toUpperCase() };
}

function normalizeRoleChips(src = {}) {
  const roleAtCamp = String(src.roleAtCamp || "").trim();
  const rawRoles = Array.isArray(src.roles) ? src.roles : src.roles ? [src.roles] : [];
  const socialRoles = Array.isArray(src?.social?.roles)
    ? src.social.roles
    : Array.isArray(src?.socials?.roles)
    ? src.socials.roles
    : [];
  const ordered = [];
  const seen = new Set();

  const add = (value = "") => {
    const role = String(value || "").trim();
    const key = role.toLowerCase();
    if (!role || seen.has(key)) return;
    seen.add(key);
    ordered.push(role);
  };

  add(roleAtCamp);
  add(src.role);
  rawRoles.forEach((role) => add(role));
  socialRoles.forEach((role) => add(role));
  return ordered;
}

function normalizeYearStints(value = null, { includeAgeGroup = false } = {}) {
  const normalizeYear = (raw = "") => {
    const year = String(raw || "").trim();
    return /^\d{4}$/.test(year) ? year : "";
  };
  const normalizeAgeGroup = (raw = "") => String(raw || "").trim();

  const stints = [];
  const pushStint = (entry = {}) => {
    const startYear = normalizeYear(entry.startYear || entry.firstYear || entry.yearStart || "");
    const endYear = normalizeYear(entry.endYear || entry.lastYear || entry.yearEnd || "");
    if (!startYear && !endYear) return;
    const start = startYear || endYear;
    const end = endYear || startYear;
    if (!start || !end) return;
    const startNum = Number(start);
    const endNum = Number(end);
    const normalized = {
      startYear: String(Math.min(startNum, endNum)),
      endYear: String(Math.max(startNum, endNum))
    };
    if (includeAgeGroup) {
      const ageGroup = normalizeAgeGroup(entry.ageGroup || entry.group || "");
      if (ageGroup) normalized.ageGroup = ageGroup;
    }
    stints.push(normalized);
  };

  if (Array.isArray(value)) {
    value.forEach((entry) => pushStint(entry));
  } else if (value && typeof value === "object") {
    if (Array.isArray(value.stints)) {
      value.stints.forEach((entry) => pushStint(entry));
    } else if (value.firstYear || value.lastYear || value.startYear || value.endYear) {
      pushStint(value);
    }
  }

  const normalizedStints = stints.sort(
    (a, b) => Number(a.startYear) - Number(b.startYear) || Number(a.endYear) - Number(b.endYear)
  );

  if (includeAgeGroup && value && typeof value === "object" && normalizedStints.length) {
    const firstGroup = normalizeAgeGroup(value.firstGroup || "");
    const lastGroup = normalizeAgeGroup(value.lastGroup || "");
    if (firstGroup && !normalizedStints[0].ageGroup) {
      normalizedStints[0].ageGroup = firstGroup;
    }
    if (lastGroup && !normalizedStints[normalizedStints.length - 1].ageGroup) {
      normalizedStints[normalizedStints.length - 1].ageGroup = lastGroup;
    }
  }

  return normalizedStints;
}

function formatYearStint(stint = {}) {
  const startYear = String(stint.startYear || "").trim();
  const endYear = String(stint.endYear || "").trim();
  if (!startYear && !endYear) return "";
  if (startYear && endYear && startYear !== endYear) return `${startYear} • ${endYear}`;
  return startYear || endYear;
}

function fmtLocation(p) {
  const city = normalizeCity(p?.city || "");
  const country = String(p?.country || "").trim();
  const state = String(p?.state || "").trim().toUpperCase();
  const region = String(p?.region || "").trim();

  const isUS = !country || country.toLowerCase() === "united states" || country.toLowerCase() === "usa";

  // US format: City, ST
  if (isUS) return [city, state].filter(Boolean).join(", ");

  // Intl format: City, Region, Country (region optional)
  return [city, region, country].filter(Boolean).join(", ");
}

function educationSortValue(year = "") {
  const raw = String(year || "").trim().toLowerCase();
  if (!raw) return -1;
  if (/(present|current|ongoing|now)/i.test(raw)) return Number.MAX_SAFE_INTEGER;
  const matches = raw.match(/\b(19|20)\d{2}\b/g) || [];
  if (!matches.length) return -1;
  return Math.max(...matches.map((y) => Number(y) || -1));
}

function sortEducationNewest(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((e, i) => ({ e, i, y: educationSortValue(e?.year) }))
    .sort((a, b) => (b.y - a.y) || (a.i - b.i))
    .map(({ e }) => e);
}



function topCurrentJob(u = {}) {
  const j = (u.currentJobs || [])[0];
  return j ? [j.role, j.company].filter(Boolean).join(" • ") : "";
}
function normalizeProfile(src = {}) {
  const split = splitCityState(src.cityState || "");
  const normalizedRoles = normalizeRoleChips(src);
  const socialSource = src.social || src.socials || {};
  const collegeMajors = Array.isArray(src.collegeMajors)
    ? src.collegeMajors
    : Array.isArray(socialSource.collegeMajors)
    ? socialSource.collegeMajors
    : Array.isArray(socialSource.educationMajors)
    ? socialSource.educationMajors
    : [];
  const nickname = String(src.nickname || socialSource.nickname || socialSource.campNickname || "").trim();
  const normalizedEducation =
    Array.isArray(src.education) && src.education.length
      ? src.education
      : Array.isArray(src.colleges)
      ? src.colleges.map((college, idx) => ({
          college: String(college || "").trim(),
          year: String(src.collegeYears?.[idx] || "").trim(),
          major: String(collegeMajors?.[idx] || "").trim()
        }))
      : [];
  const camperYearsSource =
    src.camperYears && typeof src.camperYears === "object"
      ? src.camperYears
      : socialSource?.camperYears && typeof socialSource.camperYears === "object"
      ? socialSource.camperYears
      : {};
  const staffYearsSource =
    src.staffYears && typeof src.staffYears === "object"
      ? src.staffYears
      : socialSource?.staffYears && typeof socialSource.staffYears === "object"
      ? socialSource.staffYears
      : {};
  return {
    id: src._id || src.id || "",
    _id: src._id || src.id || "",
    userId: src.userId || src.authUserId || "",
    firstName: src.firstName || "",
    lastName: src.lastName || "",
    nickname,
    email: src.email || src.emails?.[0] || "",
    phone: src.phone || src.phones?.[0] || "",
    city: src.city || split.city,
    state: src.state || split.state,
    country: src.country || "",
    region: src.region || "",
    roleAtCamp: String(src.roleAtCamp || normalizedRoles[0] || "").trim(),
    roles: normalizedRoles,
    uploads: src.uploads || { photoUrl: src.photoUrl || src.avatarUrl || "" },
    camperYearStints: normalizeYearStints(camperYearsSource, { includeAgeGroup: true }),
    staffYearStints: normalizeYearStints(staffYearsSource),
    highSchool: src.highSchool || "",
    education: normalizedEducation,
    industry: src.industry || "",
    currentJobs: src.currentJobs || [],
    pastJobs: src.pastJobs || [],
    social: socialSource,
  };
}

/** === Photos mosaic === */
function PhotosMosaic({ userId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let abort = false;
    async function run() {
      const ownerId = String(userId || "").trim();
      if (!ownerId) return;
      try {
        setLoading(true);
        const qs = new URLSearchParams({
          sort: "new",
          ownerId,
          limit: "100",
        });
        const r = await fetch(`${API_BASE}/photos?${qs}`, { headers: authHeaders() });
        if (!r.ok) throw new Error("photos fetch failed");
        const data = await r.json();
        if (!abort) setItems(data.items || []);
      } catch (e) {
        console.error(e);
      } finally {
        if (!abort) setLoading(false);
      }
    }
    run();
    return () => { abort = true; };
  }, [userId]);

  return (
    <aside className="p1-card p1-photos-card">
      <h2 className="p1-h2">Photos Posted</h2>
      {loading && <div className="p1-empty">Loading…</div>}
      {!loading && items.length === 0 && <div className="p1-empty">No photos yet.</div>}
      {!!items.length && (
        <div className="p1-mosaic">
          {items.map((p) => (
            <Link
              key={p._id || p.id}
              to="/photo-stream"
              className="p1-mosaic-link"
              title={p.caption || "View in Photo Stream"}
            >
              <img
                className="p1-mosaic-img"
                src={p.thumbUrl || p.imageUrl}
                alt={p.caption || "Camp photo"}
                loading="lazy"
              />
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}

/* ===== Related Profiles ===== */
function RelatedProfilesCard({ targetUserId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        if (!targetUserId) {
          if (!abort) {
            setItems([]);
            setLoading(false);
          }
          return;
        }
        setLoading(true);
        const qs = new URLSearchParams({ forUserId: String(targetUserId), limit: "5" });
        const r = await fetch(`${API_BASE}/suggestions?${qs.toString()}`, { headers: authHeaders() });
        if (!r.ok) throw new Error("suggestions fetch failed");
        const data = await r.json();
        if (!abort) setItems((data.items || []).slice(0, 5));
      } catch (e) {
        console.error(e);
      } finally {
        if (!abort) setLoading(false);
      }
    })();
    return () => { abort = true; };
  }, [targetUserId]);

  return (
    <aside className="p1-card p1-suggest-card">
      <h2 className="p1-h2">Related Profiles</h2>
      {loading && <div className="p1-empty">Loading…</div>}
      {!loading && items.length === 0 && <div className="p1-empty">No related profiles yet.</div>}
      {!!items.length && (
        <ul className="p1-suggest-list">
          {items.map(u => {
            const id = String(u._id || u.id || u.profileId || u.userId || "").trim();
            if (!id || id === "undefined" || id === "null") return null;
            const name = displayName(u);
            const job  = topCurrentJob(u);
            const url  = avatarUrl(u);
            const initials = initialsOf(u.firstName, u.lastName, u.nickname);
            return (
              <li key={id} className="p1-suggest-item">
                <Link to={`/profile/${id}`} className="p1-suggest-avatar" aria-label={`Open ${name}'s profile`}>
                  {url ? (
                    <img className="p1-suggest-img" src={url} alt={name} />
                  ) : (
                    <div className="p1-suggest-fallback">{initials || "?"}</div>
                  )}
                </Link>
                <div className="p1-suggest-main">
                  <Link to={`/profile/${id}`} className="p1-suggest-name">{name}</Link>
                  <div className="p1-suggest-sub">{job}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

export default function PublicProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const preload = location.state?.preload || null;

  const [profile, setProfile] = useState(preload ? normalizeProfile(preload) : null);
  const [loading, setLoading] = useState(!preload);
  const [error, setError] = useState("");
  const [avatarErrored, setAvatarErrored] = useState(false);
  const profileId = String(id || "").trim();
  const hasValidProfileId = Boolean(
    profileId && profileId !== "undefined" && profileId !== "null"
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasValidProfileId) {
        if (!cancelled) {
          setProfile(null);
          setError("Unable to load this profile.");
          setLoading(false);
        }
        return;
      }
      try {
        setLoading(true);
        setError("");
        const token = getToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${API_BASE}/search/user/${encodeURIComponent(profileId)}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setProfile(normalizeProfile(data?.user || data?.profile || data));
      } catch {
        if (!cancelled) setError("Unable to load this profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [hasValidProfileId, profileId]);

  const fullName = useMemo(() => {
    if (!profile) return "";
    const first = profile.firstName || "";
    const nick  = profile.nickname ? `"${profile.nickname}"` : "";
    const last  = profile.lastName || "";
    return [first, nick, last].filter(Boolean).join(" ");
  }, [profile]);
  const educationList = useMemo(
    () => sortEducationNewest(profile?.education || []),
    [profile?.education]
  );
  const profilePhotoUrl = useMemo(() => avatarUrl(profile || {}), [profile]);
  const profileInitials = useMemo(
    () => initialsOf(profile?.firstName, profile?.lastName, profile?.nickname) || "?",
    [profile?.firstName, profile?.lastName, profile?.nickname]
  );

  useEffect(() => {
    setAvatarErrored(false);
  }, [profilePhotoUrl]);

  if (loading && !profile) {
    return (
      <div style={{ position: "relative", minHeight: "100vh" }}>
        <CedarBackground behavior="scroll" opacity={0.9} fixed zIndex={-1} />
        <div className="profile1" style={{ position: "relative", zIndex: 1 }}>
          <main className="profile1-main">
            <div className="profile1-container">
              <div className="profile1-loading">Loading profile…</div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ position: "relative", minHeight: "100vh" }}>
        <CedarBackground behavior="scroll" opacity={0.9} fixed zIndex={-1} />
        <div className="profile1" style={{ position: "relative", zIndex: 1 }}>
          <main className="profile1-main">
            <div className="profile1-container">
              <div className="profile1-empty">
                {error || "Profile not found."}
                <button className="profile1-btn" onClick={() => navigate("/")}>Go home</button>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const jobs = [
    ...(profile.currentJobs || []).map(j => ({ ...j, _type: "current" })),
    ...(profile.pastJobs || []).map(j => ({ ...j, _type: "past" })),
  ].filter(j => j && (j.role || j.company || j.years));
  const roleChips = profile.roles?.length
    ? profile.roles
    : profile.roleAtCamp
      ? [profile.roleAtCamp]
      : [];

  const targetId = profile.id || profile._id;

  const camperStints = Array.isArray(profile.camperYearStints) ? profile.camperYearStints : [];
  const staffStints = Array.isArray(profile.staffYearStints) ? profile.staffYearStints : [];

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <CedarBackground behavior="scroll" opacity={0.9} fixed zIndex={-1} />

      <div className="profile1" style={{ position: "relative", zIndex: 1 }}>
        <main className="profile1-main">
          <div className="profile1-container">
            <div className="profile1-grid">
              {/* LEFT */}
              <div className="p1-leftcol">
                <aside className="p1-card p1-card-profile p1-left with-cover">
                  <div className="p1-cover">
                    <img className="p1-cover-img" src={coverPhoto} alt="" />
                    <div className="p1-cover-overlay" />
                  </div>

                  <div className="p1-avatar-shell">
                    <div className="p1-avatar-ring">
                      <div className="p1-avatar-clip">
                        {profilePhotoUrl && !avatarErrored ? (
                          <img
                            className="p1-avatar-img"
                            src={profilePhotoUrl}
                            alt={fullName || "Profile"}
                            onError={() => setAvatarErrored(true)}
                          />
                        ) : (
                          <div className="p1-avatar-fallback" aria-hidden="true">
                            {profileInitials}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p1-fixed-inner">
                    <h1 className="p1-name">{fullName || "Unnamed Alum"}</h1>

                    {(profile.city || profile.state) && (
                      <AutoFitText as="div" className="p1-sub" min={12} shrinkOnly={true} weight={500}>
                        <span className="p1-inline"><MapPin size={16} /> {fmtLocation(profile)}</span>
                      </AutoFitText>
                    )}
                  </div>

                  {(roleChips.length || profile.industry) ? (
                    <>
                      <div className="p1-roles">
                        {roleChips.map((r) => (
                          <span key={r} className="p1-role-chip p1-camp-role-chip">{r}</span>
                        ))}
                      </div>
                      {profile.industry && (
                        <div className="p1-industry-row">
                          <span className="p1-role-chip p1-industry-chip">{profile.industry}</span>
                        </div>
                      )}
                    </>
                  ) : null}

                  <div className="p1-actions">
                    <button
                      className="profile1-btn"
                      onClick={() => navigate(`/chat-rooms?to=${encodeURIComponent(targetId)}`)}
                    >
                      Message
                    </button>
                  </div>
                </aside>

                <RelatedProfilesCard targetUserId={targetId} />
              </div>

              {/* CENTER */}
              <section className="p1-center">
                <div className="p1-card p1-exp-card">
                  <h2 className="p1-h2">Experience</h2>
                  <div className="p1-timeline">
                    {jobs.length ? jobs.map((job, idx) => (
                      <div key={idx} className={`p1-tl-item ${job._type === "current" ? "is-current" : ""}`}>
                        <div className="p1-job-title">{job.role}</div>
                        <div className="p1-job-sub">
                          {[job.company, job.years].filter(Boolean).join(" • ")}
                        </div>
                      </div>
                    )) : <div className="p1-empty">No experience added yet.</div>}
                  </div>
                </div>

                <div className="p1-card p1-edu-card">
                  <h2 className="p1-h2">Education</h2>
                  <div className="p1-edu-grid">
                    {educationList.map((e, i) => (
                      <div key={i} className="p1-edu-item">
                        <div className="p1-edu-college">{e.college || "College"}</div>
                        <div className="p1-edu-sub">{[e.major, e.year].filter(Boolean).join(" • ")}</div>
                      </div>
                    ))}
                    {profile.highSchool && (
                      <div className="p1-edu-item">
                        <div className="p1-edu-college">{profile.highSchool}</div>
                        <div className="p1-edu-sub">High School</div>
                      </div>
                    )}
                    {!profile.highSchool && educationList.length === 0 && (
                      <div className="p1-empty">No education added yet.</div>
                    )}
                  </div>
                </div>
              </section>

              {/* RIGHT */}
              <div className="p1-right">
                {/* ✅ Camper Years ABOVE Social */}
                <aside className="p1-card p1-camper-card">
                  <h2 className="p1-h2">Camper Years</h2>
                  {camperStints.length === 0 ? (
                    <div className="p1-empty">Not added yet.</div>
                  ) : (
                    <div className="p1-edu-grid">
                      {camperStints.map((stint, idx) => (
                        <div key={`camper-stint-${idx}`} className="p1-edu-item p1-year-item">
                          <div className="p1-year-main">{formatYearStint(stint)}</div>
                          {stint?.ageGroup ? <div className="p1-year-meta">{stint.ageGroup}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </aside>

                {staffStints.length > 0 && (
                  <aside className="p1-card p1-staff-card">
                    <h2 className="p1-h2">Staff Years</h2>
                    <div className="p1-edu-grid">
                      {staffStints.map((stint, idx) => (
                        <div key={`staff-stint-${idx}`} className="p1-edu-item p1-year-item">
                          <div className="p1-year-main">{formatYearStint(stint)}</div>
                        </div>
                      ))}
                    </div>
                  </aside>
                )}

                <aside className="p1-card p1-social-card">
                  <h2 className="p1-h2">Social</h2>
                  <div className="p1-social">
                    {profile.social?.linkedin && (
                      <a className="p1-social-link" href={safeUrl(profile.social.linkedin)} target="_blank" rel="noopener noreferrer">
                        <Linkedin className="p1-social-icon" /> LinkedIn
                      </a>
                    )}
                    {profile.social?.instagram && (
                      <a className="p1-social-link" href={safeUrl(profile.social.instagram)} target="_blank" rel="noopener noreferrer">
                        <Instagram className="p1-social-icon" /> Instagram
                      </a>
                    )}
                    {profile.social?.facebook && (
                      <a className="p1-social-link" href={safeUrl(profile.social.facebook)} target="_blank" rel="noopener noreferrer">
                        <Facebook className="p1-social-icon" /> Facebook
                      </a>
                    )}
                    {!profile.social?.linkedin && !profile.social?.instagram && !profile.social?.facebook && (
                      <div className="p1-empty">No social links yet.</div>
                    )}
                  </div>
                </aside>

                <aside className="p1-card p1-contact-card">
                  <h2 className="p1-h2">Contact</h2>
                  <div className="p1-contact">
                    {profile.email && (
                      <a className="p1-contact-link" href={`mailto:${profile.email}`}>
                        <Mail className="p1-contact-icon" size={16} />
                        <span className="p1-contact-text">{profile.email}</span>
                      </a>
                    )}
                    {profile.phone && (
                      <a className="p1-contact-link" href={telHref(profile.phone)}>
                        <Phone className="p1-contact-icon" size={16} />
                        <span className="p1-contact-text">{profile.phone}</span>
                      </a>
                    )}
                  </div>
                </aside>

                <PhotosMosaic userId={profile.userId || targetId} />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
