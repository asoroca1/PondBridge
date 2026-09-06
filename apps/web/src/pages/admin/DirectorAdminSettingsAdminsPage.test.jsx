import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Camp Cedar has 57 admins. The list rendered all of them in one unbroken
 * column with no way to find anyone, which is roughly four screens of names.
 *
 * The controls are deliberately lighter than the People page's: most camps have
 * a handful of admins, and paging chrome around six rows costs more than it
 * gives. So the list caps, and the filter only appears once the list is long
 * enough that reading it stops working.
 */

const request = vi.fn();
vi.mock("./useAdminApi.js", () => ({ default: () => ({ request }) }));

function admins(count) {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `a${index + 1}`,
    name: index === 0 ? "Blake Chen" : `Admin ${index + 1}`,
    email: `admin${index + 1}@cedar.example.test`,
    role: index === 0 ? "Director" : "Admin",
    addedAt: "2026-01-01T00:00:00.000Z"
  }));
}

async function mountWith(count) {
  request.mockResolvedValue({ admins: admins(count), pendingInvites: [] });
  const { default: Page } = await import("./DirectorAdminSettingsAdminsPage.jsx");
  render(<Page />);
  await waitFor(() => expect(screen.getByText("Blake Chen")).toBeInTheDocument());
}

const rowNames = () =>
  screen.getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent);

beforeEach(() => {
  request.mockReset();
});

afterEach(() => {
  cleanup();
  vi.resetModules();
});

describe("the admin list", () => {
  it("shows a short list whole, with no controls around it", async () => {
    await mountWith(6);
    expect(rowNames()).toHaveLength(6);
    expect(screen.queryByPlaceholderText(/Search this list/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("caps a long list and says how many are behind the cap", async () => {
    await mountWith(57);
    expect(rowNames()).toHaveLength(8);
    expect(screen.getByRole("button", { name: "Show all 57 admins" })).toBeInTheDocument();
  });

  it("shows the rest when asked", async () => {
    const user = userEvent.setup();
    await mountWith(57);
    await user.click(screen.getByRole("button", { name: "Show all 57 admins" }));
    expect(rowNames()).toHaveLength(57);
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("offers a filter once the list is too long to read", async () => {
    await mountWith(57);
    expect(screen.getByPlaceholderText(/Search this list/)).toBeInTheDocument();
  });

  it("matches on name", async () => {
    const user = userEvent.setup();
    await mountWith(57);
    await user.type(screen.getByPlaceholderText(/Search this list/), "Blake");
    await waitFor(() => expect(rowNames()).toEqual(["Blake Chen"]));
  });

  it("matches on email too, since that is often all a director remembers", async () => {
    const user = userEvent.setup();
    await mountWith(57);
    // Blake Chen's address is admin1@…, so an email match has to surface a row
    // whose visible name contains nothing like the search term.
    await user.type(screen.getByPlaceholderText(/Search this list/), "admin1@");
    await waitFor(() => expect(rowNames()).toEqual(["Blake Chen"]));
  });

  it("shows every match rather than capping the filtered list", async () => {
    const user = userEvent.setup();
    await mountWith(57);
    // "admin1" prefixes admin1 and admin10-19: more matches than the cap of 8.
    await user.type(screen.getByPlaceholderText(/Search this list/), "admin1");
    await waitFor(() => expect(rowNames().length).toBeGreaterThan(8));
    // A filtered list is already an answer; capping it again would hide matches.
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("says what was searched for when nothing matches", async () => {
    const user = userEvent.setup();
    await mountWith(57);
    await user.type(screen.getByPlaceholderText(/Search this list/), "nobodyhere");
    await waitFor(() =>
      expect(screen.getByText(/Nobody in this list matches “nobodyhere”/)).toBeInTheDocument()
    );
  });
});
