import router, { __testables } from "../src/routes/legacyCedarCompat.js";

const { IMAGE_MIME_TYPES } = __testables;

/**
 * Express runs middleware in registration order, so a route declared above
 * `router.use(requireAuth, ...)` serves without a session no matter what its
 * author assumed. This router is long enough that the boundary is easy to miss:
 * the object proxy, the city lookups, and the public presign all sat above it
 * at once, which meant anyone holding an object key could have a signed R2 URL
 * for it without logging in.
 *
 * Two things legitimately belong above the guard -- the wizard's pre-account
 * logo upload and the pre-login landing page's status probe -- and the list is
 * pinned here so adding a third is a deliberate act with a failing test to
 * argue with, rather than a silent one.
 */
const INTENTIONALLY_PUBLIC = [
  { method: "post", path: "/uploads/presign-public" },
  { method: "post", path: "/prelaunch/unlock" },
  { method: "get", path: "/prelaunch/status" }
];

function authGuardIndex() {
  return router.stack.findIndex((layer) =>
    !layer.route &&
    (layer.handle?.name === "requireAuth" ||
      (Array.isArray(layer.handle?.stack) &&
        layer.handle.stack.some((inner) => inner?.name === "requireAuth")))
  );
}

function routeLayers() {
  return router.stack
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => layer.route)
    .map(({ layer, index }) => ({
      index,
      path: layer.route.path,
      methods: Object.keys(layer.route.methods || {})
    }));
}

describe("legacy compat auth boundary", () => {
  test("the router installs requireAuth", () => {
    expect(authGuardIndex()).toBeGreaterThanOrEqual(0);
  });

  test("only the wizard and prelaunch probes are registered before requireAuth", () => {
    const guard = authGuardIndex();
    const publicRoutes = routeLayers()
      .filter((route) => route.index < guard)
      .flatMap((route) => route.methods.map((method) => ({ method, path: route.path })));

    const normalize = (list) =>
      list.map(({ method, path }) => `${method.toLowerCase()} ${path}`).sort();

    expect(normalize(publicRoutes)).toEqual(normalize(INTENTIONALLY_PUBLIC));
  });

  test("the object proxy is behind the guard", () => {
    const guard = authGuardIndex();
    const objectProxy = routeLayers().find(
      (route) => route.path === "/uploads/object" && route.methods.includes("get")
    );

    expect(objectProxy).toBeDefined();
    expect(objectProxy.index).toBeGreaterThan(guard);
  });

  test("no upload scope accepts SVG", () => {
    // A presigned PUT enforces the declared content type, not the bytes, so an
    // accepted SVG is an arbitrary script sitting in the bucket's own origin --
    // and presign-public takes uploads with no session at all.
    expect([...IMAGE_MIME_TYPES]).not.toContain("image/svg+xml");
    expect([...IMAGE_MIME_TYPES].length).toBeGreaterThan(0);
  });
});
