import { afterEach, describe, expect, it } from "vitest";
import { clearVolatileAuthToken, getVolatileAuthToken, setVolatileAuthToken } from "./authMemory.js";

describe("auth memory", () => {
  afterEach(() => {
    clearVolatileAuthToken();
  });

  it("stores only normalized volatile tokens", () => {
    setVolatileAuthToken("  bearer-token  ");

    expect(getVolatileAuthToken()).toBe("bearer-token");
  });

  it("clears the in-memory token", () => {
    setVolatileAuthToken("token");
    clearVolatileAuthToken();

    expect(getVolatileAuthToken()).toBe("");
  });
});
