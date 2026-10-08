// Duplicate matching semantics are adapted from Duplicate Tabs Closer 4.3.4.
// See THIRD_PARTY_NOTICES.md. This implementation is typed, deterministic,
// side-effect-free, and does not call browser APIs.
// Modified for Tab Index on 2026-10-08.

import { parseTitleRules, parseUrlRules, parseWhitelist } from "./rules";
import { findSharedTitleRule, titlesMatch } from "./title";
import type {
  DuplicateGroup,
  PatternRule,
  Settings,
  TabRecord,
} from "./types";
import { normalizeUrl } from "./url";

const OPTIONAL_BLANK_URLS = new Set([
  "about:home",
  "about:newtab",
  "chrome://newtab/",
]);

interface PreparedTab {
  tab: TabRecord;
  normalizedUrl: string;
  normalizedTitle: string;
}

interface Match {
  key: string;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isEligibleTitle(tab: TabRecord): boolean {
  return tab.status === "complete" && tab.title.length > 0;
}

function isWhitelisted(url: string, rules: readonly PatternRule[]): boolean {
  return rules.some((rule) => rule.regex.test(url));
}

function shouldSkipTab(
  tab: TabRecord,
  settings: Settings,
  whitelistRules: readonly PatternRule[],
): boolean {
  if (!tab.url || tab.url === "about:blank") {
    return true;
  }
  if (tab.url.startsWith("view-source:")) {
    return true;
  }
  if (settings.skipBlankTabs && OPTIONAL_BLANK_URLS.has(tab.url)) {
    return true;
  }
  return isWhitelisted(tab.url, whitelistRules);
}

function identitySuffix(tab: TabRecord, settings: Settings): string {
  let suffix = "";
  if (settings.scope === "current-window") {
    suffix += `|window:${tab.windowId}`;
  }
  if (settings.containerScope === "within-container") {
    suffix += `|container:${tab.cookieStoreId}`;
  }
  return suffix;
}

function canCompare(
  left: PreparedTab,
  right: PreparedTab,
  settings: Settings,
): boolean {
  if (
    settings.scope === "current-window" &&
    left.tab.windowId !== right.tab.windowId
  ) {
    return false;
  }
  return (
    settings.containerScope === "across-containers" ||
    left.tab.cookieStoreId === right.tab.cookieStoreId
  );
}

function findSharedUrlRule(
  left: string,
  right: string,
  rules: readonly PatternRule[],
): string | undefined {
  for (const rule of rules) {
    if (rule.regex.test(left) && rule.regex.test(right)) {
      return rule.source;
    }
  }
  return undefined;
}

function findMatch(
  left: PreparedTab,
  right: PreparedTab,
  settings: Settings,
  urlGroupRules: readonly PatternRule[],
  titleGroupRules: readonly PatternRule[],
): Match | undefined {
  if (!canCompare(left, right, settings)) {
    return undefined;
  }

  const suffix = identitySuffix(left.tab, settings);
  const sameUrl = left.normalizedUrl === right.normalizedUrl;
  const exactTitle =
    isEligibleTitle(left.tab) &&
    isEligibleTitle(right.tab) &&
    titlesMatch(left.tab.title, right.tab.title, 100);

  if (
    sameUrl &&
    (settings.titleMatchMode !== "url-and-title" || exactTitle)
  ) {
    const titleSuffix =
      settings.titleMatchMode === "url-and-title"
        ? `|title:${left.normalizedTitle}`
        : "";
    return {
      key: `url:${left.normalizedUrl}${titleSuffix}${suffix}`,
    };
  }

  if (
    settings.titleMatchMode === "url-or-title" &&
    isEligibleTitle(left.tab) &&
    isEligibleTitle(right.tab) &&
    titlesMatch(
      left.tab.title,
      right.tab.title,
      settings.titleSimilarityThreshold,
    )
  ) {
    return {
      key: `title:${[left.normalizedTitle, right.normalizedTitle]
        .sort()
        .at(0)}${suffix}`,
    };
  }

  const urlRule = findSharedUrlRule(
    left.tab.url,
    right.tab.url,
    urlGroupRules,
  );
  if (urlRule !== undefined) {
    return { key: `url-pattern:${urlRule}${suffix}` };
  }

  if (
    settings.titleMatchMode === "url-or-title" &&
    isEligibleTitle(left.tab) &&
    isEligibleTitle(right.tab)
  ) {
    const titleRule = findSharedTitleRule(
      left.tab.title,
      right.tab.title,
      titleGroupRules,
    );
    if (titleRule !== undefined) {
      return { key: `title-pattern:${titleRule}${suffix}` };
    }
  }

  return undefined;
}

function findRoot(parents: Int32Array, index: number): number {
  let root = index;
  while (parents[root] !== root) {
    root = parents[root] ?? root;
  }
  while (parents[index] !== index) {
    const parent = parents[index] ?? root;
    parents[index] = root;
    index = parent;
  }
  return root;
}

function union(parents: Int32Array, left: number, right: number): void {
  const leftRoot = findRoot(parents, left);
  const rightRoot = findRoot(parents, right);
  if (leftRoot === rightRoot) {
    return;
  }
  parents[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
}

export function selectRetainedTab(
  tabs: readonly TabRecord[],
  settings: Settings,
  activeWindowId?: number,
): TabRecord | undefined {
  let candidates = [...tabs];
  if (candidates.length === 0) {
    return undefined;
  }

  if (settings.keepPinnedTab && candidates.some((tab) => tab.pinned)) {
    candidates = candidates.filter((tab) => tab.pinned);
  }

  if (settings.keepActiveTab) {
    const windowCounts = new Map<number, number>();
    for (const tab of candidates) {
      windowCounts.set(tab.windowId, (windowCounts.get(tab.windowId) ?? 0) + 1);
    }
    const windowsWithLocalActiveTab = new Set(
      candidates
        .filter(
          (tab) =>
            tab.active && (windowCounts.get(tab.windowId) ?? 0) > 1,
        )
        .map((tab) => tab.windowId),
    );
    candidates = candidates.filter(
      (tab) =>
        !windowsWithLocalActiveTab.has(tab.windowId) || tab.active,
    );
  }

  if (
    settings.preferHttps &&
    candidates.some((tab) => /^https:\/\//i.test(tab.url))
  ) {
    candidates = candidates.filter((tab) => /^https:\/\//i.test(tab.url));
  }

  const preferredAge =
    settings.agePreference === "newer"
      ? Math.max(...candidates.map((tab) => tab.lastAccessed))
      : Math.min(...candidates.map((tab) => tab.lastAccessed));
  candidates = candidates.filter(
    (tab) => tab.lastAccessed === preferredAge,
  );

  const candidateWindows = new Set(candidates.map((tab) => tab.windowId));
  if (
    settings.prioritizeActiveWindow &&
    activeWindowId !== undefined &&
    candidateWindows.size > 1 &&
    candidates.some((tab) => tab.windowId === activeWindowId)
  ) {
    candidates = candidates.filter(
      (tab) => tab.windowId === activeWindowId,
    );
  }

  return candidates.sort((left, right) => left.id - right.id)[0];
}

export function findDuplicateGroups(
  tabs: readonly TabRecord[],
  settings: Settings,
): DuplicateGroup[] {
  const currentWindowIds = new Set(
    tabs
      .filter((tab) => tab.currentWindow)
      .map((tab) => tab.windowId),
  );
  const currentWindowId =
    currentWindowIds.size === 1
      ? currentWindowIds.values().next().value
      : undefined;
  if (
    settings.scope === "current-window" &&
    currentWindowId === undefined
  ) {
    return [];
  }

  const whitelistRules = parseWhitelist(settings.whitelist).rules;
  const urlGroupRules = parseUrlRules(settings.urlRules).rules.filter(
    (rule): rule is PatternRule => rule.type === "group",
  );
  const titleGroupRules = parseTitleRules(settings.titleRules).rules;

  const preparedTabs = tabs
    .filter(
      (tab) =>
        (settings.scope !== "current-window" ||
          tab.windowId === currentWindowId) &&
        !shouldSkipTab(tab, settings, whitelistRules),
    )
    .map((tab) => ({
      tab,
      normalizedUrl: normalizeUrl(tab.url, settings),
      normalizedTitle: tab.title.toLowerCase(),
    }))
    .sort((left, right) => left.tab.id - right.tab.id);

  const parents = new Int32Array(preparedTabs.length);
  for (let index = 0; index < parents.length; index += 1) {
    parents[index] = index;
  }

  const edges: Array<{ left: number; right: number; key: string }> = [];
  for (let left = 0; left < preparedTabs.length; left += 1) {
    for (let right = left + 1; right < preparedTabs.length; right += 1) {
      const leftTab = preparedTabs[left];
      const rightTab = preparedTabs[right];
      if (!leftTab || !rightTab) {
        continue;
      }
      const match = findMatch(
        leftTab,
        rightTab,
        settings,
        urlGroupRules,
        titleGroupRules,
      );
      if (!match) {
        continue;
      }
      union(parents, left, right);
      edges.push({ left, right, key: match.key });
    }
  }

  const componentTabs = new Map<number, TabRecord[]>();
  for (const [index, preparedTab] of preparedTabs.entries()) {
    const root = findRoot(parents, index);
    const members = componentTabs.get(root) ?? [];
    members.push(preparedTab.tab);
    componentTabs.set(root, members);
  }

  const componentKeys = new Map<number, string[]>();
  for (const edge of edges) {
    const root = findRoot(parents, edge.left);
    const keys = componentKeys.get(root) ?? [];
    keys.push(edge.key);
    componentKeys.set(root, keys);
  }

  return Array.from(componentTabs.entries())
    .filter(([, members]) => members.length > 1)
    .map(([root, members]) => {
      const sortedTabs = [...members].sort(
        (left, right) => left.id - right.id,
      );
      const retainedTab = selectRetainedTab(
        sortedTabs,
        settings,
        currentWindowId,
      );
      const retainedTabId = retainedTab?.id ?? sortedTabs[0]?.id ?? 0;
      const key = (componentKeys.get(root) ?? []).sort()[0] ?? "";

      return {
        key,
        tabs: sortedTabs,
        retainedTabId,
        closableTabIds: sortedTabs
          .filter((tab) => tab.id !== retainedTabId)
          .map((tab) => tab.id),
      };
    })
    .sort(
      (left, right) =>
        compareCodeUnits(left.key, right.key) ||
        (left.tabs[0]?.id ?? 0) - (right.tabs[0]?.id ?? 0),
    );
}
