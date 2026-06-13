//! WebAssembly `simd128` backend (2-wide `v128` holding two `f64` lanes).
//!
//! WASM has no in-module runtime feature detection, so this backend is compiled
//! only when `simd128` is enabled at build time; the TypeScript loader picks the
//! simd128 artifact or the scalar one via `WebAssembly.validate`. Each op is a
//! single instruction matching the scalar reference — no FMA.

#![allow(unsafe_op_in_unsafe_fn)]

use super::{SimdF64, oklab_forward_batch_with};
use crate::constants::Gamut;
use std::arch::wasm32::*;

#[derive(Clone, Copy)]
pub(crate) struct WasmF64(v128);

impl SimdF64 for WasmF64 {
    const LANES: usize = 2;

    #[inline(always)]
    unsafe fn splat(x: f64) -> Self {
        WasmF64(f64x2_splat(x))
    }
    #[inline(always)]
    unsafe fn load(src: &[f64]) -> Self {
        WasmF64(f64x2(src[0], src[1]))
    }
    #[inline(always)]
    unsafe fn store(self, dst: &mut [f64]) {
        dst[0] = f64x2_extract_lane::<0>(self.0);
        dst[1] = f64x2_extract_lane::<1>(self.0);
    }
    #[inline(always)]
    unsafe fn add(self, o: Self) -> Self {
        WasmF64(f64x2_add(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn mul(self, o: Self) -> Self {
        WasmF64(f64x2_mul(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn div(self, o: Self) -> Self {
        WasmF64(f64x2_div(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn abs(self) -> Self {
        WasmF64(f64x2_abs(self.0))
    }
    #[inline(always)]
    unsafe fn copysign(self, sign: Self) -> Self {
        let mask = f64x2_splat(-0.0); // sign bit only
        // v128_andnot(a, b) = a & !b.
        let mag = v128_andnot(self.0, mask);
        let s = v128_and(sign.0, mask);
        WasmF64(v128_or(mag, s))
    }
    #[inline(always)]
    unsafe fn zero_where_key_zero(self, key: Self) -> Self {
        // mask is all-ones where key == 0; `self & !mask` is then 0 there.
        let is_zero = f64x2_eq(key.0, f64x2_splat(0.0));
        WasmF64(v128_andnot(self.0, is_zero))
    }
}

#[target_feature(enable = "simd128")]
pub(crate) unsafe fn oklab_forward_batch_simd128(
    r: &[f64],
    g: &[f64],
    b: &[f64],
    gamut: Gamut,
    out: &mut [[f64; 3]],
) {
    oklab_forward_batch_with::<WasmF64>(r, g, b, gamut, out)
}
