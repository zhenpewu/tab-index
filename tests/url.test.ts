import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../src/domain/settings";
import { normalizeUrl } from "../src/domain/url";

function settings(overrides = {}) {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("normalizeUrl", () => {
  it("removes fragments when configured", () => {
    expect(
      normalizeUrl(
        "https://example.com/article#comments",
        settings({ ignoreFragment: true }),
      ),
    ).toBe("https://example.com/article");
  });

  it("removes query parameters when configured", () => {
    expect(
      normalizeUrl(
        "https://example.com/search?q=firefox",
        settings({ ignoreQuery: true }),
      ),
    ).toBe("https://example.com/search");
  });

  it("removes non-file paths when configured", () => {
    expect(
      normalizeUrl(
        "https://example.com/projects/42?view=full#activity",
        settings({ ignorePath: true }),
      ),
    ).toBe("https://example.com");
  });

  it("ignores leading www and URL case when configured", () => {
    expect(
      normalizeUrl(
        "HTTPS://WWW.Example.COM/Release",
        settings({ ignoreWww: true, caseInsensitive: true }),
      ),
    ).toBe("https://example.com/release");
  });

  it("treats HTTP and HTTPS as equivalent when Prefer HTTPS is enabled", () => {
    expect(
      normalizeUrl("http://example.com/page", settings({ preferHttps: true })),
    ).toBe(
      normalizeUrl(
        "https://example.com/page",
        settings({ preferHttps: true }),
      ),
    );
  });

  it("applies custom hostname normalization before built-in toggles", () => {
    expect(
      normalizeUrl(
        "http://mirror.example/Release/",
        settings({
          caseInsensitive: true,
          urlRules: JSON.stringify([
            { type: "normalize", pattern: "mirror.*" },
          ]),
        }),
      ),
    ).toBe("https://mirror.x/release");
  });

  it("applies the first matching custom URL replacement before toggles", () => {
    expect(
      normalizeUrl(
        "https://m.example.com/items/42?source=mobile",
        settings({
          ignoreQuery: true,
          urlRules: JSON.stringify([
            {
              type: "replace",
              pattern: "/^https:\\/\\/m\\.example\\.com\\/(.*)$/i",
              replacement: "http://example.com/$1",
            },
            {
              type: "replace",
              pattern: "/example\\.com/",
              replacement: "ignored.example",
            },
          ]),
        }),
      ),
    ).toBe("https://example.com/items/42");
  });

  it("preserves file paths when path removal is enabled", () => {
    expect(
      normalizeUrl(
        "file:///Users/example/report/",
        settings({ ignorePath: true }),
      ),
    ).toBe("file:///Users/example/report");
  });

  it("leaves browser URLs and unsupported input unchanged", () => {
    expect(normalizeUrl("about:preferences/", settings())).toBe(
      "about:preferences/",
    );
    expect(normalizeUrl("not a URL/", settings())).toBe("not a URL/");
  });

  it("removes a trailing slash from supported URLs", () => {
    expect(normalizeUrl("https://example.com/path/", settings())).toBe(
      "https://example.com/path",
    );
  });
});
