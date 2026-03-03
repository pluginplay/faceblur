#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "Usage: $0 <native_dir>" >&2
  exit 1
fi

native_dir="$1"
if [[ ! -d "$native_dir" ]]; then
  echo "Native directory not found: $native_dir" >&2
  exit 1
fi
app_bundle="$native_dir/face_pipeline.app"
if [[ ! -d "$app_bundle" ]]; then
  echo "Missing app bundle: $app_bundle" >&2
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun is required for notarization." >&2
  exit 1
fi

archive="$(mktemp -u)/native-macos.zip"
mkdir -p "$(dirname "$archive")"

/usr/bin/ditto -c -k --keepParent "$app_bundle" "$archive"

submit_args=(notarytool submit "$archive" --wait --output-format json)

if [[ -n "${MAC_NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
  submit_args+=(--keychain-profile "$MAC_NOTARY_KEYCHAIN_PROFILE")
else
  if [[ -z "${MAC_NOTARY_APPLE_ID:-}" || -z "${MAC_NOTARY_TEAM_ID:-}" || -z "${MAC_NOTARY_APP_PASSWORD:-}" ]]; then
    echo "Set MAC_NOTARY_KEYCHAIN_PROFILE or MAC_NOTARY_APPLE_ID/MAC_NOTARY_TEAM_ID/MAC_NOTARY_APP_PASSWORD." >&2
    exit 1
  fi
  submit_args+=(
    --apple-id "$MAC_NOTARY_APPLE_ID"
    --team-id "$MAC_NOTARY_TEAM_ID"
    --password "$MAC_NOTARY_APP_PASSWORD"
  )
fi

notary_output="$(xcrun "${submit_args[@]}")"
if [[ "$notary_output" != *"\"status\": \"Accepted\""* && "$notary_output" != *"\"status\":\"Accepted\""* ]]; then
  echo "Notarization did not return Accepted status." >&2
  echo "$notary_output" >&2
  exit 1
fi

xcrun stapler staple "$app_bundle"
xcrun stapler validate "$app_bundle"
echo "Notarization accepted and stapled for $app_bundle"
