import { mergeSettings } from "../domain/settings";
import { findDuplicateGroups } from "../domain/duplicates";
import { toTabRecords } from "../shared/browser";
import type {
  BackgroundRequest,
  BackgroundResponse,
  MessageResult,
  PopupMode,
  ResponseFor,
  TabSnapshot,
} from "../shared/messages";
import {
  POPUP_MODE_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from "../shared/messages";

const LAST_NORMAL_WINDOW_ID_STORAGE_KEY = "lastNormalWindowId";

export type BackgroundBrowser = Pick<
  typeof browser,
  "action" | "commands" | "runtime" | "storage" | "tabs" | "windows"
>;

interface PopupModeHandoff {
  token: string;
  mode: "all-tabs";
}

interface ActivePopupModeHandoff {
  value: PopupModeHandoff;
  writePromise: Promise<void>;
}

function success<T>(data: T): MessageResult<T> {
  return { ok: true, data };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function browserError(error: unknown): MessageResult<never> {
  return {
    ok: false,
    error: {
      code: "browser-error",
      message: errorMessage(error),
      recoverable: true,
    },
  };
}

function isMissingTabError(error: unknown): boolean {
  return /invalid tab id|no tab with id|tab not found|does not exist/i.test(
    errorMessage(error),
  );
}

function tabNotFound(error: unknown): MessageResult<never> {
  return {
    ok: false,
    error: {
      code: "tab-not-found",
      message: errorMessage(error),
      recoverable: true,
    },
  };
}

function unsupportedMessage(): MessageResult<never> {
  return {
    ok: false,
    error: {
      code: "unsupported-message",
      message: "Unsupported background message",
      recoverable: false,
    },
  };
}

function requestType(
  request: unknown,
): BackgroundRequest["type"] | undefined {
  if (
    typeof request !== "object" ||
    request === null ||
    !("type" in request) ||
    typeof request.type !== "string"
  ) {
    return undefined;
  }

  switch (request.type) {
    case "getSnapshot":
    case "activateTab":
    case "closeTabs":
    case "closeDuplicateGroups":
    case "getSettings":
    case "saveSettings":
    case "consumePopupMode":
    case "openOptions":
      return request.type;
    default:
      return undefined;
  }
}

function requestRecord(request: unknown): Record<string, unknown> {
  return typeof request === "object" && request !== null
    ? (request as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function focusedNormalWindowId(
  windows: readonly browser.windows.Window[],
): number | null {
  return (
    windows
      .filter(
        (window) =>
          window.type === "normal" &&
          window.focused &&
          finiteNumber(window.id) !== null,
      )
      .map(({ id }) => id as number)
      .sort((left, right) => left - right)[0] ?? null
  );
}

function storedPopupModeHandoff(value: unknown): PopupModeHandoff | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("token" in value) ||
    typeof value.token !== "string" ||
    !("mode" in value) ||
    value.mode !== "all-tabs"
  ) {
    return undefined;
  }

  return { token: value.token, mode: value.mode };
}

export function createBackgroundHandlers(api: BackgroundBrowser) {
  let generation = 0;
  let popupModeQueue: Promise<void> = Promise.resolve();
  let windowFocusQueue: Promise<void> = Promise.resolve();
  let activePopupModeHandoff: ActivePopupModeHandoff | undefined;

  function invalidate(): void {
    generation += 1;
  }

  function getGeneration(): number {
    return generation;
  }

  async function getSnapshot(
    requestedWindowId: unknown,
  ): Promise<MessageResult<TabSnapshot>> {
    try {
      const tabs = await api.tabs.query({ windowType: "normal" });
      const explicitWindowId = finiteNumber(requestedWindowId);
      if (explicitWindowId !== null) {
        const explicitSnapshot = toTabRecords(tabs, explicitWindowId);
        if (explicitSnapshot.currentWindowId === explicitWindowId) {
          return success({
            tabs: explicitSnapshot.records,
            currentWindowId: explicitWindowId,
          });
        }
      }

      const stored = await api.storage.session
        .get(LAST_NORMAL_WINDOW_ID_STORAGE_KEY)
        .catch((): Record<string, unknown> => ({}));
      const storedWindowId = finiteNumber(
        stored[LAST_NORMAL_WINDOW_ID_STORAGE_KEY],
      );
      if (storedWindowId !== null) {
        const storedSnapshot = toTabRecords(tabs, storedWindowId);
        if (storedSnapshot.currentWindowId === storedWindowId) {
          return success({
            tabs: storedSnapshot.records,
            currentWindowId: storedWindowId,
          });
        }
      }

      const windows = await api.windows.getAll().catch(() => []);
      const currentWindowId = focusedNormalWindowId(windows);
      const snapshot = toTabRecords(
        tabs,
        currentWindowId,
      );

      return success({
        tabs: snapshot.records,
        currentWindowId: snapshot.currentWindowId,
      });
    } catch (error) {
      return browserError(error);
    }
  }

  async function activateTab(tabId: unknown): Promise<BackgroundResponse> {
    if (typeof tabId !== "number" || !Number.isFinite(tabId)) {
      return unsupportedMessage();
    }

    let tab: browser.tabs.Tab;
    try {
      tab = await api.tabs.update(tabId, { active: true });
    } catch (error) {
      return isMissingTabError(error)
        ? tabNotFound(error)
        : browserError(error);
    }

    if (
      typeof tab.windowId !== "number" ||
      !Number.isFinite(tab.windowId)
    ) {
      return browserError(new Error("Activated tab has no window ID"));
    }

    try {
      await api.windows.update(tab.windowId, { focused: true });
      return success({ tabId, windowId: tab.windowId });
    } catch (error) {
      return browserError(error);
    }
  }

  async function closeTabs(tabIds: unknown): Promise<BackgroundResponse> {
    if (!Array.isArray(tabIds)) {
      return unsupportedMessage();
    }

    const uniqueIds = [
      ...new Set(
        tabIds.filter(
          (tabId): tabId is number =>
            typeof tabId === "number" && Number.isFinite(tabId),
        ),
      ),
    ];
    const closedTabIds: number[] = [];
    const missingTabIds: number[] = [];
    const failedTabs: { tabId: number; message: string }[] = [];

    for (const tabId of uniqueIds) {
      try {
        await api.tabs.remove(tabId);
        closedTabIds.push(tabId);
      } catch (error) {
        if (isMissingTabError(error)) {
          missingTabIds.push(tabId);
          continue;
        }
        failedTabs.push({ tabId, message: errorMessage(error) });
      }
    }

    return success({ closedTabIds, missingTabIds, failedTabs });
  }

  async function closeDuplicateGroups(
    groupKeys: unknown,
    settings: unknown,
    currentWindowId: unknown,
  ): Promise<BackgroundResponse> {
    if (
      !Array.isArray(groupKeys) ||
      !groupKeys.every((key): key is string => typeof key === "string")
    ) {
      return unsupportedMessage();
    }

    const snapshot = await getSnapshot(currentWindowId);
    if (!snapshot.ok) {
      return snapshot;
    }

    const requestedKeys = new Set(groupKeys);
    const tabIds = findDuplicateGroups(
      snapshot.data.tabs,
      mergeSettings(settings),
    )
      .filter(({ key }) => requestedKeys.has(key))
      .flatMap(({ closableTabIds }) => closableTabIds);

    return closeTabs(tabIds);
  }

  async function getSettings(): Promise<BackgroundResponse> {
    try {
      const stored = await api.storage.local.get(SETTINGS_STORAGE_KEY);
      return success(mergeSettings(stored[SETTINGS_STORAGE_KEY]));
    } catch (error) {
      return browserError(error);
    }
  }

  async function saveSettings(settings: unknown): Promise<BackgroundResponse> {
    try {
      const merged = mergeSettings(settings);
      await api.storage.local.set({ [SETTINGS_STORAGE_KEY]: merged });
      return success(merged);
    } catch (error) {
      return browserError(error);
    }
  }

  async function removeStoredHandoffIfTokenMatches(
    token: string,
  ): Promise<void> {
    const stored = await api.storage.session.get(
      POPUP_MODE_STORAGE_KEY,
    );
    const handoff = storedPopupModeHandoff(
      stored[POPUP_MODE_STORAGE_KEY],
    );
    if (handoff?.token !== token) {
      return;
    }

    const current = activePopupModeHandoff;
    if (current) {
      await api.storage.session.set({
        [POPUP_MODE_STORAGE_KEY]: current.value,
      });
      return;
    }

    await api.storage.session.remove(POPUP_MODE_STORAGE_KEY);
  }

  async function reconcileWrittenHandoff(
    written: PopupModeHandoff,
  ): Promise<void> {
    const current = activePopupModeHandoff;
    if (current?.value.token === written.token) {
      return;
    }
    if (current) {
      await api.storage.session.set({
        [POPUP_MODE_STORAGE_KEY]: current.value,
      });
      return;
    }
    await removeStoredHandoffIfTokenMatches(written.token);
  }

  function startPopupModeHandoff(): ActivePopupModeHandoff {
    const value: PopupModeHandoff = {
      token: globalThis.crypto.randomUUID(),
      mode: "all-tabs",
    };
    const active: ActivePopupModeHandoff = {
      value,
      writePromise: Promise.resolve(),
    };
    activePopupModeHandoff = active;

    let writePromise: Promise<void>;
    try {
      writePromise = api.storage.session.set({
        [POPUP_MODE_STORAGE_KEY]: value,
      });
    } catch (error) {
      writePromise = Promise.reject(error);
    }
    active.writePromise = writePromise.then(() =>
      reconcileWrittenHandoff(value),
    );
    return active;
  }

  async function clearPopupModeHandoff(token: string): Promise<void> {
    const current = activePopupModeHandoff;
    if (current?.value.token !== token) {
      await removeStoredHandoffIfTokenMatches(token);
      return;
    }

    try {
      await current.writePromise;
    } catch {
      if (activePopupModeHandoff?.value.token === token) {
        activePopupModeHandoff = undefined;
      }
      await removeStoredHandoffIfTokenMatches(token);
      return;
    }

    if (activePopupModeHandoff?.value.token !== token) {
      await removeStoredHandoffIfTokenMatches(token);
      return;
    }

    await api.storage.session.remove(POPUP_MODE_STORAGE_KEY);
    if (activePopupModeHandoff?.value.token === token) {
      activePopupModeHandoff = undefined;
    }
  }

  async function consumePopupModeOnce(): Promise<BackgroundResponse> {
    while (activePopupModeHandoff) {
      const active = activePopupModeHandoff;
      try {
        await active.writePromise;
      } catch (error) {
        if (
          activePopupModeHandoff?.value.token === active.value.token
        ) {
          activePopupModeHandoff = undefined;
        }
        return browserError(error);
      }
      if (activePopupModeHandoff?.value.token !== active.value.token) {
        continue;
      }

      try {
        await clearPopupModeHandoff(active.value.token);
        return success<PopupMode>(active.value.mode);
      } catch (error) {
        return browserError(error);
      }
    }

    try {
      const stored = await api.storage.session.get(
        POPUP_MODE_STORAGE_KEY,
      );
      if (activePopupModeHandoff) {
        return consumePopupModeOnce();
      }

      const handoff = storedPopupModeHandoff(
        stored[POPUP_MODE_STORAGE_KEY],
      );
      await api.storage.session.remove(POPUP_MODE_STORAGE_KEY);
      return success<PopupMode>(handoff?.mode ?? "duplicates");
    } catch (error) {
      return browserError(error);
    }
  }

  function consumePopupMode(): Promise<BackgroundResponse> {
    const operation = popupModeQueue.then(async () => {
      return consumePopupModeOnce();
    });

    popupModeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  function trackFocusedWindow(windowId: number): Promise<void> {
    const operation = windowFocusQueue.then(async () => {
      try {
        const window = await api.windows.get(windowId);
        if (window.type !== "normal") {
          return;
        }
        const normalWindowId = finiteNumber(window.id) ?? windowId;
        await api.storage.session.set({
          [LAST_NORMAL_WINDOW_ID_STORAGE_KEY]: normalWindowId,
        });
      } catch {
        // A closed or inaccessible window does not erase normal focus history.
      }
    });

    windowFocusQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async function openOptions(): Promise<BackgroundResponse> {
    try {
      await api.runtime.openOptionsPage();
      return success(null);
    } catch (error) {
      return browserError(error);
    }
  }

  function handleMessage<T extends BackgroundRequest>(
    request: T,
  ): Promise<ResponseFor<T>>;
  function handleMessage(request: unknown): Promise<BackgroundResponse>;
  async function handleMessage(
    request: unknown,
  ): Promise<BackgroundResponse> {
    const type = requestType(request);
    const fields = requestRecord(request);

    switch (type) {
      case "getSnapshot":
        return getSnapshot(fields.currentWindowId);
      case "activateTab":
        return activateTab(fields.tabId);
      case "closeTabs":
        return closeTabs(fields.tabIds);
      case "closeDuplicateGroups":
        return closeDuplicateGroups(
          fields.groupKeys,
          fields.settings,
          fields.currentWindowId,
        );
      case "getSettings":
        return getSettings();
      case "saveSettings":
        return saveSettings(fields.settings);
      case "consumePopupMode":
        return consumePopupMode();
      case "openOptions":
        return openOptions();
      default:
        return unsupportedMessage();
    }
  }

  async function finishPopupCommand(
    handoff: ActivePopupModeHandoff,
    popupPromise: Promise<unknown>,
  ): Promise<MessageResult<null>> {
    const [writeResult, popupResult] = await Promise.allSettled([
      handoff.writePromise,
      popupPromise,
    ]);

    if (popupResult.status === "rejected") {
      try {
        await clearPopupModeHandoff(handoff.value.token);
      } catch {
        // The popup failure remains the actionable command error.
      }
      return browserError(popupResult.reason);
    }
    if (writeResult.status === "rejected") {
      try {
        await clearPopupModeHandoff(handoff.value.token);
      } catch {
        // The storage failure remains the actionable command error.
      }
      return browserError(writeResult.reason);
    }
    return success(null);
  }

  function handleCommand(
    command: string,
  ): Promise<MessageResult<null>> {
    if (command !== "search-tabs") {
      return Promise.resolve(unsupportedMessage());
    }

    const handoff = startPopupModeHandoff();
    let popupPromise: Promise<unknown>;
    try {
      popupPromise = api.action.openPopup();
    } catch (error) {
      popupPromise = Promise.reject(error);
    }
    return finishPopupCommand(handoff, popupPromise);
  }

  return {
    handleMessage,
    handleCommand,
    invalidate,
    getGeneration,
    trackFocusedWindow,
  };
}

export function registerBackground(api: BackgroundBrowser) {
  const handlers = createBackgroundHandlers(api);

  api.runtime.onMessage.addListener((message) =>
    handlers.handleMessage(message),
  );
  api.commands.onCommand.addListener((command) => {
    void handlers.handleCommand(command);
  });

  api.tabs.onCreated.addListener(handlers.invalidate);
  api.tabs.onUpdated.addListener(handlers.invalidate);
  api.tabs.onRemoved.addListener(handlers.invalidate);
  api.tabs.onActivated.addListener(handlers.invalidate);
  api.tabs.onAttached.addListener(handlers.invalidate);
  api.tabs.onDetached.addListener(handlers.invalidate);
  api.windows.onCreated.addListener(handlers.invalidate);
  api.windows.onRemoved.addListener(handlers.invalidate);
  api.windows.onFocusChanged.addListener((windowId) => {
    handlers.invalidate();
    return handlers.trackFocusedWindow(windowId);
  });

  return handlers;
}

if (typeof browser !== "undefined") {
  registerBackground(browser);
}
