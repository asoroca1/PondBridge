import { useEffect, useState } from "react";
import { Button, Input, Select } from "@pondbridge/ui";
import { ModalDialog } from "../../../components/admin/AdminUi.jsx";
import { normalizeFooter } from "./mailFooter.js";

/**
 * Signature editing lives in a dialog rather than a compose step: it is set once
 * and rarely touched, the way a mail client keeps signatures in settings.
 */
export default function MailSignatureDialog({ open, onClose, workspace }) {
  const {
    footerPresets,
    defaultFooterPresetId,
    fallbackFooter,
    activeFooter,
    setActiveFooter,
    saveFooterPresets,
    saving
  } = workspace;

  const [selectedId, setSelectedId] = useState(defaultFooterPresetId);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState(activeFooter);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) return;
    const preset = footerPresets.find((item) => item.id === defaultFooterPresetId) || footerPresets[0];
    setSelectedId(preset?.id || "");
    setName(preset?.name || "");
    setDraft(normalizeFooter(activeFooter, preset?.footer || fallbackFooter));
    setError("");
    setStatus("");
  }, [activeFooter, defaultFooterPresetId, fallbackFooter, footerPresets, open]);

  const footer = normalizeFooter(draft, fallbackFooter);

  function selectPreset(id) {
    setSelectedId(id);
    const preset = footerPresets.find((item) => item.id === id);
    if (!preset) return;
    setName(preset.name || "");
    setDraft(normalizeFooter(preset.footer, fallbackFooter));
  }

  async function save({ makeDefault = false } = {}) {
    const trimmedName = name.trim().slice(0, 72);
    if (!trimmedName) {
      setError("Name this signature before saving.");
      return;
    }
    const existing = footerPresets.find((item) => item.id === selectedId)
      || footerPresets.find((item) => item.name.trim().toLowerCase() === trimmedName.toLowerCase());
    const entry = {
      id: existing?.id || `footer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      footer,
      updatedAt: new Date().toISOString()
    };
    const nextPresets = existing
      ? footerPresets.map((item) => (item.id === existing.id ? entry : item))
      : [entry, ...footerPresets].slice(0, 20);
    const nextDefaultId = makeDefault || !existing ? entry.id : defaultFooterPresetId;

    const result = await saveFooterPresets(nextPresets, nextDefaultId);
    if (!result.ok) {
      setError(workspace.error || "Failed to save the signature.");
      return;
    }
    setSelectedId(entry.id);
    setActiveFooter(footer);
    setError("");
    setStatus(`Saved “${trimmedName}”.`);
  }

  async function remove() {
    const preset = footerPresets.find((item) => item.id === selectedId);
    if (!preset) return;
    const remaining = footerPresets.filter((item) => item.id !== selectedId);
    const nextPresets = remaining.length
      ? remaining
      : [{ id: "default_footer", name: "Default signature", footer: fallbackFooter, updatedAt: new Date().toISOString() }];
    const result = await saveFooterPresets(nextPresets, String(nextPresets[0]?.id || ""));
    if (!result.ok) {
      setError(workspace.error || "Failed to delete the signature.");
      return;
    }
    selectPreset(String(nextPresets[0]?.id || ""));
    setActiveFooter(normalizeFooter(nextPresets[0]?.footer || {}, fallbackFooter));
    setStatus(`Deleted “${preset.name}”.`);
  }

  return (
    <ModalDialog
      open={open}
      title="Signature"
      description="Appears at the bottom of every email you send from here."
      onClose={onClose}
      className="director-admin-modal director-admin-modal-wide"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={remove} disabled={!selectedId || saving}>Delete</Button>
          <Button type="button" variant="secondary" onClick={() => save({ makeDefault: true })} loading={saving}>
            Save as default
          </Button>
          <Button type="button" onClick={() => save()} loading={saving}>Save</Button>
        </>
      }
    >
      <div className="pb-mail-signature-form">
        <label className="director-admin-dialog-field">
          Saved signatures
          <Select value={selectedId} onChange={(event) => selectPreset(event.target.value)} disabled={!footerPresets.length}>
            {footerPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}{preset.id === defaultFooterPresetId ? " (default)" : ""}
              </option>
            ))}
          </Select>
        </label>
        <label className="director-admin-dialog-field">
          Name
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Director signature" maxLength={72} />
        </label>

        <div className="pb-mail-signature-grid">
          <label>Header label
            <Input
              value={footer.headerTagline}
              onChange={(event) => setDraft((prev) => ({ ...prev, headerTagline: event.target.value }))}
              placeholder="Community update"
            />
          </label>
          <label>Sign-off
            <Input
              value={footer.signOff}
              onChange={(event) => setDraft((prev) => ({ ...prev, signOff: event.target.value }))}
              placeholder="Warmly,"
            />
          </label>
          <label>Your name
            <Input
              value={footer.senderName}
              onChange={(event) => setDraft((prev) => ({ ...prev, senderName: event.target.value }))}
              placeholder="Alex Rivera"
            />
          </label>
          <label>Role
            <Input
              value={footer.senderRole}
              onChange={(event) => setDraft((prev) => ({ ...prev, senderRole: event.target.value }))}
              placeholder="Director"
            />
          </label>
          <label>Reply-to email
            <Input
              value={draft.senderEmail || ""}
              onChange={(event) => setDraft((prev) => ({ ...prev, senderEmail: event.target.value }))}
              placeholder="director@camp.org"
            />
          </label>
          <label>Phone
            <Input
              value={footer.senderPhone}
              onChange={(event) => setDraft((prev) => ({ ...prev, senderPhone: event.target.value }))}
              placeholder="(555) 555-5555"
            />
          </label>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={Boolean(footer.showLogo)}
              onChange={(event) => setDraft((prev) => ({ ...prev, showLogo: event.target.checked }))}
            />
            Include the camp logo
          </label>
        </div>

        {error ? <p className="error-text" role="alert">{error}</p> : null}
        {status ? <p className="success-text" role="status">{status}</p> : null}
      </div>
    </ModalDialog>
  );
}
