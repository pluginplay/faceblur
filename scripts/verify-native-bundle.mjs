#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const argv = process.argv.slice(2);

function getArgValue(name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}
function hasArg(name) {
  return argv.includes(name);
}

const targetArg = (getArgValue("--target") || "host").toLowerCase();
const binDirArg = getArgValue("--bin-dir");
const skipModels = hasArg("--skip-models");
const binDir = path.resolve(root, binDirArg || path.join("src", "bin"));
const hostPlatform = os.platform();

const requiredModelRelativePaths = [
  path.join("scrfd_2.5g_kps_640x640.onnx"),
  path.join("rf_detr_small", "rf-detr-small.onnx"),
];

function fail(message) {
  console.error(`[verify:native] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(binDir)) {
  fail(`Missing native bin directory: ${binDir}`);
}

function verifyRequiredModels(modelRootDir) {
  if (skipModels) return;
  for (const modelRelativePath of requiredModelRelativePaths) {
    const modelPath = path.join(modelRootDir, modelRelativePath);
    if (!fs.existsSync(modelPath)) {
      fail(`Missing required model file: ${modelPath}`);
    }
    const fd = fs.openSync(modelPath, "r");
    const buffer = Buffer.alloc(256);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const snippet = buffer.subarray(0, bytesRead).toString("utf8");
    if (snippet.startsWith("version https://git-lfs.github.com/spec/v1")) {
      fail(`Model file is a Git LFS pointer, not a binary model: ${modelPath}`);
    }
  }
}

function verifyMacos() {
  const appDir = path.join(binDir, "face_pipeline.app");
  const appContentsDir = path.join(appDir, "Contents");
  const infoPlistPath = path.join(appContentsDir, "Info.plist");
  const pkgInfoPath = path.join(appContentsDir, "PkgInfo");
  const executable = path.join(appContentsDir, "MacOS", "face_pipeline");
  const frameworksDir = path.join(appContentsDir, "Frameworks");
  const appModelsDir = path.join(appContentsDir, "Resources", "models");

  const legacyExecutable = path.join(binDir, "face_pipeline");
  const legacyLibDir = path.join(binDir, "lib");
  if (fs.existsSync(legacyExecutable)) {
    fail(`Legacy flat macOS executable is not allowed: ${legacyExecutable}`);
  }
  if (fs.existsSync(legacyLibDir)) {
    fail(`Legacy flat macOS runtime library directory is not allowed: ${legacyLibDir}`);
  }

  if (!fs.existsSync(appDir)) {
    fail(`Missing macOS app bundle: ${appDir}`);
  }
  if (!fs.existsSync(infoPlistPath)) {
    fail(`Missing app metadata file: ${infoPlistPath}`);
  }
  if (!fs.existsSync(pkgInfoPath)) {
    fail(`Missing app package marker file: ${pkgInfoPath}`);
  }
  if (hostPlatform === "darwin") {
    const bundleId = execFileSync("plutil", [
      "-extract",
      "CFBundleIdentifier",
      "raw",
      infoPlistPath,
    ], { encoding: "utf8" }).trim();
    if (!bundleId || !bundleId.includes(".")) {
      fail(`Invalid CFBundleIdentifier in ${infoPlistPath}: "${bundleId}"`);
    }

    const minimumMacos = execFileSync("plutil", [
      "-extract",
      "LSMinimumSystemVersion",
      "raw",
      infoPlistPath,
    ], { encoding: "utf8" }).trim();
    if (!minimumMacos) {
      fail(`Missing LSMinimumSystemVersion in ${infoPlistPath}`);
    }
  }
  if (!fs.existsSync(executable)) {
    fail(`Missing app executable: ${executable}`);
  }
  const stat = fs.statSync(executable);
  if ((stat.mode & 0o111) === 0) {
    fail(`App executable is not marked executable: ${executable}`);
  }

  if (!fs.existsSync(frameworksDir)) {
    fail(`Missing macOS app Frameworks directory: ${frameworksDir}`);
  }

  verifyRequiredModels(appModelsDir);

  const dylibs = fs
    .readdirSync(frameworksDir)
    .filter((name) => name.toLowerCase().endsWith(".dylib"));
  if (dylibs.length === 0) {
    fail("No bundled macOS dylibs found in face_pipeline.app/Contents/Frameworks.");
  }

  const filesToCheck = [executable, ...dylibs.map((name) => path.join(frameworksDir, name))];
  for (const currentFile of filesToCheck) {
    const otoolOutput = execFileSync("otool", ["-L", currentFile], {
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
        `Found non-portable absolute dylib dependencies in ${currentFile}:\n${nonPortableDeps.join("\n")}`
      );
    }

    const missingBundledDeps = deps
      .filter(
        (dep) =>
          dep.startsWith("@executable_path/../Frameworks/") ||
          dep.startsWith("@rpath/")
      )
      .map((dep) =>
        dep.startsWith("@executable_path/../Frameworks/")
          ? dep.replace("@executable_path/../Frameworks/", "")
          : dep.replace("@rpath/", "")
      )
      .filter((name) => !fs.existsSync(path.join(frameworksDir, name)));

    if (missingBundledDeps.length > 0) {
      fail(
        `App bundle references missing Framework dylibs from ${currentFile}:\n${missingBundledDeps.join(
          "\n"
        )}`
      );
    }
  }
}

const SYSTEM_DLLS = new Set([
  "KERNEL32.dll",
  "USER32.dll",
  "GDI32.dll",
  "WINSPool.drv",
  "ADVAPI32.dll",
  "SHELL32.dll",
  "ole32.dll",
  "OLEAUT32.dll",
  "uuid.dll",
  "COMDLG32.dll",
  "WS2_32.dll",
  "IPHLPAPI.DLL",
  "CRYPT32.dll",
  "bcrypt.dll",
  "ntdll.dll",
  "RPCRT4.dll",
  "sechost.dll",
  "msvcrt.dll",
  "SHLWAPI.dll",
]);

function parseDependents(text) {
  const lines = text.split(/\r?\n/);
  const deps = [];
  let inDependents = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.includes("Image has the following dependencies:")) {
      inDependents = true;
      continue;
    }
    if (!inDependents || line.length === 0) continue;
    if (line.startsWith("Summary")) break;
    if (line.endsWith(".dll") || line.endsWith(".DLL")) {
      deps.push(line);
    }
  }
  return deps;
}

function verifyWindows() {
  const executable = path.join(binDir, "face_pipeline.exe");
  const modelRoot = path.join(binDir, "models");
  if (!fs.existsSync(executable)) {
    if (
      targetArg === "all" &&
      hostPlatform !== "win32" &&
      process.env.CI !== "true"
    ) {
      console.warn(
        `[verify:native] Skipping Windows verification for local non-Windows host (missing ${executable}).`
      );
      return;
    }
    fail(`Missing pipeline executable: ${executable}`);
  }

  verifyRequiredModels(modelRoot);

  const runtimeDlls = fs
    .readdirSync(binDir)
    .filter((name) => name.toLowerCase().endsWith(".dll"));
  if (runtimeDlls.length === 0) {
    fail(`No runtime DLLs found alongside ${executable}`);
  }

  const hasOnnxRuntime = runtimeDlls.some((name) =>
    name.toLowerCase().startsWith("onnxruntime")
  );
  if (!hasOnnxRuntime) {
    fail("Missing onnxruntime DLL in native bundle.");
  }

  const manifestPath = path.join(binDir, "windows-runtime-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    fail(`Missing Windows runtime manifest: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.copiedDlls)) {
    fail("Invalid windows-runtime-manifest.json (copiedDlls missing).");
  }
  const missingFromManifest = manifest.copiedDlls.filter(
    (name) => !fs.existsSync(path.join(binDir, name))
  );
  if (missingFromManifest.length > 0) {
    fail(
      `Windows bundle is missing DLL(s) listed by manifest:\n${missingFromManifest.join(
        "\n"
      )}`
    );
  }

  if (hostPlatform !== "win32") {
    return;
  }

  let dumpbinAvailable = true;
  try {
    execFileSync("where", ["dumpbin.exe"], { stdio: "ignore" });
  } catch {
    dumpbinAvailable = false;
  }
  if (!dumpbinAvailable) {
    fail("dumpbin.exe missing on Windows host; cannot validate import closure.");
  }

  const queue = [executable];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const output = execFileSync("dumpbin.exe", ["/DEPENDENTS", current], {
      encoding: "utf8",
    });
    const deps = parseDependents(output);
    for (const dep of deps) {
      const upper = dep.toUpperCase();
      if (upper.startsWith("API-MS-WIN-") || upper.startsWith("EXT-MS-WIN-")) {
        continue;
      }
      if (SYSTEM_DLLS.has(upper)) continue;
      const depPath = path.join(binDir, dep);
      if (!fs.existsSync(depPath)) {
        fail(`Missing dependent DLL for ${path.basename(current)}: ${dep}`);
      }
      queue.push(depPath);
    }
  }
}

let targets;
switch (targetArg) {
  case "host":
  case "auto":
    targets = hostPlatform === "win32" ? ["windows"] : ["macos"];
    break;
  case "all":
    targets = ["macos", "windows"];
    break;
  case "mac":
  case "macos":
  case "darwin":
    targets = ["macos"];
    break;
  case "win":
  case "windows":
    targets = ["windows"];
    break;
  default:
    fail(`Unknown --target value: ${targetArg}`);
}

for (const target of targets) {
  if (target === "macos") verifyMacos();
  if (target === "windows") verifyWindows();
}

console.log("[verify:native] Native bundle looks valid.");
