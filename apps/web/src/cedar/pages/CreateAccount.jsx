import { useMemo, useRef, useState, useEffect } from "react";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveStaffRoleOptions } from "../../lib/campLabels.js";
import Navbar1 from "../components/Navbar1";
import { INDUSTRIES } from "@pondbridge/shared";
const industryOptions = INDUSTRIES;

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
];

/** Simple multi-select dropdown with checkboxes */
function MultiSelect({ label, placeholder, options, selected, setSelected, name }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const toggle = (opt) => {
    setSelected((list) =>
      list.includes(opt) ? list.filter((v) => v !== opt) : [...list, opt]
    );
  };

  return (
    <div className="create1-field" ref={ref}>
      <label className="create1-label" htmlFor={name}>{label}</label>
      <div
        id={name}
        className={`create1-mselect ${open ? "is-open" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((o) => !o);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected.length === 0 ? (
          <span className="create1-placeholder">{placeholder}</span>
        ) : (
          <div className="create1-tags">
            {selected.map((tag) => (
              <span key={tag} className="create1-tag" onClick={(e) => { e.stopPropagation(); toggle(tag); }}>
                {tag} <span className="create1-tag-x">×</span>
              </span>
            ))}
          </div>
        )}
        <span className="create1-caret">▾</span>
      </div>

      {open && (
        <div className="create1-menu" role="listbox" aria-label={label}>
          {options.map((opt) => (
            <label key={opt} className="create1-option">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
              />
              <span>{opt}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              className="create1-btn-text create1-menu-clear"
              onClick={(e) => {
                e.stopPropagation();
                setSelected([]);
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CreateAccount() {
  const { tenant } = useTenant();
  const staffRoleOptions = useMemo(() => resolveStaffRoleOptions(tenant), [tenant]);

  // Uploads
  const [photo, setPhoto] = useState(null);
  const [resumeFiles, setResumeFiles] = useState([]); // PDFs (max 2)
  const photoInputRef = useRef(null);
  const pdfInputRef = useRef(null);

  // Personal
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName]   = useState("");
  const [nickname, setNickname]   = useState("");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [phone, setPhone]         = useState("");
  const [city, setCity]           = useState("");
  const [stateUS, setStateUS]     = useState("");
  const [roles, setRoles]         = useState([]); // multi-select

  // Education
  const [highSchool, setHighSchool] = useState("");
  const [colleges, setColleges] = useState([{ college: "", major: "", gradYear: "" }]);

  // Industry (multi-select)
  const [industries, setIndustries] = useState([]);

  // Experience (keep simple for now; we’ll restructure later if needed)
  const [currentJobs, setCurrentJobs] = useState([{ role: "", company: "", years: "" }]);
  const [pastJobs, setPastJobs]       = useState([]);

  // Social
  const [linkedin, setLinkedin]   = useState("");
  const [instagram, setInstagram] = useState("");
  const [facebook, setFacebook]   = useState("");

  // Validation
  const [errors, setErrors] = useState({});
  const [saveStatus, setSaveStatus] = useState("");

  const onPickPhoto = (e) => {
    const f = e.target.files?.[0];
    if (f) setPhoto(f);
  };
  const removePhoto = () => setPhoto(null);

  const onPickPDF = (e) => {
    const files = Array.from(e.target.files || []);
    const pdfs = files.filter(f => f.type === "application/pdf").slice(0, 2 - resumeFiles.length);
    setResumeFiles((prev) => [...prev, ...pdfs]);
  };
  const onDropPDF = (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    const pdfs = files.filter(f => f.type === "application/pdf").slice(0, 2 - resumeFiles.length);
    setResumeFiles((prev) => [...prev, ...pdfs]);
  };
  const removeResume = (i) => {
    setResumeFiles((list) => list.filter((_, idx) => idx !== i));
  };

  const updateCollege = (i, k, v) =>
    setColleges(list => list.map((c, idx) => idx === i ? { ...c, [k]: v } : c));
  const addCollege = () => setColleges(list => [...list, { college: "", major: "", gradYear: "" }]);
  const removeCollege = (i) => setColleges(list => list.filter((_, idx) => idx !== i));

  const updateJob = (where, i, k, v) => {
    const setter = where === "current" ? setCurrentJobs : setPastJobs;
    const list   = where === "current" ? currentJobs   : pastJobs;
    setter(list.map((j, idx) => (idx === i ? { ...j, [k]: v } : j)));
  };
  const addJob = (where) => {
    const setter = where === "current" ? setCurrentJobs : setPastJobs;
    setter((list) => [...list, { role: "", company: "", years: "" }]);
  };
  const removeJob = (where, i) => {
    const setter = where === "current" ? setCurrentJobs : setPastJobs;
    setter((list) => list.filter((_, idx) => idx !== i));
  };
  const moveJob = (fromWhere, i) => {
    const fromList  = fromWhere === "current" ? currentJobs : pastJobs;
    const toList    = fromWhere === "current" ? pastJobs    : currentJobs;
    const fromSet   = fromWhere === "current" ? setCurrentJobs : setPastJobs;
    const toSet     = fromWhere === "current" ? setPastJobs    : setCurrentJobs;
    const job = fromList[i];
    fromSet(fromList.filter((_, idx) => idx !== i));
    toSet([...toList, job]);
  };

  const validate = () => {
    const e = {};
    if (!firstName.trim()) e.firstName = "First name is required.";
    if (!lastName.trim())  e.lastName  = "Last name is required.";
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) e.email = "Enter a valid email.";
    if (password.length < 8) e.password = "Password must be at least 8 characters.";
    if (!city.trim()) e.city = "City is required.";
    if (!stateUS) e.stateUS = "Select a state.";
    // Grad year validation
    colleges.forEach((c, i) => {
      if (c.gradYear && !/^(19|20)\d{2}$/.test(c.gradYear)) {
        e[`college-${i}-gradYear`] = "Use a 4-digit year.";
      }
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSave = (e) => {
    e.preventDefault();
    setSaveStatus("");
    if (!validate()) return;

    const payload = {
      personal: {
        firstName, lastName, nickname, email, password, phone, city, state: stateUS, roles
      },
      education: { highSchool, colleges },
      industries,
      experience: { current: currentJobs, past: pastJobs },
      social: { linkedin, instagram, facebook },
      uploads: {
        photoName: photo?.name || null,
        resumePDFs: resumeFiles.map(f => f.name)
      }
    };
    console.log("CREATE PROFILE (mock save):", payload);
    setSaveStatus("Profile draft validated. This legacy mock page does not submit to the server.");
  };

  return (
    <div className="create1">
      <Navbar1 />

      <main className="create1-main">
        <div className="create1-container">
          <h1 className="create1-title">Create Profile</h1>

          {/* Top row: variable widths */}
          <div className="create1-grid create1-gap">
            {/* Photo (smaller) */}
            <section className="create1-card create1-span-4 create1-upload">
              <h2 className="create1-h2">Profile Photo</h2>
              <div className="create1-photo">
                {photo ? (
                  <img src={URL.createObjectURL(photo)} alt="Profile preview" />
                ) : (
                  <div className="create1-photo-placeholder">No photo chosen</div>
                )}
                <div className="create1-upload-actions">
                  <button
                    type="button"
                    className="create1-btn-secondary"
                    onClick={() => photoInputRef.current?.click()}
                  >
                    Choose Photo
                  </button>
                  {photo && (
                    <button type="button" className="create1-btn-text" onClick={removePhoto}>
                      Remove
                    </button>
                  )}
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={onPickPhoto}
                />
              </div>
            </section>

            {/* Résumé/LinkedIn PDF (wider) */}
            <section
              className="create1-card create1-span-8 create1-pdf"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDropPDF}
            >
              <h2 className="create1-h2">Upload Résumé / LinkedIn PDF</h2>
              <div
                className="create1-dropzone"
                onClick={() => pdfInputRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                <p>Drag & drop PDF here or click to choose</p>
                <p className="create1-hint">(PDF only • up to 2 files • max ~5MB each)</p>
              </div>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                multiple
                hidden
                onChange={onPickPDF}
              />
              {resumeFiles.length > 0 && (
                <ul className="create1-filelist">
                  {resumeFiles.map((f, i) => (
                    <li key={i} className="create1-fileitem">
                      <span>{f.name}</span>
                      <button type="button" className="create1-btn-text" onClick={() => removeResume(i)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Personal Information (mixed widths) */}
          <section className="create1-card create1-span-12">
            <h2 className="create1-h2">Personal Information</h2>

            <div className="create1-grid create1-gap">
              <div className="create1-span-6">
                <div className="create1-field">
                  <label className="create1-label" htmlFor="firstName">First Name <span className="req">*</span></label>
                  <input id="firstName" className={`create1-input ${errors.firstName ? "has-error":""}`} value={firstName} onChange={(e)=>setFirstName(e.target.value)} />
                  {errors.firstName && <p className="create1-error">{errors.firstName}</p>}
                </div>
              </div>
              <div className="create1-span-6">
                <div className="create1-field">
                  <label className="create1-label" htmlFor="lastName">Last Name <span className="req">*</span></label>
                  <input id="lastName" className={`create1-input ${errors.lastName ? "has-error":""}`} value={lastName} onChange={(e)=>setLastName(e.target.value)} />
                  {errors.lastName && <p className="create1-error">{errors.lastName}</p>}
                </div>
              </div>

              <div className="create1-span-6">
                <div className="create1-field">
                  <label className="create1-label" htmlFor="nickname">Camp Nickname</label>
                  <input id="nickname" className="create1-input" value={nickname} onChange={(e)=>setNickname(e.target.value)} />
                </div>
              </div>
              <div className="create1-span-6">
                <div className="create1-field">
                  <label className="create1-label" htmlFor="email">Email <span className="req">*</span></label>
                  <input id="email" type="email" className={`create1-input ${errors.email ? "has-error":""}`} value={email} onChange={(e)=>setEmail(e.target.value)} />
                  {errors.email && <p className="create1-error">{errors.email}</p>}
                </div>
              </div>

              <div className="create1-span-6">
                <div className="create1-field">
                  <label className="create1-label" htmlFor="password">Password <span className="req">*</span></label>
                  <input id="password" type="password" className={`create1-input ${errors.password ? "has-error":""}`} value={password} onChange={(e)=>setPassword(e.target.value)} />
                  {errors.password && <p className="create1-error">{errors.password}</p>}
                </div>
              </div>
              <div className="create1-span-6">
                <div className="create1-field">
                  <label className="create1-label" htmlFor="phone">Phone <span className="muted">(optional)</span></label>
                  <input id="phone" className="create1-input" value={phone} onChange={(e)=>setPhone(e.target.value)} />
                </div>
              </div>

              <div className="create1-span-6">
                <div className="create1-field">
                  <label className="create1-label" htmlFor="city">Current City <span className="req">*</span></label>
                  <input id="city" className={`create1-input ${errors.city ? "has-error":""}`} value={city} onChange={(e)=>setCity(e.target.value)} />
                  {errors.city && <p className="create1-error">{errors.city}</p>}
                </div>
              </div>
              <div className="create1-span-3">
                <div className="create1-field">
                  <label className="create1-label" htmlFor="stateUS">State <span className="req">*</span></label>
                  <select id="stateUS" className={`create1-input create1-select ${errors.stateUS ? "has-error":""}`} value={stateUS} onChange={(e)=>setStateUS(e.target.value)}>
                    <option value="">Select…</option>
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {errors.stateUS && <p className="create1-error">{errors.stateUS}</p>}
                </div>
              </div>

              {/* Roles: multi-select dropdown */}
              <div className="create1-span-12">
                <MultiSelect
                  label="Former/Current Role at Camp"
                  placeholder="Select roles…"
                  options={staffRoleOptions}
                  selected={roles}
                  setSelected={setRoles}
                  name="roles"
                />
              </div>
            </div>
          </section>

          {/* Education (full width) */}
          <section className="create1-card create1-span-12">
            <h2 className="create1-h2">Education</h2>
            <div className="create1-grid create1-gap">
              <div className="create1-span-12">
                <div className="create1-field">
                  <label className="create1-label" htmlFor="highSchool">High School</label>
                  <input id="highSchool" className="create1-input" value={highSchool} onChange={(e)=>setHighSchool(e.target.value)} />
                </div>
              </div>

              {colleges.map((c, i) => (
                <div key={i} className="create1-grid create1-gap create1-college-row create1-span-12">
                  <div className="create1-span-6">
                    <div className="create1-field">
                      <label className="create1-label">College</label>
                      <input className="create1-input" value={c.college} onChange={(e)=>updateCollege(i,"college",e.target.value)} />
                    </div>
                  </div>
                  <div className="create1-span-4">
                    <div className="create1-field">
                      <label className="create1-label">Major</label>
                      <input className="create1-input" value={c.major} onChange={(e)=>updateCollege(i,"major",e.target.value)} />
                    </div>
                  </div>
                  <div className="create1-span-2">
                    <div className="create1-field">
                      <label className="create1-label">Graduation Year</label>
                      <input className={`create1-input ${errors[`college-${i}-gradYear`] ? "has-error":""}`} value={c.gradYear} onChange={(e)=>updateCollege(i,"gradYear",e.target.value)} />
                      {errors[`college-${i}-gradYear`] && <p className="create1-error">{errors[`college-${i}-gradYear`]}</p>}
                    </div>
                  </div>

                  <div className="create1-span-12 create1-row-actions">
                    {colleges.length > 1 && (
                      <button type="button" className="create1-btn-text" onClick={() => removeCollege(i)}>Remove</button>
                    )}
                  </div>
                </div>
              ))}
              <div className="create1-span-12">
                <button type="button" className="create1-btn-secondary" onClick={addCollege}>
                  + Add Another College
                </button>
              </div>
            </div>
          </section>

          {/* Industry + Social (variable widths) */}
          <section className="create1-card create1-span-8">
            <h2 className="create1-h2">Industry</h2>
            <p className="create1-hint">Choose all that apply</p>
            <MultiSelect
              label="Industries"
              placeholder="Select industries…"
              options={industryOptions}
              selected={industries}
              setSelected={setIndustries}
              name="industries"
            />
            <p className="create1-selected-count">Selected: {industries.length}</p>
          </section>

          <section className="create1-card create1-span-4">
            <h2 className="create1-h2">Social Media</h2>
            <div className="create1-grid create1-gap">
              <div className="create1-span-12">
                <div className="create1-field">
                  <label className="create1-label">LinkedIn</label>
                  <input className="create1-input" value={linkedin} onChange={(e)=>setLinkedin(e.target.value)} />
                </div>
              </div>
              <div className="create1-span-12">
                <div className="create1-field">
                  <label className="create1-label">Instagram</label>
                  <input className="create1-input" value={instagram} onChange={(e)=>setInstagram(e.target.value)} />
                </div>
              </div>
              <div className="create1-span-12">
                <div className="create1-field">
                  <label className="create1-label">Facebook</label>
                  <input className="create1-input" value={facebook} onChange={(e)=>setFacebook(e.target.value)} />
                </div>
              </div>
            </div>
          </section>

          {/* Experience (full width) */}
          <section className="create1-card create1-span-12">
            <h2 className="create1-h2">Professional Experience</h2>

            <h3 className="create1-h3">Current Job(s)</h3>
            {currentJobs.map((j, i) => (
              <div key={`cur-${i}`} className="create1-grid create1-gap create1-job-row">
                <div className="create1-span-4">
                  <div className="create1-field">
                    <label className="create1-label">Current Role</label>
                    <input className="create1-input" value={j.role} onChange={(e)=>updateJob("current", i, "role", e.target.value)} />
                  </div>
                </div>
                <div className="create1-span-4">
                  <div className="create1-field">
                    <label className="create1-label">Company</label>
                    <input className="create1-input" value={j.company} onChange={(e)=>updateJob("current", i, "company", e.target.value)} />
                  </div>
                </div>
                <div className="create1-span-4">
                  <div className="create1-field">
                    <label className="create1-label">Years</label>
                    <input className="create1-input" value={j.years} onChange={(e)=>updateJob("current", i, "years", e.target.value)} />
                  </div>
                </div>
                <div className="create1-span-12 create1-row-actions">
                  <button type="button" className="create1-btn-text" onClick={() => moveJob("current", i)}>Move to Past</button>
                  {currentJobs.length > 1 && (
                    <button type="button" className="create1-btn-text" onClick={() => removeJob("current", i)}>Remove</button>
                  )}
                </div>
              </div>
            ))}
            <button type="button" className="create1-btn-secondary" onClick={() => addJob("current")}>
              + Add Current Job
            </button>

            <h3 className="create1-h3">Past Job(s)</h3>
            {pastJobs.map((j, i) => (
              <div key={`past-${i}`} className="create1-grid create1-gap create1-job-row">
                <div className="create1-span-4">
                  <div className="create1-field">
                    <label className="create1-label">Past Role</label>
                    <input className="create1-input" value={j.role} onChange={(e)=>updateJob("past", i, "role", e.target.value)} />
                  </div>
                </div>
                <div className="create1-span-4">
                  <div className="create1-field">
                    <label className="create1-label">Company</label>
                    <input className="create1-input" value={j.company} onChange={(e)=>updateJob("past", i, "company", e.target.value)} />
                  </div>
                </div>
                <div className="create1-span-4">
                  <div className="create1-field">
                    <label className="create1-label">Years</label>
                    <input className="create1-input" value={j.years} onChange={(e)=>updateJob("past", i, "years", e.target.value)} />
                  </div>
                </div>
                <div className="create1-span-12 create1-row-actions">
                  <button type="button" className="create1-btn-text" onClick={() => moveJob("past", i)}>Move to Current</button>
                  <button type="button" className="create1-btn-text" onClick={() => removeJob("past", i)}>Remove</button>
                </div>
              </div>
            ))}
            <button type="button" className="create1-btn-secondary" onClick={() => addJob("past")}>
              + Add Past Job
            </button>
          </section>

          {/* Actions */}
          <div className="create1-actions">
            <button className="create1-btn-primary" onClick={onSave}>Save Profile</button>
          </div>
          {saveStatus ? <p className="create1-span-12 success-text" role="status">{saveStatus}</p> : null}
        </div>
      </main>
    </div>
  );
}

export default CreateAccount;
