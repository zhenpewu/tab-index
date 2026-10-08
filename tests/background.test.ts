import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/domain/settings";
import {
  createBackgroundHandlers,
  registerBackground,
} from "../src/background/index";
import type { BackgroundBrowser } from "../src/background/index";
import {
  POPUP_MODE_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from "../src/shared/messages";

const LAST_NORMAL_WINDOW_ID_STORAGE_KEY = "lastNormalWindowId";

type Listener = (...args: unknown[]) => unknown;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function fakeEvent() {
  const listeners: Listener[] = [];

  return {
    listeners,
    addListener(listener: Listener) {
      listeners.push(listener);
    },
    emit(...args: unknown[]) {
      return listeners.map((listener) => listener(...args));
    },
  };
}

function firefoxTab(
  id: number | undefined,
  windowId: number | undefined,
  overrides: Partial<browser.tabs.Tab> = {},
): browser.tabs.Tab {
  return {
    id,
    index: 0,
    windowId,
    highlighted: false,
    active: false,
    pinned: false,
    incognito: false,
    url: id === undefined ? undefined : `https://example.com/${id}`,
    title: id === undefined ? undefined : `Tab ${id}`,
    lastAccessed: id ?? 0,
    status: "complete",
    ...overrides,
  };
}

function makeFakeBrowser(initialTabs: browser.tabs.Tab[] = []) {
  const runtimeOnMessage = fakeEvent();
  const commandsOnCommand = fakeEvent();
  const tabsOnCreated = fakeEvent();
  const tabsOnUpdated = fakeEvent();
  const tabsOnRemoved = fakeEvent();
  const tabsOnActivated = fakeEvent();
  const tabsOnAttached = fakeEvent();
  const tabsOnDetached = fakeEvent();
  const windowsOnCreated = fakeEvent();
  const windowsOnRemoved = fakeEvent();
  const windowsOnFocusChanged = fakeEvent();

  const state = {
    tabs: initialTabs.map((tab) => ({ ...tab })),
    lastFocusedWindow: { id: 1, type: "normal" },
    lastWindowGetInfo: undefined as
      | browser.windows.GetInfo
      | undefined,
    lastWindowGetAllInfo: undefined as
      | browser.windows._GetAllGetInfo
      | undefined,
    windowGetAllCount: 0,
    windows: [
      { id: 1, type: "normal", focused: true },
    ] as Array<{ id: number; type: string; focused: boolean }>,
    focusedWindowId: 1,
    windowUpdateError: undefined as Error | undefined,
    local: {} as Record<string, unknown>,
    session: {} as Record<string, unknown>,
    sessionWriteGates: [] as ReturnType<typeof deferred<void>>[],
    popupOpenError: undefined as Error | undefined,
    popupOpenPromises: [] as Promise<boolean>[],
    popupOpenCount: 0,
    optionsOpenCount: 0,
    lastTabQuery: undefined as Record<string, unknown> | undefined,
    removeErrors: new Map<number, Error>(),
  };

  function storageArea(
    data: Record<string, unknown>,
    writeGates: ReturnType<typeof deferred<void>>[] = [],
  ) {
    return {
      async get(key: string) {
        return key in data ? { [key]: data[key] } : {};
      },
      async set(values: Record<string, unknown>) {
        const gate = writeGates.shift();
        if (gate) {
          await gate.promise;
        }
        Object.assign(data, values);
      },
      async remove(key: string) {
        delete data[key];
      },
    };
  }

  const api = {
    tabs: {
      async query(queryInfo: Record<string, unknown>) {
        state.lastTabQuery = queryInfo;
        return state.tabs.map((tab) => ({ ...tab }));
      },
      async update(tabId: number, updateInfo: { active?: boolean }) {
        const tab = state.tabs.find(({ id }) => id === tabId);
        if (!tab) {
          throw new Error(`No tab with id: ${tabId}`);
        }
        if (updateInfo.active) {
          for (const candidate of state.tabs) {
            if (candidate.windowId === tab.windowId) {
              candidate.active = candidate.id === tabId;
            }
          }
        }
        Object.assign(tab, updateInfo);
        return { ...tab };
      },
      async remove(tabIds: number | number[]) {
        for (const tabId of Array.isArray(tabIds) ? tabIds : [tabIds]) {
          const configuredError = state.removeErrors.get(tabId);
          if (configuredError) {
            throw configuredError;
          }
          const index = state.tabs.findIndex(({ id }) => id === tabId);
          if (index === -1) {
            throw new Error(`Invalid tab ID: ${tabId}`);
          }
          state.tabs.splice(index, 1);
        }
      },
      onCreated: tabsOnCreated,
      onUpdated: tabsOnUpdated,
      onRemoved: tabsOnRemoved,
      onActivated: tabsOnActivated,
      onAttached: tabsOnAttached,
      onDetached: tabsOnDetached,
    },
    windows: {
      async getLastFocused(getInfo?: browser.windows.GetInfo) {
        state.lastWindowGetInfo = getInfo;
        return { ...state.lastFocusedWindow };
      },
      async get(windowId: number) {
        const window = state.windows.find(({ id }) => id === windowId);
        if (!window) {
          throw new Error(`No window with id: ${windowId}`);
        }
        return { ...window };
      },
      async getAll(getInfo?: browser.windows._GetAllGetInfo) {
        state.windowGetAllCount += 1;
        state.lastWindowGetAllInfo = getInfo;
        return state.windows.map((window) => ({ ...window }));
      },
      async update(windowId: number, updateInfo: { focused?: boolean }) {
        if (state.windowUpdateError) {
          throw state.windowUpdateError;
        }
        if (updateInfo.focused) {
          state.focusedWindowId = windowId;
          for (const window of state.windows) {
            window.focused = window.id === windowId;
          }
        }
        return { id: windowId, focused: Boolean(updateInfo.focused) };
      },
      onCreated: windowsOnCreated,
      onRemoved: windowsOnRemoved,
      onFocusChanged: windowsOnFocusChanged,
    },
    storage: {
      local: storageArea(state.local),
      session: storageArea(state.session, state.sessionWriteGates),
    },
    action: {
      async openPopup() {
        state.popupOpenCount += 1;
        const configuredPromise = state.popupOpenPromises.shift();
        if (configuredPromise) {
          return configuredPromise;
        }
        if (state.popupOpenError) {
          throw state.popupOpenError;
        }
        return true;
      },
    },
    runtime: {
      onMessage: runtimeOnMessage,
      async openOptionsPage() {
        state.optionsOpenCount += 1;
      },
    },
    commands: {
      onCommand: commandsOnCommand,
    },
  };

  return {
    api: api as unknown as BackgroundBrowser,
    state,
    events: {
      runtimeOnMessage,
      commandsOnCommand,
      tabsOnCreated,
      tabsOnUpdated,
      tabsOnRemoved,
      tabsOnActivated,
      tabsOnAttached,
      tabsOnDetached,
      windowsOnCreated,
      windowsOnRemoved,
      windowsOnFocusChanged,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createBackgroundHandlers", () => {
  it("returns fresh normal-tab snapshots with exactly one current window", async () => {
    const fake = makeFakeBrowser([
      firefoxTab(1, 1, { active: true, lastAccessed: 900 }),
      firefoxTab(2, 2, { active: true, lastAccessed: 400 }),
      firefoxTab(3, 2, { lastAccessed: 300 }),
      firefoxTab(undefined, 2),
    ]);
    fake.state.lastFocusedWindow = { id: 99, type: "popup" };
    fake.state.windows = [
      { id: 1, type: "normal", focused: false },
      { id: 2, type: "normal", focused: true },
      { id: 99, type: "popup", focused: false },
    ];
    const handlers = createBackgroundHandlers(fake.api);

    const first = await handlers.handleMessage({ type: "getSnapshot" });

    expect(first).toMatchObject({
      ok: true,
      data: {
        currentWindowId: 2,
      },
    });
    if (!first.ok) {
      throw new Error("Expected a successful snapshot");
    }
    expect(fake.state.lastTabQuery).toEqual({ windowType: "normal" });
    expect(fake.state.lastWindowGetInfo).toBeUndefined();
    expect(fake.state.lastWindowGetAllInfo).toBeUndefined();
    expect(fake.state.windowGetAllCount).toBe(1);
    expect(first.data).not.toHaveProperty("revision");
    expect(first.data.tabs.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(
      [...new Set(
        first.data.tabs
          .filter(({ currentWindow }) => currentWindow)
          .map(({ windowId }) => windowId),
      )],
    ).toEqual([2]);

    fake.state.tabs.push(firefoxTab(4, 1));
    const second = await handlers.handleMessage({ type: "getSnapshot" });

    expect(second.ok && second.data.tabs.map(({ id }) => id)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("falls back to the most recently accessed normal-tab window deterministically", async () => {
    const fake = makeFakeBrowser([
      firefoxTab(1, 3, { lastAccessed: 200 }),
      firefoxTab(2, 2, { lastAccessed: 200 }),
      firefoxTab(3, 1, { lastAccessed: 100 }),
    ]);
    fake.state.lastFocusedWindow = { id: 99, type: "popup" };
    fake.state.windows = [
      { id: 1, type: "normal", focused: false },
      { id: 2, type: "normal", focused: false },
      { id: 3, type: "normal", focused: false },
      { id: 99, type: "popup", focused: true },
    ];
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleMessage({ type: "getSnapshot" });

    expect(response.ok && response.data.currentWindowId).toBe(2);
    expect(
      response.ok &&
        response.data.tabs
          .filter(({ currentWindow }) => currentWindow)
          .map(({ windowId }) => windowId),
    ).toEqual([2]);
  });

  it("uses a manually filtered focused normal window before tab fallback", async () => {
    const fake = makeFakeBrowser([
      firefoxTab(1, 3, { lastAccessed: 900 }),
      firefoxTab(2, 2, { lastAccessed: 300 }),
    ]);
    fake.state.lastFocusedWindow = { id: 99, type: "devtools" };
    fake.state.windows = [
      { id: 2, type: "normal", focused: true },
      { id: 3, type: "normal", focused: false },
      { id: 99, type: "devtools", focused: false },
    ];
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleMessage({ type: "getSnapshot" });

    expect(response.ok && response.data.currentWindowId).toBe(2);
    expect(fake.state.lastWindowGetAllInfo).toBeUndefined();
    expect(fake.state.windowGetAllCount).toBe(1);
  });

  it("uses an explicit snapshot window ID before persisted or focused state", async () => {
    const fake = makeFakeBrowser([
      firefoxTab(1, 1, { lastAccessed: 100 }),
      firefoxTab(2, 2, { lastAccessed: 900 }),
    ]);
    fake.state.session[LAST_NORMAL_WINDOW_ID_STORAGE_KEY] = 2;
    fake.state.lastFocusedWindow = { id: 2, type: "normal" };
    fake.state.windows = [
      { id: 1, type: "normal", focused: false },
      { id: 2, type: "normal", focused: true },
    ];
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleMessage({
      type: "getSnapshot",
      currentWindowId: 1,
    });

    expect(response.ok && response.data.currentWindowId).toBe(1);
    expect(fake.state.windowGetAllCount).toBe(0);
  });

  it("activates a tab and focuses its containing window", async () => {
    const fake = makeFakeBrowser([
      firefoxTab(1, 1, { active: true }),
      firefoxTab(2, 2),
    ]);
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleMessage({
      type: "activateTab",
      tabId: 2,
    });

    expect(response).toEqual({
      ok: true,
      data: { tabId: 2, windowId: 2 },
    });
    expect(fake.state.tabs.find(({ id }) => id === 2)?.active).toBe(true);
    expect(fake.state.focusedWindowId).toBe(2);
  });

  it("returns a recoverable typed error when an activated tab is gone", async () => {
    const handlers = createBackgroundHandlers(makeFakeBrowser().api);

    await expect(
      handlers.handleMessage({ type: "activateTab", tabId: 404 }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "tab-not-found",
        message: "No tab with id: 404",
        recoverable: true,
      },
    });
  });

  it("classifies a window-focus failure as a browser error after activation", async () => {
    const fake = makeFakeBrowser([firefoxTab(2, 2)]);
    fake.state.windowUpdateError = new Error("No tab with id: 2");
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleMessage({
      type: "activateTab",
      tabId: 2,
    });

    expect(response).toEqual({
      ok: false,
      error: {
        code: "browser-error",
        message: "No tab with id: 2",
        recoverable: true,
      },
    });
    expect(fake.state.tabs.find(({ id }) => id === 2)?.active).toBe(true);
  });

  it("deduplicates close IDs and reports already-gone tabs as recoverable", async () => {
    const fake = makeFakeBrowser([
      firefoxTab(1, 1),
      firefoxTab(2, 1),
      firefoxTab(3, 1),
    ]);
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleMessage({
      type: "closeTabs",
      tabIds: [2, 2, 99, Number.NaN, 1],
    });

    expect(response).toEqual({
      ok: true,
      data: {
        closedTabIds: [2, 1],
        missingTabIds: [99],
        failedTabs: [],
      },
    });
    expect(fake.state.tabs.map(({ id }) => id)).toEqual([3]);
  });

  it("continues closing after generic failures and returns every outcome", async () => {
    const fake = makeFakeBrowser([
      firefoxTab(1, 1),
      firefoxTab(2, 1),
      firefoxTab(4, 1),
    ]);
    fake.state.removeErrors.set(2, new Error("Permission denied"));
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleMessage({
      type: "closeTabs",
      tabIds: [1, 2, 3, 4],
    });

    expect(response).toEqual({
      ok: true,
      data: {
        closedTabIds: [1, 4],
        missingTabIds: [3],
        failedTabs: [{ tabId: 2, message: "Permission denied" }],
      },
    });
    expect(fake.state.tabs.map(({ id }) => id)).toEqual([2]);
  });

  it("revalidates a duplicate group and skips tabs that navigated before bulk close", async () => {
    const fake = makeFakeBrowser([
      firefoxTab(1, 1, {
        url: "https://example.com/docs",
        lastAccessed: 100,
      }),
      firefoxTab(2, 1, {
        url: "https://example.com/other",
        lastAccessed: 200,
      }),
    ]);
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleMessage({
      type: "closeDuplicateGroups",
      groupKeys: ["url:https://example.com/docs|window:1"],
      settings: DEFAULT_SETTINGS,
      currentWindowId: 1,
    });

    expect(response).toEqual({
      ok: true,
      data: {
        closedTabIds: [],
        missingTabIds: [],
        failedTabs: [],
      },
    });
    expect(fake.state.lastTabQuery).toEqual({ windowType: "normal" });
    expect(fake.state.tabs.map(({ id }) => id)).toEqual([1, 2]);
  });

  it("recomputes the retained tab immediately before bulk close", async () => {
    const fake = makeFakeBrowser([
      firefoxTab(1, 1, {
        url: "https://example.com/docs",
        lastAccessed: 100,
      }),
      firefoxTab(2, 1, {
        url: "https://example.com/docs",
        pinned: true,
        lastAccessed: 200,
      }),
    ]);
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleMessage({
      type: "closeDuplicateGroups",
      groupKeys: ["url:https://example.com/docs|window:1"],
      settings: DEFAULT_SETTINGS,
      currentWindowId: 1,
    });

    expect(response).toEqual({
      ok: true,
      data: {
        closedTabIds: [1],
        missingTabIds: [],
        failedTabs: [],
      },
    });
    expect(fake.state.tabs.map(({ id }) => id)).toEqual([2]);
  });

  it("returns merged settings and persists validated settings", async () => {
    const fake = makeFakeBrowser();
    fake.state.local[SETTINGS_STORAGE_KEY] = {
      density: "dense",
      titleSimilarityThreshold: -10,
      scope: "invalid",
    };
    const handlers = createBackgroundHandlers(fake.api);

    const loaded = await handlers.handleMessage({ type: "getSettings" });
    const saved = await handlers.handleMessage({
      type: "saveSettings",
      settings: {
        ...DEFAULT_SETTINGS,
        density: "comfortable",
        titleSimilarityThreshold: 72,
      },
    });

    expect(loaded).toMatchObject({
      ok: true,
      data: {
        density: "dense",
        scope: "current-window",
        titleSimilarityThreshold: 0,
      },
    });
    expect(saved).toEqual({
      ok: true,
      data: {
        ...DEFAULT_SETTINGS,
        density: "comfortable",
        titleSimilarityThreshold: 72,
      },
    });
    expect(fake.state.local[SETTINGS_STORAGE_KEY]).toEqual(
      saved.ok ? saved.data : undefined,
    );
  });

  it("atomically consumes one popup mode and defaults later opens to duplicates", async () => {
    const fake = makeFakeBrowser();
    fake.state.session[POPUP_MODE_STORAGE_KEY] = {
      token: "stored-token",
      mode: "all-tabs",
    };
    const handlers = createBackgroundHandlers(fake.api);

    const [first, second] = await Promise.all([
      handlers.handleMessage({ type: "consumePopupMode" }),
      handlers.handleMessage({ type: "consumePopupMode" }),
    ]);

    expect(first).toEqual({ ok: true, data: "all-tabs" });
    expect(second).toEqual({ ok: true, data: "duplicates" });
    expect(fake.state.session).not.toHaveProperty(POPUP_MODE_STORAGE_KEY);
  });

  it("opens options through a typed successful reply", async () => {
    const fake = makeFakeBrowser();
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleMessage({ type: "openOptions" });

    expect(response).toEqual({ ok: true, data: null });
    expect(fake.state.optionsOpenCount).toBe(1);
  });

  it("stores all-tabs before opening the shortcut popup", async () => {
    const fake = makeFakeBrowser();
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleCommand("search-tabs");

    expect(response).toEqual({ ok: true, data: null });
    expect(fake.state.popupOpenCount).toBe(1);
    expect(fake.state.session[POPUP_MODE_STORAGE_KEY]).toEqual({
      token: expect.any(String),
      mode: "all-tabs",
    });
  });

  it("invokes openPopup in the command listener before the first async turn", () => {
    const fake = makeFakeBrowser();
    const writeGate = deferred<void>();
    fake.state.sessionWriteGates.push(writeGate);
    registerBackground(fake.api);
    const commandListener = fake.events.commandsOnCommand.listeners[0];
    if (!commandListener) {
      throw new Error("Expected command listener");
    }

    commandListener("search-tabs");

    expect(fake.state.popupOpenCount).toBe(1);
    writeGate.resolve();
  });

  it("waits for an in-flight handoff write before consuming it", async () => {
    const fake = makeFakeBrowser();
    const writeGate = deferred<void>();
    fake.state.sessionWriteGates.push(writeGate);
    const handlers = createBackgroundHandlers(fake.api);

    const command = handlers.handleCommand("search-tabs");
    const consume = handlers.handleMessage({ type: "consumePopupMode" });
    expect(fake.state.session).not.toHaveProperty(POPUP_MODE_STORAGE_KEY);

    writeGate.resolve();

    await expect(command).resolves.toEqual({ ok: true, data: null });
    await expect(consume).resolves.toEqual({
      ok: true,
      data: "all-tabs",
    });
    expect(fake.state.session).not.toHaveProperty(POPUP_MODE_STORAGE_KEY);
  });

  it("does not let an older failed command clear a newer handoff", async () => {
    const fake = makeFakeBrowser();
    const olderPopup = deferred<boolean>();
    fake.state.popupOpenPromises.push(
      olderPopup.promise,
      Promise.resolve(true),
    );
    const handlers = createBackgroundHandlers(fake.api);

    const olderCommand = handlers.handleCommand("search-tabs");
    const newerCommand = handlers.handleCommand("search-tabs");
    await expect(newerCommand).resolves.toEqual({ ok: true, data: null });

    olderPopup.reject(new Error("Older popup failed"));

    await expect(olderCommand).resolves.toEqual({
      ok: false,
      error: {
        code: "browser-error",
        message: "Older popup failed",
        recoverable: true,
      },
    });
    await expect(
      handlers.handleMessage({ type: "consumePopupMode" }),
    ).resolves.toEqual({ ok: true, data: "all-tabs" });
  });

  it("clears the shortcut handoff when popup opening fails", async () => {
    const fake = makeFakeBrowser();
    fake.state.popupOpenError = new Error("Popup unavailable");
    const handlers = createBackgroundHandlers(fake.api);

    const response = await handlers.handleCommand("search-tabs");

    expect(response).toEqual({
      ok: false,
      error: {
        code: "browser-error",
        message: "Popup unavailable",
        recoverable: true,
      },
    });
    expect(fake.state.session).not.toHaveProperty(POPUP_MODE_STORAGE_KEY);
  });
});

describe("background registration", () => {
  it("registers runtime, command, and generation listeners synchronously", () => {
    const fake = makeFakeBrowser([firefoxTab(1, 1)]);

    registerBackground(fake.api);

    expect(fake.events.runtimeOnMessage.listeners).toHaveLength(1);
    expect(fake.events.commandsOnCommand.listeners).toHaveLength(1);
    expect(fake.events.tabsOnCreated.listeners).toHaveLength(1);
    expect(fake.events.tabsOnUpdated.listeners).toHaveLength(1);
    expect(fake.events.tabsOnRemoved.listeners).toHaveLength(1);
    expect(fake.events.tabsOnActivated.listeners).toHaveLength(1);
    expect(fake.events.windowsOnCreated.listeners).toHaveLength(1);
    expect(fake.events.windowsOnRemoved.listeners).toHaveLength(1);
    expect(fake.events.windowsOnFocusChanged.listeners).toHaveLength(1);
  });

  it("persists normal focus and ignores later non-normal focus", async () => {
    const fake = makeFakeBrowser([
      firefoxTab(1, 1, { lastAccessed: 900 }),
      firefoxTab(2, 2, { lastAccessed: 100 }),
    ]);
    fake.state.windows = [
      { id: 1, type: "normal", focused: false },
      { id: 2, type: "normal", focused: true },
      { id: 99, type: "devtools", focused: false },
    ];
    registerBackground(fake.api);
    const runtimeListener = fake.events.runtimeOnMessage.listeners[0];
    if (!runtimeListener) {
      throw new Error("Expected runtime listener");
    }

    await Promise.all(fake.events.windowsOnFocusChanged.emit(2));
    expect(fake.state.session[LAST_NORMAL_WINDOW_ID_STORAGE_KEY]).toBe(2);

    fake.state.lastFocusedWindow = { id: 99, type: "devtools" };
    await Promise.all(fake.events.windowsOnFocusChanged.emit(99));
    expect(fake.state.session[LAST_NORMAL_WINDOW_ID_STORAGE_KEY]).toBe(2);

    const response = await runtimeListener({ type: "getSnapshot" });

    expect(response).toMatchObject({
      ok: true,
      data: { currentWindowId: 2 },
    });
    expect(fake.state.windowGetAllCount).toBe(0);
  });

  it("tracks generation internally without closing tabs or caching snapshots", async () => {
    const fake = makeFakeBrowser([firefoxTab(1, 1)]);
    const registered = registerBackground(fake.api);
    const runtimeListener = fake.events.runtimeOnMessage.listeners[0];
    if (!runtimeListener) {
      throw new Error("Expected runtime listener");
    }

    fake.events.tabsOnUpdated.emit(1, {}, firefoxTab(1, 1));
    expect(registered.getGeneration()).toBe(1);
    fake.state.tabs.push(firefoxTab(2, 1));
    const response = await runtimeListener({ type: "getSnapshot" });

    expect(fake.state.tabs.map(({ id }) => id)).toEqual([1, 2]);
    expect(response).toMatchObject({
      ok: true,
      data: {
        tabs: [{ id: 1 }, { id: 2 }],
      },
    });
    if (typeof response === "object" && response !== null && "data" in response) {
      expect(response.data).not.toHaveProperty("revision");
    }
  });

  it("registers listeners during module evaluation", async () => {
    vi.resetModules();
    const fake = makeFakeBrowser();
    const queuedMicrotasks: VoidFunction[] = [];
    const queuedTimeouts: TimerHandler[] = [];
    vi.stubGlobal("browser", fake.api);
    vi.stubGlobal("queueMicrotask", (callback: VoidFunction) => {
      queuedMicrotasks.push(callback);
    });
    vi.stubGlobal(
      "setTimeout",
      ((callback: TimerHandler) => {
        queuedTimeouts.push(callback);
        return 1;
      }) as typeof setTimeout,
    );

    await import("../src/background/index");

    expect(fake.events.runtimeOnMessage.listeners).toHaveLength(1);
    expect(fake.events.commandsOnCommand.listeners).toHaveLength(1);
    expect(fake.events.tabsOnCreated.listeners).toHaveLength(1);
    expect(fake.events.windowsOnFocusChanged.listeners).toHaveLength(1);
    expect(queuedMicrotasks).toEqual([]);
    expect(queuedTimeouts).toEqual([]);
  });
});
