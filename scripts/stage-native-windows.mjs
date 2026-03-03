#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

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

function fail(message) {
  console.error(`[stage:native:win] ${message}`);
  process.exit(1);
}

function ensureCommand(name) {
  try {
    execFileSync("where", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

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

function resolveDll(name, searchPaths) {
  for (const dir of searchPaths) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

const inputExe = process.argv[2];
const outputDir = process.argv[3];

if (!inputExe || !outputDir) {
  fail("Usage: node scripts/stage-native-windows.mjs <input_exe> <output_dir>");
}

if (process.platform !== "win32") {
  fail("This script must run on Windows.");
}

if (!fs.existsSync(inputExe)) {
  fail(`Input executable not found: ${inputExe}`);
}

if (!ensureCommand("dumpbin.exe")) {
  fail(
    "dumpbin.exe not found in PATH. Open a VS Developer shell or add Visual Studio build tools to PATH."
  );
}

const outAbs = path.resolve(outputDir);
const exeAbs = path.resolve(inputExe);
const exeName = path.basename(exeAbs);
const stagedExe = path.join(outAbs, exeName);

fs.mkdirSync(outAbs, { recursive: true });

for (const entry of fs.readdirSync(outAbs)) {
  const abs = path.join(outAbs, entry);
  if (entry.toLowerCase().endsWith(".dll") || entry.toLowerCase().endsWith(".manifest")) {
    fs.rmSync(abs, { force: true });
  }
}

if (exeAbs !== stagedExe) {
  fs.copyFileSync(exeAbs, stagedExe);
}

const searchPaths = [
  path.dirname(exeAbs),
  path.dirname(stagedExe),
  path.join(process.env.VCPKG_ROOT || "C:\\vcpkg", "installed", "x64-windows", "bin"),
  ...((process.env.PATH || "").split(";").filter(Boolean)),
];

const queue = [stagedExe];
const seenBinaries = new Set();
const copiedDlls = new Set();
const missingDlls = new Set();
const dependencyGraph = {};

while (queue.length > 0) {
  const current = queue.shift();
  if (!current || seenBinaries.has(current)) continue;
  seenBinaries.add(current);

  const output = execFileSync("dumpbin.exe", ["/DEPENDENTS", current], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const deps = parseDependents(output);
  dependencyGraph[path.basename(current)] = deps;

  for (const dep of deps) {
    const depUpper = dep.toUpperCase();
    if (depUpper.startsWith("API-MS-WIN-")) continue;
    if (depUpper.startsWith("EXT-MS-WIN-")) continue;
    if (SYSTEM_DLLS.has(depUpper)) continue;

    const resolved = resolveDll(dep, searchPaths);
    if (!resolved) {
      missingDlls.add(dep);
      continue;
    }

    const target = path.join(outAbs, path.basename(resolved));
    if (!fs.existsSync(target)) {
      fs.copyFileSync(resolved, target);
    }
    copiedDlls.add(path.basename(resolved));
    queue.push(target);
  }
}

if (missingDlls.size > 0) {
  fail(
    `Missing dependent DLL(s): ${Array.from(missingDlls)
      .sort()
      .join(", ")}`
  );
}

const manifest = {
  platform: "windows",
  executable: exeName,
  copiedDlls: Array.from(copiedDlls).sort(),
  dependencyGraph,
};

fs.writeFileSync(
  path.join(outAbs, "windows-runtime-manifest.json"),
  JSON.stringify(manifest, null, 2)
);

console.log(
  `[stage:native:win] Staged ${exeName} with ${copiedDlls.size} runtime DLL(s) in ${outAbs}`
);
