import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Textarea } from "@pondbridge/ui";
import { ArrowDown, ArrowUp, ChevronRight, ShieldCheck, Sparkles } from "lucide-react";
import "./agent-workspace.css";

function resultInitials(label = "") {
  return String(label || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function MessageLinks({ links = [], onEvidenceClick = null }) {
  const safeLinks = Array.isArray(links) ? links.filter((item) => item?.href && item?.label) : [];
  if (!safeLinks.length) return null;
  const profileLinks = safeLinks.filter((item) => item.presentation === "profile");
  const actionLinks = safeLinks.filter((item) => item.presentation !== "profile");

  return (
    <>
      {profileLinks.length ? (
        <div className="agent-profile-results" aria-label="Member recommendations">
          {profileLinks.map((item) => (
            <Link
              key={`${item.href}:${item.label}`}
              className="agent-profile-result"
              to={item.href}
              onClick={() => onEvidenceClick?.(item)}
              aria-label={`${item.label}${item.description ? `, ${item.description}` : ""}, view profile`}
            >
              <span className="agent-profile-avatar" aria-hidden="true">
                {item.initials || resultInitials(item.label)}
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                ) : null}
              </span>
              <span className="agent-profile-copy">
                <strong>{item.label}</strong>
                {item.description ? <small>{item.description}</small> : null}
              </span>
              <ChevronRight className="agent-profile-arrow" size={17} aria-hidden="true" />
            </Link>
          ))}
        </div>
      ) : null}
      {actionLinks.length ? (
        <div className="agent-message-links" aria-label="Related camp links">
          {actionLinks.map((item) => (
            <Link
              key={`${item.href}:${item.label}`}
              to={item.href}
              onClick={() => onEvidenceClick?.(item)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function AgentConversation({
  messages = [],
  busy = false,
  responseRef = null,
  onEvidenceClick = null,
  assistantName = "Camp AI",
  emptyState = null,
  thinkingLabel = ""
}) {
  const scrollRef = useRef(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const isBrief = messages.length <= 1 && !busy;
  const latestDisclaimerIndex = new Map();
  messages.forEach((message, index) => {
    if (message?.disclaimer) latestDisclaimerIndex.set(message.disclaimer, index);
  });

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setShowScrollButton(false);
  }, [busy, messages]);

  function scrollToLatest() {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    setShowScrollButton(false);
  }

  function updateScrollButton(event) {
    const container = event.currentTarget;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollButton(distanceFromBottom > 72);
  }

  return (
    <div className="agent-conversation-frame">
      <div
        ref={scrollRef}
        className={`agent-conversation ${isBrief ? "is-brief" : ""}`.trim()}
        aria-live="polite"
        aria-busy={busy || undefined}
        onScroll={updateScrollButton}
      >
        {!messages.length && emptyState ? (
          <div className="agent-empty-state">
            <span className="agent-empty-icon" aria-hidden="true"><Sparkles size={22} /></span>
            <h2>{emptyState.title}</h2>
            {emptyState.description ? <p>{emptyState.description}</p> : null}
          </div>
        ) : null}
        {messages.map((message, index) => {
          const isLatestAssistant =
            message.role === "assistant" &&
            !messages.slice(index + 1).some((candidate) => candidate.role === "assistant");
          const shouldShowDisclaimer =
            Boolean(message.disclaimer) &&
            latestDisclaimerIndex.get(message.disclaimer) === index;
          return (
            <article
              key={message.id}
              ref={isLatestAssistant ? responseRef : undefined}
              tabIndex={isLatestAssistant ? -1 : undefined}
              className={`agent-message agent-message-${message.role}`}
            >
              <p className="agent-message-label">
                {message.role === "assistant" ? <Sparkles size={13} aria-hidden="true" /> : null}
                <span>{message.role === "user" ? "You" : message.author || assistantName}</span>
              </p>
              <div className="agent-message-content">{message.content}</div>
              <MessageLinks links={message.links} onEvidenceClick={onEvidenceClick} />
              {shouldShowDisclaimer ? (
                <small className="agent-message-disclaimer">
                  <ShieldCheck size={14} aria-hidden="true" />
                  <span>{message.disclaimer}</span>
                </small>
              ) : null}
            </article>
          );
        })}
        {busy ? (
          <div className="agent-thinking" role="status">
            <span aria-hidden="true" />
            {thinkingLabel || `${assistantName} is thinking…`}
          </div>
        ) : null}
      </div>
      {messages.length > 2 && showScrollButton ? (
        <button
          type="button"
          className="agent-scroll-latest"
          onClick={scrollToLatest}
          aria-label="Scroll to the latest message"
        >
          <ArrowDown size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function submitOnEnter(event) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
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
  placeholder = "Ask a question about your camp community…",
  privacyNote = "Do not enter passwords, access codes, payment details, or private member information.",
  submitLabel = "Send"
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
        <label className="agent-composer-label" htmlFor={id}>{label}</label>
        <div className="agent-prompt-input">
          <Textarea
            id={id}
            ref={textareaRef}
            rows={2}
            maxLength={2000}
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            onKeyDown={submitOnEnter}
            placeholder={placeholder}
            aria-describedby={helpId}
            disabled={disabled}
          />
          <Button
            type="submit"
            className="agent-prompt-submit"
            aria-label={submitLabel}
            title={submitLabel}
            disabled={disabled || busy || !question.trim()}
            loading={busy}
          >
            {busy ? null : <ArrowUp size={18} aria-hidden="true" />}
          </Button>
        </div>
        <div className="agent-composer-footer">
          <small id={helpId}>{privacyNote}</small>
          <span aria-hidden="true">Enter to send · Shift+Enter for a new line</span>
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
  children,
  variant = "workspace",
  assistantName = "Camp AI",
  emptyState = null,
  thinkingLabel = "",
  boundaryLabel = "Safety, privacy & agent limits"
}) {
  const hasRail = Boolean(rail);
  return (
    <div
      className={`agent-workspace agent-workspace-${variant} ${hasRail ? "has-rail" : "is-single-column"}`.trim()}
    >
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
            <summary>
              <ShieldCheck size={15} aria-hidden="true" />
              <span>{boundaryLabel}</span>
            </summary>
            <div className="agent-boundary-copy">{boundary}</div>
          </details>
        ) : null}
        <AgentConversation
          messages={messages}
          busy={busy}
          responseRef={responseRef}
          onEvidenceClick={onEvidenceClick}
          assistantName={assistantName}
          emptyState={emptyState}
          thinkingLabel={thinkingLabel}
        />
        <AgentComposer {...composer} busy={busy} />
        {children}
      </Card>
      {hasRail ? (
        <aside className="agent-workspace-rail" aria-label="Live plan and evidence">
          {rail}
        </aside>
      ) : null}
    </div>
  );
}
