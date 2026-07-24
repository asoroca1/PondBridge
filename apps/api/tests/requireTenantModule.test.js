import { jest } from "@jest/globals";
import { requireTenantModule } from "../src/middleware/requireFeature.js";

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

describe("requireTenantModule", () => {
  test("keeps legacy control camps enabled when the setting is absent", () => {
    const middleware = requireTenantModule("chat");
    const next = jest.fn();
    const res = createResponse();

    middleware({ tenant: { modules: {} }, user: { roles: ["user"] } }, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  test("blocks a target camp when the server setting is explicitly false", () => {
    const middleware = requireTenantModule("chat");
    const next = jest.fn();
    const res = createResponse();

    middleware({ tenant: { modules: { chat: false } }, user: { roles: ["user"] } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.payload?.error).toMatchObject({ code: "MODULE_DISABLED", module: "chat" });
  });

  test("blocks dependent search when the camp disables its directory", () => {
    const middleware = requireTenantModule("search");
    const next = jest.fn();
    const res = createResponse();

    middleware(
      { tenant: { modules: { directory: false, search: true } }, user: { roles: ["user"] } },
      res,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.payload?.error).toMatchObject({ code: "MODULE_DISABLED", module: "search" });
  });

  test("allows super administrators to investigate a disabled module", () => {
    const middleware = requireTenantModule("chat");
    const next = jest.fn();
    const res = createResponse();

    middleware(
      { tenant: { modules: { chat: false } }, user: { roles: ["super_admin"] } },
      res,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});
