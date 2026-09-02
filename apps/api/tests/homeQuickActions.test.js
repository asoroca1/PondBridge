import {
  HOME_QUICK_ACTION_SLOTS,
  normalizeHomeQuickActions,
  resolveHomeQuickActions
} from "@pondbridge/shared";
import { buildTenantConfig, resolveContent } from "../src/services/onboarding.js";

function keysOf(actions) {
  return actions.map((action) => action.key);
}

describe("normalizeHomeQuickActions", () => {
  test("drops unknown keys, duplicates, and anything past the fourth slot", () => {
    expect(
      normalizeHomeQuickActions([
        "map",
        "map",
        "not-a-page",
        "giving",
        "chat",
        "photoStream",
        "myProfile"
      ])
    ).toEqual(["map", "giving", "chat", "photoStream"]);
  });

  test("treats a missing or malformed value as no choice at all", () => {
    expect(normalizeHomeQuickActions()).toEqual([]);
    expect(normalizeHomeQuickActions("map")).toEqual([]);
  });
});

describe("resolveHomeQuickActions", () => {
  test("keeps the legacy button row when the director has chosen nothing", () => {
    expect(keysOf(resolveHomeQuickActions([], {}))).toEqual([
      "search",
      "map",
      "chat",
      "newsletter"
    ]);
  });

  test("honours the director's order", () => {
    expect(keysOf(resolveHomeQuickActions(["giving", "myProfile", "events", "photoStream"], {})))
      .toEqual(["giving", "myProfile", "events", "photoStream"]);
  });

  test("tops the row back up when a chosen page's module is turned off", () => {
    const actions = resolveHomeQuickActions(["giving", "map"], { giving: false });

    expect(keysOf(actions)).toEqual(["map", "search", "chat", "newsletter"]);
    expect(actions).toHaveLength(HOME_QUICK_ACTION_SLOTS);
  });

  test("hides the merch shop until a storefront URL is saved", () => {
    expect(keysOf(resolveHomeQuickActions(["merchShop"], {}))).not.toContain("merchShop");

    const withStorefront = resolveHomeQuickActions(["merchShop"], {}, {
      merchShopUrl: "https://shop.example.org"
    });
    expect(withStorefront[0]).toMatchObject({
      key: "merchShop",
      external: true,
      href: "https://shop.example.org"
    });
  });
});

describe("tenant content", () => {
  test("carries the saved choice through to the member-facing config", () => {
    const tenant = {
      name: "Camp Example",
      content: { homeQuickActions: ["giving", "giving", "map", "nope"] }
    };

    expect(resolveContent(tenant).homeQuickActions).toEqual(["giving", "map"]);
    expect(buildTenantConfig(tenant).content.homeQuickActions).toEqual(["giving", "map"]);
  });
});
