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
    """ChromaHash: a compact LQIP (Low Quality Image Placeholder).

    A thin facade over the UniFFI-generated bindings to the Rust core. Output is
    byte-identical to every other ChromaHash implementation. The hash is variable
    length (32 bytes at quality tier 0); native objects are created transiently
    per operation.
    """

    def __init__(self, hash_bytes: bytes) -> None:
        self._hash = bytes(hash_bytes)

    @classmethod
    def encode(
        cls,
        w: int,
        h: int,
        rgba: bytes | bytearray,
        gamut: Gamut = Gamut.SRGB,
    ) -> "ChromaHash":
        """Encode an image into a tier-0 ChromaHash.

        Args:
            w: image width (>= 1)
            h: image height (>= 1)
            rgba: pixel data in RGBA format (4 bytes per pixel)
            gamut: source color space
        """
        obj = _CoreHash.encode(w, h, bytes(rgba), _GAMUT_TO_CORE[gamut])
        return cls(obj.as_bytes())

    @classmethod
    def encode_with_quality(
        cls,
        w: int,
        h: int,
        rgba: bytes | bytearray,
        gamut: Gamut = Gamut.SRGB,
        quality: int = 0,
    ) -> "ChromaHash":
        """Encode an image at an explicit quality tier (0..=3).

        Tier 0 is the 32-byte default; each higher tier carries more detail in a
        larger hash. See :meth:`encode` for the argument contract.
        """
        obj = _CoreHash.encode_with_quality(w, h, bytes(rgba), _GAMUT_TO_CORE[gamut], quality)
        return cls(obj.as_bytes())

    def decode(self, output: Gamut = Gamut.SRGB) -> tuple[int, int, bytes]:
        """Decode a ChromaHash into an RGBA image in the given output gamut.

        ``output`` selects the display target (``Gamut.SRGB``,
        ``Gamut.DISPLAY_P3``, or ``Gamut.ADOBE_RGB``); wide-gamut colors render
        at full saturation on a matching display. ``Gamut.BT2020`` and
        ``Gamut.PROPHOTO_RGB`` are not display-output gamuts and fall back to
        sRGB. Returns (width, height, rgba_pixels).
        """
        result = _CoreHash.from_bytes(self._hash).decode_to(_GAMUT_TO_CORE[output])
        return (result.width, result.height, result.rgba)

    def decode_capped(
        self, max_w: int, max_h: int, output: Gamut = Gamut.SRGB
    ) -> tuple[int, int, bytes]:
        """Decode a ChromaHash into an RGBA image, capped at the given max
        dimensions, in the given output gamut.
        Returns (width, height, rgba_pixels).
        """
        result = _CoreHash.from_bytes(self._hash).decode_capped_to(
            max_w, max_h, _GAMUT_TO_CORE[output]
        )
        return (result.width, result.height, result.rgba)

    def average_color(self) -> tuple[int, int, int, int]:
        """Extract the average color without full decode.
        Returns (r, g, b, a) as int values in [0, 255].
        """
        c = _CoreHash.from_bytes(self._hash).average_color()
        return (c.r, c.g, c.b, c.a)

    @classmethod
    def from_bytes(cls, hash_bytes: bytes) -> "ChromaHash":
        """Create a ChromaHash from raw hash bytes.

        The bytes are validated lazily when the hash is used (``decode`` /
        ``average_color`` reconstruct and validate it).
        """
        return cls(hash_bytes)

    def as_bytes(self) -> bytes:
        """Get the raw hash bytes (32 at tier 0, more at higher tiers)."""
        return self._hash

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, ChromaHash):
            return NotImplemented
        return self._hash == other._hash

    def __repr__(self) -> str:
        return f"ChromaHash({self._hash.hex()})"


from ._batch import BatchEncoder, ImageInput  # noqa: E402

__all__ = ["BatchEncoder", "ChromaHash", "Gamut", "ImageInput"]
