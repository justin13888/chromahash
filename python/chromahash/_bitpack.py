"""Bit packing utilities. Per spec §12.7 writeBits/readBits."""


def write_bits(buf: bytearray, bitpos: int, count: int, value: int) -> None:
    """Write `count` bits of `value` starting at `bitpos` in little-endian byte order."""
    for i in range(count):
        byte_idx = (bitpos + i) // 8
        bit_idx = (bitpos + i) % 8
        if (value >> i) & 1:
            buf[byte_idx] |= 1 << bit_idx


def read_bits(buf: bytes | bytearray, bitpos: int, count: int) -> int:
    """Read `count` bits starting at `bitpos` in little-endian byte order."""
    value = 0
    for i in range(count):
        byte_idx = (bitpos + i) // 8
        bit_idx = (bitpos + i) % 8
        if buf[byte_idx] & (1 << bit_idx):
            value |= 1 << i
    return value
