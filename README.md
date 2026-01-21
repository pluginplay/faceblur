# Face Blur CEP Extension

Adobe CEP extension for Premiere Pro that automatically detects faces in video sequences and generates animated blur masks.

## Features

- **Automatic face detection** using UniFace (Python-based)
- **Face tracking** across frames with stable track assignment
- **Animated blur masks** exported as MOGRT files
- **Interactive mask editing** with keyframe support
- **Frame-by-frame preview** with scrubbing and playback
- **Multiple masks** per sequence with split/merge operations

## Requirements

- Adobe Premiere Pro
- Python 3 with UniFace installed: `pip install -r requirements.txt`
- Node.js and Yarn

## Quick Start

1. **Install dependencies:**
   ```bash
   yarn install
   pip install -r requirements.txt
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

## Usage

1. Select clips in Premiere Pro timeline
2. Click **"Render & Detect Faces"** to export sequence and detect faces
3. Review detected masks in the preview panel
4. Edit masks manually if needed (adjust points, blurriness, feather, expansion)
5. Click **"Apply Masks"** to generate and import MOGRT file

## Project Structure

- `src/js/` - CEP JavaScript layer (React UI)
- `src/jsx/` - ExtendScript layer (Premiere Pro scripting)
- `scripts/` - Python face detection script
- `src/bin/` - Extension assets (presets, icons)
- `cep.config.ts` - Extension configuration

## Documentation

Built with [Bolt CEP](https://github.com/hyperbrew/bolt-cep).
