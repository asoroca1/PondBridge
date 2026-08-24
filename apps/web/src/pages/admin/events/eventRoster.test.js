import { describe, expect, test } from "vitest";
import { splitRoster } from "./eventUtils.js";

const person = (overrides = {}) => ({
  profileId: "p1",
  fullName: "Dana Reed",
  status: "attending",
  registrationRole: "attendee",
  ...overrides
});

describe("splitRoster", () => {
  test("separates presenters from everyone else", () => {
    const { presenters, attendees } = splitRoster([
      person({ profileId: "p1", registrationRole: "presenter" }),
      person({ profileId: "p2" }),
      person({ profileId: "p3", status: "maybe" })
    ]);

    expect(presenters.map((item) => item.profileId)).toEqual(["p1"]);
    expect(attendees.map((item) => item.profileId)).toEqual(["p2", "p3"]);
  });

  test("a presenter who declined drops off the presenter list", () => {
    const { presenters, attendees } = splitRoster([
      person({ profileId: "p1", registrationRole: "presenter", status: "not_attending" })
    ]);

    expect(presenters).toHaveLength(0);
    expect(attendees.map((item) => item.profileId)).toEqual(["p1"]);
  });

  test("handles a missing roster", () => {
    expect(splitRoster()).toEqual({ presenters: [], attendees: [] });
    expect(splitRoster(null)).toEqual({ presenters: [], attendees: [] });
  });
});
