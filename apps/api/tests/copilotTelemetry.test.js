import { normalizeCopilotTelemetry } from "../src/services/copilotTelemetry.js";

describe("copilot telemetry privacy contract", () => {
  test("keeps only allowlisted, non-content workspace metadata", () => {
    expect(
      normalizeCopilotTelemetry({
        surface: "director",
        eventType: "evidence_opened",
        mode: "ai",
        target: "billing",
        question: "This value must never be retained"
      })
    ).toEqual({
      eventType: "director_agent_evidence_opened",
      metadata: {
        mode: "ai",
        target: "billing",
        surfaceVersion: "agent-workspace-v1"
      }
    });
  });

  test("rejects unknown events and collapses unknown targets", () => {
    expect(normalizeCopilotTelemetry({ surface: "super", eventType: "raw_prompt", mode: "ai" })).toBeNull();
    expect(
      normalizeCopilotTelemetry({
        surface: "super",
        eventType: "evidence_opened",
        mode: "guided",
        target: "member_email_someone@example.com"
      })?.metadata?.target
    ).toBe("other");
  });
});
