import type { TabRecord } from "../domain/types";

function isUsableId(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fallbackLastAccessed(tab: browser.tabs.Tab): number {
  return typeof tab.lastAccessed === "number" &&
    Number.isFinite(tab.lastAccessed)
    ? tab.lastAccessed
    : 0;
}

export function toTabRecord(
  tab: browser.tabs.Tab,
  currentWindowId: number,
): TabRecord | undefined {
  if (!isUsableId(tab.id) || !isUsableId(tab.windowId)) {
    return undefined;
  }

  const record: TabRecord = {
    id: tab.id,
    windowId: tab.windowId,
    currentWindow: tab.windowId === currentWindowId,
    cookieStoreId: tab.cookieStoreId ?? "firefox-default",
    active: tab.active,
    pinned: tab.pinned,
    url: tab.url ?? "",
    title: tab.title ?? "",
    lastAccessed: fallbackLastAccessed(tab),
    incognito: tab.incognito,
  };

  if (tab.favIconUrl) {
    record.favIconUrl = tab.favIconUrl;
  }
  if (tab.status === "loading" || tab.status === "complete") {
    record.status = tab.status;
  }

  return record;
}

export function toTabRecords(
  tabs: readonly browser.tabs.Tab[],
  preferredWindowId: number | null,
): { records: TabRecord[]; currentWindowId: number | null } {
  const usableTabs = tabs.filter(
    (
      tab,
    ): tab is browser.tabs.Tab & { id: number; windowId: number } =>
      isUsableId(tab.id) && isUsableId(tab.windowId),
  );
  const windowIds = new Set(usableTabs.map(({ windowId }) => windowId));

  let currentWindowId =
    preferredWindowId !== null && windowIds.has(preferredWindowId)
      ? preferredWindowId
      : null;

  if (currentWindowId === null && usableTabs.length > 0) {
    const fallback = [...usableTabs].sort(
      (left, right) =>
        fallbackLastAccessed(right) - fallbackLastAccessed(left) ||
        left.windowId - right.windowId ||
        left.id - right.id,
    )[0];
    currentWindowId = fallback?.windowId ?? null;
  }

  const records: TabRecord[] = [];
  for (const tab of usableTabs) {
    const record = toTabRecord(tab, currentWindowId ?? Number.NaN);
    if (record) {
      records.push(record);
    }
  }

  return { records, currentWindowId };
}
