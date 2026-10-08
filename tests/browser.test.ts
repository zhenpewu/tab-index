import { describe, expect, it } from "vitest";

import { toTabRecord } from "../src/shared/browser";

function firefoxTab(
  overrides: Partial<browser.tabs.Tab> = {},
): browser.tabs.Tab {
  return {
    id: 12,
    index: 0,
    windowId: 4,
    highlighted: false,
    active: false,
    pinned: false,
    incognito: false,
    ...overrides,
  };
}

describe("toTabRecord", () => {
  it("maps Firefox tab fields into the domain record", () => {
    const record = toTabRecord(
      firefoxTab({
        id: 42,
        windowId: 7,
        active: true,
        pinned: true,
        url: "https://example.com/docs",
        title: "Example Docs",
        favIconUrl: "https://example.com/favicon.ico",
        lastAccessed: 1_234,
        status: "complete",
        incognito: true,
        cookieStoreId: "firefox-container-3",
      }),
      7,
    );

    expect(record).toEqual({
      id: 42,
      windowId: 7,
      currentWindow: true,
      cookieStoreId: "firefox-container-3",
      active: true,
      pinned: true,
      url: "https://example.com/docs",
      title: "Example Docs",
      favIconUrl: "https://example.com/favicon.ico",
      lastAccessed: 1_234,
      status: "complete",
      incognito: true,
    });
  });

  it("uses deterministic safe fallbacks for optional Firefox fields", () => {
    expect(
      toTabRecord(
        firefoxTab({
          id: 8,
          windowId: 9,
          status: "unloaded",
        }),
        4,
      ),
    ).toEqual({
      id: 8,
      windowId: 9,
      currentWindow: false,
      cookieStoreId: "firefox-default",
      active: false,
      pinned: false,
      url: "",
      title: "",
      lastAccessed: 0,
      incognito: false,
    });
  });

  it.each([
    firefoxTab({ id: undefined }),
    firefoxTab({ windowId: undefined }),
    firefoxTab({ id: Number.NaN }),
    firefoxTab({ windowId: Number.POSITIVE_INFINITY }),
  ])("ignores tabs without usable numeric IDs", (tab) => {
    expect(toTabRecord(tab, 4)).toBeUndefined();
  });
});
