import type { Settings, TabRecord } from "../domain/types";

export const SETTINGS_STORAGE_KEY = "settings";
export const POPUP_MODE_STORAGE_KEY = "popupMode";

export type PopupMode = "duplicates" | "all-tabs";
export type SettingsPatch = Partial<Settings>;

export interface TabSnapshot {
  tabs: TabRecord[];
  currentWindowId: number | null;
}

export type BackgroundRequest =
  | { type: "getSnapshot"; currentWindowId?: number }
  | { type: "activateTab"; tabId: number }
  | { type: "closeTabs"; tabIds: number[] }
  | {
      type: "closeDuplicateGroups";
      groupKeys: string[];
      settings: Settings;
      currentWindowId?: number;
    }
  | { type: "getSettings" }
  | { type: "saveSettings"; settings: Settings }
  | { type: "patchSettings"; patch: SettingsPatch }
  | { type: "consumePopupMode" }
  | { type: "openOptions" };

export interface BackgroundError {
  code: "tab-not-found" | "browser-error" | "unsupported-message";
  message: string;
  recoverable: boolean;
}

export type MessageResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: BackgroundError };

export interface BackgroundResponseMap {
  getSnapshot: MessageResult<TabSnapshot>;
  activateTab: MessageResult<{ tabId: number; windowId: number }>;
  closeTabs: MessageResult<{
    closedTabIds: number[];
    missingTabIds: number[];
    failedTabs: { tabId: number; message: string }[];
  }>;
  closeDuplicateGroups: MessageResult<{
    closedTabIds: number[];
    missingTabIds: number[];
    failedTabs: { tabId: number; message: string }[];
  }>;
  getSettings: MessageResult<Settings>;
  saveSettings: MessageResult<Settings>;
  patchSettings: MessageResult<Settings>;
  consumePopupMode: MessageResult<PopupMode>;
  openOptions: MessageResult<null>;
}

export type BackgroundResponse =
  BackgroundResponseMap[keyof BackgroundResponseMap];

export type ResponseFor<T extends BackgroundRequest> =
  BackgroundResponseMap[T["type"]];

export function sendBackgroundMessage<T extends BackgroundRequest>(
  request: T,
): Promise<ResponseFor<T>> {
  return browser.runtime.sendMessage(request) as Promise<ResponseFor<T>>;
}
