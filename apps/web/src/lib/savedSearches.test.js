import { describe, expect, it } from "vitest";
import { savedSearchStorageKey } from "./savedSearches.js";

describe("saved search ownership", () => {
  it("separates members in the same camp and the same member across camps", () => {
    const key = savedSearchStorageKey("cedar", "member-a");
    expect(key).not.toBe(savedSearchStorageKey("cedar", "member-b"));
    expect(key).not.toBe(savedSearchStorageKey("pine", "member-a"));
  });
  it("waits for both tenant and member identity", () => {
    expect(savedSearchStorageKey("cedar", null)).toBeNull();
    expect(savedSearchStorageKey(null, "member-a")).toBeNull();
  });
});
