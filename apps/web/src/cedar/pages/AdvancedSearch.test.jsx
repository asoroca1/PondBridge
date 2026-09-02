import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

// Effects do not run under static rendering, so this exercises the first paint a
// member sees: facets unloaded, nothing searched yet.
vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ token: "t", getAuthToken: async () => "t", isReady: true })
}));

vi.mock("../../context/TenantContext.jsx", () => ({
  useTenant: () => ({
    slug: "cedar",
    tenant: { name: "Camp Cedar", content: { campType: "coed", staffRoles: ["Camper", "Counselor", "CIT"] } }
  })
}));

const { default: AdvancedSearch } = await import("./AdvancedSearch.jsx");

const render = (url = "/") =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[url]}>
      <AdvancedSearch />
    </MemoryRouter>
  );

describe("AdvancedSearch first paint", () => {
  it("renders without throwing", () => {
    expect(() => render()).not.toThrow();
  });

  it("offers Best match as the default sort, with A-Z and Recently Added", () => {
    const html = render();
    expect(html).toContain("Best match");
    expect(html).toContain("Name (A-Z)");
    expect(html).toContain("Recently Added");
    // "Best match" is selected, not merely present.
    expect(html).toMatch(/<option value="relevance" selected="">?/);
  });

  it("renders the state filter as a picker of real state codes, not free text", () => {
    const html = render();
    expect(html).toContain("Any state");
    expect(html).toContain("Massachusetts");
    expect(html).not.toContain("State / Country");
  });

  it("falls back to the shared industry list before facets load", () => {
    const html = render();
    expect(html).toContain("Select industries...");
  });

  it("offers a browse-all entry point alongside the name search", () => {
    const html = render();
    expect(html).toContain("Start with a name search");
    expect(html).toContain("Browse all");
  });

  it("wires datalists for the name, college and company suggestions", () => {
    const html = render();
    expect(html).toContain('id="advanced-search-name-options"');
    expect(html).toContain('id="advanced-search-college-options"');
    expect(html).toContain('id="advanced-search-company-options"');
  });

  it("no longer tells members to comma-separate industries", () => {
    expect(render()).not.toContain("Separate multiple industries with commas");
  });
});

describe("a shared search link before auth resolves", () => {
  // Regression: the fetch effect bailed while auth resolved but left the state that
  // means "searched, found nothing", so a deep link first painted "No matches".
  it("shows the loading grid, not the no-results state", () => {
    const html = render("/?q=henry");
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain("No matches");
    expect(html).not.toContain("Try widening or clearing your filters");
  });

  it("announces progress in a live region", () => {
    const html = render("/?q=henry");
    expect(html).toMatch(/aria-live="polite"/);
    expect(html).toContain("Searching");
  });

  it("normalizes a legacy full state name onto the picker's code", () => {
    const html = render("/?state=Massachusetts");
    expect(html).toMatch(/<option value="MA" selected="">?/);
  });

  it("still reflects a two-letter state code", () => {
    expect(render("/?state=NY")).toMatch(/<option value="NY" selected="">?/);
  });
});
