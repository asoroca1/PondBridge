import { useCallback, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { Button } from "@pondbridge/ui";
import { UserPlus } from "lucide-react";
import { WorkspaceHeader } from "../../components/admin/AdminUi.jsx";
import { useTenant } from "../../context/TenantContext.jsx";
import { resolveNetworkDisplayName } from "../../lib/campLabels.js";
import useAdminApi from "./useAdminApi.js";
import PeopleAddView from "./people/PeopleAddView.jsx";
import PeopleExportDialog from "./people/PeopleExportDialog.jsx";
import PeopleListView from "./people/PeopleListView.jsx";
import InviteReviewDialog from "./people/InviteReviewDialog.jsx";
import usePeopleDirectory from "./people/usePeopleDirectory.js";
import usePersonActions from "./people/usePersonActions.js";
import { STAGES, stageMeta } from "./people/peopleStages.js";
import TiersWorkspace from "./tiers/TiersWorkspace.jsx";
import "./director-admin-people.css";

const VALID_VIEWS = new Set([...STAGES.map((stage) => stage.key), "add", "tiers"]);

export default function DirectorAdminPeoplePage() {
  const navigate = useNavigate();
  const { view = "all" } = useParams();
  const { slug, request, download } = useAdminApi();
  const { tenant } = useTenant();
  const networkName = resolveNetworkDisplayName(tenant);
  const tieredAccessEnabled =
    (tenant?.config?.modules?.tieredAccess ?? tenant?.modules?.tieredAccess) === true;

  const activeView = VALID_VIEWS.has(view) ? view : "all";
  const stage = activeView === "add" || activeView === "tiers" ? "all" : activeView;

  const directory = usePeopleDirectory({ request, stage });
  const actions = usePersonActions({ request, reload: directory.reload });

  const [inviteTargets, setInviteTargets] = useState([]);
  const [inviteExtras, setInviteExtras] = useState({});
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSelection, setExportSelection] = useState([]);
  const [notice, setNotice] = useState("");

  const openInvite = useCallback((people = [], extras = {}) => {
    if (!people.length) return;
    setNotice("");
    setInviteExtras(extras || {});
    setInviteTargets(people);
  }, []);

  // A bulk decision is the one action where nothing visibly changes except a
  // page of rows disappearing, so it always says what it did.
  const reportBulkResult = useCallback((result) => {
    if (!result) return;
    setNotice(result.ok ? result.message : "");
    if (!result.ok) directory.setError(result.message);
  }, [directory]);

  const emailPeople = useCallback((people = []) => {
    const ids = people.map((person) => person.profileId).filter(Boolean);
    if (!ids.length) return;
    navigate(`/t/${slug}/admin/email/compose?selected=${ids.join(",")}`);
  }, [navigate, slug]);

  const body = useMemo(() => {
    if (activeView === "tiers") {
      return <TiersWorkspace />;
    }
    if (activeView === "add") {
      return (
        <PeopleAddView
          actions={actions}
          storage={directory.storage}
          slug={slug}
          networkName={networkName}
          onDone={() => navigate(`/t/${slug}/admin/people/prospect`)}
        />
      );
    }
    return (
      <PeopleListView
        stage={stage}
        directory={directory}
        actions={actions}
        slug={slug}
        onInvite={openInvite}
        onEmail={emailPeople}
        onExport={(keys = []) => {
          setExportSelection(keys);
          setExportOpen(true);
        }}
        onBulkResult={reportBulkResult}
      />
    );
  }, [actions, activeView, directory, emailPeople, navigate, openInvite, reportBulkResult, slug, stage]);

  return (
    <div className="pb-workspace">
      <WorkspaceHeader
        eyebrow="Your network"
        title={"People"} subtitle={"Everyone connected to your camp, from prospects through to active members."} />
      <section className="pb-people">
      <nav className="pb-people-rail" aria-label="People stages">
        <Button
          type="button"
          className="pb-people-add-button"
          onClick={() => navigate(`/t/${slug}/admin/people/add`)}
        >
          <UserPlus aria-hidden="true" />
          Add people
        </Button>
        <ul>
          {STAGES.map((item) => {
            const count = Number(directory.counts?.[item.key] || 0);
            return (
              <li key={item.key}>
                <NavLink
                  to={`/t/${slug}/admin/people/${item.key}`}
                  className={activeView === item.key ? "is-active" : ""}
                  title={item.blurb}
                >
                  <span>{item.label}</span>
                  {count > 0 ? (
                    <em className={item.urgent ? "pb-people-badge is-urgent" : "pb-people-badge"}>{count}</em>
                  ) : null}
                </NavLink>
              </li>
            );
          })}
        </ul>
        {tieredAccessEnabled ? (
          <ul className="pb-people-rail-extra">
            <li>
              <NavLink
                to={`/t/${slug}/admin/people/tiers`}
                className={activeView === "tiers" ? "is-active" : ""}
                title="Sort people into numbered tiers and choose what each one can use"
              >
                <span>Tiers</span>
              </NavLink>
            </li>
          </ul>
        ) : null}
        <p className="pb-people-rail-note">
          {activeView === "tiers"
            ? "Numbered tiers decide who each member can see, and which features they get."
            : stageMeta(stage).blurb}
        </p>
      </nav>

      <div className="pb-people-surface">
        {directory.error ? <p className="error-text" role="alert">{directory.error}</p> : null}
        {notice ? <p className="success-text" role="status">{notice}</p> : null}
        {body}
      </div>

      <InviteReviewDialog
        open={inviteTargets.length > 0}
        people={inviteTargets}
        extras={inviteExtras}
        actions={actions}
        onClose={() => setInviteTargets([])}
        onSent={(message) => setNotice(message)}
      />

      <PeopleExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        request={request}
        download={download}
        slug={slug}
        stage={stage}
        filters={directory.filters}
        selected={exportSelection}
        listTotal={directory.total}
      />
    </section>
    </div>
  );
}
