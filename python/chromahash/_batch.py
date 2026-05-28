"""Serial batch encoder (API parity with the parallel-language implementations)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from ._constants import Gamut

if TYPE_CHECKING:
    from . import ChromaHash


@dataclass(frozen=True)
class ImageInput:
    """One image to encode in a batch."""

    w: int
    h: int
    rgba: bytes | bytearray
    gamut: Gamut = Gamut.SRGB


class BatchEncoder:
    """Stateful batch encoder.

    Shares the API shape of the parallel-language implementations, but executes
    serially: under CPython's GIL a thread pool would not speed up this
    CPU-bound work, so the value here is API parity and a single call site for
    bulk jobs. Output is identical to calling ``ChromaHash.encode`` on each
    image individually.
    """

    def encode_batch(self, items: list[ImageInput]) -> list[ChromaHash]:
        """Encode every item, returning hashes in the same order as ``items``.

        All items are validated up front (raising ``ValueError`` identifying the
        offending index) before any encoding, matching ``ChromaHash.encode``.
        """
        from . import ChromaHash

        for i, it in enumerate(items):
            if it.w < 1:
                raise ValueError(f"item {i}: width must be >= 1")
            if it.h < 1:
                raise ValueError(f"item {i}: height must be >= 1")
            if len(it.rgba) != it.w * it.h * 4:
                raise ValueError(f"item {i}: rgba length mismatch")
        return [ChromaHash.encode(it.w, it.h, it.rgba, it.gamut) for it in items]

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
