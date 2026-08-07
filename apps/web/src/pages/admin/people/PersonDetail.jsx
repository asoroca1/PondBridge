import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Textarea } from "@pondbridge/ui";
import { Check, Mail, PauseCircle, PlayCircle, Send, SquarePen, Trash2, UserRound, X } from "lucide-react";
import { ModalConfirm, ModalDialog } from "../../../components/admin/AdminUi.jsx";
import {
  formatDate,
  formatDateTime,
  personInitials,
  personName,
  stageMeta,
  stageSummary
} from "./peopleStages.js";

function Field({ label, children }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="pb-people-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The reading pane. What it offers depends entirely on where the person sits in
 * the pipeline — a prospect gets "Invite", a request gets "Approve", a member
 * gets "Edit profile" — so a director never has to know which page an action
 * used to live on.
 */
export default function PersonDetail({ person, slug, actions, onInvite, onEmail }) {
  const [denyOpen, setDenyOpen] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!person) {
    return (
      <div className="pb-people-detail is-empty">
        <UserRound aria-hidden="true" />
        <p>Select someone to see their details and what you can do next.</p>
      </div>
    );
  }

  const meta = stageMeta(person.stage);
  const busy = Boolean(actions.busy);
  const onHold = person.stage === "on_hold";

  return (
    <div className="pb-people-detail">
      <header className="pb-people-detail-head">
        <span className="pb-people-avatar is-large" aria-hidden="true">
          {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : personInitials(person)}
        </span>
        <div>
          <h3>{personName(person)}</h3>
          <p>{person.email || "No email on file"}</p>
          <span className={`pb-people-stage tone-${meta.tone}`}>{meta.label}</span>
        </div>
      </header>

      <p className="pb-people-detail-summary">{stageSummary(person)}</p>

      <div className="pb-people-detail-actions">
        {person.stage === "request" ? (
          <>
            <Button type="button" onClick={() => actions.approve(person)} loading={actions.busy === "approve"} disabled={busy}>
              <Check aria-hidden="true" />
              Approve
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDenyOpen(true)} disabled={busy}>
              <X aria-hidden="true" />
              Deny
            </Button>
          </>
        ) : null}

        {person.stage === "prospect" || person.stage === "expired" ? (
          <Button type="button" onClick={() => onInvite([person])} disabled={busy || !person.email}>
            <Send aria-hidden="true" />
            {person.stage === "expired" ? "Invite again" : "Invite"}
          </Button>
        ) : null}

        {person.stage === "invited" ? (
          <Button type="button" variant="secondary" onClick={() => onInvite([person])} disabled={busy}>
            <Send aria-hidden="true" />
            Resend invitation
          </Button>
        ) : null}

        {person.stage === "member" ? (
          <>
            <Link className="link-button" to={`/t/${slug}/admin/members/${person.profileId}/edit`}>
              <SquarePen aria-hidden="true" />
              Edit profile
            </Link>
            <Button type="button" variant="secondary" onClick={() => onEmail([person])} disabled={!person.profileId}>
              <Mail aria-hidden="true" />
              Email
            </Button>
          </>
        ) : null}

        {person.email ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => actions.setContactStatus(person, onHold ? "active" : "do_not_contact")}
            loading={actions.busy === "hold"}
            disabled={busy}
          >
            {onHold ? <PlayCircle aria-hidden="true" /> : <PauseCircle aria-hidden="true" />}
            {onHold ? "Take off hold" : "Put on hold"}
          </Button>
        ) : null}

        {person.stage === "member" && person.profileId ? (
          person.memberStatus === "removed" ? (
            <Button type="button" variant="ghost" onClick={() => setDeleteOpen(true)} disabled={busy}>
              <Trash2 aria-hidden="true" />
              Delete permanently
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setRemoveOpen(true)} disabled={busy}>
              <Trash2 aria-hidden="true" />
              Remove
            </Button>
          )
        ) : null}
      </div>

      {person.requestMessage ? (
        <blockquote className="pb-people-request-note">
          <span>Their message</span>
          {person.requestMessage}
        </blockquote>
      ) : null}

      <dl className="pb-people-fields">
        <Field label="Role">{person.role || null}</Field>
        <Field label="Location">{person.location || null}</Field>
        <Field label="Camp years">{person.yearsAtCamp?.length ? person.yearsAtCamp.join(", ") : null}</Field>
        <Field label="Tags">{person.tags?.length ? person.tags.join(" · ") : null}</Field>
        {person.stage === "member" ? (
          <Field label="Profile completion">
            <span className="pb-people-completion">
              <span className="pb-people-progress" aria-hidden="true">
                <span style={{ width: `${person.completionScore || 0}%` }} />
              </span>
              {person.completionScore || 0}%
            </span>
          </Field>
        ) : null}
        <Field label="Joined">{person.joinedAt ? formatDate(person.joinedAt) : null}</Field>
        <Field label="Last active">{person.lastActiveAt ? formatDateTime(person.lastActiveAt) : null}</Field>
        <Field label="Requested">{person.requestedAt ? formatDateTime(person.requestedAt) : null}</Field>
        <Field label="Invitations sent">{person.inviteCount ? String(person.inviteCount) : null}</Field>
        <Field label="Last invited">{person.lastInvitedAt ? formatDate(person.lastInvitedAt) : null}</Field>
        <Field label="How we know them">{person.source ? person.source.replaceAll("_", " ") : null}</Field>
        <Field label="Notes">{person.notes || null}</Field>
      </dl>

      <ModalDialog
        open={denyOpen}
        title="Deny this request?"
        description={`${person.email || "This applicant"} will not get access. You can include a short reason.`}
        onClose={busy ? undefined : () => setDenyOpen(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setDenyOpen(false)} disabled={busy}>
              Keep pending
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={actions.busy === "deny"}
              onClick={async () => {
                await actions.deny(person, denyReason);
                setDenyOpen(false);
                setDenyReason("");
              }}
            >
              Deny request
            </Button>
          </>
        }
      >
        <label className="director-admin-dialog-field">
          <span>Reason (optional)</span>
          <Textarea
            value={denyReason}
            maxLength={500}
            onChange={(event) => setDenyReason(event.target.value)}
            placeholder="Explain why access was not approved"
          />
        </label>
      </ModalDialog>

      <ModalConfirm
        open={removeOpen}
        title={`Remove ${personName(person)}?`}
        description="They lose access to the community. Their profile is kept, and you can restore them later."
        confirmLabel="Remove member"
        cancelLabel="Keep member"
        tone="danger"
        busy={actions.busy === "remove"}
        onConfirm={async () => {
          await actions.removeMembers([person.profileId]);
          setRemoveOpen(false);
        }}
        onCancel={() => setRemoveOpen(false)}
      />

      <ModalConfirm
        open={deleteOpen}
        title={`Permanently delete ${personName(person)}?`}
        description="This erases the profile and cannot be undone."
        confirmLabel="Delete permanently"
        cancelLabel="Cancel"
        tone="danger"
        busy={actions.busy === "delete"}
        onConfirm={async () => {
          await actions.deleteMember(person);
          setDeleteOpen(false);
        }}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
