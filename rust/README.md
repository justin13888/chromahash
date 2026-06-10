# chromahash

> Modern, high-quality image placeholder representation for professional formats (LQIP)

`chromahash` encodes an image into a compact, fixed **32-byte** Low Quality Image
Placeholder (LQIP) and decodes it back into a low-fidelity preview. Color is
encoded in the perceptually-uniform [OKLAB](https://bottosson.github.io/posts/oklab/)
space with wide-gamut input support (sRGB, Display P3, Adobe RGB, BT.2020,
ProPhoto RGB), an adaptive DCT grid, and alpha — all within the same fixed size.

This is the **Rust** implementation. It is part of a multi-language project whose
implementations are validated **bit-exact** against a shared specification, so the
same input produces the same placeholder in every language. The crate is
zero-dependency.

```toml
[dependencies]
chromahash = "0.5"
```

See the [project repository](https://github.com/justin13888/chromahash) for the
full format specification, the other language implementations, and usage
examples.

> **Note:** ChromaHash is a pre-1.0 **Draft** format — the bitstream is not yet
> guaranteed stable across versions.

## License

Licensed under either of [Apache License, Version 2.0](https://github.com/justin13888/chromahash/blob/master/LICENSE-APACHE)
or [MIT license](https://github.com/justin13888/chromahash/blob/master/LICENSE-MIT)
at your option.
