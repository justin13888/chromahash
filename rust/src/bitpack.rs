/// Write `count` bits of `value` starting at `bitpos` in little-endian byte order.
/// Per spec §12.6 writeBits.
pub fn write_bits(hash: &mut [u8], bitpos: usize, count: u32, value: u32) {
    for i in 0..count as usize {
        let byte_idx = (bitpos + i) / 8;
        let bit_idx = (bitpos + i) % 8;
        if (value >> i) & 1 != 0 {
            hash[byte_idx] |= 1 << bit_idx;
        }
    }
}

/// Read `count` bits starting at `bitpos` in little-endian byte order.
/// Per spec §12.6 readBits.
pub fn read_bits(hash: &[u8], bitpos: usize, count: u32) -> u32 {
    let mut value = 0u32;
    for i in 0..count as usize {
        let byte_idx = (bitpos + i) / 8;
        let bit_idx = (bitpos + i) % 8;
        if hash[byte_idx] & (1 << bit_idx) != 0 {
            value |= 1 << i;
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_basic() {
        let mut buf = [0u8; 4];
        write_bits(&mut buf, 0, 8, 0xAB);
        assert_eq!(read_bits(&buf, 0, 8), 0xAB);
    }

    #[test]
    fn roundtrip_at_offset() {
        let mut buf = [0u8; 4];
        write_bits(&mut buf, 3, 5, 0x1F);
        assert_eq!(read_bits(&buf, 3, 5), 0x1F);
    }

    #[test]
    fn cross_byte_boundary() {
        let mut buf = [0u8; 4];
        write_bits(&mut buf, 6, 8, 0xCA);
        assert_eq!(read_bits(&buf, 6, 8), 0xCA);
    }

    #[test]
    fn multiple_fields() {
        let mut buf = [0u8; 8];
        write_bits(&mut buf, 0, 7, 100);
        write_bits(&mut buf, 7, 7, 64);
        write_bits(&mut buf, 14, 7, 80);
        write_bits(&mut buf, 21, 6, 33);
        write_bits(&mut buf, 27, 6, 20);
        write_bits(&mut buf, 33, 5, 15);
        write_bits(&mut buf, 38, 8, 128);
        write_bits(&mut buf, 46, 1, 1);
        write_bits(&mut buf, 47, 1, 0);

        assert_eq!(read_bits(&buf, 0, 7), 100);
        assert_eq!(read_bits(&buf, 7, 7), 64);
        assert_eq!(read_bits(&buf, 14, 7), 80);
        assert_eq!(read_bits(&buf, 21, 6), 33);
        assert_eq!(read_bits(&buf, 27, 6), 20);
        assert_eq!(read_bits(&buf, 33, 5), 15);
        assert_eq!(read_bits(&buf, 38, 8), 128);
        assert_eq!(read_bits(&buf, 46, 1), 1);
        assert_eq!(read_bits(&buf, 47, 1), 0);
    }

    #[test]
    fn zero_value() {
        let mut buf = [0u8; 4];
        write_bits(&mut buf, 0, 8, 0);
        assert_eq!(read_bits(&buf, 0, 8), 0);
    }

    #[test]
    fn max_values() {
        for bits in 1..=8 {
            let max = (1u32 << bits) - 1;
            let mut buf = [0u8; 4];
            write_bits(&mut buf, 0, bits, max);
            assert_eq!(read_bits(&buf, 0, bits), max);
        }
    }
}
