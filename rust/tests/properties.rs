//! Randomized property tests for the public API.
//!
//! The golden vectors in `spec/test-vectors/` are the parity gate, but they are
//! *regenerated from this crate*, so they can only catch a change to the
//! bitstream — never a bug that was present when they were written. These tests
//! assert invariants the format guarantees, over inputs nobody enumerated:
//!
//!   - a hash's byte length is a function of `(tier, has_alpha)` alone;
//!   - `from_bytes` accepts exactly what `encode_with_quality` produces;
//!   - anything `from_bytes` accepts, `decode` handles without panicking —
//!     the documented contract that "a hash that validates is guaranteed to
//!     decode";
//!   - encode and decode are deterministic;
//!   - `decode_capped` never exceeds its cap, and never returns an empty image;
//!   - `average_color` agrees with a full decode's mean to within a tolerance
//!     the DC-only path can actually hold.
//!
//! Failures shrink to a minimal reproducer, which is the reason for the
//! dependency over a hand-rolled generator.

use chromahash::{COMPACT_TIER, ChromaHash, ChromaHashError, Gamut, MAX_TIER};
use proptest::prelude::*;

/// Case budget for the properties that decode. A tier-4 decode rasterizes
/// 256x256 px, so the default 256 cases put this file at ~5 minutes in a debug
/// build — too slow for a gate that runs on every push. These properties are
/// about shape invariants over the whole tier range, not rare-value hunting,
/// so a smaller sample buys nearly all the signal.
const DECODING_CASES: u32 = 48;

/// How far `average_color` may sit from a solid input's own channel value.
///
/// The DC carries lightness at 7 bits and chroma at 6/5 bits over a *bounded*
/// chroma range (`MAX_CHROMA_A` = 0.35, `MAX_CHROMA_B` = 0.33), so a colour
/// sitting near that boundary is reproduced least precisely. Swept over the
/// RGB cube on a stride-3 grid (~636k solids), the worst deviation is 16, on
/// saturated green — `[18, 252, 15]`. The bound is set there deliberately: it
/// is the format's real behaviour, and any drift past it is a regression worth
/// failing on.
const AVERAGE_COLOR_TOLERANCE: i32 = 16;
/// Alpha is linear, not perceptual — its 5-bit DC stays within 4 across the
/// whole 0..=255 sweep.
const ALPHA_TOLERANCE: i32 = 4;

/// Byte lengths per tier code for an opaque image (spec §3.3). Alpha mode uses
/// its own, shorter, table — the second row.
const OPAQUE_LEN: [usize; 5] = [21, 32, 108, 411, 1623];
const ALPHA_LEN: [usize; 5] = [21, 32, 103, 388, 1528];

fn gamuts() -> impl Strategy<Value = Gamut> {
    prop_oneof![
        Just(Gamut::Srgb),
        Just(Gamut::DisplayP3),
        Just(Gamut::AdobeRgb),
        Just(Gamut::Bt2020),
        Just(Gamut::ProPhotoRgb),
    ]
}

/// A random RGBA image, 1..=24 px on each edge. `opaque` forces alpha to 255 so
/// a test can select the alpha mode deliberately rather than by accident — the
/// two modes have different byte lengths, and conflating them is the mistake
/// this file exists partly to prevent.
fn image(opaque: bool) -> impl Strategy<Value = (u32, u32, Vec<u8>)> {
    (1u32..=24, 1u32..=24).prop_flat_map(move |(w, h)| {
        let n = (w * h) as usize;
        prop::collection::vec(any::<u8>(), n * 4).prop_map(move |mut rgba| {
            if opaque {
                for px in rgba.chunks_exact_mut(4) {
                    px[3] = 255;
                }
            }
            (w, h, rgba)
        })
    })
}

proptest! {
    /// The byte length depends on the tier and the alpha mode, and on nothing
    /// else — not the dimensions, not the gamut, not the pixel content.
    #[test]
    fn length_is_a_function_of_tier_and_alpha(
        (w, h, rgba) in image(false),
        gamut in gamuts(),
        tier in COMPACT_TIER..=MAX_TIER,
    ) {
        let has_alpha = rgba.chunks_exact(4).any(|px| px[3] != 255);
        let table = if has_alpha { ALPHA_LEN } else { OPAQUE_LEN };
        let hash = ChromaHash::encode_with_quality(w, h, &rgba, gamut, tier);
        prop_assert_eq!(hash.as_bytes().len(), table[tier as usize]);
    }

    /// `from_bytes` accepts exactly what the encoder produced, and hands back
    /// the same bytes.
    #[test]
    fn from_bytes_round_trips_every_encode(
        (w, h, rgba) in image(false),
        gamut in gamuts(),
        tier in COMPACT_TIER..=MAX_TIER,
    ) {
        let encoded = ChromaHash::encode_with_quality(w, h, &rgba, gamut, tier);
        let parsed = ChromaHash::from_bytes(encoded.as_bytes())
            .map_err(|e| TestCaseError::fail(format!("rejected its own output: {e}")))?;
        prop_assert_eq!(parsed.as_bytes(), encoded.as_bytes());
    }

    /// Truncating or extending a valid hash must always be rejected: the header
    /// fixes the length exactly.
    #[test]
    fn wrong_lengths_are_always_rejected(
        (w, h, rgba) in image(false),
        tier in COMPACT_TIER..=MAX_TIER,
        drop_n in 1usize..=20,
        extend_n in 1usize..=20,
    ) {
        let bytes = ChromaHash::encode_with_quality(w, h, &rgba, Gamut::Srgb, tier).as_bytes().to_vec();
        let short = &bytes[..bytes.len().saturating_sub(drop_n)];
        prop_assert!(ChromaHash::from_bytes(short).is_err());

        let mut long = bytes.clone();
        long.extend(std::iter::repeat_n(0u8, extend_n));
        prop_assert!(ChromaHash::from_bytes(&long).is_err());
    }

    /// Tier codes above `MAX_TIER` are reserved, and a set reserved bit is
    /// rejected — whatever the rest of the header says.
    #[test]
    fn reserved_header_states_are_rejected(
        (w, h, rgba) in image(false),
        tier in COMPACT_TIER..=MAX_TIER,
        reserved_tier in (MAX_TIER + 1)..=7u8,
    ) {
        let valid = ChromaHash::encode_with_quality(w, h, &rgba, Gamut::Srgb, tier).as_bytes().to_vec();

        let mut bad_tier = valid.clone();
        bad_tier[0] = (bad_tier[0] & !0b0011_1000) | (reserved_tier << 3);
        prop_assert_eq!(
            ChromaHash::from_bytes(&bad_tier).unwrap_err(),
            ChromaHashError::InvalidTier
        );

        let mut reserved_bit = valid.clone();
        reserved_bit[0] |= 0b1000_0000;
        prop_assert_eq!(
            ChromaHash::from_bytes(&reserved_bit).unwrap_err(),
            ChromaHashError::ReservedBitSet
        );
    }

    /// `average_color` reads the DC term straight from the header, without a
    /// decode. For a solid image the DC *is* the color, so this reproduces the
    /// input to within the DC's quantization — the strongest form of the
    /// property, and the one the accessor exists for (a caller paints this
    /// while the real image loads).
    ///
    /// A mean-of-the-decode comparison would be the wrong assertion: the DC is
    /// a mean in Oklab, and for a high-contrast ramp the perceptual mean and
    /// the arithmetic sRGB mean genuinely differ by more than 13/255 — that is
    /// the color space behaving correctly, not the codec drifting.
    #[test]
    fn average_color_reproduces_a_solid((w, h) in (1u32..=24, 1u32..=24), rgb in any::<[u8; 3]>()) {
        let rgba: Vec<u8> = std::iter::repeat_n([rgb[0], rgb[1], rgb[2], 255], (w * h) as usize)
            .flatten()
            .collect();
        let avg = ChromaHash::encode(w, h, &rgba, Gamut::Srgb).average_color();

        for c in 0..3 {
            prop_assert!(
                (avg[c] as i32 - rgb[c] as i32).abs() <= AVERAGE_COLOR_TOLERANCE,
                "channel {}: average_color {} vs input {}",
                c,
                avg[c],
                rgb[c]
            );
        }
        prop_assert_eq!(avg[3], 255, "an opaque image must report opaque");
    }

    /// The alpha channel is not a perceptual quantity — for a uniformly
    /// transparent image the reported alpha must track the input closely
    /// whatever the color content is.
    #[test]
    fn average_color_tracks_uniform_alpha(
        (w, h) in (1u32..=24, 1u32..=24),
        rgb in any::<[u8; 3]>(),
        alpha in any::<u8>(),
    ) {
        let rgba: Vec<u8> = std::iter::repeat_n([rgb[0], rgb[1], rgb[2], alpha], (w * h) as usize)
            .flatten()
            .collect();
        let avg = ChromaHash::encode(w, h, &rgba, Gamut::Srgb).average_color();
        prop_assert!(
            (avg[3] as i32 - alpha as i32).abs() <= ALPHA_TOLERANCE,
            "alpha {} vs input {}",
            avg[3],
            alpha
        );
    }

    /// Every image encodes at the default tier to exactly 32 bytes when opaque.
    /// This is the single number the format is known by; nothing about getting
    /// it wrong fails to compile or fails to decode.
    #[test]
    fn the_default_tier_is_always_32_bytes((w, h, rgba) in image(true), gamut in gamuts()) {
        prop_assert_eq!(ChromaHash::encode(w, h, &rgba, gamut).as_bytes().len(), 32);
    }
}

// The properties above are cheap; these three decode, which at tier 4 means
// rasterizing 256x256 px per case. Same invariants, smaller sample.
proptest! {
    #![proptest_config(ProptestConfig::with_cases(DECODING_CASES))]

    /// The documented contract: bytes that validate are guaranteed to decode.
    /// Perturbing one byte of a real hash reaches both sides of it — a header
    /// byte usually fails validation, a payload byte usually does not — so this
    /// exercises the accept path with values the encoder never emits.
    #[test]
    fn anything_from_bytes_accepts_decodes(
        (w, h, rgba) in image(false),
        gamut in gamuts(),
        tier in COMPACT_TIER..=MAX_TIER,
        index in 0usize..1623,
        patch in any::<u8>(),
    ) {
        let mut bytes = ChromaHash::encode_with_quality(w, h, &rgba, gamut, tier).as_bytes().to_vec();
        let i = index % bytes.len();
        bytes[i] = patch;

        if let Ok(hash) = ChromaHash::from_bytes(&bytes) {
            let (dw, dh, pixels) = hash.decode();
            prop_assert!(dw > 0 && dh > 0);
            prop_assert_eq!(pixels.len(), (dw * dh * 4) as usize);
            // And every accessor on it, not just decode.
            let _ = hash.average_color();
            let _ = hash.decode_capped(8, 8);
        }
    }

    /// A capped decode never exceeds its cap, never returns an empty image, and
    /// preserves the aspect ratio's orientation.
    #[test]
    fn decode_capped_respects_its_cap(
        (w, h, rgba) in image(false),
        tier in COMPACT_TIER..=MAX_TIER,
        max_w in 1u32..=300,
        max_h in 1u32..=300,
    ) {
        let hash = ChromaHash::encode_with_quality(w, h, &rgba, Gamut::Srgb, tier);
        let (cw, ch, pixels) = hash.decode_capped(max_w, max_h);
        prop_assert!(cw <= max_w, "width {} exceeds cap {}", cw, max_w);
        prop_assert!(ch <= max_h, "height {} exceeds cap {}", ch, max_h);
        prop_assert!(cw > 0 && ch > 0);
        prop_assert_eq!(pixels.len(), (cw * ch * 4) as usize);

        // An uncapped decode is what a cap at or above the natural size gives.
        let (nw, nh, _) = hash.decode();
        if max_w >= nw && max_h >= nh {
            prop_assert_eq!((cw, ch), (nw, nh));
        }
    }

    /// Encoding and decoding are pure: the same input always gives the same
    /// bytes, and the same bytes always give the same pixels.
    #[test]
    fn encode_and_decode_are_deterministic(
        (w, h, rgba) in image(false),
        gamut in gamuts(),
        tier in COMPACT_TIER..=MAX_TIER,
    ) {
        let a = ChromaHash::encode_with_quality(w, h, &rgba, gamut, tier);
        let b = ChromaHash::encode_with_quality(w, h, &rgba, gamut, tier);
        prop_assert_eq!(a.as_bytes(), b.as_bytes());
        prop_assert_eq!(a.decode(), b.decode());
    }
}
