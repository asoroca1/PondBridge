import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import QuestionnaireImportWizard from "./QuestionnaireImportWizard.jsx";

const fields = [{ path: "email", label: "Email" }, { path: "firstName", label: "First name" }];
const analysis = {
  fileName: "answers.csv", rowCount: 2, headers: ["Email", "Name"],
  proposals: [{ column: "Email", field: "email", source: "dictionary" }, { column: "Name", field: "firstName", source: "dictionary" }]
};
const preview = {
  createdCount: 1, updatedCount: 0, skippedDuplicates: 0, errorCount: 1,
  errors: [{ rowNumber: 3, message: "Invalid email" }],
  cleanup: { rewrites: [{ field: "firstName", column: "Name", before: "a", after: "Ada" }] }
};
const report = { createdCount: 1, reportId: "report-1", errorCount: 1 };
const file = new File(["Email,Name\nada@example.test,Ada"], "answers.csv", { type: "text/csv" });

function setup(overrides = {}) {
  const replies = { "/import/fields": { fields }, "/import/analyze": analysis, "/import/dry-run": preview, "/import/commit": report, "/imports/report-1/undo": { removedCount: 1, keptClaimedCount: 0 }, ...overrides };
  const request = vi.fn(async (path, options) => typeof replies[path] === "function" ? replies[path](options) : replies[path]);
  const download = vi.fn().mockResolvedValue(new Blob(["row,error\n3,Invalid email"]));
  render(<QuestionnaireImportWizard request={request} download={download} slug="synthetic-camp" />);
  return { request, download };
}
async function upload() {
  await waitFor(() => expect(screen.getByLabelText("Questionnaire CSV file")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Questionnaire CSV file"), { target: { files: [file] } });
  await screen.findByLabelText("Field for Email");
}
async function check() {
  fireEvent.click(screen.getByRole("button", { name: "Check what this will do" }));
  await screen.findByRole("button", { name: "Import 1 person" });
}

describe("questionnaire import acceptance", () => {
  test("reviews mappings and rewrites before committing, then downloads authenticated failures and undoes", async () => {
    const { request, download } = setup();
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:failures");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await upload();
    await check();
    expect(request.mock.calls.some(([path]) => path === "/import/commit")).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 person" }));
    await screen.findByText("1 profile is ready");
    const form = request.mock.calls.find(([path]) => path === "/import/commit")[1].body;
    expect(form.get("file")).toBe(file);
    expect(JSON.parse(form.get("mapping"))).toEqual({ Email: "email", Name: "firstName" });
    expect(JSON.parse(form.get("approvedRewrites"))).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Download the list" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith("/imports/report-1/failures.csv"));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:failures"));
    expect(create).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    await screen.findByText("1 profile removed");
    expect(request).toHaveBeenCalledWith("/imports/report-1/undo", { method: "POST", body: {} });
  });

  test("partial undo reports remaining profiles and offers a retry", async () => {
    let attempts = 0;
    setup({ "/imports/report-1/undo": () => ++attempts === 1
      ? { removedCount: 0, keptClaimedCount: 0, failures: [{ profileId: "p1" }] }
      : { removedCount: 1, keptClaimedCount: 0, failures: [] } });
    await upload();
    await check();
    fireEvent.click(screen.getByRole("button", { name: "Import 1 person" }));
    await screen.findByText("1 profile is ready");
    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be removed");
    fireEvent.click(screen.getByRole("button", { name: "Retry undo" }));
    await screen.findByText("1 profile removed");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("failed field loading has a retry and cannot start an unusable import", async () => {
    let attempts = 0;
    setup({ "/import/fields": () => { if (++attempts === 1) throw new Error("Fields unavailable"); return { fields }; } });
    await screen.findByText("Fields unavailable");
    expect(screen.getByLabelText("Questionnaire CSV file")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading fields" }));
    await waitFor(() => expect(screen.getByLabelText("Questionnaire CSV file")).toBeEnabled());
  });

  test("prevents ambiguous duplicate destinations", async () => {
    setup();
    await upload();
    fireEvent.change(screen.getByLabelText("Field for Name"), { target: { value: "email" } });
    expect(screen.getByRole("alert")).toHaveTextContent("only one column");
    expect(screen.getByRole("button", { name: "Check what this will do" })).toBeDisabled();
  });

  test("locks the reviewed mapping while preview is pending and preserves preview on commit failure", async () => {
    let resolvePreview;
    let attempts = 0;
    const { request } = setup({
      "/import/dry-run": () => new Promise((resolve) => { resolvePreview = resolve; }),
      "/import/commit": () => { if (++attempts === 1) throw new Error("Please retry"); return report; }
    });
    await upload();
    fireEvent.click(screen.getByRole("button", { name: "Check what this will do" }));
    expect(screen.getByLabelText("Field for Email")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose another file" })).toBeDisabled();
    resolvePreview(preview);
    await screen.findByRole("button", { name: "Import 1 person" });
    fireEvent.click(screen.getByRole("button", { name: "Import 1 person" }));
    await screen.findByText("Please retry");
    expect(screen.getByRole("checkbox")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Import 1 person" }));
    await screen.findByText("1 profile is ready");
    expect(request.mock.calls.filter(([path]) => path === "/import/commit")).toHaveLength(2);
  });
});
