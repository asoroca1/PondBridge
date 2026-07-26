let runtimePromise = null;

export function loadFullAuthRuntime() {
  if (!runtimePromise) {
    runtimePromise = import("../context/FullAuthRuntime.jsx");
  }
  return runtimePromise;
}

export function preloadFullAuthRuntime() {
  loadFullAuthRuntime().catch(() => {
    runtimePromise = null;
  });
}
