import { expect, it, vi } from "vitest";
import { AttributionControl } from "maplibre-gl";

it("removes every adjacent dangerous attribution attribute while keeping the credit link", () => {
  const control = new AttributionControl({ customAttribution:
    '<details open onload="1" ontoggle="alert(1)">Credit</details><a href="https://example.invalid" onclick="1" onmouseover="2">Provider</a>' });
  const element = control.onAdd({
    style: { stylesheet: {}, tileManagers: {} },
    _getUIString: () => "Attribution",
    getCanvasContainer: () => document.createElement("div"),
    on: vi.fn(), off: vi.fn()
  });
  expect(element.textContent).toContain("Provider");
  expect(element.querySelector('a').getAttribute("href")).toBe("https://example.invalid");
  for (const node of element.querySelectorAll("*")) {
    expect([...node.attributes].some(({ name }) => name.startsWith("on"))).toBe(false);
  }
  control.onRemove();
});
