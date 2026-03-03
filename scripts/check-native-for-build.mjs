#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const verifyScript = path.join(projectRoot, "scripts", "verify-native-bundle.mjs");

try {
  execFileSync(process.execPath, [verifyScript], {
    cwd: projectRoot,
    stdio: "inherit",
  });
} catch {
  const hostBuildCommand = os.platform() === "win32" ? "yarn build:win" : "yarn build:mac";
  console.error("");
  console.error("[build] Native bundle is missing or invalid for CEP build.");
  console.error(`[build] Run \`${hostBuildCommand}\` first, then rerun \`yarn build\`.`);
  process.exit(1);
}
