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

// `fs` will not take a URL object built here: jsdom installs its own `URL` class
// over Node's, and the two are not interchangeable across that boundary. A plain
// path avoids the question entirely.
async function readStylesheet() {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  return readFile(join(import.meta.dirname, "advanced-search.css"), "utf8");
}

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

  // Regression: the role picker was built only from the roles the directory already
  // contained, so a role a director had just configured was not selectable until a
  // member had filled it in and the facets cache had aged out.
  it("offers every role the director configured, before any facets load", () => {
    const html = render();
    expect(html).toContain("Camper");
    expect(html).toContain("Counselor");
    expect(html).toContain("CIT");
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

describe("filter dropdown stacking", () => {
  // Regression: every .as2-sec is its own stacking context, and Display Options is
  // permanently `.open`, so it shared z-index 3 with a section holding a live dropdown
  // and — being later in the DOM — painted over the open menu.
  it("marks Display Options so it drops below a section with an open menu", () => {
    expect(render()).toContain("as2-sec-display");
  });

  it("keeps the stacking rules that make the fix work", async () => {
    const css = await readStylesheet();
    // The menu's own z-index cannot lift it out of its section's stacking context,
    // so the fix has to act on the sections themselves.
    expect(css).toMatch(/\.as2-sec\.as2-sec-display[\s\S]*?z-index:\s*1/);
    expect(css).toMatch(/\.as2-sec:has\(\.as2-mwrap\.is-open\)[\s\S]*?z-index:\s*30/);
  });
});

describe("empty-state actions layout", () => {
  // Regression: this container was written for a single button. Adding the browse-all
  // button left the two sitting flush, separated only by collapsed JSX whitespace.
  it("lays the buttons out as a spaced row", async () => {
    const css = await readStylesheet();
    const rule = css.match(/\.as2-empty-actions\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule[0]).toMatch(/display:\s*flex/);
    expect(rule[0]).toMatch(/gap:\s*10px/);
  });

  it("renders both actions in that container", () => {
    const html = render();
    expect(html).toContain("as2-empty-actions");
    expect(html).toContain("Start with a name search");
    expect(html).toContain("Browse all");
  });
});
