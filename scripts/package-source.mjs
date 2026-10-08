import { mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8"),
);
const artifactsRoot = resolve(projectRoot, "web-ext-artifacts");
const archivePath = resolve(
  artifactsRoot,
  `tab_index-${packageJson.version}-source.tar.gz`,
);

mkdirSync(artifactsRoot, { recursive: true });

const trackedFiles = spawnSync("git", ["ls-files", "-z"], {
  cwd: projectRoot,
  encoding: "buffer",
});
if (trackedFiles.status !== 0) {
  throw new Error(trackedFiles.stderr.toString() || "git ls-files failed");
}

const archive = spawnSync(
  "tar",
  ["--null", "-czf", archivePath, "-T", "-"],
  {
    cwd: projectRoot,
    input: trackedFiles.stdout,
    encoding: "buffer",
  },
);
if (archive.status !== 0) {
  throw new Error(archive.stderr.toString() || "source archive failed");
}

process.stdout.write(`Source archive ready: ${archivePath}\n`);
