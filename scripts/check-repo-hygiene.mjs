#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { statSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(process.cwd());
const LFS_REQUIRED_EXTENSIONS = [
  ".onnx",
  ".onnx.data",
  ".bin",
  ".dylib",
  ".dll",
  ".exe",
];
const LARGE_FILE_BYTES = 20 * 1024 * 1024;

const runGit = (args) =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();

const trackedFiles = runGit(["ls-files"])
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const issues = [];

for (const path of trackedFiles) {
  if (path.startsWith("tmp_models/")) {
    issues.push(`Temporary model path is tracked: ${path}`);
  }
}

const lfsCandidates = trackedFiles.filter((file) => {
  if (!file.startsWith("src/bin/")) return false;
  return LFS_REQUIRED_EXTENSIONS.some((ext) => file.endsWith(ext));
});

const checkAttr = (paths) => {
  if (paths.length === 0) return [];
  const output = execFileSync("git", ["check-attr", "filter", "--stdin"], {
    cwd: repoRoot,
    input: `${paths.join("\n")}\n`,
    encoding: "utf8",
  }).trim();
  return output.split("\n").filter(Boolean);
};

const attrLines = checkAttr(lfsCandidates);
for (const line of attrLines) {
  const match = /^(.+?):\s+filter:\s+(.+)$/.exec(line);
  if (!match) continue;
  const [, file, filter] = match;
  if (filter !== "lfs") {
    issues.push(`Missing LFS tracking for binary/model file: ${file}`);
  }
}

for (const file of trackedFiles) {
  if (!file.startsWith("src/bin/")) continue;
  const absolute = resolve(repoRoot, file);
  if (!existsSync(absolute)) continue;
  try {
    const size = statSync(absolute).size;
    if (size >= LARGE_FILE_BYTES) {
      const filterLine = checkAttr([file])[0] ?? "";
      if (!filterLine.endsWith(" lfs")) {
        issues.push(
          `Large file (${Math.round(size / (1024 * 1024))}MB) is not LFS-tracked: ${file}`,
        );
      }
    }
  } catch {
    // Ignore stat failures from deleted/virtualized files.
  }
}

if (issues.length > 0) {
  console.error("Repository hygiene checks failed:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Repository hygiene checks passed.");
