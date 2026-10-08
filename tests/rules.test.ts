import { describe, expect, it } from "vitest";

import {
  parseTitleRules,
  parseUrlRules,
  parseWhitelist,
} from "../src/domain/rules";

describe("parseWhitelist", () => {
  it("parses wildcard entries with an optional trailing slash", () => {
    const result = parseWhitelist("https://*.example.com/private/*");

    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(
      result.rules[0]?.regex.test(
        "https://docs.example.com/private/quarterly",
      ),
    ).toBe(true);
    expect(
      result.rules[0]?.regex.test("https://docs.example.com/public/quarterly"),
    ).toBe(false);
    expect(
      result.rules[0]?.regex.test(
        "https://docs.example.com/private/quarterly/",
      ),
    ).toBe(true);
  });

  it("normalizes a trailing slash in a wildcard entry", () => {
    const result = parseWhitelist("https://example.com/private/");
    const rule = result.rules[0];

    expect(rule?.regex.test("https://example.com/private")).toBe(true);
    expect(rule?.regex.test("https://example.com/private/")).toBe(true);
  });

  it("parses regex literals and removes global and sticky flags", () => {
    const result = parseWhitelist("/^https:\\/\\/EXAMPLE\\.COM\\//giy");
    const rule = result.rules[0];

    expect(result.errors).toEqual([]);
    expect(rule?.regex.flags).toBe("i");
    expect(rule?.regex.test("https://example.com/one")).toBe(true);
    expect(rule?.regex.test("https://example.com/two")).toBe(true);
  });

  it("treats slash-prefixed non-literals as wildcard entries", () => {
    const result = parseWhitelist("//\n/docs/*\n/foo");

    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(3);
    expect(result.rules[0]?.regex.test("//")).toBe(true);
    expect(result.rules[0]?.regex.test("anything")).toBe(false);
    expect(result.rules[1]?.regex.test("/docs/reference")).toBe(true);
    expect(result.rules[2]?.regex.test("/foo")).toBe(true);
  });

  it("rejects regex literals with 201-character bodies", () => {
    const result = parseWhitelist(`/${"a".repeat(201)}/`);

    expect(result.rules).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe(
      "Pattern exceeds 200 characters",
    );
  });

  it("reports invalid regular expressions without throwing or dropping valid rules", () => {
    const result = parseWhitelist("/[/\nhttps://valid.example/*");

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ index: 0, source: "/[/" });
    expect(result.rules).toHaveLength(1);
    expect(
      result.rules[0]?.regex.test("https://valid.example/page"),
    ).toBe(true);
  });
});

describe("parseUrlRules", () => {
  it("parses hostname normalization rules", () => {
    const result = parseUrlRules(
      JSON.stringify([{ type: "normalize", pattern: "mirror.*" }]),
    );

    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      type: "hostname",
      source: "mirror.*",
      normalized: "mirror.x",
    });
    expect(result.rules[0]?.regex.test("mirror.example")).toBe(true);
  });

  it("parses URL replacement rules", () => {
    const result = parseUrlRules(
      JSON.stringify([
        {
          type: "replace",
          pattern: "/^https:\\/\\/m\\.example\\.com\\//gi",
          replacement: "https://example.com/",
        },
      ]),
    );

    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      type: "url",
      source: "/^https:\\/\\/m\\.example\\.com\\//gi",
      replacement: "https://example.com/",
    });
    expect(result.rules[0]?.regex.flags).toBe("i");
  });

  it("parses URL grouping rules from wildcards and regex literals", () => {
    const result = parseUrlRules(
      JSON.stringify([
        { type: "group", pattern: "https://example.com/items/*" },
        { type: "group", pattern: "/^https:\\/\\/docs\\./i" },
      ]),
    );

    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]?.type).toBe("group");
    expect(
      result.rules[0]?.regex.test("https://example.com/items/42"),
    ).toBe(true);
    expect(result.rules[1]?.regex.test("https://DOCS.example.com/")).toBe(true);
  });

  it("treats slash-prefixed non-literals as URL grouping wildcards", () => {
    const result = parseUrlRules(
      JSON.stringify([
        { type: "group", pattern: "//" },
        { type: "group", pattern: "/docs/*" },
        { type: "group", pattern: "/foo" },
      ]),
    );

    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(3);
    expect(result.rules[0]?.regex.test("//")).toBe(true);
    expect(result.rules[0]?.regex.test("anything")).toBe(false);
    expect(result.rules[1]?.regex.test("/docs/reference")).toBe(true);
    expect(result.rules[2]?.regex.test("/foo")).toBe(true);
  });

  it("treats slash-prefixed non-literals as URL replacement wildcards", () => {
    const result = parseUrlRules(
      JSON.stringify([
        { type: "replace", pattern: "//", replacement: "root" },
        { type: "replace", pattern: "/docs/*", replacement: "docs" },
        { type: "replace", pattern: "/foo", replacement: "foo" },
      ]),
    );

    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(3);
    expect("//".replace(result.rules[0]?.regex ?? /$^/, "root")).toBe("root");
    expect(
      "/docs/reference".replace(result.rules[1]?.regex ?? /$^/, "docs"),
    ).toBe("docs");
    expect("/foo".replace(result.rules[2]?.regex ?? /$^/, "foo")).toBe("foo");
  });

  it("rejects URL group regex literals with 201-character bodies", () => {
    const result = parseUrlRules(
      JSON.stringify([
        { type: "group", pattern: `/${"a".repeat(201)}/` },
      ]),
    );

    expect(result.rules).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe(
      "Pattern exceeds 200 characters",
    );
  });

  it("rejects URL replacement regex literals with 201-character bodies", () => {
    const result = parseUrlRules(
      JSON.stringify([
        {
          type: "replace",
          pattern: `/${"a".repeat(201)}/`,
          replacement: "short",
        },
      ]),
    );

    expect(result.rules).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe(
      "Pattern exceeds 200 characters",
    );
  });

  it("returns errors instead of throwing for malformed JSON and rows", () => {
    expect(() => parseUrlRules("{")).not.toThrow();

    const malformedJson = parseUrlRules("{");
    const malformedRows = parseUrlRules(
      JSON.stringify([
        { type: "group", pattern: "/[/" },
        { type: "replace", pattern: "/ok/", replacement: 42 },
        { type: "unknown", pattern: "*" },
      ]),
    );

    expect(malformedJson.rules).toEqual([]);
    expect(malformedJson.errors).toHaveLength(1);
    expect(malformedRows.rules).toEqual([]);
    expect(malformedRows.errors).toHaveLength(3);
  });
});

describe("parseTitleRules", () => {
  it("parses title grouping wildcards and regex literals", () => {
    const result = parseTitleRules("Release *\n/^Issue #\\d+$/gy");

    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]?.regex.test("Release October")).toBe(true);
    expect(result.rules[0]?.regex.test("Draft Release October")).toBe(false);
    expect(result.rules[1]?.regex.flags).toBe("");
    expect(result.rules[1]?.regex.test("Issue #42")).toBe(true);
    expect(result.rules[1]?.regex.test("Issue #43")).toBe(true);
  });

  it("treats slash-prefixed non-literals as title grouping wildcards", () => {
    const result = parseTitleRules("//\n/docs/*\n/foo");

    expect(result.errors).toEqual([]);
    expect(result.rules).toHaveLength(3);
    expect(result.rules[0]?.regex.test("//")).toBe(true);
    expect(result.rules[0]?.regex.test("anything")).toBe(false);
    expect(result.rules[1]?.regex.test("/docs/reference")).toBe(true);
    expect(result.rules[2]?.regex.test("/foo")).toBe(true);
  });

  it("rejects title regex literals with 201-character bodies", () => {
    const result = parseTitleRules(`/${"a".repeat(201)}/`);

    expect(result.rules).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe(
      "Pattern exceeds 200 characters",
    );
  });
});
