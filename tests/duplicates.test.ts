import { describe, expect, it, vi } from "vitest";

import {
  findDuplicateGroups,
  selectRetainedTab,
} from "../src/domain/duplicates";
import { DEFAULT_SETTINGS } from "../src/domain/settings";
import type { Settings, TabRecord } from "../src/domain/types";

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    keepPinnedTab: false,
    keepActiveTab: false,
    preferHttps: false,
    prioritizeActiveWindow: false,
    ...overrides,
  };
}

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

describe("findDuplicateGroups", () => {
  it("has the planned two-argument interface", () => {
    expect(findDuplicateGroups).toHaveLength(2);
  });

  it("groups exact normalized URLs in URL-only mode", () => {
    const groups = findDuplicateGroups(
      [
        tab(2, { url: "https://example.com/page/" }),
        tab(1, { url: "https://example.com/page" }),
        tab(3, { url: "https://example.com/other" }),
      ],
      settings(),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.tabs.map(({ id }) => id)).toEqual([1, 2]);
    expect(groups[0]?.retainedTabId).toBe(1);
    expect(groups[0]?.closableTabIds).toEqual([2]);
  });

  it("keeps distinct resource paths separate in URL-only mode", () => {
    const groups = findDuplicateGroups(
      [
        tab(1, {
          url: "https://work.example/projects/tool/logs?session=one",
          title: "Tool workspace",
        }),
        tab(2, {
          url: "https://work.example/projects/tool/files/main/build?session=two",
          title: "Tool workspace",
        }),
      ],
      settings({ ignoreQuery: true }),
    );

    expect(groups).toEqual([]);
  });

  it("groups different URLs by fuzzy title in URL-or-title mode", () => {
    const groups = findDuplicateGroups(
      [
        tab(1, {
          url: "https://one.example/",
          title: "Quarterly Report",
        }),
        tab(2, {
          url: "https://two.example/",
          title: "Quarterly Reports",
        }),
      ],
      settings({
        titleMatchMode: "url-or-title",
        titleSimilarityThreshold: 90,
      }),
    );

    expect(groups[0]?.tabs.map(({ id }) => id)).toEqual([1, 2]);
  });

  it("does not fuzzy-match a title with missing completion status", () => {
    const groups = findDuplicateGroups(
      [
        tab(1, {
          url: "https://one.example/",
          title: "Quarterly Report",
          status: undefined,
        }),
        tab(2, {
          url: "https://two.example/",
          title: "Quarterly Reports",
        }),
      ],
      settings({
        titleMatchMode: "url-or-title",
        titleSimilarityThreshold: 90,
      }),
    );

    expect(groups).toEqual([]);
  });

  it("does not title-pattern-match a title with missing completion status", () => {
    const groups = findDuplicateGroups(
      [
        tab(1, {
          url: "https://one.example/",
          title: "Release October",
          status: undefined,
        }),
        tab(2, {
          url: "https://two.example/",
          title: "Release November",
        }),
      ],
      settings({
        titleMatchMode: "url-or-title",
        titleRules: "Release *",
      }),
    );

    expect(groups).toEqual([]);
  });

  it("requires an exact title as well as the URL in URL-and-title mode", () => {
    const tabs = [
      tab(1, { url: "https://example.com/page", title: "Release Notes" }),
      tab(2, { url: "https://example.com/page", title: "release notes" }),
      tab(3, { url: "https://example.com/page", title: "Release Note" }),
    ];

    const groups = findDuplicateGroups(
      tabs,
      settings({
        titleMatchMode: "url-and-title",
        titleSimilarityThreshold: 0,
      }),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.tabs.map(({ id }) => id)).toEqual([1, 2]);
  });

  it("groups raw URLs through a custom URL group rule", () => {
    const groups = findDuplicateGroups(
      [
        tab(1, { url: "https://example.com/items/one" }),
        tab(2, { url: "https://example.com/items/two" }),
      ],
      settings({
        urlRules: JSON.stringify([
          { type: "group", pattern: "https://example.com/items/*" },
        ]),
      }),
    );

    expect(groups[0]?.tabs.map(({ id }) => id)).toEqual([1, 2]);
    expect(groups[0]?.key).toContain("url-pattern:");
  });

  it("groups titles through a custom title rule only in URL-or-title mode", () => {
    const tabs = [
      tab(1, { url: "https://one.example/", title: "Release October" }),
      tab(2, { url: "https://two.example/", title: "Release November" }),
    ];
    const titleRules = "Release *";

    expect(
      findDuplicateGroups(
        tabs,
        settings({ titleMatchMode: "url-only", titleRules }),
      ),
    ).toEqual([]);
    expect(
      findDuplicateGroups(
        tabs,
        settings({ titleMatchMode: "url-or-title", titleRules }),
      )[0]?.tabs.map(({ id }) => id),
    ).toEqual([1, 2]);
  });

  it("excludes whitelisted URLs from duplicate groups", () => {
    const groups = findDuplicateGroups(
      [
        tab(1, { url: "https://private.example/page" }),
        tab(2, { url: "https://private.example/page" }),
      ],
      settings({ whitelist: "https://private.example/*" }),
    );

    expect(groups).toEqual([]);
  });

  it("always skips about:blank and optionally skips other blank pages", () => {
    const tabs = [
      tab(1, { url: "about:blank" }),
      tab(2, { url: "about:blank" }),
      tab(3, { url: "about:newtab" }),
      tab(4, { url: "about:newtab" }),
    ];

    expect(
      findDuplicateGroups(tabs, settings({ skipBlankTabs: false }))[0]?.tabs
        .map(({ id }) => id),
    ).toEqual([3, 4]);
    expect(
      findDuplicateGroups(tabs, settings({ skipBlankTabs: true })),
    ).toEqual([]);
  });

  it("excludes view-source URLs", () => {
    const groups = findDuplicateGroups(
      [
        tab(1, { url: "view-source:https://example.com/page" }),
        tab(2, { url: "view-source:https://example.com/page" }),
      ],
      settings(),
    );

    expect(groups).toEqual([]);
  });

  it("uses the caller-visible active window for current-window scope", () => {
    const groups = findDuplicateGroups(
      [
        tab(1, {
          windowId: 1,
          currentWindow: false,
          url: "https://example.com/page",
        }),
        tab(2, {
          windowId: 1,
          currentWindow: false,
          url: "https://example.com/page",
        }),
        tab(3, {
          windowId: 2,
          currentWindow: true,
          url: "https://example.com/page",
        }),
        tab(4, {
          windowId: 2,
          currentWindow: true,
          url: "https://example.com/page",
        }),
      ],
      settings({ scope: "current-window" }),
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.tabs.map(({ id }) => id)).toEqual([3, 4]);
  });

  it("returns no current-window groups when no record marks the current window", () => {
    const groups = findDuplicateGroups(
      [
        tab(1, {
          currentWindow: false,
          url: "https://example.com/page",
        }),
        tab(2, {
          currentWindow: false,
          url: "https://example.com/page",
        }),
      ],
      settings({ scope: "current-window" }),
    );

    expect(groups).toEqual([]);
  });

  it("includes all records and groups across windows in all-windows scope", () => {
    const groups = findDuplicateGroups(
      [
        tab(1, { windowId: 1, url: "https://example.com/page" }),
        tab(2, {
          windowId: 2,
          currentWindow: false,
          url: "https://example.com/page",
        }),
      ],
      settings({ scope: "all-windows" }),
    );

    expect(groups[0]?.tabs.map(({ id }) => id)).toEqual([1, 2]);
  });

  it("adds the container to identity only for within-container matching", () => {
    const tabs = [
      tab(1, {
        cookieStoreId: "firefox-container-1",
        url: "https://example.com/page",
      }),
      tab(2, {
        cookieStoreId: "firefox-container-2",
        url: "https://example.com/page",
      }),
    ];

    expect(
      findDuplicateGroups(
        tabs,
        settings({ containerScope: "within-container" }),
      ),
    ).toEqual([]);
    expect(
      findDuplicateGroups(
        tabs,
        settings({ containerScope: "across-containers" }),
      )[0]?.tabs.map(({ id }) => id),
    ).toEqual([1, 2]);
  });

  it("returns stable keys, tab order, and ties regardless of input order", () => {
    const tabs = [
      tab(30, { url: "https://example.com/page" }),
      tab(10, { url: "https://example.com/page" }),
      tab(20, { url: "https://example.com/page" }),
    ];

    const forward = findDuplicateGroups(tabs, settings());
    const reverse = findDuplicateGroups([...tabs].reverse(), settings());

    expect(reverse).toEqual(forward);
    expect(forward[0]?.tabs.map(({ id }) => id)).toEqual([10, 20, 30]);
    expect(forward[0]?.retainedTabId).toBe(10);
    expect(forward[0]?.closableTabIds).toEqual([20, 30]);
  });

  it("forms a deterministic transitive group across fuzzy and URL-rule matches", () => {
    const tabs = [
      tab(30, {
        url: "https://example.com/items/two",
        title: "Unrelated",
      }),
      tab(10, {
        url: "https://one.example/",
        title: "Quarterly Report",
      }),
      tab(20, {
        url: "https://example.com/items/one",
        title: "Quarterly Reports",
      }),
    ];
    const matchingSettings = settings({
      titleMatchMode: "url-or-title",
      titleSimilarityThreshold: 90,
      urlRules: JSON.stringify([
        { type: "group", pattern: "https://example.com/items/*" },
      ]),
    });

    const forward = findDuplicateGroups(tabs, matchingSettings);
    const reverse = findDuplicateGroups([...tabs].reverse(), matchingSettings);

    expect(reverse).toEqual(forward);
    expect(forward).toHaveLength(1);
    expect(forward[0]?.tabs.map(({ id }) => id)).toEqual([10, 20, 30]);
    expect(forward[0]?.key).toBe(
      "title:quarterly report|window:1",
    );
  });

  it("orders groups by code units without consulting localeCompare", () => {
    const localeCompare = vi
      .spyOn(String.prototype, "localeCompare")
      .mockImplementation(function (this: string, other: string) {
        const value = String(this);
        return value < other ? 1 : value > other ? -1 : 0;
      });

    try {
      const groups = findDuplicateGroups(
        [
          tab(1, { url: "https://example.com/a" }),
          tab(2, { url: "https://example.com/a" }),
          tab(3, { url: "https://example.com/Z" }),
          tab(4, { url: "https://example.com/Z" }),
        ],
        settings(),
      );

      expect(groups.map(({ key }) => key)).toEqual([
        "url:https://example.com/Z|window:1",
        "url:https://example.com/a|window:1",
      ]);
    } finally {
      localeCompare.mockRestore();
    }
  });
});

describe("selectRetainedTab", () => {
  it("keeps a pinned tab before every lower priority", () => {
    const retained = selectRetainedTab(
      [
        tab(1, {
          active: true,
          url: "https://example.com/page",
          lastAccessed: 2_000,
        }),
        tab(2, {
          pinned: true,
          url: "http://example.com/page",
          lastAccessed: 1_000,
        }),
      ],
      settings({
        keepPinnedTab: true,
        keepActiveTab: true,
        preferHttps: true,
        agePreference: "newer",
        prioritizeActiveWindow: true,
      }),
      1,
    );

    expect(retained?.id).toBe(2);
  });

  it("keeps the active tab when candidates share a window", () => {
    const retained = selectRetainedTab(
      [
        tab(1, {
          url: "https://example.com/page",
          lastAccessed: 2_000,
        }),
        tab(2, {
          active: true,
          url: "http://example.com/page",
          lastAccessed: 1_000,
        }),
      ],
      settings({
        keepActiveTab: true,
        preferHttps: true,
        agePreference: "newer",
      }),
      1,
    );

    expect(retained?.id).toBe(2);
  });

  it("keeps HTTPS before the configured age preference", () => {
    const retained = selectRetainedTab(
      [
        tab(1, {
          url: "http://example.com/page",
          lastAccessed: 2_000,
        }),
        tab(2, {
          url: "https://example.com/page",
          lastAccessed: 1_000,
        }),
      ],
      settings({ preferHttps: true, agePreference: "newer" }),
      1,
    );

    expect(retained?.id).toBe(2);
  });

  it("uses lastAccessed to keep the older tab", () => {
    expect(
      selectRetainedTab(
        [
          tab(1, { lastAccessed: 2_000 }),
          tab(2, { lastAccessed: 1_000 }),
        ],
        settings({ agePreference: "older" }),
        1,
      )?.id,
    ).toBe(2);
  });

  it("uses lastAccessed to keep the newer tab", () => {
    expect(
      selectRetainedTab(
        [
          tab(1, { lastAccessed: 1_000 }),
          tab(2, { lastAccessed: 2_000 }),
        ],
        settings({ agePreference: "newer" }),
        1,
      )?.id,
    ).toBe(2);
  });

  it("applies age before active-window preference across windows", () => {
    const retained = selectRetainedTab(
      [
        tab(1, { windowId: 1, lastAccessed: 2_000 }),
        tab(2, { windowId: 2, lastAccessed: 1_000 }),
      ],
      settings({
        agePreference: "older",
        prioritizeActiveWindow: true,
      }),
      1,
    );

    expect(retained?.id).toBe(2);
  });

  it("uses the active window across windows after an age tie", () => {
    const retained = selectRetainedTab(
      [
        tab(1, { windowId: 2, lastAccessed: 1_000 }),
        tab(2, { windowId: 1, lastAccessed: 1_000 }),
      ],
      settings({ prioritizeActiveWindow: true }),
      1,
    );

    expect(retained?.id).toBe(2);
  });

  it("ignores disabled pinned, active, HTTPS, and active-window priorities", () => {
    const retained = selectRetainedTab(
      [
        tab(1, {
          windowId: 1,
          pinned: true,
          active: true,
          url: "https://example.com/page",
          lastAccessed: 2_000,
        }),
        tab(2, {
          windowId: 2,
          url: "http://example.com/page",
          lastAccessed: 1_000,
        }),
      ],
      settings({
        keepPinnedTab: false,
        keepActiveTab: false,
        preferHttps: false,
        agePreference: "older",
        prioritizeActiveWindow: false,
      }),
      1,
    );

    expect(retained?.id).toBe(2);
  });

  it("breaks complete ties by tab ID instead of input order", () => {
    const tabs = [
      tab(30, { windowId: 2 }),
      tab(10, { windowId: 2 }),
      tab(20, { windowId: 2 }),
    ];

    expect(selectRetainedTab(tabs, settings(), 1)?.id).toBe(10);
    expect(
      selectRetainedTab([...tabs].reverse(), settings(), 1)?.id,
    ).toBe(10);
  });

  it("continues from same-window active filtering into HTTPS and age", () => {
    const retained = selectRetainedTab(
      [
        tab(1, {
          windowId: 1,
          active: true,
          url: "http://example.com/page",
          lastAccessed: 4_000,
        }),
        tab(2, {
          windowId: 1,
          url: "https://example.com/page",
          lastAccessed: 5_000,
        }),
        tab(3, {
          windowId: 2,
          currentWindow: false,
          url: "https://example.com/page",
          lastAccessed: 2_000,
        }),
        tab(4, {
          windowId: 3,
          currentWindow: false,
          url: "https://example.com/page",
          lastAccessed: 3_000,
        }),
      ],
      settings({
        keepActiveTab: true,
        preferHttps: true,
        agePreference: "newer",
      }),
      1,
    );

    expect(retained?.id).toBe(4);
  });
});
