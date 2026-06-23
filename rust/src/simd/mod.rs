//! Internal, zero-dependency SIMD layer for the hot per-pixel color math.
//!
//! # Bit-exactness contract
//!
//! ChromaHash requires byte-identical output across every target and every
//! language binding (`spec/test-vectors/`). A SIMD lane is therefore only ever
//! allowed to **replay the scalar reference op-for-op**: each lane performs the
//! identical IEEE-754 sequence as the scalar code, in the same left-to-right
//! grouping, with **no FMA** (separate `mul`/`add`; Rust never contracts to FMA
//! without fast-math, which we never enable). Because per-lane results are
//! independent of the lane count, AVX2 (4-wide), SSE2/NEON/simd128 (2-wide) and
//! the scalar fallback (1-wide) all produce identical bytes.
//!
//! Reductions (the encoder's running averages, the DCT sums) are **not** done
//! here — they stay in scalar order in the callers. This layer only vectorizes
//! the embarrassingly-parallel per-pixel transforms.
//!
//! The `simd` cargo feature (default on) selects a vector backend at runtime
//! (x86) or compile time (aarch64/wasm). With the feature off — or on any other
//! target — everything routes through [`scalar::ScalarF64`], which is the
//! always-correct fallback and the tail handler for counts not divisible by the
//! lane width.

// Every operation in this module's `unsafe fn`s is a hardware SIMD intrinsic or
// a call to one — all unconditionally `unsafe`. Wrapping each in its own
// `unsafe {}` block adds noise without isolating any meaningful invariant; the
// safety contract is documented on the `SimdF64` trait and at each dispatch
// site instead.
#![allow(unsafe_op_in_unsafe_fn)]

use crate::color::linear_rgb_to_oklab;
use crate::constants::{Gamut, M2};

mod scalar;

#[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
mod x86;

#[cfg(all(feature = "simd", target_arch = "aarch64"))]
mod neon;

#[cfg(all(feature = "simd", target_arch = "wasm32", target_feature = "simd128"))]
mod wasm;

/// A fixed-width vector of `f64` lanes built from primitive IEEE-754 ops.
///
/// # Safety
///
/// Implementations may use target-specific intrinsics that require their CPU
/// feature to be enabled at the call site. Every method is `#[inline(always)]`
/// so it is only ever code-generated inside a `#[target_feature]` wrapper (see
/// the backend modules); callers must not invoke these on a backend whose
/// feature is unavailable. The generic algorithms below uphold the
/// bit-exactness contract: no method may introduce FMA or reorder operations.
pub(crate) trait SimdF64: Copy {
    /// Number of `f64` lanes (1, 2, or 4).
    const LANES: usize;

    /// Broadcast a scalar to every lane.
    unsafe fn splat(x: f64) -> Self;
    /// Load `LANES` contiguous lanes from the start of `src` (`src.len() >= LANES`).
    unsafe fn load(src: &[f64]) -> Self;
    /// Store `LANES` lanes to the start of `dst` (`dst.len() >= LANES`).
    unsafe fn store(self, dst: &mut [f64]);

    unsafe fn add(self, o: Self) -> Self;
    unsafe fn mul(self, o: Self) -> Self;
    unsafe fn div(self, o: Self) -> Self;

    /// Lane-wise absolute value (clears the sign bit).
    unsafe fn abs(self) -> Self;
    /// Lane-wise: magnitude of `self` carrying the sign bit of `sign`
    /// (i.e. `copysign(self, sign)`).
    unsafe fn copysign(self, sign: Self) -> Self;
    /// Lane-wise: `if key == 0.0 { 0.0 } else { self }` (sign of zero ignored).
    unsafe fn zero_where_key_zero(self, key: Self) -> Self;
}

/// 3×3 matrix times three lane-vectors (one per source component), preserving
/// the scalar `(m0·v0 + m1·v1) + m2·v2` grouping. Mirrors
/// [`crate::math_utils::matvec3`].
#[inline(always)]
unsafe fn matvec3_simd<T: SimdF64>(m: &[[f64; 3]; 3], v0: T, v1: T, v2: T) -> (T, T, T) {
    let row = |r: &[f64; 3]| {
        T::splat(r[0])
            .mul(v0)
            .add(T::splat(r[1]).mul(v1))
            .add(T::splat(r[2]).mul(v2))
    };
    (row(&m[0]), row(&m[1]), row(&m[2]))
}

/// Vectorized cube root mirroring [`crate::math_utils::cbrt_halley`] op-for-op.
///
/// The integer biased-exponent seed needs a signed 64-bit divide-by-3, which no
/// SIMD ISA provides, so the seed is computed per lane in scalar `i64` and
/// reloaded; the three Halley iterations and the sign/zero handling are
/// vectorized. The `x == 0` lanes produce garbage through the iterations and are
/// forced back to `0.0` at the end, exactly like the scalar early return.
#[inline(always)]
unsafe fn cbrt_halley_simd<T: SimdF64>(x: T) -> T {
    const BIAS: i64 = 1023i64 << 52;

    let ax = x.abs();

    // Per-lane scalar seed (matches cbrt_halley: signed i64, truncating /3).
    let mut lanes = [0.0f64; 4];
    ax.store(&mut lanes);
    for v in lanes.iter_mut().take(T::LANES) {
        let seed = ((v.to_bits() as i64 - BIAS) / 3 + BIAS) as u64;
        *v = f64::from_bits(seed);
    }
    let mut y = T::load(&lanes);

    let two = T::splat(2.0);
    for _ in 0..3 {
        let t1 = y.mul(y);
        let y3 = t1.mul(y);
        let t2 = two.mul(ax);
        let num = y3.add(t2);
        let t3 = two.mul(y3);
        let den = t3.add(ax);
        let t4 = y.mul(num);
        y = t4.div(den);
    }

    // Reapply sign (cbrt is odd) then force the zero lanes back to 0.0.
    // `y * copysign(1.0, x)` reproduces `if sign { -y } else { y }` exactly:
    // multiplying by ±1.0 is an exact sign flip with no rounding.
    let signed = y.mul(T::splat(1.0).copysign(x));
    signed.zero_where_key_zero(ax)
}

/// Linear-RGB → OKLAB for `LANES` pixels at once. Mirrors
/// [`crate::color::linear_rgb_to_oklab`] (M1 · rgb → cbrt → M2).
#[inline(always)]
unsafe fn oklab_forward_simd<T: SimdF64>(m1: &[[f64; 3]; 3], r: T, g: T, b: T) -> (T, T, T) {
    let (l, m, s) = matvec3_simd::<T>(m1, r, g, b);
    let lc = cbrt_halley_simd::<T>(l);
    let mc = cbrt_halley_simd::<T>(m);
    let sc = cbrt_halley_simd::<T>(s);
    matvec3_simd::<T>(&M2, lc, mc, sc)
}

/// Convert a planar batch of linear-RGB pixels to OKLAB with backend `T`,
/// handling the `count % LANES` tail with the scalar reference. Generic so the
/// `#[target_feature]` backend wrappers monomorphize it with the intrinsics
/// inlined into their feature context.
#[inline(always)]
unsafe fn oklab_forward_batch_with<T: SimdF64>(
    r: &[f64],
    g: &[f64],
    b: &[f64],
    gamut: Gamut,
    out: &mut [[f64; 3]],
) {
    let m1 = gamut.m1_matrix();
    let n = out.len();
    let lanes = T::LANES;

    let (mut lt, mut at, mut bt) = ([0.0f64; 4], [0.0f64; 4], [0.0f64; 4]);
    let mut i = 0;
    while i + lanes <= n {
        let (lo, ao, bo) =
            oklab_forward_simd::<T>(m1, T::load(&r[i..]), T::load(&g[i..]), T::load(&b[i..]));
        lo.store(&mut lt);
        ao.store(&mut at);
        bo.store(&mut bt);
        for k in 0..lanes {
            out[i + k] = [lt[k], at[k], bt[k]];
        }
        i += lanes;
    }
    // Tail: the existing scalar reference, bit-identical to the main loop.
    while i < n {
        out[i] = linear_rgb_to_oklab([r[i], g[i], b[i]], gamut);
        i += 1;
    }
}

/// Convert a planar batch of linear-RGB pixels (`r`/`g`/`b`, each `out.len()`
/// long) to OKLAB, using the fastest available backend for the build target.
///
/// Output is byte-identical to calling [`crate::color::linear_rgb_to_oklab`] on
/// each pixel — that equivalence is the gate enforced by the spec vectors and
/// the differential tests below.
pub(crate) fn oklab_forward_batch(
    r: &[f64],
    g: &[f64],
    b: &[f64],
    gamut: Gamut,
    out: &mut [[f64; 3]],
) {
    debug_assert_eq!(r.len(), out.len());
    debug_assert_eq!(g.len(), out.len());
    debug_assert_eq!(b.len(), out.len());
    // SAFETY: `dispatch` only ever selects a backend whose CPU feature is
    // present (runtime-detected on x86, compile-time `cfg` elsewhere).
    unsafe { dispatch(r, g, b, gamut, out) }
}

#[cfg(all(feature = "simd", any(target_arch = "x86", target_arch = "x86_64")))]
#[inline]
unsafe fn dispatch(r: &[f64], g: &[f64], b: &[f64], gamut: Gamut, out: &mut [[f64; 3]]) {
    if std::is_x86_feature_detected!("avx2") {
        return x86::oklab_forward_batch_avx2(r, g, b, gamut, out);
    }
    if std::is_x86_feature_detected!("sse2") {
        return x86::oklab_forward_batch_sse2(r, g, b, gamut, out);
    }
    oklab_forward_batch_with::<scalar::ScalarF64>(r, g, b, gamut, out)
}

#[cfg(all(feature = "simd", target_arch = "aarch64"))]
#[inline]
unsafe fn dispatch(r: &[f64], g: &[f64], b: &[f64], gamut: Gamut, out: &mut [[f64; 3]]) {
    // NEON (incl. f64) is mandatory in the aarch64 baseline — no detection needed.
    neon::oklab_forward_batch_neon(r, g, b, gamut, out)
}

#[cfg(all(feature = "simd", target_arch = "wasm32", target_feature = "simd128"))]
#[inline]
unsafe fn dispatch(r: &[f64], g: &[f64], b: &[f64], gamut: Gamut, out: &mut [[f64; 3]]) {
    wasm::oklab_forward_batch_simd128(r, g, b, gamut, out)
}

// Scalar fallback: feature off, or a target with no vector backend (armv7,
// wasm32 without simd128, …).
#[cfg(not(all(
    feature = "simd",
    any(
        target_arch = "x86",
        target_arch = "x86_64",
        target_arch = "aarch64",
        all(target_arch = "wasm32", target_feature = "simd128")
    )
)))]
#[inline]
unsafe fn dispatch(r: &[f64], g: &[f64], b: &[f64], gamut: Gamut, out: &mut [[f64; 3]]) {
    oklab_forward_batch_with::<scalar::ScalarF64>(r, g, b, gamut, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic xorshift64* generator — no `rand` dependency (zero-dep core).
    struct Rng(u64);
    impl Rng {
        fn next_u64(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x >> 12;
            x ^= x << 25;
            x ^= x >> 27;
            self.0 = x;
            x.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }
        /// A linear-RGB-ish value. Spans [0,1] plus a margin so we also exercise
        /// the slight over/undershoot wide-gamut EOTFs can produce.
        fn next_val(&mut self) -> f64 {
            let u = (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64; // [0,1)
            u * 1.4 - 0.2 // [-0.2, 1.2)
        }
    }

    const GAMUTS: [Gamut; 5] = [
        Gamut::Srgb,
        Gamut::DisplayP3,
        Gamut::AdobeRgb,
        Gamut::Bt2020,
        Gamut::ProPhotoRgb,
    ];

    /// A batch entry point: planar `r`/`g`/`b` in, OKLAB pixels out.
    type BatchFn = unsafe fn(&[f64], &[f64], &[f64], Gamut, &mut [[f64; 3]]);

    /// Run the batch through one backend and assert every pixel is identical to
    /// the scalar reference `color::linear_rgb_to_oklab`.
    fn assert_batch_matches(backend: &str, run: BatchFn) {
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        // Sizes hit the main loop and every tail remainder for 2- and 4-wide.
        for &n in &[0usize, 1, 2, 3, 4, 5, 7, 8, 9, 16, 31, 33, 257, 1000] {
            let mut r: Vec<f64> = (0..n).map(|_| rng.next_val()).collect();
            let g: Vec<f64> = (0..n).map(|_| rng.next_val()).collect();
            let b: Vec<f64> = (0..n).map(|_| rng.next_val()).collect();
            // Pin the exact corners that hit the cbrt zero/sign paths.
            if n > 0 {
                r[0] = 0.0;
            }
            if n > 1 {
                r[1] = 1.0;
            }
            for &gamut in &GAMUTS {
                let mut got = vec![[0.0f64; 3]; n];
                unsafe { run(&r, &g, &b, gamut, &mut got) };
                for i in 0..n {
                    let want = linear_rgb_to_oklab([r[i], g[i], b[i]], gamut);
                    assert_eq!(
                        got[i], want,
                        "{backend}: pixel {i}/{n} {gamut:?} diverged: {:?} vs {:?}",
                        got[i], want
                    );
                }
            }
        }
    }

    #[test]
    fn scalar_backend_matches_reference() {
        assert_batch_matches("scalar", |r, g, b, gamut, out| unsafe {
            oklab_forward_batch_with::<scalar::ScalarF64>(r, g, b, gamut, out)
        });
    }

    #[test]
    fn public_dispatch_matches_reference() {
        // Exercises whatever backend the host CPU selects (AVX2/SSE2/NEON/…).
        assert_batch_matches("dispatch", |r, g, b, gamut, out| {
            oklab_forward_batch(r, g, b, gamut, out)
        });
    }

    // ── Per-backend differential tests (opt-in: `simd-diff-tests`, in `full`) ──
    //
    // `public_dispatch_matches_reference` above only ever exercises whatever
    // backend *this* host selects. These tests instead pin each *specific*
    // vector backend against the scalar reference, so every backend is validated
    // on (or under emulation of) the target that compiles it. Because that is the
    // whole point, they must never quietly become no-ops: when this feature is on
    // and the host cannot execute a backend it was asked to validate, the test
    // *fails* instead of skipping — a mis-targeted run (e.g. the AVX2 suite on a
    // non-AVX2 CPU) is a misconfiguration, not a pass. Run with
    // `just test-simd-diff` (native) or `just test-simd-emulated` (all targets).

    #[cfg(all(
        feature = "simd-diff-tests",
        any(target_arch = "x86", target_arch = "x86_64")
    ))]
    #[test]
    fn sse2_backend_matches_reference() {
        assert!(
            std::is_x86_feature_detected!("sse2"),
            "simd-diff-tests: this host lacks SSE2, so the SSE2 backend cannot be \
             validated here — run the suite on an SSE2-capable target instead of \
             skipping it (see `just test-simd-emulated`)"
        );
        assert_batch_matches("sse2", |r, g, b, gamut, out| unsafe {
            x86::oklab_forward_batch_sse2(r, g, b, gamut, out)
        });
    }

    #[cfg(all(
        feature = "simd-diff-tests",
        any(target_arch = "x86", target_arch = "x86_64")
    ))]
    #[test]
    fn avx2_backend_matches_reference() {
        assert!(
            std::is_x86_feature_detected!("avx2"),
            "simd-diff-tests: this host lacks AVX2, so the AVX2 backend cannot be \
             validated here — run the suite on an AVX2-capable target instead of \
             skipping it (see `just test-simd-emulated`)"
        );
        assert_batch_matches("avx2", |r, g, b, gamut, out| unsafe {
            x86::oklab_forward_batch_avx2(r, g, b, gamut, out)
        });
    }

    #[cfg(all(feature = "simd-diff-tests", target_arch = "aarch64"))]
    #[test]
    fn neon_backend_matches_reference() {
        // NEON (incl. f64) is mandatory in the aarch64 baseline, so if this test
        // compiled for aarch64 the host can run it — no runtime guard needed.
        assert_batch_matches("neon", |r, g, b, gamut, out| unsafe {
            neon::oklab_forward_batch_neon(r, g, b, gamut, out)
        });
    }

    #[cfg(all(
        feature = "simd-diff-tests",
        target_arch = "wasm32",
        target_feature = "simd128"
    ))]
    #[test]
    fn wasm_simd128_backend_matches_reference() {
        // simd128 is a compile-time target feature: a compiled-in backend is a
        // runnable one under the wasm engine.
        assert_batch_matches("simd128", |r, g, b, gamut, out| unsafe {
            wasm::oklab_forward_batch_simd128(r, g, b, gamut, out)
        });
    }

    // Opting into `simd-diff-tests` on a target/config that produces *no* vector
    // backend (armv7, riscv64, wasm32 without `+simd128`, …) would otherwise
    // leave the suite silently scalar-only — exactly the quiet skip this feature
    // exists to forbid. Fail loudly instead.
    #[cfg(all(
        feature = "simd-diff-tests",
        not(any(
            target_arch = "x86",
            target_arch = "x86_64",
            target_arch = "aarch64",
            all(target_arch = "wasm32", target_feature = "simd128")
        ))
    ))]
    #[test]
    fn simd_diff_tests_require_a_vector_backend() {
        panic!(
            "simd-diff-tests is enabled but no SIMD backend compiles for this \
             target/config, so there is nothing to differentially test. Build a \
             target that has one (x86/x86_64, aarch64, or wasm32 with \
             `-C target-feature=+simd128`) or drop the feature."
        );
    }
}
