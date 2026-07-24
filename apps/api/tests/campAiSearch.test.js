import {
  createDeterministicSearchPlan,
  normalizeCampAiSearchPlan,
  normalizeCampAiSearchQuery,
  resolveCampAiSearchPlan
} from "../src/services/campAiSearch.js";
import { SUPPORTED_FEATURE_ROLLOUTS } from "../src/services/featureRollouts.js";

describe("tenant-scoped Camp Search AI planning", () => {
  const campRoles = ["Camper", "Counselor", "JC", "CIT", "Admin"];

  test("turns a natural-language request into deterministic private-search filters", () => {
    expect(createDeterministicSearchPlan(
      "Former counselors in Boston who work in healthcare",
      { campRoles }
    )).toMatchObject({
      q: "",
      cedarRoles: ["Counselor"],
      industries: ["Healthcare"],
      city: "Boston",
      intent: "mixed"
    });
  });

  test("preserves a person name while extracting company and camp-role filters", () => {
    expect(createDeterministicSearchPlan(
      "Find Jordan who was a Counselor and works at Blackstone",
      { campRoles }
    )).toMatchObject({
      q: "Jordan",
      cedarRoles: ["Counselor"],
      company: "Blackstone"
    });
  });

  test("normalizes bounded years, deduplicates fields, and strips markup", () => {
    expect(normalizeCampAiSearchQuery(" <b>Find   Jordan</b>\u0000 ")).toBe("Find Jordan");
    expect(normalizeCampAiSearchPlan({
      q: "",
      cedarRoles: ["Counselor", "Counselor"],
      industries: [],
      city: "",
      state: "",
      role: "",
      company: "",
      college: "UCLA",
      gradMin: 2020,
      gradMax: 2018,
      camperMin: null,
      camperMax: null,
      intent: "education"
    })).toMatchObject({
      cedarRoles: ["Counselor"],
      college: "UCLA",
      gradMin: 2018,
      gradMax: 2020,
      intent: "mixed"
    });
  });

  test("registers an off-by-default rollout control for Camp Search AI", () => {
    expect(SUPPORTED_FEATURE_ROLLOUTS.camp_ai_search_v1).toMatchObject({
      label: "Camp Search AI"
    });
  });

  test("labels provider failures as guided fallback and returns no generation claim", async () => {
    const providerError = Object.assign(new Error("provider unavailable"), { code: "PROVIDER_DOWN" });
    const result = await resolveCampAiSearchPlan({
      query: "Counselors in Boston who work in healthcare",
      context: { campRoles },
      planner: async () => { throw providerError; }
    });

    expect(result).toMatchObject({
      mode: "guided_fallback",
      errorCode: "PROVIDER_DOWN",
      planner: {
        generationId: null,
        provider: null,
        usage: null,
        plan: {
          cedarRoles: ["Counselor"],
          industries: ["Healthcare"],
          city: "Boston"
        }
      }
    });
  });
});
