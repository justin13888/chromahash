# ChromaHash Test Vectors

Golden test vectors generated from the Rust reference implementation.

## Files

- `unit-color.json` — OKLAB color space transforms (RGB ↔ OKLAB)
- `unit-mulaw.json` — µ-law companding round-trips
- `unit-dct.json` — DCT forward/inverse at known inputs
- `unit-aspect.json` — Aspect ratio encoding/decoding
- `unit-bitpack.json` — Bit packing read/write
- `integration-encode.json` — Full encode: input RGBA → 32-byte hash
- `integration-decode.json` — Full decode: 32-byte hash → output RGBA

## Schema

Each JSON file contains an array of test cases. Every test case has:

```json
{
  "name": "descriptive name",
  "input": { ... },
  "expected": { ... }
}
```

All floating-point values are rounded to 15 significant digits.
All byte arrays are represented as arrays of integers (0–255).
