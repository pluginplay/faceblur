#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" || "${2:-}" == "" ]]; then
  echo "Usage: $0 <input_executable> <output_dir>" >&2
  exit 1
fi

input_exe="$1"
output_dir="$2"
app_dir="$output_dir/face_pipeline.app"
app_contents_dir="$app_dir/Contents"
app_macos_dir="$app_contents_dir/MacOS"
app_frameworks_dir="$app_contents_dir/Frameworks"
app_resources_dir="$app_contents_dir/Resources"
app_models_dir="$app_resources_dir/models"
app_info_plist="$app_contents_dir/Info.plist"
bundle_id="${MAC_NATIVE_BUNDLE_ID:-com.pluginplay.faceblur.face-pipeline}"
bundle_name="${MAC_NATIVE_BUNDLE_NAME:-FacePipeline}"
bundle_version="${MAC_NATIVE_BUNDLE_VERSION:-1.0.0}"
bundle_build="${MAC_NATIVE_BUNDLE_BUILD:-1}"
minimum_macos="${MAC_NATIVE_MINIMUM_MACOS:-15.5}"

if [[ ! -f "$input_exe" ]]; then
  echo "Input executable not found: $input_exe" >&2
  exit 1
fi

if ! command -v otool >/dev/null 2>&1; then
  echo "otool is required on macOS." >&2
  exit 1
fi
if ! command -v install_name_tool >/dev/null 2>&1; then
  echo "install_name_tool is required on macOS." >&2
  exit 1
fi
if ! command -v codesign >/dev/null 2>&1; then
  echo "codesign is required on macOS." >&2
  exit 1
fi

# If staging from src/bin/face_pipeline, preserve a temp source before cleanup.
safe_input_exe="$input_exe"
if [[ "$(cd "$(dirname "$input_exe")" && pwd)/$(basename "$input_exe")" == "$(cd "$output_dir" && pwd)/face_pipeline" ]]; then
  safe_input_exe="$(mktemp "${TMPDIR:-/tmp}/face_pipeline_staging.XXXXXX")"
  cp -f "$input_exe" "$safe_input_exe"
  chmod +x "$safe_input_exe" || true
fi

mkdir -p "$output_dir" "$app_macos_dir" "$app_frameworks_dir" "$app_resources_dir"

# Keep staging deterministic across repeated runs.
rm -rf "$app_dir"
rm -f "$output_dir/face_pipeline"
rm -rf "$output_dir/lib"
mkdir -p "$app_macos_dir" "$app_frameworks_dir" "$app_resources_dir"

cat > "$app_info_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleName</key>
    <string>${bundle_name}</string>
    <key>CFBundleDisplayName</key>
    <string>${bundle_name}</string>
    <key>CFBundleIdentifier</key>
    <string>${bundle_id}</string>
    <key>CFBundleVersion</key>
    <string>${bundle_build}</string>
    <key>CFBundleShortVersionString</key>
    <string>${bundle_version}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleExecutable</key>
    <string>face_pipeline</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>${minimum_macos}</string>
    <key>NSHighResolutionCapable</key>
    <true/>
  </dict>
</plist>
EOF

printf "APPL????" > "$app_contents_dir/PkgInfo"

exe_name="$(basename "$input_exe")"
staged_exe="$app_macos_dir/$exe_name"
if [[ "$(cd "$(dirname "$safe_input_exe")" && pwd)/$(basename "$safe_input_exe")" != "$(cd "$app_macos_dir" && pwd)/$exe_name" ]]; then
  cp -f "$safe_input_exe" "$staged_exe"
fi
chmod +x "$staged_exe" || true

source_models_dir="$output_dir/models"
if [[ -d "$source_models_dir" ]]; then
  rm -rf "$app_models_dir"
  mkdir -p "$app_models_dir"
  cp -Rf "$source_models_dir"/. "$app_models_dir"/
fi

is_processed() {
  local needle="$1"
  if [[ "$#" -le 1 ]]; then
    return 1
  fi
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

queue=("$staged_exe")
processed=()

while (( ${#queue[@]} > 0 )); do
  current="${queue[0]}"
  queue=("${queue[@]:1}")

  if is_processed "$current" "${processed[@]-}"; then
    continue
  fi
  processed+=("$current")

  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    case "$dep" in
      /System/*|/usr/lib/*|@executable_path/*|@loader_path/*|@rpath/*)
        continue
        ;;
    esac
    [[ -f "$dep" ]] || continue

    dep_base="$(basename "$dep")"
    staged_dep="$app_frameworks_dir/$dep_base"
    if [[ ! -f "$staged_dep" ]]; then
      cp -f "$dep" "$staged_dep"
    fi
    queue+=("$staged_dep")
  done < <(otool -L "$current" | awk 'NR > 1 { print $1 }')
done

for file in "$staged_exe" "$app_frameworks_dir"/*; do
  [[ -f "$file" ]] || continue

  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    case "$dep" in
      /System/*|/usr/lib/*|@executable_path/*|@loader_path/*|@rpath/*)
        continue
        ;;
    esac

    dep_base="$(basename "$dep")"
    if [[ -f "$app_frameworks_dir/$dep_base" ]]; then
      install_name_tool -change "$dep" "@executable_path/../Frameworks/$dep_base" "$file" || true
    fi
  done < <(otool -L "$file" | awk 'NR > 1 { print $1 }')

  if [[ "$file" == *.dylib ]]; then
    install_name_tool -id "@rpath/$(basename "$file")" "$file" || true
  fi
done

# install_name_tool invalidates existing signatures; ad-hoc re-sign all internals.
for file in "$app_frameworks_dir"/*.dylib "$staged_exe"; do
  [[ -f "$file" ]] || continue
  codesign --force --sign - --timestamp=none "$file" >/dev/null
done

echo "Staged native runtime app in $app_dir"
ls -1 "$app_contents_dir"

if [[ "$safe_input_exe" != "$input_exe" && -f "$safe_input_exe" ]]; then
  rm -f "$safe_input_exe"
fi
