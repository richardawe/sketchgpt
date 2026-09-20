# vram-probe — what does a model *actually* allocate?

WebLLM publishes `vram_required_MB` per model. Nothing in WebLLM reads it, and
on some models it is out by 43%. This measures the real number.

**It needs no GPU.** Chromium serves WebGPU through SwiftShader, which is
enough to load a model and count its buffers. It is *not* enough to generate a
token — see the limits below.

## How it works

`measure.html` patches `GPUDevice.prototype.createBuffer` to accumulate every
requested byte and wraps `destroy()` to subtract, then loads the model from a
local mirror with `context_window_size` overridden through `CreateMLCEngine`'s
third argument. `run.mjs` drives it in headless Chromium and prints the totals.

## Use

```bash
npm i playwright                                   # once
./mirror.sh SmolLM2-360M-Instruct-q4f32_1-MLC SmolLM2-360M-Instruct-q4f32_1_cs1k
python3 serve.py 8099 site &
node run.mjs SmolLM2-360M-Instruct-q4f32_1-MLC \
             SmolLM2-360M-Instruct-q4f32_1_cs1k-webgpu.wasm 1024
```

The last argument is the context window; omit it for the record's default.

`extract.py` is the companion: it pulls the `_metadata` JSON out of a compiled
`.wasm` and prints exact parameter bytes, the KV-cache geometry, and MLC's
planned workspace for every VM function.

```bash
python3 extract.py site/lib/*.wasm
```

## What it found

```
allocation = params + (2 × layers × kv_heads × head_dim × dtype_bytes) × ctx + ~23 MB
```

KV dtype follows the build suffix: f32 in a `q4f32` build, f16 in a `q4f16`
one. The formula predicted Llama-3.2-1B to within 1% before it was measured.
Full results and the models table are in `docs/mobile-models.md`.

## Limits

- **SwiftShader cannot generate.** Loading takes seconds; a single token did
  not complete in 25 minutes. These are load-time allocations only, and
  `batch_prefill` / `batch_decode` will add their workspace on first inference.
- **No `shader-f16`**, so only `q4f32` builds run here.
- Chromium needs `--enable-unsafe-webgpu`; `run.mjs` passes it. Do not run
  `playwright install` — use the browser already at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
