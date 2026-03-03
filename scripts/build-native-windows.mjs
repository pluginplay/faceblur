#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function run(command, args, options = {}) {
  const pretty = `${command} ${args.join(" ")}`;
  console.log(`[build:win] ${pretty}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.platform !== "win32") {
  console.error("[build:win] This command must be run on Windows.");
  process.exit(1);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const buildDir = path.join(root, "cpp", "build-win");
const vcpkgRoot = process.env.VCPKG_ROOT || "C:\\vcpkg";
const toolchain = path.join(vcpkgRoot, "scripts", "buildsystems", "vcpkg.cmake");

run("cmake", [
  "-S",
  path.join(root, "cpp"),
  "-B",
  buildDir,
  "-DCMAKE_BUILD_TYPE=Release",
  "-DFACE_PIPELINE_ENABLE_GMC=OFF",
  `-DCMAKE_TOOLCHAIN_FILE=${toolchain}`,
  "-DVCPKG_TARGET_TRIPLET=x64-windows",
]);

run("cmake", ["--build", buildDir, "--config", "Release"]);
run("cmake", ["--install", buildDir, "--prefix", path.join(root, "src", "bin"), "--config", "Release"]);
run(process.execPath, [path.join(root, "scripts", "stage-native-windows.mjs"), path.join(root, "src", "bin", "face_pipeline.exe"), path.join(root, "src", "bin")]);
run(process.execPath, [path.join(root, "scripts", "verify-native-bundle.mjs"), "--target", "windows"]);
