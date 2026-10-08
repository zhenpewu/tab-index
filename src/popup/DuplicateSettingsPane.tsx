import { h } from "preact";
import type { TargetedEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type {
  AgePreference,
  BadgeCountMode,
  Settings,
  TitleMatchMode,
} from "../domain/types";

type DuplicateSettingsPatch = Partial<
  Pick<
    Settings,
    | "agePreference"
    | "badgeCountMode"
    | "keepActiveTab"
    | "keepPinnedTab"
    | "preferHttps"
    | "prioritizeActiveWindow"
    | "titleMatchMode"
    | "titleSimilarityThreshold"
  >
>;

interface DuplicateSettingsPaneProps {
  disabled: boolean;
  onChange: (patch: DuplicateSettingsPatch) => void;
  onOpenOptions: () => void;
  saving: boolean;
  settings: Settings;
}

const SIMILARITY_SAVE_DELAY_MS = 250;

function clampedPercentage(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(100, Math.max(0, parsed))
    : 0;
}

function CompactCheckbox({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange(checked: boolean): void;
}) {
  return h(
    "label",
    { class: "duplicate-settings-checkbox" },
    h("input", {
      type: "checkbox",
      checked,
      disabled,
      onChange: (event: TargetedEvent<HTMLInputElement>) =>
        onChange(event.currentTarget.checked),
    }),
    h("span", null, label),
  );
}

export function DuplicateSettingsPane({
  disabled,
  onChange,
  onOpenOptions,
  saving,
  settings,
}: DuplicateSettingsPaneProps) {
  const fuzzyTitles = settings.titleMatchMode === "url-or-title";
  const [thresholdDraft, setThresholdDraft] = useState(
    String(settings.titleSimilarityThreshold),
  );
  const thresholdTimer = useRef<number | undefined>(undefined);
  const thresholdDraftRef = useRef(thresholdDraft);
  const savedThresholdRef = useRef(settings.titleSimilarityThreshold);
  const onChangeRef = useRef(onChange);

  thresholdDraftRef.current = thresholdDraft;
  savedThresholdRef.current = settings.titleSimilarityThreshold;
  onChangeRef.current = onChange;

  useEffect(() => {
    setThresholdDraft(String(settings.titleSimilarityThreshold));
  }, [settings.titleSimilarityThreshold]);

  useEffect(
    () => () => {
      if (thresholdTimer.current !== undefined) {
        window.clearTimeout(thresholdTimer.current);
      }
      const value = thresholdDraftRef.current.trim();
      if (value !== "") {
        const threshold = clampedPercentage(value);
        if (threshold !== savedThresholdRef.current) {
          onChangeRef.current({ titleSimilarityThreshold: threshold });
        }
      }
    },
    [],
  );

  function commitThreshold(value: string) {
    if (value.trim() === "") {
      return;
    }
    const threshold = clampedPercentage(value);
    if (threshold !== savedThresholdRef.current) {
      savedThresholdRef.current = threshold;
      onChangeRef.current({ titleSimilarityThreshold: threshold });
    }
  }

  function updateThresholdDraft(value: string) {
    setThresholdDraft(value);
    thresholdDraftRef.current = value;
    if (thresholdTimer.current !== undefined) {
      window.clearTimeout(thresholdTimer.current);
      thresholdTimer.current = undefined;
    }
    if (value.trim() === "") {
      return;
    }

    thresholdTimer.current = window.setTimeout(() => {
      thresholdTimer.current = undefined;
      commitThreshold(value);
    }, SIMILARITY_SAVE_DELAY_MS);
  }

  return h(
    "section",
    {
      class: "duplicate-settings-pane",
      role: "region",
      "aria-label": "Duplicate settings",
    },
    h("h2", null, "Duplicate matching"),
    h(
      "label",
      { class: "duplicate-settings-control" },
      h("span", null, "Match duplicates by"),
      h(
        "select",
        {
          disabled,
          value: settings.titleMatchMode,
          onChange: (event: TargetedEvent<HTMLSelectElement>) =>
            onChange({
              titleMatchMode: event.currentTarget.value as TitleMatchMode,
            }),
        },
        h("option", { value: "url-only" }, "URL only"),
        h(
          "option",
          { value: "url-or-title" },
          "URL or similar title",
        ),
        h(
          "option",
          { value: "url-and-title" },
          "URL and same title",
        ),
      ),
    ),
    h(
      "label",
      { class: "duplicate-settings-control" },
      h("span", null, "Title similarity"),
      h(
        "span",
        { class: "percentage-control" },
        h("input", {
          type: "number",
          min: 0,
          max: 100,
          step: 1,
          value: thresholdDraft,
          disabled: disabled || !fuzzyTitles,
          onInput: (event: TargetedEvent<HTMLInputElement>) =>
            updateThresholdDraft(event.currentTarget.value),
          onBlur: () => {
            if (thresholdDraft.trim() === "") {
              setThresholdDraft(String(settings.titleSimilarityThreshold));
              thresholdDraftRef.current = String(
                settings.titleSimilarityThreshold,
              );
              return;
            }
            if (thresholdTimer.current !== undefined) {
              window.clearTimeout(thresholdTimer.current);
              thresholdTimer.current = undefined;
            }
            commitThreshold(thresholdDraft);
          },
        }),
        h("span", { class: "percentage-unit", "aria-hidden": "true" }, "%"),
      ),
    ),
    h(
      "p",
      { class: "duplicate-settings-help" },
      fuzzyTitles
        ? "Similar titles can match even when their URLs are different."
        : "Distinct URL paths stay separate in URL-only mode.",
    ),
    h("h3", null, "Keep priority"),
    h(
      "label",
      { class: "duplicate-settings-control" },
      h("span", null, "Keep tab by age"),
      h(
        "select",
        {
          disabled,
          value: settings.agePreference,
          onChange: (event: TargetedEvent<HTMLSelectElement>) =>
            onChange({
              agePreference: event.currentTarget.value as AgePreference,
            }),
        },
        h("option", { value: "older" }, "Keep older tab"),
        h("option", { value: "newer" }, "Keep newer tab"),
      ),
    ),
    h(CompactCheckbox, {
      label: "Prefer HTTPS",
      checked: settings.preferHttps,
      disabled,
      onChange: (preferHttps) => onChange({ preferHttps }),
    }),
    h(CompactCheckbox, {
      label: "Keep pinned tab",
      checked: settings.keepPinnedTab,
      disabled,
      onChange: (keepPinnedTab) => onChange({ keepPinnedTab }),
    }),
    h(CompactCheckbox, {
      label: "Keep active tab",
      checked: settings.keepActiveTab,
      disabled,
      onChange: (keepActiveTab) => onChange({ keepActiveTab }),
    }),
    h(CompactCheckbox, {
      label: "Prefer tab in active window",
      checked: settings.prioritizeActiveWindow,
      disabled,
      onChange: (prioritizeActiveWindow) =>
        onChange({ prioritizeActiveWindow }),
    }),
    h("h3", null, "Toolbar badge"),
    h(
      "label",
      { class: "duplicate-settings-control" },
      h("span", null, "Toolbar badge"),
      h(
        "select",
        {
          disabled,
          value: settings.badgeCountMode,
          onChange: (event: TargetedEvent<HTMLSelectElement>) =>
            onChange({
              badgeCountMode: event.currentTarget.value as BadgeCountMode,
            }),
        },
        h("option", { value: "all-tabs" }, "All tabs"),
        h(
          "option",
          { value: "current-window-tabs" },
          "Current window tabs",
        ),
        h(
          "option",
          { value: "duplicate-tabs" },
          "Duplicate tabs",
        ),
      ),
    ),
    h(
      "footer",
      { class: "duplicate-settings-footer" },
      saving
        ? h("span", { role: "status", class: "settings-save-status" }, "Saving…")
        : null,
      h(
        "button",
        {
          type: "button",
          class: "more-settings",
          disabled,
          "aria-label": "More settings",
          onClick: onOpenOptions,
        },
        "More settings…",
      ),
    ),
  );
}
