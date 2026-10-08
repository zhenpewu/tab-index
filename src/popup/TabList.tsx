import { h } from "preact";
import { useState } from "preact/hooks";

import type { PopupTab } from "./usePopupState";

interface TabRowProps {
  selectedTabId: number | null;
  showDuplicateCount?: boolean;
  tab: PopupTab;
  onActivate(tab: PopupTab): void;
  onClose(tab: PopupTab): void;
  onReviewDuplicates(tab: PopupTab): void;
  onSelect(tabId: number): void;
}

function Favicon({ tab }: { tab: PopupTab }) {
  const [failed, setFailed] = useState(false);

  if (!tab.favIconUrl || failed) {
    return h(
      "span",
      { class: "favicon-fallback", "aria-hidden": "true" },
      "◎",
    );
  }

  return h("img", {
    class: "favicon",
    src: tab.favIconUrl,
    alt: "",
    onError: () => setFailed(true),
  });
}

function CloseIcon() {
  return h(
    "svg",
    {
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    h("path", { d: "M3.5 3.5l9 9m0-9-9 9" }),
  );
}

export function TabRow({
  selectedTabId,
  showDuplicateCount = false,
  tab,
  onActivate,
  onClose,
  onReviewDuplicates,
  onSelect,
}: TabRowProps) {
  const selected = selectedTabId === tab.id;
  const label = tab.title || tab.url || `Tab ${tab.id}`;

  return h(
    "div",
    {
      id: `popup-tab-${tab.id}`,
      class: `tab-row${selected ? " is-selected" : ""}`,
      role: "listitem",
      "aria-label": label,
      "aria-current": selected ? "true" : undefined,
      title: tab.url || undefined,
      "data-selected": selected ? "true" : "false",
      tabIndex: selected ? 0 : -1,
      "data-tab-id": tab.id,
      onFocus: () => onSelect(tab.id),
      onClick: () => onActivate(tab),
    },
    h(Favicon, { tab }),
    h(
      "span",
      { class: "tab-title" },
      tab.title || tab.url || "Untitled tab",
    ),
    tab.retained ? h("span", { class: "keep-label" }, "Keep") : null,
    showDuplicateCount && tab.duplicateCount !== undefined
      ? h(
          "button",
          {
            type: "button",
            class: "duplicate-count",
            "aria-label": `Review ${tab.duplicateCount} duplicates for ${tab.title || tab.url}`,
            title: "Review duplicate group",
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              onReviewDuplicates(tab);
            },
          },
          tab.duplicateCount,
        )
      : null,
    h(
      "button",
      {
        type: "button",
        class: "icon-button close-tab",
        "aria-label": `Close ${tab.title || tab.url || `tab ${tab.id}`}`,
        title: "Close tab",
        onClick: (event: MouseEvent) => {
          event.stopPropagation();
          onClose(tab);
        },
      },
      h(CloseIcon, null),
    ),
  );
}

interface TabListProps
  extends Omit<TabRowProps, "showDuplicateCount" | "tab"> {
  tabs: PopupTab[];
}

export function TabList({ tabs, ...rowProps }: TabListProps) {
  const currentWindowTabs = tabs.filter(({ currentWindow }) => currentWindow);
  const otherWindowTabs = tabs.filter(({ currentWindow }) => !currentWindow);
  const sections = [
    { label: "Current window", tabs: currentWindowTabs },
    { label: "Other windows", tabs: otherWindowTabs },
  ].filter((section) => section.tabs.length > 0);

  return h(
    "div",
    { class: "tab-list", role: "list", "aria-label": "Tabs" },
    sections.map((section) =>
      h(
        "section",
        { class: "tab-section", key: section.label },
        h("h2", { class: "section-label" }, section.label),
        section.tabs.map((tab) =>
          h(TabRow, {
            ...rowProps,
            key: tab.id,
            tab,
            showDuplicateCount: true,
          }),
        ),
      ),
    ),
  );
}
