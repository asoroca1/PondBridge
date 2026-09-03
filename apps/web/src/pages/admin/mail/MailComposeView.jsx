import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Select } from "@pondbridge/ui";
import {
  Eye,
  EyeOff,
  FlaskConical,
  LayoutTemplate,
  Send,
  Signature,
  Sparkles,
  Trash2,
  UsersRound
} from "lucide-react";
import { ModalConfirm, ModalDialog } from "../../../components/admin/AdminUi.jsx";
import DirectorEmailAgentPanel from "../../../components/admin/DirectorEmailAgentPanel.jsx";
import { HIDE_COMMS_AI } from "../../../lib/directorHiddenFeatures.js";
import MailRichTextEditor from "./MailRichTextEditor.jsx";
import RecipientField from "./RecipientField.jsx";
import { buildTargetingFromChips, chipsToGroupRules, describeChips } from "./mailAudience.js";
import { normalizeFooter } from "./mailFooter.js";

function useDebouncedValue(value, delayMs = 400) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), Math.max(0, Number(delayMs) || 0));
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function formatClock(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function MailComposeView({
  request,
  tenant,
  compose,
  setCompose,
  workspace,
  onOpenSignature,
  onSent,
  onDraftSaved
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [recipientPreview, setRecipientPreview] = useState({ count: 0, excludedCount: 0, preview: [] });
  const [previewLoading, setPreviewLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [savedAt, setSavedAt] = useState(null);
  const [discardTarget, setDiscardTarget] = useState(false);
  const draftIdRef = useRef(compose.draftId || "");
  const savingDraftRef = useRef(false);

  const {
    activeFooter,
    availableIndustries,
    availableRoles,
    groups,
    templates,
    saveGroups,
    saveTemplates
  } = workspace;

  const chips = compose.chips || [];
  const targeting = useMemo(() => buildTargetingFromChips(chips), [chips]);
  const hasRecipients = recipientPreview.count > 0;
  const hasMessage = Boolean(compose.subject.trim() && compose.body.trim());
  const sendDisabled = sending || !hasRecipients || !hasMessage;
  const hasAnyContent = Boolean(compose.subject.trim() || compose.body.trim() || chips.length);

  const footer = useMemo(() => normalizeFooter(activeFooter, {}), [activeFooter]);
  const networkName = String(tenant?.content?.networkDisplayName || tenant?.name || "Your Camp Network").trim();
  const logoUrl = String(tenant?.theme?.logoUrl || "").trim();
  const previewInitials = (networkName || "PondBridge")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((item) => item[0]?.toUpperCase() || "")
    .join("") || "PB";
  const footerContact = [footer.senderEmail, footer.senderPhone].filter(Boolean).join(" • ");

  const patch = useCallback((changes) => setCompose((prev) => ({ ...prev, ...changes })), [setCompose]);

  // ---------------------------------------------------------------------------
  // Recipient count
  // ---------------------------------------------------------------------------

  const debouncedTargeting = useDebouncedValue(targeting, 300);

  useEffect(() => {
    let active = true;
    setPreviewLoading(true);
    request("/email/recipients-preview", { method: "POST", body: { targeting: debouncedTargeting } })
      .then((payload) => { if (active) setRecipientPreview(payload); })
      .catch(() => { if (active) setRecipientPreview({ count: 0, excludedCount: 0, preview: [] }); })
      .finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [debouncedTargeting, request]);

  // ---------------------------------------------------------------------------
  // Server-side draft autosave
  // ---------------------------------------------------------------------------

  const autosavePayload = useMemo(() => ({
    subject: compose.subject,
    preheader: compose.preheader,
    body: compose.body,
    targeting
  }), [compose.body, compose.preheader, compose.subject, targeting]);
  const debouncedAutosave = useDebouncedValue(autosavePayload, 1800);

  useEffect(() => {
    if (!debouncedAutosave.subject.trim() && !debouncedAutosave.body.trim()) return;
    // Without this guard a fast typist can start a second create before the
    // first returns an id, leaving two drafts for one message.
    if (savingDraftRef.current) return;
    let active = true;
    const draftId = draftIdRef.current;
    savingDraftRef.current = true;
    const save = draftId
      ? request(`/email/draft/${draftId}`, { method: "PATCH", body: debouncedAutosave })
      : request("/email/draft", { method: "POST", body: debouncedAutosave });
    save
      .then((payload) => {
        if (!active) return;
        const id = String(payload?.item?.id || "");
        if (id && id !== draftIdRef.current) {
          draftIdRef.current = id;
          setCompose((prev) => ({ ...prev, draftId: id }));
        }
        setSavedAt(new Date());
        onDraftSaved?.();
      })
      .catch(() => {
        // A failed autosave is not worth interrupting typing; the next keystroke retries.
        if (active) setSavedAt(null);
      })
      .finally(() => { savingDraftRef.current = false; });
    return () => { active = false; };
  }, [debouncedAutosave, onDraftSaved, request, setCompose]);

  useEffect(() => {
    draftIdRef.current = compose.draftId || "";
  }, [compose.draftId]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function sendTestEmail() {
    setError("");
    setStatus("");
    try {
      await request("/email/test", {
        method: "POST",
        body: { subject: compose.subject, preheader: compose.preheader, body: compose.body, footer }
      });
      setStatus("Test email sent to your inbox.");
    } catch (requestError) {
      setError(requestError.message || "Failed to send test email.");
    }
  }

  function requestSend() {
    if (!hasMessage || !hasRecipients) {
      setError("Add recipients, a subject, and a message before sending.");
      return;
    }
    if (compose.scheduleType === "later") {
      const scheduledAt = new Date(compose.scheduledFor);
      if (!compose.scheduledFor || Number.isNaN(scheduledAt.getTime())) {
        setError("Choose a valid date and time for the scheduled email.");
        return;
      }
      if (scheduledAt <= new Date()) {
        setError("Scheduled email time must be in the future.");
        return;
      }
      if (scheduledAt.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000) {
        setError("Scheduled emails can be created up to 30 days in advance.");
        return;
      }
    }
    setError("");
    setShowSendConfirm(true);
  }

  async function confirmSend(confirmDuplicate = false) {
    setShowSendConfirm(false);
    setShowDuplicateConfirm(false);
    setSending(true);
    setError("");
    setStatus("");
    try {
      await request("/email/send", {
        method: "POST",
        body: {
          subject: compose.subject,
          preheader: compose.preheader,
          body: compose.body,
          aiGenerationId: compose.aiGenerationId,
          targeting,
          scheduledFor: compose.scheduleType === "later" ? new Date(compose.scheduledFor).toISOString() : "",
          footer,
          confirmDuplicate
        }
      });
      // The draft became a real message; drop the working copy.
      if (draftIdRef.current) {
        await request(`/email/draft/${draftIdRef.current}`, { method: "DELETE" }).catch(() => {});
      }
      onSent?.(compose.scheduleType === "later" ? "scheduled" : "sent");
    } catch (requestError) {
      const code = requestError?.payload?.error?.code || requestError?.code || "";
      // Match on the code, not the status. A compliance block is also a 409, and
      // treating it as a duplicate offered "Send anyway", which retried into the
      // same block forever while reporting a duplicate that never existed.
      if (code === "DUPLICATE_BROADCAST_WARNING") {
        setShowDuplicateConfirm(true);
      } else if (code === "EMAIL_COMPLIANCE_BLOCKED") {
        const blockers = requestError?.payload?.error?.details?.blockers || [];
        const first = blockers.find((item) => item?.message)?.message || "";
        setError(first || requestError.message || "This email cannot be sent yet.");
      } else {
        setError(requestError.message || "Failed to send email.");
      }
    } finally {
      setSending(false);
    }
  }

  async function saveChipsAsGroup() {
    const name = groupName.trim().slice(0, 72);
    const rules = chipsToGroupRules(chips);
    if (!name) {
      setError("Name the group before saving.");
      return;
    }
    if (!rules.length) {
      setError("Add recipients before saving a group.");
      return;
    }
    const now = new Date().toISOString();
    const existing = groups.find((item) => item.name.trim().toLowerCase() === name.toLowerCase());
    const entry = {
      id: existing?.id || `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: describeChips(chips),
      rules,
      updatedAt: now
    };
    const next = existing
      ? groups.map((item) => (item.id === existing.id ? entry : item))
      : [entry, ...groups].slice(0, 60);
    const result = await saveGroups(next);
    if (!result.ok) {
      setError(workspace.error || "Failed to save the group.");
      return;
    }
    setGroupDialogOpen(false);
    setGroupName("");
    setError("");
    setStatus(`${existing ? "Updated" : "Saved"} the “${name}” group.`);
  }

  async function saveAsTemplate() {
    const name = templateName.trim().slice(0, 72);
    if (!name) {
      setError("Name the template before saving.");
      return;
    }
    if (!compose.subject.trim() && !compose.body.trim()) {
      setError("Write a subject or message before saving a template.");
      return;
    }
    const now = new Date().toISOString();
    const existing = templates.find((item) => item.name.trim().toLowerCase() === name.toLowerCase());
    const entry = {
      id: existing?.id || `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      subject: compose.subject,
      preheader: compose.preheader,
      body: compose.body,
      updatedAt: now
    };
    const next = existing
      ? templates.map((item) => (item.id === existing.id ? entry : item))
      : [entry, ...templates].slice(0, 40);
    const result = await saveTemplates(next);
    if (!result.ok) {
      setError(workspace.error || "Failed to save the template.");
      return;
    }
    setTemplateDialogOpen(false);
    setTemplateName("");
    setError("");
    setStatus(`${existing ? "Updated" : "Saved"} the “${name}” template.`);
  }

  async function discardMessage() {
    const draftId = draftIdRef.current;
    draftIdRef.current = "";
    setDiscardTarget(false);
    setSavedAt(null);
    setCompose({
      chips: [],
      subject: "",
      preheader: "",
      body: "",
      aiGenerationId: "",
      scheduleType: "now",
      scheduledFor: "",
      draftId: ""
    });
    setStatus("Started a new message.");
    if (draftId) {
      // Leaving the saved copy behind would resurrect the message in Drafts.
      await request(`/email/draft/${draftId}`, { method: "DELETE" }).catch(() => {});
      onDraftSaved?.();
    }
  }

  function applyTemplate(templateId) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    patch({
      subject: template.subject || "",
      preheader: template.preheader || "",
      body: template.body || "",
      aiGenerationId: ""
    });
    setTemplateMenuOpen(false);
    setStatus(`Loaded the “${template.name}” template.`);
  }

  const scheduleSummary = compose.scheduleType === "later" && compose.scheduledFor
    ? new Date(compose.scheduledFor).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "Sends as soon as you confirm";

  return (
    <div className="pb-mail-compose">
      <div className="pb-mail-compose-main">
        <div className="pb-mail-toolbar">
          <div className="pb-mail-toolbar-primary">
            <Button type="button" onClick={requestSend} disabled={sendDisabled} loading={sending}>
              <Send aria-hidden="true" />
              {compose.scheduleType === "later" ? "Schedule" : "Send"}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={sendTestEmail} disabled={!hasMessage}>
              <FlaskConical aria-hidden="true" />
              Test send
            </Button>
          </div>
          <div className="pb-mail-toolbar-secondary">
            <div className="pb-mail-menu">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTemplateMenuOpen((open) => !open)}
                aria-expanded={templateMenuOpen}
              >
                <LayoutTemplate aria-hidden="true" />
                Templates
              </Button>
              {templateMenuOpen ? (
                <div className="pb-mail-menu-popover" role="menu">
                  {templates.length ? (
                    templates.map((template) => (
                      <button key={template.id} type="button" role="menuitem" onClick={() => applyTemplate(template.id)}>
                        {template.name}
                      </button>
                    ))
                  ) : (
                    <p className="pb-mail-menu-empty">No saved templates yet.</p>
                  )}
                  <span className="pb-mail-menu-sep" aria-hidden="true" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setTemplateMenuOpen(false);
                      setTemplateName("");
                      setTemplateDialogOpen(true);
                    }}
                  >
                    Save this message as a template…
                  </button>
                </div>
              ) : null}
            </div>
            {HIDE_COMMS_AI ? null : (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAiOpen((open) => !open)} aria-expanded={aiOpen}>
                <Sparkles aria-hidden="true" />
                {aiOpen ? "Hide AI" : "Draft with AI"}
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onOpenSignature}>
              <Signature aria-hidden="true" />
              Signature
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPreviewMode((open) => !open)}
              aria-pressed={previewMode}
            >
              {previewMode ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              {previewMode ? "Back to editing" : "Preview"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!hasAnyContent}
              onClick={() => setDiscardTarget(true)}
            >
              <Trash2 aria-hidden="true" />
              Discard
            </Button>
          </div>
        </div>

        {aiOpen && !HIDE_COMMS_AI ? (
          <div className="pb-mail-ai">
            <DirectorEmailAgentPanel
              request={request}
              form={compose}
              targeting={targeting}
              recipientPreview={recipientPreview}
              onApplyDraft={(draft) => {
                patch({
                  subject: String(draft.subject || ""),
                  preheader: String(draft.preheader || ""),
                  body: String(draft.body || ""),
                  aiGenerationId: String(draft.aiGenerationId || "")
                });
                setError("");
              }}
            />
          </div>
        ) : null}

        <div className="pb-mail-headers">
          <RecipientField
            chips={chips}
            onChange={(next) => patch({ chips: next })}
            request={request}
            savedGroups={groups}
            availableRoles={availableRoles}
            availableIndustries={availableIndustries}
            recipientCount={recipientPreview.count || 0}
            countLoading={previewLoading}
          />

          <div className="pb-mail-recipient-meta">
            <span>
              {previewLoading
                ? "Counting recipients…"
                : hasRecipients
                  ? `${recipientPreview.count.toLocaleString()} will receive this${recipientPreview.excludedCount ? ` · ${recipientPreview.excludedCount} excluded by email preferences` : ""}`
                  : chips.length
                    ? "No eligible recipients match this selection."
                    : "Add a group, role, class year, industry, or member above."}
            </span>
            <button
              type="button"
              className="pb-mail-link-button"
              disabled={!chips.length}
              onClick={() => {
                setGroupName("");
                setGroupDialogOpen(true);
              }}
            >
              <UsersRound aria-hidden="true" />
              Save as group
            </button>
          </div>

          <label className="pb-mail-header-row">
            <span className="pb-mail-recipients-label">Subject</span>
            <Input
              value={compose.subject}
              maxLength={120}
              onChange={(event) => patch({ subject: event.target.value })}
              placeholder="Add a subject"
            />
          </label>

          <label className="pb-mail-header-row is-optional">
            <span className="pb-mail-recipients-label">Preview text</span>
            <Input
              value={compose.preheader}
              maxLength={160}
              onChange={(event) => patch({ preheader: event.target.value })}
              placeholder="Optional line shown next to the subject in the inbox"
            />
          </label>
        </div>

        {previewMode ? (
          <div className="pb-mail-preview-pane">
            <p className="pb-mail-preview-note">
              This is how the email arrives, including your camp header and signature.
            </p>
            <div className="pb-mail-preview-frame">
              <div className="pb-mail-preview-head" style={{ background: "#404040" }}>
                {logoUrl ? <img src={logoUrl} alt="" /> : <span className="pb-mail-preview-logo">{previewInitials}</span>}
                <div>
                  <strong>{networkName || "Your Camp Network"}</strong>
                  <small>{footer.headerTagline || "Community update"}</small>
                </div>
              </div>
              <div className="pb-mail-preview-body">
                <h4>{compose.subject.trim() || "Your subject will appear here"}</h4>
                <p className="pb-mail-preview-preheader">
                  {compose.preheader.trim() || "Inbox preview text will appear here."}
                </p>
                <div
                  className="pb-mail-preview-html"
                  dangerouslySetInnerHTML={{ __html: compose.body || "<p>Start writing to preview your message.</p>" }}
                />
              </div>
              <div className="pb-mail-preview-foot">
                <div>
                  <p>{footer.signOff || "Warmly,"}</p>
                  {footer.senderName ? <p><strong>{footer.senderName}</strong></p> : null}
                  {footer.senderRole ? <p>{footer.senderRole}</p> : null}
                  {footerContact ? <p>{footerContact}</p> : null}
                </div>
                {footer.showLogo && (logoUrl || footer.logoUrl) ? (
                  <img className="pb-mail-preview-foot-logo" src={logoUrl || footer.logoUrl} alt="" />
                ) : null}
              </div>
            </div>
            {recipientPreview.preview?.length ? (
              <details className="pb-mail-preview-recipients">
                <summary>Sample recipients</summary>
                <ul>
                  {recipientPreview.preview.map((person, index) => (
                    <li key={person.id || index}>
                      <span>{person.name || person.email}</span>
                      {person.email ? <small>{person.email}</small> : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : (
          <MailRichTextEditor value={compose.body} onChange={(html) => patch({ body: html })} />
        )}

        <div className="pb-mail-signature-strip">
          <span className="pb-mail-signature-avatar" aria-hidden="true">
            {(footer.senderName || networkName || "P").trim().charAt(0).toUpperCase()}
          </span>
          <div>
            <strong>{footer.senderName || "Sender name not set"}</strong>
            <small>
              {footer.senderRole || "Director"}
              {footerContact ? ` · ${footerContact}` : ""}
            </small>
          </div>
          <button type="button" className="pb-mail-link-button" onClick={onOpenSignature}>Edit signature</button>
        </div>

        <div className="pb-mail-delivery">
          <div className="pb-mail-delivery-timing">
            <Select
              value={compose.scheduleType}
              onChange={(event) => patch({ scheduleType: event.target.value })}
              aria-label="Send timing"
            >
              <option value="now">Send now</option>
              <option value="later">Schedule for later</option>
            </Select>
            {compose.scheduleType === "later" ? (
              <Input
                type="datetime-local"
                value={compose.scheduledFor}
                onChange={(event) => patch({ scheduledFor: event.target.value })}
                aria-label="Scheduled date and time"
              />
            ) : (
              <span className="pb-mail-delivery-note">{scheduleSummary}</span>
            )}
          </div>
        </div>

        <div className="pb-mail-statusbar">
          <span>{savedAt ? `Draft saved ${formatClock(savedAt)}` : "Drafts save automatically"}</span>
          {error ? <span className="error-text" role="alert">{error}</span> : null}
          {status ? <span className="success-text" role="status">{status}</span> : null}
        </div>
      </div>

      <ModalDialog
        open={groupDialogOpen}
        title="Save as group"
        description="Reuse this audience next time by picking it from the To line."
        onClose={() => setGroupDialogOpen(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setGroupDialogOpen(false)}>Cancel</Button>
            <Button type="button" onClick={saveChipsAsGroup} loading={workspace.saving}>Save group</Button>
          </>
        }
      >
        <label className="director-admin-dialog-field">
          Group name
          <Input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="Summer 2026 staff"
            maxLength={72}
            autoFocus
          />
        </label>
        <p className="muted">Includes: {describeChips(chips)}</p>
      </ModalDialog>

      <ModalDialog
        open={templateDialogOpen}
        title="Save as template"
        description="Save this subject, preview line, and message to reuse later."
        onClose={() => setTemplateDialogOpen(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
            <Button type="button" onClick={saveAsTemplate} loading={workspace.saving}>Save template</Button>
          </>
        }
      >
        <label className="director-admin-dialog-field">
          Template name
          <Input
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            placeholder="Monthly newsletter"
            maxLength={72}
            autoFocus
          />
        </label>
      </ModalDialog>

      <ModalConfirm
        open={showSendConfirm}
        title={compose.scheduleType === "later" ? "Schedule this email?" : "Send this email?"}
        description={`“${compose.subject}” goes to ${recipientPreview.count.toLocaleString()} recipient${recipientPreview.count === 1 ? "" : "s"}${compose.scheduleType === "later" ? ` on ${scheduleSummary}` : " right away"}.`}
        confirmLabel={compose.scheduleType === "later" ? "Schedule" : "Send now"}
        cancelLabel="Cancel"
        tone="danger"
        busy={sending}
        onConfirm={() => confirmSend(false)}
        onCancel={() => setShowSendConfirm(false)}
      />

      <ModalConfirm
        open={discardTarget}
        title="Discard this message?"
        description="The message and its saved draft are removed."
        confirmLabel="Discard"
        cancelLabel="Keep writing"
        tone="danger"
        onConfirm={discardMessage}
        onCancel={() => setDiscardTarget(false)}
      />

      <ModalConfirm
        open={showDuplicateConfirm}
        title="Send a duplicate?"
        description="An email with this subject went out within the last hour."
        confirmLabel="Send anyway"
        cancelLabel="Cancel"
        tone="danger"
        busy={sending}
        onConfirm={() => confirmSend(true)}
        onCancel={() => setShowDuplicateConfirm(false)}
      />
    </div>
  );
}
