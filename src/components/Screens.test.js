import { describe, it, expect, vi, beforeEach } from "vitest";

// Screens.jsx holds Sol's four secondary screens — Library, Ideas,
// Goals and Settings — plus two unexported pieces that carry most of
// the risk: SettingToggle, the switch every setting is rendered as,
// and QubitSettings, the More > Qubit section that loads how Qubit
// answers from the gateway, optimistically flips a setting, rolls
// back only the key that failed, and guards against a slower earlier
// GET overwriting a newer change. Those decisions are worth pinning
// without a gateway or a phone. Mock `react` with per-slot state
// (the suite style of ApprovalCard.test.js), stub ../fleet, ./Icon
// and ./UpdaterCard, then drive the components by calling them,
// running the captured effect, and invoking onClick / set props found
// in the returned element tree — no DOM or testing-library needed.
//
// Two style notes where this file has to differ from its siblings:
// - QubitSettings reaches its generation ref through the React
//   default (`React.useRef`), not a named import, so the react mock
//   must override the hooks on the default object too; with only the
//   named overrides the real React.useRef throws outside a renderer.
// - SettingToggle and QubitSettings are not exported, so they are
//   reached the way the app reaches them: as element types in the
//   SettingsScreen tree (the chat card's toggles, the appearance
//   card's toggle, and the element in the Qubit slot), invoked with
//   the props SettingsScreen gave them.
//
// Unreachable-code notes: no branch in Screens.jsx was found to be
// unreachable. The one oddity worth pinning rather than "fixing" is
// QubitSettings' trailing slots: with an admin user, no warden
// problem and no error, the fragment's children are literally
// [h3, div, false, undefined, ""] — the three `&&` slots each yield a
// different falsy value, and the tests below pin them as falsy
// (with the exact value where it is deterministic).
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
  return holder;
});

const fleetMocks = vi.hoisted(() => ({
  fleet: {
    qubitSettings: vi.fn(),
    setQubitSettings: vi.fn(),
  },
  fleetEnabled: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal();
  const mocked = {
    ...actual,
    useState: mocks.useState,
    useRef: mocks.useRef,
    useEffect: mocks.useEffect,
  };
  return {
    ...mocked,
    default: {
      ...actual,
      useState: mocks.useState,
      useRef: mocks.useRef,
      useEffect: mocks.useEffect,
    },
  };
});

vi.mock("../fleet", () => fleetMocks);

vi.mock("./Icon", () => ({
  Icon: () => null,
}));

vi.mock("./UpdaterCard", () => ({
  UpdaterCard: () => null,
}));

import React from "react";
import * as Screens from "./Screens.jsx";
import { LibraryScreen, IdeasScreen, GoalsScreen, SettingsScreen } from "./Screens.jsx";
import { Icon } from "./Icon.jsx";
import { UpdaterCard } from "./UpdaterCard.jsx";

const realSetTimeout = globalThis.setTimeout;

// QubitSettings state slots, in declaration order.
const ST = 0;
const ERR = 1;
const SAVING = 2;
// QubitSettings ref slots, in declaration order.
const GEN = 0;

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
}

function rewind() {
  mocks.cursor = 0;
  mocks.refCursor = 0;
}

function makeSettingsProps(overrides = {}) {
  return {
    active: true,
    streaming: true,
    setStreaming: vi.fn(),
    collapseLong: false,
    setCollapseLong: vi.fn(),
    haptics: false,
    setHaptics: vi.fn(),
    theme: "dark",
    setTheme: vi.fn(),
    openConfig: vi.fn(),
    openConnectors: vi.fn(),
    openSkills: vi.fn(),
    backendStatus: "Qubit · gateway",
    ...overrides,
  };
}

function renderSettings(overrides = {}) {
  const props = makeSettingsProps(overrides);
  rewind();
  return { props, tree: SettingsScreen(props) };
}

function settingsChildren(tree) {
  return tree.props.children;
}

function chatToggleEls(tree) {
  return settingsChildren(tree)[2].props.children;
}

function themeToggleEl(tree) {
  return settingsChildren(tree)[5].props.children;
}

function qubitEl(tree) {
  return settingsChildren(tree)[3];
}

function integrationButtons(tree) {
  return settingsChildren(tree)[7].props.children;
}

// Invoke a SettingToggle element the way React would.
function renderToggle(el) {
  return el.type(el.props);
}

// Invoke QubitSettings through the element SettingsScreen created
// for it, with hook state starting from the holder's current slots.
function renderQubit(active = true, settingsOverrides = {}) {
  const { tree } = renderSettings({ active, ...settingsOverrides });
  const el = qubitEl(tree);
  rewind();
  return el.type(el.props);
}

function qubitSettings(overrides = {}) {
  return {
    front_desk: false,
    cloud_agents_first: false,
    can_change: true,
    ...overrides,
  };
}

// Preset QubitSettings' slots, then render it.
function renderQubitWith(st, { err = "", saving = false, active = true } = {}) {
  if (st !== undefined) mocks.states[ST] = st;
  mocks.states[ERR] = err;
  mocks.states[SAVING] = saving;
  return renderQubit(active);
}

function qubitToggles(fragment) {
  return fragment.props.children[1].props.children;
}

beforeEach(() => {
  resetHolder();
  fleetMocks.fleet.qubitSettings.mockReset();
  fleetMocks.fleet.setQubitSettings.mockReset();
  fleetMocks.fleetEnabled.mockReset();
  fleetMocks.fleetEnabled.mockReturnValue(true);
  fleetMocks.fleet.qubitSettings.mockResolvedValue(qubitSettings());
  fleetMocks.fleet.setQubitSettings.mockResolvedValue(qubitSettings());
});

describe("Screens module exports", () => {
  it("exports exactly the four screens and nothing else", () => {
    expect(Object.keys(Screens).sort()).toEqual([
      "GoalsScreen",
      "IdeasScreen",
      "LibraryScreen",
      "SettingsScreen",
    ]);
  });

  it("exports each screen as a function (SettingToggle and QubitSettings stay internal)", () => {
    for (const name of ["LibraryScreen", "IdeasScreen", "GoalsScreen", "SettingsScreen"]) {
      expect(typeof Screens[name]).toBe("function");
    }
    expect(Screens.SettingToggle).toBeUndefined();
    expect(Screens.QubitSettings).toBeUndefined();
  });
});

describe("SettingToggle switch semantics (via the Settings chat toggles)", () => {
  function firstToggle(overrides = {}) {
    const { tree } = renderSettings(overrides);
    return renderToggle(chatToggleEls(tree)[0]);
  }

  it("renders a button with role=switch and aria-checked following `on`", () => {
    const onTree = firstToggle({ streaming: true });
    expect(onTree.type).toBe("button");
    expect(onTree.props.className).toBe("setting-row");
    expect(onTree.props.role).toBe("switch");
    expect(onTree.props["aria-checked"]).toBe(true);

    const offTree = firstToggle({ streaming: false });
    expect(offTree.props["aria-checked"]).toBe(false);
  });

  it("leaves disabled and aria-describedby unset when neither is supplied", () => {
    const tree = firstToggle();
    expect(tree.props.disabled).toBeUndefined();
    expect(tree.props["aria-describedby"]).toBeUndefined();
  });

  it("paints the switch 'on' only when on, keeping the trailing-space class otherwise", () => {
    const knobOf = (t) => t.props.children[2].props.children;
    expect(knobOf(firstToggle({ streaming: true })).props.className).toBe("switch on");
    // The off class is "switch " (with the trailing space from the
    // string concatenation) — pinned as-is.
    expect(knobOf(firstToggle({ streaming: false })).props.className).toBe("switch ");
    const knob = knobOf(firstToggle());
    expect(knob.type).toBe("i");
    expect(knob.props.children.type).toBe("u");
    expect(knob.props.children.props).toEqual({});
  });

  it("renders the icon in an aria-hidden setting-icon span at size 18", () => {
    const tree = firstToggle();
    const span = tree.props.children[0];
    expect(span.type).toBe("span");
    expect(span.props.className).toBe("setting-icon");
    expect(span.props["aria-hidden"]).toBe("true");
    expect(span.props.children.type).toBe(Icon);
    expect(span.props.children.props).toEqual({ name: "spark", size: 18 });
  });

  it("renders label as <b> and note as <small>, then the aria-hidden toggle-hit span", () => {
    const tree = firstToggle();
    const text = tree.props.children[1];
    expect(text.props.children[0].type).toBe("b");
    expect(text.props.children[0].props.children).toBe("Streaming responses");
    expect(text.props.children[1].type).toBe("small");
    expect(text.props.children[1].props.children).toBe("Show replies as they arrive");
    const hit = tree.props.children[2];
    expect(hit.props.className).toBe("toggle-hit");
    expect(hit.props["aria-hidden"]).toBe("true");
    expect(tree.props.children).toHaveLength(3);
  });

  it("clicking calls set with the negated value and the click's currentTarget", () => {
    const target = { id: "row-1" };
    const { props, tree } = renderSettings({ streaming: true });
    const button = renderToggle(chatToggleEls(tree)[0]);
    button.props.onClick({ currentTarget: target });
    expect(props.setStreaming).toHaveBeenCalledTimes(1);
    expect(props.setStreaming).toHaveBeenCalledWith(false, target);
  });

  it("clicking an off toggle asks for true, again with currentTarget as the second argument", () => {
    const target = { id: "row-2" };
    const { props, tree } = renderSettings({ streaming: false });
    const button = renderToggle(chatToggleEls(tree)[0]);
    button.props.onClick({ currentTarget: target });
    expect(props.setStreaming).toHaveBeenCalledWith(true, target);
  });
});

describe("SettingsScreen chat toggles wiring", () => {
  const cases = [
    [0, "streaming", "setStreaming", "Streaming responses", "Show replies as they arrive", "spark"],
    [1, "collapseLong", "setCollapseLong", "Collapse long messages", "Fold long replies behind Read more", "collapse"],
    [2, "haptics", "setHaptics", "Haptics", "Crisp feedback on supported devices", "mic"],
  ];
  for (const [index, onKey, setKey, label, note, icon] of cases) {
    it(`toggle ${index} passes ${onKey}/${setKey} straight through with its label, note and icon`, () => {
      const { props, tree } = renderSettings({ [onKey]: true });
      const el = chatToggleEls(tree)[index];
      expect(el.props.on).toBe(true);
      expect(el.props.set).toBe(props[setKey]);
      expect(el.props.label).toBe(label);
      expect(el.props.note).toBe(note);
      expect(el.props.icon).toBe(icon);
      expect(el.props.disabled).toBeUndefined();
      expect(el.props.describedBy).toBeUndefined();
    });
  }

  it("the Chat card sits under a 'Chat' section label", () => {
    const { tree } = renderSettings();
    const heading = settingsChildren(tree)[1];
    expect(heading.type).toBe("h3");
    expect(heading.props.className).toBe("section-label");
    expect(heading.props.children).toBe("Chat");
    expect(settingsChildren(tree)[2].props.className).toBe("settings-card");
  });
});

describe("LibraryScreen", () => {
  function thread(id, overrides = {}) {
    return { id, title: `Title ${id}`, preview: `Preview ${id}`, time: `Time ${id}`, ...overrides };
  }

  function renderLibrary(overrides = {}) {
    const props = { active: true, threads: [thread("t1")], choose: vi.fn(), ...overrides };
    return { props, tree: LibraryScreen(props) };
  }

  function cardsOf(tree) {
    return tree.props.children[0].props.children;
  }

  it("renders a content-screen section that is 'active' only when active", () => {
    expect(renderLibrary({ active: true }).tree.type).toBe("section");
    expect(renderLibrary({ active: true }).tree.props.className).toBe("screen content-screen active");
    // Inactive keeps the trailing space from the string concatenation.
    expect(renderLibrary({ active: false }).tree.props.className).toBe("screen content-screen ");
    expect(renderLibrary().tree.props.children[0].props.className).toBe("card-stack");
  });

  it("renders one conversation card per thread, keyed by thread id, with title, preview and time", () => {
    const threads = [thread("a"), thread("b")];
    const { tree } = renderLibrary({ threads });
    const cards = cardsOf(tree);
    expect(cards).toHaveLength(2);
    expect(cards[0].key).toBe("a");
    expect(cards[1].key).toBe("b");
    expect(cards[0].type).toBe("button");
    expect(cards[0].props.className).toBe("conversation-card");
    const [avatar, text, time] = cards[0].props.children;
    expect(avatar.props.className).toBe("mini-avatar");
    expect(avatar.props.children.type).toBe(Icon);
    expect(avatar.props.children.props).toEqual({ name: "chat" });
    expect(text.props.children[0].props.children).toBe("Title a");
    expect(text.props.children[1].props.children).toBe("Preview a");
    expect(time.type).toBe("time");
    expect(time.props.children).toBe("Time a");
  });

  it("caps the list at six threads, in order", () => {
    const threads = Array.from({ length: 8 }, (_, i) => thread(`t${i + 1}`));
    const { tree } = renderLibrary({ threads });
    const cards = cardsOf(tree);
    expect(cards).toHaveLength(6);
    expect(cards.map((c) => c.key)).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
  });

  it("renders exactly six cards for six threads and an empty stack for none", () => {
    const six = Array.from({ length: 6 }, (_, i) => thread(`t${i + 1}`));
    expect(cardsOf(renderLibrary({ threads: six }).tree)).toHaveLength(6);
    expect(cardsOf(renderLibrary({ threads: [] }).tree)).toEqual([]);
  });

  it("clicking a card chooses that thread's id and no other", () => {
    const threads = [thread("a"), thread("b")];
    const { props, tree } = renderLibrary({ threads });
    cardsOf(tree)[1].props.onClick();
    expect(props.choose).toHaveBeenCalledTimes(1);
    expect(props.choose).toHaveBeenCalledWith("b");
  });
});

describe("IdeasScreen", () => {
  function renderIdeas(overrides = {}) {
    const props = {
      active: true,
      ideas: [],
      draft: "",
      setDraft: vi.fn(),
      add: vi.fn(),
      inputRef: { current: null },
      ...overrides,
    };
    return { props, tree: IdeasScreen(props) };
  }

  function formOf(tree) {
    return tree.props.children[0];
  }

  function inputOf(tree) {
    return formOf(tree).props.children[0];
  }

  function submitOf(tree) {
    return formOf(tree).props.children[1];
  }

  it("renders a content-screen section that is 'active' only when active", () => {
    expect(renderIdeas({ active: true }).tree.props.className).toBe("screen content-screen active");
    expect(renderIdeas({ active: false }).tree.props.className).toBe("screen content-screen ");
  });

  it("wires the composer input: ref, value, placeholder, aria-label and onChange", () => {
    const inputRef = { current: null };
    const { props, tree } = renderIdeas({ draft: "a fragment", inputRef });
    const input = inputOf(tree);
    expect(input.type).toBe("input");
    // React 19: ref arrives as a regular prop on the element.
    expect(input.props.ref).toBe(inputRef);
    expect(input.props.value).toBe("a fragment");
    expect(input.props.placeholder).toBe("A title, question, or fragment…");
    expect(input.props["aria-label"]).toBe("New idea");
    input.props.onChange({ target: { value: "typed" } });
    expect(props.setDraft).toHaveBeenCalledTimes(1);
    expect(props.setDraft).toHaveBeenCalledWith("typed");
  });

  it("submitting the form prevents default and calls add once", () => {
    const { props, tree } = renderIdeas();
    expect(formOf(tree).type).toBe("form");
    expect(formOf(tree).props.className).toBe("idea-composer");
    const event = { preventDefault: vi.fn() };
    formOf(tree).props.onSubmit(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(props.add).toHaveBeenCalledTimes(1);
  });

  it("disables 'New idea' while the draft is empty or only whitespace", () => {
    for (const draft of ["", "   ", "\n\t "]) {
      const { tree } = renderIdeas({ draft });
      expect(submitOf(tree).props.disabled).toBe(true);
      expect(submitOf(tree).props.className).toBe("primary-button");
      expect(submitOf(tree).props.children).toBe("New idea");
    }
  });

  it("enables 'New idea' for a draft with any non-whitespace, padding included", () => {
    for (const draft of ["x", " x ", "  idea  "]) {
      expect(submitOf(renderIdeas({ draft }).tree).props.disabled).toBe(false);
    }
  });

  it("lists ideas as articles keyed by id with the 'Added this session' note", () => {
    const ideas = [
      { id: "i1", text: "First idea" },
      { id: "i2", text: "Second idea" },
    ];
    const { tree } = renderIdeas({ ideas });
    const list = tree.props.children[1];
    expect(list.type).toBe("div");
    expect(list.props.className).toBe("idea-list");
    expect(list.props.children).toHaveLength(2);
    expect(list.props.children[0].key).toBe("i1");
    expect(list.props.children[1].key).toBe("i2");
    const article = list.props.children[0];
    expect(article.type).toBe("article");
    expect(article.props.children[0].type).toBe("b");
    expect(article.props.children[0].props.children).toBe("First idea");
    expect(article.props.children[1].type).toBe("small");
    expect(article.props.children[1].props.children).toBe("Added this session");
  });

  it("shows the list even for a single idea (no empty state)", () => {
    const { tree } = renderIdeas({ ideas: [{ id: "only", text: "Solo" }] });
    expect(tree.props.children[1].props.className).toBe("idea-list");
  });

  it("with no ideas shows the empty state: icon, heading, copy and write button", () => {
    const { tree } = renderIdeas({ ideas: [] });
    const empty = tree.props.children[1];
    expect(empty.type).toBe("div");
    expect(empty.props.className).toBe("empty-state compact");
    const [symbol, heading, copy, button] = empty.props.children;
    expect(symbol.props.className).toBe("empty-symbol");
    expect(symbol.props.children.type).toBe(Icon);
    expect(symbol.props.children.props).toEqual({ name: "idea", size: 34 });
    expect(heading.type).toBe("h2");
    expect(heading.props.children).toBe("No saved ideas yet");
    expect(copy.type).toBe("p");
    expect(copy.props.children).toBe(
      "Capture one above, then bring it into a conversation when you’re ready.",
    );
    expect(button.type).toBe("button");
    expect(button.props.className).toBe("primary-button");
    expect(button.props.children).toBe("Write an idea");
  });

  it("'Write an idea' focuses the composer input through the shared ref", () => {
    const focus = vi.fn();
    const inputRef = { current: { focus } };
    const { tree } = renderIdeas({ inputRef });
    const button = tree.props.children[1].props.children[3];
    button.props.onClick();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("'Write an idea' is a no-op (not a throw) while the input ref is still null", () => {
    const { tree } = renderIdeas({ inputRef: { current: null } });
    const button = tree.props.children[1].props.children[3];
    expect(() => button.props.onClick()).not.toThrow();
    expect(button.props.onClick()).toBeNull();
  });
});

describe("GoalsScreen", () => {
  function renderGoals(overrides = {}) {
    const props = { active: true, start: vi.fn(), ...overrides };
    return { props, tree: GoalsScreen(props) };
  }

  it("renders a content-screen section that is 'active' only when active", () => {
    expect(renderGoals({ active: true }).tree.props.className).toBe("screen content-screen active");
    expect(renderGoals({ active: false }).tree.props.className).toBe("screen content-screen ");
  });

  it("leads with the 'In progress' section label", () => {
    const { tree } = renderGoals();
    const heading = tree.props.children[0];
    expect(heading.type).toBe("h3");
    expect(heading.props.className).toBe("section-label");
    expect(heading.props.children).toBe("In progress");
  });

  it("shows the first goal card at 65% with its next step", () => {
    const { tree } = renderGoals();
    const card = tree.props.children[1];
    expect(card.props.className).toBe("goal-card");
    expect(card.props.children[0].type).toBe("i");
    expect(card.props.children[0].props.children).toBe("65%");
    const text = card.props.children[1];
    expect(text.props.children[0].props.children).toBe("Shape the first Sol prototype");
    expect(text.props.children[1].props.children).toBe("Next: review the chat experience");
  });

  it("shows the second goal card at 30% with its next step", () => {
    const { tree } = renderGoals();
    const card = tree.props.children[2];
    expect(card.props.className).toBe("goal-card");
    expect(card.props.children[0].props.children).toBe("30%");
    const text = card.props.children[1];
    expect(text.props.children[0].props.children).toBe("Build a sustainable weekly rhythm");
    expect(text.props.children[1].props.children).toBe("Next: choose three anchor routines");
  });

  it("the action button is wired straight to `start`", () => {
    const { props, tree } = renderGoals();
    const button = tree.props.children[3];
    expect(button.type).toBe("button");
    expect(button.props.className).toBe("primary-button goal-action");
    expect(button.props.children).toBe("Plan a next step with Qubit");
    expect(button.props.onClick).toBe(props.start);
    button.props.onClick();
    expect(props.start).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsScreen structure", () => {
  it("renders a content-screen section that is 'active' only when active", () => {
    expect(renderSettings({ active: true }).tree.props.className).toBe("screen content-screen active");
    expect(renderSettings({ active: false }).tree.props.className).toBe("screen content-screen ");
  });

  it("leads with the plan card: Free plan, 33% used, reset date and progress bar", () => {
    const { tree } = renderSettings();
    const plan = settingsChildren(tree)[0];
    expect(plan.props.className).toBe("plan-card");
    const [head, copy, bar] = plan.props.children;
    expect(head.props.children[0].type).toBe("b");
    expect(head.props.children[0].props.children).toBe("Free plan");
    expect(head.props.children[1].type).toBe("span");
    expect(head.props.children[1].props.children).toBe("33% used");
    expect(copy.props.children).toBe("Weekly limit resets Sep 28");
    expect(bar.type).toBe("i");
    expect(bar.props.children.type).toBe("u");
  });

  it("orders its sections Chat, Qubit, Appearance, Integrations, then the updater", () => {
    const { tree } = renderSettings();
    const children = settingsChildren(tree);
    expect(children).toHaveLength(9);
    expect(children[1].props.children).toBe("Chat");
    expect(children[3].props.active).toBe(true);
    expect(children[4].props.children).toBe("Appearance");
    expect(children[6].props.children).toBe("Integrations");
    for (const index of [1, 4, 6]) {
      expect(children[index].type).toBe("h3");
      expect(children[index].props.className).toBe("section-label");
    }
  });

  it("passes `active` straight through to the QubitSettings element", () => {
    expect(qubitEl(renderSettings({ active: true }).tree).props).toEqual({ active: true });
    expect(qubitEl(renderSettings({ active: false }).tree).props).toEqual({ active: false });
    expect(typeof qubitEl(renderSettings().tree).type).toBe("function");
  });

  it("always includes the UpdaterCard as the last child, keyed 'updater'", () => {
    const { tree } = renderSettings();
    const last = settingsChildren(tree)[8];
    expect(last.type).toBe(UpdaterCard);
    expect(last.key).toBe("updater");
    expect(last.props).toEqual({});
  });
});

describe("SettingsScreen appearance toggle", () => {
  it("in light theme the toggle is on with the sun icon", () => {
    const { tree } = renderSettings({ theme: "light" });
    const el = themeToggleEl(tree);
    expect(el.props.on).toBe(true);
    expect(el.props.icon).toBe("sun");
    expect(el.props.label).toBe("Light appearance");
    expect(el.props.note).toBe("Switch between light and dark themes");
  });

  it("in dark theme the toggle is off with the moon icon", () => {
    const { tree } = renderSettings({ theme: "dark" });
    const el = themeToggleEl(tree);
    expect(el.props.on).toBe(false);
    expect(el.props.icon).toBe("moon");
  });

  it("any theme other than exactly 'light' reads as off with the moon icon", () => {
    for (const theme of ["system", "", undefined]) {
      const el = themeToggleEl(renderSettings({ theme }).tree);
      expect(el.props.on).toBe(false);
      expect(el.props.icon).toBe("moon");
    }
  });

  it("the toggle's set translates true to 'light' and false to 'dark'", () => {
    const { props, tree } = renderSettings({ theme: "dark" });
    const el = themeToggleEl(tree);
    el.props.set(true);
    expect(props.setTheme).toHaveBeenCalledWith("light");
    el.props.set(false);
    expect(props.setTheme).toHaveBeenCalledWith("dark");
    expect(props.setTheme).toHaveBeenCalledTimes(2);
  });

  it("rendered as a switch, clicking the appearance toggle flips the theme", () => {
    const { props, tree } = renderSettings({ theme: "light" });
    const button = renderToggle(themeToggleEl(tree));
    expect(button.props["aria-checked"]).toBe(true);
    button.props.onClick({ currentTarget: { id: "theme-row" } });
    // SettingToggle passes currentTarget as a second argument; the
    // theme wrapper ignores it and maps the boolean alone.
    expect(props.setTheme).toHaveBeenCalledTimes(1);
    expect(props.setTheme).toHaveBeenCalledWith("dark");
  });
});

describe("SettingsScreen integrations rows", () => {
  const cases = [
    [0, "openConfig", "Backend / Model", null, "spark"],
    [1, "openConnectors", "MCP connectors", "3 available · Prototype", "plug"],
    [2, "openSkills", "Skills", "Enable tools for Qubit", "skill"],
  ];
  for (const [index, opener, label, note, icon] of cases) {
    it(`row ${index} ('${label}') shows its icon, label and note with a chevron`, () => {
      const backendStatus = "Hermes · local";
      const { tree } = renderSettings({ backendStatus });
      const row = integrationButtons(tree)[index];
      expect(row.type).toBe("button");
      expect(row.props.className).toBe("setting-row");
      const [iconSpan, text, chevron] = row.props.children;
      expect(iconSpan.props.className).toBe("setting-icon");
      expect(iconSpan.props["aria-hidden"]).toBe("true");
      expect(iconSpan.props.children.type).toBe(Icon);
      expect(iconSpan.props.children.props).toEqual({ name: icon, size: 18 });
      expect(text.props.children[0].props.children).toBe(label);
      expect(text.props.children[1].props.children).toBe(note === null ? backendStatus : note);
      expect(chevron.type).toBe("em");
      expect(chevron.props["aria-hidden"]).toBe("true");
      expect(chevron.props.children).toBe("›");
    });

    it(`row ${index} ('${label}') opens through ${opener} with the click's currentTarget`, () => {
      const target = { id: `row-${index}` };
      const { props, tree } = renderSettings();
      integrationButtons(tree)[index].props.onClick({ currentTarget: target });
      expect(props[opener]).toHaveBeenCalledTimes(1);
      expect(props[opener]).toHaveBeenCalledWith(target);
    });
  }

  it("the integrations card sits under an 'Integrations' label and holds three rows", () => {
    const { tree } = renderSettings();
    expect(settingsChildren(tree)[7].props.className).toBe("settings-card");
    expect(integrationButtons(tree)).toHaveLength(3);
  });
});

describe("QubitSettings render gating", () => {
  it("renders nothing when the fleet is not enabled, even with settings loaded", () => {
    fleetMocks.fleetEnabled.mockReturnValue(false);
    expect(renderQubitWith(qubitSettings())).toBeNull();
  });

  it("renders nothing before the settings have loaded (st still null)", () => {
    expect(renderQubitWith(null)).toBeNull();
    // The default initial state is null too: a fresh render is empty.
    resetHolder();
    expect(renderQubit(true)).toBeNull();
  });

  it("registers its load effect with [active] as the only dep", () => {
    renderQubitWith(qubitSettings(), { active: true });
    expect(mocks.effectDeps).toEqual([true]);
    renderQubitWith(qubitSettings(), { active: false });
    expect(mocks.effectDeps).toEqual([false]);
  });

  it("initialises st to null, err to empty and saving to false, with the generation ref at 0", () => {
    resetHolder();
    renderQubit(true);
    expect(mocks.useState).toHaveBeenCalledWith(null);
    expect(mocks.useState).toHaveBeenCalledWith("");
    expect(mocks.useState).toHaveBeenCalledWith(false);
    expect(mocks.refs[GEN]).toEqual({ current: 0 });
  });
});

describe("QubitSettings loaded rendering", () => {
  it("renders a fragment: 'Qubit' label, settings card, then the conditional slots", () => {
    const tree = renderQubitWith(qubitSettings());
    expect(tree.type).toBe(React.Fragment);
    const [heading, card, noteSlot, wardenSlot, errSlot] = tree.props.children;
    expect(heading.type).toBe("h3");
    expect(heading.props.className).toBe("section-label");
    expect(heading.props.children).toBe("Qubit");
    expect(card.props.className).toBe("settings-card");
    // Admin user, no warden problem, no error: the three && slots are
    // false / undefined / "" respectively (see the header note).
    expect(noteSlot).toBe(false);
    expect(wardenSlot).toBeUndefined();
    expect(errSlot).toBe("");
  });

  it("coerces front_desk and cloud_agents_first to booleans for the toggles", () => {
    const tree = renderQubitWith(qubitSettings({ front_desk: 1, cloud_agents_first: undefined }));
    const [front, cloud] = qubitToggles(tree);
    expect(front.props.on).toBe(true);
    expect(cloud.props.on).toBe(false);
  });

  it("labels the two toggles with their notes and icons", () => {
    const tree = renderQubitWith(qubitSettings());
    const [front, cloud] = qubitToggles(tree);
    expect(front.props.label).toBe("Front desk");
    expect(front.props.note).toBe("Quick replies right away; bigger asks go to Qubit's full brain");
    expect(front.props.icon).toBe("agent");
    expect(cloud.props.label).toBe("Use cloud agents first");
    expect(cloud.props.note).toBe("Helpers try Gemini first (free, rate-limited), then local");
    expect(cloud.props.icon).toBe("cloud");
  });

  it("for a non-admin the toggles are disabled, described by the admin note, and the note renders", () => {
    const tree = renderQubitWith(qubitSettings({ can_change: false }));
    const [front, cloud] = qubitToggles(tree);
    for (const toggle of [front, cloud]) {
      expect(toggle.props.disabled).toBe(true);
      expect(toggle.props.describedBy).toBe("qubit-settings-note");
    }
    const note = tree.props.children[2];
    expect(note.type).toBe("p");
    expect(note.props.id).toBe("qubit-settings-note");
    expect(note.props.className).toBe("settings-note");
    expect(note.props.children).toBe("Only a hub admin can change these.");
  });

  it("for an admin the toggles carry no describedBy and are enabled while not saving", () => {
    const tree = renderQubitWith(qubitSettings({ can_change: true }), { saving: false });
    for (const toggle of qubitToggles(tree)) {
      expect(toggle.props.disabled).toBe(false);
      expect(toggle.props.describedBy).toBeUndefined();
    }
  });

  it("while saving, the toggles lock even for an admin", () => {
    const tree = renderQubitWith(qubitSettings({ can_change: true }), { saving: true });
    for (const toggle of qubitToggles(tree)) {
      expect(toggle.props.disabled).toBe(true);
    }
  });

  it("shows the warden problem as a role=status settings-error when present", () => {
    const tree = renderQubitWith(qubitSettings({ warden_problem: "plugin missing" }));
    const warden = tree.props.children[3];
    expect(warden.type).toBe("p");
    expect(warden.props.className).toBe("settings-error");
    expect(warden.props.role).toBe("status");
    expect(warden.props.children).toBe("Warden: plugin missing");
  });

  it("shows a stored error as a role=alert settings-error", () => {
    const tree = renderQubitWith(qubitSettings(), { err: "That didn't save. Try again." });
    const err = tree.props.children[4];
    expect(err.type).toBe("p");
    expect(err.props.className).toBe("settings-error");
    expect(err.props.role).toBe("alert");
    expect(err.props.children).toBe("That didn't save. Try again.");
  });
});

describe("QubitSettings loading effect", () => {
  it("does not call the fleet when the screen is not active", () => {
    renderQubitWith(qubitSettings(), { active: false });
    const cleanup = mocks.effect();
    expect(cleanup).toBeUndefined();
    expect(fleetMocks.fleet.qubitSettings).not.toHaveBeenCalled();
  });

  it("does not call the fleet when the fleet is not enabled", () => {
    fleetMocks.fleetEnabled.mockReturnValue(false);
    renderQubitWith(qubitSettings(), { active: true });
    const cleanup = mocks.effect();
    expect(cleanup).toBeUndefined();
    expect(fleetMocks.fleet.qubitSettings).not.toHaveBeenCalled();
  });

  it("loads the settings once when active and enabled, storing the exact answer", async () => {
    const loaded = qubitSettings({ front_desk: true, can_change: false });
    fleetMocks.fleet.qubitSettings.mockResolvedValue(loaded);
    renderQubit(true);
    const cleanup = mocks.effect();
    expect(typeof cleanup).toBe("function");
    expect(fleetMocks.fleet.qubitSettings).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(mocks.states[ST]).toBe(loaded);
  });

  it("swallows a failed load: no state change, no error, settings stay absent", async () => {
    fleetMocks.fleet.qubitSettings.mockRejectedValue(new Error("off the tailnet"));
    renderQubit(true);
    mocks.effect();
    await flushPromises();
    expect(mocks.states[ST]).toBeNull();
    expect(mocks.states[ERR]).toBe("");
    // And the section still renders nothing.
    expect(renderQubitWith(mocks.states[ST])).toBeNull();
  });

  it("ignores a load that answers after the effect was cleaned up", async () => {
    const pending = deferred();
    fleetMocks.fleet.qubitSettings.mockReturnValue(pending.promise);
    renderQubit(true);
    const cleanup = mocks.effect();
    cleanup();
    pending.resolve(qubitSettings({ front_desk: true }));
    await flushPromises();
    expect(mocks.setters[ST]).not.toHaveBeenCalled();
    expect(mocks.states[ST]).toBeNull();
  });

  it("a slower earlier GET cannot overwrite a change made after it started (generation guard)", async () => {
    const base = qubitSettings({ front_desk: false });
    const server = qubitSettings({ front_desk: true });
    const pendingGet = deferred();
    fleetMocks.fleet.qubitSettings.mockReturnValue(pendingGet.promise);
    fleetMocks.fleet.setQubitSettings.mockResolvedValue(server);
    const tree = renderQubitWith(base);
    mocks.effect();
    // Flip front desk while the GET is still in flight.
    await qubitToggles(tree)[0].props.set(true);
    expect(mocks.states[ST]).toBe(server);
    expect(mocks.refs[GEN].current).toBe(1);
    // The stale GET finally answers with the old shape: dropped.
    pendingGet.resolve(base);
    await flushPromises();
    expect(mocks.states[ST]).toBe(server);
  });
});

describe("QubitSettings change flow", () => {
  it("applies the flip optimistically, flags saving, clears any old error and bumps the generation", async () => {
    const base = qubitSettings({ front_desk: false, cloud_agents_first: true });
    const pending = deferred();
    fleetMocks.fleet.setQubitSettings.mockReturnValue(pending.promise);
    const tree = renderQubitWith(base, { err: "previous failure" });
    const changing = qubitToggles(tree)[0].props.set(true);
    expect(fleetMocks.fleet.setQubitSettings).toHaveBeenCalledTimes(1);
    expect(fleetMocks.fleet.setQubitSettings).toHaveBeenCalledWith({ front_desk: true });
    expect(mocks.states[ST]).toEqual({ ...base, front_desk: true });
    expect(mocks.states[ERR]).toBe("");
    expect(mocks.states[SAVING]).toBe(true);
    expect(mocks.refs[GEN].current).toBe(1);
    const server = qubitSettings({ front_desk: true, cloud_agents_first: true });
    pending.resolve(server);
    await changing;
    // Success replaces the whole state with the gateway's answer.
    expect(mocks.states[ST]).toBe(server);
    expect(mocks.states[SAVING]).toBe(false);
  });

  it("sends only the changed key, for the cloud toggle too", async () => {
    const server = qubitSettings({ cloud_agents_first: true });
    fleetMocks.fleet.setQubitSettings.mockResolvedValue(server);
    const tree = renderQubitWith(qubitSettings());
    await qubitToggles(tree)[1].props.set(true);
    expect(fleetMocks.fleet.setQubitSettings).toHaveBeenCalledWith({ cloud_agents_first: true });
    expect(mocks.states[ST]).toBe(server);
    expect(mocks.states[SAVING]).toBe(false);
    expect(mocks.states[ERR]).toBe("");
  });

  it("clicking a rendered Qubit switch flips its key through the whole toggle path", async () => {
    fleetMocks.fleet.setQubitSettings.mockResolvedValue(qubitSettings({ front_desk: true }));
    const tree = renderQubitWith(qubitSettings({ front_desk: false }));
    const button = renderToggle(qubitToggles(tree)[0]);
    expect(button.props["aria-checked"]).toBe(false);
    await button.props.onClick({ currentTarget: { id: "qubit-front" } });
    expect(fleetMocks.fleet.setQubitSettings).toHaveBeenCalledWith({ front_desk: true });
  });

  it("a 403 rolls the key back and reports the admin-only message", async () => {
    const base = qubitSettings({ front_desk: false, cloud_agents_first: true });
    const err403 = new Error("forbidden");
    err403.status = 403;
    fleetMocks.fleet.setQubitSettings.mockRejectedValue(err403);
    const tree = renderQubitWith(base);
    await qubitToggles(tree)[0].props.set(true);
    expect(mocks.states[ST]).toEqual(base);
    expect(mocks.states[ERR]).toBe("Only a hub admin can change this.");
    expect(mocks.states[SAVING]).toBe(false);
    expect(mocks.refs[GEN].current).toBe(1);
  });

  it("a non-403 failure rolls back only the failed key and reports the generic message", async () => {
    const base = qubitSettings({ front_desk: false, cloud_agents_first: true });
    const err500 = new Error("boom");
    err500.status = 500;
    fleetMocks.fleet.setQubitSettings.mockRejectedValue(err500);
    const tree = renderQubitWith(base);
    await qubitToggles(tree)[0].props.set(true);
    // front_desk reverts; the untouched cloud_agents_first survives.
    expect(mocks.states[ST]).toEqual({ ...base, front_desk: false });
    expect(mocks.states[ST].cloud_agents_first).toBe(true);
    expect(mocks.states[ERR]).toBe("That didn't save. Try again.");
    expect(mocks.states[SAVING]).toBe(false);
  });

  it("a failure without a status also reports the generic message and rolls back", async () => {
    const base = qubitSettings({ cloud_agents_first: false });
    fleetMocks.fleet.setQubitSettings.mockRejectedValue(new Error("offline"));
    const tree = renderQubitWith(base);
    await qubitToggles(tree)[1].props.set(true);
    expect(mocks.states[ST]).toEqual(base);
    expect(mocks.states[ERR]).toBe("That didn't save. Try again.");
    expect(mocks.states[SAVING]).toBe(false);
  });

  it("each change attempt bumps the generation by exactly one, success or failure", async () => {
    fleetMocks.fleet.setQubitSettings.mockResolvedValue(qubitSettings({ front_desk: true }));
    const tree = renderQubitWith(qubitSettings());
    await qubitToggles(tree)[0].props.set(true);
    expect(mocks.refs[GEN].current).toBe(1);
    fleetMocks.fleet.setQubitSettings.mockRejectedValue(new Error("offline"));
    const again = renderQubitWith(mocks.states[ST]);
    await qubitToggles(again)[0].props.set(false);
    expect(mocks.refs[GEN].current).toBe(2);
  });
});
