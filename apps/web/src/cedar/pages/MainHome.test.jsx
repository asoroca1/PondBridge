import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// The member home page is the first authenticated screen anyone sees, and it is
// almost entirely effects: the profile, the bootstrap payload, the activity
// feed and the completion prompt all arrive after mount. Rendering it to a
// string proves nothing about any of that -- it once shipped a ReferenceError
// that a full green suite missed, because no test had ever run the effect that
// referenced the missing variable. These tests mount it for real.

vi.mock("../../context/TenantContext.jsx", () => ({
  useTenant: () => ({
    slug: "cedar",
    tenant: { slug: "cedar", name: "Camp Cedar", content: {} }
  })
}));

vi.mock("../../context/AuthContext.jsx", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "member@example.test" },
    token: "t",
    getAuthToken: async () => "t",
    isReady: true
  })
}));

vi.mock("../lib/unreadChats.js", () => ({ useUnreadChatsCount: () => 0 }));
vi.mock("../../hooks/useMemberNav.js", () => ({ useSideNavActive: () => false }));

// A half-filled profile: enough fields to be a real person, few enough that the
// completion prompt has reason to open.
const PARTIAL_PROFILE = {
  id: "u1",
  userId: "u1",
  firstName: "Robin",
  lastName: "Alvarez",
  email: "member@example.test"
};

const getMe = vi.fn(async () => PARTIAL_PROFILE);

vi.mock("../lib/api", () => ({
  API_BASE: "https://api.test",
  getMe: (...args) => getMe(...args)
}));

vi.mock("../lib/helpers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getToken: () => "t",
  authHeaders: () => ({ Authorization: "Bearer t" })
}));

const BOOTSTRAP_WITH_STATS = {
  stats: { totalAlumni: 2874, totalLocations: 312 },
  activity: [],
  locations: { count: 312 }
};

// The bootstrap response is held open so a test can decide when the page gets
// its content. Asserting that something is absent is only meaningful if you can
// say what it is waiting for; this makes that wait explicit instead of racing a
// timer.
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function mockFetch(bootstrapPromise) {
  return vi.fn(async (url) => {
    const href = String(url);
    if (href.includes("/home/bootstrap")) {
      return { ok: true, json: async () => bootstrapPromise };
    }
    // Every other panel on the page fetches for itself; an empty result keeps
    // them quiet without pretending they returned something meaningful.
    return { ok: true, json: async () => ({}) };
  });
}

async function mountHome({ bootstrap = BOOTSTRAP_WITH_STATS } = {}) {
  global.fetch = mockFetch(bootstrap);
  const { default: MainHome } = await import("./MainHome.jsx");
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <MainHome />
    </MemoryRouter>
  );
}

const realFetch = global.fetch;

beforeEach(() => {
  localStorage.clear();
  getMe.mockClear();
});

afterEach(() => {
  // `mountHome` assigns over the global rather than spying on it, so put the
  // real one back instead of leaving it for whichever file runs next.
  global.fetch = realFetch;
  vi.resetModules();
});

describe("member home page", () => {
  it("mounts and settles without throwing", async () => {
    await mountHome();
    // Waiting on the profile request is what forces every mount effect to have
    // run; if one of them throws, React surfaces it here rather than silently.
    await waitFor(() => expect(getMe).toHaveBeenCalled());
  });

  it("shows the real member total once the bootstrap payload lands", async () => {
    await mountHome();
    await waitFor(() => expect(screen.getByText("2.9k")).toBeInTheDocument());
  });

  it("opens the completion prompt only after the page behind it has content", async () => {
    await mountHome();
    await waitFor(() =>
      expect(screen.getByText("Complete Your Profile")).toBeInTheDocument()
    );
  });

  it("keeps the completion prompt closed until the page behind it has content", async () => {
    // Hold the bootstrap response open, so the only thing the page is missing
    // is its content. The profile has already arrived by the time we assert:
    // without the gate, the prompt would be open over a screen of skeletons.
    const bootstrap = deferred();
    await mountHome({ bootstrap: bootstrap.promise });

    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/Community Pulse/i)).toBeInTheDocument()
    );
    expect(screen.queryByText("Complete Your Profile")).not.toBeInTheDocument();

    // Release the content and the prompt is allowed through.
    bootstrap.resolve(BOOTSTRAP_WITH_STATS);
    await waitFor(() =>
      expect(screen.getByText("Complete Your Profile")).toBeInTheDocument()
    );
  });
});
