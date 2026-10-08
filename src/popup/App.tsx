import { Fragment, h } from "preact";

import { DuplicateList } from "./DuplicateList";
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

export function App() {
  const popup = usePopupState();
  const tabs =
    popup.mode === "pinned" ? popup.pinnedTabs : popup.allTabs;
  const emptyText =
    popup.mode === "duplicates"
      ? "No duplicate tabs"
      : popup.mode === "pinned"
        ? "No pinned tabs"
        : "No tabs found";
  const closeAllCount = popup.groups.reduce(
    (count, group) => count + group.visibleClosableTabIds.length,
    0,
  );

  let content;
  if (popup.loading) {
    content = h("p", { class: "empty-state" }, "Loading tabs…");
  } else if (popup.mode === "duplicates") {
    content =
      popup.groups.length === 0
        ? h("p", { class: "empty-state" }, emptyText)
        : h(
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
                "button",
                {
                  type: "button",
                  class: "close-all",
                  "aria-label": `Close all ${closeAllCount} ${
                    closeAllCount === 1 ? "duplicate" : "duplicates"
                  }`,
                  title: "Close all non-retained duplicates",
                  disabled: closeAllCount === 0,
                  onClick: () => void popup.closeAll(),
                },
                "Close All",
              ),
            ),
            h(DuplicateList, {
              groups: popup.groups,
              selectedTabId: popup.selectedTabId,
              onActivate: (tab) => void popup.activateTab(tab.id),
              onClose: (tab) => void popup.closeRow(tab, true),
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
            onClose: (tab) => void popup.closeRow(tab, true),
            onReviewDuplicates: popup.reviewDuplicates,
            onSelect: popup.setSelectedTabId,
          });
  }

  return h(
    "main",
    {
      class: "popup",
      "data-density": popup.settings.density,
      "aria-busy": popup.loading,
    },
    h(
      "header",
      { class: "popup-header" },
      h(
        "div",
        { class: "popup-header-top" },
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
          "⚙",
        ),
      ),
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
  );
}
