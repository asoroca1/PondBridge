import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import useRouteScrollReset from "./useRouteScrollReset.js";

function Navigation() {
  useRouteScrollReset();
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate("/chat")}>Chat</button>
    <button onClick={() => navigate("/settings", { replace: true })}>Settings</button>
    <button onClick={() => navigate("/home?tab=updates")}>Filter</button>
    <button onClick={() => navigate("/help#contact")}>Anchor</button>
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate(1)}>Forward</button>
  </>;
}

function setup() {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(<MemoryRouter initialEntries={["/home"]}><Navigation /></MemoryRouter>);
  return scrollTo;
}

afterEach(() => vi.restoreAllMocks());

describe("route scroll position", () => {
  it("starts new pages at the top without animating from the previous page", () => {
    const scrollTo = setup();
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Chat"));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0, behavior: "instant" });
    fireEvent.click(screen.getByText("Settings"));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("leaves query changes and anchor destinations in place", () => {
    const scrollTo = setup();
    fireEvent.click(screen.getByText("Filter"));
    fireEvent.click(screen.getByText("Anchor"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not override backward or forward history restoration", () => {
    const scrollTo = setup();
    fireEvent.click(screen.getByText("Chat"));
    scrollTo.mockClear();
    fireEvent.click(screen.getByText("Back"));
    fireEvent.click(screen.getByText("Forward"));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
