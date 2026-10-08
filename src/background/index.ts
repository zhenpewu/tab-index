import { mergeSettings } from "../domain/settings";
import { findDuplicateGroups } from "../domain/duplicates";
import type { Settings } from "../domain/types";
import { toTabRecords } from "../shared/browser";
import type {
  BackgroundRequest,
  BackgroundResponse,
  MessageResult,
  PopupMode,
  ResponseFor,
  SettingsPatch,
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
    case "patchSettings":
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
  let badgeRevision = 0;
  let popupModeQueue: Promise<void> = Promise.resolve();
  let settingsWriteQueue: Promise<void> = Promise.resolve();
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

  async function getSettings(): Promise<MessageResult<Settings>> {
    try {
      const stored = await api.storage.local.get(SETTINGS_STORAGE_KEY);
      return success(mergeSettings(stored[SETTINGS_STORAGE_KEY]));
    } catch (error) {
      return browserError(error);
    }
  }

  async function refreshBadge(requestedWindowId?: number): Promise<void> {
    const revision = ++badgeRevision;

    try {
      const [snapshot, settings] = await Promise.all([
        getSnapshot(requestedWindowId),
        getSettings(),
      ]);
      if (!snapshot.ok || !settings.ok || revision !== badgeRevision) {
        return;
      }

      const badgeCount =
        settings.data.badgeCountMode === "all-tabs"
          ? snapshot.data.tabs.length
          : settings.data.badgeCountMode === "current-window-tabs"
            ? snapshot.data.tabs.filter(({ currentWindow }) => currentWindow)
                .length
            : findDuplicateGroups(
                snapshot.data.tabs,
                settings.data,
              ).reduce(
                (count, group) =>
                  count + group.closableTabIds.length,
                0,
              );
      const text =
        badgeCount === 0
          ? ""
          : badgeCount > 999
            ? "999+"
            : String(badgeCount);

      await api.action.setBadgeBackgroundColor({ color: "#5b5b66" });
      if (revision === badgeRevision) {
        await api.action.setBadgeText({ text });
      }
    } catch {
      // Badge rendering is supplementary and must not break tab operations.
    }
  }

  function enqueueSettingsWrite(
    update: (current: Settings) => Settings,
  ): Promise<BackgroundResponse> {
    const operation = settingsWriteQueue.then(async () => {
      try {
        const current = await getSettings();
        if (!current.ok) {
          return current;
        }
        const next = update(current.data);
        await api.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
        await refreshBadge();
        return success(next);
      } catch (error) {
        return browserError(error);
      }
    });

    settingsWriteQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  function saveSettings(settings: unknown): Promise<BackgroundResponse> {
    return enqueueSettingsWrite(() => mergeSettings(settings));
  }

  function patchSettings(patch: unknown): Promise<BackgroundResponse> {
    const fields =
      typeof patch === "object" && patch !== null
        ? (patch as SettingsPatch)
        : {};
    return enqueueSettingsWrite((current) =>
      mergeSettings({ ...current, ...fields }),
    );
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
      case "patchSettings":
        return patchSettings(fields.patch);
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
    refreshBadge,
    trackFocusedWindow,
  };
}

export function registerBackground(api: BackgroundBrowser) {
  const handlers = createBackgroundHandlers(api);

  api.runtime.onMessage.addListener((message) =>
    handlers.handleMessage(message),
  );
  api.runtime.onInstalled.addListener(() => handlers.refreshBadge());
  api.runtime.onStartup.addListener(() => handlers.refreshBadge());
  api.commands.onCommand.addListener((command) => {
    void handlers.handleCommand(command);
  });

  const invalidateAndRefresh = () => {
    handlers.invalidate();
    return handlers.refreshBadge();
  };

  api.tabs.onCreated.addListener(invalidateAndRefresh);
  api.tabs.onUpdated.addListener(invalidateAndRefresh);
  api.tabs.onRemoved.addListener(invalidateAndRefresh);
  api.tabs.onActivated.addListener(invalidateAndRefresh);
  api.tabs.onAttached.addListener(invalidateAndRefresh);
  api.tabs.onDetached.addListener(invalidateAndRefresh);
  api.windows.onCreated.addListener(invalidateAndRefresh);
  api.windows.onRemoved.addListener(invalidateAndRefresh);
  api.windows.onFocusChanged.addListener((windowId) => {
    handlers.invalidate();
    return handlers
      .trackFocusedWindow(windowId)
      .then(() => handlers.refreshBadge(windowId));
  });
  void handlers.refreshBadge();

  return handlers;
}

if (typeof browser !== "undefined") {
  registerBackground(browser);
}
