import { requireDurableCopilotAudit } from "../src/services/copilotAudit.js";

describe("copilot durable audit boundary", () => {
  test("returns the durable audit record when storage succeeds", async () => {
    const record = { id: "audit_1" };
    await expect(requireDurableCopilotAudit(async () => record)).resolves.toEqual(record);
  });

  test("fails closed with a safe service error when audit storage fails", async () => {
    const cause = new Error("database detail that must stay server-side");
    await expect(
      requireDurableCopilotAudit(
        async () => {
          throw cause;
        },
        {
          code: "SUPER_COPILOT_AUDIT_UNAVAILABLE",
          message: "Operations Agent is unavailable because its audit trail could not be written."
        }
      )
    ).rejects.toMatchObject({
      code: "SUPER_COPILOT_AUDIT_UNAVAILABLE",
      statusCode: 503,
      cause
    });
  });
});
