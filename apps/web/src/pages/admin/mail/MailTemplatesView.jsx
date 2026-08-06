import { useState } from "react";
import { Button } from "@pondbridge/ui";
import { FileText, PenLine, Trash2 } from "lucide-react";
import { ModalConfirm } from "../../../components/admin/AdminUi.jsx";

function plainPreview(html = "") {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export default function MailTemplatesView({ workspace, onUseTemplate }) {
  const { templates, saveTemplates, saving } = workspace;
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError] = useState("");

  async function confirmDelete() {
    if (!deleteTarget) return;
    const result = await saveTemplates(templates.filter((item) => item.id !== deleteTarget.id));
    if (!result.ok) {
      setError(workspace.error || "Failed to delete the template.");
      return;
    }
    setDeleteTarget(null);
    setError("");
  }

  return (
    <div className="pb-mail-panel">
      <header className="pb-mail-panel-head">
        <div>
          <h2>Templates</h2>
          <p>Reusable messages. Open one in the composer, edit it, then send.</p>
        </div>
      </header>

      {error ? <p className="error-text" role="alert">{error}</p> : null}

      {!templates.length ? (
        <div className="pb-mail-empty-panel">
          <FileText aria-hidden="true" />
          <strong>No templates yet.</strong>
          <p>Write a message, then choose Templates → “Save this message as a template”.</p>
        </div>
      ) : (
        <ul className="pb-mail-template-list">
          {templates.map((template) => (
            <li key={template.id}>
              <div className="pb-mail-template-main">
                <strong>{template.name}</strong>
                <small>{template.subject || "No subject"}</small>
                <span>{plainPreview(template.body) || "Empty message"}</span>
              </div>
              <div className="pb-mail-group-actions">
                <Button type="button" variant="secondary" size="sm" onClick={() => onUseTemplate?.(template)}>
                  <PenLine aria-hidden="true" />
                  Use
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteTarget(template)}
                  aria-label={`Delete ${template.name}`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ModalConfirm
        open={Boolean(deleteTarget)}
        title={deleteTarget ? `Delete “${deleteTarget.name}”?` : ""}
        description="The template is removed. Sent email history is not affected."
        confirmLabel="Delete template"
        cancelLabel="Keep template"
        tone="danger"
        busy={saving}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
