import {
  buildCopilotSafetyIdentifier,
  buildDirectorCopilotTools,
  hashCopilotContent,
  isReadOnlyCopilotTool,
  normalizeCopilotQuestion
} from "../src/services/directorCopilot.js";

describe("director copilot safety contract", () => {
  test("removes markup and limits the question sent to the provider", () => {
    const question = normalizeCopilotQuestion(
      `<script>steal()</script><strong>Help</strong> me\n\n\nwith launch${"x".repeat(2500)}`
    );

    expect(question).not.toContain("script");
    expect(question).not.toContain("<strong>");
    expect(question).toContain("Help me\n\nwith launch");
    expect(question.length).toBeLessThanOrEqual(2000);
  });

  test("exposes only strict read-only tools", () => {
    const tools = buildDirectorCopilotTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "get_launch_readiness",
      "get_director_action_queue",
      "get_community_overview",
      "explain_admin_screen"
    ]);
    for (const tool of tools) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(Array.isArray(tool.parameters.required)).toBe(true);
      expect(isReadOnlyCopilotTool(tool.name)).toBe(true);
      expect(tool.name).not.toMatch(/send|approve|delete|update|publish|execute|billing_change/);
    }
    expect(isReadOnlyCopilotTool("send_email")).toBe(false);
  });

  test("creates stable privacy-preserving hashes without exposing actor identifiers", () => {
    const identifier = buildCopilotSafetyIdentifier({
      tenantId: "tenant-secret-id",
      actorUserId: "director-secret-id"
    });

    expect(identifier).toBe(
      buildCopilotSafetyIdentifier({ tenantId: "tenant-secret-id", actorUserId: "director-secret-id" })
    );
    expect(identifier).toMatch(/^pb_[a-f0-9]{40}$/);
    expect(identifier).not.toContain("tenant-secret-id");
    expect(hashCopilotContent("same")).toBe(hashCopilotContent("same"));
  });
});
