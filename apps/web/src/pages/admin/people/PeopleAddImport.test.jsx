import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PeopleAddView, { parsePeopleRows, validateRows } from "./PeopleAddView.jsx";

const person = { firstName: "Ada", lastName: "Example", email: "ada@example.test" };

describe("People CSV review", () => {
  test.each([
    ["firstName,lastName,email\r\nAda,Example,ADA@example.test", person],
    ['\uFEFFEmail Address,Last Name,First Name\r\nADA@example.test,Example,Ada', person],
    ['firstName,lastName,email\n"Ada, A.","Ex""ample",ada@example.test', { ...person, firstName: "Ada, A.", lastName: 'Ex"ample' }],
    ['firstName,lastName,email\n"Ada\nA.",Example,ada@example.test', { ...person, firstName: "Ada\nA." }],
    ['\tExample\tada@example.test', { ...person, firstName: "" }],
    ['Ada,,ada@example.test', { ...person, lastName: "" }],
    ['ADA@example.test', { firstName: "", lastName: "", email: "ada@example.test" }],
    ['Ada,Example,broken-address', { ...person, email: "broken-address" }]
  ])("preserves source fields: %s", (input, expected) => {
    expect(parsePeopleRows(input)).toEqual([expected]);
  });

  test("keeps duplicates and invalid addresses for visible correction", () => {
    const rows = parsePeopleRows('firstName,lastName,email\nAda,Example,ada@example.test\nOther,Person,ADA@example.test\nThird,Person,broken');
    expect(rows).toHaveLength(3);
    const validation = validateRows(rows);
    expect(validation.ready).toEqual([person]);
    expect(validation.problems.get(1)).toMatch(/Duplicate/);
    expect(validation.problems.get(2)).toMatch(/not valid/);
  });

  test("rejects incomplete quoted records without producing partial imports", () => {
    expect(() => parsePeopleRows('Ada,Example,ada@example.test\n"Unclosed,Person,x@example.test')).toThrow();
  });

  test("malformed upload preserves the sheet, and a corrected upload can be saved after review", async () => {
    const actions = { busy: "", addProspects: vi.fn().mockResolvedValue({ ok: true, message: "Saved." }), sendInvitesNow: vi.fn() };
    const { container } = render(<PeopleAddView actions={actions} storage={{ available: true }} />);
    fireEvent.change(screen.getByLabelText("Email, row 1"), { target: { value: "existing@example.test" } });
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File(['"Unclosed'], "bad.csv", { type: "text/csv" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be parsed");
    expect(screen.getByLabelText("Email, row 1")).toHaveValue("existing@example.test");
    fireEvent.change(input, { target: { files: [new File(['firstName,lastName,email\nAda,Example,ada@example.test'], "good.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(screen.getByLabelText("Email, row 2")).toHaveValue(person.email));
    expect(actions.addProspects).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save as prospects" }));
    await waitFor(() => expect(actions.addProspects).toHaveBeenCalledWith([
      { firstName: "", lastName: "", email: "existing@example.test", source: "director_entry" },
      { ...person, source: "director_entry" }
    ]));
    expect(actions.sendInvitesNow).not.toHaveBeenCalled();
  });

  test("pasting into a blank row preserves a later populated row", () => {
    render(<PeopleAddView actions={{ busy: "" }} storage={{ available: true }} />);
    fireEvent.change(screen.getByLabelText("Email, row 3"), { target: { value: "later@example.test" } });
    fireEvent.paste(screen.getByLabelText("First name, row 2"), { clipboardData: { getData: () => 'Ada\tExample\tada@example.test' } });
    expect(screen.getByLabelText("Email, row 2")).toHaveValue(person.email);
    expect(screen.getByLabelText("Email, row 3")).toHaveValue("later@example.test");
  });
});
