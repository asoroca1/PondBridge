import { describe, expect, it } from "vitest";
import { resolveCampAiName } from "./campLabels.js";

describe("camp-specific AI naming", () => {
  it("turns Camp Cedar into Cedar AI", () => {
    expect(resolveCampAiName({ name: "Camp Cedar" })).toBe("Cedar AI");
    expect(resolveCampAiName({ name: "Cedar" })).toBe("Cedar AI");
    expect(resolveCampAiName({ name: "Camp Cedar — Local Staging" })).toBe("Cedar AI");
  });

  it("supports an explicit tenant content override without exposing a vendor label", () => {
    expect(
      resolveCampAiName({
        name: "Camp Pine",
        config: { content: { aiAssistantName: "Pine Guide" } }
      })
    ).toBe("Pine Guide");
  });

  it("does not duplicate an existing AI suffix", () => {
    expect(resolveCampAiName({ name: "Matoaka AI" })).toBe("Matoaka AI");
    expect(resolveCampAiName({ name: "Camp Matoaka" })).toBe("Matoaka AI");
  });
});
