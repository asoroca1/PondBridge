import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@pondbridge/ui";
import {
  CalendarClock,
  FileText,
  LayoutTemplate,
  PenSquare,
  Send,
  ShieldBan,
  UsersRound
} from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import useAdminApi from "./useAdminApi.js";
import MailBlockedView from "./mail/MailBlockedView.jsx";
import MailComposeView from "./mail/MailComposeView.jsx";
import MailGroupsView from "./mail/MailGroupsView.jsx";
import MailMessagesView from "./mail/MailMessagesView.jsx";
import MailSignatureDialog from "./mail/MailSignatureDialog.jsx";
import MailTemplatesView from "./mail/MailTemplatesView.jsx";
import useMailWorkspace from "./mail/useMailWorkspace.js";
import {
  GROWTH_SEGMENT_OPTIONS,
  chipsFromTargeting,
  dedupeChips,
  personChip,
  segmentChip
} from "./mail/mailAudience.js";
import "./director-admin-mail.css";

const FOLDERS = [
  { key: "compose", label: "Compose", icon: PenSquare },
  { key: "drafts", label: "Drafts", icon: FileText },
  { key: "scheduled", label: "Scheduled", icon: CalendarClock },
  { key: "sent", label: "Sent", icon: Send },
  { type: "divider", key: "divider" },
  { key: "groups", label: "Groups", icon: UsersRound },
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "blocked", label: "Blocked", icon: ShieldBan }
];

function emptyCompose() {
  return {
    chips: [],
    subject: "",
    preheader: "",
    body: "",
    aiGenerationId: "",
    scheduleType: "now",
    scheduledFor: "",
    draftId: ""
  };
}

export default function DirectorAdminMailPage() {
  const navigate = useNavigate();
  const { folder = "compose" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { slug, request } = useAdminApi();
  const { tenant } = useTenant();
  const { user } = useAuth();

  const workspace = useMailWorkspace({ request, slug, tenant, user });
  const [compose, setCompose] = useState(emptyCompose);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [counts, setCounts] = useState({ drafts: 0, scheduled: 0 });
  const [seeded, setSeeded] = useState(false);

  const activeFolder = FOLDERS.some((item) => item.key === folder && item.type !== "divider") ? folder : "compose";

  const goToFolder = useCallback((next) => {
    navigate(`/t/${slug}/admin/email/${next}`);
  }, [navigate, slug]);

  const refreshCounts = useCallback(async () => {
    const [drafts, scheduled] = await Promise.allSettled([
      request("/email/drafts?limit=30"),
      request("/email/history?status=scheduled&limit=30")
    ]);
    setCounts({
      drafts: drafts.status === "fulfilled" ? Number(drafts.value?.total || drafts.value?.items?.length || 0) : 0,
      scheduled: scheduled.status === "fulfilled" ? Number(scheduled.value?.total || scheduled.value?.items?.length || 0) : 0
    });
  }, [request]);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  // Seed the composer from deep links: the members table sends ?selected=, the
  // onboarding agent sends ?audience=/?subject=/?body=.
  useEffect(() => {
    if (seeded || workspace.loading) return;
    const selected = String(searchParams.get("selected") || "").trim();
    const audience = String(searchParams.get("audience") || "").trim().toLowerCase();
    const subject = String(searchParams.get("subject") || "");
    const body = String(searchParams.get("body") || "");
    const preheader = String(searchParams.get("preheader") || "");
    if (!selected && !audience && !subject && !body) {
      setSeeded(true);
      return;
    }

    const ids = selected.split(",").map((item) => item.trim()).filter(Boolean);
    const chips = ids.map((id) => personChip({ id, fullName: `Member ${id.slice(0, 6)}` }));
    if (GROWTH_SEGMENT_OPTIONS.some((item) => item.value === audience)) chips.push(segmentChip(audience));

    setCompose((prev) => ({
      ...prev,
      chips: dedupeChips([...prev.chips, ...chips]),
      subject: subject || prev.subject,
      preheader: preheader || prev.preheader,
      body: body || prev.body
    }));
    setSeeded(true);
    setSearchParams({}, { replace: true });

    // Fill in real names for the ids we were handed.
    if (ids.length) {
      request(`/members/lookup?ids=${encodeURIComponent(ids.join(","))}`)
        .then((payload) => {
          const items = Array.isArray(payload?.items) ? payload.items : [];
          if (!items.length) return;
          const byId = Object.fromEntries(items.map((item) => [String(item.id), item]));
          setCompose((prev) => ({
            ...prev,
            chips: prev.chips.map((chip) => (
              chip.kind === "person" && byId[chip.key.slice("person:".length)]
                ? personChip(byId[chip.key.slice("person:".length)])
                : chip
            ))
          }));
        })
        .catch(() => {});
    }
  }, [request, searchParams, seeded, setSearchParams, workspace.loading]);

  const openDraft = useCallback((draft) => {
    setCompose({
      ...emptyCompose(),
      draftId: String(draft?.id || ""),
      subject: String(draft?.subject || ""),
      preheader: String(draft?.preheader || ""),
      body: String(draft?.body || ""),
      chips: chipsFromTargeting(draft?.targeting || {}, { groups: workspace.groups })
    });
    goToFolder("compose");
  }, [goToFolder, workspace.groups]);

  const copyAsNew = useCallback((message) => {
    setCompose({
      ...emptyCompose(),
      subject: String(message?.subject || ""),
      preheader: String(message?.preheader || ""),
      body: String(message?.body || ""),
      chips: chipsFromTargeting(message?.targeting || {}, { groups: workspace.groups })
    });
    goToFolder("compose");
  }, [goToFolder, workspace.groups]);

  const composeToGroup = useCallback((chip) => {
    setCompose((prev) => ({ ...prev, chips: dedupeChips([...prev.chips, chip]) }));
    goToFolder("compose");
  }, [goToFolder]);

  const useTemplate = useCallback((template) => {
    setCompose((prev) => ({
      ...prev,
      subject: String(template?.subject || ""),
      preheader: String(template?.preheader || ""),
      body: String(template?.body || ""),
      aiGenerationId: ""
    }));
    goToFolder("compose");
  }, [goToFolder]);

  const handleSent = useCallback((kind) => {
    setCompose(emptyCompose());
    refreshCounts();
    goToFolder(kind === "scheduled" ? "scheduled" : "sent");
  }, [goToFolder, refreshCounts]);

  const draftDirty = Boolean(compose.subject.trim() || compose.body.trim() || compose.chips.length);

  const body = useMemo(() => {
    if (activeFolder === "compose") {
      return (
        <MailComposeView
          request={request}
          slug={slug}
          tenant={tenant}
          compose={compose}
          setCompose={setCompose}
          workspace={workspace}
          onOpenSignature={() => setSignatureOpen(true)}
          onSent={handleSent}
          onDraftSaved={refreshCounts}
        />
      );
    }
    if (activeFolder === "groups") {
      return <MailGroupsView request={request} workspace={workspace} onComposeToGroup={composeToGroup} />;
    }
    if (activeFolder === "templates") {
      return <MailTemplatesView workspace={workspace} onUseTemplate={useTemplate} />;
    }
    if (activeFolder === "blocked") {
      return <MailBlockedView request={request} />;
    }
    return (
      <MailMessagesView
        folder={activeFolder}
        request={request}
        onEditDraft={openDraft}
        onCopyAsNew={copyAsNew}
        onChanged={refreshCounts}
      />
    );
  }, [
    activeFolder,
    compose,
    composeToGroup,
    copyAsNew,
    handleSent,
    openDraft,
    refreshCounts,
    request,
    slug,
    tenant,
    useTemplate,
    workspace
  ]);

  return (
    <section className="pb-mail">
      <nav className="pb-mail-rail" aria-label="Mail folders">
        <Button
          type="button"
          className="pb-mail-new-button"
          onClick={() => {
            if (activeFolder !== "compose") goToFolder("compose");
          }}
        >
          <PenSquare aria-hidden="true" />
          New message
        </Button>
        <ul>
          {FOLDERS.map((item) => {
            if (item.type === "divider") return <li key={item.key} className="pb-mail-rail-divider" aria-hidden="true" />;
            const Icon = item.icon;
            const badge = item.key === "drafts"
              ? counts.drafts
              : item.key === "scheduled"
                ? counts.scheduled
                : item.key === "groups"
                  ? workspace.groups.length
                  : item.key === "templates"
                    ? workspace.templates.length
                    : 0;
            return (
              <li key={item.key}>
                <NavLink
                  to={`/t/${slug}/admin/email/${item.key}`}
                  className={({ isActive }) => (isActive || activeFolder === item.key ? "is-active" : "")}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.key === "compose" && draftDirty ? (
                    <em className="pb-mail-rail-dot" title="Unsent message" />
                  ) : badge > 0 ? (
                    <em className="pb-mail-rail-badge">{badge}</em>
                  ) : null}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="pb-mail-surface">{body}</div>

      <MailSignatureDialog open={signatureOpen} onClose={() => setSignatureOpen(false)} workspace={workspace} />
    </section>
  );
}
