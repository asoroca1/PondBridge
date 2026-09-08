import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LocationMap from "./LocationMap.jsx";

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({ getAuthToken: async () => "test-token" })
}));
vi.mock("../../context/TenantContext.jsx", () => ({
  useTenant: () => ({ tenant: { name: "Camp Cedar" } })
}));
vi.mock("../lib/api", () => ({ API_BASE: "/api/t/cedar" }));
vi.mock("../components/CedarBackground", () => ({ default: () => null }));
vi.mock("maplibre-gl", () => ({ setWorkerUrl: vi.fn() }));

const cities = [
  { key: "boston-ma", city: "Boston", state: "MA", lat: 42.36, lng: -71.06, count: 1 },
  { key: "chicago-il", city: "Chicago", state: "IL", lat: 41.88, lng: -87.63, count: 1 }
];
const response = (data) => ({ ok: true, json: async () => data });
const person = { id: "alex", firstName: "Alex", lastName: "Rivera" };

async function openMap(peopleRequest) {
  const fetchMock = vi.fn((url) => String(url).endsWith("/map/cities")
    ? Promise.resolve(response({ cities, totalAlumni: 2 }))
    : peopleRequest(url));
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter initialEntries={["/t/cedar/map"]}>
    <Routes><Route path="/t/:slug/map" element={<LocationMap />} /></Routes>
  </MemoryRouter>);
  const picker = await screen.findByRole("combobox", { name: "Explore a city" });
  return { picker, fetchMock };
}

beforeEach(() => {
  sessionStorage.clear();
  // The accessible city picker must work even on devices without WebGL.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LocationMap city profiles", () => {
  it("loads a selected city's profiles and preserves tenant-scoped profile links without WebGL", async () => {
    const { picker, fetchMock } = await openMap(async () => response({ people: [person] }));
    fireEvent.change(picker, { target: { value: "boston-ma" } });

    expect(await screen.findByText("Alex Rivera")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/t/cedar/map/city/boston-ma?city=Boston&state=MA", {
      headers: { Authorization: "Bearer test-token" }
    });
    expect(screen.getByRole("link", { name: "View Profile" }).getAttribute("href"))
      .toBe("/t/cedar/profile/alex");
    expect(screen.getByRole("link", { name: "Message" }).getAttribute("href"))
      .toBe("/t/cedar/chat-rooms?to=alex");
    expect(await screen.findByText("WebGL 2 is unavailable. You can still explore cities below.")).toBeTruthy();
    expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("webgl2");
  });

  it("distinguishes a failed profile request from an empty city and allows retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const request = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(response({ people: [person] }));
    const { picker } = await openMap(request);
    fireEvent.change(picker, { target: { value: "boston-ma" } });

    expect((await screen.findByRole("alert")).textContent).toContain("couldn’t load profiles");
    expect(screen.queryByText(/No visible .* profile cards/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Alex Rivera")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not cache an in-flight result after the selection is cleared", async () => {
    let resolveBoston;
    const boston = new Promise((resolve) => { resolveBoston = resolve; });
    const request = vi.fn().mockReturnValueOnce(boston)
      .mockResolvedValueOnce(response({ people: [{ id: "sam", firstName: "Sam", lastName: "Chen" }] }));
    const { picker } = await openMap(request);
    fireEvent.change(picker, { target: { value: "boston-ma" } });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(picker.value).toBe("");
    expect(screen.getByText("Select a city to explore")).toBeTruthy();

    await act(async () => { resolveBoston(response({ people: [person] })); });
    fireEvent.change(picker, { target: { value: "boston-ma" } });
    expect(await screen.findByText("Sam Chen")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Alex Rivera")).toBeNull();
    expect(screen.getByText("Sam Chen")).toBeTruthy();
    expect(picker.value).toBe("boston-ma");
  });
});
