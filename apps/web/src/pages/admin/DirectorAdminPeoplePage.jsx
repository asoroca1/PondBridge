import { useCallback, useMemo, useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { Button } from "@pondbridge/ui";
import { UserPlus } from "lucide-react";
import { WorkspaceHeader } from "../../components/admin/AdminUi.jsx";
import useAdminApi from "./useAdminApi.js";
import PeopleAddView from "./people/PeopleAddView.jsx";
import PeopleExportDialog from "./people/PeopleExportDialog.jsx";
import PeopleListView from "./people/PeopleListView.jsx";
import InviteReviewDialog from "./people/InviteReviewDialog.jsx";
import usePeopleDirectory from "./people/usePeopleDirectory.js";
import usePersonActions from "./people/usePersonActions.js";
import { STAGES, stageMeta } from "./people/peopleStages.js";
import "./director-admin-people.css";

const VALID_VIEWS = new Set([...STAGES.map((stage) => stage.key), "add"]);

export default function DirectorAdminPeoplePage() {
  const navigate = useNavigate();
  const { view = "all" } = useParams();
  const { slug, request, download } = useAdminApi();

  const activeView = VALID_VIEWS.has(view) ? view : "all";
  const stage = activeView === "add" ? "all" : activeView;

  const directory = usePeopleDirectory({ request, stage });
  const actions = usePersonActions({ request, reload: directory.reload });

  const [inviteTargets, setInviteTargets] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSelection, setExportSelection] = useState([]);
  const [notice, setNotice] = useState("");

  const openInvite = useCallback((people = []) => {
    if (!people.length) return;
    setNotice("");
    setInviteTargets(people);
  }, []);

  const emailPeople = useCallback((people = []) => {
    const ids = people.map((person) => person.profileId).filter(Boolean);
    if (!ids.length) return;
    navigate(`/t/${slug}/admin/email/compose?selected=${ids.join(",")}`);
  }, [navigate, slug]);

  const body = useMemo(() => {
    if (activeView === "add") {
      return (
        <PeopleAddView
          actions={actions}
          storage={directory.storage}
          onInvite={openInvite}
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
      />
    );
  }, [actions, activeView, directory, emailPeople, navigate, openInvite, slug, stage]);

  return (
    <div className="pb-workspace">
      <WorkspaceHeader title={"People"} subtitle={"Everyone connected to your camp, from prospects through to active members."} />
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
        <p className="pb-people-rail-note">{stageMeta(stage).blurb}</p>
      </nav>

      <div className="pb-people-surface">
        {directory.error ? <p className="error-text" role="alert">{directory.error}</p> : null}
        {notice ? <p className="success-text" role="status">{notice}</p> : null}
        {body}
      </div>

      <InviteReviewDialog
        open={inviteTargets.length > 0}
        people={inviteTargets}
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
