import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The stored auth user carries both ids; the tree API keys members on the
// profile id, so these mount the page and inspect the request it actually sends.

vi.mock("../../context/TenantContext.jsx", () => ({
  useTenant: () => ({ slug: "cedar", tenant: { slug: "cedar", name: "Camp Cedar", content: {} } })
}));

vi.mock("../lib/helpers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getToken: () => "t"
}));

const requestFamilyTrees = vi.fn();
vi.mock("../lib/familyTreesApi", async (importOriginal) => ({
  ...(await importOriginal()),
  requestFamilyTrees: (...args) => requestFamilyTrees(...args)
}));

const ME = {
  _id: "user-1",
  id: "user-1",
  profileId: "profile-me",
  firstName: "Robin",
  lastName: "Raskin"
};

async function mountCreate() {
  const { default: FamilyTreeCreate } = await import("./FamilyTreeCreate.jsx");
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <FamilyTreeCreate />
    </MemoryRouter>
  );
}

async function fillAndSave() {
  fireEvent.change(screen.getByLabelText(/Family Tree Name/i), {
    target: { value: "The Raskins" }
  });
  // A second member and one edge are the minimum the page will submit.
  fireEvent.click(await screen.findByRole("button", { name: /Add Relationship/i }));
  fireEvent.click(screen.getByRole("button", { name: /Save Family Tree/i }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("user", JSON.stringify(ME));
  requestFamilyTrees.mockReset();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ items: [{ id: "profile-olivia", firstName: "Olivia", lastName: "Raskin" }] })
  });
});

afterEach(() => {
  vi.resetModules();
});

describe("Family Tree create", () => {
  it("sends the current user's profile id, not their user id", async () => {
    requestFamilyTrees.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "tree-1" })
    });
    await mountCreate();

    fireEvent.change(screen.getByLabelText(/Search Alumni Profiles/i), {
      target: { value: "Olivia" }
    });
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    await fillAndSave();

    await waitFor(() => expect(requestFamilyTrees).toHaveBeenCalled());
    const body = requestFamilyTrees.mock.calls.at(-1)[0].body;
    expect(body.memberProfileIds).toContain("profile-me");
    expect(body.memberProfileIds).not.toContain("user-1");
  });

  it("shows the API's message instead of [object Object] when the save fails", async () => {
    requestFamilyTrees.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: { code: "INVALID_MEMBERS", message: "One or more selected profiles do not belong to this tenant" }
      })
    });
    await mountCreate();

    fireEvent.change(screen.getByLabelText(/Search Alumni Profiles/i), {
      target: { value: "Olivia" }
    });
    fireEvent.click(await screen.findByRole("button", { name: "Add" }));
    await fillAndSave();

    expect(
      await screen.findByText("One or more selected profiles do not belong to this tenant")
    ).toBeInTheDocument();
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
  });
});
