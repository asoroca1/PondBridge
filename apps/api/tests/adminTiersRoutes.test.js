import router from "../src/routes/adminTiers.js";

/**
 * Express matches routes in registration order, so a literal path has to be
 * declared before a parameterised one that could swallow it. When "/settings"
 * sat after "/:tierId", every settings write — the enforcement switch, the
 * untagged default, and the whole feature grid — was read as a tier id and
 * failed with "Invalid tier id." Nothing about that is visible in a unit test
 * of the handlers, so the guard belongs on the router itself.
 */
function registeredRoutes() {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods || {})
    }));
}

function indexOf(method, path) {
  return registeredRoutes().findIndex(
    (route) => route.path === path && route.methods.includes(method)
  );
}

describe("admin tier route registration", () => {
  test("literal paths are declared before the tier-id routes that would swallow them", () => {
    const settings = indexOf("patch", "/settings");
    const patchById = indexOf("patch", "/:tierId");

    expect(settings).toBeGreaterThanOrEqual(0);
    expect(patchById).toBeGreaterThanOrEqual(0);
    expect(settings).toBeLessThan(patchById);
  });

  test("every literal path this router serves is unreachable by a tier id", () => {
    const routes = registeredRoutes();
    const literals = routes.filter(
      (route) => route.path !== "/" && !route.path.includes(":")
    );
    // Each literal must come before any same-method parameterised route.
    for (const literal of literals) {
      for (const method of literal.methods) {
        const literalIndex = routes.findIndex(
          (route) => route.path === literal.path && route.methods.includes(method)
        );
        const shadowIndex = routes.findIndex(
          (route) => route.path.includes(":") && route.methods.includes(method)
        );
        if (shadowIndex >= 0) expect(literalIndex).toBeLessThan(shadowIndex);
      }
    }
    expect(literals.map((route) => route.path).sort()).toEqual([
      "/assign",
      "/assign-by-role",
      "/roster",
      "/settings"
    ]);
  });
});
