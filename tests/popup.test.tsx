import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
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
  saveSettingsResult?:
    | MessageResult<Settings>
    | Promise<MessageResult<Settings>>;
  snapshotFailure?: Error;
}

function installFakeBrowser({
  mode = "duplicates",
  settings = { ...DEFAULT_SETTINGS },
  snapshots = [snapshot()],
  closeResults = [],
  openOptionsResult = { ok: true, data: null },
  saveSettingsResult,
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
  let storedSettings = settings;

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
          case "closeDuplicateGroups": {
            const value = closeResults[closeIndex] ?? {
              ok: true,
              data: {
                closedTabIds: [],
                missingTabIds: [],
                failedTabs: [],
              },
            };
            closeIndex += 1;
            return value;
          }
          case "openOptions":
            return openOptionsResult;
          case "saveSettings":
            return (
              saveSettingsResult ?? {
                ok: true,
                data: request.settings,
              }
            );
          case "patchSettings":
            if (saveSettingsResult) {
              return saveSettingsResult;
            }
            storedSettings = { ...storedSettings, ...request.patch };
            return { ok: true, data: storedSettings };
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
  it("keeps the header outside the scrollable results region", () => {
    installFakeBrowser();

    const { container } = render(h(App, null));

    expect(container.querySelector(".popup > .popup-topbar")).not.toBeNull();
    expect(
      container.querySelector(
        ".popup > .popup-content > .popup-primary > .popup-search",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        ".popup > .popup-content > .popup-primary > .popup-results",
      ),
    ).not.toBeNull();
  });

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
    expect(
      screen.queryByRole("button", { name: "Duplicate options" }),
    ).toBeNull();
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

  it("initially selects the active Firefox tab instead of the first visible row", async () => {
    installFakeBrowser({
      mode: "all-tabs",
      snapshots: [
        snapshot([
          tab(1, { title: "First visible tab" }),
          tab(2, { title: "Active tab", active: true }),
          tab(3, { title: "Last visible tab" }),
        ]),
      ],
    });

    render(h(App, null));

    expect(
      (await screen.findByRole("listitem", { name: "Active tab" }))
        .getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen
        .getByRole("listitem", { name: "First visible tab" })
        .getAttribute("data-selected"),
    ).toBe("false");
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

  it("keeps the global settings button while Duplicates uses its permanent side pane", async () => {
    const { requests } = installFakeBrowser({ mode: "all-tabs" });
    const user = userEvent.setup();

    render(h(App, null));

    const globalSettings = await screen.findByRole("button", {
      name: "Open settings",
    });
    expect(
      screen.queryByRole("button", { name: "Duplicate options" }),
    ).toBeNull();

    await user.click(globalSettings);
    expect(requestOfType(requests, "openOptions")).toEqual([
      { type: "openOptions" },
    ]);

    await user.click(screen.getByRole("tab", { name: "Duplicates" }));
    expect(
      screen.queryByRole("button", { name: "Duplicate options" }),
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: "Duplicate settings" }),
    ).toBeTruthy();
  });

  it("shows the duplicate side pane permanently below the top bar", async () => {
    const { requests } = installFakeBrowser({ mode: "all-tabs" });
    const user = userEvent.setup();

    const { container } = render(h(App, null));

    await screen.findByRole("listitem", { name: "Firefox Docs" });
    expect(
      screen.queryByRole("button", { name: "Duplicate options" }),
    ).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Duplicates" }));

    expect(
      screen.getByRole("region", { name: "Duplicate settings" }),
    ).toBeTruthy();
    const content = container.querySelector(".popup > .popup-content");
    expect(content).not.toBeNull();
    expect(
      content?.querySelector(":scope > .popup-primary .duplicate-toolbar"),
    ).not.toBeNull();
    const duplicateSettings = content?.querySelector(
      ":scope > .duplicate-settings-pane",
    );
    expect(duplicateSettings).not.toBeNull();
    expect(
      container.querySelector(".popup > .popup-topbar"),
    ).not.toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search tabs" })).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Duplicates" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByText("1 group")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Match duplicates by" }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Title similarity",
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(requestOfType(requests, "openOptions")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "More settings" }));
    expect(requestOfType(requests, "openOptions")).toEqual([
      { type: "openOptions" },
    ]);
  });

  it("disables permanent duplicate controls until stored settings finish loading", () => {
    render(h(App, null));

    expect(
      (
        screen.getByRole("combobox", {
          name: "Match duplicates by",
        }) as HTMLSelectElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps the permanent duplicate pane when the selected tab is clicked again", async () => {
    installFakeBrowser();
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByRole("region", { name: "Duplicate settings" });
    await user.click(screen.getByRole("tab", { name: "Duplicates" }));

    expect(
      screen.getByRole("region", { name: "Duplicate settings" }),
    ).toBeTruthy();
  });

  it("shows an open-Settings failure inline from the compact pane", async () => {
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
    await screen.findByRole("region", { name: "Duplicate settings" });
    await user.click(screen.getByRole("button", { name: "More settings" }));

    expect(await screen.findByText("Settings unavailable")).toBeTruthy();
  });

  it("saves duplicate mode immediately and recomputes groups with sanitized resources", async () => {
    const tabs = [
      tab(1, {
        title: "Tool workspace",
        url: "https://work.example/projects/tool/logs?session=one",
      }),
      tab(2, {
        title: "Tool workspace",
        url: "https://work.example/projects/tool/files/main/build?session=two",
      }),
    ];
    const { requests } = installFakeBrowser({
      snapshots: [snapshot(tabs)],
    });
    const user = userEvent.setup();

    render(h(App, null));

    expect(await screen.findByText("No duplicate tabs")).toBeTruthy();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Match duplicates by" }),
      "url-or-title",
    );

    await waitFor(() =>
      expect(requestOfType(requests, "patchSettings")).toEqual([
        {
          type: "patchSettings",
          patch: { titleMatchMode: "url-or-title" },
        },
      ]),
    );

    expect(screen.getByText("1 group")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("enables and saves title similarity only for fuzzy title matching", async () => {
    const { requests } = installFakeBrowser({
      settings: {
        ...DEFAULT_SETTINGS,
        titleMatchMode: "url-or-title",
        titleSimilarityThreshold: 90,
      },
    });
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByText("1 group");

    const threshold = screen.getByRole("spinbutton", {
      name: "Title similarity",
    }) as HTMLInputElement;
    await waitFor(() => {
      expect(threshold.disabled).toBe(false);
      expect(threshold.value).toBe("90");
    });

    await user.clear(threshold);
    await user.type(threshold, "96");
    expect(threshold.value).toBe("96");
    expect(requestOfType(requests, "patchSettings")).toEqual([]);

    await waitFor(() =>
      expect(requestOfType(requests, "patchSettings")).toEqual([
        {
          type: "patchSettings",
          patch: { titleSimilarityThreshold: 96 },
        },
      ]),
    );
  });

  it("flushes a pending similarity edit when leaving Duplicates", async () => {
    const { requests } = installFakeBrowser({
      settings: {
        ...DEFAULT_SETTINGS,
        titleMatchMode: "url-or-title",
        titleSimilarityThreshold: 90,
      },
    });
    const user = userEvent.setup();

    render(h(App, null));
    const threshold = (await screen.findByRole("spinbutton", {
      name: "Title similarity",
    })) as HTMLInputElement;
    await waitFor(() => expect(threshold.value).toBe("90"));
    await user.clear(threshold);
    await user.type(threshold, "96");
    await user.click(screen.getByRole("tab", { name: "All Tabs" }));

    await waitFor(() =>
      expect(requestOfType(requests, "patchSettings")).toContainEqual({
        type: "patchSettings",
        patch: { titleSimilarityThreshold: 96 },
      }),
    );
  });

  it("queues a similarity edit behind another settings save", async () => {
    const firstSave = deferred<MessageResult<Settings>>();
    const { requests } = installFakeBrowser({
      settings: {
        ...DEFAULT_SETTINGS,
        titleMatchMode: "url-or-title",
        titleSimilarityThreshold: 90,
      },
      saveSettingsResult: firstSave.promise,
    });
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByText("1 group");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Keep tab by age" }),
      "newer",
    );
    expect(await screen.findByText("Saving…")).toBeTruthy();

    const threshold = screen.getByRole("spinbutton", {
      name: "Title similarity",
    }) as HTMLInputElement;
    expect(threshold.disabled).toBe(false);
    await user.clear(threshold);
    await user.type(threshold, "96");

    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(requestOfType(requests, "patchSettings")).toEqual([
      {
        type: "patchSettings",
        patch: { agePreference: "newer" },
      },
    ]);

    firstSave.resolve({
      ok: true,
      data: {
        ...DEFAULT_SETTINGS,
        titleMatchMode: "url-or-title",
        titleSimilarityThreshold: 90,
        agePreference: "newer",
      },
    });

    await waitFor(() =>
      expect(requestOfType(requests, "patchSettings")).toEqual([
        {
          type: "patchSettings",
          patch: { agePreference: "newer" },
        },
        {
          type: "patchSettings",
          patch: { titleSimilarityThreshold: 96 },
        },
      ]),
    );
  });

  it("shows keep-priority and toolbar badge controls in the left pane", async () => {
    installFakeBrowser();
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByRole("region", { name: "Duplicate settings" });

    expect(
      (
        screen.getByRole("combobox", {
          name: "Keep tab by age",
        }) as HTMLSelectElement
      ).value,
    ).toBe("older");
    expect(
      (
        screen.getByRole("combobox", {
          name: "Toolbar badge",
        }) as HTMLSelectElement
      ).value,
    ).toBe("duplicate-tabs");
    for (const name of [
      "Prefer HTTPS",
      "Keep pinned tab",
      "Keep active tab",
      "Prefer tab in active window",
    ]) {
      expect(
        (screen.getByRole("checkbox", { name }) as HTMLInputElement)
          .checked,
      ).toBe(true);
    }
  });

  it("saves badge mode immediately from the compact pane", async () => {
    const { requests } = installFakeBrowser();
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByRole("region", { name: "Duplicate settings" });
    const badgeMode = screen.getByRole("combobox", {
      name: "Toolbar badge",
    }) as HTMLSelectElement;
    await waitFor(() => expect(badgeMode.disabled).toBe(false));
    await user.selectOptions(
      badgeMode,
      "all-tabs",
    );

    await waitFor(() =>
      expect(requestOfType(requests, "patchSettings")).toContainEqual({
        type: "patchSettings",
        patch: { badgeCountMode: "all-tabs" },
      }),
    );
  });

  it("updates the retained tab when keep priority changes", async () => {
    const { requests } = installFakeBrowser();
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByRole("region", { name: "Duplicate settings" });
    const agePreference = screen.getByRole("combobox", {
      name: "Keep tab by age",
    }) as HTMLSelectElement;
    await waitFor(() => expect(agePreference.disabled).toBe(false));
    await user.selectOptions(
      agePreference,
      "newer",
    );

    await waitFor(() =>
      expect(requestOfType(requests, "patchSettings")).toContainEqual({
        type: "patchSettings",
        patch: { agePreference: "newer" },
      }),
    );
    expect(
      within(
        screen.getByRole("listitem", { name: "Firefox Docs Copy" }),
      ).getByText("Keep"),
    ).toBeTruthy();
  });

  it("mutes only tabs currently considered for removal", async () => {
    installFakeBrowser();

    render(h(App, null));

    const retained = await screen.findByRole("listitem", {
      name: "Firefox Docs",
    });
    const removalCandidate = screen.getByRole("listitem", {
      name: "Firefox Docs Copy",
    });

    expect(retained.classList.contains("is-removal-candidate")).toBe(false);
    expect(
      removalCandidate.classList.contains("is-removal-candidate"),
    ).toBe(true);
  });

  it("restores duplicate settings when an immediate save fails", async () => {
    installFakeBrowser({
      saveSettingsResult: {
        ok: false,
        error: {
          code: "browser-error",
          message: "Settings could not be saved",
          recoverable: true,
        },
      },
    });
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByRole("region", { name: "Duplicate settings" });
    const mode = screen.getByRole("combobox", {
      name: "Match duplicates by",
    }) as HTMLSelectElement;
    await waitFor(() => expect(mode.disabled).toBe(false));
    await user.selectOptions(mode, "url-or-title");

    expect(await screen.findByText("Settings could not be saved")).toBeTruthy();
    expect(mode.value).toBe("url-only");
  });

  it("keeps permanent duplicate settings visible while Escape clears search", async () => {
    installFakeBrowser();
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined);
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByRole("region", { name: "Duplicate settings" });
    const search = screen.getByRole("searchbox", {
      name: "Search tabs",
    }) as HTMLInputElement;
    await user.click(search);
    await user.type(search, "docs");
    await user.keyboard("{Escape}");

    expect(
      screen.getByRole("region", { name: "Duplicate settings" }),
    ).toBeTruthy();
    expect(search.value).toBe("");
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("leaves duplicate-settings keyboard events to their native controls", async () => {
    const { requests } = installFakeBrowser();
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByRole("region", { name: "Duplicate settings" });
    const mode = screen.getByRole("combobox", {
      name: "Match duplicates by",
    });

    expect(fireEvent.keyDown(mode, { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(mode, { key: "Enter" })).toBe(true);
    expect(requestOfType(requests, "activateTab")).toEqual([]);
  });

  it("keeps duplicate-list keyboard navigation active while settings are open", async () => {
    installFakeBrowser();
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByText("1 group");

    const first = screen.getByRole("listitem", {
      name: "Firefox Docs",
    });
    const second = screen.getByRole("listitem", {
      name: "Firefox Docs Copy",
    });
    first.focus();
    await user.keyboard("{ArrowDown}");

    expect(second.getAttribute("data-selected")).toBe("true");
  });

  it("blocks duplicate close actions while matching settings are saving", async () => {
    const save = deferred<MessageResult<Settings>>();
    const { requests } = installFakeBrowser({
      saveSettingsResult: save.promise,
    });
    const user = userEvent.setup();

    render(h(App, null));
    await screen.findByRole("region", { name: "Duplicate settings" });
    const matchMode = screen.getByRole("combobox", {
      name: "Match duplicates by",
    }) as HTMLSelectElement;
    await waitFor(() => expect(matchMode.disabled).toBe(false));
    await user.selectOptions(
      matchMode,
      "url-or-title",
    );
    expect(await screen.findByText("Saving…")).toBeTruthy();

    expect(
      (
        screen.getByRole("button", {
          name: "Close all 1 duplicate",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Close 1 duplicate in group",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(
        screen.getByRole("listitem", { name: "Firefox Docs Copy" }),
        ).getByRole("button", {
          name: "Close Firefox Docs Copy",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    screen.getByRole("listitem", { name: "Firefox Docs Copy" }).focus();
    await user.keyboard("{Delete}");
    expect(requestOfType(requests, "closeTabs")).toEqual([]);
    expect(requestOfType(requests, "closeDuplicateGroups")).toEqual([]);

    save.resolve({
      ok: true,
      data: {
        ...DEFAULT_SETTINGS,
        titleMatchMode: "url-or-title",
      },
    });
    await waitFor(() =>
      expect(screen.queryByText("Saving…")).toBeNull(),
    );
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

  it("Delete closes an explicitly selected retained row", async () => {
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
    await waitFor(() =>
      expect(requestOfType(requests, "closeTabs")).toEqual([
        { type: "closeTabs", tabIds: [1] },
      ]),
    );
  });

  it("group close asks the background to revalidate that duplicate group", async () => {
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
      expect(requestOfType(requests, "closeDuplicateGroups")).toEqual([
        {
          type: "closeDuplicateGroups",
          groupKeys: [
            "url:https://developer.mozilla.org/docs|window:1",
          ],
          settings: DEFAULT_SETTINGS,
          currentWindowId: 1,
        },
      ]),
    );
  });

  it("filtered group close still closes the complete revalidated group", async () => {
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
        name: "Close 2 duplicates in group",
      }),
    );

    await waitFor(() =>
      expect(requestOfType(requests, "closeDuplicateGroups")).toEqual([
        {
          type: "closeDuplicateGroups",
          groupKeys: [
            "url:https://developer.mozilla.org/docs|window:1",
          ],
          settings: DEFAULT_SETTINGS,
          currentWindowId: 1,
        },
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
    expect(closeAll.textContent).toBe("Close all");
    await user.click(closeAll);

    await waitFor(() =>
      expect(requestOfType(requests, "closeDuplicateGroups")).toEqual([
        {
          type: "closeDuplicateGroups",
          groupKeys: [
            "url:https://developer.mozilla.org/docs|window:1",
            "url:https://news.example|window:1",
          ],
          settings: DEFAULT_SETTINGS,
          currentWindowId: 1,
        },
      ]),
    );
  });

  it("filtered close all preserves complete group semantics", async () => {
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
        name: "Close all 3 duplicates",
      }),
    );

    await waitFor(() =>
      expect(requestOfType(requests, "closeDuplicateGroups")).toEqual([
        {
          type: "closeDuplicateGroups",
          groupKeys: [
            "url:https://developer.mozilla.org/docs|window:1",
            "url:https://news.example|window:1",
          ],
          settings: DEFAULT_SETTINGS,
          currentWindowId: 1,
        },
      ]),
    );
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
    expect(row.getAttribute("title")).toBe(
      "https://work.example/report",
    );
    expect(within(row).queryByText("work.example/report")).toBeNull();
    await user.click(row);

    expect(requestOfType(requests, "activateTab")).toContainEqual({
      type: "activateTab",
      tabId: 3,
    });
    const closeButton = within(row).getByRole("button", {
      name: "Close Quarterly Report",
    });
    expect(closeButton.getAttribute("title")).toBe("Close tab");
    expect(closeButton.querySelector("svg")).not.toBeNull();
    expect(closeButton.textContent).toBe("");
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
  it("defines exact density sizes, native theme media, reduced motion, and stable popup dimensions", () => {
    const themeCss = readFileSync(
      resolve(process.cwd(), "src/shared/theme.css"),
      "utf8",
    );
    const popupCss = readFileSync(
      resolve(process.cwd(), "src/popup/popup.css"),
      "utf8",
    );

    expect(themeCss).toContain("--font-size: 13px");
    expect(themeCss).toContain("--row-height: 32px");
    expect(themeCss).toMatch(
      /\[data-density="comfortable"\][\s\S]*--font-size: 14px[\s\S]*--row-height: 36px/,
    );
    expect(themeCss).toMatch(
      /\[data-density="dense"\][\s\S]*--font-size: 12px[\s\S]*--row-height: 28px/,
    );
    expect(themeCss).toContain("@media (prefers-color-scheme: dark)");
    expect(themeCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(popupCss).toMatch(
      /html,\s*body\s*\{[^}]*width:\s*460px;/,
    );
    expect(popupCss).toMatch(
      /html,\s*body\s*\{[^}]*background:\s*transparent;/,
    );
    expect(popupCss).toMatch(
      /\.popup\s*\{[^}]*width:\s*460px;[^}]*border-radius:\s*14px;[^}]*overflow:\s*hidden;/,
    );
    expect(popupCss).toMatch(
      /\.popup--settings\s*\{[^}]*width:\s*740px;/,
    );
    expect(popupCss).toMatch(
      /body:has\(\.popup--settings\)\s*\{[^}]*width:\s*740px;/,
    );
    expect(popupCss).toMatch(
      /\.popup-content\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*460px;/,
    );
    expect(popupCss).toMatch(
      /\.popup--settings \.popup-content\s*\{[^}]*grid-template-columns:\s*280px 460px;/,
    );
    expect(popupCss).toMatch(
      /\.duplicate-settings-pane\s*\{[^}]*grid-column:\s*1;/,
    );
    expect(popupCss).toMatch(
      /\.popup--settings \.popup-primary\s*\{[^}]*grid-column:\s*2;/,
    );
    expect(popupCss).toMatch(
      /\.popup-topbar\s*\{[^}]*display:\s*flex;[^}]*border-bottom:\s*1px solid var\(--separator\)/,
    );
    expect(popupCss).toMatch(
      /\.popup--settings \.popup-topbar\s*\{[^}]*padding-left:\s*290px;/,
    );
    expect(popupCss).not.toContain("@media (max-width: 739px)");
    expect(popupCss).not.toMatch(
      /\.duplicate-settings-pane\s*\{[^}]*grid-row:\s*1\s*\/\s*span\s*2/,
    );
    expect(popupCss).not.toMatch(/\.popup\s*\{[^}]*overflow-y:/);
    expect(popupCss).toMatch(
      /\.popup-results\s*\{[^}]*max-height:\s*480px;[^}]*overflow-y:\s*auto;[^}]*scrollbar-width:\s*none;/,
    );
    expect(popupCss).not.toMatch(
      /\b(?:max-)?(?:width|height):[^;]*v[wh]/,
    );
    expect(popupCss).toMatch(
      /\.popup\s*\{[\s\S]*font-size:\s*var\(--font-size\)/,
    );
    expect(popupCss).toMatch(
      /\.tab-row\s*\{[^}]*border-bottom:\s*0;/,
    );
    expect(themeCss).toContain("--popup-surface: #ffffff");
    expect(themeCss).toContain("--popup-selection: #e7f1ff");
    expect(themeCss).toContain("--popup-focus: #0060df");
    expect(themeCss).toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*--popup-surface: #42414c[\s\S]*--popup-selection: #4f5e83[\s\S]*--popup-focus: #b5d9ff/,
    );
    expect(popupCss).toMatch(
      /\.tab-row\s*\{[^}]*margin:\s*0 6px;[^}]*border-radius:\s*10px;/,
    );
    expect(popupCss).toMatch(
      /\.tab-row:hover\s*\{[^}]*background:\s*var\(--popup-hover\)/,
    );
    expect(popupCss).toMatch(
      /\.tab-row\.is-selected\s*\{[^}]*background:\s*var\(--popup-selection\)/,
    );
    expect(popupCss).toMatch(
      /\.tab-row\.is-removal-candidate:not\(\.is-selected\):not\(:hover\) \.tab-title,[\s\S]*\.favicon\s*\{[^}]*opacity:/,
    );
    expect(popupCss).not.toContain("text-decoration: line-through");
    expect(popupCss).toMatch(
      /\.mode-strip button\.is-active\s*\{[^}]*background:\s*var\(--popup-selection\)/,
    );
    expect(popupCss).toMatch(
      /\.mode-strip button\s*\{[^}]*border-radius:\s*8px;/,
    );
    expect(popupCss).toMatch(
      /\.mode-strip button,[\s\S]*\.icon-button\s*\{[^}]*border-radius:\s*6px;/,
    );
    expect(popupCss).not.toMatch(
      /\.mode-strip button:hover[\s\S]*?\{[^}]*background:\s*var\(--popup-hover\)/,
    );
    expect(popupCss).toMatch(
      /\.group-close:hover,[\s\S]*\.icon-button:hover\s*\{[^}]*background:\s*var\(--popup-hover\)/,
    );
    expect(popupCss).toMatch(
      /\.search-input\s*\{[^}]*border-radius:\s*8px;[^}]*background:\s*var\(--popup-surface\)/,
    );
    expect(popupCss).toMatch(
      /\.tab-title\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/,
    );
    expect(popupCss).toMatch(
      /\.inline-errors\s*\{[^}]*border-bottom:\s*0;/,
    );
    expect(popupCss).toMatch(
      /\.popup-search\s*\{[^}]*padding:\s*8px 10px 10px;[^}]*border-bottom:\s*1px solid var\(--separator\)/,
    );
    expect(popupCss).toMatch(
      /\.section-label\s*\{[^}]*padding:\s*6px 12px;[^}]*border-bottom:\s*0;[^}]*background:\s*var\(--popup-surface\)/,
    );
    expect(popupCss).toMatch(
      /\.group-header\s*\{[^}]*background:\s*var\(--popup-surface\)/,
    );
    expect(popupCss).toMatch(
      /\.tab-section \+ \.tab-section\s*\{[^}]*border-top:\s*1px solid var\(--separator\)/,
    );
    expect(popupCss).toMatch(
      /\.tab-section:not\(:last-child\)\s*\{[^}]*padding-bottom:\s*4px;/,
    );
    expect(popupCss).toMatch(
      /\.icon-button\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/,
    );
    expect(popupCss).toMatch(
      /\.search-input:focus-visible,[\s\S]*\.tab-row:focus-visible,[\s\S]*\{[^}]*outline:\s*2px solid var\(--popup-focus\)/,
    );
    expect(popupCss).toMatch(
      /\.duplicate-settings-control select:focus-visible,[\s\S]*\.duplicate-settings-control input:focus-visible[\s\S]*\{[^}]*outline:\s*2px solid var\(--popup-focus\)/,
    );
    expect(popupCss).toMatch(
      /\.duplicate-count\s*\{[^}]*color:\s*var\(--muted-text\)/,
    );
    expect(popupCss).toMatch(
      /\.tab-row\.is-selected \.duplicate-count\s*\{[^}]*color:\s*inherit;/,
    );
    expect(popupCss).not.toContain("text-transform: uppercase");
    expect(popupCss).toMatch(
      /\.duplicate-settings-pane\s*\{[^}]*padding:\s*12px;/,
    );
    expect(popupCss).toMatch(
      /\.duplicate-settings-pane\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;[^}]*border-right:\s*1px solid var\(--separator\)/,
    );
    expect(popupCss).toMatch(
      /\.duplicate-settings-control\s+(?:select|input)\s*\{[^}]*border-radius:\s*8px;/,
    );
    expect(popupCss).not.toMatch(
      /\.duplicate-settings-pane\s*\{[^}]*transition:/,
    );
    expect(`${themeCss}\n${popupCss}`).not.toMatch(/purple|pink/i);
  });

  it("uses a monochrome Firefox-theme-aware toolbar icon", () => {
    for (const size of [16, 32, 48, 96]) {
      const icon = readFileSync(
        resolve(process.cwd(), `icons/icon-${size}.svg`),
        "utf8",
      );

      expect(icon).toContain('class="icon"');
      expect(icon).toContain("@media (prefers-color-scheme: dark)");
      expect(icon).toContain('x="1.25"');
      expect(icon).toContain('width="10.5"');
      expect(icon).not.toMatch(/#0060df|#ffffff/i);
      expect(icon).not.toMatch(/<rect[^>]+x="1"[^>]+y="1"[^>]+width="14"/);
    }
  });
});
