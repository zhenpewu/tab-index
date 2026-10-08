// URL matching semantics are adapted from Duplicate Tabs Closer 4.3.4.
// See THIRD_PARTY_NOTICES.md. This implementation is written as a typed,
// browser-compatible pure function for Tab Index.

import { parseUrlRules } from "./rules";
import type { Settings, UrlRule } from "./types";

const SUPPORTED_URL = /^((f|ht)tps?|file):\/\//i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyCustomNormalization(url: string, rules: UrlRule[]): string {
  for (const rule of rules) {
    if (rule.type === "hostname") {
      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        continue;
      }

      if (!rule.regex.test(hostname)) {
        continue;
      }

      return url.replace(
        new RegExp(`(:\\/\\/)${escapeRegex(hostname)}(?=[:/]|$)`, "i"),
        `$1${rule.normalized}`,
      );
    }

    if (rule.type === "url") {
      const normalized = url.replace(rule.regex, rule.replacement);
      if (normalized !== url) {
        return normalized;
      }
    }
  }

  return url;
}

export function normalizeUrl(url: string, settings: Settings): string {
  if (!SUPPORTED_URL.test(url)) {
    return url;
  }

  const parsedRules = parseUrlRules(settings.urlRules);
  const normalizationRules = parsedRules.rules.filter(
    (rule) => rule.type === "hostname" || rule.type === "url",
  );
  let normalized = applyCustomNormalization(url, normalizationRules);

  if (settings.ignorePath) {
    try {
      const parsedUrl = new URL(normalized);
      if (parsedUrl.protocol !== "file:") {
        normalized = parsedUrl.origin;
      }
    } catch {
      // A user replacement may produce a non-standard URL. The remaining
      // string-based normalization steps are still safe to apply.
    }
  } else {
    if (settings.ignoreQuery) {
      normalized = normalized.split("?")[0] ?? normalized;
    }
    if (settings.ignoreFragment) {
      normalized = normalized.split("#")[0] ?? normalized;
    }
  }

  if (settings.preferHttps) {
    normalized = normalized.replace(/^http:\/\//i, "https://");
  }
  if (settings.ignoreWww) {
    normalized = normalized.replace(/(:\/\/)www\./i, "$1");
  }
  if (settings.caseInsensitive) {
    normalized = normalized.toLowerCase();
  }

  return normalized.replace(/\/$/, "");
}
