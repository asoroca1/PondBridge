import {
  normalizeReportInput,
  normalizeReportReviewInput,
  reportPreview
} from "../src/services/memberSafety.js";

describe("member safety validation", () => {
  test("normalizes a supported content report without retaining markup", () => {
    expect(
      normalizeReportInput({
        targetType: " MESSAGE ",
        targetId: "64b7f15c2f3a4d5e6f708192",
        reason: " HARASSMENT ",
        details: "<b>Repeated</b> unwanted messages"
      })
    ).toEqual({
      targetType: "message",
      targetId: "64b7f15c2f3a4d5e6f708192",
      reason: "harassment",
      details: "Repeated unwanted messages"
    });
  });

  test("binds a photo comment report to both the parent photo and comment", () => {
    expect(
      normalizeReportInput({
        targetType: "photo_comment",
        parentId: "64b7f15c2f3a4d5e6f708192",
        targetId: "64b7f15c2f3a4d5e6f708193",
        reason: "privacy"
      }).targetId
    ).toBe("64b7f15c2f3a4d5e6f708192:64b7f15c2f3a4d5e6f708193");
  });

  test.each([
    [{ targetType: "unknown", targetId: "64b7f15c2f3a4d5e6f708192", reason: "spam" }, "INVALID_REPORT_TARGET"],
    [{ targetType: "member", targetId: "64b7f15c2f3a4d5e6f708192", reason: "revenge" }, "INVALID_REPORT_REASON"],
    [{ targetType: "member", targetId: "not-an-id", reason: "spam" }, "INVALID_REPORT_TARGET"]
  ])("rejects unsupported report input", (input, code) => {
    expect(() => normalizeReportInput(input)).toThrow(expect.objectContaining({ code }));
  });

  test("requires an auditable note before a director closes a report", () => {
    expect(() => normalizeReportReviewInput({ status: "resolved", resolutionNote: "" })).toThrow(
      expect.objectContaining({ code: "REPORT_RESOLUTION_NOTE_REQUIRED" })
    );
    expect(normalizeReportReviewInput({ status: "resolved", resolutionNote: "  Contacted member. " })).toEqual({
      status: "resolved",
      resolutionNote: "Contacted member."
    });
  });

  test("limits report previews to a compact moderation-safe summary", () => {
    const preview = reportPreview(`<b>${"a".repeat(300)}</b>`);
    expect(preview).toHaveLength(240);
    expect(preview.endsWith("...")).toBe(true);
    expect(preview).not.toContain("<b>");
  });
});
