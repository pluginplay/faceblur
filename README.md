# Face Blur CEP Extension

Adobe CEP extension scaffold built with [Bolt CEP](https://github.com/hyperbrew/bolt-cep).

## Quick Start

1. **Install dependencies:**

   ```bash
   yarn install
   ```

2. **Enable PlayerDebugMode:**

   - Use [aescripts ZXP Installer](https://aescripts.com/learn/zxp-installer/) > Settings > Debug > Enable Debugging
   - Or follow [Adobe CEP Cookbook](https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md#debugging-unsigned-extensions)

3. **Build the extension:**

   ```bash
   yarn build
   ```

4. **Run in development mode (HMR):**

   ```bash
   yarn dev
   ```

5. **Package for distribution:**
   ```bash
   yarn zxp
   ```

## Project Structure

- `src/js/` - CEP JavaScript layer (React UI)
- `src/jsx/` - ExtendScript layer (Adobe app scripting)
- `cep.config.ts` - Extension configuration

## Configuration

Edit `cep.config.ts` to customize extension settings like panel dimensions, host apps, and build options.

## Documentation

For detailed Bolt CEP documentation, visit the [official repository](https://github.com/hyperbrew/bolt-cep).
