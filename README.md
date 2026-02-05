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

2. **Enable PlayerDebugMode** (for unsigned extensions):
   - Use [aescripts ZXP Installer](https://aescripts.com/learn/zxp-installer/) > Settings > Debug > Enable Debugging
   - Or follow [Adobe CEP Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md#debugging-unsigned-extensions)

3. **Build:**
   ```bash
   yarn build
   ```

4. **Development mode:**
   ```bash
   yarn dev
   ```

5. **Package:**
   ```bash
   yarn zxp
   ```

## Native face pipeline (C++)

The extension calls a bundled native executable (`face_pipeline`) and reads JSON tracks from stdout.

- **Binary**: `src/bin/face_pipeline` (macOS) and `src/bin/face_pipeline.exe` (Windows)
- **Models**: `src/bin/models/scrfd.param` and `src/bin/models/scrfd.bin`
- **Runtime contract**: pass frame paths via stdin, receive `{ tracks, frameCount }` JSON on stdout

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
