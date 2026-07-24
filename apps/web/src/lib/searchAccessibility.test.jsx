import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RolesMultiSelect,
  SectionHead
} from "../cedar/pages/AdvancedSearch.jsx";

function TestIcon(props) {
  return <svg {...props} />;
}

describe("Camp Search accessibility semantics", () => {
  it("uses a named native trigger for camp-role options", () => {
    const html = renderToStaticMarkup(
      <RolesMultiSelect
        options={["Camper", "Counselor"]}
        value="Counselor"
        onChange={() => {}}
      />
    );

    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Former or current role at camp"');
    expect(html).toContain('aria-controls="camp-role-options"');
    expect(html).not.toContain('role="button"');
  });

  it("does not expose a non-interactive display heading as a button", () => {
    const html = renderToStaticMarkup(
      <SectionHead icon={TestIcon} label="Display Options" nonCollapsible />
    );

    expect(html).toContain("Display Options");
    expect(html).toContain('class="as2-sec-head static"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-expanded");
  });
});
