import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@pondbridge/ui";

describe("Button primitive", () => {
  it("supports ghost and small styling without leaking component props to the DOM", () => {
    const html = renderToStaticMarkup(
      <Button variant="ghost" size="sm" loading className="custom-class">
        Refresh
      </Button>
    );

    expect(html).toContain("pb-btn-ghost");
    expect(html).toContain("pb-btn-sm");
    expect(html).toContain("custom-class");
    expect(html).toContain("aria-busy=\"true\"");
    expect(html).toContain("type=\"button\"");
    expect(html).toContain("disabled");
    expect(html).not.toContain("variant=");
    expect(html).not.toContain("size=");
    expect(html).not.toContain("loading=");
  });
});
