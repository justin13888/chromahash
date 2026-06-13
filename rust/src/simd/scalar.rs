//! 1-wide `f64` backend: the portable fallback and the tail handler. Every op
//! is a plain scalar operation, so it is the reference the other backends must
//! match bit-for-bit.

#![allow(unsafe_op_in_unsafe_fn)]

use super::SimdF64;

#[derive(Clone, Copy)]
pub(crate) struct ScalarF64(f64);

impl SimdF64 for ScalarF64 {
    const LANES: usize = 1;

    #[inline(always)]
    unsafe fn splat(x: f64) -> Self {
        ScalarF64(x)
    }

    #[inline(always)]
    unsafe fn load(src: &[f64]) -> Self {
        ScalarF64(src[0])
    }

    #[inline(always)]
    unsafe fn store(self, dst: &mut [f64]) {
        dst[0] = self.0;
    }

    #[inline(always)]
    unsafe fn add(self, o: Self) -> Self {
        ScalarF64(self.0 + o.0)
    }

    #[inline(always)]
    unsafe fn mul(self, o: Self) -> Self {
        ScalarF64(self.0 * o.0)
    }

    #[inline(always)]
    unsafe fn div(self, o: Self) -> Self {
        ScalarF64(self.0 / o.0)
    }

    #[inline(always)]
    unsafe fn abs(self) -> Self {
        // Bit clear of the sign — matches the vector backends' `andnot`.
        ScalarF64(f64::from_bits(self.0.to_bits() & !(1u64 << 63)))
    }

    #[inline(always)]
    unsafe fn copysign(self, sign: Self) -> Self {
        let mag = self.0.to_bits() & !(1u64 << 63);
        let s = sign.0.to_bits() & (1u64 << 63);
        ScalarF64(f64::from_bits(mag | s))
    }

    #[inline(always)]
    unsafe fn zero_where_key_zero(self, key: Self) -> Self {
        if key.0 == 0.0 { ScalarF64(0.0) } else { self }
    }
}
