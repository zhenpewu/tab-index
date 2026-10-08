import { h } from "preact";
import type {
  TargetedInputEvent,
  TargetedSubmitEvent,
} from "preact";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import {
  parseTitleRules,
  parseUrlRules,
  parseWhitelist,
} from "../domain/rules";
import { DEFAULT_SETTINGS } from "../domain/settings";
import type {
  AgePreference,
  BadgeCountMode,
  ContainerScope,
  Density,
  DuplicateScope,
  RuleParseError,
  Settings,
  TitleMatchMode,
} from "../domain/types";
import {
  sendBackgroundMessage,
  type SettingsPatch,
} from "../shared/messages";

interface ChoiceProps<T extends string> {
  checked: boolean;
  label: string;
  name: string;
  onChange: (value: T) => void;
  value: T;
}

interface CheckboxProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

interface AdvancedFieldProps {
  error?: string;
  id: string;
  label: string;
  onInput: (value: string) => void;
  value: string;
}

type SaveState =
  | { type: "idle" }
  | { type: "saving" }
  | { type: "saved" }
  | { type: "error"; message: string };

const SAVED_STATUS_DURATION_MS = 2_000;

function Choice<T extends string>({
  checked,
  label,
  name,
  onChange,
  value,
}: ChoiceProps<T>) {
  return h(
    "label",
    { class: "choice" },
    h("input", {
      type: "radio",
      name,
      value,
      checked,
      onChange: () => onChange(value),
    }),
    h("span", null, label),
  );
}

function Checkbox({ checked, label, onChange }: CheckboxProps) {
  return h(
    "label",
    { class: "choice" },
    h("input", {
      type: "checkbox",
      checked,
      onChange: (event) => onChange(event.currentTarget.checked),
    }),
    h("span", null, label),
  );
}

function firstError(errors: RuleParseError[]): string | undefined {
  return errors[0]?.message;
}

function AdvancedField({
  error,
  id,
  label,
  onInput,
  value,
}: AdvancedFieldProps) {
  const errorId = `${id}-error`;
  return h(
    "div",
    { class: "advanced-field" },
    h("label", { htmlFor: id }, label),
    h("textarea", {
      id,
      rows: id === "url-rules" ? 7 : 4,
      value,
      "aria-invalid": Boolean(error),
      "aria-describedby": error ? errorId : undefined,
      onInput: (event: TargetedInputEvent<HTMLTextAreaElement>) =>
        onInput(event.currentTarget.value),
    }),
    error
      ? h(
          "p",
          { class: "field-error", id: errorId, role: "alert" },
          error,
        )
      : null,
  );
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function changedSettings(
  persisted: Settings,
  draft: Settings,
): SettingsPatch {
  return Object.fromEntries(
    (Object.keys(draft) as Array<keyof Settings>)
      .filter((key) => !Object.is(persisted[key], draft[key]))
      .map((key) => [key, draft[key]]),
  ) as SettingsPatch;
}

function rebaseLaterEdits(
  persisted: Settings,
  draft: Settings,
  fieldRevisions: ReadonlyMap<keyof Settings, number>,
  savedRevision: number,
): Settings {
  const laterEdits = Object.fromEntries(
    (Object.keys(draft) as Array<keyof Settings>)
      .filter(
        (key) => (fieldRevisions.get(key) ?? 0) > savedRevision,
      )
      .map((key) => [key, draft[key]]),
  ) as SettingsPatch;
  return { ...persisted, ...laterEdits };
}

export function App() {
  const [settings, setSettings] = useState<Settings>({
    ...DEFAULT_SETTINGS,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ type: "idle" });
  const draftRevision = useRef(0);
  const fieldRevisions = useRef(new Map<keyof Settings, number>());
  const saveInFlight = useRef(false);
  const persistedSettings = useRef<Settings>({ ...DEFAULT_SETTINGS });
  const savedTimer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

  function clearSavedTimer() {
    if (savedTimer.current !== undefined) {
      window.clearTimeout(savedTimer.current);
      savedTimer.current = undefined;
    }
  }

  useEffect(() => {
    let current = true;

    void sendBackgroundMessage({ type: "getSettings" })
      .then((response) => {
        if (!current) {
          return;
        }
        if (response.ok) {
          persistedSettings.current = response.data;
          setSettings(response.data);
        } else {
          setLoadError(response.error.message);
        }
      })
      .catch((error: unknown) => {
        if (current) {
          setLoadError(messageFrom(error, "Settings could not be loaded"));
        }
      })
      .finally(() => {
        if (current) {
          setLoading(false);
        }
      });

    return () => {
      current = false;
    };
  }, []);

  useLayoutEffect(
    () => {
      mounted.current = true;
      return () => {
        mounted.current = false;
        clearSavedTimer();
      };
    },
    [],
  );

  const validation = useMemo(
    () => ({
      urlRules: firstError(parseUrlRules(settings.urlRules).errors),
      titleRules: firstError(parseTitleRules(settings.titleRules).errors),
      whitelist: firstError(parseWhitelist(settings.whitelist).errors),
    }),
    [settings.titleRules, settings.urlRules, settings.whitelist],
  );
  const invalid = Object.values(validation).some(Boolean);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    draftRevision.current += 1;
    fieldRevisions.current.set(key, draftRevision.current);
    clearSavedTimer();
    setSettings((current) => ({ ...current, [key]: value }));
    setSaveState((current) =>
      saveInFlight.current && current.type === "saving"
        ? current
        : { type: "idle" },
    );
  }

  async function save(event: Event) {
    event.preventDefault();
    if (invalid || saveInFlight.current) {
      return;
    }

    const revision = draftRevision.current;
    saveInFlight.current = true;
    clearSavedTimer();
    setSaveState({ type: "saving" });
    try {
      const response = await sendBackgroundMessage({
        type: "patchSettings",
        patch: changedSettings(persistedSettings.current, settings),
      });
      if (!mounted.current) {
        return;
      }
      if (response.ok) {
        persistedSettings.current = response.data;
      }
      if (draftRevision.current !== revision) {
        if (response.ok) {
          setSettings((current) =>
            rebaseLaterEdits(
              response.data,
              current,
              fieldRevisions.current,
              revision,
            ),
          );
        }
        setSaveState({ type: "idle" });
        return;
      }
      if (response.ok) {
        setSettings(response.data);
        setSaveState({ type: "saved" });
        savedTimer.current = window.setTimeout(() => {
          savedTimer.current = undefined;
          setSaveState((current) =>
            current.type === "saved" ? { type: "idle" } : current,
          );
        }, SAVED_STATUS_DURATION_MS);
      } else {
        setSaveState({ type: "error", message: response.error.message });
      }
    } catch (error) {
      if (!mounted.current) {
        return;
      }
      setSaveState(
        draftRevision.current === revision
          ? {
              type: "error",
              message: messageFrom(error, "Settings could not be saved"),
            }
          : { type: "idle" },
      );
    } finally {
      saveInFlight.current = false;
    }
  }

  if (loading) {
    return h(
      "main",
      {
        class: "options-page",
        "data-density": settings.density,
      },
      h("h1", null, "Tab Index"),
      h("p", { class: "page-status", role: "status" }, "Loading settings…"),
    );
  }

  return h(
    "main",
    {
      class: "options-page",
      "data-density": settings.density,
    },
    h(
      "header",
      { class: "page-header" },
      h("h1", null, "Tab Index"),
      h("p", null, "Search, switch, and close duplicate tabs."),
    ),
    loadError
      ? h(
          "p",
          { class: "page-error", role: "status" },
          loadError,
        )
      : null,
    h(
      "form",
      {
        "aria-label": "Tab Index settings",
        "data-density": settings.density,
        onSubmit: (event: TargetedSubmitEvent<HTMLFormElement>) =>
          void save(event),
      },
      h(
        "fieldset",
        null,
        h("legend", null, "Appearance"),
        h(
          "p",
          { class: "section-help" },
          "Adjust the text size and spacing used by Tab Index.",
        ),
        h(
          "div",
          { class: "choice-row" },
          h(Choice<Density>, {
            name: "density",
            label: "Comfortable",
            value: "comfortable",
            checked: settings.density === "comfortable",
            onChange: (value) => update("density", value),
          }),
          h(Choice<Density>, {
            name: "density",
            label: "Compact",
            value: "compact",
            checked: settings.density === "compact",
            onChange: (value) => update("density", value),
          }),
          h(Choice<Density>, {
            name: "density",
            label: "Dense",
            value: "dense",
            checked: settings.density === "dense",
            onChange: (value) => update("density", value),
          }),
        ),
      ),
      h(
        "fieldset",
        null,
        h("legend", null, "Toolbar badge"),
        h(
          "p",
          { class: "section-help" },
          "Choose the number shown on the Tab Index toolbar icon.",
        ),
        h(
          "div",
          {
            class: "choice-column",
            role: "radiogroup",
            "aria-label": "Toolbar badge",
          },
          h(Choice<BadgeCountMode>, {
            name: "badge-count-mode",
            label: "All tabs",
            value: "all-tabs",
            checked: settings.badgeCountMode === "all-tabs",
            onChange: (value) => update("badgeCountMode", value),
          }),
          h(Choice<BadgeCountMode>, {
            name: "badge-count-mode",
            label: "Current window tabs",
            value: "current-window-tabs",
            checked: settings.badgeCountMode === "current-window-tabs",
            onChange: (value) => update("badgeCountMode", value),
          }),
          h(Choice<BadgeCountMode>, {
            name: "badge-count-mode",
            label: "Duplicate tabs",
            value: "duplicate-tabs",
            checked: settings.badgeCountMode === "duplicate-tabs",
            onChange: (value) => update("badgeCountMode", value),
          }),
        ),
      ),
      h(
        "fieldset",
        null,
        h("legend", null, "Duplicate scope"),
        h(
          "div",
          { class: "setting-group" },
          h(
            "span",
            { class: "setting-label", id: "windows-label" },
            "Windows",
          ),
          h(
            "div",
            {
              class: "choice-row",
              role: "radiogroup",
              "aria-labelledby": "windows-label",
            },
            h(Choice<DuplicateScope>, {
              name: "scope",
              label: "Current window",
              value: "current-window",
              checked: settings.scope === "current-window",
              onChange: (value) => update("scope", value),
            }),
            h(Choice<DuplicateScope>, {
              name: "scope",
              label: "All windows",
              value: "all-windows",
              checked: settings.scope === "all-windows",
              onChange: (value) => update("scope", value),
            }),
          ),
        ),
        h(
          "div",
          { class: "setting-group" },
          h(
            "span",
            { class: "setting-label", id: "containers-label" },
            "Firefox containers",
          ),
          h(
            "div",
            {
              class: "choice-column",
              role: "radiogroup",
              "aria-labelledby": "containers-label",
            },
            h(Choice<ContainerScope>, {
              name: "container-scope",
              label: "Within each Firefox container",
              value: "within-container",
              checked: settings.containerScope === "within-container",
              onChange: (value) => update("containerScope", value),
            }),
            h(Choice<ContainerScope>, {
              name: "container-scope",
              label: "Across Firefox containers",
              value: "across-containers",
              checked: settings.containerScope === "across-containers",
              onChange: (value) => update("containerScope", value),
            }),
          ),
        ),
        h(Checkbox, {
          label: "Skip blank and new tab pages",
          checked: settings.skipBlankTabs,
          onChange: (value) => update("skipBlankTabs", value),
        }),
      ),
      h(
        "fieldset",
        null,
        h("legend", null, "Matching"),
        h(
          "div",
          { class: "toggle-grid" },
          h(Checkbox, {
            label: "Ignore URL fragments",
            checked: settings.ignoreFragment,
            onChange: (value) => update("ignoreFragment", value),
          }),
          h(Checkbox, {
            label: "Ignore query parameters",
            checked: settings.ignoreQuery,
            onChange: (value) => update("ignoreQuery", value),
          }),
          h(Checkbox, {
            label: "Ignore URL paths",
            checked: settings.ignorePath,
            onChange: (value) => update("ignorePath", value),
          }),
          h(Checkbox, {
            label: "Ignore leading www",
            checked: settings.ignoreWww,
            onChange: (value) => update("ignoreWww", value),
          }),
          h(Checkbox, {
            label: "Compare URLs without case",
            checked: settings.caseInsensitive,
            onChange: (value) => update("caseInsensitive", value),
          }),
          h(Checkbox, {
            label: "Treat HTTP and HTTPS as equivalent and keep HTTPS",
            checked: settings.preferHttps,
            onChange: (value) => update("preferHttps", value),
          }),
        ),
        h(
          "div",
          { class: "setting-group" },
          h(
            "span",
            { class: "setting-label", id: "title-matching-label" },
            "Title matching",
          ),
          h(
            "div",
            {
              class: "choice-column",
              role: "radiogroup",
              "aria-labelledby": "title-matching-label",
            },
            h(Choice<TitleMatchMode>, {
              name: "title-match-mode",
              label: "URL only",
              value: "url-only",
              checked: settings.titleMatchMode === "url-only",
              onChange: (value) => update("titleMatchMode", value),
            }),
            h(Choice<TitleMatchMode>, {
              name: "title-match-mode",
              label: "URL match or title match",
              value: "url-or-title",
              checked: settings.titleMatchMode === "url-or-title",
              onChange: (value) => update("titleMatchMode", value),
            }),
            h(Choice<TitleMatchMode>, {
              name: "title-match-mode",
              label: "URL match and same title",
              value: "url-and-title",
              checked: settings.titleMatchMode === "url-and-title",
              onChange: (value) => update("titleMatchMode", value),
            }),
          ),
        ),
        h(
          "div",
          { class: "threshold-setting" },
          h(
            "label",
            { class: "threshold-control", htmlFor: "title-threshold" },
            h("span", null, "Title similarity threshold"),
            h("input", {
              id: "title-threshold",
              type: "number",
              min: 0,
              max: 100,
              step: 1,
              value: settings.titleSimilarityThreshold,
              disabled: settings.titleMatchMode !== "url-or-title",
              "aria-describedby": "title-threshold-help",
              onInput: (event) =>
                update(
                  "titleSimilarityThreshold",
                  Math.min(
                    100,
                    Math.max(0, Number(event.currentTarget.value)),
                  ),
                ),
            }),
            h("span", { class: "unit", "aria-hidden": "true" }, "%"),
          ),
          h(
            "p",
            { class: "control-help", id: "title-threshold-help" },
            "Used only for URL match or title match.",
          ),
        ),
        h(
          "button",
          {
            type: "button",
            class: "advanced-toggle",
            "aria-expanded": advancedOpen,
            onClick: () => setAdvancedOpen((open) => !open),
          },
          advancedOpen ? "Hide advanced rules" : "Show advanced rules",
        ),
        invalid && !advancedOpen
          ? h(
              "p",
              { class: "hidden-rule-error", role: "alert" },
              "Advanced rules contain errors. Show advanced rules to fix them.",
            )
          : null,
        advancedOpen
          ? h(
              "div",
              { class: "advanced-rules" },
              h(AdvancedField, {
                id: "url-rules",
                label: "URL rules",
                value: settings.urlRules,
                error: validation.urlRules,
                onInput: (value) => update("urlRules", value),
              }),
              h(AdvancedField, {
                id: "title-rules",
                label: "Title rules",
                value: settings.titleRules,
                error: validation.titleRules,
                onInput: (value) => update("titleRules", value),
              }),
              h(AdvancedField, {
                id: "url-whitelist",
                label: "URL whitelist",
                value: settings.whitelist,
                error: validation.whitelist,
                onInput: (value) => update("whitelist", value),
              }),
            )
          : null,
      ),
      h(
        "fieldset",
        null,
        h("legend", null, "Keep priority"),
        h(
          "p",
          { class: "section-help" },
          "Choose which tab Tab Index marks to keep in each duplicate group.",
        ),
        h(
          "div",
          { class: "toggle-grid" },
          h(Checkbox, {
            label: "Keep pinned tab",
            checked: settings.keepPinnedTab,
            onChange: (value) => update("keepPinnedTab", value),
          }),
          h(Checkbox, {
            label: "Keep active tab",
            checked: settings.keepActiveTab,
            onChange: (value) => update("keepActiveTab", value),
          }),
          h(Checkbox, {
            label: "Prefer tab in active window",
            checked: settings.prioritizeActiveWindow,
            onChange: (value) => update("prioritizeActiveWindow", value),
          }),
        ),
        h(
          "div",
          { class: "setting-group" },
          h(
            "span",
            { class: "setting-label", id: "age-label" },
            "Age",
          ),
          h(
            "div",
            {
              class: "choice-row",
              role: "radiogroup",
              "aria-labelledby": "age-label",
            },
            h(Choice<AgePreference>, {
              name: "age-preference",
              label: "Keep older tab",
              value: "older",
              checked: settings.agePreference === "older",
              onChange: (value) => update("agePreference", value),
            }),
            h(Choice<AgePreference>, {
              name: "age-preference",
              label: "Keep newer tab",
              value: "newer",
              checked: settings.agePreference === "newer",
              onChange: (value) => update("agePreference", value),
            }),
          ),
        ),
      ),
      h(
        "footer",
        { class: "form-footer" },
        h(
          "button",
          {
            type: "submit",
            class: "primary-button",
            disabled: invalid || saveState.type === "saving",
          },
          saveState.type === "saving" ? "Saving…" : "Save settings",
        ),
        saveState.type === "saved"
          ? h("span", { class: "save-status", role: "status" }, "Saved")
          : null,
        saveState.type === "error"
          ? h(
              "span",
              { class: "save-error", role: "status" },
              saveState.message,
            )
          : null,
      ),
    ),
  );
}
