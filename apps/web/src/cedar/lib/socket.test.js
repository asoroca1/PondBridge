import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ io: vi.fn(), stored: vi.fn(), volatile: vi.fn(), settled: vi.fn() }));
vi.mock("socket.io-client", () => ({ io: mocks.io }));
vi.mock("../../lib/http.js", () => ({ API_BASE: "http://127.0.0.1:4010/api" }));
vi.mock("./helpers.js", () => ({ getToken: mocks.stored }));
vi.mock("../../lib/authMemory.js", () => ({ getVolatileAuthToken: mocks.volatile }));
vi.mock("../../lib/authReadiness.js", () => ({ whenAuthSettled: mocks.settled }));
import { attachSocketStatus, createSocket } from "./socket.js";

describe("messaging socket authentication and recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("window", { location: { pathname: "/t/cedar/chats" } });
    mocks.stored.mockReturnValue("old-stored-token");
    mocks.volatile.mockReturnValue("current-token");
    mocks.settled.mockResolvedValue();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("waits for session restoration and resolves current credentials on every handshake", async () => {
    let settle;
    mocks.settled.mockReturnValue(new Promise((resolve) => { settle = resolve; }));
    createSocket();
    const [url, options] = mocks.io.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4010");
    expect(options.tryAllTransports).toBe(true);
    const done = vi.fn();
    const pending = options.auth(done);
    expect(done).not.toHaveBeenCalled();
    mocks.volatile.mockReturnValue("restored-token");
    settle();
    await pending;
    expect(done).toHaveBeenLastCalledWith({ token: "restored-token", tenantSlug: "cedar" });
    mocks.volatile.mockReturnValue("rotated-token");
    await options.auth(done);
    expect(done).toHaveBeenLastCalledWith({ token: "rotated-token", tenantSlug: "cedar" });
  });

  it("requests fresh Clerk credentials instead of reusing the mounted page token", async () => {
    const getToken = vi.fn().mockResolvedValue("fresh-clerk-token");
    window.Clerk = { session: { getToken } };
    createSocket();
    const done = vi.fn();
    await mocks.io.mock.calls[0][1].auth(done);
    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
    expect(done).toHaveBeenCalledWith({ token: "fresh-clerk-token", tenantSlug: "cedar" });
  });

  function setupStatus(active = false) {
    vi.useFakeTimers();
    const handlers = {};
    const socket = { active, connect: vi.fn(), on: vi.fn((name, fn) => { handlers[name] = fn; }), off: vi.fn() };
    const status = vi.fn();
    const detach = attachSocketStatus(socket, status);
    return { handlers, socket, status, detach };
  }

  it("retries a rejected handshake once and then accurately reports unavailable", () => {
    const { handlers, socket, status } = setupStatus();
    handlers.connect_error();
    vi.advanceTimersByTime(1000);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    handlers.connect_error();
    vi.advanceTimersByTime(5000);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("unavailable");
  });

  it("leaves transport reconnection to Socket.IO", () => {
    const { handlers, socket, status } = setupStatus(true);
    handlers.connect_error();
    vi.advanceTimersByTime(5000);
    expect(socket.connect).not.toHaveBeenCalled();
    expect(status).toHaveBeenLastCalledWith("reconnecting");
  });

  it("cancels pending retries when leaving the page", () => {
    const { handlers, socket, detach } = setupStatus();
    handlers.connect_error();
    detach();
    vi.advanceTimersByTime(5000);
    expect(socket.connect).not.toHaveBeenCalled();
    expect(socket.off).toHaveBeenCalledTimes(3);
  });
});
