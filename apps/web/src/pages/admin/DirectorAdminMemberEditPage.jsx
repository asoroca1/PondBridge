import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card, Input, Select, Textarea } from "@pondbridge/ui";
import { LoadingSkeleton, PageHeader } from "../../components/admin/AdminUi.jsx";
import useAdminApi from "./useAdminApi.js";

function emptyMemberEditorYearStint() {
  return { startYear: "", endYear: "", startAgeGroup: "", endAgeGroup: "" };
}

function normalizeMemberEditorYearStints(value = []) {
  const source = Array.isArray(value) ? value : [];
  const rows = source.map((entry) => ({
    startYear: String(entry?.startYear || "").trim(),
    endYear: String(entry?.endYear || "").trim(),
    startAgeGroup: String(entry?.startAgeGroup || "").trim(),
    endAgeGroup: String(entry?.endAgeGroup || "").trim()
  }));
  return rows.length ? rows : [emptyMemberEditorYearStint()];
}

function normalizeMemberEditorEducation(value = []) {
  const rows = (Array.isArray(value) ? value : []).map((row) => ({
    college: String(row?.college || "").trim(),
    year: String(row?.year || "").trim(),
    major: String(row?.major || "").trim()
  }));
  return rows.length ? rows : [{ college: "", year: "", major: "" }];
}

function normalizeMemberEditorJobs(value = []) {
  const rows = (Array.isArray(value) ? value : []).map((row) => ({
    role: String(row?.role || "").trim(),
    company: String(row?.company || "").trim(),
    years: String(row?.years || "").trim()
  }));
  return rows.length ? rows : [{ role: "", company: "", years: "" }];
}

function normalizeMemberEditorForm(profile = null) {
  const safe = profile && typeof profile === "object" ? profile : {};
  const camperStints = normalizeMemberEditorYearStints(safe?.camperYears?.stints || []);
  const staffStints = normalizeMemberEditorYearStints(safe?.staffYears?.stints || []);
  return {
    firstName: String(safe.firstName || "").trim(),
    lastName: String(safe.lastName || "").trim(),
    nickname: String(safe.nickname || "").trim(),
    email: String(safe.email || "").trim(),
    phone: String(safe.phone || "").trim(),
    cityState: String(safe.cityState || "").trim(),
    roleAtCamp: String(safe.roleAtCamp || "").trim(),
    rolesText: (Array.isArray(safe.roles) ? safe.roles : []).join(", "),
    status: String(safe.status || "active").trim().toLowerCase() || "active",
    flaggedReason: String(safe.flaggedReason || "").trim(),
    highSchool: String(safe.highSchool || "").trim(),
    industry: String(safe.industry || "").trim(),
    bio: String(safe.bio || "").trim(),
    avatarUrl: String(safe.avatarUrl || "").trim(),
    camperYearStints: camperStints,
    staffYearStints: staffStints,
    education: normalizeMemberEditorEducation(safe.education || []),
    currentJobs: normalizeMemberEditorJobs(safe.currentJobs || []),
    pastJobs: normalizeMemberEditorJobs(safe.pastJobs || []),
    social: {
      linkedin: String(safe?.social?.linkedin || "").trim(),
      instagram: String(safe?.social?.instagram || "").trim(),
      facebook: String(safe?.social?.facebook || "").trim()
    }
  };
}

function normalizeMemberEditorPayloadYearStints(rows = [], { includeAgeGroups = false } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .map((entry) => {
      const startYear = String(entry?.startYear || "").trim();
      const endYear = String(entry?.endYear || "").trim();
      if (!startYear && !endYear) return null;
      if (!/^\d{4}$/.test(startYear) || !/^\d{4}$/.test(endYear)) return null;
      const start = Number(startYear);
      const end = Number(endYear);
      const payload = {
        startYear: String(Math.min(start, end)),
        endYear: String(Math.max(start, end))
      };
      if (includeAgeGroups) {
        const startAgeGroup = String(entry?.startAgeGroup || "").trim();
        const endAgeGroup = String(entry?.endAgeGroup || "").trim();
        if (startAgeGroup) payload.startAgeGroup = startAgeGroup;
        if (endAgeGroup) payload.endAgeGroup = endAgeGroup;
        if (startAgeGroup && startAgeGroup === endAgeGroup) payload.ageGroup = startAgeGroup;
      }
      return payload;
    })
    .filter(Boolean);
}

export default function DirectorAdminMemberEditPage() {
  const navigate = useNavigate();
  const { profileId = "" } = useParams();
  const { slug, request } = useAdminApi();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState(() => normalizeMemberEditorForm(null));

  const normalizedProfileId = String(profileId || "").trim();

  const loadProfile = useCallback(async () => {
    if (!normalizedProfileId) {
      setError("Missing member id.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await request(`/members/${normalizedProfileId}/full`);
      setForm(normalizeMemberEditorForm(response?.profile || null));
    } catch (requestError) {
      setError(requestError.message || "Failed to load member profile.");
    } finally {
      setLoading(false);
    }
  }, [normalizedProfileId, request]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  function setField(patch = {}) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function setSocial(patch = {}) {
    setForm((prev) => ({ ...prev, social: { ...(prev.social || {}), ...patch } }));
  }

  function updateRow(listKey, index, patch) {
    setForm((prev) => ({
      ...prev,
      [listKey]: (Array.isArray(prev[listKey]) ? prev[listKey] : []).map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      )
    }));
  }

  function addRow(listKey, emptyRow) {
    setForm((prev) => ({
      ...prev,
      [listKey]: [...(Array.isArray(prev[listKey]) ? prev[listKey] : []), emptyRow]
    }));
  }

  function removeRow(listKey, index) {
    setForm((prev) => {
      const next = (Array.isArray(prev[listKey]) ? prev[listKey] : []).filter(
        (_row, rowIndex) => rowIndex !== index
      );
      const fallback =
        listKey === "education"
          ? [{ college: "", year: "", major: "" }]
          : listKey === "currentJobs" || listKey === "pastJobs"
          ? [{ role: "", company: "", years: "" }]
          : [emptyMemberEditorYearStint()];
      return {
        ...prev,
        [listKey]: next.length ? next : fallback
      };
    });
  }

  async function saveMember(event) {
    event.preventDefault();
    if (!normalizedProfileId) return;

    setSaving(true);
    setError("");
    setStatus("");
    try {
      const roles = [...new Set(
        String(form.rolesText || "")
          .split(",")
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )];
      const camperYearStints = normalizeMemberEditorPayloadYearStints(form.camperYearStints, {
        includeAgeGroups: true
      });
      const staffYearStints = normalizeMemberEditorPayloadYearStints(form.staffYearStints);
      const payload = {
        firstName: String(form.firstName || "").trim(),
        lastName: String(form.lastName || "").trim(),
        nickname: String(form.nickname || "").trim(),
        emails: form.email ? [String(form.email || "").trim()] : [],
        phone: String(form.phone || "").trim(),
        cityState: String(form.cityState || "").trim(),
        roleAtCamp: String(form.roleAtCamp || "").trim(),
        roles,
        status: String(form.status || "active").trim().toLowerCase(),
        flaggedReason: String(form.flaggedReason || "").trim(),
        highSchool: String(form.highSchool || "").trim(),
        industry: String(form.industry || "").trim(),
        bio: String(form.bio || "").trim(),
        avatarUrl: String(form.avatarUrl || "").trim(),
        camperYears: {
          firstYear: camperYearStints[0]?.startYear || "",
          firstGroup: camperYearStints[0]?.startAgeGroup || "",
          lastYear: camperYearStints.length ? camperYearStints[camperYearStints.length - 1]?.endYear || "" : "",
          lastGroup: camperYearStints.length
            ? camperYearStints[camperYearStints.length - 1]?.endAgeGroup || ""
            : "",
          stints: camperYearStints
        },
        staffYears: { stints: staffYearStints },
        education: (Array.isArray(form.education) ? form.education : []).filter((row) =>
          Boolean(String(row?.college || row?.year || row?.major || "").trim())
        ),
        currentJobs: (Array.isArray(form.currentJobs) ? form.currentJobs : []).filter((row) =>
          Boolean(String(row?.role || row?.company || row?.years || "").trim())
        ),
        pastJobs: (Array.isArray(form.pastJobs) ? form.pastJobs : []).filter((row) =>
          Boolean(String(row?.role || row?.company || row?.years || "").trim())
        ),
        social: {
          linkedin: String(form?.social?.linkedin || "").trim(),
          instagram: String(form?.social?.instagram || "").trim(),
          facebook: String(form?.social?.facebook || "").trim()
        }
      };
      const response = await request(`/members/${normalizedProfileId}/full`, {
        method: "PUT",
        body: payload
      });
      setForm(normalizeMemberEditorForm(response?.profile || null));
      setStatus("Member profile updated.");
    } catch (requestError) {
      setError(requestError.message || "Failed to save member profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Edit Member"
        subtitle="Full profile editor for this member."
        actions={
          <>
            <Link className="link-button secondary" to={`/t/${slug}/profile/${normalizedProfileId}`}>
              View Public Profile
            </Link>
            <Link className="link-button secondary" to={`/t/${slug}/admin/members`}>
              Back to Members
            </Link>
          </>
        }
      />
      {error ? <p className="error-text">{error}</p> : null}
      {status ? <p className="success-text">{status}</p> : null}
      {loading ? (
        <LoadingSkeleton lines={8} />
      ) : (
        <form className="director-admin-form-grid" onSubmit={saveMember}>
          <h3 className="full-width pb-section-title">Identity</h3>
          <label>
            First name
            <Input value={form.firstName} onChange={(event) => setField({ firstName: event.target.value })} />
          </label>
          <label>
            Last name
            <Input value={form.lastName} onChange={(event) => setField({ lastName: event.target.value })} />
          </label>
          <label>
            Camp nickname
            <Input value={form.nickname} onChange={(event) => setField({ nickname: event.target.value })} />
          </label>
          <label>
            Avatar URL
            <Input value={form.avatarUrl} onChange={(event) => setField({ avatarUrl: event.target.value })} />
          </label>

          <h3 className="full-width pb-section-title">Contact</h3>
          <label>
            Email
            <Input value={form.email} onChange={(event) => setField({ email: event.target.value })} />
          </label>
          <label>
            Phone
            <Input value={form.phone} onChange={(event) => setField({ phone: event.target.value })} />
          </label>
          <label className="full-width">
            Current location
            <Input value={form.cityState} onChange={(event) => setField({ cityState: event.target.value })} />
          </label>

          <h3 className="full-width pb-section-title">Camp Info</h3>
          <label>
            Role at camp
            <Input value={form.roleAtCamp} onChange={(event) => setField({ roleAtCamp: event.target.value })} />
          </label>
          <label>
            Additional roles (comma-separated)
            <Input value={form.rolesText} onChange={(event) => setField({ rolesText: event.target.value })} />
          </label>
          <label>
            High school
            <Input value={form.highSchool} onChange={(event) => setField({ highSchool: event.target.value })} />
          </label>
          <label>
            Industry
            <Input value={form.industry} onChange={(event) => setField({ industry: event.target.value })} />
          </label>
          <label className="full-width">
            Bio
            <Textarea value={form.bio} onChange={(event) => setField({ bio: event.target.value })} />
          </label>

          <h3 className="full-width pb-section-title">Camper Years</h3>
          {(Array.isArray(form.camperYearStints) ? form.camperYearStints : []).map((stint, index) => (
            <div key={`camper-${index}`} className="director-admin-member-edit-block full-width">
              <div className="director-admin-member-edit-grid">
                <label>
                  Start Year
                  <Input
                    value={stint.startYear || ""}
                    onChange={(event) =>
                      updateRow("camperYearStints", index, { startYear: event.target.value })
                    }
                  />
                </label>
                <label>
                  End Year
                  <Input
                    value={stint.endYear || ""}
                    onChange={(event) =>
                      updateRow("camperYearStints", index, { endYear: event.target.value })
                    }
                  />
                </label>
                <label>
                  Start Age Group
                  <Input
                    value={stint.startAgeGroup || ""}
                    onChange={(event) =>
                      updateRow("camperYearStints", index, { startAgeGroup: event.target.value })
                    }
                  />
                </label>
                <label>
                  End Age Group
                  <Input
                    value={stint.endAgeGroup || ""}
                    onChange={(event) =>
                      updateRow("camperYearStints", index, { endAgeGroup: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="director-admin-form-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => removeRow("camperYearStints", index)}
                >
                  Remove Row
                </Button>
              </div>
            </div>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button
              type="button"
              variant="secondary"
              onClick={() => addRow("camperYearStints", emptyMemberEditorYearStint())}
            >
              Add Camper Row
            </Button>
          </div>

          <h3 className="full-width pb-section-title">Staff Years</h3>
          {(Array.isArray(form.staffYearStints) ? form.staffYearStints : []).map((stint, index) => (
            <div key={`staff-${index}`} className="director-admin-member-edit-block full-width">
              <div className="director-admin-member-edit-grid">
                <label>
                  Start Year
                  <Input
                    value={stint.startYear || ""}
                    onChange={(event) =>
                      updateRow("staffYearStints", index, { startYear: event.target.value })
                    }
                  />
                </label>
                <label>
                  End Year
                  <Input
                    value={stint.endYear || ""}
                    onChange={(event) =>
                      updateRow("staffYearStints", index, { endYear: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="director-admin-form-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => removeRow("staffYearStints", index)}
                >
                  Remove Row
                </Button>
              </div>
            </div>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button
              type="button"
              variant="secondary"
              onClick={() => addRow("staffYearStints", emptyMemberEditorYearStint())}
            >
              Add Staff Row
            </Button>
          </div>

          <h3 className="full-width pb-section-title">Education</h3>
          {(Array.isArray(form.education) ? form.education : []).map((row, index) => (
            <div key={`education-${index}`} className="director-admin-member-edit-block full-width">
              <div className="director-admin-member-edit-grid">
                <label>
                  College
                  <Input
                    value={row.college || ""}
                    onChange={(event) => updateRow("education", index, { college: event.target.value })}
                  />
                </label>
                <label>
                  Year
                  <Input
                    value={row.year || ""}
                    onChange={(event) => updateRow("education", index, { year: event.target.value })}
                  />
                </label>
                <label className="full-width">
                  Major
                  <Input
                    value={row.major || ""}
                    onChange={(event) => updateRow("education", index, { major: event.target.value })}
                  />
                </label>
              </div>
              <div className="director-admin-form-actions">
                <Button type="button" variant="secondary" onClick={() => removeRow("education", index)}>
                  Remove Row
                </Button>
              </div>
            </div>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button
              type="button"
              variant="secondary"
              onClick={() => addRow("education", { college: "", year: "", major: "" })}
            >
              Add Education Row
            </Button>
          </div>

          <h3 className="full-width pb-section-title">Current Jobs</h3>
          {(Array.isArray(form.currentJobs) ? form.currentJobs : []).map((row, index) => (
            <div key={`current-job-${index}`} className="director-admin-member-edit-block full-width">
              <div className="director-admin-member-edit-grid">
                <label>
                  Role
                  <Input
                    value={row.role || ""}
                    onChange={(event) => updateRow("currentJobs", index, { role: event.target.value })}
                  />
                </label>
                <label>
                  Company
                  <Input
                    value={row.company || ""}
                    onChange={(event) => updateRow("currentJobs", index, { company: event.target.value })}
                  />
                </label>
                <label>
                  Years
                  <Input
                    value={row.years || ""}
                    onChange={(event) => updateRow("currentJobs", index, { years: event.target.value })}
                  />
                </label>
              </div>
              <div className="director-admin-form-actions">
                <Button type="button" variant="secondary" onClick={() => removeRow("currentJobs", index)}>
                  Remove Row
                </Button>
              </div>
            </div>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button
              type="button"
              variant="secondary"
              onClick={() => addRow("currentJobs", { role: "", company: "", years: "" })}
            >
              Add Current Job
            </Button>
          </div>

          <h3 className="full-width pb-section-title">Past Jobs</h3>
          {(Array.isArray(form.pastJobs) ? form.pastJobs : []).map((row, index) => (
            <div key={`past-job-${index}`} className="director-admin-member-edit-block full-width">
              <div className="director-admin-member-edit-grid">
                <label>
                  Role
                  <Input
                    value={row.role || ""}
                    onChange={(event) => updateRow("pastJobs", index, { role: event.target.value })}
                  />
                </label>
                <label>
                  Company
                  <Input
                    value={row.company || ""}
                    onChange={(event) => updateRow("pastJobs", index, { company: event.target.value })}
                  />
                </label>
                <label>
                  Years
                  <Input
                    value={row.years || ""}
                    onChange={(event) => updateRow("pastJobs", index, { years: event.target.value })}
                  />
                </label>
              </div>
              <div className="director-admin-form-actions">
                <Button type="button" variant="secondary" onClick={() => removeRow("pastJobs", index)}>
                  Remove Row
                </Button>
              </div>
            </div>
          ))}
          <div className="director-admin-form-actions full-width">
            <Button
              type="button"
              variant="secondary"
              onClick={() => addRow("pastJobs", { role: "", company: "", years: "" })}
            >
              Add Past Job
            </Button>
          </div>

          <h3 className="full-width pb-section-title">Social</h3>
          <label>
            LinkedIn
            <Input
              value={form?.social?.linkedin || ""}
              onChange={(event) => setSocial({ linkedin: event.target.value })}
            />
          </label>
          <label>
            Instagram
            <Input
              value={form?.social?.instagram || ""}
              onChange={(event) => setSocial({ instagram: event.target.value })}
            />
          </label>
          <label>
            Facebook
            <Input
              value={form?.social?.facebook || ""}
              onChange={(event) => setSocial({ facebook: event.target.value })}
            />
          </label>

          <h3 className="full-width pb-section-title">Access</h3>
          <label>
            Status
            <Select value={form.status || "active"} onChange={(event) => setField({ status: event.target.value })}>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="flagged">Flagged</option>
              <option value="removed">Removed</option>
            </Select>
          </label>
          <label className="full-width">
            Flag reason
            <Textarea
              value={form.flaggedReason || ""}
              onChange={(event) => setField({ flaggedReason: event.target.value })}
            />
          </label>

          <div className="director-admin-form-actions full-width director-admin-network-form-actions">
            <Button type="button" variant="secondary" onClick={() => navigate(`/t/${slug}/admin/members`)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
