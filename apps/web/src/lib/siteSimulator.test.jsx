import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HeroImageEditor from "../components/HeroImageEditor.jsx";

describe("director onboarding site simulator", () => {
  it("renders draft branding with screen and device controls", () => {
    const html = renderToStaticMarkup(
      <HeroImageEditor
        label="Live site simulation"
        campName="Camp Pine Ridge"
        campType="coed"
        brandPrimary="#24513f"
        heroImageUrl="https://images.example.test/camp.jpg"
        welcomeBody="Welcome back to the pines."
        enabledFeatureLabels={["Directory", "Events"]}
      />
    );

    expect(html).toContain("Live site simulation");
    expect(html).toContain("Draft changes appear here instantly");
    expect(html).toContain("Public landing");
    expect(html).toContain("Member home");
    expect(html).toContain("Desktop");
    expect(html).toContain("Mobile");
    expect(html).toContain("camp-pine-ridge.pondbridgealumni.com");
    expect(html).toContain("Welcome to the Camp Pine Ridge Alumni Network");
    expect(html).toContain("Welcome back to the pines.");
    expect(html).toContain("--brand-primary:#24513f");
    expect(html).toContain('role="tab" aria-selected="true"');
  });
});
