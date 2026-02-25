// src/pages/PublicProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import defaultProfile from "../assets/default-profile.png";
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
  rawRoles.forEach((role) => add(role));
  return ordered;
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
  return {
    id: src._id || src.id || "",
    _id: src._id || src.id || "",
    firstName: src.firstName || "",
    lastName: src.lastName || "",
    nickname: src.nickname || "",
    email: src.email || src.emails?.[0] || "",
    phone: src.phone || src.phones?.[0] || "",
    city: src.city || split.city,
    state: src.state || split.state,
    country: src.country || "",
    region: src.region || "",
    roleAtCamp: String(src.roleAtCamp || normalizedRoles[0] || "").trim(),
    roles: normalizedRoles,
    uploads: src.uploads || { photoUrl: src.photoUrl || src.avatarUrl || "" },
    camperYears: src.camperYears || {}, // ✅ NEW
    highSchool: src.highSchool || "",
    education: src.education || [],
    industry: src.industry || "",
    currentJobs: src.currentJobs || [],
    pastJobs: src.pastJobs || [],
    social: src.social || src.socials || {},
  };
}

/** === Photos mosaic === */
function PhotosMosaic({ userId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let abort = false;
    async function run() {
      if (!userId) return;
      try {
        setLoading(true);
        const qs = new URLSearchParams({
          sort: "new",
          ownerId: String(userId),
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
            const id = u._id || u.id;
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const token = getToken();
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${API_BASE}/search/user/${encodeURIComponent(id)}`, { headers });
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
  }, [id]);

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

  const cy = profile.camperYears || {};
  const cyFirst = [cy.firstYear, cy.firstGroup].filter(Boolean).join(" • ");
  const cyLast  = [cy.lastYear, cy.lastGroup].filter(Boolean).join(" • ");

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
                        <img
                          className="p1-avatar-img"
                          src={profile.uploads?.photoUrl || defaultProfile}
                          alt={fullName || "Profile"}
                        />
                    </div>
                  </div>

                  <div className="p1-fixed-inner">
                    <AutoFitText as="h1" className="p1-name" min={18} shrinkOnly={true} weight={800}>
                      {fullName || "Unnamed Alum"}
                    </AutoFitText>

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
                          <span key={r} className="p1-role-chip">{r}</span>
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
                  {(!cyFirst && !cyLast) ? (
                    <div className="p1-empty">Not added yet.</div>
                  ) : (
                    <div className="p1-edu-grid">
                      {cyFirst && (
                        <div className="p1-edu-item">
                          <div className="p1-edu-college">First Year</div>
                          <div className="p1-edu-sub">{cyFirst}</div>
                        </div>
                      )}
                      {cyLast && (
                        <div className="p1-edu-item">
                          <div className="p1-edu-college">Last Year</div>
                          <div className="p1-edu-sub">{cyLast}</div>
                        </div>
                      )}
                    </div>
                  )}
                </aside>

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

                <PhotosMosaic userId={targetId} />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
