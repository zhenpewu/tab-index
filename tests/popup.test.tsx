import { cleanup, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/domain/settings";
import type { Settings, TabRecord } from "../src/domain/types";
import { App } from "../src/popup/App";
import type {
  BackgroundRequest,
  MessageResult,
  PopupMode,
  TabSnapshot,
} from "../src/shared/messages";

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
    lastAccessed: id * 100,
    status: "complete",
    incognito: false,
    ...overrides,
  };
}

const duplicateTabs = [
  tab(1, {
    title: "Firefox Docs",
    url: "https://developer.mozilla.org/docs",
    lastAccessed: 100,
  }),
  tab(2, {
    title: "Firefox Docs Copy",
    url: "https://developer.mozilla.org/docs",
    lastAccessed: 200,
  }),
  tab(3, {
    title: "Quarterly Report",
    url: "https://work.example/report",
    pinned: true,
    lastAccessed: 300,
  }),
];

function snapshot(
  tabs: TabRecord[] = duplicateTabs,
  currentWindowId: number | null = 1,
): TabSnapshot {
  return { tabs, currentWindowId };
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

type CloseResult = MessageResult<{
  closedTabIds: number[];
  missingTabIds: number[];
  failedTabs: { tabId: number; message: string }[];
}>;

interface FakeBrowserOptions {
  mode?: PopupMode;
  settings?: Settings;
  snapshots?: TabSnapshot[];
  closeResults?: CloseResult[];
  currentWindow?: browser.windows.Window | Error;
  openOptionsResult?: MessageResult<null>;
  snapshotFailure?: Error;
}

function installFakeBrowser({
  mode = "duplicates",
  settings = { ...DEFAULT_SETTINGS },
  snapshots = [snapshot()],
  closeResults = [],
  openOptionsResult = { ok: true, data: null },
  snapshotFailure,
  currentWindow = {
    id: 1,
    type: "popup",
    focused: true,
    incognito: false,
    alwaysOnTop: false,
  },
}: FakeBrowserOptions = {}) {
  const requests: BackgroundRequest[] = [];
  let snapshotIndex = 0;
  let closeIndex = 0;

  const fakeBrowser = {
    windows: {
      async getCurrent() {
        if (currentWindow instanceof Error) {
          throw currentWindow;
        }
        return currentWindow;
      },
    },
    runtime: {
      async sendMessage(request: BackgroundRequest) {
        requests.push(request);
        switch (request.type) {
          case "consumePopupMode":
            return { ok: true, data: mode };
          case "getSettings":
            return { ok: true, data: settings };
          case "getSnapshot": {
            if (snapshotFailure) {
              throw snapshotFailure;
            }
            const value =
              snapshots[Math.min(snapshotIndex, snapshots.length - 1)] ??
              snapshot([]);
            snapshotIndex += 1;
            return { ok: true, data: value };
          }
          case "activateTab":
            return {
              ok: true,
              data: { tabId: request.tabId, windowId: 1 },
            };
          case "closeTabs": {
            const value = closeResults[closeIndex] ?? {
              ok: true,
              data: {
                closedTabIds: request.tabIds,
                missingTabIds: [],
                failedTabs: [],
              },
            };
            closeIndex += 1;
            return value;
          }
          case "openOptions":
            return openOptionsResult;
          default:
            throw new Error(`Unexpected request: ${request.type}`);
        }
      },
    },
  };

  vi.stubGlobal("browser", fakeBrowser);
  return { requests };
}

function requestOfType<T extends BackgroundRequest["type"]>(
  requests: BackgroundRequest[],
  type: T,
) {
  return requests.filter(
    (request): request is Extract<BackgroundRequest, { type: T }> =>
      request.type === type,
  );
}

afterEach(() => {
  cleanup();
  delete (
    HTMLElement.prototype as Partial<{
      scrollIntoView(options?: ScrollIntoViewOptions): void;
    }>
  ).scrollIntoView;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("popup startup and modes", () => {
  it("loads mode, settings, and a containing-window snapshot concurrently and defaults to Duplicates", async () => {
    const calls: string[] = [];
    const mode = deferred<MessageResult<PopupMode>>();
    const settings = deferred<MessageResult<Settings>>();
    const initialSnapshot = deferred<MessageResult<TabSnapshot>>();
    const requests: BackgroundRequest[] = [];

    vi.stubGlobal("browser", {
      windows: {
        async getCurrent() {
          calls.push("getCurrent");
          return { id: 7, type: "popup" };
        },
      },
      runtime: {
        sendMessage(request: BackgroundRequest) {
          requests.push(request);
          calls.push(request.type);
          if (request.type === "consumePopupMode") {
            return mode.promise;
          }
          if (request.type === "getSettings") {
            return settings.promise;
          }
          if (request.type === "getSnapshot") {
            return initialSnapshot.promise;
          }
          throw new Error(`Unexpected request: ${request.type}`);
        },
      },
    });

    render(h(App, null));

    await waitFor(() => expect(requests).toHaveLength(3));
    expect(calls).toEqual([
      "getCurrent",
      "consumePopupMode",
      "getSettings",
      "getSnapshot",
    ]);
    expect(requests).toContainEqual({
      type: "getSnapshot",
      currentWindowId: 7,
    });

    mode.resolve({ ok: true, data: "duplicates" });
    settings.resolve({ ok: true, data: { ...DEFAULT_SETTINGS } });
    initialSnapshot.resolve({ ok: true, data: snapshot() });

    const duplicates = await screen.findByRole("tab", {
      name: "Duplicates",
    });
    expect(duplicates.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Keep")).toBeTruthy();
    expect(document.activeElement).not.toBe(
      screen.getByRole("searchbox", { name: "Search tabs" }),
    );
  });

  it("omits currentWindowId when Firefox cannot provide the popup window", async () => {
    const { requests } = installFakeBrowser({
      currentWindow: new Error("Window unavailable"),
    });

    render(h(App, null));
    await screen.findByRole("tab", { name: "Duplicates" });

    expect(requestOfType(requests, "getSnapshot")).toEqual([
      { type: "getSnapshot" },
    ]);
  });

  it("shows a rejected startup request inline and keeps the popup usable", async () => {
    installFakeBrowser({
      snapshotFailure: new Error("Snapshot unavailable"),
    });

    render(h(App, null));

    expect(await screen.findByText("Snapshot unavailable")).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Duplicates" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("No duplicate tabs")).toBeTruthy();
  });

  it("opens an all-tabs handoff with search focused and filters All Tabs and Pinned through search", async () => {
    installFakeBrowser({ mode: "all-tabs" });
    const user = userEvent.setup();

    render(h(App, null));

    const search = await screen.findByRole("searchbox", {
      name: "Search tabs",
    });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(
      screen
        .getByRole("tab", { name: "All Tabs" })
        .getAttribute("aria-selected"),
    ).toBe("true");

    await user.type(search, "Quarterly");
    expect(
      screen.getByRole("listitem", { name: "Quarterly Report" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("listitem", { name: "Firefox Docs" }),
    ).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Pinned" }));
    expect(
      screen.getByRole("listitem", { name: "Quarterly Report" }),
    ).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(1);
  });

  it("switches a duplicate count into Duplicates and focuses the corresponding row", async () => {
    installFakeBrowser({ mode: "all-tabs" });
    const user = userEvent.setup();

    render(h(App, null));

    const badge = await screen.findByRole("button", {
      name: "Review 2 duplicates for Firefox Docs Copy",
    });
    await user.click(badge);

    expect(
      screen
        .getByRole("tab", { name: "Duplicates" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    const row = screen.getByRole("listitem", {
      name: "Firefox Docs Copy",
    });
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(row.getAttribute("data-selected")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("uses neutral list semantics for interactive rows and marks one current row", async () => {
    installFakeBrowser({ mode: "all-tabs" });

    render(h(App, null));

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
    expect(
      rows.filter((row) => row.getAttribute("aria-current") === "true"),
    ).toHaveLength(1);
    expect(
      rows.filter((row) => row.getAttribute("data-selected") === "true"),
    ).toHaveLength(1);
  });

  it("renders window section labels in sentence case", async () => {
    installFakeBrowser({
      mode: "all-tabs",
      snapshots: [
        snapshot([
          tab(1, { title: "Current tab" }),
          tab(2, {
            title: "Other tab",
            windowId: 2,
            currentWindow: false,
          }),
        ]),
      ],
    });

    render(h(App, null));

    expect(
      await screen.findByRole("heading", { name: "Current window" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Other windows" }),
    ).toBeTruthy();
  });

  it("opens Settings from a labeled compact header button", async () => {
    const { requests } = installFakeBrowser();
    const user = userEvent.setup();

    render(h(App, null));

    const settingsButton = await screen.findByRole("button", {
      name: "Open settings",
    });
    expect(settingsButton.getAttribute("title")).toBe("Open settings");
    await user.click(settingsButton);

    expect(requestOfType(requests, "openOptions")).toEqual([
      { type: "openOptions" },
    ]);
  });

  it("shows an open-Settings failure inline", async () => {
    installFakeBrowser({
      openOptionsResult: {
        ok: false,
        error: {
          code: "browser-error",
          message: "Settings unavailable",
          recoverable: true,
        },
      },
    });
    const user = userEvent.setup();

    render(h(App, null));
    await user.click(
      await screen.findByRole("button", { name: "Open settings" }),
    );

    expect(await screen.findByText("Settings unavailable")).toBeTruthy();
  });

  it("shows mode-specific empty states", async () => {
    installFakeBrowser({
      mode: "all-tabs",
      snapshots: [snapshot([tab(10, { title: "Only Tab" })])],
    });
    const user = userEvent.setup();

    render(h(App, null));
    const search = await screen.findByRole("searchbox", {
      name: "Search tabs",
    });

    await user.type(search, "missing");
    expect(screen.getByText("No tabs found")).toBeTruthy();

    await user.clear(search);
    await user.click(screen.getByRole("tab", { name: "Pinned" }));
    expect(screen.getByText("No pinned tabs")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Duplicates" }));
    expect(screen.getByText("No duplicate tabs")).toBeTruthy();
  });

  it("filters duplicate groups to fuzzy title and URL matches", async () => {
    const tabs = [
      tab(1, {
        title: "MDN Reference",
        url: "https://developer.mozilla.org/docs",
        lastAccessed: 100,
      }),
      tab(2, {
        title: "Firefox Docs Copy",
        url: "https://developer.mozilla.org/docs",
        lastAccessed: 200,
      }),
      duplicateTabs[2],
      tab(4, {
        title: "News",
        url: "https://news.example/",
        lastAccessed: 100,
      }),
      tab(5, {
        title: "News Copy",
        url: "https://news.example/",
        lastAccessed: 200,
      }),
    ];
    installFakeBrowser({ snapshots: [snapshot(tabs)] });
    const user = userEvent.setup();

    render(h(App, null));
    const search = await screen.findByRole("searchbox", {
      name: "Search tabs",
    });
    await user.type(search, "firefox docs cpy");

    expect(
      screen.getByRole("listitem", { name: "Firefox Docs Copy" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("listitem", { name: "MDN Reference" }),
    ).toBeNull();
    expect(screen.queryByRole("listitem", { name: "News" })).toBeNull();
    expect(screen.queryByRole("listitem", { name: "News Copy" })).toBeNull();

    await user.clear(search);
    await user.type(search, "news.example");
    expect(screen.getByRole("listitem", { name: "News" })).toBeTruthy();
    expect(
      screen.getByRole("listitem", { name: "News Copy" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("listitem", { name: "MDN Reference" }),
    ).toBeNull();
  });
});

describe("popup keyboard and actions", () => {
  it("moves selection through visible rows and Enter activates the selected tab", async () => {
    const { requests } = installFakeBrowser({ mode: "all-tabs" });
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByRole("searchbox", {
      name: "Search tabs",
    });
    await screen.findByRole("listitem", { name: "Firefox Docs" });

    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() =>
      expect(
        screen
          .getByRole("listitem", { name: "Firefox Docs Copy" })
          .getAttribute("aria-current"),
      ).toBe("true"),
    );
    await waitFor(() =>
      expect(requestOfType(requests, "activateTab")).toEqual([
        { type: "activateTab", tabId: 2 },
      ]),
    );
  });

  it("keeps selection valid when a query changes the visible rows", async () => {
    installFakeBrowser({ mode: "all-tabs" });
    const user = userEvent.setup();

    render(h(App, null));
    const search = await screen.findByRole("searchbox", {
      name: "Search tabs",
    });
    await user.type(search, "Quarterly");

    const selected = screen.getByRole("listitem", {
      name: "Quarterly Report",
    });
    expect(selected.getAttribute("aria-current")).toBe("true");
  });

  it("scrolls keyboard selection into view", async () => {
    const scrolledIds: string[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value(this: HTMLElement, options?: ScrollIntoViewOptions) {
        if (options?.block === "nearest") {
          scrolledIds.push(this.id);
        }
      },
    });
    installFakeBrowser({ mode: "all-tabs" });
    const user = userEvent.setup();

    render(h(App, null));
    const search = await screen.findByRole("searchbox", {
      name: "Search tabs",
    });
    await waitFor(() => expect(document.activeElement).toBe(search));
    scrolledIds.length = 0;

    await user.keyboard("{ArrowDown}");

    await waitFor(() => expect(scrolledIds).toContain("popup-tab-2"));
  });

  it("Delete closes a selected non-retained tab and refreshes the snapshot", async () => {
    const { requests } = installFakeBrowser({
      mode: "all-tabs",
      snapshots: [
        snapshot(),
        snapshot(duplicateTabs.filter(({ id }) => id !== 2)),
      ],
    });
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByRole("listitem", { name: "Firefox Docs" });

    await user.keyboard("{ArrowDown}{Delete}");

    await waitFor(() =>
      expect(requestOfType(requests, "closeTabs")).toEqual([
        { type: "closeTabs", tabIds: [2] },
      ]),
    );
    await waitFor(() =>
      expect(requestOfType(requests, "getSnapshot")).toHaveLength(2),
    );
    expect(
      screen.queryByRole("listitem", { name: "Firefox Docs Copy" }),
    ).toBeNull();
  });

  it("keeps forward Delete as text editing in the search input", async () => {
    const { requests } = installFakeBrowser({ mode: "all-tabs" });
    const user = userEvent.setup();

    render(h(App, null));
    const search = (await screen.findByRole("searchbox", {
      name: "Search tabs",
    })) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(search));
    await user.type(search, "Report");
    search.setSelectionRange(0, 0);

    await user.keyboard("{Delete}");

    expect(search.value).toBe("eport");
    expect(requestOfType(requests, "closeTabs")).toEqual([]);
  });

  it("never closes a retained row from Delete but permits its own close button", async () => {
    const { requests } = installFakeBrowser({
      mode: "duplicates",
      snapshots: [
        snapshot(),
        snapshot(duplicateTabs.filter(({ id }) => id !== 1)),
      ],
    });
    const user = userEvent.setup();

    render(h(App, null));
    const retained = await screen.findByRole("listitem", {
      name: "Firefox Docs",
    });
    retained.focus();

    await user.keyboard("{Delete}");
    expect(requestOfType(requests, "closeTabs")).toEqual([]);

    await user.click(
      within(retained).getByRole("button", {
        name: "Close Firefox Docs",
      }),
    );
    await waitFor(() =>
      expect(requestOfType(requests, "closeTabs")).toEqual([
        { type: "closeTabs", tabIds: [1] },
      ]),
    );
  });

  it("group close sends only that group's non-retained IDs", async () => {
    const { requests } = installFakeBrowser({
      snapshots: [
        snapshot(),
        snapshot(duplicateTabs.filter(({ id }) => id !== 2)),
      ],
    });
    const user = userEvent.setup();

    render(h(App, null));
    const closeGroup = await screen.findByRole("button", {
      name: "Close 1 duplicate in group",
    });
    await user.click(closeGroup);

    await waitFor(() =>
      expect(requestOfType(requests, "closeTabs")).toEqual([
        { type: "closeTabs", tabIds: [2] },
      ]),
    );
  });

  it("filtered group close sends only visible matching non-retained rows", async () => {
    const tabs = [
      duplicateTabs[0]!,
      duplicateTabs[1]!,
      tab(6, {
        title: "Firefox Docs Third",
        url: "https://developer.mozilla.org/docs",
        lastAccessed: 300,
      }),
    ];
    const { requests } = installFakeBrowser({
      snapshots: [snapshot(tabs), snapshot([tabs[0]!, tabs[1]!])],
    });
    const user = userEvent.setup();

    render(h(App, null));
    const search = await screen.findByRole("searchbox", {
      name: "Search tabs",
    });
    await user.type(search, "Third");
    await user.click(
      screen.getByRole("button", {
        name: "Close 1 duplicate in group",
      }),
    );

    await waitFor(() =>
      expect(requestOfType(requests, "closeTabs")).toEqual([
        { type: "closeTabs", tabIds: [6] },
      ]),
    );
  });

  it("close all sends every non-retained ID and no retained IDs", async () => {
    const tabs = [
      ...duplicateTabs,
      tab(4, {
        title: "News",
        url: "https://news.example/",
        lastAccessed: 100,
      }),
      tab(5, {
        title: "News Copy",
        url: "https://news.example/",
        lastAccessed: 200,
      }),
    ];
    const { requests } = installFakeBrowser({
      snapshots: [snapshot(tabs), snapshot([tabs[0]!, tabs[2]!, tabs[3]!])],
    });
    const user = userEvent.setup();

    render(h(App, null));
    const closeAll = await screen.findByRole("button", {
      name: "Close all 2 duplicates",
    });
    await user.click(closeAll);

    await waitFor(() =>
      expect(requestOfType(requests, "closeTabs")).toEqual([
        { type: "closeTabs", tabIds: [2, 5] },
      ]),
    );
    expect(requestOfType(requests, "closeTabs")[0]?.tabIds).not.toContain(1);
    expect(requestOfType(requests, "closeTabs")[0]?.tabIds).not.toContain(4);
  });

  it("filtered close all excludes hidden closable rows and retained rows", async () => {
    const tabs = [
      ...duplicateTabs,
      tab(4, {
        title: "News",
        url: "https://news.example/",
        lastAccessed: 100,
      }),
      tab(5, {
        title: "News Copy",
        url: "https://news.example/",
        lastAccessed: 200,
      }),
      tab(6, {
        title: "Firefox Docs Third",
        url: "https://developer.mozilla.org/docs",
        lastAccessed: 300,
      }),
    ];
    const { requests } = installFakeBrowser({
      snapshots: [
        snapshot(tabs),
        snapshot([tabs[0]!, tabs[2]!, tabs[3]!, tabs[5]!]),
      ],
    });
    const user = userEvent.setup();

    render(h(App, null));
    const search = await screen.findByRole("searchbox", {
      name: "Search tabs",
    });
    await user.type(search, "Copy");
    await user.click(
      screen.getByRole("button", {
        name: "Close all 2 duplicates",
      }),
    );

    await waitFor(() =>
      expect(requestOfType(requests, "closeTabs")).toEqual([
        { type: "closeTabs", tabIds: [2, 5] },
      ]),
    );
    expect(requestOfType(requests, "closeTabs")[0]?.tabIds).not.toContain(1);
    expect(requestOfType(requests, "closeTabs")[0]?.tabIds).not.toContain(4);
    expect(requestOfType(requests, "closeTabs")[0]?.tabIds).not.toContain(6);
  });

  it("refreshes after partial close results, hides missing tabs, and reports failed entries inline", async () => {
    const { requests } = installFakeBrowser({
      snapshots: [
        snapshot([
          duplicateTabs[0]!,
          duplicateTabs[1]!,
          tab(6, {
            title: "Firefox Docs Third",
            url: "https://developer.mozilla.org/docs",
            lastAccessed: 300,
          }),
        ]),
        snapshot([duplicateTabs[0]!, duplicateTabs[1]!]),
      ],
      closeResults: [
        {
          ok: true,
          data: {
            closedTabIds: [],
            missingTabIds: [6],
            failedTabs: [{ tabId: 2, message: "Permission denied" }],
          },
        },
      ],
    });
    const user = userEvent.setup();

    render(h(App, null));
    await user.click(
      await screen.findByRole("button", {
        name: "Close all 2 duplicates",
      }),
    );

    await waitFor(() =>
      expect(requestOfType(requests, "getSnapshot")).toHaveLength(2),
    );
    expect(
      await screen.findByText(
        "Could not close Firefox Docs Copy: Permission denied",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Firefox Docs Third.*could not/i)).toBeNull();
    expect(
      screen.queryByRole("listitem", { name: "Firefox Docs Third" }),
    ).toBeNull();
  });

  it("refreshes after an unsuccessful close response and reports its error inline", async () => {
    const { requests } = installFakeBrowser({
      snapshots: [snapshot(), snapshot()],
      closeResults: [
        {
          ok: false,
          error: {
            code: "browser-error",
            message: "Close unavailable",
            recoverable: true,
          },
        },
      ],
    });
    const user = userEvent.setup();

    render(h(App, null));
    await user.click(
      await screen.findByRole("button", {
        name: "Close 1 duplicate in group",
      }),
    );

    await waitFor(() =>
      expect(requestOfType(requests, "getSnapshot")).toHaveLength(2),
    );
    expect(await screen.findByText("Close unavailable")).toBeTruthy();
  });

  it("Escape clears the query before closing the popup and Backspace remains text editing", async () => {
    installFakeBrowser({ mode: "all-tabs" });
    const closePopup = vi
      .spyOn(window, "close")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();

    render(h(App, null));
    const search = await screen.findByRole("searchbox", {
      name: "Search tabs",
    });
    await user.type(search, "Report");
    await user.keyboard("{Backspace}");
    expect((search as HTMLInputElement).value).toBe("Repor");
    expect(closePopup).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect((search as HTMLInputElement).value).toBe("");
    expect(closePopup).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    expect(closePopup).toHaveBeenCalledTimes(1);
  });

  it("row activation and icon-only controls expose accessible state, labels, and tooltips", async () => {
    const { requests } = installFakeBrowser({ mode: "all-tabs" });
    const user = userEvent.setup();

    render(h(App, null));
    const row = await screen.findByRole("listitem", {
      name: "Quarterly Report",
    });
    await user.click(row);

    expect(requestOfType(requests, "activateTab")).toContainEqual({
      type: "activateTab",
      tabId: 3,
    });
    const closeButton = within(row).getByRole("button", {
      name: "Close Quarterly Report",
    });
    expect(closeButton.getAttribute("title")).toBe("Close tab");
  });

  it("lets a focused row close button handle Enter without also activating the tab", async () => {
    const { requests } = installFakeBrowser({
      mode: "all-tabs",
      snapshots: [
        snapshot(),
        snapshot(duplicateTabs.filter(({ id }) => id !== 2)),
      ],
    });
    const user = userEvent.setup();

    render(h(App, null));
    const search = await screen.findByRole("searchbox", {
      name: "Search tabs",
    });
    await waitFor(() => expect(document.activeElement).toBe(search));
    const row = await screen.findByRole("listitem", {
      name: "Firefox Docs Copy",
    });
    const closeButton = within(row).getByRole("button", {
      name: "Close Firefox Docs Copy",
    });
    closeButton.focus();

    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(requestOfType(requests, "closeTabs")).toEqual([
        { type: "closeTabs", tabIds: [2] },
      ]),
    );
    expect(requestOfType(requests, "activateTab")).toEqual([]);
  });
});

describe("popup theme and density", () => {
  it("defines exact density sizes, native theme media, reduced motion, and the 420px popup cap", () => {
    const themeCss = readFileSync(
      resolve(process.cwd(), "src/shared/theme.css"),
      "utf8",
    );
    const popupCss = readFileSync(
      resolve(process.cwd(), "src/popup/popup.css"),
      "utf8",
    );

    expect(themeCss).toContain("--font-size: 13px");
    expect(themeCss).toContain("--row-height: 36px");
    expect(themeCss).toMatch(
      /\[data-density="comfortable"\][\s\S]*--font-size: 14px[\s\S]*--row-height: 40px/,
    );
    expect(themeCss).toMatch(
      /\[data-density="dense"\][\s\S]*--font-size: 12px[\s\S]*--row-height: 32px/,
    );
    expect(themeCss).toContain("@media (prefers-color-scheme: dark)");
    expect(themeCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(popupCss).toMatch(
      /\.popup\s*\{[^}]*width:\s*420px;[^}]*max-width:\s*100vw;/,
    );
    expect(popupCss).toMatch(
      /\.popup\s*\{[\s\S]*font-size:\s*var\(--font-size\)/,
    );
    expect(popupCss).not.toContain("text-transform: uppercase");
    expect(`${themeCss}\n${popupCss}`).not.toMatch(/purple|pink/i);
  });
});
