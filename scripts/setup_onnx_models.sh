#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="${1:-$ROOT_DIR/src/bin/models}"

RF_DETR_URL="${RF_DETR_URL:-https://huggingface.co/PierreMarieCurie/rf-detr-onnx/resolve/main/rf-detr-small.onnx?download=true}"
SCRFD_ONNX_URL="${SCRFD_ONNX_URL:-https://huggingface.co/PierreMarieCurie/scrfd-onnx/resolve/main/scrfd_2.5g_kps_640x640.onnx?download=true}"
OSNET_ONNX_URL="${OSNET_ONNX_URL:-https://huggingface.co/PierreMarieCurie/osnet-reid-onnx/resolve/main/osnet_ibn_x1_0.onnx?download=true}"
OSNET_ONNX_DATA_URL="${OSNET_ONNX_DATA_URL:-https://huggingface.co/PierreMarieCurie/osnet-reid-onnx/resolve/main/osnet_ibn_x1_0.onnx.data?download=true}"

# Local fallback paths (dev machines only)
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

assert_not_lfs_pointer() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "Model file not found: $file" >&2
    return 1
  fi
  if head -n 1 "$file" | grep -q "version https://git-lfs.github.com/spec/v1"; then
    echo "Downloaded model is a Git LFS pointer, not binary content: $file" >&2
    return 1
  fi
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

# --- RF-DETR (required) ---
echo "Installing RF-DETR ONNX"
fetch_file "$RF_DETR_URL" "$MODELS_DIR/rf_detr_small/rf-detr-small.onnx"
assert_not_lfs_pointer "$MODELS_DIR/rf_detr_small/rf-detr-small.onnx"

# --- SCRFD (required) ---
echo "Installing SCRFD ONNX"
if [[ -n "$SCRFD_ONNX_URL" ]]; then
  fetch_file "$SCRFD_ONNX_URL" "$MODELS_DIR/scrfd_2.5g_kps_640x640.onnx"
elif [[ -f "$SCRFD_LOCAL_PATH" ]]; then
  copy_or_fail "$SCRFD_LOCAL_PATH" "$MODELS_DIR/scrfd_2.5g_kps_640x640.onnx"
else
  echo "Error: No SCRFD source. Set SCRFD_ONNX_URL or place model at $SCRFD_LOCAL_PATH" >&2
  exit 1
fi

# --- OSNet body ReID (optional — pipeline works without it) ---
echo "Installing OSNet ONNX (optional)"
osnet_installed=false
if [[ -n "$OSNET_ONNX_URL" ]]; then
  if fetch_file "$OSNET_ONNX_URL" "$MODELS_DIR/osnet_ibn_x1_0/osnet_ibn_x1_0.onnx" 2>/dev/null; then
    osnet_installed=true
  fi
elif [[ -f "$OSNET_ONNX_PATH" ]]; then
  cp -f "$OSNET_ONNX_PATH" "$MODELS_DIR/osnet_ibn_x1_0/osnet_ibn_x1_0.onnx"
  osnet_installed=true
fi

if $osnet_installed; then
  # Try to fetch or copy the external data file
  if [[ -n "${OSNET_ONNX_DATA_URL:-}" ]]; then
    fetch_file "$OSNET_ONNX_DATA_URL" "$MODELS_DIR/osnet_ibn_x1_0/osnet_ibn_x1_0.onnx.data" 2>/dev/null || true
  elif [[ -f "$OSNET_ONNX_DATA_PATH" ]]; then
    cp -f "$OSNET_ONNX_DATA_PATH" "$MODELS_DIR/osnet_ibn_x1_0/osnet_ibn_x1_0.onnx.data"
  else
    echo "Warning: OSNet external data file not available — ReID may not work."
  fi
  echo "OSNet installed."
else
  echo "Warning: OSNet model not available — body ReID will be disabled at runtime."
fi

echo "Done. Models installed under: $MODELS_DIR"
