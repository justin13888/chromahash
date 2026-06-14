//! aarch64 NEON backend (2-wide `float64x2_t`). NEON with double-precision is
//! mandatory in the aarch64 baseline, so no runtime detection is needed. Each
//! op is a single instruction matching the scalar reference — no FMA.

#![allow(unsafe_op_in_unsafe_fn)]

use super::{SimdF64, oklab_forward_batch_with};
use crate::constants::Gamut;
use std::arch::aarch64::*;

const SIGN_BIT: u64 = 1u64 << 63;

#[derive(Clone, Copy)]
pub(crate) struct NeonF64(float64x2_t);

impl SimdF64 for NeonF64 {
    const LANES: usize = 2;

    #[inline(always)]
    unsafe fn splat(x: f64) -> Self {
        NeonF64(vdupq_n_f64(x))
    }
    #[inline(always)]
    unsafe fn load(src: &[f64]) -> Self {
        NeonF64(vld1q_f64(src.as_ptr()))
    }
    #[inline(always)]
    unsafe fn store(self, dst: &mut [f64]) {
        vst1q_f64(dst.as_mut_ptr(), self.0)
    }
    #[inline(always)]
    unsafe fn add(self, o: Self) -> Self {
        NeonF64(vaddq_f64(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn mul(self, o: Self) -> Self {
        NeonF64(vmulq_f64(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn div(self, o: Self) -> Self {
        NeonF64(vdivq_f64(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn abs(self) -> Self {
        // Clears the sign bit — identical to the scalar `bits & !signbit`.
        NeonF64(vabsq_f64(self.0))
    }
    #[inline(always)]
    unsafe fn copysign(self, sign: Self) -> Self {
        let mask = vdupq_n_u64(SIGN_BIT);
        let mag = vbicq_u64(vreinterpretq_u64_f64(self.0), mask); // self & !sign
        let s = vandq_u64(vreinterpretq_u64_f64(sign.0), mask);
        NeonF64(vreinterpretq_f64_u64(vorrq_u64(mag, s)))
    }
    #[inline(always)]
    unsafe fn zero_where_key_zero(self, key: Self) -> Self {
        // mask is all-ones where key == 0; `self & !mask` is then 0 there.
        let is_zero = vceqq_f64(key.0, vdupq_n_f64(0.0));
        let kept = vbicq_u64(vreinterpretq_u64_f64(self.0), is_zero);
        NeonF64(vreinterpretq_f64_u64(kept))
    }
}

#[target_feature(enable = "neon")]
pub(crate) unsafe fn oklab_forward_batch_neon(
    r: &[f64],
    g: &[f64],
    b: &[f64],
    gamut: Gamut,
    out: &mut [[f64; 3]],
) {
    oklab_forward_batch_with::<NeonF64>(r, g, b, gamut, out)
}
