// @vitest-environment node

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  copyExtensionReleaseFiles,
  releaseCopyEntries,
  shouldUseScaffoldFallback,
} from "../vite.config";

const implementationEntries = ["background", "popup", "options"];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

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

describe("release asset copying", () => {
  it("defines every required distribution license asset", () => {
    expect(releaseCopyEntries).toEqual([
      "manifest.json",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "icons",
      "licenses",
    ]);
  });

  it("copies required release files and directories into dist", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "tab-index-project-"));
    const distRoot = mkdtempSync(join(tmpdir(), "tab-index-dist-"));
    temporaryDirectories.push(projectRoot, distRoot);

    writeFileSync(join(projectRoot, "manifest.json"), "manifest");
    writeFileSync(join(projectRoot, "LICENSE"), "project license");
    writeFileSync(
      join(projectRoot, "THIRD_PARTY_NOTICES.md"),
      "third-party notices",
    );
    mkdirSync(join(projectRoot, "icons"));
    writeFileSync(join(projectRoot, "icons/icon-16.svg"), "icon");
    mkdirSync(join(projectRoot, "licenses"));
    writeFileSync(
      join(projectRoot, "licenses/fuse.js-Apache-2.0.txt"),
      "dependency license",
    );

    copyExtensionReleaseFiles(projectRoot, distRoot);

    expect(readFileSync(join(distRoot, "manifest.json"), "utf8")).toBe(
      "manifest",
    );
    expect(readFileSync(join(distRoot, "LICENSE"), "utf8")).toBe(
      "project license",
    );
    expect(readFileSync(join(distRoot, "THIRD_PARTY_NOTICES.md"), "utf8")).toBe(
      "third-party notices",
    );
    expect(readFileSync(join(distRoot, "icons/icon-16.svg"), "utf8")).toBe(
      "icon",
    );
    expect(
      readFileSync(
        join(distRoot, "licenses/fuse.js-Apache-2.0.txt"),
        "utf8",
      ),
    ).toBe("dependency license");
  });

  it("fails the build copy when a required release asset is missing", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "tab-index-project-"));
    const distRoot = mkdtempSync(join(tmpdir(), "tab-index-dist-"));
    temporaryDirectories.push(projectRoot, distRoot);

    expect(() => copyExtensionReleaseFiles(projectRoot, distRoot)).toThrow();
  });
});

describe("Firefox minimum versions", () => {
  it("targets Firefox 142 without advertising untested Android support", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../manifest.json"), "utf8"),
    );

    expect(manifest.browser_specific_settings.gecko.strict_min_version).toBe(
      "142.0",
    );
    expect(manifest.browser_specific_settings).not.toHaveProperty(
      "gecko_android",
    );
  });

  it("ships the macOS tab-search shortcut verified by live smoke", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../manifest.json"), "utf8"),
    );

    expect(manifest.commands["search-tabs"].suggested_key.mac).toBe(
      "Command+Shift+Y",
    );
  });
});

describe("source release", () => {
  it("packages a version-matched source archive beside the extension ZIP", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"),
    );

    expect(packageJson.scripts.package).toContain("npm run package:source");
    expect(packageJson.scripts["package:source"]).toBe(
      "node scripts/package-source.mjs",
    );
    expect(
      readFileSync(
        resolve(import.meta.dirname, "../scripts/package-source.mjs"),
        "utf8",
      ),
    ).toContain(
      "`tab_index-${packageJson.version}-source.tar.gz`",
    );
  });

  it("dates the modification notices in every adapted domain file", () => {
    for (const file of [
      "duplicates.ts",
      "rules.ts",
      "title.ts",
      "url.ts",
    ]) {
      expect(
        readFileSync(
          resolve(import.meta.dirname, `../src/domain/${file}`),
          "utf8",
        ),
      ).toContain("Modified for Tab Index on 2026-10-08.");
    }
  });
});
