import { useCallback, useState } from "react";

/** Who the server refused to invite, phrased for a director rather than a log. */
function describeSkipped(summary = {}) {
  const skipped = [];
  const pending = Number(summary.pendingInviteCount || 0);
  const joined = Number(summary.existingMemberCount || 0);
  const held = Number(summary.contactOnHoldCount || 0);
  if (pending) skipped.push(`${pending} already had a pending invite`);
  if (joined) skipped.push(`${joined} already joined`);
  if (held) skipped.push(`${held} on hold`);
  return skipped;
}

/**
 * Every write the People workspace can perform, in one place. Each action
 * returns { ok, message } so callers can report without duplicating error
 * handling, and reload() is invoked on success so the list and the rail counts
 * move together.
 */
export default function usePersonActions({ request, reload }) {
  const [busy, setBusy] = useState("");

  const run = useCallback(async (label, fn) => {
    setBusy(label);
    try {
      const message = await fn();
      reload?.();
      if (message && typeof message === "object") return message;
      return { ok: true, message: message || "" };
    } catch (requestError) {
      return { ok: false, message: requestError.message || "That action could not be completed." };
    } finally {
      setBusy("");
    }
  }, [reload]);

  const previewInvites = useCallback(async (people = []) => {
    const recipients = people
      .filter((person) => person.email)
      .map(({ firstName, lastName, email }) => ({ firstName, lastName, email }));
    if (!recipients.length) throw new Error("Select at least one person with an email address.");
    const preview = await request("/invites/preview", {
      method: "POST",
      body: { roleToAssign: "user", recipients }
    });
    return { preview, recipients };
  }, [request]);

  const sendInvites = useCallback((recipients = [], previewToken = "", extras = {}) => run("invite", async () => {
    const response = await request("/invites/send", {
      method: "POST",
      body: { roleToAssign: "user", recipients, previewToken, ...extras }
    });
    const sent = Number(response?.sentCount || 0);
    return `${sent} invitation${sent === 1 ? "" : "s"} sent.`;
  }), [request, run]);

  /**
   * Preview and send in one step. The preview still runs, so nobody who has
   * joined, is on hold, or already has a pending invite gets a second email --
   * the director just reads the outcome afterwards instead of confirming first.
   */
  const sendInvitesNow = useCallback((people = [], extras = {}) => run("invite", async () => {
    const { preview, recipients } = await previewInvites(people);
    const summary = preview?.summary || {};
    const skipped = describeSkipped(summary);
    if (!Number(summary.readyCount || 0)) {
      throw new Error(
        skipped.length
          ? `Nobody was invited — ${skipped.join(", ")}.`
          : "Nobody in this list can be invited right now."
      );
    }
    const response = await request("/invites/send", {
      method: "POST",
      body: { roleToAssign: "user", recipients, previewToken: preview?.previewToken || "", ...extras }
    });
    const sent = Number(response?.sentCount || 0);
    const head = `${sent} invitation${sent === 1 ? "" : "s"} sent.`;
    return skipped.length ? `${head} Skipped: ${skipped.join(", ")}.` : head;
  }), [previewInvites, request, run]);

  const approve = useCallback((person) => run("approve", async () => {
    const response = await request(`/members/approvals/${person.requestId}/approve`, { method: "POST" });
    const setup = response?.awaitingConsent
      ? " They must finish account confirmation before gaining access. No further approval is needed."
      : "";
    const delivery = ["failed", "handoff_unknown"].includes(response?.approvalEmail?.status)
      ? " Their notification needs attention; the approval is saved."
      : "";
    return `${person.fullName || person.email} approved.${setup}${delivery}`;
  }), [request, run]);

  const deny = useCallback((person, reason = "") => run("deny", async () => {
    await request(`/members/approvals/${person.requestId}/deny`, {
      method: "POST",
      body: { reason: String(reason || "").trim() }
    });
    return `Request from ${person.fullName || person.email} denied.`;
  }), [request, run]);

  /**
   * One decision for many people. The server caps how many it will handle in a
   * single call and reports what is left, so a queue of any size drains by
   * repeating the call rather than by the director clicking a thousand times.
   */
  const decideMany = useCallback((action, { people = [], scope = "selected", match = "any", reason = "" } = {}) =>
    run(action === "approve" ? "approve" : "deny", async () => {
      const ids = people.map((person) => person.requestId).filter(Boolean);
      if (scope === "selected" && !ids.length) {
        throw new Error("Select at least one person waiting for a decision.");
      }

      let decided = 0;
      let awaitingConsent = 0;
      let remaining = 0;
      const failures = new Map();
      // Keep going until the server says nothing is left over, so "approve
      // everyone" means everyone and not just the first chunk.
      for (let pass = 0; pass < 40; pass += 1) {
        const response = await request("/members/approvals/bulk", {
          method: "POST",
          body: { action, ids, scope, match, reason: String(reason || "").trim() }
        });
        const progressed = Number(response?.decided || 0);
        decided += progressed;
        awaitingConsent += Number(response?.awaitingConsent || 0);
        for (const [index, failure] of (Array.isArray(response?.failed) ? response.failed : []).entries()) {
          failures.set(failure.requestId || `${pass}/${index}`, failure.code || "FAILED");
        }
        remaining = Number(response?.remaining || 0);
        if (scope !== "all" || !remaining || !progressed) break;
      }

      const verb = action === "approve" ? "approved" : "denied";
      const setupNote = awaitingConsent
        ? ` ${awaitingConsent} must finish account confirmation before gaining access; no further approval is needed.`
        : "";
      const consentBlocked = [...failures.values()].includes("RECOVERED_SIGNUP_CONSENT_REQUIRED");
      const failureNote = failures.size
        ? ` ${failures.size} could not be processed.${consentBlocked ? " Account confirmation is blocking these requests. Refresh the page and retry after the update." : " Open the remaining requests to review the issue."}`
        : "";
      const remainingNote = remaining ? " Some requests still need attention; processing stopped to avoid repeating failed actions." : "";
      return {
        ok: failures.size === 0 && remaining === 0,
        message: `${decided.toLocaleString()} ${decided === 1 ? "person" : "people"} ${verb}.${setupNote}${failureNote}${remainingNote}`
      };
    }), [request, run]);

  const setContactStatus = useCallback((person, contactStatus) => run("hold", async () => {
    if (!person.contactId) {
      // Someone known only through a member record or invite has no contact row
      // yet; create one so the hold has somewhere to live.
      await request("/growth/contacts", {
        method: "POST",
        body: {
          contacts: [{
            email: person.email,
            firstName: person.firstName,
            lastName: person.lastName,
            contactStatus,
            source: "director_entry"
          }]
        }
      });
    } else {
      await request(`/growth/contacts/${encodeURIComponent(person.contactId)}`, {
        method: "PATCH",
        body: {
          firstName: person.firstName,
          lastName: person.lastName,
          tags: person.tags,
          campYears: person.campYears,
          notes: person.notes,
          contactStatus
        }
      });
    }
    return contactStatus === "do_not_contact"
      ? `${person.fullName || person.email} is on hold.`
      : `${person.fullName || person.email} is off hold.`;
  }), [request, run]);

  /**
   * Tells imported people their profile is waiting. Deliberately its own action
   * rather than part of the import: a wrong upload should cost an undo, not a
   * mailout nobody can recall.
   */
  const sendClaimEmails = useCallback((people = [], extras = {}) => run("claim", async () => {
    const emails = people.map((person) => person.email).filter(Boolean);
    if (!emails.length) throw new Error("None of those people have an email address on file.");
    const payload = await request("/import/claim-emails", {
      method: "POST",
      body: { emails, questionnaireName: extras.questionnaireName || "" }
    });
    const sent = Number(payload?.sentCount || 0);
    const skipped = Number(payload?.skipped?.length || 0);
    return `Emailed ${sent} ${sent === 1 ? "person" : "people"}.${skipped ? ` ${skipped} skipped.` : ""}`;
  }), [request, run]);

  const addProspects = useCallback((contacts = []) => run("prospects", async () => {
    const response = await request("/growth/contacts", { method: "POST", body: { contacts } });
    const created = Number(response?.createdCount || 0);
    const updated = Number(response?.updatedCount || 0);
    const joined = Number(response?.existingMemberCount || 0);
    return `${created} added, ${updated} updated${joined ? `, ${joined} already joined` : ""}.`;
  }), [request, run]);

  const removeMembers = useCallback((profileIds = []) => run("remove", async () => {
    const response = await request("/members/bulk-action", {
      method: "POST",
      body: { action: "remove", ids: profileIds }
    });
    const affected = Number(response?.affected || profileIds.length);
    return `${affected} member${affected === 1 ? "" : "s"} removed.`;
  }), [request, run]);

  /**
   * Erases someone who never joined: their contact row, their invitations and
   * any pending request. Members are refused by the server; they go through
   * deleteMember so their profile and content are cleaned up too.
   */
  const purgePerson = useCallback((person) => run("purge", async () => {
    const email = String(person?.email || "").trim();
    if (!email) throw new Error("This person has no email address on file, so there is nothing to delete.");
    const response = await request(`/growth/people/${encodeURIComponent(email)}/purge`, {
      method: "DELETE"
    });
    const invites = Number(response?.deleted?.invites || 0);
    const detail = invites ? ` ${invites} invitation${invites === 1 ? "" : "s"} removed.` : "";
    return `${person.fullName || email} was deleted from the system.${detail}`;
  }), [request, run]);

  const deleteMember = useCallback((person) => run("delete", async () => {
    await request(`/members/${person.profileId}/hard-delete`, { method: "DELETE" });
    return `${person.fullName || person.email} was permanently deleted.`;
  }), [request, run]);

  return {
    busy,
    previewInvites,
    sendInvites,
    sendInvitesNow,
    approve,
    deny,
    decideMany,
    setContactStatus,
    addProspects,
    sendClaimEmails,
    removeMembers,
    deleteMember,
    purgePerson
  };
}
