import { useRef } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Textarea } from "@pondbridge/ui";
import "./agent-workspace.css";

function MessageLinks({ links = [], onEvidenceClick = null }) {
  const safeLinks = Array.isArray(links) ? links.filter((item) => item?.href && item?.label) : [];
  if (!safeLinks.length) return null;

  return (
    <div className="agent-message-links" aria-label="Verify in PondBridge">
      {safeLinks.map((item) => (
        <Link
          key={`${item.href}:${item.label}`}
          to={item.href}
          onClick={() => onEvidenceClick?.(item)}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

export function AgentConversation({ messages = [], busy = false, responseRef = null, onEvidenceClick = null }) {
  const isBrief = messages.length <= 1 && !busy;
  return (
    <div
      className={`agent-conversation ${isBrief ? "is-brief" : ""}`.trim()}
      aria-live="polite"
      aria-busy={busy || undefined}
    >
      {messages.map((message, index) => {
        const isLatestAssistant =
          message.role === "assistant" &&
          !messages.slice(index + 1).some((candidate) => candidate.role === "assistant");
        return (
          <article
            key={message.id}
            ref={isLatestAssistant ? responseRef : undefined}
            tabIndex={isLatestAssistant ? -1 : undefined}
            className={`agent-message agent-message-${message.role}`}
          >
            <p className="agent-message-label">{message.role === "user" ? "You" : message.author || "PondBridge Guide"}</p>
            <div className="agent-message-content">{message.content}</div>
            <MessageLinks links={message.links} onEvidenceClick={onEvidenceClick} />
            {message.disclaimer ? <small className="agent-message-disclaimer">{message.disclaimer}</small> : null}
          </article>
        );
      })}
      {busy ? (
        <div className="agent-thinking" role="status">
          <span aria-hidden="true" />
          Checking live PondBridge data…
        </div>
      ) : null}
    </div>
  );
}

export function AgentComposer({
  id,
  question,
  onQuestionChange,
  onSubmit,
  onStarterSelect = null,
  starters = [],
  busy = false,
  disabled = false,
  label = "What would you like help with?",
  placeholder = "Ask a question about the current PondBridge data…",
  privacyNote = "Do not enter passwords, access codes, payment details, or private member information.",
  submitLabel = "Ask PondBridge"
}) {
  const helpId = `${id}-help`;
  const textareaRef = useRef(null);

  function selectStarter(starter) {
    if (onStarterSelect) {
      onStarterSelect(starter);
      return;
    }
    onQuestionChange(starter);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div className="agent-composer-wrap">
      {starters.length ? (
        <div className="agent-starters" aria-label="Suggested questions">
          {starters.map((starter) => (
            <Button
              key={starter}
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || disabled}
              onClick={() => selectStarter(starter)}
            >
              {starter}
            </Button>
          ))}
        </div>
      ) : null}
      <form className="agent-composer" onSubmit={onSubmit}>
        <label htmlFor={id}>{label}</label>
        <Textarea
          id={id}
          ref={textareaRef}
          rows={3}
          maxLength={2000}
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          placeholder={placeholder}
          aria-describedby={helpId}
          disabled={disabled}
        />
        <div className="agent-composer-footer">
          <small id={helpId}>{privacyNote}</small>
          <Button type="submit" disabled={disabled || busy || !question.trim()} loading={busy}>
            {busy ? "Checking…" : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function AgentWorkspace({
  eyebrow,
  title,
  subtitle,
  status,
  boundary,
  messages,
  responseRef,
  onEvidenceClick,
  busy,
  composer,
  rail,
  children
}) {
  return (
    <div className="agent-workspace">
      <Card className="agent-workspace-main">
        <header className="agent-workspace-header">
          <div>
            {eyebrow ? <p className="agent-workspace-eyebrow">{eyebrow}</p> : null}
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {status ? <div className="agent-workspace-status">{status}</div> : null}
        </header>
        {boundary ? (
          <details className="agent-boundary">
            <summary>Safety, privacy &amp; agent limits</summary>
            <div className="agent-boundary-copy">{boundary}</div>
          </details>
        ) : null}
        <AgentConversation
          messages={messages}
          busy={busy}
          responseRef={responseRef}
          onEvidenceClick={onEvidenceClick}
        />
        <AgentComposer {...composer} busy={busy} />
        {children}
      </Card>
      <aside className="agent-workspace-rail" aria-label="Live plan and evidence">
        {rail}
      </aside>
    </div>
  );
}
