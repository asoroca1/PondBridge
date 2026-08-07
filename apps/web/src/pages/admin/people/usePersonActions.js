import { useCallback, useState } from "react";

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

  const approve = useCallback((person) => run("approve", async () => {
    await request(`/members/approvals/${person.requestId}/approve`, { method: "POST" });
    return `${person.fullName || person.email} approved.`;
  }), [request, run]);

  const deny = useCallback((person, reason = "") => run("deny", async () => {
    await request(`/members/approvals/${person.requestId}/deny`, {
      method: "POST",
      body: { reason: String(reason || "").trim() }
    });
    return `Request from ${person.fullName || person.email} denied.`;
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

  const deleteMember = useCallback((person) => run("delete", async () => {
    await request(`/members/${person.profileId}/hard-delete`, { method: "DELETE" });
    return `${person.fullName || person.email} was permanently deleted.`;
  }), [request, run]);

  return {
    busy,
    previewInvites,
    sendInvites,
    approve,
    deny,
    setContactStatus,
    addProspects,
    removeMembers,
    deleteMember
  };
}
