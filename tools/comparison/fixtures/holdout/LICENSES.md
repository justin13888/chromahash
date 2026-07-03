# Holdout Fixture Licenses

This directory caches the holdout evaluation set (see `src/corpus.ts`):
images that constants sweeps must never tune on. Downloads are on-demand
(`src/holdout-images.ts`) and are not committed.

## Images

## kodak01.png … kodak24.png

- Source: Kodak True Color image suite, <http://r0k.us/graphics/kodak/>
- Author: Eastman Kodak Company (film scans; digitized by Rich Franzen)
- License: released by Kodak for unrestricted use
- Notes: 24 uncompressed 768x512 / 512x768 PNGs, hosted at the same URL
  since 1999. CLIC datasets were considered as an additional holdout source,
  but their hosting URLs are unstable.
