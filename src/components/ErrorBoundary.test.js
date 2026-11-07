import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";

// ErrorBoundary.jsx is the net that keeps one broken screen (usually a bad
// network response) from blanking all of Sol: it swaps the crashed subtree
// for a labelled fallback with a retry, stays silent when `quiet`, and —
// for overlays — offers a Close that also releases the rest of the app.
// No DOM or testing-library is needed: the class can be instantiated
// directly, setState can be stubbed to apply updates, and render() returns
// plain React elements whose tree is asserted structurally.
import { ErrorBoundary } from "./ErrorBoundary.jsx";

const CHILD = React.createElement("span", null, "screen content");

function makeBoundary(props = {}) {
  const boundary = new ErrorBoundary({ children: CHILD, ...props });
  boundary.setState = vi.fn((update) => {
    const patch = typeof update === "function" ? update(boundary.state, boundary.props) : update;
    if (patch) boundary.state = { ...boundary.state, ...patch };
  });
  return boundary;
}

function crash(boundary, error = new Error("boom")) {
  boundary.state = { ...boundary.state, ...ErrorBoundary.getDerivedStateFromError(error) };
  return error;
}

function fallbackParts(boundary) {
  const tree = boundary.render();
  const [heading, body, actions] = tree.props.children;
  return { tree, heading, body, actions };
}

describe("ErrorBoundary state handling", () => {
  it("starts with no error", () => {
    expect(makeBoundary().state).toEqual({ error: null });
  });

  it("getDerivedStateFromError stores the exact error", () => {
    const error = new Error("fleet exploded");
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it("retry clears the error through setState", () => {
    const boundary = makeBoundary();
    crash(boundary);
    boundary.retry();
    expect(boundary.setState).toHaveBeenCalledWith({ error: null });
    expect(boundary.state.error).toBeNull();
  });
});

describe("ErrorBoundary rendering", () => {
  it("renders its children untouched while there is no error", () => {
    expect(makeBoundary().render()).toBe(CHILD);
  });

  it("renders children even when quiet, as long as there is no error", () => {
    expect(makeBoundary({ quiet: true }).render()).toBe(CHILD);
  });

  it("renders nothing when quiet and an error has been caught", () => {
    const boundary = makeBoundary({ quiet: true, label: "Agents" });
    crash(boundary);
    expect(boundary.render()).toBeNull();
  });

  it("renders an alert fallback naming the label when an error is caught", () => {
    const boundary = makeBoundary({ label: "Agents" });
    crash(boundary);
    const { tree, heading, body } = fallbackParts(boundary);
    expect(tree.type).toBe("div");
    expect(tree.props.role).toBe("alert");
    expect(tree.props.className).toBe("empty-state compact");
    expect(heading.type).toBe("h2");
    expect(heading.props.children).toBe("Agents hit a problem");
    expect(body.type).toBe("p");
    expect(body.props.children).toBe("The rest of Sol still works. You can try this again.");
  });

  it("falls back to a generic name when no label is given", () => {
    const boundary = makeBoundary();
    crash(boundary);
    expect(fallbackParts(boundary).heading.props.children).toBe("This part of Sol hit a problem");
  });

  it("adds the overlay class only for overlay boundaries", () => {
    const plain = makeBoundary();
    crash(plain);
    expect(fallbackParts(plain).tree.props.className).toBe("empty-state compact");
    const overlay = makeBoundary({ overlay: true });
    crash(overlay);
    expect(fallbackParts(overlay).tree.props.className).toBe("empty-state compact boundary-overlay");
  });
});

describe("ErrorBoundary fallback actions", () => {
  it("always offers Try again, wired to retry", () => {
    const boundary = makeBoundary();
    crash(boundary);
    const { actions } = fallbackParts(boundary);
    expect(actions.props.className).toBe("boundary-actions");
    const [retryButton] = actions.props.children;
    expect(retryButton.type).toBe("button");
    expect(retryButton.props.type).toBe("button");
    expect(retryButton.props.className).toBe("secondary-button");
    expect(retryButton.props.children).toBe("Try again");
    expect(retryButton.props.onClick).toBe(boundary.retry);
  });

  it("offers no Close button when no close handler is given", () => {
    const boundary = makeBoundary();
    crash(boundary);
    const [, closeSlot] = fallbackParts(boundary).actions.props.children;
    expect(closeSlot).toBeFalsy();
  });

  it("Close clears the error and calls the close handler", () => {
    const close = vi.fn();
    const boundary = makeBoundary({ close });
    crash(boundary);
    const [, closeButton] = fallbackParts(boundary).actions.props.children;
    expect(closeButton.type).toBe("button");
    expect(closeButton.props.children).toBe("Close");
    closeButton.props.onClick();
    expect(boundary.state.error).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("ErrorBoundary logging", () => {
  let errorSpy;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("logs the label, the error, and the component stack", () => {
    const boundary = makeBoundary({ label: "Agents" });
    const error = new Error("bad fleet response");
    boundary.componentDidCatch(error, { componentStack: "\n  at Agents" });
    expect(errorSpy).toHaveBeenCalledWith("[Sol] Agents failed:", error, "\n  at Agents");
  });

  it("logs a generic screen name when no label is given", () => {
    const boundary = makeBoundary();
    const error = new Error("boom");
    boundary.componentDidCatch(error, { componentStack: "stack" });
    expect(errorSpy).toHaveBeenCalledWith("[Sol] A screen failed:", error, "stack");
  });

  it("tolerates missing error info", () => {
    const boundary = makeBoundary({ label: "Chat" });
    const error = new Error("boom");
    boundary.componentDidCatch(error, undefined);
    expect(errorSpy).toHaveBeenCalledWith("[Sol] Chat failed:", error, undefined);
  });
});
