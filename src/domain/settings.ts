import type {
  AgePreference,
  BadgeCountMode,
  ContainerScope,
  Density,
  DuplicateScope,
  Settings,
  TitleMatchMode,
} from "./types";

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  density: "compact",
  scope: "current-window",
  containerScope: "across-containers",
  skipBlankTabs: false,
  ignoreFragment: false,
  ignoreQuery: false,
  ignorePath: false,
  ignoreWww: false,
  caseInsensitive: false,
  preferHttps: true,
  titleMatchMode: "url-only",
  titleSimilarityThreshold: 100,
  urlRules: "[]",
  titleRules: "",
  whitelist: "",
  keepPinnedTab: true,
  keepActiveTab: true,
  agePreference: "older",
  prioritizeActiveWindow: true,
  badgeCountMode: "duplicate-tabs",
});

const DENSITIES: readonly Density[] = ["comfortable", "compact", "dense"];
const SCOPES: readonly DuplicateScope[] = ["current-window", "all-windows"];
const CONTAINER_SCOPES: readonly ContainerScope[] = [
  "within-container",
  "across-containers",
];
const TITLE_MATCH_MODES: readonly TitleMatchMode[] = [
  "url-only",
  "url-or-title",
  "url-and-title",
];
const AGE_PREFERENCES: readonly AgePreference[] = ["older", "newer"];
const BADGE_COUNT_MODES: readonly BadgeCountMode[] = [
  "all-tabs",
  "current-window-tabs",
  "duplicate-tabs",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function mergeSettings(value: unknown): Settings {
  if (!isRecord(value)) {
    return { ...DEFAULT_SETTINGS };
  }

  const threshold =
    typeof value.titleSimilarityThreshold === "number" &&
    Number.isFinite(value.titleSimilarityThreshold)
      ? Math.min(100, Math.max(0, value.titleSimilarityThreshold))
      : DEFAULT_SETTINGS.titleSimilarityThreshold;

  return {
    density: enumValue(
      value.density,
      DENSITIES,
      DEFAULT_SETTINGS.density,
    ),
    scope: enumValue(value.scope, SCOPES, DEFAULT_SETTINGS.scope),
    containerScope: enumValue(
      value.containerScope,
      CONTAINER_SCOPES,
      DEFAULT_SETTINGS.containerScope,
    ),
    skipBlankTabs: booleanValue(
      value.skipBlankTabs,
      DEFAULT_SETTINGS.skipBlankTabs,
    ),
    ignoreFragment: booleanValue(
      value.ignoreFragment,
      DEFAULT_SETTINGS.ignoreFragment,
    ),
    ignoreQuery: booleanValue(
      value.ignoreQuery,
      DEFAULT_SETTINGS.ignoreQuery,
    ),
    ignorePath: booleanValue(value.ignorePath, DEFAULT_SETTINGS.ignorePath),
    ignoreWww: booleanValue(value.ignoreWww, DEFAULT_SETTINGS.ignoreWww),
    caseInsensitive: booleanValue(
      value.caseInsensitive,
      DEFAULT_SETTINGS.caseInsensitive,
    ),
    preferHttps: booleanValue(
      value.preferHttps,
      DEFAULT_SETTINGS.preferHttps,
    ),
    titleMatchMode: enumValue(
      value.titleMatchMode,
      TITLE_MATCH_MODES,
      DEFAULT_SETTINGS.titleMatchMode,
    ),
    titleSimilarityThreshold: threshold,
    urlRules: stringValue(value.urlRules, DEFAULT_SETTINGS.urlRules),
    titleRules: stringValue(value.titleRules, DEFAULT_SETTINGS.titleRules),
    whitelist: stringValue(value.whitelist, DEFAULT_SETTINGS.whitelist),
    keepPinnedTab: booleanValue(
      value.keepPinnedTab,
      DEFAULT_SETTINGS.keepPinnedTab,
    ),
    keepActiveTab: booleanValue(
      value.keepActiveTab,
      DEFAULT_SETTINGS.keepActiveTab,
    ),
    agePreference: enumValue(
      value.agePreference,
      AGE_PREFERENCES,
      DEFAULT_SETTINGS.agePreference,
    ),
    prioritizeActiveWindow: booleanValue(
      value.prioritizeActiveWindow,
      DEFAULT_SETTINGS.prioritizeActiveWindow,
    ),
    badgeCountMode: enumValue(
      value.badgeCountMode,
      BADGE_COUNT_MODES,
      DEFAULT_SETTINGS.badgeCountMode,
    ),
  };
}
