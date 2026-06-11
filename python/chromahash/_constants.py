from enum import Enum, auto


class Gamut(Enum):
    """Source color space. Mapped to the UniFFI-generated enum at the FFI boundary."""

    SRGB = auto()
    DISPLAY_P3 = auto()
    ADOBE_RGB = auto()
    BT2020 = auto()
    PROPHOTO_RGB = auto()
