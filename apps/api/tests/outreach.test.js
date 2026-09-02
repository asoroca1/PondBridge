import {
  OUTREACH_STAGES,
  buildOutreachAgentTools,
  getOutreachAgentStatus,
  interactionCountsAsContact,
  isOutreachMutationTool,
  normalizeOutreachAccountInput,
  normalizeOutreachContactInput,
  normalizeOutreachInteractionInput,
  normalizeOutreachMessage,
} from "../src/services/outreach.js";
import outreachRouter from "../src/routes/outreach.js";

describe("outreach workspace domain contract", () => {
  test("defines explicit signed, nurture, and lost lifecycle stages", () => {
    expect(OUTREACH_STAGES).toEqual(
      expect.arrayContaining([
        "identified",
        "ready_to_contact",
        "proposal",
        "signed",
        "nurture",
        "lost",
      ])
    );
  });

  test("normalizes a pipeline record and rejects unknown stages", () => {
    expect(
      normalizeOutreachAccountInput({
        name: "  Camp Pine  ",
        stage: "engaged",
        websiteUrl: "https://camppine.example/about",
        ownerLabel: " Alex ",
        nextAction: " Schedule director call ",
      })
    ).toEqual(
      expect.objectContaining({
        name: "Camp Pine",
        stage: "engaged",
        ownerLabel: "Alex",
        nextAction: "Schedule director call",
      })
    );
    expect(() => normalizeOutreachAccountInput({ name: "Camp Pine", stage: "maybe" })).toThrow(
      /valid outreach stage/i
    );
  });

  test("validates professional contact and interaction fields", () => {
    expect(normalizeOutreachContactInput({ firstName: "Ada", email: "ADA@EXAMPLE.COM" })).toEqual(
      expect.objectContaining({ firstName: "Ada", email: "ada@example.com" })
    );
    expect(() => normalizeOutreachContactInput({ email: "not-an-email" })).toThrow(/valid email/i);

    const externalEmail = normalizeOutreachInteractionInput({
      interactionType: "email",
      direction: "outbound",
      summary: "Sent the reviewed introduction.",
    });
    expect(interactionCountsAsContact(externalEmail)).toBe(true);
    expect(interactionCountsAsContact({ interactionType: "research", direction: "internal" })).toBe(
      false
    );
  });

  test("keeps the agent approval-first with no send capability", () => {
    expect(getOutreachAgentStatus()).toEqual(
      expect.objectContaining({
        mode: "approval_first",
        canSend: false,
      })
    );
    expect(normalizeOutreachMessage("  Draft a follow-up  ")).toBe("Draft a follow-up");
    expect(() => normalizeOutreachMessage("   ")).toThrow(/enter a message/i);

    const tools = buildOutreachAgentTools();
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "search_outreach_pipeline",
        "create_outreach_camp",
        "update_outreach_camp",
        "add_outreach_contact",
        "log_outreach_interaction",
      ])
    );
    expect(toolNames).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/send|deliver|schedule|delete/i)])
    );
    expect(isOutreachMutationTool("update_outreach_camp")).toBe(true);
    expect(isOutreachMutationTool("send_email")).toBe(false);
    for (const tool of tools) {
      expect(tool.strict).toBe(true);
      expect(tool.parameters.additionalProperties).toBe(false);
    }

    const routePaths = outreachRouter.stack.map((layer) => layer.route?.path).filter(Boolean);
    expect(routePaths).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/send|deliver|schedule|delete/i)])
    );
  });
});
