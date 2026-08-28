"""Serial batch encoder (API parity with the parallel-language implementations)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from ._constants import Gamut
from ._uniffi import default_tier as _default_tier

if TYPE_CHECKING:
    from . import ChromaHash


@dataclass(frozen=True)
class ImageInput:
    """One image to encode in a batch."""

    w: int
    h: int
    rgba: bytes | bytearray
    gamut: Gamut = Gamut.SRGB
    #: Quality tier (0..=``MAX_TIER``, ordered by quality). Defaults to the
    #: 32-byte default tier, matching :meth:`ChromaHash.encode` -- note the
    #: codes start at 0 for the *compact* tier, so an explicit 0 is 21 bytes.
    quality: int = _default_tier()


class BatchEncoder:
    """Stateful batch encoder.

    Shares the API shape of the parallel-language implementations, but executes
    serially: under CPython's GIL a thread pool would not speed up this
    CPU-bound work, so the value here is API parity and a single call site for
    bulk jobs. Output is identical to calling
    ``ChromaHash.encode_with_quality`` on each image individually at its tier.
    """

    def encode_batch(self, items: list[ImageInput]) -> list[ChromaHash]:
        """Encode every item, returning hashes in the same order as ``items``.

        All items are validated up front (raising ``ValueError`` identifying the
        offending index) before any encoding, matching
        ``ChromaHash.encode_with_quality``.
        """
        from . import MAX_TIER, ChromaHash

        for i, it in enumerate(items):
            if it.w < 1:
                raise ValueError(f"item {i}: width must be >= 1")
            if it.h < 1:
                raise ValueError(f"item {i}: height must be >= 1")
            if len(it.rgba) != it.w * it.h * 4:
                raise ValueError(f"item {i}: rgba length mismatch")
            if not 0 <= it.quality <= MAX_TIER:
                raise ValueError(f"item {i}: quality tier must be 0..={MAX_TIER}")
        return [
            ChromaHash.encode_with_quality(it.w, it.h, it.rgba, it.gamut, it.quality)
            for it in items
        ]

    def close(self) -> None:
        """Release resources. A no-op for the serial implementation (no pool)."""

    def __enter__(self) -> BatchEncoder:
        return self

    def __exit__(
        self,
        exc_type: object,
        exc_val: object,
        exc_tb: object,
    ) -> None:
        self.close()
