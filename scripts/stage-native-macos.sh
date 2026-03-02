#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" || "${2:-}" == "" ]]; then
  echo "Usage: $0 <input_executable> <output_dir>" >&2
  exit 1
fi

input_exe="$1"
output_dir="$2"
runtime_lib_dir="$output_dir/lib"

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

mkdir -p "$output_dir"
mkdir -p "$runtime_lib_dir"

# Keep the bundle deterministic and clean across repeated staging runs.
rm -f "$output_dir"/*.dylib
rm -f "$runtime_lib_dir"/*.dylib

exe_name="$(basename "$input_exe")"
staged_exe="$output_dir/$exe_name"
if [[ "$(cd "$(dirname "$input_exe")" && pwd)/$(basename "$input_exe")" != "$(cd "$output_dir" && pwd)/$exe_name" ]]; then
  cp -f "$input_exe" "$staged_exe"
fi
chmod +x "$staged_exe" || true

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
    staged_dep="$runtime_lib_dir/$dep_base"
    if [[ ! -f "$staged_dep" ]]; then
      cp -f "$dep" "$staged_dep"
    fi
    queue+=("$staged_dep")
  done < <(otool -L "$current" | awk 'NR > 1 { print $1 }')
done

for file in "$staged_exe" "$runtime_lib_dir"/*; do
  [[ -f "$file" ]] || continue

  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    case "$dep" in
      /System/*|/usr/lib/*|@executable_path/*|@loader_path/*|@rpath/*)
        continue
        ;;
    esac

    dep_base="$(basename "$dep")"
    if [[ -f "$runtime_lib_dir/$dep_base" ]]; then
      install_name_tool -change "$dep" "@executable_path/lib/$dep_base" "$file" || true
    fi
  done < <(otool -L "$file" | awk 'NR > 1 { print $1 }')

  if [[ "$file" == *.dylib ]]; then
    install_name_tool -id "@executable_path/lib/$(basename "$file")" "$file" || true
  fi
done

# install_name_tool invalidates existing signatures; ad-hoc re-sign the bundle.
for file in "$runtime_lib_dir"/*.dylib "$staged_exe"; do
  [[ -f "$file" ]] || continue
  codesign --force --sign - --timestamp=none "$file" >/dev/null
done

echo "Staged native runtime files in $output_dir"
ls -1 "$output_dir"
