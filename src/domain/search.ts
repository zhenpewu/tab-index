import Fuse from "fuse.js";

import type { TabRecord } from "./types";

function partitionCurrentWindowFirst<T extends TabRecord>(
  tabs: readonly T[],
  currentWindowId: number,
): T[] {
  const currentWindow: T[] = [];
  const otherWindows: T[] = [];

  for (const tab of tabs) {
    (tab.windowId === currentWindowId ? currentWindow : otherWindows).push(
      tab,
    );
  }

  return [...currentWindow, ...otherWindows];
}

export function searchTabs<T extends TabRecord>(
  tabs: readonly T[],
  query: string,
  currentWindowId: number,
): T[] {
  const normalizedQuery = query.trim();

  if (normalizedQuery.length === 0) {
    return partitionCurrentWindowFirst(tabs, currentWindowId);
  }

  const results = new Fuse(tabs, {
    keys: ["title", "url"],
    includeScore: true,
    threshold: 0.3,
    ignoreLocation: true,
    shouldSort: false,
  })
    .search(normalizedQuery)
    .sort(
      (left, right) =>
        (left.score ?? 1) - (right.score ?? 1) ||
        left.refIndex - right.refIndex,
    )
    .map(({ item }) => item);

  return partitionCurrentWindowFirst(results, currentWindowId);
}
