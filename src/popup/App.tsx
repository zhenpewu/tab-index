import { Fragment, h } from "preact";

import { DuplicateList } from "./DuplicateList";
import { DuplicateSettingsPane } from "./DuplicateSettingsPane";
import { TabList } from "./TabList";
import {
  usePopupState,
  type PopupViewMode,
} from "./usePopupState";

const MODES: Array<{ label: string; value: PopupViewMode }> = [
  { label: "All Tabs", value: "all-tabs" },
  { label: "Duplicates", value: "duplicates" },
  { label: "Pinned", value: "pinned" },
];

function SettingsIcon() {
  return h(
    "svg",
    {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("path", {
      d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    }),
    h("circle", { cx: "12", cy: "12", r: "3" }),
  );
}

export function App() {
  const popup = usePopupState();
  const duplicateMode = popup.mode === "duplicates";
  const tabs =
    popup.mode === "pinned" ? popup.pinnedTabs : popup.allTabs;
  const emptyText =
    popup.mode === "duplicates"
      ? "No duplicate tabs"
      : popup.mode === "pinned"
        ? "No pinned tabs"
        : "No tabs found";
  const closeAllCount = popup.groups.reduce(
    (count, group) => count + group.closableTabIds.length,
    0,
  );

  let content;
  if (popup.loading) {
    content = h("p", { class: "empty-state" }, "Loading tabs…");
  } else if (popup.mode === "duplicates") {
    content = h(
      Fragment,
      null,
      h(
        "div",
        { class: "duplicate-toolbar" },
        h(
          "span",
          null,
          `${popup.groups.length} ${
            popup.groups.length === 1 ? "group" : "groups"
          }`,
        ),
        h(
          "div",
          { class: "duplicate-toolbar-actions" },
          h(
            "button",
            {
              type: "button",
              class: "close-all",
              "aria-label": `Close all ${closeAllCount} ${
                closeAllCount === 1 ? "duplicate" : "duplicates"
              }`,
              title: "Close all non-retained duplicates",
              disabled:
                closeAllCount === 0 || popup.settingsSaving,
              onClick: () => void popup.closeAll(),
            },
            "Close all",
          ),
        ),
      ),
      popup.groups.length === 0
        ? h("p", { class: "empty-state" }, emptyText)
        : h(DuplicateList, {
            actionsDisabled: popup.settingsSaving,
            groups: popup.groups,
            selectedTabId: popup.selectedTabId,
            onActivate: (tab) => void popup.activateTab(tab.id),
            onClose: (tab) => void popup.closeRow(tab),
            onCloseGroup: (group) => void popup.closeGroup(group),
            onSelect: popup.setSelectedTabId,
          }),
    );
  } else {
    content =
      tabs.length === 0
        ? h("p", { class: "empty-state" }, emptyText)
        : h(TabList, {
            tabs,
            selectedTabId: popup.selectedTabId,
            onActivate: (tab) => void popup.activateTab(tab.id),
            onClose: (tab) => void popup.closeRow(tab),
            onReviewDuplicates: popup.reviewDuplicates,
            onSelect: popup.setSelectedTabId,
          });
  }

  return h(
    "main",
    {
      class: `popup${duplicateMode ? " popup--settings" : ""}`,
      "data-density": popup.settings.density,
      "aria-busy": popup.loading,
    },
    h(
      "header",
      { class: "popup-topbar" },
      h(
        "nav",
        {
          class: "mode-strip",
          role: "tablist",
          "aria-label": "Tab views",
        },
        MODES.map(({ label, value }) =>
          h(
            "button",
            {
              type: "button",
              role: "tab",
              key: value,
              "aria-selected": popup.mode === value,
              class: popup.mode === value ? "is-active" : undefined,
              onClick: () => popup.selectMode(value),
            },
            label,
          ),
        ),
      ),
      h(
        "button",
        {
          type: "button",
          class: "icon-button settings-button",
          "aria-label": "Open settings",
          title: "Open settings",
          onClick: () => void popup.openOptions(),
        },
        h(SettingsIcon, null),
      ),
    ),
    h(
      "div",
      { class: "popup-content" },
      h(
        "section",
        { class: "popup-primary" },
        h(
          "div",
          { class: "popup-search" },
          h("input", {
            ref: popup.searchInputRef,
            class: "search-input",
            type: "search",
            "aria-label": "Search tabs",
            placeholder: "Search tabs",
            value: popup.query,
            onInput: (event) => popup.setQuery(event.currentTarget.value),
          }),
        ),
        h(
          "div",
          { class: "popup-results" },
          popup.errors.length > 0
            ? h(
                "div",
                {
                  class: "inline-errors",
                  role: "status",
                  "aria-live": "polite",
                },
                popup.errors.map((error) => h("p", { key: error }, error)),
              )
            : null,
          content,
        ),
      ),
      duplicateMode
        ? h(DuplicateSettingsPane, {
            disabled: popup.loading,
            settings: popup.settings,
            saving: popup.settingsSaving,
            onChange: (patch) => void popup.saveDuplicateSettings(patch),
            onOpenOptions: () => void popup.openOptions(),
          })
        : null,
    ),
  );
}
