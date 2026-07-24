import { filterProfileContactFields, normalizeProfilePrivacy } from "../src/services/profilePrivacy.js";

const profile = {
  userId: "owner-1",
  emails: ["member@example.test"],
  phones: ["555-0100"],
  privacy: { email: "admins_only", phone: "hidden" }
};

describe("profile contact privacy", () => {
  test("keeps existing profiles member-visible by default", () => {
    expect(normalizeProfilePrivacy({})).toEqual({ email: "members", phone: "members" });
    expect(filterProfileContactFields({ ...profile, privacy: {} }, { id: "member-2", roles: ["user"] }))
      .toMatchObject({ emails: ["member@example.test"], phones: ["555-0100"] });
  });

  test("applies admins-only and hidden visibility on the server", () => {
    expect(filterProfileContactFields(profile, { id: "member-2", roles: ["user"] }))
      .toMatchObject({ emails: [], phones: [] });
    expect(filterProfileContactFields(profile, { id: "director-1", roles: ["tenant_admin"] }))
      .toMatchObject({ emails: ["member@example.test"], phones: [] });
  });

  test("always lets the profile owner see their contact fields", () => {
    expect(filterProfileContactFields(profile, { id: "owner-1", roles: ["user"] }))
      .toMatchObject({ emails: ["member@example.test"], phones: ["555-0100"] });
  });
});
