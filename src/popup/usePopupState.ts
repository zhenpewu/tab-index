import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { findDuplicateGroups } from "../domain/duplicates";
import { searchTabs } from "../domain/search";
import { DEFAULT_SETTINGS } from "../domain/settings";
import type {
  DuplicateGroup,
  Settings,
  TabRecord,
} from "../domain/types";
import {
  sendBackgroundMessage,
  type BackgroundRequest,
  type PopupMode,
  type ResponseFor,
  type TabSnapshot,
} from "../shared/messages";

export type PopupViewMode = PopupMode | "pinned";

export interface PopupTab extends TabRecord {
  duplicateCount?: number;
  duplicateGroupKey?: string;
  retained?: boolean;
}

export interface PopupDuplicateGroup
  extends Omit<DuplicateGroup, "tabs"> {
  tabs: PopupTab[];
}

type DuplicateSettingsPatch = Partial<
  Pick<
    Settings,
    | "agePreference"
    | "badgeCountMode"
    | "keepActiveTab"
    | "keepPinnedTab"
    | "preferHttps"
    | "prioritizeActiveWindow"
    | "titleMatchMode"
    | "titleSimilarityThreshold"
  >
>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function safeBackgroundMessage<T extends BackgroundRequest>(
  request: T,
): Promise<ResponseFor<T>> {
  try {
    return await sendBackgroundMessage(request);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "browser-error",
        message: errorText(error),
        recoverable: true,
      },
    } as ResponseFor<T>;
  }
}

function snapshotRequest(currentWindowId: number | undefined) {
  return currentWindowId === undefined
    ? ({ type: "getSnapshot" } as const)
    : ({ type: "getSnapshot", currentWindowId } as const);
}

async function popupWindowId(): Promise<number | undefined> {
  try {
    const currentWindow = await browser.windows.getCurrent();
    return typeof currentWindow.id === "number" &&
      Number.isFinite(currentWindow.id)
      ? currentWindow.id
      : undefined;
  } catch {
    return undefined;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    ) !== null
  );
}

export function usePopupState() {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<PopupViewMode>("duplicates");
  const [settings, setSettings] = useState<Settings>({
    ...DEFAULT_SETTINGS,
  });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [snapshot, setSnapshot] = useState<TabSnapshot>({
    tabs: [],
    currentWindowId: null,
  });
  const [query, setQuery] = useState("");
  const [, renderSelection] = useState(0);
  const [focusTabId, setFocusTabId] = useState<number | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const popupWindowIdRef = useRef<number | undefined>(undefined);
  const selectedTabIdRef = useRef<number | null>(null);
  const settingsRef = useRef<Settings>({ ...DEFAULT_SETTINGS });
  const confirmedSettingsRef = useRef<Settings>({
    ...DEFAULT_SETTINGS,
  });
  const pendingSettingsPatchRef =
    useRef<DuplicateSettingsPatch>({});
  const settingsSaveInFlightRef = useRef(false);
  const visibleRowsKeyRef = useRef("");
  const keyDownHandlerRef = useRef<(event: KeyboardEvent) => void>(
    () => undefined,
  );

  useEffect(() => {
    let mounted = true;

    async function load() {
      const currentWindowId = await popupWindowId();
      popupWindowIdRef.current = currentWindowId;

      const [modeResult, settingsResult, snapshotResult] =
        await Promise.all([
          safeBackgroundMessage({ type: "consumePopupMode" }),
          safeBackgroundMessage({ type: "getSettings" }),
          safeBackgroundMessage(snapshotRequest(currentWindowId)),
        ]);

      if (!mounted) {
        return;
      }

      const startupErrors: string[] = [];
      const initialMode = modeResult.ok ? modeResult.data : "duplicates";
      setMode(initialMode);
      if (!modeResult.ok) {
        startupErrors.push(modeResult.error.message);
      }

      if (settingsResult.ok) {
        settingsRef.current = settingsResult.data;
        confirmedSettingsRef.current = settingsResult.data;
        setSettings(settingsResult.data);
      } else {
        startupErrors.push(settingsResult.error.message);
      }

      if (snapshotResult.ok) {
        setSnapshot(snapshotResult.data);
      } else {
        startupErrors.push(snapshotResult.error.message);
      }

      setErrors(startupErrors);
      setLoading(false);

      if (initialMode === "all-tabs") {
        requestAnimationFrame(() => searchInputRef.current?.focus());
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const duplicateGroups = useMemo(
    () => findDuplicateGroups(snapshot.tabs, settings),
    [settings, snapshot.tabs],
  );

  const duplicateMetadata = useMemo(() => {
    const metadata = new Map<
      number,
      {
        duplicateCount: number;
        duplicateGroupKey: string;
        retained: boolean;
      }
    >();

    for (const group of duplicateGroups) {
      for (const tab of group.tabs) {
        metadata.set(tab.id, {
          duplicateCount: group.tabs.length,
          duplicateGroupKey: group.key,
          retained: tab.id === group.retainedTabId,
        });
      }
    }

    return metadata;
  }, [duplicateGroups]);

  const enrichedTabs = useMemo(
    () =>
      snapshot.tabs.map((tab): PopupTab => {
        const metadata = duplicateMetadata.get(tab.id);
        return metadata ? { ...tab, ...metadata } : { ...tab };
      }),
    [duplicateMetadata, snapshot.tabs],
  );

  const currentWindowId = snapshot.currentWindowId ?? Number.NaN;
  const allTabs = useMemo(
    () => searchTabs(enrichedTabs, query, currentWindowId),
    [currentWindowId, enrichedTabs, query],
  );
  const pinnedTabs = useMemo(
    () =>
      searchTabs(
        enrichedTabs.filter(({ pinned }) => pinned),
        query,
        currentWindowId,
      ),
    [currentWindowId, enrichedTabs, query],
  );
  const allGroups = useMemo<PopupDuplicateGroup[]>(
    () => {
      const enrichedById = new Map(
        enrichedTabs.map((tab) => [tab.id, tab] as const),
      );
      return duplicateGroups.map((group) => ({
        ...group,
        tabs: group.tabs.map(
          (tab) =>
            enrichedById.get(tab.id) ?? { ...tab },
        ),
      }));
    },
    [duplicateGroups, enrichedTabs],
  );
  const groups = useMemo<PopupDuplicateGroup[]>(
    () =>
      allGroups.flatMap((group) => {
        const tabs = searchTabs(group.tabs, query, currentWindowId);
        if (tabs.length === 0) {
          return [];
        }
        return [
          {
            ...group,
            tabs,
          },
        ];
      }),
    [allGroups, currentWindowId, query],
  );

  const visibleRows = useMemo(
    () =>
      mode === "duplicates"
        ? groups.flatMap(({ tabs }) => tabs)
        : mode === "pinned"
          ? pinnedTabs
          : allTabs,
    [allTabs, groups, mode, pinnedTabs],
  );
  const visibleRowKey = visibleRows.map(({ id }) => id).join(",");
  const selectionScopeKey = `${mode}:${visibleRowKey}`;
  if (visibleRowsKeyRef.current !== selectionScopeKey) {
    if (
      selectedTabIdRef.current === null ||
      !visibleRows.some(({ id }) => id === selectedTabIdRef.current)
    ) {
      selectedTabIdRef.current =
        visibleRows.find(({ active }) => active)?.id ??
        visibleRows[0]?.id ??
        null;
    }
    visibleRowsKeyRef.current = selectionScopeKey;
  }
  const selectedTabId = selectedTabIdRef.current;

  useEffect(() => {
    if (selectedTabId === null) {
      return;
    }
    const selectedRow = document.getElementById(
      `popup-tab-${selectedTabId}`,
    );
    selectedRow?.scrollIntoView?.({ block: "nearest" });
  }, [mode, query, selectedTabId, visibleRowKey]);

  useEffect(() => {
    if (focusTabId === null || mode !== "duplicates") {
      return;
    }
    const row = document.getElementById(`popup-tab-${focusTabId}`);
    if (!row) {
      return;
    }
    row.focus();
    setFocusTabId(null);
  }, [focusTabId, mode, visibleRowKey]);

  async function refreshSnapshot(): Promise<string | undefined> {
    try {
      const result = await sendBackgroundMessage(
        snapshotRequest(popupWindowIdRef.current),
      );
      if (!result.ok) {
        return result.error.message;
      }
      setSnapshot(result.data);
      return undefined;
    } catch (error) {
      return errorText(error);
    }
  }

  async function activateTab(tabId: number): Promise<void> {
    try {
      const result = await sendBackgroundMessage({
        type: "activateTab",
        tabId,
      });
      if (result.ok) {
        return;
      }
      if (result.error.code === "tab-not-found") {
        const refreshError = await refreshSnapshot();
        setErrors(refreshError ? [refreshError] : []);
        return;
      }
      setErrors([result.error.message]);
    } catch (error) {
      setErrors([errorText(error)]);
    }
  }

  async function openOptions(): Promise<void> {
    const result = await safeBackgroundMessage({ type: "openOptions" });
    if (!result.ok) {
      setErrors((currentErrors) => [
        ...currentErrors,
        result.error.message,
      ]);
    }
  }

  async function flushDuplicateSettingsPatches(): Promise<void> {
    if (settingsSaveInFlightRef.current) {
      return;
    }

    const patch = pendingSettingsPatchRef.current;
    if (Object.keys(patch).length === 0) {
      setSettingsSaving(false);
      return;
    }

    pendingSettingsPatchRef.current = {};
    settingsSaveInFlightRef.current = true;
    setSettingsSaving(true);

    try {
      const result = await sendBackgroundMessage({
        type: "patchSettings",
        patch,
      });
      if (result.ok) {
        confirmedSettingsRef.current = result.data;
        const rebased = {
          ...result.data,
          ...pendingSettingsPatchRef.current,
        };
        settingsRef.current = rebased;
        setSettings(rebased);
      } else {
        pendingSettingsPatchRef.current = {};
        settingsRef.current = confirmedSettingsRef.current;
        setSettings(confirmedSettingsRef.current);
        setErrors([result.error.message]);
      }
    } catch (error) {
      pendingSettingsPatchRef.current = {};
      settingsRef.current = confirmedSettingsRef.current;
      setSettings(confirmedSettingsRef.current);
      setErrors([errorText(error)]);
    } finally {
      settingsSaveInFlightRef.current = false;
      if (Object.keys(pendingSettingsPatchRef.current).length > 0) {
        void flushDuplicateSettingsPatches();
      } else {
        setSettingsSaving(false);
      }
    }
  }

  function saveDuplicateSettings(
    patch: DuplicateSettingsPatch,
  ): void {
    pendingSettingsPatchRef.current = {
      ...pendingSettingsPatchRef.current,
      ...patch,
    };
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    setSettingsSaving(true);
    setErrors([]);
    void flushDuplicateSettingsPatches();
  }

  async function closeTabs(requestedIds: readonly number[]): Promise<void> {
    if (settingsSaveInFlightRef.current) {
      return;
    }

    const tabIds = [...new Set(requestedIds)];
    if (tabIds.length === 0) {
      return;
    }

    const titleById = new Map(
      enrichedTabs.map(({ id, title }) => [id, title] as const),
    );
    const actionErrors: string[] = [];

    try {
      const result = await sendBackgroundMessage({
        type: "closeTabs",
        tabIds,
      });
      if (!result.ok) {
        actionErrors.push(result.error.message);
      } else {
        for (const failure of result.data.failedTabs) {
          actionErrors.push(
            `Could not close ${titleById.get(failure.tabId) ?? `tab ${failure.tabId}`}: ${failure.message}`,
          );
        }
      }
    } catch (error) {
      actionErrors.push(errorText(error));
    }

    const refreshError = await refreshSnapshot();
    if (refreshError) {
      actionErrors.push(refreshError);
    }
    setErrors(actionErrors);
  }

  async function closeDuplicateGroups(groupKeys: readonly string[]) {
    if (settingsSaveInFlightRef.current) {
      return;
    }

    if (groupKeys.length === 0) {
      return;
    }

    const titleById = new Map(
      enrichedTabs.map(({ id, title }) => [id, title] as const),
    );
    const actionErrors: string[] = [];

    try {
      const request: BackgroundRequest =
        snapshot.currentWindowId === null
          ? {
              type: "closeDuplicateGroups",
              groupKeys: [...new Set(groupKeys)],
              settings,
            }
          : {
              type: "closeDuplicateGroups",
              groupKeys: [...new Set(groupKeys)],
              settings,
              currentWindowId: snapshot.currentWindowId,
            };
      const result = await sendBackgroundMessage(request);
      if (!result.ok) {
        actionErrors.push(result.error.message);
      } else {
        for (const failure of result.data.failedTabs) {
          actionErrors.push(
            `Could not close ${titleById.get(failure.tabId) ?? `tab ${failure.tabId}`}: ${failure.message}`,
          );
        }
      }
    } catch (error) {
      actionErrors.push(errorText(error));
    }

    const refreshError = await refreshSnapshot();
    if (refreshError) {
      actionErrors.push(refreshError);
    }
    setErrors(actionErrors);
  }

  function closeRow(tab: PopupTab) {
    return closeTabs([tab.id]);
  }

  function closeGroup(group: PopupDuplicateGroup) {
    return closeDuplicateGroups([group.key]);
  }

  function closeAll() {
    return closeDuplicateGroups(groups.map(({ key }) => key));
  }

  function reviewDuplicates(tab: PopupTab) {
    if (!tab.duplicateGroupKey) {
      return;
    }
    selectedTabIdRef.current = tab.id;
    renderSelection((revision) => revision + 1);
    setFocusTabId(tab.id);
    setMode("duplicates");
  }

  function selectMode(nextMode: PopupViewMode) {
    setMode(nextMode);
  }

  function selectTabId(tabId: number) {
    selectedTabIdRef.current = tabId;
    renderSelection((revision) => revision + 1);
  }

  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target;
    const fromSettingsPane =
      target instanceof Element &&
      target.closest(".duplicate-settings-pane") !== null;
    if (fromSettingsPane && event.key !== "Escape") {
      return;
    }
    const fromButton =
      target instanceof Element && target.closest("button") !== null;
    if (fromButton && event.key !== "Escape") {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (visibleRows.length === 0) {
        return;
      }
      event.preventDefault();
      const currentIndex = visibleRows.findIndex(
        ({ id }) => id === selectedTabIdRef.current,
      );
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        currentIndex < 0
          ? 0
          : Math.min(
              visibleRows.length - 1,
              Math.max(0, currentIndex + direction),
            );
      const nextTabId = visibleRows[nextIndex]?.id ?? null;
      selectedTabIdRef.current = nextTabId;
      renderSelection((revision) => revision + 1);
      return;
    }

    if (event.key === "Enter") {
      const selected = visibleRows.find(
        ({ id }) => id === selectedTabIdRef.current,
      );
      if (!selected) {
        return;
      }
      event.preventDefault();
      void activateTab(selected.id);
      return;
    }

    if (event.key === "Delete") {
      if (
        isEditableTarget(target) ||
        settingsSaveInFlightRef.current
      ) {
        return;
      }
      const selected = visibleRows.find(
        ({ id }) => id === selectedTabIdRef.current,
      );
      if (!selected) {
        return;
      }
      event.preventDefault();
      void closeRow(selected);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (query.length > 0) {
        setQuery("");
      } else {
        window.close();
      }
    }
  }

  keyDownHandlerRef.current = handleKeyDown;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      keyDownHandlerRef.current(event);
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  return {
    allTabs,
    closeAll,
    closeGroup,
    closeRow,
    errors,
    groups,
    loading,
    mode,
    openOptions,
    pinnedTabs,
    query,
    reviewDuplicates,
    saveDuplicateSettings,
    searchInputRef,
    selectedTabId,
    selectMode,
    setQuery,
    setSelectedTabId: selectTabId,
    settings,
    settingsSaving,
    activateTab,
  };
}
