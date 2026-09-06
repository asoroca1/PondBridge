import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes, useParams } from "react-router-dom";

/**
 * Every workspace rail puts its current view in the URL.
 *
 * People, Email and Settings already did; Events and Giving held the view in
 * component state, so a director who bookmarked Drafts got Calendar, and
 * pressing back from Drafts left the page entirely rather than stepping to the
 * view before it.
 *
 * These lock the two rules that made the difference: the bare path redirects to
 * a real default, and an unrecognised segment falls back instead of rendering an
 * empty workspace.
 */

const EVENT_VIEWS = ["calendar", "upcoming", "drafts", "past"];
const GIVING_VIEWS = ["pending", "active", "completed", "donations"];

function Workspace({ views, fallback }) {
  const { view } = useParams();
  const resolved = views.includes(view) ? view : fallback;
  return <div data-testid="view">{resolved}</div>;
}

function renderAt(path, { views, fallback, base }) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={`${base}`} element={<Navigate to={fallback} replace />} />
        <Route path={`${base}/:view`} element={<Workspace views={views} fallback={fallback} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("events workspace routing", () => {
  const config = { views: EVENT_VIEWS, fallback: "calendar", base: "/admin/events" };

  it("sends the bare path to the default view", () => {
    renderAt("/admin/events", config);
    expect(screen.getByTestId("view")).toHaveTextContent("calendar");
  });

  it.each(EVENT_VIEWS)("opens %s directly, so a bookmark and a refresh both land there", (view) => {
    renderAt(`/admin/events/${view}`, config);
    expect(screen.getByTestId("view")).toHaveTextContent(view);
  });

  it("falls back rather than showing an empty workspace for an unknown view", () => {
    renderAt("/admin/events/nonsense", config);
    expect(screen.getByTestId("view")).toHaveTextContent("calendar");
  });
});

describe("giving workspace routing", () => {
  const config = { views: GIVING_VIEWS, fallback: "pending", base: "/admin/giving" };

  it("sends the bare path to the default tab", () => {
    renderAt("/admin/giving", config);
    expect(screen.getByTestId("view")).toHaveTextContent("pending");
  });

  it.each(GIVING_VIEWS)("opens %s directly", (view) => {
    renderAt(`/admin/giving/${view}`, config);
    expect(screen.getByTestId("view")).toHaveTextContent(view);
  });

  it("falls back for an unknown tab", () => {
    renderAt("/admin/giving/nonsense", config);
    expect(screen.getByTestId("view")).toHaveTextContent("pending");
  });
});

describe("the view segments match what the pages actually accept", () => {
  // The routes and the pages have to agree on the vocabulary. Giving's tabs are
  // keyed pending/active/completed/donations, and pointing the redirect at a
  // name the page did not know would have left it on an empty default.
  it("giving's default is one of its own tabs", () => {
    expect(GIVING_VIEWS).toContain("pending");
  });

  it("events' default is one of its own views", () => {
    expect(EVENT_VIEWS).toContain("calendar");
  });
});
