#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "Usage: $0 <native_dir>" >&2
  exit 1
fi

native_dir="$1"
identity="${MAC_CODESIGN_IDENTITY:-}"
entitlements="${MAC_CODESIGN_ENTITLEMENTS:-}"

if [[ -z "$identity" ]]; then
  echo "MAC_CODESIGN_IDENTITY is required." >&2
  exit 1
fi

if [[ ! -d "$native_dir" ]]; then
  echo "Native directory not found: $native_dir" >&2
  exit 1
fi

app_bundle="$native_dir/face_pipeline.app"
app_contents="$app_bundle/Contents"
frameworks_dir="$app_contents/Frameworks"
macos_dir="$app_contents/MacOS"
exe="$macos_dir/face_pipeline"

if [[ ! -d "$app_bundle" ]]; then
  echo "Missing app bundle: $app_bundle" >&2
  exit 1
fi
if [[ ! -f "$exe" ]]; then
  echo "Missing app executable: $exe" >&2
  exit 1
fi

if [[ -d "$frameworks_dir" ]]; then
  while IFS= read -r dylib; do
    [[ -f "$dylib" ]] || continue
    codesign --force --sign "$identity" --options runtime --timestamp "$dylib"
  done < <(ls "$frameworks_dir"/*.dylib 2>/dev/null || true)
fi

if [[ -d "$macos_dir" ]]; then
  while IFS= read -r inner_exe; do
    [[ -f "$inner_exe" ]] || continue
    [[ -x "$inner_exe" ]] || continue
    [[ "$inner_exe" == "$exe" ]] && continue
    codesign --force --sign "$identity" --options runtime --timestamp "$inner_exe"
  done < <(ls "$macos_dir"/* 2>/dev/null || true)
fi

codesign --force --sign "$identity" --options runtime --timestamp "$exe"

sign_args=(--force --sign "$identity" --options runtime --timestamp)
if [[ -n "$entitlements" ]]; then
  sign_args+=(--entitlements "$entitlements")
fi
codesign "${sign_args[@]}" "$app_bundle"

codesign --verify --deep --strict --verbose=2 "$app_bundle"

echo "Signed macOS app payload in $app_bundle"
