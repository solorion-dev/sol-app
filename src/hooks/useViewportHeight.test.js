import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// useViewportHeight.js keeps the app layout glued to the visual viewport
// on mobile: it mirrors viewport height/offset into CSS variables, flags
// an open software keyboard on <body>, closes a drawer overlay when the
// keyboard appears (a drawer + keyboard crowd a phone screen), and asks
// the caller to reset rubber-band scroll state on every sync. Those are
// decisions worth pinning, not just DOM plumbing. Mock `react` to capture
// the effect, then drive it with a stubbed visualViewport + rAF queue —
// no DOM environment or testing-library dependency needed.
const mocks = vi.hoisted(() => ({
  useEffect: vi.fn(),
}));

vi.mock("react", () => ({
  useEffect: mocks.useEffect,
}));

import { useViewportHeight } from "./useViewportHeight.js";

let viewport;
let listeners;
let setProperty;
let classToggle;
let closeOverlay;
let resetRubber;
let pendingFrames;
let nextFrameId;
let raf;
let cancelRaf;

function flushFrames() {
  const callbacks = [...pendingFrames.values()];
  pendingFrames.clear();
  for (const cb of callbacks) cb();
}

function setupViewport({ height = 800, offsetTop = 0, innerHeight = 900 } = {}) {
  listeners = new Map();
  viewport = {
    height,
    offsetTop,
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
    removeEventListener: vi.fn((type, handler) => {
      if (listeners.get(type) === handler) listeners.delete(type);
    }),
  };
  setProperty = vi.fn();
  classToggle = vi.fn();
  vi.stubGlobal("window", { visualViewport: viewport, innerHeight });
  vi.stubGlobal("document", {
    documentElement: { style: { setProperty } },
    body: { classList: { toggle: classToggle } },
  });
}

function runHook(props = {}) {
  const fullProps = {
    overlay: null,
    closeOverlay,
    resetRubber,
    ...props,
  };
  useViewportHeight(fullProps);
  expect(mocks.useEffect).toHaveBeenCalledTimes(1);
  const [effect, deps] = mocks.useEffect.mock.calls[0];
  const cleanup = effect();
  return { cleanup, deps, props: fullProps };
}

beforeEach(() => {
  vi.clearAllMocks();
  closeOverlay = vi.fn();
  resetRubber = vi.fn();
  pendingFrames = new Map();
  nextFrameId = 0;
  raf = vi.fn((cb) => {
    const id = ++nextFrameId;
    pendingFrames.set(id, cb);
    return id;
  });
  cancelRaf = vi.fn((id) => {
    pendingFrames.delete(id);
  });
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", cancelRaf);
  setupViewport();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("effect registration", () => {
  it("re-runs when overlay, closeOverlay or resetRubber change", () => {
    const { deps, props } = runHook({ overlay: { type: "drawer" } });
    expect(deps).toEqual([props.overlay, props.closeOverlay, props.resetRubber]);
  });
});

describe("without visualViewport", () => {
  it("does nothing and returns no cleanup", () => {
    vi.stubGlobal("window", { visualViewport: undefined, innerHeight: 900 });
    const { cleanup } = runHook();
    expect(cleanup).toBeUndefined();
    expect(raf).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
    expect(resetRubber).not.toHaveBeenCalled();
  });
});

describe("viewport sync", () => {
  it("sets --vv-height and --vv-top from the viewport on the first frame", () => {
    setupViewport({ height: 812, offsetTop: 24 });
    runHook();
    expect(setProperty).not.toHaveBeenCalled();
    flushFrames();
    expect(setProperty).toHaveBeenCalledWith("--vv-height", "812px");
    expect(setProperty).toHaveBeenCalledWith("--vv-top", "24px");
  });

  it("calls resetRubber on every flushed sync", () => {
    runHook();
    flushFrames();
    expect(resetRubber).toHaveBeenCalledTimes(1);
    listeners.get("resize")();
    flushFrames();
    expect(resetRubber).toHaveBeenCalledTimes(2);
  });

  it("registers the same sync handler for resize and scroll", () => {
    runHook();
    expect(viewport.addEventListener).toHaveBeenCalledTimes(2);
    expect(listeners.has("resize")).toBe(true);
    expect(listeners.has("scroll")).toBe(true);
    expect(listeners.get("resize")).toBe(listeners.get("scroll"));
  });

  it("re-syncs with fresh viewport values when a listener fires", () => {
    runHook();
    flushFrames();
    viewport.height = 500;
    viewport.offsetTop = 10;
    listeners.get("scroll")();
    flushFrames();
    expect(setProperty).toHaveBeenLastCalledWith("--vv-top", "10px");
    expect(setProperty).toHaveBeenCalledWith("--vv-height", "500px");
  });

  it("coalesces bursts: a new sync cancels the still-pending frame", () => {
    runHook();
    const firstFrameId = nextFrameId;
    listeners.get("resize")();
    expect(cancelRaf).toHaveBeenCalledWith(firstFrameId);
    flushFrames();
    // Only the latest scheduled frame ran.
    expect(setProperty).toHaveBeenCalledTimes(2);
    expect(resetRubber).toHaveBeenCalledTimes(1);
  });
});

describe("keyboard detection", () => {
  it("flags keyboard-open when innerHeight exceeds viewport height by more than 120px", () => {
    setupViewport({ height: 700, innerHeight: 900 });
    runHook();
    flushFrames();
    expect(classToggle).toHaveBeenCalledWith("keyboard-open", true);
  });

  it("does not flag the keyboard at exactly 120px of shrinkage (threshold is strict)", () => {
    setupViewport({ height: 780, innerHeight: 900 });
    runHook();
    flushFrames();
    expect(classToggle).toHaveBeenCalledWith("keyboard-open", false);
  });

  it("flags the keyboard at 121px of shrinkage", () => {
    setupViewport({ height: 779, innerHeight: 900 });
    runHook();
    flushFrames();
    expect(classToggle).toHaveBeenCalledWith("keyboard-open", true);
  });

  it("clears keyboard-open again when the viewport grows back", () => {
    setupViewport({ height: 700, innerHeight: 900 });
    runHook();
    flushFrames();
    viewport.height = 890;
    listeners.get("resize")();
    flushFrames();
    expect(classToggle).toHaveBeenLastCalledWith("keyboard-open", false);
  });
});

describe("drawer auto-close", () => {
  it("closes a drawer overlay (without animation flag) when the keyboard opens", () => {
    setupViewport({ height: 700, innerHeight: 900 });
    runHook({ overlay: { type: "drawer" } });
    flushFrames();
    expect(closeOverlay).toHaveBeenCalledTimes(1);
    expect(closeOverlay).toHaveBeenCalledWith(false);
  });

  it("does not close non-drawer overlays when the keyboard opens", () => {
    setupViewport({ height: 700, innerHeight: 900 });
    runHook({ overlay: { type: "modal" } });
    flushFrames();
    expect(closeOverlay).not.toHaveBeenCalled();
  });

  it("does not close anything when there is no overlay", () => {
    setupViewport({ height: 700, innerHeight: 900 });
    runHook({ overlay: null });
    flushFrames();
    expect(closeOverlay).not.toHaveBeenCalled();
  });

  it("does not close a drawer while the keyboard stays closed", () => {
    setupViewport({ height: 850, innerHeight: 900 });
    runHook({ overlay: { type: "drawer" } });
    flushFrames();
    expect(closeOverlay).not.toHaveBeenCalled();
  });
});

describe("cleanup", () => {
  it("removes both listeners with the registered handler and cancels the pending frame", () => {
    const { cleanup } = runHook();
    const handler = listeners.get("resize");
    const pendingId = nextFrameId;
    cleanup();
    expect(viewport.removeEventListener).toHaveBeenCalledWith("resize", handler);
    expect(viewport.removeEventListener).toHaveBeenCalledWith("scroll", handler);
    expect(listeners.size).toBe(0);
    expect(cancelRaf).toHaveBeenCalledWith(pendingId);
    // The cancelled frame never runs its sync.
    flushFrames();
    expect(setProperty).not.toHaveBeenCalled();
  });
});
