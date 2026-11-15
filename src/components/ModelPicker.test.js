import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ModelPicker.jsx is where Sol chooses which local model a chat talks
// to. Two pieces of it carry decisions worth pinning without rendering
// the sheet: laneLabel, which turns a gateway lane + device into the
// plain words shown beside a model, and useLocalModels, which loads
// GET {gatewayBase}/models — but only while the picker is open — and
// sorts whatever answers into done, a gateway error, or "that was not
// the gateway at all". Mock `react` to capture state and the effect,
// stub Icon and Overlays so the module loads in isolation, then drive
// the captured effect by hand against a stubbed fetch — no DOM or
// testing-library needed.
const mocks = vi.hoisted(() => {
  const holder = {
    state: undefined,
    setState: null,
    useState: null,
    useEffect: null,
  };
  holder.setState = vi.fn((update) => {
    holder.state = typeof update === "function" ? update(holder.state) : update;
  });
  holder.useState = vi.fn((initial) => {
    if (holder.state === undefined) holder.state = initial;
    return [holder.state, holder.setState];
  });
  holder.useEffect = vi.fn();
  return holder;
});

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useState: mocks.useState,
    useEffect: mocks.useEffect,
  };
});

vi.mock("./Icon", () => ({
  Icon: () => null,
}));

vi.mock("./Overlays", () => ({
  Dialog: () => null,
}));

import { laneLabel, useLocalModels } from "./ModelPicker.jsx";

let fetchMock;

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

function gatewayResponse({ ok = true, status = 200, data = undefined, jsonError = null } = {}) {
  return {
    ok,
    status,
    json: jsonError
      ? vi.fn(async () => {
          throw jsonError;
        })
      : vi.fn(async () => data),
  };
}

// Call the hook once and pull out the effect registered by that call.
function callHook(...args) {
  const callIndex = mocks.useEffect.mock.calls.length;
  const returned = useLocalModels(...args);
  const call = mocks.useEffect.mock.calls[callIndex];
  return { returned, effect: call && call[0], deps: call && call[1] };
}

// Call the hook and run its effect, as React would on mount.
function runEffect(...args) {
  const { returned, effect, deps } = callHook(...args);
  const cleanup = effect();
  return { returned, effect, deps, cleanup };
}

beforeEach(() => {
  mocks.state = undefined;
  mocks.useState.mockClear();
  mocks.useEffect.mockClear();
  mocks.setState.mockClear();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("laneLabel empty input", () => {
  it("returns an empty string for null", () => {
    expect(laneLabel(null)).toBe("");
  });

  it("returns an empty string for undefined", () => {
    expect(laneLabel(undefined)).toBe("");
  });

  it("returns an empty string when neither lane nor device is present", () => {
    expect(laneLabel({})).toBe("");
    expect(laneLabel({ lane: "", device: "" })).toBe("");
    expect(laneLabel({ lane: undefined, device: undefined })).toBe("");
  });
});

describe("laneLabel lane names", () => {
  it("maps fast to Fast", () => {
    expect(laneLabel({ lane: "fast" })).toBe("Fast");
  });

  it("maps balanced to Balanced", () => {
    expect(laneLabel({ lane: "balanced" })).toBe("Balanced");
  });

  it("maps deep to Deep", () => {
    expect(laneLabel({ lane: "deep" })).toBe("Deep");
  });

  it("maps cpu to Backup", () => {
    expect(laneLabel({ lane: "cpu" })).toBe("Backup");
  });

  it("maps agent to Agent", () => {
    expect(laneLabel({ lane: "agent" })).toBe("Agent");
  });

  it("passes an unknown lane through raw", () => {
    expect(laneLabel({ lane: "turbo" })).toBe("turbo");
  });
});

describe("laneLabel joining lane and device", () => {
  it("joins a known lane and a device with a separator", () => {
    expect(laneLabel({ lane: "fast", device: "GPU 0" })).toBe("Fast · GPU 0");
  });

  it("joins an unknown lane and a device with a separator", () => {
    expect(laneLabel({ lane: "turbo", device: "GPU 1" })).toBe("turbo · GPU 1");
  });

  it("shows the device alone when there is no lane", () => {
    expect(laneLabel({ device: "GPU 0" })).toBe("GPU 0");
    expect(laneLabel({ lane: "", device: "GPU 0" })).toBe("GPU 0");
  });

  it("shows the lane alone when there is no device", () => {
    expect(laneLabel({ lane: "deep", device: "" })).toBe("Deep");
    expect(laneLabel({ lane: "deep", device: undefined })).toBe("Deep");
  });
});

describe("useLocalModels initial state and effect registration", () => {
  it("starts idle with no models", () => {
    const { returned } = callHook("http://gateway", true);
    expect(returned).toEqual({ phase: "idle", models: [] });
    expect(mocks.useState).toHaveBeenCalledWith({ phase: "idle", models: [] });
  });

  it("registers the effect with gatewayBase, open and nonce as deps", () => {
    const { deps } = callHook("http://gateway", true, 3);
    expect(deps).toEqual(["http://gateway", true, 3]);
  });

  it("defaults nonce to 0 when it is omitted", () => {
    const { deps } = callHook("http://gateway", true);
    expect(deps).toEqual(["http://gateway", true, 0]);
  });
});

describe("useLocalModels gating", () => {
  it("never fetches and returns no cleanup when gatewayBase is empty", () => {
    const { cleanup } = runEffect("", true);
    expect(cleanup).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.setState).not.toHaveBeenCalled();
  });

  it("never fetches and returns no cleanup when gatewayBase is null", () => {
    const { cleanup } = runEffect(null, true);
    expect(cleanup).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.setState).not.toHaveBeenCalled();
  });

  it("never fetches and returns no cleanup when the picker is closed", () => {
    const { cleanup } = runEffect("http://gateway", false);
    expect(cleanup).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.setState).not.toHaveBeenCalled();
  });

  it("never fetches when open is undefined", () => {
    const { cleanup } = runEffect("http://gateway", undefined);
    expect(cleanup).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.setState).not.toHaveBeenCalled();
  });
});

describe("useLocalModels loading", () => {
  it("fetches {gatewayBase}/models with no-store and enters loading", () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { cleanup } = runEffect("http://gateway", true);
    expect(typeof cleanup).toBe("function");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://gateway/models", { cache: "no-store" });
    expect(mocks.state).toEqual({ phase: "loading", models: [] });
  });

  it("applies loading as a functional update that preserves existing models", () => {
    const existing = [{ id: "kept" }];
    mocks.state = { phase: "done", models: existing };
    fetchMock.mockReturnValue(new Promise(() => {}));
    runEffect("http://gateway", true);
    expect(mocks.setState).toHaveBeenCalledTimes(1);
    const update = mocks.setState.mock.calls[0][0];
    expect(typeof update).toBe("function");
    expect(mocks.state).toEqual({ phase: "loading", models: existing });
  });
});

describe("useLocalModels success", () => {
  it("stores the models and finishes done when the gateway answers with an array", async () => {
    const models = [
      { id: "a", lane: "fast", device: "GPU 0", up: true },
      { id: "b", lane: "cpu", device: "CPU", up: false },
    ];
    fetchMock.mockResolvedValue(gatewayResponse({ data: { models } }));
    runEffect("http://gateway", true);
    expect(mocks.state.phase).toBe("loading");
    await flushPromises();
    expect(mocks.state).toEqual({ phase: "done", models });
    // A fresh call to the hook hands back that same settled state.
    expect(callHook("http://gateway", true).returned).toEqual({ phase: "done", models });
  });

  it("finishes done with an empty list when the gateway returns no models", async () => {
    fetchMock.mockResolvedValue(gatewayResponse({ data: { models: [] } }));
    runEffect("http://gateway", true);
    await flushPromises();
    expect(mocks.state).toEqual({ phase: "done", models: [] });
  });
});

describe("useLocalModels gateway errors", () => {
  it("reports the status when the gateway answers not-ok", async () => {
    fetchMock.mockResolvedValue(gatewayResponse({ ok: false, status: 500, data: { models: [] } }));
    runEffect("http://gateway", true);
    await flushPromises();
    expect(mocks.state).toEqual({ phase: "error", models: [], error: "The gateway said 500." });
  });

  it("interpolates the actual status in the not-ok error", async () => {
    fetchMock.mockResolvedValue(gatewayResponse({ ok: false, status: 404, data: null }));
    runEffect("http://gateway", true);
    await flushPromises();
    expect(mocks.state).toEqual({ phase: "error", models: [], error: "The gateway said 404." });
  });

  it("still reports the status when a not-ok answer carries a valid models array", async () => {
    fetchMock.mockResolvedValue(
      gatewayResponse({ ok: false, status: 502, data: { models: [{ id: "a" }] } }),
    );
    runEffect("http://gateway", true);
    await flushPromises();
    expect(mocks.state).toEqual({ phase: "error", models: [], error: "The gateway said 502." });
  });

  it("still reports the status when a not-ok answer is not JSON at all", async () => {
    fetchMock.mockResolvedValue(
      gatewayResponse({ ok: false, status: 503, jsonError: new Error("bad json") }),
    );
    runEffect("http://gateway", true);
    await flushPromises();
    expect(mocks.state).toEqual({ phase: "error", models: [], error: "The gateway said 503." });
  });
});

describe("useLocalModels not-the-gateway answers", () => {
  it("rejects an ok answer whose JSON has no models", async () => {
    fetchMock.mockResolvedValue(gatewayResponse({ data: {} }));
    runEffect("http://gateway", true);
    await flushPromises();
    expect(mocks.state).toEqual({
      phase: "error",
      models: [],
      error: "Something answered, but it isn't the Sol gateway.",
    });
  });

  it("rejects an ok answer whose models is not an array", async () => {
    for (const models of ["a,b", { id: "a" }, null, 42]) {
      mocks.state = undefined;
      mocks.setState.mockClear();
      fetchMock.mockResolvedValue(gatewayResponse({ data: { models } }));
      runEffect("http://gateway", true);
      await flushPromises();
      expect(mocks.state).toEqual({
        phase: "error",
        models: [],
        error: "Something answered, but it isn't the Sol gateway.",
      });
    }
  });

  it("rejects an ok answer whose JSON is null", async () => {
    fetchMock.mockResolvedValue(gatewayResponse({ data: null }));
    runEffect("http://gateway", true);
    await flushPromises();
    expect(mocks.state).toEqual({
      phase: "error",
      models: [],
      error: "Something answered, but it isn't the Sol gateway.",
    });
  });

  it("rejects an ok answer whose body cannot be parsed as JSON", async () => {
    fetchMock.mockResolvedValue(gatewayResponse({ jsonError: new Error("unexpected token") }));
    runEffect("http://gateway", true);
    await flushPromises();
    expect(mocks.state).toEqual({
      phase: "error",
      models: [],
      error: "Something answered, but it isn't the Sol gateway.",
    });
  });
});

describe("useLocalModels fetch failure", () => {
  it("surfaces a rejected fetch's message as the error", async () => {
    fetchMock.mockRejectedValue(new Error("gateway unreachable"));
    runEffect("http://gateway", true);
    await flushPromises();
    expect(mocks.state).toEqual({ phase: "error", models: [], error: "gateway unreachable" });
  });

  it("stringifies a rejection that is not an Error", async () => {
    fetchMock.mockRejectedValue("socket gone");
    runEffect("http://gateway", true);
    await flushPromises();
    expect(mocks.state).toEqual({ phase: "error", models: [], error: "socket gone" });
  });
});

describe("useLocalModels cleanup", () => {
  it("ignores a successful answer that arrives after cleanup", async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const { cleanup } = runEffect("http://gateway", true);
    expect(mocks.setState).toHaveBeenCalledTimes(1);
    expect(mocks.state.phase).toBe("loading");
    cleanup();
    pending.resolve(gatewayResponse({ data: { models: [{ id: "late" }] } }));
    await flushPromises();
    expect(mocks.setState).toHaveBeenCalledTimes(1);
    expect(mocks.state).toEqual({ phase: "loading", models: [] });
  });

  it("ignores a rejection that arrives after cleanup", async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const { cleanup } = runEffect("http://gateway", true);
    cleanup();
    pending.reject(new Error("too late"));
    await flushPromises();
    expect(mocks.setState).toHaveBeenCalledTimes(1);
    expect(mocks.state).toEqual({ phase: "loading", models: [] });
  });

  it("ignores a not-the-gateway answer that arrives after cleanup", async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const { cleanup } = runEffect("http://gateway", true);
    cleanup();
    pending.resolve(gatewayResponse({ data: {} }));
    await flushPromises();
    expect(mocks.setState).toHaveBeenCalledTimes(1);
    expect(mocks.state).toEqual({ phase: "loading", models: [] });
  });
});
