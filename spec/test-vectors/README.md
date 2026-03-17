# ChromaHash Test Vectors

Golden test vectors generated from the Rust reference implementation.

## Files

### Unit tests (v0.2-ready, purely mathematical)

- `unit-color.json` — OKLAB color space transforms (RGB ↔ OKLAB)
- `unit-mulaw.json` — µ-law companding round-trips
- `unit-dct.json` — DCT scan order for square and non-square grids
- `unit-aspect.json` — Aspect ratio encoding/decoding and `deriveGrid` mappings
- `unit-bitpack.json` — Bit packing `readBits`/`writeBits` operations

### Integration tests (v0.1, pending v0.2 regeneration)

- `integration-encode.json` — Full encode: input RGBA → 32-byte hash
- `integration-decode.json` — Full decode: 32-byte hash → output RGBA

> **Note:** Integration vectors use v0.1 semantics (fixed grids, MAX_CHROMA=0.5,
> hard gamut clamping). They must be regenerated from the Rust reference
> implementation after v0.2 is implemented.

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
