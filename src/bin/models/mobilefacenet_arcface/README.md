## MobileFaceNet (MXNet → ncnn)

This folder contains an **InsightFace MobileFaceNet ArcFace** model converted from MXNet (`model-symbol.json` + `model-0000.params`) to **ncnn**.

### Files

- `mobilefacenet.param` / `mobilefacenet.bin`: direct output from `mxnet2ncnn`
- `mobilefacenet-opt.param` / `mobilefacenet-opt.bin`: output from `ncnnoptimize` (recommended)

### IO (as converted)

- **Input blob**: `data`
- **Output blob**: `fc1`
- **Embedding size**: **128-D** (this checkpoint outputs 128D, not 512D)

### Preprocess (baked into the graph)

The first two layers apply:

- subtract \(127.5\)
- multiply \(1/128 = 0.0078125\)

So the network expects pixel values in \([0,255]\) and internally normalizes to roughly \([-1, 1]\).

### Expected input size

This MobileFaceNet variant is the common **112×112** face crop/alignment input.

