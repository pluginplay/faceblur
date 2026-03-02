#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const binDir = path.join(root, "src", "bin");
const libDir = path.join(binDir, "lib");
const platform = os.platform();
const executable =
  platform === "win32"
    ? path.join(binDir, "face_pipeline.exe")
    : path.join(binDir, "face_pipeline");

const requiredModelFiles = [
  path.join(binDir, "models", "scrfd_2.5g_kps_640x640.onnx"),
  path.join(binDir, "models", "rf_detr_small", "rf-detr-small.onnx"),
];

function fail(message) {
  console.error(`[verify:native] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(binDir)) {
  fail(`Missing native bin directory: ${binDir}`);
}
if (!fs.existsSync(executable)) {
  fail(`Missing pipeline executable: ${executable}`);
}

if (platform !== "win32") {
  const stat = fs.statSync(executable);
  if ((stat.mode & 0o111) === 0) {
    fail(`Pipeline executable is not marked executable: ${executable}`);
  }
}

for (const modelPath of requiredModelFiles) {
  if (!fs.existsSync(modelPath)) {
    fail(`Missing required model file: ${modelPath}`);
  }
}

if (platform === "darwin") {
  if (!fs.existsSync(libDir)) {
    fail(`Missing macOS runtime library directory: ${libDir}`);
  }

  const dylibs = fs
    .readdirSync(libDir)
    .filter((name) => name.toLowerCase().endsWith(".dylib"));
  if (dylibs.length === 0) {
    fail("No bundled macOS dylibs found in src/bin/lib.");
  }

  const otoolOutput = execFileSync("otool", ["-L", executable], {
    encoding: "utf8",
  });
  const deps = otoolOutput
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter(Boolean);

  const nonPortableDeps = deps.filter(
    (dep) =>
      dep.startsWith("/") &&
      !dep.startsWith("/System/") &&
      !dep.startsWith("/usr/lib/")
  );
  if (nonPortableDeps.length > 0) {
    fail(
      `Found non-portable absolute dylib dependencies:\n${nonPortableDeps.join("\n")}`
    );
  }

  const missingBundledDeps = deps
    .filter((dep) => dep.startsWith("@executable_path/lib/"))
    .map((dep) => dep.replace("@executable_path/lib/", ""))
    .filter((name) => !fs.existsSync(path.join(libDir, name)));

  if (missingBundledDeps.length > 0) {
    fail(
      `Executable references missing bundled dylibs:\n${missingBundledDeps.join(
        "\n"
      )}`
    );
  }
}

console.log("[verify:native] Native bundle looks valid.");
