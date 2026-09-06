import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Whether a control is on screen depends on what the request came back with, so
// these mount the page rather than rendering it to a string.

vi.mock("../../context/TenantContext.jsx", () => ({
  useTenant: () => ({ slug: "cedar", tenant: { slug: "cedar", name: "Camp Cedar", content: {} } })
}));

vi.mock("../lib/helpers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getToken: () => "t"
}));

const requestFamilyTrees = vi.fn();
vi.mock("../lib/familyTreesApi", () => ({
  requestFamilyTrees: (...args) => requestFamilyTrees(...args)
}));

async function mountTrees(trees) {
  // The page treats this as a fetch Response: it checks `ok` and then reads
  // `json()`, so the double has to answer both.
  requestFamilyTrees.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ items: trees })
  });
  const { default: FamilyTrees } = await import("./FamilyTrees.jsx");
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <FamilyTrees />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  requestFamilyTrees.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe("Family Trees", () => {
  it("does not offer a search box when there is nothing to search", async () => {
    await mountTrees([]);
    await waitFor(() => expect(screen.getByText("No family trees yet")).toBeInTheDocument());
    expect(screen.queryByRole("textbox", { name: "Search Family Trees" })).not.toBeInTheDocument();
  });

  it("offers the search box once trees exist", async () => {
    await mountTrees([{ id: "1", name: "The Alvarez Family", memberCount: 3 }]);
    await waitFor(() =>
      expect(screen.getByText("The Alvarez Family")).toBeInTheDocument()
    );
    expect(screen.getByRole("textbox", { name: "Search Family Trees" })).toBeInTheDocument();
  });

  it("does not repeat the header's action inside the empty state", async () => {
    await mountTrees([]);
    await waitFor(() => expect(screen.getByText("No family trees yet")).toBeInTheDocument());
    // The header keeps one. A second copy on the same screen is the duplication
    // this replaced.
    expect(screen.getAllByText("Create New Family Tree")).toHaveLength(1);
  });

  it("describes itself in a member's words, not the data model's", async () => {
    await mountTrees([]);
    await waitFor(() => expect(screen.getByText("No family trees yet")).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/container/i);
  });
});
