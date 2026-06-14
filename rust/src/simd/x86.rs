//! x86 / x86_64 backends: AVX2 (4-wide `__m256d`) and SSE2 (2-wide `__m128d`).
//!
//! The trait impls use raw intrinsics with no per-method `#[target_feature]`;
//! they are `#[inline(always)]` and only ever inlined into the
//! `#[target_feature]`-annotated batch wrappers below, so the intrinsics are
//! always code-generated in a context where their feature is enabled. Each op
//! is a single instruction matching the scalar reference — no FMA.

#![allow(unsafe_op_in_unsafe_fn)]

use super::{SimdF64, oklab_forward_batch_with};
use crate::constants::Gamut;

#[cfg(target_arch = "x86")]
use std::arch::x86::*;
#[cfg(target_arch = "x86_64")]
use std::arch::x86_64::*;

// ── AVX2: 4 lanes ─────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub(crate) struct Avx2F64(__m256d);

impl SimdF64 for Avx2F64 {
    const LANES: usize = 4;

    #[inline(always)]
    unsafe fn splat(x: f64) -> Self {
        Avx2F64(_mm256_set1_pd(x))
    }
    #[inline(always)]
    unsafe fn load(src: &[f64]) -> Self {
        Avx2F64(_mm256_loadu_pd(src.as_ptr()))
    }
    #[inline(always)]
    unsafe fn store(self, dst: &mut [f64]) {
        _mm256_storeu_pd(dst.as_mut_ptr(), self.0)
    }
    #[inline(always)]
    unsafe fn add(self, o: Self) -> Self {
        Avx2F64(_mm256_add_pd(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn mul(self, o: Self) -> Self {
        Avx2F64(_mm256_mul_pd(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn div(self, o: Self) -> Self {
        Avx2F64(_mm256_div_pd(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn abs(self) -> Self {
        // andnot(sign, x) = (~sign) & x, clearing the sign bit.
        Avx2F64(_mm256_andnot_pd(_mm256_set1_pd(-0.0), self.0))
    }
    #[inline(always)]
    unsafe fn copysign(self, sign: Self) -> Self {
        let mask = _mm256_set1_pd(-0.0); // sign bit only
        Avx2F64(_mm256_or_pd(
            _mm256_andnot_pd(mask, self.0),
            _mm256_and_pd(mask, sign.0),
        ))
    }
    #[inline(always)]
    unsafe fn zero_where_key_zero(self, key: Self) -> Self {
        let zero = _mm256_setzero_pd();
        let is_zero = _mm256_cmp_pd::<_CMP_EQ_OQ>(key.0, zero);
        // blendv selects the 2nd arg where the mask's sign bit is set.
        Avx2F64(_mm256_blendv_pd(self.0, zero, is_zero))
    }
}

#[target_feature(enable = "avx2")]
pub(crate) unsafe fn oklab_forward_batch_avx2(
    r: &[f64],
    g: &[f64],
    b: &[f64],
    gamut: Gamut,
    out: &mut [[f64; 3]],
) {
    oklab_forward_batch_with::<Avx2F64>(r, g, b, gamut, out)
}

// ── SSE2: 2 lanes (x86_64 baseline) ───────────────────────────────────────

#[derive(Clone, Copy)]
pub(crate) struct Sse2F64(__m128d);

impl SimdF64 for Sse2F64 {
    const LANES: usize = 2;

    #[inline(always)]
    unsafe fn splat(x: f64) -> Self {
        Sse2F64(_mm_set1_pd(x))
    }
    #[inline(always)]
    unsafe fn load(src: &[f64]) -> Self {
        Sse2F64(_mm_loadu_pd(src.as_ptr()))
    }
    #[inline(always)]
    unsafe fn store(self, dst: &mut [f64]) {
        _mm_storeu_pd(dst.as_mut_ptr(), self.0)
    }
    #[inline(always)]
    unsafe fn add(self, o: Self) -> Self {
        Sse2F64(_mm_add_pd(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn mul(self, o: Self) -> Self {
        Sse2F64(_mm_mul_pd(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn div(self, o: Self) -> Self {
        Sse2F64(_mm_div_pd(self.0, o.0))
    }
    #[inline(always)]
    unsafe fn abs(self) -> Self {
        Sse2F64(_mm_andnot_pd(_mm_set1_pd(-0.0), self.0))
    }
    #[inline(always)]
    unsafe fn copysign(self, sign: Self) -> Self {
        let mask = _mm_set1_pd(-0.0);
        Sse2F64(_mm_or_pd(
            _mm_andnot_pd(mask, self.0),
            _mm_and_pd(mask, sign.0),
        ))
    }
    #[inline(always)]
    unsafe fn zero_where_key_zero(self, key: Self) -> Self {
        // No blendv in SSE2: mask is all-ones where key == 0, so `andnot(mask,
        // self)` keeps self where key != 0 and yields 0 where key == 0.
        let is_zero = _mm_cmpeq_pd(key.0, _mm_setzero_pd());
        Sse2F64(_mm_andnot_pd(is_zero, self.0))
    }
}

#[target_feature(enable = "sse2")]
pub(crate) unsafe fn oklab_forward_batch_sse2(
    r: &[f64],
    g: &[f64],
    b: &[f64],
    gamut: Gamut,
    out: &mut [[f64; 3]],
) {
    oklab_forward_batch_with::<Sse2F64>(r, g, b, gamut, out)
}
