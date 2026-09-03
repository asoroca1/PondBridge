import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAlumniGrowthSnapshot,
  filterHeldAlumniRecipients,
  filterProfilesByIndustry,
  buildPeopleDirectory,
  hasRequiredEmailTargetingSelection,
  PEOPLE_STAGES,
  normalizeAlumniContactInput,
  resolveGrowthEmailSegment
} from "../src/services/alumniGrowth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const NOW = new Date("2026-07-15T16:00:00.000Z");

function completeProfile(overrides = {}) {
  return {
    firstName: "Avery",
    lastName: "Camper",
    emails: ["avery@example.com"],
    avatarUrl: "https://example.com/avatar.jpg",
    bio: "Camp alum",
    cityState: "Boston, MA",
    industry: "Education",
    roleAtCamp: "Camper",
    ...overrides
  };
}

describe("alumni growth contact safety", () => {
  test("normalizes director-entered contacts without preserving markup or duplicate labels", () => {
    const contact = normalizeAlumniContactInput({
      email: "  ALUM@example.com ",
      firstName: "<b>Ada</b>",
      lastName: "Lovelace\u0000",
      tags: ["Reunion", "reunion", " Donor "],
      campYears: "2008, 2008, 2009",
      notes: "<script>unsafe</script> Met at reunion"
    });

    expect(contact).toMatchObject({
      email: "alum@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      tags: ["Reunion", "Donor"],
      campYears: ["2008", "2009"]
    });
    expect(contact.notes).not.toMatch(/[<>]/);
    expect(normalizeAlumniContactInput({ email: "not-an-email" })).toBeNull();
  });

  test("keeps held alumni out of every matching outreach audience", () => {
    expect(filterHeldAlumniRecipients(
      ["ACTIVE@example.com", "held@example.com", "active@example.com"],
      [{ email: "HELD@example.com", contactStatus: "do_not_contact" }]
    )).toEqual({
      deliverableRecipients: ["active@example.com"],
      heldRecipients: ["held@example.com"]
    });
  });

  test("fails targeted email modes closed when their selection is missing", () => {
    expect(hasRequiredEmailTargetingSelection({ mode: "all" })).toBe(true);
    expect(hasRequiredEmailTargetingSelection({ mode: "role", roles: [] })).toBe(false);
    expect(hasRequiredEmailTargetingSelection({ mode: "industry", industries: [] })).toBe(false);
    expect(hasRequiredEmailTargetingSelection({ mode: "industry", industries: ["Education"] })).toBe(true);
    expect(hasRequiredEmailTargetingSelection({ mode: "custom", profileIds: [] })).toBe(false);
    expect(hasRequiredEmailTargetingSelection({ mode: "segment", segment: "unknown" })).toBe(false);
    expect(hasRequiredEmailTargetingSelection({ mode: "segment", segment: "inactive_30" })).toBe(true);
  });

  test("selects only members carrying the requested industry tag", () => {
    const profiles = [
      completeProfile({ _id: "education", industry: "Education" }),
      completeProfile({ _id: "healthcare", industry: "Healthcare" }),
      completeProfile({ _id: "blank", industry: "" })
    ];

    expect(filterProfilesByIndustry(profiles, ["education"]).map((profile) => profile._id))
      .toEqual(["education"]);
    expect(filterProfilesByIndustry(profiles, [])).toEqual([]);
  });

  test("accepts a composite audience only when one of its rules is usable", () => {
    expect(hasRequiredEmailTargetingSelection({ mode: "composite", groups: [] })).toBe(false);
    expect(hasRequiredEmailTargetingSelection({ mode: "composite" })).toBe(false);
    expect(hasRequiredEmailTargetingSelection({
      mode: "composite",
      groups: [{ mode: "role", roles: [] }, { mode: "custom", profileIds: [] }]
    })).toBe(false);
    expect(hasRequiredEmailTargetingSelection({
      mode: "composite",
      groups: [{ mode: "role", roles: [] }, { mode: "year", years: ["2019"] }]
    })).toBe(true);
  });
});

describe("server-owned engagement segments", () => {
  const users = [
    { _id: "active", createdAt: "2025-01-01", lastLoginAt: "2026-04-01" },
    { _id: "inactive", createdAt: "2025-01-01", lastLoginAt: "2026-04-01" },
    { _id: "new", createdAt: "2026-07-01", lastLoginAt: "2026-07-02" }
  ];
  const profiles = [
    completeProfile({ _id: "p-active", userId: "active", emails: ["active@example.com"] }),
    completeProfile({ _id: "p-inactive", userId: "inactive", emails: ["inactive@example.com"] }),
    completeProfile({ _id: "p-new", userId: "new", emails: ["new@example.com"] }),
    {
      _id: "p-incomplete",
      userId: "active",
      firstName: "Partial",
      emails: ["partial@example.com"]
    }
  ];

  test("uses actual analytics activity and ignores incidental user record updates", () => {
    const inactive = resolveGrowthEmailSegment({
      segment: "inactive_30",
      profiles,
      users: users.map((user) => ({ ...user, updatedAt: "2026-07-14" })),
      analyticsEvents: [{ userId: "active", createdAt: "2026-07-12" }],
      now: NOW
    });

    expect(inactive.map((profile) => profile._id)).toEqual(["p-inactive"]);
    expect(resolveGrowthEmailSegment({ segment: "new_30", profiles, users, now: NOW })
      .map((profile) => profile._id)).toEqual(["p-new"]);
    expect(resolveGrowthEmailSegment({ segment: "profile_incomplete", profiles, users, now: NOW })
      .map((profile) => profile._id)).toContain("p-incomplete");
  });
});

describe("alumni growth funnel", () => {
  test("unifies stored prospects, invitations, members, activity, and delivery truth", () => {
    const snapshot = buildAlumniGrowthSnapshot({
      contacts: [
        { _id: "contact-a", email: "a@example.com", firstName: "A", contactStatus: "active" },
        { _id: "contact-b", email: "b@example.com", firstName: "B", contactStatus: "active" }
      ],
      invites: [
        {
          email: "expired@example.com",
          roleToAssign: "user",
          createdAt: "2026-05-01",
          expiresAt: "2026-05-15",
          usedAt: null
        },
        {
          email: "joined@example.com",
          roleToAssign: "user",
          createdAt: "2026-06-01",
          expiresAt: "2026-06-15",
          usedAt: "2026-06-02"
        }
      ],
      users: [
        { _id: "joined", email: "joined@example.com", createdAt: "2026-06-02" },
        { _id: "active", email: "active@example.com", createdAt: "2025-01-01" }
      ],
      profiles: [
        completeProfile({ userId: "joined", emails: ["joined@example.com"], createdAt: "2026-06-02" }),
        completeProfile({ userId: "active", emails: ["active@example.com"], createdAt: "2025-01-01" })
      ],
      analyticsEvents: [{ userId: "active", createdAt: "2026-07-13" }],
      broadcasts: [
        {
          status: "sent",
          recipientCount: 20,
          stats: { webhook: { delivered: 18 } }
        }
      ],
      now: NOW
    });

    expect(snapshot.metrics).toMatchObject({
      knownAlumni: 5,
      joinedMembers: 2,
      notJoined: 3,
      neverInvited: 2,
      expiredInvites: 1,
      convertedFromInvite: 1,
      inviteConversionRate: 50,
      activeMembers7d: 1,
      weeklyActiveRate: 50
    });
    expect(snapshot.marketing).toMatchObject({
      campaignsSent: 1,
      recipientDeliveriesRequested: 20,
      delivered: 18,
      deliveryRate: 90
    });
    expect(snapshot.contacts).toHaveLength(5);
    expect(snapshot.contacts.find((contact) => contact.email === "active@example.com")?.lifecycle)
      .toBe("joined");
  });

  test("keeps a control camp useful when no pre-member records exist", () => {
    const snapshot = buildAlumniGrowthSnapshot({
      users: [{ _id: "member", email: "member@example.com", createdAt: "2025-01-01" }],
      profiles: [completeProfile({ userId: "member", emails: ["member@example.com"] })],
      now: NOW
    });

    expect(snapshot.metrics.knownAlumni).toBe(1);
    expect(snapshot.metrics.notJoined).toBe(0);
    expect(snapshot.contacts[0]).toMatchObject({
      email: "member@example.com",
      lifecycle: "joined"
    });
  });
});

describe("alumni contact schema isolation", () => {
  test("creates tenant-scoped storage with service-role-only access", () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, "../scripts/communications_system_schema.sql"),
      "utf8"
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.alumni_contacts/);
    expect(sql).toMatch(/idx_alumni_contacts_tenant_email/);
    expect(sql).toMatch(/alumni_contacts_service_role_all/);
    expect(sql).not.toMatch(/alumni_contacts_authenticated_tenant/);
  });
});

describe("unified people directory", () => {
  const past = new Date(Date.now() - 7 * 864e5).toISOString();
  const future = new Date(Date.now() + 7 * 864e5).toISOString();

  function build(overrides = {}) {
    return buildPeopleDirectory({
      users: [{ _id: "u1", email: "Joined@Example.org", createdAt: past, lastLoginAt: past }],
      profiles: [{
        _id: "p1",
        userId: "u1",
        firstName: "Jo",
        lastName: "Ned",
        emails: ["joined@example.org"],
        collegeYears: ["2019"],
        createdAt: past
      }],
      accessRequests: [{ _id: "r1", status: "pending", email: "waiting@example.org", requestMessage: "Let me in" }],
      invites: [
        { _id: "i1", email: "pending@example.org", roleToAssign: "user", createdAt: past, expiresAt: future },
        { _id: "i2", email: "stale@example.org", roleToAssign: "user", createdAt: past, expiresAt: past }
      ],
      contacts: [
        { _id: "c1", email: "prospect@example.org", contactStatus: "active" },
        { _id: "c2", email: "held@example.org", contactStatus: "do_not_contact" },
        { _id: "c3", email: "joined@example.org", contactStatus: "active", notes: "met at reunion" }
      ],
      mapMember: (profile) => ({ id: String(profile._id), role: "Counselor", completionScore: 82, status: "active" }),
      ...overrides
    });
  }

  test("places every known person in exactly one pipeline stage", () => {
    const { people, counts } = build();
    const byEmail = Object.fromEntries(people.map((person) => [person.email, person]));

    expect(byEmail["joined@example.org"].stage).toBe("member");
    expect(byEmail["waiting@example.org"].stage).toBe("request");
    expect(byEmail["pending@example.org"].stage).toBe("invited");
    expect(byEmail["stale@example.org"].stage).toBe("expired");
    expect(byEmail["prospect@example.org"].stage).toBe("prospect");
    expect(byEmail["held@example.org"].stage).toBe("on_hold");
    expect(PEOPLE_STAGES.reduce((sum, stage) => sum + counts[stage], 0)).toBe(counts.all);
  });

  test("tells a director which waiting people they actually invited", () => {
    // The question that makes a queue of hundreds decidable: was this person
    // asked to join, merely known to us, or a total stranger?
    const { people } = build({
      accessRequests: [
        { _id: "r1", status: "pending", email: "invited@example.org" },
        { _id: "r2", status: "pending", email: "prospect@example.org" },
        { _id: "r3", status: "pending", email: "stranger@example.org" }
      ],
      invites: [
        { _id: "i1", email: "invited@example.org", roleToAssign: "user", createdAt: past, expiresAt: future }
      ]
    });
    const byEmail = Object.fromEntries(people.map((person) => [person.email, person]));

    expect(byEmail["invited@example.org"].recognition).toBe("invited");
    expect(byEmail["prospect@example.org"].recognition).toBe("known");
    expect(byEmail["stranger@example.org"].recognition).toBe("unrecognized");
    // All three are still waiting on a decision; recognition informs it, it
    // does not make it.
    expect(byEmail["invited@example.org"].stage).toBe("request");
    expect(byEmail["stranger@example.org"].stage).toBe("request");
  });

  test("an invitation outranks an alumni record when both describe the same person", () => {
    const { people } = build({
      accessRequests: [{ _id: "r1", status: "pending", email: "prospect@example.org" }],
      invites: [
        { _id: "i1", email: "prospect@example.org", roleToAssign: "user", createdAt: past, expiresAt: future }
      ]
    });
    const person = people.find((item) => item.email === "prospect@example.org");

    expect(person.recognition).toBe("invited");
  });

  test("merges a contact and the member it became into one row", () => {
    const { people, counts } = build();
    const joined = people.filter((person) => person.email === "joined@example.org");
    expect(joined).toHaveLength(1);
    expect(joined[0].profileId).toBe("p1");
    expect(joined[0].completionScore).toBe(82);
    // Contact-only detail survives the merge.
    expect(joined[0].notes).toBe("met at reunion");
    expect(counts.all).toBe(6);
  });

  test("shows camp years from camp history, never college graduation years", () => {
    const { people } = buildPeopleDirectory({
      users: [{ _id: "u1", email: "joined@example.org" }],
      profiles: [{ _id: "p1", userId: "u1", emails: ["joined@example.org"], collegeYears: ["2026", "2027"] }],
      contacts: [{ _id: "c1", email: "joined@example.org", contactStatus: "active", campYears: ["2019"] }],
      mapMember: () => ({ id: "p1", yearsAtCamp: ["2017", "2018"] })
    });
    expect(people[0].yearsAtCamp).toEqual(["2017", "2018", "2019"]);
  });

  test("keeps the camp years a director typed in for a prospect", () => {
    const { people } = buildPeopleDirectory({
      contacts: [{ _id: "c1", email: "prospect@example.org", contactStatus: "active", campYears: ["2009", "2008"] }]
    });
    expect(people[0].yearsAtCamp).toEqual(["2008", "2009"]);
  });

  test("keeps a held contact on hold even after they join", () => {
    const { people } = buildPeopleDirectory({
      users: [{ _id: "u9", email: "both@example.org" }],
      profiles: [{ _id: "p9", userId: "u9", emails: ["both@example.org"] }],
      contacts: [{ _id: "c9", email: "both@example.org", contactStatus: "do_not_contact" }]
    });
    expect(people[0].stage).toBe("on_hold");
  });

  test("counts a member who has no email address on file", () => {
    const { people, counts } = buildPeopleDirectory({
      users: [
        { _id: "u1", email: "has@example.org" },
        { _id: "u2", email: "" }
      ],
      profiles: [
        { _id: "p1", userId: "u1", emails: ["has@example.org"] },
        { _id: "p2", userId: "u2", firstName: "Nomail" }
      ]
    });

    expect(counts.member).toBe(2);
    const nomail = people.find((person) => person.firstName === "Nomail");
    expect(nomail.stage).toBe("member");
    // The synthetic key must never leak into the address shown in the UI.
    expect(nomail.email).toBe("");
  });

  test("counts one member when the profile email differs from the user email", () => {
    const { counts } = buildPeopleDirectory({
      users: [{ _id: "u1", email: "login@example.org" }],
      profiles: [{ _id: "p1", userId: "u1", emails: ["contact@example.org"] }]
    });

    expect(counts.member).toBe(1);
  });

  // Removing a member deactivates the account and marks the profile removed.
  // The two rows never say it the same way, so each half is checked on its own.
  test("drops a removed member whose deactivated account row survives", () => {
    const { people, counts } = buildPeopleDirectory({
      users: [
        { _id: "u1", email: "stays@example.org", status: "active" },
        { _id: "u2", email: "gone@example.org", status: "inactive" }
      ],
      // The caller filtered removed profiles out, as the People query does;
      // only the deactivated user row is left to speak for the removed member.
      profiles: [{ _id: "p1", userId: "u1", emails: ["stays@example.org"], status: "active" }]
    });

    expect(counts.member).toBe(1);
    expect(people.map((person) => person.email)).toEqual(["stays@example.org"]);
  });

  test("drops a removed member when the removed profile is passed in too", () => {
    const { counts } = buildPeopleDirectory({
      users: [{ _id: "u2", email: "gone@example.org", status: "inactive" }],
      profiles: [{ _id: "p2", userId: "u2", emails: ["gone@example.org"], status: "removed" }]
    });

    expect(counts.member).toBe(0);
    expect(counts.all).toBe(0);
  });

  test("a removed member with an alumni record goes back to being a prospect", () => {
    const { people, counts } = buildPeopleDirectory({
      users: [{ _id: "u2", email: "gone@example.org", status: "inactive" }],
      profiles: [{ _id: "p2", userId: "u2", emails: ["gone@example.org"], status: "removed" }],
      contacts: [{ _id: "c2", email: "gone@example.org", contactStatus: "active" }]
    });

    expect(counts.member).toBe(0);
    expect(people[0].stage).toBe("prospect");
    // Nothing may still point at the profile that was removed.
    expect(people[0].profileId).toBe("");
  });

  test("keeps a member whose account row carries no status at all", () => {
    const { counts } = buildPeopleDirectory({
      users: [{ _id: "u1", email: "legacy@example.org" }],
      profiles: [{ _id: "p1", userId: "u1", emails: ["legacy@example.org"] }]
    });

    expect(counts.member).toBe(1);
  });
});
