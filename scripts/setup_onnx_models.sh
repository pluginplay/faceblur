#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="${1:-$ROOT_DIR/src/bin/models}"

RF_DETR_URL="${RF_DETR_URL:-https://huggingface.co/PierreMarieCurie/rf-detr-onnx/resolve/main/rf-detr-small.onnx}"
SCRFD_ONNX_URL="${SCRFD_ONNX_URL:-}"
OSNET_ONNX_PATH="${OSNET_ONNX_PATH:-$ROOT_DIR/_generated/model_cache/osnet_ibn_x1_0.onnx}"
OSNET_ONNX_DATA_PATH="${OSNET_ONNX_DATA_PATH:-$ROOT_DIR/_generated/model_cache/osnet_ibn_x1_0.onnx.data}"
SCRFD_LOCAL_PATH="${SCRFD_LOCAL_PATH:-$ROOT_DIR/cpp/models/scrfd_2.5g_kps_640x640/contentFiles/any/any/onnx/scrfd_2.5g_kps_640x640.onnx}"

mkdir -p "$MODELS_DIR/rf_detr_small" "$MODELS_DIR/osnet_ibn_x1_0"

fetch_file() {
  local url="$1"
  local out="$2"
  echo "Downloading: $url"
  curl -L --fail --retry 3 --retry-delay 2 "$url" -o "$out"
}

copy_or_fail() {
  local src="$1"
  local out="$2"
  if [[ ! -f "$src" ]]; then
    echo "Missing required file: $src" >&2
    return 1
  fi
  cp -f "$src" "$out"
}

echo "Installing RF-DETR ONNX"
fetch_file "$RF_DETR_URL" "$MODELS_DIR/rf_detr_small/rf-detr-small.onnx"

echo "Installing OSNet ONNX"
copy_or_fail "$OSNET_ONNX_PATH" "$MODELS_DIR/osnet_ibn_x1_0/osnet_ibn_x1_0.onnx"
if [[ -f "$OSNET_ONNX_DATA_PATH" ]]; then
  cp -f "$OSNET_ONNX_DATA_PATH" "$MODELS_DIR/osnet_ibn_x1_0/osnet_ibn_x1_0.onnx.data"
else
  echo "Warning: OSNet external data file not found at $OSNET_ONNX_DATA_PATH"
fi

echo "Installing SCRFD ONNX"
if [[ -n "$SCRFD_ONNX_URL" ]]; then
  fetch_file "$SCRFD_ONNX_URL" "$MODELS_DIR/scrfd_2.5g_kps_640x640.onnx"
else
  copy_or_fail "$SCRFD_LOCAL_PATH" "$MODELS_DIR/scrfd_2.5g_kps_640x640.onnx"
fi

echo "Done. Models installed under: $MODELS_DIR"
