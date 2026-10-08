import { describe, expect, it } from "vitest";

import { searchTabs } from "../src/domain/search";
import type { TabRecord } from "../src/domain/types";

function tab(
  id: number,
  overrides: Partial<TabRecord> = {},
): TabRecord {
  return {
    id,
    windowId: 1,
    currentWindow: true,
    cookieStoreId: "firefox-default",
    active: false,
    pinned: false,
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
    lastAccessed: 1_000,
    status: "complete",
    incognito: false,
    ...overrides,
  };
}

describe("searchTabs", () => {
  it("has the planned three-argument interface", () => {
    expect(searchTabs).toHaveLength(3);
  });

  it("preserves input order within the current-window-first partition for an empty query", () => {
    const tabs = [
      tab(30, { windowId: 2, currentWindow: false }),
      tab(20, { windowId: 1 }),
      tab(10, { windowId: 2, currentWindow: false }),
      tab(40, { windowId: 1 }),
    ];

    expect(searchTabs(tabs, "", 1).map(({ id }) => id)).toEqual([
      20, 40, 30, 10,
    ]);
  });

  it("matches tab titles", () => {
    const results = searchTabs(
      [
        tab(1, { title: "Firefox Release Notes" }),
        tab(2, { title: "Quarterly Report" }),
      ],
      "release notes",
      1,
    );

    expect(results.map(({ id }) => id)).toEqual([1]);
  });

  it("matches tab URLs", () => {
    const results = searchTabs(
      [
        tab(1, { url: "https://developer.mozilla.org/en-US/docs" }),
        tab(2, { url: "https://example.com/report" }),
      ],
      "developer.mozilla.org",
      1,
    );

    expect(results.map(({ id }) => id)).toEqual([1]);
  });

  it("matches conservative fuzzy queries", () => {
    const results = searchTabs(
      [
        tab(1, { title: "Firefox Release Notes" }),
        tab(2, { title: "Quarterly Report" }),
      ],
      "firefox releas",
      1,
    );

    expect(results.map(({ id }) => id)).toEqual([1]);
  });

  it("trims leading whitespace before fuzzy score ordering", () => {
    const results = searchTabs(
      [
        tab(1, { title: "Firefox" }),
        tab(2, { title: "Mozilla Firefox Browser" }),
        tab(3, { title: "Firefox Release Notes" }),
      ],
      " firefox",
      1,
    );

    expect(results.map(({ id }) => id)).toEqual([1, 2, 3]);
  });

  it("trims trailing whitespace from mixed-case queries", () => {
    const results = searchTabs(
      [
        tab(1, { title: "Firefox" }),
        tab(2, { title: "Mozilla Firefox Browser" }),
        tab(3, { title: "Firefox Release Notes" }),
      ],
      "FiReFoX ",
      1,
    );

    expect(results.map(({ id }) => id)).toEqual([1, 2, 3]);
  });

  it("treats a whitespace-only query as empty while preserving partition order", () => {
    const tabs = [
      tab(30, { windowId: 2, currentWindow: false }),
      tab(20, { windowId: 1 }),
      tab(10, { windowId: 2, currentWindow: false }),
      tab(40, { windowId: 1 }),
    ];

    expect(searchTabs(tabs, " \t ", 1).map(({ id }) => id)).toEqual([
      20, 40, 30, 10,
    ]);
  });

  it("partitions fuzzy results by the supplied current window while preserving score order", () => {
    const results = searchTabs(
      [
        tab(1, {
          windowId: 2,
          currentWindow: false,
          title: "Firefox",
        }),
        tab(2, {
          windowId: 1,
          title: "Firefix Browser",
        }),
        tab(3, {
          windowId: 1,
          title: "Firefox Release Notes",
        }),
      ],
      "firefox",
      1,
    );

    expect(results.map(({ id }) => id)).toEqual([3, 2, 1]);
  });

  it("searches caller-filtered pinned tabs without a separate mode argument", () => {
    const tabs = [
      tab(1, { pinned: false, title: "Firefox Unpinned" }),
      tab(2, { pinned: true, title: "Firefox Pinned" }),
      tab(3, { pinned: true, title: "Reference" }),
    ];
    const pinnedTabs = tabs.filter(({ pinned }) => pinned);

    expect(
      searchTabs(pinnedTabs, "firefox", 1).map(({ id }) => id),
    ).toEqual([2]);
  });

  it("preserves input order when fuzzy results have equal scores", () => {
    const tabs = [
      tab(30, { title: "Firefox", url: "https://mozilla.org/" }),
      tab(10, { title: "Firefox", url: "https://mozilla.org/" }),
      tab(20, { title: "Firefox", url: "https://mozilla.org/" }),
    ];

    expect(searchTabs(tabs, "firefox", 1).map(({ id }) => id)).toEqual([
      30, 10, 20,
    ]);
  });

  it("returns the original generic records with duplicate metadata intact", () => {
    const tabs = [
      {
        ...tab(1, { title: "Firefox" }),
        duplicateGroupKey: "group-one",
      },
    ];

    const [result] = searchTabs(tabs, "firefox", 1);

    expect(result).toBe(tabs[0]);
    expect(result?.duplicateGroupKey).toBe("group-one");
  });
});
