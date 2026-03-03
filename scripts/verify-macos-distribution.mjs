#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const argv = process.argv.slice(2);

function getArgValue(name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function fail(message) {
  console.error(`[verify:mac:dist] ${message}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
  });
  if (result.error) {
    fail(`Failed running ${command}: ${result.error.message}`);
  }
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed:\n${output}`.trim());
  }
  return output;
}

if (os.platform() !== "darwin") {
  fail("This check only runs on macOS hosts.");
}

const appPath = path.resolve(
  root,
  getArgValue("--app") || path.join("src", "bin", "face_pipeline.app")
);
const executablePath = path.join(appPath, "Contents", "MacOS", "face_pipeline");

if (!fs.existsSync(appPath)) {
  fail(`Missing app bundle: ${appPath}`);
}
if (!fs.existsSync(executablePath)) {
  fail(`Missing app executable: ${executablePath}`);
}

run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
const codeSignMetadata = run("codesign", ["-dv", "--verbose=4", appPath]);

const teamIdLine = codeSignMetadata
  .split("\n")
  .map((line) => line.trim())
  .find((line) => line.startsWith("TeamIdentifier="));
if (!teamIdLine || teamIdLine === "TeamIdentifier=not set") {
  fail(
    "App is not signed with a Developer ID identity (TeamIdentifier missing)."
  );
}

if (!codeSignMetadata.includes("Authority=Developer ID Application")) {
  fail("App signature is missing Developer ID Application authority.");
}

if (!codeSignMetadata.includes("Timestamp=")) {
  fail("App signature is missing trusted timestamp.");
}

if (!codeSignMetadata.includes("Runtime Version=")) {
  fail("App signature is missing hardened runtime.");
}

run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath]);
run("xcrun", ["stapler", "validate", appPath]);

console.log(
  `[verify:mac:dist] Gatekeeper checks passed for ${appPath} (Developer ID + notarized ticket validated).`
);
