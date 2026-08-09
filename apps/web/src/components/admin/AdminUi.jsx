import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";

const ToastContext = createContext(null);

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function useDialogFocus(open, onClose) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const returnFocusTo = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll(FOCUSABLE_SELECTOR) || [])]
      .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    const frame = window.requestAnimationFrame(() => {
      const first = focusable()[0];
      (first || dialog)?.focus?.();
    });

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus?.();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus?.();
    };
  }, [open]);

  return dialogRef;
}

export function ContextBanner({ title, subtitle = "", exitTo = "", exitLabel = "Exit" }) {
  return (
    <div className="pb-admin-ui-context-banner">
      <div className="pb-admin-ui-context-copy">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      {exitTo ? (
        <Link className="pb-admin-ui-context-exit" to={exitTo}>
          {exitLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function SidebarNav({
  title,
  sections = [],
  footer = null,
  className = "",
  navClassName = "",
  linkClassName = "",
  activeLinkClassName = "is-active"
}) {
  return (
    <aside className={classNames("pb-admin-ui-sidebar", className)} aria-label={`${title || "Admin"} navigation`}>
      {title ? <p className="pb-admin-ui-sidebar-title">{title}</p> : null}
      <nav className={classNames("pb-admin-ui-sidebar-nav", navClassName)}>
        {sections.map((item) => {
          if (item.type === "label") {
            return (
              <p key={item.key || item.label} className={classNames("pb-admin-ui-sidebar-group-label", item.className)}>
                {item.label}
              </p>
            );
          }
          const Icon = item.icon || null;
          return (
          <div key={item.key || item.label} className={classNames("pb-admin-ui-sidebar-item", item.className)}>
            {item.children?.length ? (
              <>
                <button
                  type="button"
                  className={classNames("pb-admin-ui-sidebar-toggle", linkClassName, item.toggleClassName, item.isExpanded ? activeLinkClassName : "")}
                  onClick={item.onToggle}
                  aria-expanded={item.isExpanded}
                >
                  <span className="pb-admin-ui-sidebar-link-copy">
                    {Icon ? <Icon className="pb-admin-ui-sidebar-icon" aria-hidden="true" /> : null}
                    <span>{item.label}</span>
                  </span>
                  <span className={classNames("pb-admin-ui-sidebar-caret", item.isExpanded ? "is-open" : "")}>▾</span>
                </button>
                {item.isExpanded ? (
                  <div className="pb-admin-ui-sidebar-subnav">
                    {item.children.map((child) => {
                      const ChildIcon = child.icon || null;
                      return (
                      <NavLink
                        key={child.key || child.label}
                        to={child.to}
                        end={child.end}
                        className={({ isActive }) =>
                          classNames(
                            "pb-admin-ui-sidebar-link",
                            "pb-admin-ui-sidebar-sublink",
                            linkClassName,
                            child.className,
                            isActive ? activeLinkClassName : ""
                          )
                        }
                      >
                        {ChildIcon ? <ChildIcon className="pb-admin-ui-sidebar-icon" aria-hidden="true" /> : null}
                        <span>{child.label}</span>
                      </NavLink>
                      );
                    })}
                  </div>
                ) : null}
              </>
            ) : (
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  classNames(
                    "pb-admin-ui-sidebar-link",
                    linkClassName,
                    item.className,
                    isActive ? activeLinkClassName : ""
                  )
                }
              >
                {Icon ? <Icon className="pb-admin-ui-sidebar-icon" aria-hidden="true" /> : null}
                <span>{item.label}</span>
              </NavLink>
            )}
          </div>
          );
        })}
      </nav>
      {footer ? <div className="pb-admin-ui-sidebar-footer">{footer}</div> : null}
    </aside>
  );
}

export function AdminLayout({ banner = null, sidebar = null, children, className = "" }) {
  return (
    <section className={classNames("pb-admin-ui-scope", className)}>
      {banner}
      <div className="pb-admin-ui-shell">
        {sidebar}
        <div className="pb-admin-ui-main">{children}</div>
      </div>
    </section>
  );
}

export function SuperAdminLayout({ topbar = null, sidebar = null, children, className = "" }) {
  return (
    <div className={classNames("pb-admin-ui-super-shell", className)}>
      {topbar}
      {sidebar}
      <main id="main-content" className="pb-admin-ui-super-main" tabIndex={-1}>{children}</main>
    </div>
  );
}

export function PageHeader({ title, subtitle = "", actions = null, className = "" }) {
  return (
    <header className={classNames("pb-admin-ui-page-header", className)}>
      <div className="pb-admin-ui-page-copy">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="pb-admin-ui-page-actions">{actions}</div> : null}
    </header>
  );
}

/**
 * Page-level hero for the full-width workspaces, matching the billing header
 * treatment: eyebrow, oversized title, subtitle, optional status chips and
 * actions. PageHeader sits inside a Card and cannot fill this role.
 */
export function WorkspaceHeader({
  eyebrow = "",
  title,
  subtitle = "",
  meta = null,
  actions = null
}) {
  return (
    <header className="pb-workspace-header">
      <div className="pb-workspace-header-copy">
        {eyebrow ? <p className="pb-workspace-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="pb-workspace-subtitle">{subtitle}</p> : null}
        {meta ? <div className="pb-workspace-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="pb-workspace-header-actions">{actions}</div> : null}
    </header>
  );
}

export function FilterBar({ children, className = "" }) {
  return <div className={classNames("pb-admin-ui-filter-bar", className)}>{children}</div>;
}

export function DataTable({ children, minWidth = 760, className = "", tableClassName = "" }) {
  return (
    <div className={classNames("pb-admin-ui-table-wrap", className)}>
      <table className={classNames("pb-admin-ui-table", tableClassName)} style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function SlideOverPanel({ open, title, subtitle = "", onClose, footer = null, children }) {
  const titleId = useId();
  const dialogRef = useDialogFocus(open, onClose);
  if (!open) return null;
  return (
    <div
      className="pb-admin-ui-slideover-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <aside
        ref={dialogRef}
        className="pb-admin-ui-slideover"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="pb-admin-ui-slideover-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="pb-admin-ui-slideover-close" onClick={onClose} aria-label="Close panel">
            ×
          </button>
        </header>
        <div className="pb-admin-ui-slideover-body">{children}</div>
        {footer ? <div className="pb-admin-ui-slideover-foot">{footer}</div> : null}
      </aside>
    </div>
  );
}

export function ModalDialog({
  open,
  title,
  description = "",
  onClose,
  children,
  footer = null,
  backdropClassName = "",
  className = ""
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialogFocus(open, onClose);
  if (!open) return null;
  return (
    <div
      className={classNames("pb-admin-ui-modal-backdrop", backdropClassName)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className={classNames("pb-admin-ui-modal", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <h3 id={titleId}>{title}</h3>
        {description ? <p id={descriptionId}>{description}</p> : null}
        {children}
        {footer ? <div className="pb-admin-ui-modal-actions">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ModalConfirm({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
  backdropClassName = "",
  className = ""
}) {
  return (
    <ModalDialog
      open={open}
      title={title}
      description={description}
      onClose={busy ? undefined : onCancel}
      backdropClassName={backdropClassName}
      className={className}
      footer={
        <>
          <button type="button" className="link-button secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={classNames("link-button", tone === "danger" ? "is-danger" : "")}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </>
      }
    />
  );
}

export function EmptyState({ title, description = "", actions = null }) {
  return (
    <div className="pb-admin-ui-empty-state">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {actions ? <div className="pb-admin-ui-empty-actions">{actions}</div> : null}
    </div>
  );
}

export function LoadingSkeleton({ lines = 3 }) {
  return (
    <div className="pb-admin-ui-loading">
      {Array.from({ length: lines }).map((_, index) => (
        <span key={index} className="pb-admin-ui-loading-line" />
      ))}
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((message, tone = "neutral", timeoutMs = 3000) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { id, message, tone }]);
    if (timeoutMs > 0) {
      window.setTimeout(() => dismiss(id), timeoutMs);
    }
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length ? (
        <div className="pb-admin-ui-toast-wrap" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={classNames("pb-admin-ui-toast", `tone-${toast.tone}`)}>
              <span>{toast.message}</span>
              <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => null,
      dismiss: () => null
    };
  }
  return ctx;
}
