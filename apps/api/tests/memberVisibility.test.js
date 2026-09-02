import {
  activityActorUserIds,
  canAccessMemberProfile,
  filterActivityItemsForActiveUsers
} from "../src/services/memberVisibility.js";

describe("removed member visibility", () => {
  test("denies removed profiles and profiles whose account was deleted or deactivated", () => {
    const profile = { _id: "profile-1", userId: "user-1", status: "active" };

    expect(canAccessMemberProfile({ profile, user: { _id: "user-1", status: "active" } })).toBe(true);
    expect(canAccessMemberProfile({
      profile: { ...profile, status: "removed" },
      user: { _id: "user-1", status: "active" }
    })).toBe(false);
    expect(canAccessMemberProfile({ profile, user: { _id: "user-1", status: "inactive" } })).toBe(false);
    expect(canAccessMemberProfile({ profile, user: null })).toBe(false);
  });

  test("removes activity from deactivated and deleted actors while retaining active and system items", () => {
    const items = [
      { _id: "active-item", actorUserId: "active-user" },
      { _id: "removed-item", actorUserId: "removed-user" },
      { _id: "deleted-item", actorUserId: "deleted-user" },
      { _id: "system-item", type: "system.notice" }
    ];
    const users = [
      { _id: "active-user", status: "active" },
      { _id: "removed-user", status: "inactive" }
    ];

    expect(activityActorUserIds(items)).toEqual([
      "active-user",
      "removed-user",
      "deleted-user"
    ]);
    expect(filterActivityItemsForActiveUsers(items, users).map((item) => item._id)).toEqual([
      "active-item",
      "system-item"
    ]);
  });
});
