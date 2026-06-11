"""ChromaHash: modern LQIP (Low Quality Image Placeholder) format."""

from ._constants import Gamut
from ._uniffi import ChromaHash as _CoreHash
from ._uniffi import Gamut as _CoreGamut

# The public Gamut keeps the `PROPHOTO_RGB` spelling; the generated enum uses
# `PRO_PHOTO_RGB`. Map across the FFI explicitly.
_GAMUT_TO_CORE = {
    Gamut.SRGB: _CoreGamut.SRGB,
    Gamut.DISPLAY_P3: _CoreGamut.DISPLAY_P3,
    Gamut.ADOBE_RGB: _CoreGamut.ADOBE_RGB,
    Gamut.BT2020: _CoreGamut.BT2020,
    Gamut.PROPHOTO_RGB: _CoreGamut.PRO_PHOTO_RGB,
}


class ChromaHash:
    """ChromaHash: a 32-byte LQIP (Low Quality Image Placeholder).

    A thin facade over the UniFFI-generated bindings to the Rust core. Output is
    byte-identical to every other ChromaHash implementation. The hash is held as a
    32-byte value; native objects are created transiently per operation.
    """

    def __init__(self, hash_bytes: bytes) -> None:
        if len(hash_bytes) != 32:
            raise ValueError("hash_bytes must be exactly 32 bytes")
        self._hash = bytes(hash_bytes)

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
            w: image width (>= 1)
            h: image height (>= 1)
            rgba: pixel data in RGBA format (4 bytes per pixel)
            gamut: source color space
        """
        obj = _CoreHash.encode(w, h, bytes(rgba), _GAMUT_TO_CORE[gamut])
        return cls(obj.as_bytes())

    def decode(self) -> tuple[int, int, bytes]:
        """Decode a ChromaHash into an RGBA image.
        Returns (width, height, rgba_pixels).
        """
        result = _CoreHash.from_bytes(self._hash).decode()
        return (result.width, result.height, result.rgba)

    def decode_capped(self, max_w: int, max_h: int) -> tuple[int, int, bytes]:
        """Decode a ChromaHash into an RGBA image, capped at the given max
        dimensions. Returns (width, height, rgba_pixels).
        """
        result = _CoreHash.from_bytes(self._hash).decode_capped(max_w, max_h)
        return (result.width, result.height, result.rgba)

    def average_color(self) -> tuple[int, int, int, int]:
        """Extract the average color without full decode.
        Returns (r, g, b, a) as int values in [0, 255].
        """
        c = _CoreHash.from_bytes(self._hash).average_color()
        return (c.r, c.g, c.b, c.a)

    def is_version_supported(self) -> bool:
        """Whether this hash uses the v0.6 bitstream this library implements.

        Decoding an unsupported (legacy) hash produces garbage, not an error.
        """
        return _CoreHash.from_bytes(self._hash).is_version_supported()

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


from ._batch import BatchEncoder, ImageInput  # noqa: E402

__all__ = ["BatchEncoder", "ChromaHash", "Gamut", "ImageInput"]
