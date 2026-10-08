// Matching semantics are adapted from Duplicate Tabs Closer 4.3.4.
// See THIRD_PARTY_NOTICES.md. This implementation is written as typed,
// side-effect-free TypeScript for Tab Index.
// Modified for Tab Index on 2026-10-08.

import type {
  PatternRule,
  RuleParseError,
  RuleParseResult,
  UrlReplacementRule,
  UrlRule,
} from "./types";

const MAX_PATTERN_LENGTH = 200;
const MAX_WILDCARDS = 5;
const REGEX_LITERAL = /^\/(.+)\/([gimsuy]*)$/;

interface ParsedPattern {
  source: string;
  regex: RegExp;
}

function error(
  index: number,
  source: string,
  message: string,
): RuleParseError {
  return { index, source, message };
}

function escapeRegexCharacter(character: string): string {
  return character.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function parseRegexLiteral(
  source: string,
  index: number,
): ParsedPattern | RuleParseError | undefined {
  const match = REGEX_LITERAL.exec(source);
  if (!match) {
    return undefined;
  }

  const expression = match[1] ?? "";
  const flags = match[2] ?? "";
  const safeFlags = flags.replace(/[gy]/g, "");
  try {
    return {
      source,
      regex: new RegExp(expression, safeFlags),
    };
  } catch {
    return error(index, source, "Invalid regular expression");
  }
}

function parseWildcard(
  source: string,
  index: number,
  optionalTrailingSlash: boolean,
): ParsedPattern | RuleParseError {
  if (source.length > MAX_PATTERN_LENGTH) {
    return error(
      index,
      source,
      `Pattern exceeds ${MAX_PATTERN_LENGTH} characters`,
    );
  }

  const wildcardCount = Array.from(source).filter(
    (character) => character === "*",
  ).length;
  if (wildcardCount > MAX_WILDCARDS) {
    return error(
      index,
      source,
      `Pattern exceeds ${MAX_WILDCARDS} wildcards`,
    );
  }

  const expression = Array.from(source)
    .map((character) =>
      character === "*" ? ".*" : escapeRegexCharacter(character),
    )
    .join("");
  const suffix = optionalTrailingSlash ? "\\/?$" : "$";

  return {
    source,
    regex: new RegExp(`^${expression}${suffix}`),
  };
}

function parsePattern(
  source: string,
  index: number,
  optionalTrailingSlash: boolean,
): ParsedPattern | RuleParseError {
  if (source.length > MAX_PATTERN_LENGTH) {
    return error(
      index,
      source,
      `Pattern exceeds ${MAX_PATTERN_LENGTH} characters`,
    );
  }

  const regexLiteral = parseRegexLiteral(source, index);
  if (regexLiteral) {
    return regexLiteral;
  }

  const wildcardSource = optionalTrailingSlash
    ? source.replace(/\/$/, "")
    : source;
  const wildcard = parseWildcard(
    wildcardSource,
    index,
    optionalTrailingSlash,
  );
  return "message" in wildcard
    ? wildcard
    : { source, regex: wildcard.regex };
}

function parsePatternLines(
  text: string,
  optionalTrailingSlash: boolean,
): RuleParseResult<PatternRule> {
  const rules: PatternRule[] = [];
  const errors: RuleParseError[] = [];

  for (const [index, rawLine] of text.split("\n").entries()) {
    const source = rawLine.trim();
    if (!source) {
      continue;
    }

    const parsed = parsePattern(source, index, optionalTrailingSlash);
    if ("message" in parsed) {
      errors.push(parsed);
      continue;
    }

    rules.push({
      type: "group",
      source: parsed.source,
      regex: parsed.regex,
    });
  }

  return { rules, errors };
}

export function parseWhitelist(text: string): RuleParseResult<PatternRule> {
  return parsePatternLines(text, true);
}

export function parseTitleRules(text: string): RuleParseResult<PatternRule> {
  return parsePatternLines(text, false);
}

function rowSource(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseUrlRules(text: string): RuleParseResult<UrlRule> {
  let values: unknown;
  try {
    values = JSON.parse(text);
  } catch {
    return {
      rules: [],
      errors: [error(-1, text, "URL rules must be valid JSON")],
    };
  }

  if (!Array.isArray(values)) {
    return {
      rules: [],
      errors: [error(-1, text, "URL rules must be a JSON array")],
    };
  }

  const rules: UrlRule[] = [];
  const errors: RuleParseError[] = [];

  for (const [index, value] of values.entries()) {
    const source = rowSource(value);
    if (!isObject(value)) {
      errors.push(error(index, source, "URL rule must be an object"));
      continue;
    }

    const type = value.type;
    const pattern = value.pattern;
    if (typeof type !== "string" || typeof pattern !== "string") {
      errors.push(
        error(index, source, "URL rule requires string type and pattern"),
      );
      continue;
    }

    const trimmedPattern = pattern.trim();
    if (!trimmedPattern) {
      errors.push(error(index, source, "URL rule pattern cannot be empty"));
      continue;
    }

    if (type === "normalize") {
      const parsed = parseWildcard(trimmedPattern, index, false);
      if ("message" in parsed) {
        errors.push(parsed);
        continue;
      }

      rules.push({
        type: "hostname",
        source: trimmedPattern,
        regex: parsed.regex,
        normalized: trimmedPattern.replace(/\*/g, "x"),
      });
      continue;
    }

    if (type === "group") {
      const parsed = parsePattern(trimmedPattern, index, false);
      if ("message" in parsed) {
        errors.push(parsed);
        continue;
      }

      rules.push({
        type: "group",
        source: parsed.source,
        regex: parsed.regex,
      });
      continue;
    }

    if (type === "replace" || type === "url") {
      if (typeof value.replacement !== "string") {
        errors.push(
          error(index, source, "URL replacement rule requires replacement"),
        );
        continue;
      }

      const parsed = parsePattern(trimmedPattern, index, false);
      if ("message" in parsed) {
        errors.push(parsed);
        continue;
      }

      const rule: UrlReplacementRule = {
        type: "url",
        source: parsed.source,
        regex: parsed.regex,
        replacement: value.replacement,
      };
      rules.push(rule);
      continue;
    }

    errors.push(error(index, source, `Unsupported URL rule type: ${type}`));
  }

  return { rules, errors };
}
