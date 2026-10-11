import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const sourceRoot = resolve(projectRoot, "src");
const distRoot = resolve(projectRoot, "dist");
const backgroundEntry = resolve(sourceRoot, "background/index.ts");
const implementationEntries = [
  backgroundEntry,
  resolve(sourceRoot, "popup/main.tsx"),
  resolve(sourceRoot, "options/main.tsx"),
];
const preactRuntimeSuffix = "/node_modules/preact/dist/preact.mjs";
const preactInnerHtmlAssignment =
  /\b[$A-Z_a-z][$\w]*\.innerHTML\s*=\s*[$A-Z_a-z][$\w]*\.__html\b/g;

export const releaseCopyEntries = [
  "manifest.json",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "icons",
  "licenses",
];

export function shouldUseScaffoldFallback(
  entryPaths: readonly string[],
  pathExists: (entryPath: string) => boolean = existsSync,
) {
  return entryPaths.every((entryPath) => !pathExists(entryPath));
}

export function disablePreactDangerouslySetInnerHtml(
  code: string,
  id: string,
): string | null {
  const modulePath = id.split("?", 1)[0]?.replaceAll("\\", "/");
  if (!modulePath?.endsWith(preactRuntimeSuffix)) {
    return null;
  }

  const matches = code.match(preactInnerHtmlAssignment);
  if (matches?.length !== 1) {
    throw new Error(
      `Expected one Preact innerHTML assignment, found ${matches?.length ?? 0}`,
    );
  }

  return code.replace(
    preactInnerHtmlAssignment,
    '(() => { throw new Error("Preact dangerouslySetInnerHTML is disabled"); })()',
  );
}

function disablePreactDangerouslySetInnerHtmlPlugin() {
  return {
    name: "tab-index-disable-preact-dangerously-set-inner-html",
    transform(code: string, id: string) {
      return disablePreactDangerouslySetInnerHtml(code, id);
    },
  };
}

function scaffoldFallbackEntries() {
  const virtualPrefix = "\0tab-index-empty:";
  const scaffoldEntries = new Set(implementationEntries);

  return {
    name: "tab-index-initial-scaffold-entries",
    resolveId(source: string, importer?: string) {
      const entryPath =
        importer && source.startsWith(".")
          ? resolve(dirname(importer), source)
          : source;

      if (scaffoldEntries.has(entryPath) && !existsSync(entryPath)) {
        return `${virtualPrefix}${entryPath}`;
      }

      return null;
    },
    load(id: string) {
      if (id.startsWith(virtualPrefix)) {
        return "";
      }

      return null;
    },
  };
}

const useScaffoldFallback = shouldUseScaffoldFallback(implementationEntries);

export function copyExtensionReleaseFiles(
  releaseRoot: string,
  releaseDistRoot: string,
) {
  mkdirSync(releaseDistRoot, { recursive: true });

  for (const entry of releaseCopyEntries) {
    cpSync(resolve(releaseRoot, entry), resolve(releaseDistRoot, entry), {
      recursive: true,
    });
  }
}

function copyExtensionFiles() {
  return {
    name: "tab-index-copy-extension-files",
    closeBundle() {
      copyExtensionReleaseFiles(projectRoot, distRoot);
    },
  };
}

export default defineConfig({
  root: sourceRoot,
  publicDir: false,
  plugins: [
    disablePreactDangerouslySetInnerHtmlPlugin(),
    ...(useScaffoldFallback ? [scaffoldFallbackEntries()] : []),
    copyExtensionFiles(),
  ],
  build: {
    outDir: distRoot,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(sourceRoot, "popup/index.html"),
        options: resolve(sourceRoot, "options/index.html"),
        background: backgroundEntry,
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background"
            ? "background.js"
            : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
