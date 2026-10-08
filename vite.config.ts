import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
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

export function shouldUseScaffoldFallback(
  entryPaths: readonly string[],
  pathExists: (entryPath: string) => boolean = existsSync,
) {
  return entryPaths.every((entryPath) => !pathExists(entryPath));
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

function copyExtensionFiles() {
  return {
    name: "tab-index-copy-extension-files",
    closeBundle() {
      mkdirSync(distRoot, { recursive: true });
      copyFileSync(
        resolve(projectRoot, "manifest.json"),
        resolve(distRoot, "manifest.json"),
      );

      const iconsRoot = resolve(projectRoot, "icons");
      if (existsSync(iconsRoot)) {
        cpSync(iconsRoot, resolve(distRoot, "icons"), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  root: sourceRoot,
  publicDir: false,
  plugins: [
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
