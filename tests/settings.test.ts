import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, mergeSettings } from "../src/domain/settings";

describe("DEFAULT_SETTINGS", () => {
  it("uses Compact density and duplicate-matching defaults", () => {
    expect(DEFAULT_SETTINGS).toEqual({
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
  });
});

describe("mergeSettings", () => {
  it("falls back for invalid enum values", () => {
    expect(
      mergeSettings({
        density: "tiny",
        scope: "everywhere",
        containerScope: "sometimes",
        titleMatchMode: "title-only",
        agePreference: "random",
        badgeCountMode: "visible-tabs",
      }),
    ).toMatchObject({
      density: "compact",
      scope: "current-window",
      containerScope: "across-containers",
      titleMatchMode: "url-only",
      agePreference: "older",
      badgeCountMode: "duplicate-tabs",
    });
  });

  it("clamps finite title thresholds to the supported range", () => {
    expect(
      mergeSettings({ titleSimilarityThreshold: -12 })
        .titleSimilarityThreshold,
    ).toBe(0);
    expect(
      mergeSettings({ titleSimilarityThreshold: 125 })
        .titleSimilarityThreshold,
    ).toBe(100);
    expect(
      mergeSettings({ titleSimilarityThreshold: 72.5 })
        .titleSimilarityThreshold,
    ).toBe(72.5);
  });

  it("uses defaults for malformed stored values", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(["compact"])).toEqual(DEFAULT_SETTINGS);
    expect(
      mergeSettings({
        skipBlankTabs: "yes",
        titleSimilarityThreshold: Number.NaN,
        whitelist: 42,
      }),
    ).toMatchObject({
      skipBlankTabs: false,
      titleSimilarityThreshold: 100,
      whitelist: "",
    });
  });

  it("preserves every valid user value", () => {
    const value = {
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
      titleMatchMode: "url-and-title",
      titleSimilarityThreshold: 64,
      urlRules: '[{"type":"group","pattern":"example.com/*"}]',
      titleRules: "Release *",
      whitelist: "example.org",
      keepPinnedTab: false,
      keepActiveTab: false,
      agePreference: "newer",
      prioritizeActiveWindow: false,
      badgeCountMode: "all-tabs",
    };

    expect(mergeSettings(value)).toEqual(value);
  });
});
