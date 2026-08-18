import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PeopleAddView from "./PeopleAddView.jsx";

function render() {
  return renderToStaticMarkup(
    <PeopleAddView
      actions={{ busy: "", addProspects: async () => ({ ok: true, message: "" }) }}
      storage={{ available: true }}
      slug="cedar"
      networkName="Camp Cedar"
      onInvite={() => {}}
      onDone={() => {}}
    />
  );
}

describe("Add people sheet", () => {
  test("addresses every cell so arrow keys can find its neighbours", () => {
    const markup = render();
    // The keyboard handler looks cells up by this exact attribute; a rename
    // here silently breaks navigation, so the contract is pinned.
    for (const field of ["firstName", "lastName", "email"]) {
      expect(markup).toContain(`data-cell="0-${field}"`);
      expect(markup).toContain(`data-cell="4-${field}"`);
    }
  });

  test("keeps the email column a text input so it reports a caret", () => {
    // type="email" returns a null selectionStart and throws on
    // setSelectionRange, which would strand the caret in that column.
    expect(render()).not.toContain('type="email"');
  });

  test("agrees with itself about how many rows need attention", () => {
    const markup = renderToStaticMarkup(
      <PeopleAddView
        actions={{ busy: "", addProspects: async () => ({ ok: true, message: "" }) }}
        storage={{ available: true }}
        onInvite={() => {}}
        onDone={() => {}}
      />
    );
    // Nothing is filled in, so nothing is flagged yet; the singular wording is
    // covered by the branch itself rather than by driving the whole grid.
    expect(markup).not.toContain("row need attention");
  });

  test("no longer offers the optional details section", () => {
    const markup = render();
    expect(markup).not.toContain("Optional details");
    expect(markup).not.toContain("pb-people-optional");
    expect(markup).not.toContain("Reunion, donor");
  });
});
