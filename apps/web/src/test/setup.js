// Test environment for anything that renders.
//
// The web suite used to run entirely on `renderToStaticMarkup`, which produces
// a string and never runs an effect. That is a real blind spot: a component
// could reference an undefined variable inside `useEffect` and every test would
// still pass, because no test ever reached the line. One did — the member home
// page shipped a ReferenceError that 282 green tests missed and CI lint caught.
//
// With a DOM, `render()` mounts for real: effects run, state settles, and event
// handlers fire. Static rendering is still the right tool for checking first
// paint; this is the tool for everything after it.
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

// Each test mounts into a fresh document. Without this, a component left
// mounted by one test keeps responding to timers and events during the next.
afterEach(() => {
  cleanup();
});

// jsdom implements neither of these, and components that ask for them at mount
// would throw before rendering anything. Both are layout concerns with no
// meaning in a headless DOM, so a quiet stub is the honest answer rather than a
// simulation that would invite tests to assert against fictional geometry.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false
  });
}

for (const name of ["ResizeObserver", "IntersectionObserver"]) {
  if (!window[name]) {
    window[name] = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
}

if (!window.scrollTo) {
  window.scrollTo = () => {};
}
