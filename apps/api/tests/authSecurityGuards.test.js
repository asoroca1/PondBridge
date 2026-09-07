import { jest } from "@jest/globals";
import { readBearerToken } from "../src/utils/bearerToken.js";

const verifyToken = jest.fn();
const env = {
  AUTH_PROVIDER: "clerk",
  CLERK_SECRET_KEY: "test-key",
  CLERK_JWT_AUDIENCE: "pondbridge-api",
  CLERK_AUTHORIZED_PARTIES: ["https://app.example.test"],
  AUTH_TOKEN_MODE: "cookie",
  AUTH_COOKIE_NAME: "session",
  FRONTEND_ORIGINS: ["https://app.example.test"],
  CUSTOM_DOMAIN_ALLOWLIST: []
};
jest.unstable_mockModule("../src/config/env.js", () => ({ env }));
jest.unstable_mockModule("@clerk/backend", () => ({
  createClerkClient: () => ({}),
  verifyToken
}));
const { resolveClerkIdentityFromRequest } = await import("../src/services/clerkIdentity.js");
const { csrfProtection } = await import("../src/middleware/csrfProtection.js");

beforeEach(() => verifyToken.mockReset());

test.each(["Bearer token", "bearer token", "BEARER token", "Bearer\ttoken"])(
  "auth schemes are case insensitive: %s", (authorization) => {
    expect(readBearerToken({ headers: { authorization } })).toBe("token");
  }
);

test.each(["", "Bearer", "Bearer   ", "Basic token", "Bearer token extra"])(
  "missing or malformed credentials do not exempt cookie requests: %s", (authorization) => {
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    csrfProtection({ method: "POST", path: "/api/t/camp/profile", headers: {
      authorization, cookie: "session=cookie-token", origin: "https://attacker.test"
    } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  }
);

test.each(["audience mismatch", "authorized party mismatch"])(
  "Clerk policy rejection fails closed: %s", async (message) => {
    verifyToken.mockRejectedValueOnce(new Error(message));
    await expect(resolveClerkIdentityFromRequest({ headers: { authorization: "Bearer token" } }))
      .rejects.toThrow(message);
    expect(verifyToken).toHaveBeenCalledTimes(1);
    expect(verifyToken).toHaveBeenCalledWith("token", {
      secretKey: "test-key", audience: "pondbridge-api", authorizedParties: env.CLERK_AUTHORIZED_PARTIES
    });
  }
);

test("lowercase bearer is verified instead of falling back to the ambient Clerk cookie", async () => {
  verifyToken.mockRejectedValueOnce(new Error("invalid token"));
  await expect(resolveClerkIdentityFromRequest({ headers: {
    authorization: "bearer supplied-token", cookie: "__session=ambient-cookie"
  } })).rejects.toThrow("invalid token");
  expect(verifyToken.mock.calls[0][0]).toBe("supplied-token");
});
