import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { h } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/domain/settings";
import type { Settings } from "../src/domain/types";
import { App } from "../src/options/App";
import type {
  BackgroundRequest,
  MessageResult,
} from "../src/shared/messages";

interface FakeBrowserOptions {
  settings?: Settings;
  loadResult?: MessageResult<Settings>;
  saveResult?: MessageResult<Settings>;
  saveHandler?: (settings: Settings) => Promise<MessageResult<Settings>>;
}

function installFakeBrowser({
  settings = { ...DEFAULT_SETTINGS },
  loadResult,
  saveResult,
  saveHandler,
}: FakeBrowserOptions = {}) {
  const requests: BackgroundRequest[] = [];
  let storedSettings = settings;

  vi.stubGlobal("browser", {
    runtime: {
      async sendMessage(request: BackgroundRequest) {
        requests.push(request);
        if (request.type === "getSettings") {
          return loadResult ?? { ok: true, data: storedSettings };
        }
        if (request.type === "patchSettings") {
          const next = { ...storedSettings, ...request.patch };
          const response = saveHandler
            ? await saveHandler(next)
            : saveResult ?? { ok: true as const, data: next };
          if (response.ok) {
            storedSettings = response.data;
          }
          return response;
        }
        throw new Error(`Unexpected request: ${request.type}`);
      },
    },
  });

  return { requests };
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

function saveRequests(requests: BackgroundRequest[]) {
  return requests.filter(
    (
      request,
    ): request is Extract<BackgroundRequest, { type: "patchSettings" }> =>
      request.type === "patchSettings",
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("settings page", () => {
  it("loads stored values into every settings family and previews the selected density", async () => {
    const settings: Settings = {
      density: "comfortable",
      scope: "all-windows",
      containerScope: "within-container",
      skipBlankTabs: true,
      ignoreFragment: true,
      ignoreQuery: true,
      ignorePath: true,
      ignoreWww: true,
      caseInsensitive: true,
      preferHttps: false,
      titleMatchMode: "url-and-title",
      titleSimilarityThreshold: 74,
      urlRules: '[{"type":"group","pattern":"example.com"}]',
      titleRules: "/Release .*/i",
      whitelist: "https://mail.example.com/*",
      keepPinnedTab: false,
      keepActiveTab: false,
      agePreference: "newer",
      prioritizeActiveWindow: false,
      badgeCountMode: "all-tabs",
    };
    installFakeBrowser({ settings });

    render(h(App, null));

    const form = await screen.findByRole("form", {
      name: "Tab Index settings",
    });
    expect(form.getAttribute("data-density")).toBe("comfortable");

    expect(
      (screen.getByRole("radio", { name: "Comfortable" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByRole("radio", { name: "All windows" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("radio", {
          name: "Within each Firefox container",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Skip blank and new tab pages",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);

    for (const name of [
      "Ignore URL fragments",
      "Ignore query parameters",
      "Ignore URL paths",
      "Ignore leading www",
      "Compare URLs without case",
    ]) {
      expect(
        (screen.getByRole("checkbox", { name }) as HTMLInputElement).checked,
      ).toBe(true);
    }
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Treat HTTP and HTTPS as equivalent and keep HTTPS",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        screen.getByRole("radio", {
          name: "URL match and same title",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("spinbutton", {
          name: "Title similarity threshold",
        }) as HTMLInputElement
      ).value,
    ).toBe("74");

    expect(
      (
        screen.getByRole("checkbox", {
          name: "Keep pinned tab",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Keep active tab",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (screen.getByRole("radio", { name: "Keep newer tab" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Prefer tab in active window",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (screen.getByRole("radio", { name: "All tabs" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("keeps advanced rules collapsed by default and reveals their loaded values", async () => {
    installFakeBrowser({
      settings: {
        ...DEFAULT_SETTINGS,
        urlRules: '[{"type":"group","pattern":"example.com"}]',
        titleRules: "/Release .*/i",
        whitelist: "https://mail.example.com/*",
      },
    });
    const user = userEvent.setup();

    render(h(App, null));
    const toggle = await screen.findByRole("button", {
      name: "Show advanced rules",
    });

    expect(screen.queryByRole("textbox", { name: "URL rules" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Title rules" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "URL whitelist" })).toBeNull();

    await user.click(toggle);

    expect(
      (screen.getByRole("textbox", { name: "URL rules" }) as HTMLTextAreaElement)
        .value,
    ).toBe('[{"type":"group","pattern":"example.com"}]');
    expect(
      (
        screen.getByRole("textbox", {
          name: "Title rules",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("/Release .*/i");
    expect(
      (
        screen.getByRole("textbox", {
          name: "URL whitelist",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("https://mail.example.com/*");
    expect(
      screen.getByRole("button", { name: "Hide advanced rules" }),
    ).toBeTruthy();
  });

  it("maps every edited control to the exact settings patch", async () => {
    const { requests } = installFakeBrowser();
    const user = userEvent.setup();
    render(h(App, null));

    const form = await screen.findByRole("form", {
      name: "Tab Index settings",
    });
    await user.click(screen.getByRole("radio", { name: "Dense" }));
    await user.click(screen.getByRole("radio", { name: "All windows" }));
    await user.click(
      screen.getByRole("radio", { name: "Within each Firefox container" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Skip blank and new tab pages",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Ignore URL fragments" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Ignore query parameters" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Ignore URL paths" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Ignore leading www" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Compare URLs without case",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Treat HTTP and HTTPS as equivalent and keep HTTPS",
      }),
    );
    await user.click(
      screen.getByRole("radio", { name: "URL match or title match" }),
    );
    const threshold = screen.getByRole("spinbutton", {
      name: "Title similarity threshold",
    });
    await user.clear(threshold);
    await user.type(threshold, "61");
    await user.click(
      screen.getByRole("button", { name: "Show advanced rules" }),
    );
    fireEvent.input(screen.getByRole("textbox", { name: "URL rules" }), {
      target: {
        value: '[{"type":"replace","pattern":"old","replacement":"new"}]',
      },
    });
    fireEvent.input(screen.getByRole("textbox", { name: "Title rules" }), {
      target: { value: "Release *" },
    });
    fireEvent.input(screen.getByRole("textbox", { name: "URL whitelist" }), {
      target: { value: "https://mail.example.com/*" },
    });
    await user.click(
      screen.getByRole("checkbox", { name: "Keep pinned tab" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Keep active tab" }),
    );
    await user.click(screen.getByRole("radio", { name: "Keep newer tab" }));
    await user.click(
      screen.getByRole("checkbox", {
        name: "Prefer tab in active window",
      }),
    );
    await user.click(
      screen.getByRole("radio", { name: "Current window tabs" }),
    );

    expect(form.getAttribute("data-density")).toBe("dense");
    expect(
      (
        screen.getByRole("radio", {
          name: "URL match or title match",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveRequests(requests)).toHaveLength(1));
    expect(saveRequests(requests)[0]?.patch).toEqual({
      density: "dense",
      scope: "all-windows",
      containerScope: "within-container",
      skipBlankTabs: true,
      ignoreFragment: true,
      ignoreQuery: true,
      ignorePath: true,
      ignoreWww: true,
      caseInsensitive: true,
      preferHttps: false,
      titleMatchMode: "url-or-title",
      titleSimilarityThreshold: 61,
      urlRules:
        '[{"type":"replace","pattern":"old","replacement":"new"}]',
      titleRules: "Release *",
      whitelist: "https://mail.example.com/*",
      keepPinnedTab: false,
      keepActiveTab: false,
      agePreference: "newer",
      prioritizeActiveWindow: false,
      badgeCountMode: "current-window-tabs",
    });
  });

  it.each([
    {
      control: "Dense",
      role: "radio",
      key: "density",
      value: "dense",
    },
    {
      control: "All windows",
      role: "radio",
      key: "scope",
      value: "all-windows",
    },
    {
      control: "Within each Firefox container",
      role: "radio",
      key: "containerScope",
      value: "within-container",
    },
    {
      control: "Skip blank and new tab pages",
      role: "checkbox",
      key: "skipBlankTabs",
      value: true,
    },
    {
      control: "Ignore URL fragments",
      role: "checkbox",
      key: "ignoreFragment",
      value: true,
    },
    {
      control: "Ignore query parameters",
      role: "checkbox",
      key: "ignoreQuery",
      value: true,
    },
    {
      control: "Ignore URL paths",
      role: "checkbox",
      key: "ignorePath",
      value: true,
    },
    {
      control: "Ignore leading www",
      role: "checkbox",
      key: "ignoreWww",
      value: true,
    },
    {
      control: "Compare URLs without case",
      role: "checkbox",
      key: "caseInsensitive",
      value: true,
    },
    {
      control: "Treat HTTP and HTTPS as equivalent and keep HTTPS",
      role: "checkbox",
      key: "preferHttps",
      value: false,
    },
    {
      control: "URL match or title match",
      role: "radio",
      key: "titleMatchMode",
      value: "url-or-title",
    },
    {
      control: "Keep pinned tab",
      role: "checkbox",
      key: "keepPinnedTab",
      value: false,
    },
    {
      control: "Keep active tab",
      role: "checkbox",
      key: "keepActiveTab",
      value: false,
    },
    {
      control: "Keep newer tab",
      role: "radio",
      key: "agePreference",
      value: "newer",
    },
    {
      control: "Prefer tab in active window",
      role: "checkbox",
      key: "prioritizeActiveWindow",
      value: false,
    },
    {
      control: "All tabs",
      role: "radio",
      key: "badgeCountMode",
      value: "all-tabs",
    },
  ] as const)(
    "maps $control only to $key",
    async ({ control, role, key, value }) => {
      const initialSettings = { ...DEFAULT_SETTINGS };
      const { requests } = installFakeBrowser({
        settings: initialSettings,
      });
      const user = userEvent.setup();
      render(h(App, null));

      await screen.findByRole("form", { name: "Tab Index settings" });
      await user.click(screen.getByRole(role, { name: control }));
      await user.click(screen.getByRole("button", { name: "Save settings" }));

      await waitFor(() => expect(saveRequests(requests)).toHaveLength(1));
      expect(saveRequests(requests)[0]?.patch).toEqual({ [key]: value });
    },
  );

  it("enables title threshold only for URL-or-title and preserves its value", async () => {
    installFakeBrowser({
      settings: {
        ...DEFAULT_SETTINGS,
        titleSimilarityThreshold: 67,
      },
    });
    const user = userEvent.setup();
    render(h(App, null));

    const threshold = (await screen.findByRole("spinbutton", {
      name: "Title similarity threshold",
    })) as HTMLInputElement;
    expect(threshold.disabled).toBe(true);
    expect(threshold.value).toBe("67");

    await user.click(
      screen.getByRole("radio", { name: "URL match or title match" }),
    );
    expect(threshold.disabled).toBe(false);
    await user.clear(threshold);
    await user.type(threshold, "82");

    await user.click(screen.getByRole("radio", { name: "URL only" }));
    expect(threshold.disabled).toBe(true);
    expect(threshold.value).toBe("82");

    await user.click(
      screen.getByRole("radio", { name: "URL match and same title" }),
    );
    expect(threshold.disabled).toBe(true);
    expect(threshold.value).toBe("82");

    expect(
      screen.getByText("Used only for URL match or title match."),
    ).toBeTruthy();

    await user.click(
      screen.getByRole("radio", { name: "URL match or title match" }),
    );
    expect(threshold.disabled).toBe(false);
    expect(threshold.value).toBe("82");
  });

  it.each([
    {
      field: "URL rules",
      value: "{",
      error: "URL rules must be valid JSON",
    },
    {
      field: "Title rules",
      value: "/[/",
      error: "Invalid regular expression",
    },
    {
      field: "URL whitelist",
      value: "/[/",
      error: "Invalid regular expression",
    },
  ])(
    "shows $field errors beside that field and never saves invalid settings",
    async ({ field, value, error }) => {
      const { requests } = installFakeBrowser();
      const user = userEvent.setup();
      render(h(App, null));

      await user.click(
        await screen.findByRole("button", { name: "Show advanced rules" }),
      );
      const textbox = screen.getByRole("textbox", { name: field });
      fireEvent.input(textbox, { target: { value } });

      const fieldContainer = textbox.closest(".advanced-field");
      expect(fieldContainer).not.toBeNull();
      expect(within(fieldContainer as HTMLElement).getByText(error)).toBeTruthy();

      const save = screen.getByRole("button", { name: "Save settings" });
      expect((save as HTMLButtonElement).disabled).toBe(true);
      await user.click(save);
      expect(saveRequests(requests)).toHaveLength(0);
    },
  );

  it("keeps collapsed advanced-rule errors visible and easy to reopen", async () => {
    installFakeBrowser();
    const user = userEvent.setup();
    render(h(App, null));

    await user.click(
      await screen.findByRole("button", { name: "Show advanced rules" }),
    );
    const titleRules = screen.getByRole("textbox", { name: "Title rules" });
    fireEvent.input(titleRules, { target: { value: "/[/" } });
    expect(screen.getByText("Invalid regular expression")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "Hide advanced rules" }),
    );

    expect(screen.queryByRole("textbox", { name: "Title rules" })).toBeNull();
    expect(
      screen.getByText(
        "Advanced rules contain errors. Show advanced rules to fix them.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "Save settings",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(
      screen.getByRole("button", { name: "Show advanced rules" }),
    );
    expect(screen.getByRole("textbox", { name: "Title rules" })).toBeTruthy();
    expect(screen.getByText("Invalid regular expression")).toBeTruthy();
  });

  it("programmatically names each nested radio group", async () => {
    installFakeBrowser();
    render(h(App, null));

    await screen.findByRole("form", { name: "Tab Index settings" });
    expect(
      screen.getByRole("radiogroup", { name: "Windows" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radiogroup", { name: "Firefox containers" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radiogroup", { name: "Title matching" }),
    ).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Age" })).toBeTruthy();
  });

  it("preserves edits made during save and blocks a second concurrent save", async () => {
    const pendingSave = deferred<MessageResult<Settings>>();
    let saveCount = 0;
    const { requests } = installFakeBrowser({
      saveHandler: (next) => {
        saveCount += 1;
        return saveCount === 1
          ? pendingSave.promise
          : Promise.resolve({ ok: true, data: next });
      },
    });
    const user = userEvent.setup();
    render(h(App, null));

    const form = await screen.findByRole("form", {
      name: "Tab Index settings",
    });
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    const saving = screen.getByRole("button", { name: "Saving…" });
    expect((saving as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("radio", { name: "Dense" }));
    expect((saving as HTMLButtonElement).disabled).toBe(true);

    fireEvent.submit(form);
    expect(saveRequests(requests)).toHaveLength(1);

    pendingSave.resolve({
      ok: true,
      data: {
        ...DEFAULT_SETTINGS,
        badgeCountMode: "all-tabs",
      },
    });

    await waitFor(() =>
      expect(
        (screen.getByRole("radio", { name: "Dense" }) as HTMLInputElement)
          .checked,
      ).toBe(true),
    );
    expect(
      (screen.getByRole("radio", { name: "All tabs" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(screen.queryByText("Saved")).toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Save settings",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(saveRequests(requests)).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saveRequests(requests)).toHaveLength(2));
    expect(saveRequests(requests)[1]?.patch).toEqual({ density: "dense" });
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a save that %ss after unmount",
    async (settlement) => {
      const pendingSave = deferred<MessageResult<Settings>>();
      installFakeBrowser({
        saveHandler: () => pendingSave.promise,
      });
      const setTimeoutSpy = vi.spyOn(window, "setTimeout");
      const { unmount } = render(h(App, null));

      await screen.findByRole("form", { name: "Tab Index settings" });
      setTimeoutSpy.mockClear();
      fireEvent.click(
        screen.getByRole("button", { name: "Save settings" }),
      );
      unmount();

      await act(async () => {
        if (settlement === "resolve") {
          pendingSave.resolve({
            ok: true,
            data: { ...DEFAULT_SETTINGS },
          });
        } else {
          pendingSave.reject(new Error("Late save failure"));
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        setTimeoutSpy.mock.calls.some(([, delay]) => delay === 2_000),
      ).toBe(false);
    },
  );

  it("sends changed valid settings and shows a compact saved state", async () => {
    const { requests } = installFakeBrowser();
    const user = userEvent.setup();
    render(h(App, null));

    await screen.findByRole("form", { name: "Tab Index settings" });
    await user.click(screen.getByRole("radio", { name: "Comfortable" }));
    await user.click(screen.getByRole("radio", { name: "All windows" }));
    await user.click(
      screen.getByRole("radio", { name: "Within each Firefox container" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Skip blank and new tab pages",
      }),
    );
    await user.click(
      screen.getByRole("radio", { name: "URL match or title match" }),
    );
    const threshold = screen.getByRole("spinbutton", {
      name: "Title similarity threshold",
    });
    await user.clear(threshold);
    await user.type(threshold, "83");
    await user.click(
      screen.getByRole("button", { name: "Show advanced rules" }),
    );
    const whitelist = screen.getByRole("textbox", {
      name: "URL whitelist",
    });
    await user.type(whitelist, "https://mail.example.com/*");
    await user.click(screen.getByRole("radio", { name: "Keep newer tab" }));

    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(saveRequests(requests)).toHaveLength(1));
    expect(saveRequests(requests)[0]?.patch).toEqual({
      density: "comfortable",
      scope: "all-windows",
      containerScope: "within-container",
      skipBlankTabs: true,
      titleMatchMode: "url-or-title",
      titleSimilarityThreshold: 83,
      whitelist: "https://mail.example.com/*",
      agePreference: "newer",
    });
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("shows a save failure inline and keeps the form usable", async () => {
    const { requests } = installFakeBrowser({
      saveResult: {
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

    const save = await screen.findByRole("button", {
      name: "Save settings",
    });
    await user.click(save);

    expect(await screen.findByText("Settings could not be saved")).toBeTruthy();
    expect(saveRequests(requests)).toHaveLength(1);
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(
      screen.getByRole("radio", { name: "Compact" }),
    ).toBeTruthy();
  });

  it("clears the Saved status after a short managed timeout", async () => {
    vi.useFakeTimers();
    installFakeBrowser();
    render(h(App, null));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Saved")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: "Dense" }));
    expect(screen.queryByText("Saved")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Saved")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1_999);
    });
    expect(screen.getByText("Saved")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("falls back to usable defaults when loading fails", async () => {
    installFakeBrowser({
      loadResult: {
        ok: false,
        error: {
          code: "browser-error",
          message: "Settings could not be loaded",
          recoverable: true,
        },
      },
    });
    render(h(App, null));

    expect(
      await screen.findByText("Settings could not be loaded"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("radio", { name: "Compact" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: "Save settings",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
