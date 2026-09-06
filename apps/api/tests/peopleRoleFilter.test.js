import {
  buildPeopleDirectory,
  personMatchesRole,
  splitRoleValues
} from "../src/services/alumniGrowth.js";

/**
 * Today's role breakdown and the People directory have to answer the same
 * question the same way, because Today's rows link straight into People.
 *
 * On Camp Cedar they did not: Today counted 751 counselors from the profiles
 * table, the link opened People filtered to "Counselor", and People listed 736.
 * The missing 15 were counselors who are also tenant admins — the directory row
 * shows an account role ("Admin") in the same column it shows a camp role, so
 * matching on the displayed value dropped them from their own camp role's list.
 */

const NOW = new Date("2026-07-15T16:00:00.000Z");

function directoryFor({ user, profile }) {
  const { people } = buildPeopleDirectory({
    users: [user],
    profiles: [profile],
    now: NOW,
    // The real caller's mapper is what overrides an admin's camp role; this is
    // the same rule in miniature.
    mapMember: (member, account) => ({
      role: (account?.roles || []).includes("tenant_admin")
        ? "Admin"
        : member.roleAtCamp || "Member"
    })
  });
  return people;
}

describe("camp roles survive the directory's account-role label", () => {
  test("a counselor who is also an admin is still found by role=Counselor", () => {
    const [person] = directoryFor({
      user: { _id: "u1", id: "u1", email: "dana@example.com", status: "active", roles: ["tenant_admin", "user"] },
      profile: { _id: "p1", id: "p1", userId: "u1", emails: ["dana@example.com"], roleAtCamp: "Counselor", status: "active" }
    });

    expect(person.role).toBe("Admin");
    expect(person.campRoles).toEqual(["Counselor"]);
    expect(personMatchesRole(person, "counselor")).toBe(true);
    expect(personMatchesRole(person, "admin")).toBe(true);
  });

  test("a plain counselor still matches, and someone else's role still does not", () => {
    const [person] = directoryFor({
      user: { _id: "u2", id: "u2", email: "sam@example.com", status: "active", roles: ["user"] },
      profile: { _id: "p2", id: "p2", userId: "u2", emails: ["sam@example.com"], roleAtCamp: "Counselor", status: "active" }
    });

    expect(personMatchesRole(person, "counselor")).toBe(true);
    expect(personMatchesRole(person, "lifeguard")).toBe(false);
  });

  test("a member who wrote two roles matches either one, the way Today counts them", () => {
    const [person] = directoryFor({
      user: { _id: "u3", id: "u3", email: "kit@example.com", status: "active", roles: ["user"] },
      profile: { _id: "p3", id: "p3", userId: "u3", emails: ["kit@example.com"], roleAtCamp: "Counselor, Lifeguard", status: "active" }
    });

    expect(person.campRoles).toEqual(["Counselor", "Lifeguard"]);
    expect(personMatchesRole(person, "counselor")).toBe(true);
    expect(personMatchesRole(person, "lifeguard")).toBe(true);
  });

  test("splitRoleValues and Today's breakdown agree on what one role is", () => {
    expect(splitRoleValues("Counselor; Lifeguard | Driver")).toEqual(["Counselor", "Lifeguard", "Driver"]);
    expect(splitRoleValues("")).toEqual([]);
  });

  test("an empty role filter keeps everyone", () => {
    const [person] = directoryFor({
      user: { _id: "u4", id: "u4", email: "lee@example.com", status: "active", roles: ["user"] },
      profile: { _id: "p4", id: "p4", userId: "u4", emails: ["lee@example.com"], roleAtCamp: "", status: "active" }
    });

    expect(personMatchesRole(person, "all")).toBe(true);
    expect(personMatchesRole(person, "counselor")).toBe(false);
  });
});
