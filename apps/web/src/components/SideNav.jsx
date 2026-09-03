import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import { openExternalUrl } from "../lib/externalLinks.js";
import { preloadRouteForPath } from "../lib/routePreload.js";
import { useMemberNavSections } from "../hooks/useMemberNav.js";
import { useEndSession } from "../hooks/useEndSession.js";
import "./side-nav.css";

// Compare the pathname only: several items carry a query string (chat rooms)
// and would never match if it were included.
function pathOf(to = "") {
  return String(to).split("?")[0].replace(/\/$/, "") || "/";
}

export function isCurrentNavPath(itemTo, currentPath) {
  const target = pathOf(itemTo);
  const here = pathOf(currentPath);
  if (target === here) return true;
  // Keep the parent lit on detail routes (a single event, one profile).
  return target !== "/" && here.startsWith(`${target}/`);
}

export default function SideNav({ collapsed = false, onToggleCollapsed }) {
  const sections = useMemberNavSections();
  const location = useLocation();
  const navigate = useNavigate();
  const endSession = useEndSession();

  const currentPath = location.pathname || "/";

  const openItem = useCallback(
    (item) => {
      if (item.href) {
        openExternalUrl(item.href).catch(() => {});
        return;
      }
      navigate(item.to);
    },
    [navigate]
  );

  if (!sections.length) return null;

  return (
    <nav
      className={`side-nav ${collapsed ? "is-collapsed" : ""}`.trim()}
      aria-label="Member navigation"
    >
      <div className="side-nav-scroll">
        {sections.map((section) => (
          <div key={section.id} className="side-nav-section">
            {section.title ? (
              <p className="side-nav-section-title" aria-hidden={collapsed ? "true" : undefined}>
                {section.title}
              </p>
            ) : null}
            {section.items.map((item) => {
              const current = !item.href && isCurrentNavPath(item.to, currentPath);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`side-nav-item ${current ? "is-current" : ""}`.trim()}
                  aria-current={current ? "page" : undefined}
                  title={collapsed ? item.label : undefined}
                  onPointerEnter={() => {
                    if (!item.href) preloadRouteForPath(item.to);
                  }}
                  onFocus={() => {
                    if (!item.href) preloadRouteForPath(item.to);
                  }}
                  onClick={() => openItem(item)}
                >
                  <item.icon size={18} aria-hidden="true" />
                  <span className="side-nav-item-label">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="side-nav-footer">
        <button
          type="button"
          className="side-nav-item side-nav-logout"
          title={collapsed ? "Log Out" : undefined}
          onClick={() => endSession()}
        >
          <LogOut size={18} aria-hidden="true" />
          <span className="side-nav-item-label">Log Out</span>
        </button>
        <button
          type="button"
          className="side-nav-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={() => onToggleCollapsed?.()}
        >
          {collapsed ? (
            <ChevronsRight size={18} aria-hidden="true" />
          ) : (
            <ChevronsLeft size={18} aria-hidden="true" />
          )}
          <span className="side-nav-item-label">Collapse</span>
        </button>
      </div>
    </nav>
  );
}
