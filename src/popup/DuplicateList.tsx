import { h } from "preact";

import { TabRow } from "./TabList";
import type {
  PopupDuplicateGroup,
  PopupTab,
} from "./usePopupState";

interface DuplicateListProps {
  groups: PopupDuplicateGroup[];
  selectedTabId: number | null;
  onActivate(tab: PopupTab): void;
  onClose(tab: PopupTab): void;
  onCloseGroup(group: PopupDuplicateGroup): void;
  onSelect(tabId: number): void;
}

function groupLabel(group: PopupDuplicateGroup): string {
  const firstTab = group.tabs[0];
  if (!firstTab) {
    return "Duplicate group";
  }

  try {
    return new URL(firstTab.url).hostname || firstTab.title;
  } catch {
    return firstTab.title || firstTab.url || "Duplicate group";
  }
}

export function DuplicateList({
  groups,
  selectedTabId,
  onActivate,
  onClose,
  onCloseGroup,
  onSelect,
}: DuplicateListProps) {
  return h(
    "div",
    { class: "duplicate-list" },
    groups.map((group) => {
      const label = groupLabel(group);
      const closeCount = group.closableTabIds.length;
      const closeLabel = `Close ${closeCount} ${
        closeCount === 1 ? "duplicate" : "duplicates"
      } in group`;

      return h(
        "section",
        {
          class: "duplicate-group",
          key: group.key,
          "data-group-key": group.key,
        },
        h(
          "header",
          { class: "group-header" },
          h("span", { class: "group-title" }, label),
          h("span", { class: "group-count" }, `${group.tabs.length} tabs`),
          h(
            "button",
            {
              type: "button",
              class: "group-close",
              "aria-label": closeLabel,
              title: closeLabel,
              disabled: closeCount === 0,
              onClick: () => onCloseGroup(group),
            },
            `Close ${closeCount}`,
          ),
        ),
        h(
          "div",
          { role: "list", "aria-label": `${label} duplicates` },
          group.tabs.map((tab) =>
            h(TabRow, {
              key: tab.id,
              tab,
              selectedTabId,
              onActivate,
              onClose,
              onReviewDuplicates: () => undefined,
              onSelect,
            }),
          ),
        ),
      );
    }),
  );
}
