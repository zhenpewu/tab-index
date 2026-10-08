import { describe, expect, it } from "vitest";

import { parseTitleRules } from "../src/domain/rules";
import {
  findSharedTitleRule,
  titleSimilarity,
  titlesMatch,
} from "../src/domain/title";

describe("titleSimilarity", () => {
  it("matches titles exactly without regard to case", () => {
    expect(titleSimilarity("Firefox Release", "firefox release")).toBe(100);
  });

  it("returns an integer Levenshtein percentage", () => {
    expect(titleSimilarity("kitten", "sitting")).toBe(57);
    expect(Number.isInteger(titleSimilarity("report", "reports"))).toBe(true);
  });

  it("handles empty titles", () => {
    expect(titleSimilarity("", "")).toBe(100);
    expect(titleSimilarity("", "Firefox")).toBe(0);
  });
});

describe("titlesMatch", () => {
  it("uses exact case-insensitive matching at a 100 percent threshold", () => {
    expect(titlesMatch("Release Notes", "release notes", 100)).toBe(true);
    expect(titlesMatch("Release Note", "Release Notes", 100)).toBe(false);
  });

  it("uses fuzzy similarity below a 100 percent threshold", () => {
    expect(titlesMatch("Quarterly Report", "Quarterly Reports", 90)).toBe(
      true,
    );
    expect(titlesMatch("Quarterly Report", "Quarterly Reports", 95)).toBe(
      false,
    );
  });

  it("rejects lengths that cannot satisfy the threshold", () => {
    expect(titlesMatch("a", "aaaaaaaaaa", 90)).toBe(false);
  });

  it("does not treat missing titles as a title match", () => {
    expect(titlesMatch("", "", 0)).toBe(false);
  });
});

describe("findSharedTitleRule", () => {
  it("returns the first rule that groups both titles", () => {
    const rules = parseTitleRules("Release *\nIssue *").rules;

    expect(
      findSharedTitleRule("Release October", "Release November", rules),
    ).toBe("Release *");
  });

  it("does not group titles when only one matches the rule", () => {
    const rules = parseTitleRules("Release *").rules;

    expect(
      findSharedTitleRule("Release October", "Draft October", rules),
    ).toBeUndefined();
  });
});
