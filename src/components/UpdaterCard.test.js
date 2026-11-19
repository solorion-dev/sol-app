import { describe, it, expect, vi, beforeEach } from "vitest";

// UpdaterCard.jsx is the settings card that drives Sol's self-update
// flow on Android: it hides itself entirely off-device, reads the
// installed build once on mount, then walks idle → checking →
// uptodate / available → downloading → ready → (needpermission)
// installing, with a shared busy guard and a single error state fed by
// every handler. Those transitions are decisions worth pinning without
// a phone. Mock `react` with per-slot state (the component keeps six
// useState slots — native, status, installed, remote, progress, error,
// in that order — plus one busy useRef and one mount effect), stub
// ../updater and ./Icon, then drive the component by calling it,
// running the captured effect, and clicking the buttons found in the
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
  return holder;
});

const updater = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  downloadUpdate: vi.fn(),
  getInstalledBuild: vi.fn(),
  getInstallPermission: vi.fn(),
  installUpdate: vi.fn(),
  isNativeApp: vi.fn(),
  openInstallPermissionSettings: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useState: mocks.useState,
    useRef: mocks.useRef,
    useEffect: mocks.useEffect,
  };
});

vi.mock("../updater", () => updater);

vi.mock("./Icon", () => ({
  Icon: () => null,
}));

import { UpdaterCard } from "./UpdaterCard.jsx";

// State slots, in the order the component declares them.
const NATIVE = 0;
const STATUS = 1;
const INSTALLED = 2;
const REMOTE = 3;
const PROGRESS = 4;
const ERROR = 5;

const INSTALLED_BUILD = { versionCode: 10, versionName: "2026.01.10-10" };
const FEED = {
  versionCode: 42,
  versionName: "2026.02.42-42",
  apkUrl: "https://example.invalid/sol.apk",
};

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

// Call the component once, with the hook cursors rewound as React does
// at the start of every render.
function render() {
  mocks.cursor = 0;
  mocks.refCursor = 0;
  return UpdaterCard();
}

// Run the mount effect captured by the most recent render.
function runEffect() {
  return mocks.effect();
}

function bodyOf(tree) {
  return tree[1].props.children;
}

function statusRowOf(body) {
  return Array.isArray(body) ? body[0] : body;
}

function titleOf(body) {
  const row = statusRowOf(body);
  return row.props.children[1].props.children[0].props.children;
}

function noteOf(body) {
  const row = statusRowOf(body);
  return row.props.children[1].props.children[1].props.children;
}

function iconOf(body) {
  const row = statusRowOf(body);
  return row.props.children[0].props.children;
}

function buttonsOf(body) {
  if (!Array.isArray(body)) return [];
  return body.filter((el) => el && el.type === "button");
}

function buttonByLabel(body, label) {
  return buttonsOf(body).find((el) => el.props.children === label);
}

// Mount as a native app whose installed build resolves, and return the
// first real (non-null) render.
async function mountNative() {
  render();
  runEffect();
  await flushPromises();
  return render();
}

// Mount native, then run a successful check that finds FEED available.
async function mountAvailable() {
  const idle = await mountNative();
  updater.checkForUpdate.mockResolvedValue({
    available: true,
    installed: INSTALLED_BUILD,
    feed: FEED,
  });
  await buttonByLabel(bodyOf(idle), "Check for updates").props.onClick();
  return render();
}

// Mount native and walk check → download so the card sits at ready.
async function mountReady() {
  const available = await mountAvailable();
  await buttonByLabel(bodyOf(available), "Download update").props.onClick();
  return render();
}

beforeEach(() => {
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
  for (const fn of Object.values(updater)) fn.mockReset();
  updater.isNativeApp.mockReturnValue(true);
  updater.getInstalledBuild.mockResolvedValue(INSTALLED_BUILD);
  updater.checkForUpdate.mockResolvedValue(undefined);
  updater.downloadUpdate.mockResolvedValue({ path: "/tmp/sol.apk" });
  updater.getInstallPermission.mockResolvedValue(true);
  updater.installUpdate.mockResolvedValue(undefined);
  updater.openInstallPermissionSettings.mockResolvedValue(undefined);
});

describe("UpdaterCard visibility and mount effect", () => {
  it("returns null before the effect runs (native is still null)", () => {
    expect(render()).toBeNull();
    expect(mocks.states[NATIVE]).toBeNull();
  });

  it("registers the mount effect with empty deps", () => {
    render();
    expect(mocks.useEffect).toHaveBeenCalledTimes(1);
    expect(mocks.effectDeps).toEqual([]);
  });

  it("returns null when isNativeApp() is false, before and after the effect", () => {
    updater.isNativeApp.mockReturnValue(false);
    expect(render()).toBeNull();
    runEffect();
    expect(mocks.states[NATIVE]).toBe(false);
    expect(render()).toBeNull();
  });

  it("never reads the installed build when the app is not native", () => {
    updater.isNativeApp.mockReturnValue(false);
    render();
    runEffect();
    expect(updater.isNativeApp).toHaveBeenCalledTimes(1);
    expect(updater.getInstalledBuild).not.toHaveBeenCalled();
  });

  it("marks itself native and stores the installed build the effect resolves", async () => {
    render();
    runEffect();
    expect(mocks.states[NATIVE]).toBe(true);
    expect(updater.getInstalledBuild).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(mocks.states[INSTALLED]).toEqual(INSTALLED_BUILD);
    expect(mocks.states[STATUS]).toBe("idle");
  });

  it("swallows a rejected installed-build read: no error, no throw, still idle", async () => {
    updater.getInstalledBuild.mockRejectedValue(new Error("no app info"));
    render();
    expect(() => runEffect()).not.toThrow();
    await flushPromises();
    expect(mocks.states[INSTALLED]).toBeNull();
    expect(mocks.states[ERROR]).toBe("");
    expect(mocks.states[STATUS]).toBe("idle");
    // The card still renders, stuck on the checking line.
    expect(noteOf(bodyOf(render()))).toBe("Checking installed build…");
  });
});

describe("UpdaterCard idle body and version line", () => {
  it("renders the section heading and card shell around the body", async () => {
    const tree = await mountNative();
    const [heading, card] = tree;
    expect(heading.type).toBe("h3");
    expect(heading.props.className).toBe("section-label");
    expect(heading.props.children).toBe("App updates");
    expect(heading.key).toBe("label");
    expect(card.type).toBe("div");
    expect(card.props.className).toBe("settings-card updater-card");
    expect(card.key).toBe("card");
  });

  it("shows 'Checking installed build…' while the installed build is unknown", () => {
    updater.getInstalledBuild.mockReturnValue(new Promise(() => {}));
    render();
    runEffect();
    const body = bodyOf(render());
    expect(titleOf(body)).toBe("App updates");
    expect(noteOf(body)).toBe("Checking installed build…");
  });

  it("shows 'Installed build <code> · <name>' once the build is known", async () => {
    const body = bodyOf(await mountNative());
    expect(titleOf(body)).toBe("App updates");
    expect(noteOf(body)).toBe("Installed build 10 · 2026.01.10-10");
  });

  it("omits the separator when the installed build has no version name", async () => {
    updater.getInstalledBuild.mockResolvedValue({ versionCode: 7, versionName: "" });
    const body = bodyOf(await mountNative());
    expect(noteOf(body)).toBe("Installed build 7");
  });

  it("omits the separator when versionName is absent entirely", async () => {
    updater.getInstalledBuild.mockResolvedValue({ versionCode: 7 });
    const body = bodyOf(await mountNative());
    expect(noteOf(body)).toBe("Installed build 7");
  });

  it("uses the download icon on the idle status row", async () => {
    const body = bodyOf(await mountNative());
    const icon = iconOf(body);
    expect(icon.props.name).toBe("download");
    expect(icon.props.size).toBe(18);
  });

  it("offers 'Check for updates' with the label as children AND as key", async () => {
    const body = bodyOf(await mountNative());
    const button = buttonByLabel(body, "Check for updates");
    expect(button).toBeDefined();
    expect(button.type).toBe("button");
    // Regression pin for the blank-button bug: the label must ride in
    // props.children (what renders), not only in the element key.
    expect(button.props.children).toBe("Check for updates");
    expect(button.key).toBe("Check for updates");
    expect(button.props.className).toBe("updater-button");
    expect(typeof button.props.onClick).toBe("function");
  });
});

describe("UpdaterCard onCheck", () => {
  it("enters checking while the check is in flight", async () => {
    const idle = await mountNative();
    const pending = deferred();
    updater.checkForUpdate.mockReturnValue(pending.promise);
    const click = buttonByLabel(bodyOf(idle), "Check for updates").props.onClick();
    expect(mocks.states[STATUS]).toBe("checking");
    const body = bodyOf(render());
    expect(titleOf(body)).toBe("Updates");
    expect(noteOf(body)).toBe("Checking for updates…");
    expect(buttonsOf(body)).toEqual([]);
    pending.resolve({ available: false, installed: INSTALLED_BUILD, feed: FEED });
    await click;
  });

  it("lands on available, stores the feed, and names the remote build", async () => {
    const available = await mountAvailable();
    expect(mocks.states[STATUS]).toBe("available");
    expect(mocks.states[REMOTE]).toEqual(FEED);
    expect(mocks.states[INSTALLED]).toEqual(INSTALLED_BUILD);
    const body = bodyOf(available);
    expect(titleOf(body)).toBe("Update available · build 42");
    expect(noteOf(body)).toBe("2026.02.42-42");
    const button = buttonByLabel(body, "Download update");
    expect(button).toBeDefined();
    expect(button.props.children).toBe("Download update");
    expect(button.key).toBe("Download update");
  });

  it("falls back to a generic note when the feed has no version name", async () => {
    const idle = await mountNative();
    const nameless = { versionCode: 43, apkUrl: "https://example.invalid/sol.apk" };
    updater.checkForUpdate.mockResolvedValue({
      available: true,
      installed: INSTALLED_BUILD,
      feed: nameless,
    });
    await buttonByLabel(bodyOf(idle), "Check for updates").props.onClick();
    const body = bodyOf(render());
    expect(titleOf(body)).toBe("Update available · build 43");
    expect(noteOf(body)).toBe("A new experimental build is ready");
  });

  it("lands on uptodate when nothing newer is available, reusing the version line", async () => {
    const idle = await mountNative();
    updater.checkForUpdate.mockResolvedValue({
      available: false,
      installed: { versionCode: 42, versionName: "2026.02.42-42" },
      feed: FEED,
    });
    await buttonByLabel(bodyOf(idle), "Check for updates").props.onClick();
    expect(mocks.states[STATUS]).toBe("uptodate");
    const body = bodyOf(render());
    expect(titleOf(body)).toBe("Up to date");
    expect(noteOf(body)).toBe("Installed build 42 · 2026.02.42-42");
    expect(buttonsOf(body)).toEqual([]);
  });

  it("shows the uptodate version line without a separator when the name is empty", async () => {
    const idle = await mountNative();
    updater.checkForUpdate.mockResolvedValue({
      available: false,
      installed: { versionCode: 42, versionName: "" },
      feed: FEED,
    });
    await buttonByLabel(bodyOf(idle), "Check for updates").props.onClick();
    expect(noteOf(bodyOf(render()))).toBe("Installed build 42");
  });

  it("turns a rejected check into the error state with the Error's message", async () => {
    const idle = await mountNative();
    updater.checkForUpdate.mockRejectedValue(new Error("Update feed unavailable (HTTP 503)"));
    await buttonByLabel(bodyOf(idle), "Check for updates").props.onClick();
    expect(mocks.states[STATUS]).toBe("error");
    expect(mocks.states[ERROR]).toBe("Update feed unavailable (HTTP 503)");
  });

  it("turns a non-Error rejection into 'Something went wrong'", async () => {
    const idle = await mountNative();
    updater.checkForUpdate.mockRejectedValue("socket gone");
    await buttonByLabel(bodyOf(idle), "Check for updates").props.onClick();
    expect(mocks.states[STATUS]).toBe("error");
    expect(mocks.states[ERROR]).toBe("Something went wrong");
  });

  it("turns a null rejection into 'Something went wrong'", async () => {
    const idle = await mountNative();
    updater.checkForUpdate.mockRejectedValue(null);
    await buttonByLabel(bodyOf(idle), "Check for updates").props.onClick();
    expect(mocks.states[STATUS]).toBe("error");
    expect(mocks.states[ERROR]).toBe("Something went wrong");
  });
});

describe("UpdaterCard busy guard", () => {
  it("ignores a second handler invocation while a check is in flight", async () => {
    const idle = await mountNative();
    const pending = deferred();
    updater.checkForUpdate.mockReturnValue(pending.promise);
    const onCheck = buttonByLabel(bodyOf(idle), "Check for updates").props.onClick;
    const first = onCheck();
    expect(mocks.states[STATUS]).toBe("checking");
    const setterCalls = () =>
      mocks.setters.reduce((total, setter) => total + setter.mock.calls.length, 0);
    const callsBefore = setterCalls();
    await onCheck();
    expect(updater.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(setterCalls()).toBe(callsBefore);
    expect(mocks.states[STATUS]).toBe("checking");
    expect(mocks.states[ERROR]).toBe("");
    pending.resolve({ available: false, installed: INSTALLED_BUILD, feed: FEED });
    await first;
    expect(mocks.states[STATUS]).toBe("uptodate");
  });

  it("releases the guard after a run completes, so a later check runs", async () => {
    const idle = await mountNative();
    const onCheck = buttonByLabel(bodyOf(idle), "Check for updates").props.onClick;
    updater.checkForUpdate.mockResolvedValue({
      available: false,
      installed: INSTALLED_BUILD,
      feed: FEED,
    });
    await onCheck();
    expect(mocks.states[STATUS]).toBe("uptodate");
    await onCheck();
    expect(updater.checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it("releases the guard after an error, so Try again can run", async () => {
    const idle = await mountNative();
    updater.checkForUpdate.mockRejectedValue(new Error("offline"));
    await buttonByLabel(bodyOf(idle), "Check for updates").props.onClick();
    expect(mocks.states[STATUS]).toBe("error");
    updater.checkForUpdate.mockResolvedValue({
      available: false,
      installed: INSTALLED_BUILD,
      feed: FEED,
    });
    const errorBody = bodyOf(render());
    await buttonByLabel(errorBody, "Try again").props.onClick();
    expect(updater.checkForUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.states[STATUS]).toBe("uptodate");
  });
});

describe("UpdaterCard onDownload and progress", () => {
  it("downloads the stored feed and lands on ready offering Install update", async () => {
    const available = await mountAvailable();
    await buttonByLabel(bodyOf(available), "Download update").props.onClick();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate.mock.calls[0][0]).toEqual(FEED);
    expect(typeof updater.downloadUpdate.mock.calls[0][1]).toBe("function");
    expect(mocks.states[STATUS]).toBe("ready");
    const body = bodyOf(render());
    expect(titleOf(body)).toBe("Ready to install");
    expect(noteOf(body)).toBe("Build 42 downloaded");
    const button = buttonByLabel(body, "Install update");
    expect(button).toBeDefined();
    expect(button.props.children).toBe("Install update");
    expect(button.key).toBe("Install update");
  });

  it("clamps progress callbacks into 0–100 and defaults missing progress to 0", async () => {
    const available = await mountAvailable();
    const pending = deferred();
    let onProgress;
    updater.downloadUpdate.mockImplementation((feed, callback) => {
      onProgress = callback;
      return pending.promise;
    });
    const click = buttonByLabel(bodyOf(available), "Download update").props.onClick();
    expect(mocks.states[STATUS]).toBe("downloading");
    expect(mocks.states[PROGRESS]).toBe(0);
    onProgress({ progress: -5 });
    expect(mocks.states[PROGRESS]).toBe(0);
    onProgress({ progress: 140 });
    expect(mocks.states[PROGRESS]).toBe(100);
    onProgress({});
    expect(mocks.states[PROGRESS]).toBe(0);
    onProgress({ progress: 55 });
    expect(mocks.states[PROGRESS]).toBe(55);
    pending.resolve({ path: "/tmp/sol.apk" });
    await click;
    expect(mocks.states[STATUS]).toBe("ready");
  });

  it("renders a progressbar matching the progress while downloading", async () => {
    const available = await mountAvailable();
    const pending = deferred();
    let onProgress;
    updater.downloadUpdate.mockImplementation((feed, callback) => {
      onProgress = callback;
      return pending.promise;
    });
    const click = buttonByLabel(bodyOf(available), "Download update").props.onClick();
    onProgress({ progress: 55 });
    const body = bodyOf(render());
    expect(titleOf(body)).toBe("Downloading… 55%");
    expect(noteOf(body)).toBe("Build 42 · 2026.02.42-42");
    const bar = body.find((el) => el && el.props && el.props.role === "progressbar");
    expect(bar).toBeDefined();
    expect(bar.type).toBe("div");
    expect(bar.props.className).toBe("updater-progress");
    expect(bar.key).toBe("progress");
    expect(bar.props["aria-valuenow"]).toBe(55);
    expect(bar.props["aria-valuemin"]).toBe(0);
    expect(bar.props["aria-valuemax"]).toBe(100);
    const inner = bar.props.children;
    expect(inner.type).toBe("u");
    expect(inner.props.style).toEqual({ width: "55%" });
    pending.resolve({ path: "/tmp/sol.apk" });
    await click;
  });

  it("turns a rejected download into the error state with its message", async () => {
    const available = await mountAvailable();
    updater.downloadUpdate.mockRejectedValue(new Error("Update feed has no APK URL"));
    await buttonByLabel(bodyOf(available), "Download update").props.onClick();
    expect(mocks.states[STATUS]).toBe("error");
    expect(mocks.states[ERROR]).toBe("Update feed has no APK URL");
  });
});

describe("UpdaterCard onInstall and permission flow", () => {
  it("asks for permission instead of installing when installs are not granted", async () => {
    const ready = await mountReady();
    updater.getInstallPermission.mockResolvedValue(false);
    await buttonByLabel(bodyOf(ready), "Install update").props.onClick();
    expect(updater.getInstallPermission).toHaveBeenCalledTimes(1);
    expect(updater.installUpdate).not.toHaveBeenCalled();
    expect(mocks.states[STATUS]).toBe("needpermission");
  });

  it("shows Permission needed with Allow installs and a secondary Install update", async () => {
    const ready = await mountReady();
    updater.getInstallPermission.mockResolvedValue(false);
    await buttonByLabel(bodyOf(ready), "Install update").props.onClick();
    const body = bodyOf(render());
    expect(titleOf(body)).toBe("Permission needed");
    expect(noteOf(body)).toBe("Android asks once per app: allow Sol to install updates");
    const allow = buttonByLabel(body, "Allow installs");
    expect(allow).toBeDefined();
    expect(allow.props.children).toBe("Allow installs");
    expect(allow.key).toBe("Allow installs");
    expect(allow.props.className).toBe("updater-button");
    const install = buttonByLabel(body, "Install update");
    expect(install).toBeDefined();
    expect(install.props.className).toContain("secondary");
    expect(install.props.className).toBe("updater-button secondary");
  });

  it("goes installing while the installer opens, then settles back on ready", async () => {
    const ready = await mountReady();
    const pending = deferred();
    updater.installUpdate.mockReturnValue(pending.promise);
    const click = buttonByLabel(bodyOf(ready), "Install update").props.onClick();
    await flushPromises();
    expect(updater.installUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.states[STATUS]).toBe("installing");
    const body = bodyOf(render());
    expect(titleOf(body)).toBe("Opening installer…");
    expect(noteOf(body)).toBe("Confirm the install to finish");
    pending.resolve();
    await click;
    expect(mocks.states[STATUS]).toBe("ready");
    expect(titleOf(bodyOf(render()))).toBe("Ready to install");
  });

  it("retries the install from the needpermission body once permission is granted", async () => {
    const ready = await mountReady();
    updater.getInstallPermission.mockResolvedValue(false);
    await buttonByLabel(bodyOf(ready), "Install update").props.onClick();
    expect(mocks.states[STATUS]).toBe("needpermission");
    updater.getInstallPermission.mockResolvedValue(true);
    const body = bodyOf(render());
    await buttonByLabel(body, "Install update").props.onClick();
    expect(updater.installUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.states[STATUS]).toBe("ready");
  });
});

describe("UpdaterCard onAllowInstalls", () => {
  it("opens the permission settings and leaves the status unchanged", async () => {
    const ready = await mountReady();
    updater.getInstallPermission.mockResolvedValue(false);
    await buttonByLabel(bodyOf(ready), "Install update").props.onClick();
    expect(mocks.states[STATUS]).toBe("needpermission");
    const body = bodyOf(render());
    await buttonByLabel(body, "Allow installs").props.onClick();
    expect(updater.openInstallPermissionSettings).toHaveBeenCalledTimes(1);
    expect(mocks.states[STATUS]).toBe("needpermission");
    expect(titleOf(bodyOf(render()))).toBe("Permission needed");
  });
});

describe("UpdaterCard error body", () => {
  async function mountError(message = "Update feed unavailable (HTTP 503)") {
    const idle = await mountNative();
    updater.checkForUpdate.mockRejectedValue(new Error(message));
    await buttonByLabel(bodyOf(idle), "Check for updates").props.onClick();
    return render();
  }

  it("titles the failure, shows the error text as the note, and uses the x icon", async () => {
    const body = bodyOf(await mountError());
    expect(titleOf(body)).toBe("Couldn't check for updates");
    expect(noteOf(body)).toBe("Update feed unavailable (HTTP 503)");
    expect(iconOf(body).props.name).toBe("x");
  });

  it("offers Try again as a secondary button whose label is children and key", async () => {
    const body = bodyOf(await mountError());
    const button = buttonByLabel(body, "Try again");
    expect(button).toBeDefined();
    expect(button.props.children).toBe("Try again");
    expect(button.key).toBe("Try again");
    expect(button.props.className).toContain("secondary");
    expect(button.props.className).toBe("updater-button secondary");
  });

  it("wires Try again to onCheck: clicking re-runs the check and clears the error", async () => {
    const errorTree = await mountError();
    updater.checkForUpdate.mockResolvedValue({
      available: true,
      installed: INSTALLED_BUILD,
      feed: FEED,
    });
    await buttonByLabel(bodyOf(errorTree), "Try again").props.onClick();
    expect(updater.checkForUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.states[ERROR]).toBe("");
    expect(mocks.states[STATUS]).toBe("available");
    expect(titleOf(bodyOf(render()))).toBe("Update available · build 42");
  });
});
