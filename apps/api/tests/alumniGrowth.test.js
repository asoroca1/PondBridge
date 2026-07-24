import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAlumniGrowthSnapshot,
  filterHeldAlumniRecipients,
  hasRequiredEmailTargetingSelection,
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
    expect(hasRequiredEmailTargetingSelection({ mode: "custom", profileIds: [] })).toBe(false);
    expect(hasRequiredEmailTargetingSelection({ mode: "segment", segment: "unknown" })).toBe(false);
    expect(hasRequiredEmailTargetingSelection({ mode: "segment", segment: "inactive_30" })).toBe(true);
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
