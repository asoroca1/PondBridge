import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Input } from "@pondbridge/ui";
import { Pencil, Plus, Send, Trash2, UsersRound } from "lucide-react";
import { ModalConfirm } from "../../../components/admin/AdminUi.jsx";
import RecipientField from "./RecipientField.jsx";
import {
  buildTargeting,
  chipsFromTargeting,
  chipsToGroupRules,
  describeRules,
  groupChip
} from "./mailAudience.js";

function newGroupDraft() {
  return { id: "", name: "", description: "", chips: [] };
}

/**
 * Group management uses the same "To" line as the composer, so building a group
 * is the same gesture as addressing a message.
 */
export default function MailGroupsView({ request, workspace, onComposeToGroup }) {
  const { groups, availableRoles, saveGroups, saving } = workspace;
  const [editor, setEditor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  // Live headcounts make a saved group's meaning obvious at a glance.
  useEffect(() => {
    let active = true;
    const pending = groups.filter((group) => counts[group.id] === undefined);
    if (!pending.length) return undefined;
    Promise.all(pending.map(async (group) => {
      try {
        const payload = await request("/email/recipients-preview", {
          method: "POST",
          body: { targeting: buildTargeting(group.rules, group.name) }
        });
        return [group.id, Number(payload?.count || 0)];
      } catch {
        return [group.id, null];
      }
    })).then((entries) => {
      if (!active) return;
      setCounts((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { active = false; };
  }, [counts, groups, request]);

  const editorRules = useMemo(() => (editor ? chipsToGroupRules(editor.chips) : []), [editor]);

  const startCreate = useCallback(() => {
    setEditor(newGroupDraft());
    setError("");
    setStatus("");
  }, []);

  function startEdit(group) {
    setEditor({
      id: group.id,
      name: group.name,
      description: group.description || "",
      chips: chipsFromTargeting(buildTargeting(group.rules), { groups: [] })
    });
    setError("");
    setStatus("");
  }

  async function submitEditor() {
    if (!editor) return;
    const name = editor.name.trim().slice(0, 72);
    if (!name) {
      setError("Give the group a name.");
      return;
    }
    if (!editorRules.length) {
      setError("Add at least one role, class year, or member to the group.");
      return;
    }
    const duplicate = groups.find(
      (group) => group.id !== editor.id && group.name.trim().toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      setError("Another group already uses that name.");
      return;
    }

    const entry = {
      id: editor.id || `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      description: editor.description.trim().slice(0, 180),
      rules: editorRules,
      updatedAt: new Date().toISOString()
    };
    const next = editor.id
      ? groups.map((group) => (group.id === editor.id ? entry : group))
      : [entry, ...groups].slice(0, 60);

    const result = await saveGroups(next);
    if (!result.ok) {
      setError(workspace.error || "Failed to save the group.");
      return;
    }
    setCounts((prev) => ({ ...prev, [entry.id]: undefined }));
    setEditor(null);
    setError("");
    setStatus(`${editor.id ? "Updated" : "Created"} the “${name}” group.`);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const next = groups.filter((group) => group.id !== deleteTarget.id);
    const result = await saveGroups(next);
    if (!result.ok) {
      setError(workspace.error || "Failed to delete the group.");
      return;
    }
    setStatus(`Deleted the “${deleteTarget.name}” group.`);
    setDeleteTarget(null);
  }

  return (
    <div className="pb-mail-panel">
      <header className="pb-mail-panel-head">
        <div>
          <h2>Groups</h2>
          <p>Saved audiences you can drop straight into the To line.</p>
        </div>
        <Button type="button" onClick={startCreate}>
          <Plus aria-hidden="true" />
          New group
        </Button>
      </header>

      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {status ? <p className="success-text" role="status">{status}</p> : null}

      {editor ? (
        <section className="pb-mail-group-editor" aria-label={editor.id ? "Edit group" : "New group"}>
          <div className="pb-mail-group-editor-fields">
            <label className="director-admin-dialog-field">
              Group name
              <Input
                value={editor.name}
                onChange={(event) => setEditor((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Summer 2026 staff"
                maxLength={72}
                autoFocus
              />
            </label>
            <label className="director-admin-dialog-field">
              Description <span className="muted">(optional)</span>
              <Input
                value={editor.description}
                onChange={(event) => setEditor((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Everyone on staff this summer"
                maxLength={180}
              />
            </label>
          </div>

          <div className="pb-mail-group-editor-audience">
            <RecipientField
              chips={editor.chips}
              onChange={(chips) => setEditor((prev) => ({ ...prev, chips }))}
              request={request}
              savedGroups={[]}
              availableRoles={availableRoles}
              recipientCount={0}
              countLoading={false}
            />
            <p className="muted">{describeRules(editorRules)}</p>
          </div>

          <div className="pb-mail-group-editor-actions">
            <Button type="button" variant="secondary" onClick={() => setEditor(null)}>Cancel</Button>
            <Button type="button" onClick={submitEditor} loading={saving}>
              {editor.id ? "Save changes" : "Create group"}
            </Button>
          </div>
        </section>
      ) : null}

      {!groups.length && !editor ? (
        <div className="pb-mail-empty-panel">
          <UsersRound aria-hidden="true" />
          <strong>No groups yet.</strong>
          <p>Create one here, or address a message and choose “Save as group”.</p>
          <Button type="button" onClick={startCreate}>
            <Plus aria-hidden="true" />
            New group
          </Button>
        </div>
      ) : (
        <ul className="pb-mail-group-list">
          {groups.map((group) => (
            <li key={group.id}>
              <div className="pb-mail-group-main">
                <strong>{group.name}</strong>
                <small>{group.description || describeRules(group.rules)}</small>
                <span className="pb-mail-group-count">
                  {counts[group.id] === undefined
                    ? "Counting…"
                    : counts[group.id] === null
                      ? "Count unavailable"
                      : `${counts[group.id].toLocaleString()} eligible`}
                </span>
              </div>
              <div className="pb-mail-group-actions">
                <Button type="button" variant="secondary" size="sm" onClick={() => onComposeToGroup?.(groupChip(group))}>
                  <Send aria-hidden="true" />
                  Email
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(group)} aria-label={`Edit ${group.name}`}>
                  <Pencil aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteTarget(group)} aria-label={`Delete ${group.name}`}>
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
        description="The group is removed. Members and sent email history are not affected."
        confirmLabel="Delete group"
        cancelLabel="Keep group"
        tone="danger"
        busy={saving}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
