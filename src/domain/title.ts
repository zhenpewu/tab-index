// Title matching semantics are adapted from Duplicate Tabs Closer 4.3.4.
// See THIRD_PARTY_NOTICES.md. This implementation is typed, reentrant, and
// browser-independent for Tab Index.
// Modified for Tab Index on 2026-10-08.

import type { PatternRule } from "./types";

export function titleSimilarity(a: string, b: string): number {
  let left = a.toLowerCase();
  let right = b.toLowerCase();

  if (left.length < right.length) {
    [left, right] = [right, left];
  }

  if (left.length === 0) {
    return 100;
  }
  if (right.length === 0) {
    return 0;
  }

  let previous = new Int32Array(right.length + 1);
  let current = new Int32Array(right.length + 1);

  for (let column = 0; column <= right.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      current[column] =
        left[row - 1] === right[column - 1]
          ? (previous[column - 1] ?? 0)
          : 1 +
            Math.min(
              previous[column] ?? 0,
              current[column - 1] ?? 0,
              previous[column - 1] ?? 0,
            );
    }
    [previous, current] = [current, previous];
  }

  const distance = previous[right.length] ?? left.length;
  return Math.round((1 - distance / left.length) * 100);
}

export function titlesMatch(
  a: string,
  b: string,
  threshold: number,
): boolean {
  if (!a || !b) {
    return false;
  }

  const normalizedThreshold = Math.min(100, Math.max(0, threshold));
  if (normalizedThreshold >= 100) {
    return a.toLowerCase() === b.toLowerCase();
  }

  const maximumLength = Math.max(a.length, b.length);
  const maximumDistance =
    maximumLength * ((100 - normalizedThreshold) / 100);
  if (Math.abs(a.length - b.length) > maximumDistance) {
    return false;
  }

  return titleSimilarity(a, b) >= normalizedThreshold;
}

export function findSharedTitleRule(
  a: string,
  b: string,
  rules: readonly PatternRule[],
): string | undefined {
  for (const rule of rules) {
    if (rule.regex.test(a) && rule.regex.test(b)) {
      return rule.source;
    }
  }

  return undefined;
}
