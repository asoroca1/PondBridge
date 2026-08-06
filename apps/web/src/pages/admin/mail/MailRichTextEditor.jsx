import { useEffect, useRef, useState } from "react";
import { Bold, Italic, Link2, List, ListOrdered } from "lucide-react";
import { Button, Input } from "@pondbridge/ui";
import { ModalDialog } from "../../../components/admin/AdminUi.jsx";

const MERGE_TAGS = [
  { tag: "firstName", label: "First name" },
  { tag: "lastName", label: "Last name" }
];

export default function MailRichTextEditor({
  value = "",
  onChange,
  placeholder = "Write your message…"
}) {
  const editorRef = useRef(null);
  const linkSelectionRef = useRef(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    if (!editorRef.current) return;
    if (document.activeElement === editorRef.current) return;
    if (editorRef.current.innerHTML !== (value || "")) {
      editorRef.current.innerHTML = value || "";
    }
  }, [value]);

  // Without this the browser wraps each line in a bare <div>, which the server
  // sanitizer has to rewrite. Emitting <p> keeps what you type and what sends
  // identical.
  useEffect(() => {
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch { /* Not supported everywhere; the server normalizes as a fallback. */ }
  }, []);

  function handleInput() {
    if (!editorRef.current) return;
    onChange(editorRef.current.innerHTML);
  }

  function exec(command, arg = null) {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    handleInput();
  }

  function openLinkDialog() {
    const selection = window.getSelection?.();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    linkSelectionRef.current = range && editorRef.current?.contains(range.commonAncestorContainer)
      ? range.cloneRange()
      : null;
    setLinkUrl("");
    setLinkError("");
    setLinkDialogOpen(true);
  }

  function closeLinkDialog() {
    setLinkDialogOpen(false);
    setLinkError("");
    linkSelectionRef.current = null;
  }

  function applyLink() {
    const rawUrl = String(linkUrl || "").trim();
    if (!rawUrl) {
      setLinkError("Enter a link URL.");
      return;
    }
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      setLinkError("Enter a valid URL.");
      return;
    }
    if (!new Set(["http:", "https:", "mailto:"]).has(parsed.protocol)) {
      setLinkError("Use an http, https, or mailto link.");
      return;
    }
    editorRef.current?.focus();
    if (linkSelectionRef.current) {
      const selection = window.getSelection?.();
      selection?.removeAllRanges();
      selection?.addRange(linkSelectionRef.current);
    }
    exec("createLink", parsed.href);
    closeLinkDialog();
  }

  function insertMergeTag(tag) {
    editorRef.current?.focus();
    document.execCommand("insertText", false, `{{${tag}}}`);
    handleInput();
  }

  const isEmpty = !value || value === "<br>" || value === "<p><br></p>" || value === "<div><br></div>";

  return (
    <>
      <div className="pb-mail-editor">
        <div className="pb-mail-editor-toolbar" role="toolbar" aria-label="Formatting">
          <button type="button" title="Bold" onClick={() => exec("bold")}><Bold aria-hidden="true" /></button>
          <button type="button" title="Italic" onClick={() => exec("italic")}><Italic aria-hidden="true" /></button>
          <button type="button" title="Bulleted list" onClick={() => exec("insertUnorderedList")}><List aria-hidden="true" /></button>
          <button type="button" title="Numbered list" onClick={() => exec("insertOrderedList")}><ListOrdered aria-hidden="true" /></button>
          <button type="button" title="Insert link" onClick={openLinkDialog}><Link2 aria-hidden="true" /></button>
          <span className="pb-mail-editor-sep" aria-hidden="true" />
          {MERGE_TAGS.map((item) => (
            <button
              key={item.tag}
              type="button"
              className="pb-mail-merge-tag"
              title={`Insert the recipient's ${item.label.toLowerCase()}`}
              onClick={() => insertMergeTag(item.tag)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div
          ref={editorRef}
          className="pb-mail-editor-body"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label="Message body"
          aria-multiline="true"
          onInput={handleInput}
          data-placeholder={placeholder}
          data-empty={isEmpty ? "true" : undefined}
        />
      </div>

      <ModalDialog
        open={linkDialogOpen}
        title="Insert link"
        description="Add the destination for the selected text."
        onClose={closeLinkDialog}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeLinkDialog}>Cancel</Button>
            <Button type="button" onClick={applyLink}>Insert link</Button>
          </>
        }
      >
        <label className="director-admin-dialog-field">
          Link URL
          <Input
            type="url"
            value={linkUrl}
            onChange={(event) => {
              setLinkUrl(event.target.value);
              setLinkError("");
            }}
            placeholder="https://example.org"
            aria-invalid={Boolean(linkError)}
          />
        </label>
        {linkError ? <p className="error-text" role="alert">{linkError}</p> : null}
      </ModalDialog>
    </>
  );
}
