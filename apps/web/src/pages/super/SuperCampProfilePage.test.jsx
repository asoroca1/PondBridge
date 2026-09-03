import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({
    token: "t",
    getAuthToken: async () => "t",
    user: { roles: ["super_admin"] },
    isReady: true
  })
}));

const { default: SuperCampProfilePage, ClaimLinkRow } = await import("./SuperCampProfilePage.jsx");

const render = () =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={["/super/tenants/tenant-42"]}>
      <Routes>
        <Route path="/super/tenants/:tenantId" element={<SuperCampProfilePage />} />
      </Routes>
    </MemoryRouter>
  );

describe("super camp profile first paint", () => {
  // Effects do not run under static rendering, so this is the loading frame the
  // operator sees before the camp record arrives.
  it("renders without throwing", () => {
    expect(() => render()).not.toThrow();
    expect(render()).toContain("Loading camp profile");
  });
});

describe("director claim link row", () => {
  it("shows the link as selectable read-only text with copy and open actions", () => {
    const html = renderToStaticMarkup(
      <ClaimLinkRow
        label="Director claim link"
        value="https://pine.pondbridgealumni.com/director-claim"
        onCopy={() => {}}
      />
    );

    expect(html).toContain('value="https://pine.pondbridgealumni.com/director-claim"');
    // HTML attribute names are case-insensitive; React emits this one camel-cased.
    expect(html).toMatch(/readonly=""/i);
    expect(html).toContain("Copy");
    expect(html).toContain("Open");
  });

  // The row is rendered for links that may not exist yet (a camp domain that is
  // still activating has no captured link), and must stay silent then.
  it("renders nothing when there is no link", () => {
    expect(renderToStaticMarkup(<ClaimLinkRow label="Claim" value="" onCopy={() => {}} />)).toBe("");
  });
});
