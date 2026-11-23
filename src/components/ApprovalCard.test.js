import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ApprovalCard.jsx is the Warden's approval surface: useApprovals polls
// the gateway for held actions, ApprovalCard renders one request with
// Allow / Deny / Always answers and a countdown, and ApprovalStack
// stacks the cards and announces new arrivals. Those decisions are
// worth pinning without a gateway or a phone. Mock `react` with
// per-slot state (the suite style of UpdaterCard.test.js), stub
// ../fleet and ./Icon, keep the real prototypeData (ASSISTANT.name is
// "Qubit"), then drive the components by calling them, running the
// captured effects, and invoking button onClick props found in the
// returned element tree — no DOM or testing-library needed.
const mocks = vi.hoisted(() => {
  const holder = {
    states: [],
    setters: [],
    refs: [],
    cursor: 0,
    refCursor: 0,
    effect: null,
    effectDeps: undefined,
  };
  holder.useState = vi.fn((initial) => {
    const index = holder.cursor++;
    if (!(index in holder.states)) holder.states[index] = initial;
    if (!holder.setters[index]) {
      holder.setters[index] = vi.fn((update) => {
        holder.states[index] =
          typeof update === "function" ? update(holder.states[index]) : update;
      });
    }
    return [holder.states[index], holder.setters[index]];
  });
  holder.useRef = vi.fn((initial) => {
    const index = holder.refCursor++;
    if (!(index in holder.refs)) holder.refs[index] = { current: initial };
    return holder.refs[index];
  });
  holder.useEffect = vi.fn((fn, deps) => {
    holder.effect = fn;
    holder.effectDeps = deps;
  });
  holder.useCallback = vi.fn((fn) => fn);
  return holder;
});

const fleetMocks = vi.hoisted(() => ({
  fleet: {
    approvals: vi.fn(),
    decideApproval: vi.fn(),
  },
  fleetEnabled: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useState: mocks.useState,
    useRef: mocks.useRef,
    useEffect: mocks.useEffect,
    useCallback: mocks.useCallback,
  };
});

vi.mock("../fleet", () => fleetMocks);

vi.mock("./Icon", () => ({
  Icon: () => null,
}));

import { useApprovals, ApprovalCard, ApprovalStack } from "./ApprovalCard.jsx";

const realSetTimeout = globalThis.setTimeout;

// ApprovalCard state slots, in declaration order.
const BUSY = 0;
const ERR = 1;
const NOW = 2;

// A fixed "now": 1_000_000 ms = 1000 s since the epoch.
const NOW_MS = 1_000_000;
const NOW_S = NOW_MS / 1000;

function flushPromises() {
  return new Promise((resolve) => realSetTimeout(resolve, 0));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resetHolder() {
  mocks.states = [];
  mocks.setters = [];
  mocks.refs = [];
  mocks.cursor = 0;
  mocks.refCursor = 0;
  mocks.effect = null;
  mocks.effectDeps = undefined;
  mocks.useState.mockClear();
  mocks.useRef.mockClear();
  mocks.useEffect.mockClear();
  mocks.useCallback.mockClear();
}

function rewind() {
  mocks.cursor = 0;
  mocks.refCursor = 0;
}

function makeApproval(overrides = {}) {
  return {
    id: "a1",
    title: "open the garage",
    rule_key: "ha:garage",
    details: null,
    expires: NOW_S + 300,
    always_scope: null,
    ...overrides,
  };
}

function renderCard(approval = makeApproval(), { decide = vi.fn(async () => {}), canDecide = true } = {}) {
  rewind();
  return ApprovalCard({ approval, decide, canDecide });
}

function childrenOf(tree) {
  return tree.props.children;
}

function headOf(tree) {
  return childrenOf(tree)[0];
}

function iconNameOf(tree) {
  const span = headOf(tree).props.children[0];
  const icon = span.props.children;
  return icon.props.name;
}

function headingOf(tree) {
  return headOf(tree).props.children[1];
}

function noteOf(tree) {
  return childrenOf(tree)[1].props.children;
}

// The actions div (canDecide) holds Allow/Deny buttons; the foot div
// holds the optional Always button and the time span.
function actionButtonsOf(tree) {
  const actions = childrenOf(tree)[3];
  if (!actions || actions.type !== "div") return [];
  return actions.props.children;
}

function footOf(tree) {
  return childrenOf(tree)[4];
}

function footChildrenOf(tree) {
  return footOf(tree).props.children;
}

function alwaysButtonOf(tree) {
  return footChildrenOf(tree).find((el) => el && el.type === "button");
}

function timeTextOf(tree) {
  const span = footChildrenOf(tree).find((el) => el && el.type === "span");
  return span.props.children;
}

function errorOf(tree) {
  const err = childrenOf(tree)[5];
  return err || null;
}

function buttonByClass(tree, className) {
  return [...actionButtonsOf(tree), ...footChildrenOf(tree)].find(
    (el) => el && el.type === "button" && el.props.className === className,
  );
}

beforeEach(() => {
  resetHolder();
  fleetMocks.fleet.approvals.mockReset();
  fleetMocks.fleet.decideApproval.mockReset();
  fleetMocks.fleetEnabled.mockReset();
  fleetMocks.fleetEnabled.mockReturnValue(true);
  fleetMocks.fleet.approvals.mockResolvedValue({ approvals: [], can_decide: false, warden_problem: null });
  fleetMocks.fleet.decideApproval.mockResolvedValue({});
  vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("window", { matchMedia: vi.fn(() => ({ matches: false })) });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ApprovalCard iconFor mapping (via the Icon name prop)", () => {
  const cases = [
    ["warden:ha:lights", "house"],
    ["ha:lights", "house"],
    ["warden:browser_vault", "key"],
    ["browser_vault_passwords", "key"],
    ["warden:cron:nightly", "clock"],
    ["cron:backup", "clock"],
    ["warden:exposure", "globe"],
    ["exposure", "globe"],
    ["purchase", "cart"],
    ["connections:tailscale", "plug"],
    ["discord_post", "chat"],
    ["yb_message", "chat"],
    ["something_else", "shield"],
    ["warden:unknown_rule", "shield"],
    [undefined, "shield"],
    [null, "shield"],
    ["", "shield"],
  ];
  for (const [ruleKey, expected] of cases) {
    it(`maps rule_key ${String(ruleKey)} to the ${expected} icon`, () => {
      const tree = renderCard(makeApproval({ rule_key: ruleKey }));
      expect(iconNameOf(tree)).toBe(expected);
    });
  }

  it("renders the icon at size 22 inside an aria-hidden span", () => {
    const tree = renderCard();
    const span = headOf(tree).props.children[0];
    expect(span.props.className).toBe("approval-icon");
    expect(span.props["aria-hidden"]).toBe("true");
    expect(span.props.children.props.size).toBe(22);
  });
});

describe("ApprovalCard rendering", () => {
  it("renders a section labelled by its heading, with the Qubit heading text", () => {
    const tree = renderCard(makeApproval({ id: "req-9", title: "post as you" }));
    expect(tree.type).toBe("section");
    expect(tree.props.className).toBe("approval-card");
    expect(tree.props.role).toBe("group");
    expect(tree.props["aria-labelledby"]).toBe("approval-title-req-9");
    const heading = headingOf(tree);
    expect(heading.type).toBe("h3");
    expect(heading.props.id).toBe("approval-title-req-9");
    expect(heading.props.children).toBe("Allow Qubit to post as you?");
  });

  it("shows the waiting note naming Qubit", () => {
    expect(noteOf(renderCard())).toBe(
      "Qubit is waiting for you and won't do this unless you allow it.",
    );
  });

  it("includes the details <pre> only when approval.details is truthy", () => {
    const withDetails = renderCard(makeApproval({ details: "Rule: ha:garage" }));
    const pre = childrenOf(withDetails)[2];
    expect(pre.type).toBe("pre");
    expect(pre.props.className).toBe("approval-details");
    expect(pre.props.tabIndex).toBe(0);
    expect(pre.props.children).toBe("Rule: ha:garage");

    resetHolder();
    const without = renderCard(makeApproval({ details: null }));
    expect(childrenOf(without)[2]).toBeFalsy();
    resetHolder();
    const empty = renderCard(makeApproval({ details: "" }));
    expect(childrenOf(empty)[2]).toBeFalsy();
  });

  it("with canDecide=false shows the admin note and no Allow/Deny buttons", () => {
    const tree = renderCard(makeApproval(), { canDecide: false });
    const slot = childrenOf(tree)[3];
    expect(slot.type).toBe("p");
    expect(slot.props.className).toBe("approval-note");
    expect(slot.props.children).toBe("Only a hub admin can answer this.");
    expect(buttonByClass(tree, "approval-allow")).toBeUndefined();
    expect(buttonByClass(tree, "approval-deny")).toBeUndefined();
  });

  it("with canDecide=true shows enabled Allow and Deny buttons when not busy or expired", () => {
    const tree = renderCard();
    const allow = buttonByClass(tree, "approval-allow");
    const deny = buttonByClass(tree, "approval-deny");
    expect(allow.props.children).toBe("Allow");
    expect(deny.props.children).toBe("Deny");
    expect(allow.props.disabled).toBe(false);
    expect(deny.props.disabled).toBe(false);
    expect(allow.props.type).toBe("button");
    expect(deny.props.type).toBe("button");
  });
});

describe("ApprovalCard answer flow", () => {
  it("clicking Allow calls decide(id, 'once') and shows the busy label while pending", async () => {
    const pending = deferred();
    const decide = vi.fn(() => pending.promise);
    const tree = renderCard(makeApproval({ id: "a7" }), { decide });
    const click = buttonByClass(tree, "approval-allow").props.onClick();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledWith("a7", "once");
    expect(mocks.states[BUSY]).toBe("once");
    const busyTree = renderCard(makeApproval({ id: "a7" }), { decide });
    expect(buttonByClass(busyTree, "approval-allow").props.children).toBe("Allowing…");
    expect(buttonByClass(busyTree, "approval-allow").props.disabled).toBe(true);
    expect(buttonByClass(busyTree, "approval-deny").props.disabled).toBe(true);
    pending.resolve();
    await click;
  });

  it("clicking Deny calls decide(id, 'deny') and shows 'Denying…' while pending", async () => {
    const pending = deferred();
    const decide = vi.fn(() => pending.promise);
    const tree = renderCard(makeApproval(), { decide });
    const click = buttonByClass(tree, "approval-deny").props.onClick();
    expect(decide).toHaveBeenCalledWith("a1", "deny");
    expect(mocks.states[BUSY]).toBe("deny");
    const busyTree = renderCard(makeApproval(), { decide });
    expect(buttonByClass(busyTree, "approval-deny").props.children).toBe("Denying…");
    expect(buttonByClass(busyTree, "approval-allow").props.disabled).toBe(true);
    expect(buttonByClass(busyTree, "approval-deny").props.disabled).toBe(true);
    pending.resolve();
    await click;
  });

  it("a successful answer leaves no error element", async () => {
    const decide = vi.fn(async () => {});
    const tree = renderCard(makeApproval(), { decide });
    await buttonByClass(tree, "approval-allow").props.onClick();
    expect(errorOf(renderCard(makeApproval(), { decide }))).toBeNull();
  });

  it("a 404 rejection reports 'This request already ended.' as role=alert and clears busy", async () => {
    const err404 = new Error("gone");
    err404.status = 404;
    const decide = vi.fn(async () => {
      throw err404;
    });
    const tree = renderCard(makeApproval(), { decide });
    await buttonByClass(tree, "approval-allow").props.onClick();
    expect(mocks.states[ERR]).toBe("This request already ended.");
    expect(mocks.states[BUSY]).toBe("");
    const after = renderCard(makeApproval(), { decide });
    const errEl = errorOf(after);
    expect(errEl.type).toBe("p");
    expect(errEl.props.role).toBe("alert");
    expect(errEl.props.className).toBe("approval-error");
    expect(errEl.props.children).toBe("This request already ended.");
    // Busy cleared: the buttons are enabled again.
    expect(buttonByClass(after, "approval-allow").props.disabled).toBe(false);
  });

  it("a non-404 rejection reports the generic failure and clears busy", async () => {
    const err500 = new Error("boom");
    err500.status = 500;
    const decide = vi.fn(async () => {
      throw err500;
    });
    const tree = renderCard(makeApproval(), { decide });
    await buttonByClass(tree, "approval-deny").props.onClick();
    expect(mocks.states[ERR]).toBe("That didn't go through. Try again.");
    expect(mocks.states[BUSY]).toBe("");
    const after = renderCard(makeApproval(), { decide });
    expect(errorOf(after).props.children).toBe("That didn't go through. Try again.");
    expect(errorOf(after).props.role).toBe("alert");
  });

  it("a rejection without a status also reports the generic failure", async () => {
    const decide = vi.fn(async () => {
      throw new Error("offline");
    });
    const tree = renderCard(makeApproval(), { decide });
    await buttonByClass(tree, "approval-allow").props.onClick();
    expect(mocks.states[ERR]).toBe("That didn't go through. Try again.");
  });

  it("starting a new answer clears a previous error", async () => {
    const decide = vi.fn(async () => {
      throw new Error("offline");
    });
    const tree = renderCard(makeApproval(), { decide });
    await buttonByClass(tree, "approval-allow").props.onClick();
    expect(mocks.states[ERR]).not.toBe("");
    const pending = deferred();
    decide.mockImplementation(() => pending.promise);
    const retry = renderCard(makeApproval(), { decide });
    const click = buttonByClass(retry, "approval-allow").props.onClick();
    expect(mocks.states[ERR]).toBe("");
    pending.resolve();
    await click;
  });
});

describe("ApprovalCard expiry and countdown", () => {
  it("disables both buttons and shows 'Timed out: not done' when expires is in the past", () => {
    const tree = renderCard(makeApproval({ expires: NOW_S - 5 }));
    expect(buttonByClass(tree, "approval-allow").props.disabled).toBe(true);
    expect(buttonByClass(tree, "approval-deny").props.disabled).toBe(true);
    expect(timeTextOf(tree)).toBe("Timed out: not done");
  });

  it("treats expires exactly at now as expired", () => {
    const tree = renderCard(makeApproval({ expires: NOW_S }));
    expect(timeTextOf(tree)).toBe("Timed out: not done");
    expect(buttonByClass(tree, "approval-allow").props.disabled).toBe(true);
  });

  it("shows 'Answer within M:SS' with zero-padded seconds", () => {
    expect(timeTextOf(renderCard(makeApproval({ expires: NOW_S + 65 })))).toBe("Answer within 1:05");
    resetHolder();
    expect(timeTextOf(renderCard(makeApproval({ expires: NOW_S + 9 })))).toBe("Answer within 0:09");
    resetHolder();
    expect(timeTextOf(renderCard(makeApproval({ expires: NOW_S + 600 })))).toBe("Answer within 10:00");
    resetHolder();
    expect(timeTextOf(renderCard(makeApproval({ expires: NOW_S + 60 })))).toBe("Answer within 1:00");
  });

  it("shows 0:00 for a sub-second remainder (the negative clamp's reachable edge)", () => {
    // timeLeft clamps with Math.max(0, ...); a genuinely negative
    // remainder flips the card to the expired branch instead, so the
    // closest reachable display is a <0.5s remainder rounding to 0:00
    // while the card is not yet expired.
    const tree = renderCard(makeApproval({ expires: NOW_S + 0.4 }));
    expect(timeTextOf(tree)).toBe("Answer within 0:00");
    expect(buttonByClass(tree, "approval-allow").props.disabled).toBe(false);
  });

  it("registers a 1s interval that refreshes now, and cleanup clears it", () => {
    const setIntervalMock = vi.fn(() => 4242);
    const clearIntervalMock = vi.fn();
    vi.stubGlobal("setInterval", setIntervalMock);
    vi.stubGlobal("clearInterval", clearIntervalMock);
    renderCard();
    expect(mocks.effectDeps).toEqual([]);
    const cleanup = mocks.effect();
    expect(setIntervalMock).toHaveBeenCalledTimes(1);
    expect(setIntervalMock.mock.calls[0][1]).toBe(1000);
    // The interval callback re-reads Date.now into the now slot.
    Date.now.mockReturnValue(NOW_MS + 5000);
    setIntervalMock.mock.calls[0][0]();
    expect(mocks.states[NOW]).toBe(NOW_MS + 5000);
    cleanup();
    expect(clearIntervalMock).toHaveBeenCalledTimes(1);
    expect(clearIntervalMock).toHaveBeenCalledWith(4242);
  });
});

describe("ApprovalCard always_scope", () => {
  it("shows 'Always allow <scope>' when canDecide and always_scope are set, clicking sends 'always'", async () => {
    const decide = vi.fn(async () => {});
    const tree = renderCard(makeApproval({ always_scope: "turning on the porch light" }), { decide });
    const always = alwaysButtonOf(tree);
    expect(always).toBeDefined();
    expect(always.props.className).toBe("approval-always");
    expect(always.props.children).toBe("Always allow turning on the porch light");
    expect(always.props.disabled).toBe(false);
    await always.props.onClick();
    expect(decide).toHaveBeenCalledWith("a1", "always");
    expect(mocks.states[BUSY]).toBe("always");
  });

  it("omits the Always button when always_scope is absent", () => {
    const tree = renderCard(makeApproval({ always_scope: null }));
    expect(alwaysButtonOf(tree)).toBeUndefined();
  });

  it("omits the Always button when canDecide is false, even with a scope", () => {
    const tree = renderCard(makeApproval({ always_scope: "the porch light" }), { canDecide: false });
    expect(alwaysButtonOf(tree)).toBeUndefined();
  });

  it("disables the Always button when expired", () => {
    const tree = renderCard(
      makeApproval({ always_scope: "the porch light", expires: NOW_S - 1 }),
    );
    expect(alwaysButtonOf(tree).props.disabled).toBe(true);
  });
});

// --- useApprovals ---------------------------------------------------

// Timer stubs for the polling loop: setTimeout records its callback
// instead of running it, so tests can tick by hand.
let timeoutCalls;
let setTimeoutMock;
let clearTimeoutMock;

function stubPollTimers() {
  timeoutCalls = [];
  setTimeoutMock = vi.fn((cb, ms) => {
    timeoutCalls.push({ cb, ms });
    return timeoutCalls.length;
  });
  clearTimeoutMock = vi.fn();
  vi.stubGlobal("setTimeout", setTimeoutMock);
  vi.stubGlobal("clearTimeout", clearTimeoutMock);
}

function callApprovals(enabled) {
  rewind();
  const returned = useApprovals(enabled);
  return { returned, effect: mocks.effect, deps: mocks.effectDeps };
}

describe("useApprovals initial state and disabled gating", () => {
  it("starts with empty approvals, canDecide false and no problem", () => {
    const { returned } = callApprovals(true);
    expect(returned.approvals).toEqual([]);
    expect(returned.canDecide).toBe(false);
    expect(returned.problem).toBeNull();
    expect(typeof returned.decide).toBe("function");
    expect(typeof returned.reload).toBe("function");
    expect(mocks.useState).toHaveBeenCalledWith({ approvals: [], canDecide: false, problem: null });
  });

  it("registers the effect with [enabled, load] deps", () => {
    const { deps } = callApprovals(true);
    expect(deps).toHaveLength(2);
    expect(deps[0]).toBe(true);
    expect(typeof deps[1]).toBe("function");
  });

  it("when enabled=false it does not poll and returns no cleanup", async () => {
    stubPollTimers();
    const { effect } = callApprovals(false);
    const cleanup = effect();
    await flushPromises();
    expect(cleanup).toBeUndefined();
    expect(fleetMocks.fleet.approvals).not.toHaveBeenCalled();
    expect(setTimeoutMock).not.toHaveBeenCalled();
  });

  it("when fleetEnabled() is false it does not poll, even if enabled", async () => {
    stubPollTimers();
    fleetMocks.fleetEnabled.mockReturnValue(false);
    const { effect } = callApprovals(true);
    const cleanup = effect();
    await flushPromises();
    expect(cleanup).toBeUndefined();
    expect(fleetMocks.fleet.approvals).not.toHaveBeenCalled();
  });

  it("when disabled it clears existing approvals, keeping canDecide and problem", () => {
    mocks.states[0] = { approvals: [makeApproval()], canDecide: true, problem: "warden down" };
    const { effect } = callApprovals(false);
    effect();
    expect(mocks.states[0]).toEqual({ approvals: [], canDecide: true, problem: "warden down" });
  });

  it("when disabled with no approvals it keeps the same state object (no new state)", () => {
    const initial = mocks.states[0] || { approvals: [], canDecide: false, problem: null };
    callApprovals(false);
    const before = mocks.states[0];
    expect(before).toEqual(initial);
    mocks.effect();
    // The functional update returns `s` itself when there is nothing
    // to clear, so the stored reference is unchanged.
    expect(mocks.states[0]).toBe(before);
  });
});

describe("useApprovals loading and polling", () => {
  it("loads via fleet.approvals() and maps can_decide / warden_problem", async () => {
    stubPollTimers();
    const list = [makeApproval({ id: "x1" }), makeApproval({ id: "x2" })];
    fleetMocks.fleet.approvals.mockResolvedValue({
      approvals: list,
      can_decide: true,
      warden_problem: "warden slow",
    });
    const { effect } = callApprovals(true);
    effect();
    await flushPromises();
    expect(fleetMocks.fleet.approvals).toHaveBeenCalledTimes(1);
    expect(mocks.states[0]).toEqual({ approvals: list, canDecide: true, problem: "warden slow" });
  });

  it("defaults missing response fields to [] / false / null", async () => {
    stubPollTimers();
    fleetMocks.fleet.approvals.mockResolvedValue({});
    const { effect } = callApprovals(true);
    effect();
    await flushPromises();
    expect(mocks.states[0]).toEqual({ approvals: [], canDecide: false, problem: null });
  });

  it("coerces a truthy can_decide to a boolean", async () => {
    stubPollTimers();
    fleetMocks.fleet.approvals.mockResolvedValue({ approvals: [], can_decide: 1, warden_problem: undefined });
    const { effect } = callApprovals(true);
    effect();
    await flushPromises();
    expect(mocks.states[0].canDecide).toBe(true);
    expect(mocks.states[0].problem).toBeNull();
  });

  it("swallows a rejected approvals() call: state unchanged, polling still reschedules", async () => {
    stubPollTimers();
    fleetMocks.fleet.approvals.mockRejectedValue(new Error("off tailnet"));
    const { effect } = callApprovals(true);
    effect();
    await flushPromises();
    expect(mocks.states[0]).toEqual({ approvals: [], canDecide: false, problem: null });
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(timeoutCalls[0].ms).toBe(2000);
  });

  it("reschedules at 2000ms and the next tick loads again", async () => {
    stubPollTimers();
    fleetMocks.fleet.approvals.mockResolvedValue({ approvals: [], can_decide: false, warden_problem: null });
    const { effect } = callApprovals(true);
    effect();
    await flushPromises();
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(timeoutCalls[0].ms).toBe(2000);
    await timeoutCalls[0].cb();
    expect(fleetMocks.fleet.approvals).toHaveBeenCalledTimes(2);
    expect(setTimeoutMock).toHaveBeenCalledTimes(2);
    expect(timeoutCalls[1].ms).toBe(2000);
  });

  it("skips the load while the document is hidden but still reschedules", async () => {
    stubPollTimers();
    document.visibilityState = "hidden";
    const { effect } = callApprovals(true);
    effect();
    await flushPromises();
    expect(fleetMocks.fleet.approvals).not.toHaveBeenCalled();
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    expect(timeoutCalls[0].ms).toBe(2000);
    // Becoming visible lets the rescheduled tick load.
    document.visibilityState = "visible";
    await timeoutCalls[0].cb();
    expect(fleetMocks.fleet.approvals).toHaveBeenCalledTimes(1);
  });

  it("cleanup clears the pending timeout and stops rescheduling", async () => {
    stubPollTimers();
    fleetMocks.fleet.approvals.mockResolvedValue({ approvals: [], can_decide: false, warden_problem: null });
    const { effect } = callApprovals(true);
    const cleanup = effect();
    await flushPromises();
    expect(setTimeoutMock).toHaveBeenCalledTimes(1);
    cleanup();
    expect(clearTimeoutMock).toHaveBeenCalledTimes(1);
    // The timer id handed back by the last setTimeout is what is cleared
    // (the stub returns the 1-based call count as the id).
    expect(clearTimeoutMock).toHaveBeenCalledWith(1);
  });

  it("drops a late reply from a loop that was cleaned up (generation guard)", async () => {
    stubPollTimers();
    const pending = deferred();
    fleetMocks.fleet.approvals.mockReturnValue(pending.promise);
    const { effect } = callApprovals(true);
    const cleanup = effect();
    cleanup();
    pending.resolve({ approvals: [makeApproval()], can_decide: true, warden_problem: null });
    await flushPromises();
    expect(mocks.states[0]).toEqual({ approvals: [], canDecide: false, problem: null });
    // And the stale tick never rescheduled.
    expect(setTimeoutMock).not.toHaveBeenCalled();
  });
});

describe("useApprovals decide and reload", () => {
  it("decide calls fleet.decideApproval, filters the approval out, and reloads", async () => {
    stubPollTimers();
    const a = makeApproval({ id: "keep" });
    const b = makeApproval({ id: "gone" });
    mocks.states[0] = { approvals: [a, b], canDecide: true, problem: null };
    fleetMocks.fleet.approvals.mockResolvedValue({
      approvals: [a],
      can_decide: true,
      warden_problem: null,
    });
    const { returned } = callApprovals(true);
    await returned.decide("gone", "once");
    expect(fleetMocks.fleet.decideApproval).toHaveBeenCalledTimes(1);
    expect(fleetMocks.fleet.decideApproval).toHaveBeenCalledWith("gone", "once");
    // The reload ran and its answer is the final state.
    expect(fleetMocks.fleet.approvals).toHaveBeenCalledTimes(1);
    expect(mocks.states[0]).toEqual({ approvals: [a], canDecide: true, problem: null });
  });

  it("decide filters the approval out even before the reload answers", async () => {
    stubPollTimers();
    const a = makeApproval({ id: "keep" });
    const b = makeApproval({ id: "gone" });
    mocks.states[0] = { approvals: [a, b], canDecide: true, problem: null };
    const pending = deferred();
    fleetMocks.fleet.approvals.mockReturnValue(pending.promise);
    const { returned } = callApprovals(true);
    const deciding = returned.decide("gone", "deny");
    await flushPromises();
    expect(mocks.states[0].approvals).toEqual([a]);
    pending.resolve({ approvals: [a], can_decide: true, warden_problem: null });
    await deciding;
  });

  it("decide propagates a decideApproval rejection and does not filter or reload", async () => {
    stubPollTimers();
    const b = makeApproval({ id: "gone" });
    mocks.states[0] = { approvals: [b], canDecide: true, problem: null };
    const err404 = new Error("gone");
    err404.status = 404;
    fleetMocks.fleet.decideApproval.mockRejectedValue(err404);
    const { returned } = callApprovals(true);
    await expect(returned.decide("gone", "once")).rejects.toBe(err404);
    expect(mocks.states[0].approvals).toEqual([b]);
    expect(fleetMocks.fleet.approvals).not.toHaveBeenCalled();
  });

  it("reload re-runs the load with the current generation", async () => {
    stubPollTimers();
    fleetMocks.fleet.approvals.mockResolvedValue({
      approvals: [makeApproval({ id: "r1" })],
      can_decide: false,
      warden_problem: null,
    });
    const { returned } = callApprovals(true);
    await returned.reload();
    expect(fleetMocks.fleet.approvals).toHaveBeenCalledTimes(1);
    expect(mocks.states[0].approvals).toEqual([makeApproval({ id: "r1" })]);
  });
});

// --- ApprovalStack ----------------------------------------------------

const SAID = 0;

function renderStack(approvals, { decide = vi.fn(async () => {}), canDecide = true } = {}) {
  rewind();
  return ApprovalStack({ approvals, decide, canDecide });
}

function stackCardsOf(tree) {
  return tree.props.children.slice(1);
}

function announcementOf(tree) {
  return tree.props.children[0];
}

describe("ApprovalStack rendering", () => {
  it("renders a stack div with one card element per approval, keyed by id", () => {
    const a = makeApproval({ id: "s1" });
    const b = makeApproval({ id: "s2" });
    const tree = renderStack([a, b]);
    expect(tree.type).toBe("div");
    expect(tree.props.className).toBe("approval-stack");
    const cards = stackCardsOf(tree);
    expect(cards).toHaveLength(2);
    expect(cards[0].type).toBe(ApprovalCard);
    expect(cards[0].key).toBe("s1");
    expect(cards[0].props.approval).toBe(a);
    expect(cards[1].key).toBe("s2");
    expect(cards[1].props.approval).toBe(b);
    expect(cards[0].props.canDecide).toBe(true);
    expect(typeof cards[0].props.decide).toBe("function");
  });

  it("renders just the live region when there are no approvals", () => {
    const tree = renderStack([]);
    expect(tree.props.children).toHaveLength(1);
    expect(announcementOf(tree).props.children).toBe("");
  });

  it("the announcement paragraph is sr-only with aria-live polite", () => {
    const tree = renderStack([makeApproval()]);
    const p = announcementOf(tree);
    expect(p.type).toBe("p");
    expect(p.props.className).toBe("sr-only");
    expect(p.props["aria-live"]).toBe("polite");
  });
});

describe("ApprovalStack announcements and scrolling", () => {
  function primeBox(tree) {
    // Point the box ref at a fake element before the effect runs.
    const scrollIntoView = vi.fn();
    mocks.refs[1].current = { scrollIntoView };
    return scrollIntoView;
  }

  it("announces a newly-seen approval and scrolls it into view smoothly", () => {
    const a = makeApproval({ id: "n1", title: "water the plants" });
    const tree = renderStack([a]);
    const scrollIntoView = primeBox(tree);
    mocks.effect();
    expect(mocks.states[SAID]).toBe("Qubit needs your approval: water the plants.");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "smooth" });
    const after = renderStack([a]);
    expect(announcementOf(after).props.children).toBe("Qubit needs your approval: water the plants.");
  });

  it("announces only the last fresh approval when several arrive at once", () => {
    const a = makeApproval({ id: "n1", title: "first thing" });
    const b = makeApproval({ id: "n2", title: "second thing" });
    renderStack([a, b]);
    mocks.effect();
    expect(mocks.states[SAID]).toBe("Qubit needs your approval: second thing.");
  });

  it("does not re-announce or re-scroll for already-seen ids on re-render", () => {
    const a = makeApproval({ id: "n1", title: "water the plants" });
    const tree = renderStack([a]);
    const scrollIntoView = primeBox(tree);
    mocks.effect();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const saidAfterFirst = mocks.states[SAID];
    const setterCalls = mocks.setters[SAID].mock.calls.length;
    renderStack([a]);
    mocks.effect();
    expect(mocks.states[SAID]).toBe(saidAfterFirst);
    expect(mocks.setters[SAID].mock.calls.length).toBe(setterCalls);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("announces a later arrival while keeping earlier ids seen", () => {
    const a = makeApproval({ id: "n1", title: "first thing" });
    const b = makeApproval({ id: "n2", title: "later thing" });
    renderStack([a]);
    mocks.effect();
    expect(mocks.states[SAID]).toBe("Qubit needs your approval: first thing.");
    renderStack([a, b]);
    mocks.effect();
    expect(mocks.states[SAID]).toBe("Qubit needs your approval: later thing.");
  });

  it("uses behavior 'auto' when prefers-reduced-motion matches", () => {
    window.matchMedia.mockReturnValue({ matches: true });
    const a = makeApproval({ id: "n1" });
    const tree = renderStack([a]);
    const scrollIntoView = primeBox(tree);
    mocks.effect();
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "auto" });
  });

  it("does nothing on an effect run with no approvals", () => {
    const tree = renderStack([]);
    const scrollIntoView = primeBox(tree);
    mocks.effect();
    expect(mocks.states[SAID]).toBe("");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("tolerates a missing box element (no scroll target yet)", () => {
    const a = makeApproval({ id: "n1", title: "water the plants" });
    renderStack([a]);
    mocks.refs[1].current = null;
    expect(() => mocks.effect()).not.toThrow();
    expect(mocks.states[SAID]).toBe("Qubit needs your approval: water the plants.");
  });
});
