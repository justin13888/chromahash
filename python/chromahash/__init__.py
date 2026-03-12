"""ChromaHash: modern LQIP (Low Quality Image Placeholder) format."""

from . import _decode, _encode
from ._constants import Gamut


class ChromaHash:
    """ChromaHash: a 32-byte LQIP (Low Quality Image Placeholder)."""

    def __init__(self, hash_bytes: bytes) -> None:
        if len(hash_bytes) != 32:
            raise ValueError("hash_bytes must be exactly 32 bytes")
        self._hash = hash_bytes

    @classmethod
    def encode(
        cls,
        w: int,
        h: int,
        rgba: bytes | bytearray,
        gamut: Gamut = Gamut.SRGB,
    ) -> "ChromaHash":
        """Encode an image into a ChromaHash.

        Args:
            w: image width (1–100)
            h: image height (1–100)
            rgba: pixel data in RGBA format (4 bytes per pixel)
            gamut: source color space
        """
        return cls(_encode.encode(w, h, rgba, gamut))

    def decode(self) -> tuple[int, int, bytes]:
        """Decode a ChromaHash into an RGBA image.
        Returns (width, height, rgba_pixels).
        """
        return _decode.decode(self._hash)

    def average_color(self) -> tuple[int, int, int, int]:
        """Extract the average color without full decode.
        Returns (r, g, b, a) as int values in [0, 255].
        """
        return _decode.average_color(self._hash)

    @classmethod
    def from_bytes(cls, hash_bytes: bytes) -> "ChromaHash":
        """Create a ChromaHash from raw 32-byte data."""
        return cls(hash_bytes)

    def as_bytes(self) -> bytes:
        """Get the raw 32-byte hash data."""
        return self._hash

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ChromaHash):
            return NotImplemented
        return self._hash == other._hash

    def __repr__(self) -> str:
        return f"ChromaHash({self._hash.hex()})"


__all__ = ["ChromaHash", "Gamut"]
