# Face Blur CEP Extension

Adobe CEP extension for Premiere Pro that automatically detects faces in video sequences and generates animated blur masks.

## Features

- **Automatic face detection + tracking** using a native C++ pipeline (SCRFD + OC-SORT)
- **Animated blur masks** exported as MOGRT files
- **Interactive mask editing** with keyframe support
- **Frame-by-frame preview** with scrubbing and playback
- **Multiple masks** per sequence with split/merge operations

## Requirements

- Adobe Premiere Pro
- Node.js and Yarn
- No Python required to run the extension (Python is optional for dev/test tooling only)

## Quick Start

1. **Install dependencies:**
   ```bash
   yarn install
   ```

2. **Build native + CEP (macOS):**
   ```bash
   brew install onnxruntime                          # one-time
   bash scripts/setup_onnx_models.sh                 # if models are missing
   yarn build:mac
   ```

3. **Enable PlayerDebugMode** (for unsigned extensions):
   - Use [aescripts ZXP Installer](https://aescripts.com/learn/zxp-installer/) > Settings > Debug > Enable Debugging
   - Or follow [Adobe CEP Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md#debugging-unsigned-extensions)

4. **Build CEP:**
   ```bash
   yarn build
   ```
   `yarn build` is CEP-only and fails fast if `src/bin` native artifacts are missing/invalid.

5. **Development mode (HMR):**
   ```bash
   yarn dev --host
   ```

6. **Package:**
   ```bash
   yarn zxp
   ```

## Daily workflow

- Native changes or first local setup: `yarn build:mac`
- CEP-only iteration: `yarn build`
- HMR development: `yarn dev --host`
- ZXP packaging: `yarn zxp`

## Native face pipeline (C++)

The extension spawns a bundled native executable (`face_pipeline`) and reads JSON tracks from stdout.

### Bundle layout

| Path | Contents |
|------|----------|
| `src/bin/face_pipeline` | Executable (macOS) |
| `src/bin/face_pipeline.exe` | Executable (Windows) |
| `src/bin/lib/*.dylib` | macOS runtime libs (`@executable_path/lib`) |
| `src/bin/models/` | ONNX models (SCRFD, RF-DETR, optional OSNet) |

**Required models**: `scrfd_2.5g_kps_640x640.onnx`, `rf_detr_small/rf-detr-small.onnx`

### Build & deploy (macOS)

```bash
# 1. Install native deps (Homebrew)
brew install onnxruntime

# 2. Install ONNX models (if missing)
bash scripts/setup_onnx_models.sh

# 3. Build native and stage runtime bundle
yarn build:native
yarn stage:native:mac

# 4. Build CEP dist (runs native precheck)
yarn build

# 5. Package ZXP (runs verify:native automatically)
yarn zxp
```

For a single-command mac build: `yarn build:mac`.

**Staging** (`stage:native:mac`): Copies executable to `src/bin`, collects dylib deps into `src/bin/lib`, rewrites install names to `@executable_path/lib/...`, ad-hoc signs (required on macOS after `install_name_tool`).

**GMC**: Default build uses translation-only fallback (no OpenCV). For OpenCV-backed GMC: `-DFACE_PIPELINE_ENABLE_GMC=ON` + `brew install opencv`.

**Windows parity**: planned via `yarn build:win` (placeholder script today).

### Runtime contract

- **Input**: Frame paths via stdin (one per line)
- **Output**: JSON with `people[]`, `faceTracks[]`, `frameCount`, `stats`

## Dev tools (optional): generate a debug video from a source clip

This is only for development/testing. The shipped extension does not use Python.

```bash
pip install -r requirements.txt
python scripts/test_face_pipeline.py --video input.mp4 --output _generated/output_faces_debug.mp4
```

## Usage

1. Select clips in Premiere Pro timeline
2. Click **"Render & Detect Faces"** to export sequence and detect faces
3. Review detected masks in the preview panel
4. Edit masks manually if needed (adjust points, blurriness, feather, expansion)
5. Click **"Apply Masks"** to generate and import MOGRT file

## Project Structure

- `src/js/` - CEP JavaScript layer (React UI)
- `src/jsx/` - ExtendScript layer (Premiere Pro scripting)
- `scripts/` - Optional Python dev/test utilities (not required at runtime)
- `src/bin/` - Bundled native pipeline + models (and extension assets)
- `cep.config.ts` - Extension configuration

## Documentation

Built with [Bolt CEP](https://github.com/hyperbrew/bolt-cep).
