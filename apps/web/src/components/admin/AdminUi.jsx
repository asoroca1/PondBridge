import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";

const ToastContext = createContext(null);

function classNames(...values) {
  return values.filter(Boolean).join(" ");
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
  className = "",
  navClassName = "",
  linkClassName = "",
  activeLinkClassName = "is-active"
}) {
  return (
    <aside className={classNames("pb-admin-ui-sidebar", className)} aria-label={`${title || "Admin"} navigation`}>
      {title ? <p className="pb-admin-ui-sidebar-title">{title}</p> : null}
      <nav className={classNames("pb-admin-ui-sidebar-nav", navClassName)}>
        {sections.map((item) => (
          <div key={item.key || item.label} className={classNames("pb-admin-ui-sidebar-item", item.className)}>
            {item.children?.length ? (
              <>
                <button
                  type="button"
                  className={classNames("pb-admin-ui-sidebar-toggle", linkClassName, item.toggleClassName, item.isExpanded ? activeLinkClassName : "")}
                  onClick={item.onToggle}
                  aria-expanded={item.isExpanded}
                >
                  <span>{item.label}</span>
                  <span className={classNames("pb-admin-ui-sidebar-caret", item.isExpanded ? "is-open" : "")}>▾</span>
                </button>
                {item.isExpanded ? (
                  <div className="pb-admin-ui-sidebar-subnav">
                    {item.children.map((child) => (
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
                        {child.label}
                      </NavLink>
                    ))}
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
                {item.label}
              </NavLink>
            )}
          </div>
        ))}
      </nav>
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
      <main className="pb-admin-ui-super-main">{children}</main>
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
  if (!open) return null;
  return (
    <div className="pb-admin-ui-slideover-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <aside className="pb-admin-ui-slideover" onClick={(event) => event.stopPropagation()}>
        <header className="pb-admin-ui-slideover-head">
          <div>
            <h2>{title}</h2>
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

export function ModalConfirm({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel
}) {
  if (!open) return null;
  return (
    <div className="pb-admin-ui-modal-backdrop" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="pb-admin-ui-modal" onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="pb-admin-ui-modal-actions">
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
        </div>
      </div>
    </div>
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
