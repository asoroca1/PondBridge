import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card } from "@pondbridge/ui";
import { ArrowUpRight, Lock } from "lucide-react";
import {
  ALWAYS_ON_PROFILE_FIELDS,
  PROFILE_FIELD_CATALOG,
  PROFILE_FIELD_GROUPS
} from "@pondbridge/shared";
import { InfoHint, LoadingSkeleton, ModalConfirm } from "../../components/admin/AdminUi.jsx";
import { useConfirmDialog } from "../../components/admin/useConfirmDialog.js";
import { useTenant } from "../../context/TenantContext.jsx";
import { tenantRoute } from "../../lib/tenantRouting.js";
import useAdminApi from "./useAdminApi.js";
import "./director-admin-profile-fields.css";

const MODULE_LABELS = {
  map: "Alumni map",
  directory: "Directory",
  search: "Search"
};

export default function DirectorAdminSettingsProfileFieldsPage() {
  const { slug, request } = useAdminApi();
  const { refreshTenant } = useTenant();
  const { confirm, confirmDialogProps } = useConfirmDialog();
  const [values, setValues] = useState(null);
  const [fields, setFields] = useState([]);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await request("/profile-fields");
      setFields(Array.isArray(response?.fields) ? response.fields : []);
      setValues(response?.values || {});
    } catch (requestError) {
      setError(requestError.message || "Failed to load profile content settings.");
    }
  }, [request]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveField(key, nextEnabled) {
    setSaving(key);
    setError("");
    setStatus("");
    // Optimistic, so a row of switches does not feel like it lags a network
    // round trip. A failed save reloads the truth over the top.
    setValues((current) => ({ ...current, [key]: nextEnabled }));
    try {
      const response = await request("/profile-fields", {
        method: "PATCH",
        body: { profileFields: { [key]: nextEnabled } }
      });
      setValues(response?.values || {});
      setStatus("Profile content updated.");
      // Members read these off the cached tenant config, which would otherwise
      // keep showing the old set of fields for another five minutes.
      await refreshTenant?.(undefined, { bypassCache: true });
      await load();
    } catch (requestError) {
      setError(requestError.message || "Failed to update profile content.");
      await load();
    } finally {
      setSaving("");
    }
  }

  const groupedFields = useMemo(() => {
    const byKey = new Map(fields.map((field) => [field.key, field]));
    return PROFILE_FIELD_GROUPS.map((group) => ({
      ...group,
      items: PROFILE_FIELD_CATALOG.filter((field) => field.group === group.key)
        .map((field) => byKey.get(field.key))
        .filter(Boolean)
    })).filter((group) => group.items.length);
  }, [fields]);

  if (!values) {
    return (
      <Card>
        <LoadingSkeleton lines={4} />
      </Card>
    );
  }

  const offCount = PROFILE_FIELD_CATALOG.filter((field) => !values[field.key]).length;

  async function onToggle(field, nextEnabled) {
    if (!nextEnabled) {
      // Turning a field off is the consequential direction: it removes a
      // question from every member's profile form and a line from every place
      // that profile is shown. Say exactly that, and name the knock-on effects.
      const dependents = PROFILE_FIELD_CATALOG.filter(
        (item) => item.requires === field.key && values[item.key]
      );
      const moduleNote = (field.affectsModules || [])
        .map((key) => MODULE_LABELS[key] || key)
        .join(", ");
      const notes = [
        `Members will no longer be asked for it, and it will stop showing on ${(field.shownOn || [])
          .join(", ")
          .toLowerCase() || "member profiles"}.`,
        dependents.length
          ? `${dependents.map((item) => item.label).join(" and ")} will switch off with it.`
          : "",
        moduleNote ? `${moduleNote} has nothing to show without it.` : "",
        "Answers already on file are kept, so turning it back on restores them."
      ].filter(Boolean);

      const confirmed = await confirm({
        title: `Stop collecting ${field.label.toLowerCase()}?`,
        description: notes.join(" "),
        confirmLabel: "Stop collecting"
      });
      if (!confirmed) return;
    }
    saveField(field.key, nextEnabled);
  }

  return (
    <>
      <Card className="director-profile-fields-intro">
        <p>
          Choose what your members are asked for. Anything switched off disappears from the profile
          form and from every place that profile is shown. Answers already on file are kept, so a
          field can come back later with its data intact.
        </p>
        <div className="director-profile-fields-intro-actions">
          <Link
            className="director-admin-inline-link"
            to={tenantRoute(slug, "/my-profile")}
          >
            See a member profile <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
          <span className="director-profile-fields-count">
            {offCount === 0
              ? "Collecting every optional field"
              : `${offCount} of ${PROFILE_FIELD_CATALOG.length} optional fields switched off`}
          </span>
        </div>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {status && !error ? <p className="success-text" role="status">{status}</p> : null}
      </Card>

      <Card className="director-profile-fields-always">
        <div className="director-profile-fields-always-head">
          <Lock size={15} aria-hidden="true" />
          <h3>Always collected</h3>
        </div>
        <p className="muted">
          These come with the account itself and cannot be switched off. Email and password are
          managed under Who can join.
        </p>
        <ul>
          {ALWAYS_ON_PROFILE_FIELDS.map((field) => (
            <li key={field.key}>
              <strong>{field.label}</strong>
              <span>{field.description}</span>
            </li>
          ))}
        </ul>
      </Card>

      {groupedFields.map((group) => (
        <Card key={group.key} className="director-profile-fields-card">
          <div className="director-profile-fields-group-head">
            <h3>{group.label}</h3>
            <p className="muted">{group.blurb}</p>
          </div>

          <div className="director-profile-fields-rows">
            {group.items.map((field) => {
              const enabled = Boolean(values[field.key]);
              const blocked = Boolean(field.blockedBy);
              const parent = blocked
                ? PROFILE_FIELD_CATALOG.find((item) => item.key === field.blockedBy)
                : null;
              return (
                <article
                  key={field.key}
                  className={[
                    "director-admin-module-row",
                    "director-profile-fields-row",
                    enabled ? "is-enabled" : "",
                    field.requires ? "is-child" : "",
                    blocked ? "is-unavailable" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className="director-admin-module-main">
                    <div className="director-admin-module-copy">
                      <div className="director-admin-module-title-row">
                        <h4>{field.label}</h4>
                        {field.description ? (
                          <InfoHint label={field.label}>
                            <span className="director-admin-module-about">{field.description}</span>
                            {field.shownOn?.length ? (
                              <span className="director-profile-fields-shown">
                                Shows on: {field.shownOn.join(", ")}
                              </span>
                            ) : null}
                          </InfoHint>
                        ) : null}
                        {enabled && field.affectsModules?.length ? (
                          <span className="director-profile-fields-tag">
                            Powers {field.affectsModules.map((key) => MODULE_LABELS[key] || key).join(", ")}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {blocked ? (
                      <div className="director-admin-module-availability">
                        <span>Needs {parent?.label || field.blockedBy}</span>
                      </div>
                    ) : (
                      <label className="director-admin-switch">
                        <input
                          type="checkbox"
                          checked={enabled}
                          aria-label={`${field.label}: ${enabled ? "collected" : "not collected"}`}
                          disabled={Boolean(saving)}
                          onChange={(event) => onToggle(field, event.target.checked)}
                        />
                      </label>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </Card>
      ))}

      <Card className="director-profile-fields-footer">
        <p className="muted">
          Changing these does not delete anything. To remove a member&apos;s answers, edit that
          member under People.
        </p>
        <Button variant="secondary" onClick={load} disabled={Boolean(saving)}>
          Reload
        </Button>
      </Card>

      <ModalConfirm {...confirmDialogProps} />
    </>
  );
}
