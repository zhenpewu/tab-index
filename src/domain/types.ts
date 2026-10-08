export type Density = "comfortable" | "compact" | "dense";

export type DuplicateScope = "current-window" | "all-windows";

export type ContainerScope = "within-container" | "across-containers";

export type TitleMatchMode = "url-only" | "url-or-title" | "url-and-title";

export type AgePreference = "older" | "newer";

export interface Settings {
  density: Density;
  scope: DuplicateScope;
  containerScope: ContainerScope;
  skipBlankTabs: boolean;
  ignoreFragment: boolean;
  ignoreQuery: boolean;
  ignorePath: boolean;
  ignoreWww: boolean;
  caseInsensitive: boolean;
  preferHttps: boolean;
  titleMatchMode: TitleMatchMode;
  titleSimilarityThreshold: number;
  urlRules: string;
  titleRules: string;
  whitelist: string;
  keepPinnedTab: boolean;
  keepActiveTab: boolean;
  agePreference: AgePreference;
  prioritizeActiveWindow: boolean;
}

export interface TabRecord {
  id: number;
  windowId: number;
  cookieStoreId: string;
  active: boolean;
  pinned: boolean;
  url: string;
  title: string;
  favIconUrl?: string;
  lastAccessed: number;
  status?: "loading" | "complete";
  incognito: boolean;
}

export interface PatternRule {
  type: "group";
  source: string;
  regex: RegExp;
}

export interface HostnameNormalizationRule {
  type: "hostname";
  source: string;
  regex: RegExp;
  normalized: string;
}

export interface UrlReplacementRule {
  type: "url";
  source: string;
  regex: RegExp;
  replacement: string;
}

export type UrlRule =
  | PatternRule
  | HostnameNormalizationRule
  | UrlReplacementRule;

export interface RuleParseError {
  index: number;
  source: string;
  message: string;
}

export interface RuleParseResult<T> {
  rules: T[];
  errors: RuleParseError[];
}

export interface DuplicateGroup {
  key: string;
  tabs: TabRecord[];
  retainedTabId: number;
  closableTabIds: number[];
}
