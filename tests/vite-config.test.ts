// @vitest-environment node

import { describe, expect, it } from "vitest";

import { shouldUseScaffoldFallback } from "../vite.config";

const implementationEntries = ["background", "popup", "options"];

describe("shouldUseScaffoldFallback", () => {
  it("allows fallback when every implementation entry is missing", () => {
    expect(shouldUseScaffoldFallback(implementationEntries, () => false)).toBe(
      true,
    );
  });

  it("disables fallback when any implementation entry exists", () => {
    expect(
      shouldUseScaffoldFallback(
        implementationEntries,
        (entry) => entry === "background",
      ),
    ).toBe(false);
  });
});
