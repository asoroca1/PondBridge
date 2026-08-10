import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Building2,
  Image,
  KeyRound,
  LifeBuoy,
  Bell,
  ShieldAlert,
  SlidersHorizontal,
  UserCog
} from "lucide-react";
import "./director-admin-settings.css";

// Grouped by what a director is actually trying to do, so the list reads as
// three short sections instead of eight flat items. `blurb` has to stay short
// enough for the rail; `description` is the fuller sentence the page header
// shows, which is why the pages themselves no longer repeat their own name.
const GROUPS = [
  {
    key: "network",
    label: "Your network",
    items: [
      {
        to: "network",
        label: "Identity",
        icon: Building2,
        blurb: "Name, welcome text, contact details",
        description: "How your camp appears across login, the homepage, and emails."
      },
      {
        to: "branding",
        label: "Branding",
        icon: Image,
        blurb: "Logo, colours, hero images",
        description: "Your logo, colours, and hero images, everywhere members see them."
      },
      {
        to: "features",
        label: "Features",
        icon: SlidersHorizontal,
        blurb: "Which modules members can use",
        description: "Choose what members can use, then finish any services that still need setup."
      }
    ]
  },
  {
    key: "people",
    label: "Access & people",
    items: [
      {
        to: "access",
        label: "Who can join",
        icon: KeyRound,
        blurb: "Signup mode, access codes, domains",
        description: "How someone gets in: signup mode, join codes, and email domain limits."
      },
      {
        to: "admins",
        label: "Admins",
        icon: UserCog,
        blurb: "Who else can run this network",
        description: "Who else can run this network, and what they are allowed to change."
      }
    ]
  },
  {
    key: "operations",
    label: "Operations",
    items: [
      {
        to: "notifications",
        label: "Mobile alerts",
        icon: Bell,
        blurb: "Push notification settings",
        description: "Notifications sent to phones with the app installed. Nothing here emails anyone."
      },
      {
        to: "support",
        label: "Support",
        icon: LifeBuoy,
        blurb: "Contact PondBridge for help",
        description: "Send a message to PondBridge about setup, billing, data, or a bug."
      },
      {
        to: "danger",
        label: "Danger zone",
        icon: ShieldAlert,
        blurb: "Pause or delete this network",
        description: "Pause this network, or request that it be deleted.",
        tone: "danger"
      }
    ]
  }
];

/**
 * Settings gets the same shape as the other workspaces: a rail that names every
 * tab and what it controls, so a director can find a setting without opening
 * each page to remember what lives there.
 */
export default function DirectorAdminSettingsLayout() {
  const location = useLocation();
  const active = GROUPS
    .flatMap((group) => group.items)
    .find((item) => location.pathname.endsWith(`/settings/${item.to}`));

  return (
    <section className="pb-settings">
      <nav className="pb-settings-rail" aria-label="Settings sections">
        {GROUPS.map((group) => (
          <div key={group.key}>
            <h2>{group.label}</h2>
            <ul>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) => `${isActive ? "is-active" : ""} ${item.tone === "danger" ? "is-danger" : ""}`.trim()}
                    >
                      <Icon aria-hidden="true" />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.blurb}</small>
                      </span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="pb-settings-surface">
        {active ? (
          <header className="pb-settings-head">
            <h1>{active.label}</h1>
            <p>{active.description || active.blurb}</p>
          </header>
        ) : null}
        <div className="pb-settings-body">
          <Outlet />
        </div>
      </div>
    </section>
  );
}
