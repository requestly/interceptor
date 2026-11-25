import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { returnFocusToSender } from "../../src/service-worker/services/networkRecording/returnFocus";

const FALLBACK = "https://lts.example/fallback";

interface FakeBrowser {
  tabs: Map<number, number>;
  windows: Set<number>;
  calls: string[];
}

const fakeChrome = (browser: FakeBrowser) => ({
  tabs: {
    get: async (tabId: number) => {
      if (!browser.tabs.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
      return { id: tabId, windowId: browser.tabs.get(tabId) };
    },
    update: async (tabId: number, props: { active: boolean }) => {
      browser.calls.push(`tabs.update ${tabId} active=${props.active}`);
      if (!browser.tabs.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
      return { id: tabId, windowId: browser.tabs.get(tabId) };
    },
    create: async (props: { url: string }) => {
      browser.calls.push(`tabs.create ${props.url}`);
      return {};
    },
  },
  windows: {
    update: async (windowId: number, props: { focused: boolean }) => {
      browser.calls.push(`windows.update ${windowId} focused=${props.focused}`);
      if (!browser.windows.has(windowId)) throw new Error(`No window with id: ${windowId}`);
      return { id: windowId };
    },
  },
});

const run = async (
  browser: Omit<FakeBrowser, "calls">,
  target: { senderTabId?: number; senderWindowId?: number }
): Promise<string[]> => {
  const state: FakeBrowser = { ...browser, calls: [] };
  (globalThis as unknown as { chrome: unknown }).chrome = fakeChrome(state);
  returnFocusToSender({ ...target, fallbackUrl: FALLBACK });
  await new Promise((resolve) => setImmediate(resolve));
  return state.calls;
};

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe("returnFocusToSender", () => {
  it("selects the caller's tab and brings its window to the front", async () => {
    const calls = await run(
      { tabs: new Map([[10, 1]]), windows: new Set([1, 2]) },
      { senderTabId: 10, senderWindowId: 1 }
    );
    assert.deepEqual(calls, ["tabs.update 10 active=true", "windows.update 1 focused=true"]);
  });

  it("focuses the window the caller's tab is in now, if it was moved", async () => {
    const calls = await run(
      { tabs: new Map([[10, 2]]), windows: new Set([1, 2]) },
      { senderTabId: 10, senderWindowId: 1 }
    );
    assert.deepEqual(calls, ["tabs.update 10 active=true", "windows.update 2 focused=true"]);
  });

  it("focuses the caller's window when its tab is gone", async () => {
    const calls = await run({ tabs: new Map(), windows: new Set([1]) }, { senderTabId: 10, senderWindowId: 1 });
    assert.deepEqual(calls, ["windows.update 1 focused=true"]);
  });

  it("opens the fallback when the caller's tab and window are both gone", async () => {
    const calls = await run({ tabs: new Map(), windows: new Set() }, { senderTabId: 10, senderWindowId: 1 });
    assert.deepEqual(calls, ["windows.update 1 focused=true", `tabs.create ${FALLBACK}`]);
  });

  it("falls back the same way when the tab's window cannot be focused", async () => {
    const calls = await run({ tabs: new Map([[10, 3]]), windows: new Set() }, { senderTabId: 10, senderWindowId: 1 });
    assert.deepEqual(calls, [
      "tabs.update 10 active=true",
      "windows.update 3 focused=true",
      "windows.update 1 focused=true",
      `tabs.create ${FALLBACK}`,
    ]);
  });

  it("goes straight to the window, or the fallback, when no caller tab was recorded", async () => {
    assert.deepEqual(await run({ tabs: new Map(), windows: new Set([1]) }, { senderWindowId: 1 }), [
      "windows.update 1 focused=true",
    ]);
    assert.deepEqual(await run({ tabs: new Map(), windows: new Set() }, {}), [`tabs.create ${FALLBACK}`]);
  });
});
