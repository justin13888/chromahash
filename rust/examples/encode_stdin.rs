use chromahash::{
    BatchEncoder, ChromaHash, Companding, Gamut, ImageInput, MAX_TIER, QuantTable, Tunables,
    encode_debug_coefficients,
};
use std::io::{self, Read, Write};
use std::sync::Arc;

fn usage() -> ! {
    eprintln!("Usage:");
    eprintln!("  encode_stdin encode <width> <height> <gamut>");
    eprintln!("  encode_stdin decode [max_width max_height]");
    eprintln!("  encode_stdin average-color");
    eprintln!("  encode_stdin batch-encode <width> <height> <gamut> <count>");
    eprintln!("  encode_stdin batch-decode <count>");
    eprintln!("  encode_stdin bench-encode <width> <height> <gamut> <iters>");
    eprintln!("  encode_stdin bench-decode <iters> [max_width max_height]");
    eprintln!("  encode_stdin dump-coeffs <width> <height> <gamut>");
    eprintln!();
    eprintln!("Quality: set CHROMAHASH_TIER=0..=3 to pick the quality multiplier");
    eprintln!("(0 = 32-byte default; each tier doubles the render resolution).");
    eprintln!("Sweep interface: set CHROMAHASH_TUNE to space-separated key=value");
    eprintln!("pairs to override v1 format constants, e.g.");
    eprintln!("  CHROMAHASH_TUNE=\"layout=B w_min_l=1.0 mu_c=8\"");
    std::process::exit(1);
}

/// Quality tier from `CHROMAHASH_TIER` (default 0). Kept separate from the
/// `CHROMAHASH_TUNE` parser so positional CLI args stay stable for the harness.
fn tier_from_env() -> u8 {
    match std::env::var("CHROMAHASH_TIER") {
        Ok(s) => {
            let tier: u8 = s.parse().unwrap_or_else(|_| {
                eprintln!("CHROMAHASH_TIER: invalid tier '{s}'");
                std::process::exit(1);
            });
            if !chromahash::is_valid_tier(tier) {
                eprintln!(
                    "CHROMAHASH_TIER: tier {tier} is not a valid code (0..={MAX_TIER}, or {} for the compact tier)",
                    chromahash::COMPACT_TIER
                );
                std::process::exit(1);
            }
            tier
        }
        Err(_) => 0,
    }
}

/// Read a whole variable-length hash from stdin and validate it against the
/// tunables in effect (a sweep may resize the AC layout, which legitimately
/// changes the encoded length).
fn read_hash_from_stdin() -> ChromaHash {
    let mut buf = Vec::new();
    io::stdin()
        .read_to_end(&mut buf)
        .expect("failed to read hash from stdin");
    ChromaHash::from_bytes_tuned(&buf, &tunables_from_env()).unwrap_or_else(|e| {
        eprintln!("invalid chromahash on stdin: {e}");
        std::process::exit(1);
    })
}

/// Apply a raw layout override to both the tier-0 table and the tier-1..3 base.
fn set_layouts(t: &mut Tunables, mut f: impl FnMut(&mut chromahash::AcLayout)) {
    f(&mut t.layout);
    f(&mut t.layout_upper);
    f(&mut t.layout_compact);
}

/// Which row of the three-row AC layout table a raw override applies to.
enum LayoutScope {
    /// Every row — the historical "one base, scaled by 4^tier" meaning, extended
    /// to the compact row so a bare knob is never silently inert at some tier.
    Both,
    /// Tier 0 only.
    T0,
    /// The tier-1..3 base only.
    Upper,
    /// The compact tier only.
    Compact,
}

/// Apply a raw layout override to one row of the table, or to both.
fn set_layout_scoped(
    t: &mut Tunables,
    scope: LayoutScope,
    mut f: impl FnMut(&mut chromahash::AcLayout),
) {
    match scope {
        LayoutScope::Both => set_layouts(t, f),
        LayoutScope::T0 => f(&mut t.layout),
        LayoutScope::Upper => f(&mut t.layout_upper),
        LayoutScope::Compact => f(&mut t.layout_compact),
    }
}

/// Split a raw layout key into its base name and the row it targets: a `_t0`
/// suffix means tier 0 only, `_up` the tier-1..3 base, and no suffix both.
fn split_layout_scope(key: &str) -> (&str, LayoutScope) {
    if let Some(base) = key.strip_suffix("_t0") {
        (base, LayoutScope::T0)
    } else if let Some(base) = key.strip_suffix("_up") {
        (base, LayoutScope::Upper)
    } else if let Some(base) = key.strip_suffix("_tc") {
        (base, LayoutScope::Compact)
    } else {
        (key, LayoutScope::Both)
    }
}

/// Parse CHROMAHASH_TUNE overrides on top of `Tunables::DEFAULT`.
/// Unknown keys or malformed values abort loudly — a silently ignored knob
/// would corrupt a whole sweep.
///
/// Each match arm below mirrors one field of `chromahash::Tunables`; keep this
/// parser in sync with that struct (see `rust/src/constants.rs`).
fn tunables_from_env() -> Tunables {
    let mut t = Tunables::DEFAULT;
    let Ok(spec) = std::env::var("CHROMAHASH_TUNE") else {
        return t;
    };
    for pair in spec.split_whitespace() {
        let Some((key, value)) = pair.split_once('=') else {
            eprintln!("CHROMAHASH_TUNE: malformed pair '{pair}'");
            std::process::exit(1);
        };
        let parse_f64 = || -> f64 {
            value.parse().unwrap_or_else(|_| {
                eprintln!("CHROMAHASH_TUNE: invalid number for {key}: '{value}'");
                std::process::exit(1);
            })
        };
        let parse_u32 = || -> u32 {
            value.parse().unwrap_or_else(|_| {
                eprintln!("CHROMAHASH_TUNE: invalid integer for {key}: '{value}'");
                std::process::exit(1);
            })
        };
        match key {
            "layout" => {
                t.layout = match value {
                    "A" => chromahash::LAYOUT_A,
                    "B" => chromahash::LAYOUT_B,
                    "C" => chromahash::LAYOUT_C,
                    "D" => chromahash::LAYOUT_D,
                    "T0" => chromahash::LAYOUT_T0,
                    _ => {
                        eprintln!("CHROMAHASH_TUNE: unknown layout '{value}'");
                        std::process::exit(1);
                    }
                };
                t.layout_upper = t.layout;
            }
            "max_chroma_a" => t.max_chroma_a = parse_f64(),
            "max_chroma_b" => t.max_chroma_b = parse_f64(),
            "max_l_scale" => t.max_l_scale = parse_f64(),
            "max_a_scale" => t.max_a_scale = parse_f64(),
            "max_b_scale" => t.max_b_scale = parse_f64(),
            "max_alpha_scale" => t.max_alpha_scale = parse_f64(),
            "mu_l" => t.mu_l = parse_f64(),
            "mu_c" => t.mu_c = parse_f64(),
            "mu_alpha" => t.mu_alpha = parse_f64(),
            "w_min_l" => t.w_min_l = parse_f64(),
            "w_exp_l" => t.w_exp_l = parse_u32(),
            "w_min_c" => t.w_min_c = parse_f64(),
            "w_exp_c" => t.w_exp_c = parse_u32(),
            "dc_search" => t.dc_search = value == "1" || value == "true",
            // Companding family per group: mulaw | alaw:<a> | pow:<gamma> | table
            "compand_l" => t.compand_l = parse_companding(key, value),
            "compand_c" => t.compand_c = parse_companding(key, value),
            "compand_alpha" => t.compand_alpha = parse_companding(key, value),
            // Trained codebooks (positive half, comma-separated ascending levels)
            "table_l" => t.table_l = parse_table(key, value),
            "table_c" => t.table_c = parse_table(key, value),
            "table_alpha" => t.table_alpha = parse_table(key, value),
            "deadzone_l" => t.deadzone_l = parse_f64(),
            "deadzone_c" => t.deadzone_c = parse_f64(),
            "deadzone_alpha" => t.deadzone_alpha = parse_f64(),
            "band_split" => t.band_split = parse_f64(),
            "band_gain_l" => t.band_gain_l = parse_f64(),
            "band_gain_c" => t.band_gain_c = parse_f64(),
            "aniso" => t.aniso_oblique = parse_f64(),
            "ac_nearest" => t.ac_nearest = value == "1" || value == "true",
            "scale_fit" => t.scale_fit = parse_u32(),
            "refine_passes" => t.refine_passes = parse_u32(),
            "refine_delta" => t.refine_delta = parse_u32(),
            "refine_obj" => t.refine_obj = parse_u32(),
            "refine_dc" => t.refine_dc = value == "1" || value == "true",
            "refine_scale" => t.refine_scale = value == "1" || value == "true",
            "reproject_passes" => t.reproject_passes = parse_u32(),
            "aspect_bits" => t.aspect_bits = parse_u32(),
            "l_dc_bits" => t.l_dc_bits = parse_u32(),
            "a_dc_bits" => t.a_dc_bits = parse_u32(),
            "b_dc_bits" => t.b_dc_bits = parse_u32(),
            "l_scale_bits" => t.l_scale_bits = parse_u32(),
            "a_scale_bits" => t.a_scale_bits = parse_u32(),
            "b_scale_bits" => t.b_scale_bits = parse_u32(),
            "b_scale_from_a" => t.b_scale_from_a = value == "1" || value == "true",
            "scale_mu" => t.scale_mu = parse_f64(),
            "sel_hv" => t.sel_hv = parse_f64(),
            "refine_grid" => t.refine_grid = parse_u32(),
            "refine_wl" => t.refine_wl = parse_f64(),
            "refine_wc" => t.refine_wc = parse_f64(),
            "cfl_bits" => t.cfl_bits = parse_u32(),
            "cfl_range" => t.cfl_range = parse_f64(),
            "synth_count" => t.synth_count = parse_u32() as usize,
            "synth_gain" => t.synth_gain = parse_f64(),
            "interleave" => t.interleave = value == "1" || value == "true",
            "trunc_bytes" => t.trunc_bytes = parse_u32() as usize,
            "alpha_dc_bits" => t.alpha_dc_bits = parse_u32(),
            "alpha_scale_bits" => t.alpha_scale_bits = parse_u32(),
            "alpha_ac_count" => {
                let n = parse_u32() as usize;
                set_layouts(&mut t, |l| l.a_count = n);
            }
            "alpha_ac_bits" => {
                let n = parse_u32();
                set_layouts(&mut t, |l| l.a_bits = n);
            }
            "alpha_ac_fit" => t.alpha_ac_fit = value == "1" || value == "true",
            // Raw AcLayout overrides ("count:bits"), applied on top of `layout`.
            // v1 splits the layout in two (tier 0 vs. the tier-1..3 base). The
            // bare keys write *both*, so a sweep written before the split keeps
            // the historical "one base, scaled by 4^tier" meaning at whatever
            // tier it runs at; a `_t0` or `_up` suffix targets one row, which is
            // the only way to ask "move tier 0 and leave the rest alone".
            _ => match split_layout_scope(key) {
                ("l1", sc) => {
                    set_layout_scoped(&mut t, sc, |l| l.l_tiers[0] = parse_count_bits(key, value));
                }
                ("l2", sc) => {
                    set_layout_scoped(&mut t, sc, |l| l.l_tiers[1] = parse_count_bits(key, value));
                }
                ("c", sc) => set_layout_scoped(&mut t, sc, |l| {
                    let (count, bits) = parse_count_bits(key, value);
                    l.c_count = count;
                    l.c_bits = bits;
                }),
                ("la1", sc) => {
                    set_layout_scoped(&mut t, sc, |l| l.la_tiers[0] = parse_count_bits(key, value));
                }
                ("la2", sc) => {
                    set_layout_scoped(&mut t, sc, |l| l.la_tiers[1] = parse_count_bits(key, value));
                }
                ("a", sc) => set_layout_scoped(&mut t, sc, |l| {
                    let (count, bits) = parse_count_bits(key, value);
                    l.a_count = count;
                    l.a_bits = bits;
                }),
                ("ca", sc) => set_layout_scoped(&mut t, sc, |l| {
                    let (count, bits) = parse_count_bits(key, value);
                    l.ca_count = count;
                    l.ca_bits = bits;
                }),
                _ => {
                    eprintln!("CHROMAHASH_TUNE: unknown key '{key}'");
                    std::process::exit(1);
                }
            },
        }
    }
    t
}

/// Parse a companding family spec: `mulaw`, `alaw:<a>`, `pow:<gamma>`, `table`.
fn parse_companding(key: &str, value: &str) -> Companding {
    let bad = || -> ! {
        eprintln!("CHROMAHASH_TUNE: invalid companding for {key}: '{value}'");
        std::process::exit(1);
    };
    match value.split_once(':') {
        None => match value {
            "mulaw" => Companding::MuLaw,
            "table" => Companding::Table,
            _ => bad(),
        },
        Some((family, param)) => {
            let p: f64 = param.parse().unwrap_or_else(|_| bad());
            match family {
                "alaw" => Companding::ALaw { a: p },
                "pow" => Companding::Power { gamma: p },
                _ => bad(),
            }
        }
    }
}

/// Parse a trained codebook: comma-separated ascending positive levels.
fn parse_table(key: &str, value: &str) -> QuantTable {
    let mut table = QuantTable::EMPTY;
    for (i, part) in value.split(',').enumerate() {
        if i >= table.levels.len() {
            eprintln!("CHROMAHASH_TUNE: too many levels for {key} (max 31)");
            std::process::exit(1);
        }
        table.levels[i] = part.parse().unwrap_or_else(|_| {
            eprintln!("CHROMAHASH_TUNE: invalid level for {key}: '{part}'");
            std::process::exit(1);
        });
        table.len = (i + 1) as u8;
    }
    table
}

/// Parse a "count:bits" AcLayout override.
fn parse_count_bits(key: &str, value: &str) -> (usize, u32) {
    let bad = || -> ! {
        eprintln!("CHROMAHASH_TUNE: invalid count:bits for {key}: '{value}'");
        std::process::exit(1);
    };
    let Some((count, bits)) = value.split_once(':') else {
        bad();
    };
    (
        count.parse().unwrap_or_else(|_| bad()),
        bits.parse().unwrap_or_else(|_| bad()),
    )
}

fn parse_gamut(s: &str) -> Gamut {
    match s {
        "srgb" => Gamut::Srgb,
        "displayp3" => Gamut::DisplayP3,
        "adobergb" => Gamut::AdobeRgb,
        "bt2020" => Gamut::Bt2020,
        "prophoto" => Gamut::ProPhotoRgb,
        other => {
            eprintln!("unknown gamut: {other}");
            std::process::exit(1);
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        usage();
    }

    match args[1].as_str() {
        "encode" => {
            if args.len() != 5 {
                eprintln!("Usage: encode_stdin encode <width> <height> <gamut>");
                std::process::exit(1);
            }
            let w: u32 = args[2].parse().expect("invalid width");
            let h: u32 = args[3].parse().expect("invalid height");
            let gamut = parse_gamut(&args[4]);

            let expected_len = (w as usize) * (h as usize) * 4;
            let mut rgba = vec![0u8; expected_len];
            io::stdin()
                .read_exact(&mut rgba)
                .expect("failed to read RGBA from stdin");

            let hash = ChromaHash::encode_tuned_quality(
                w,
                h,
                &rgba,
                gamut,
                &tunables_from_env(),
                tier_from_env(),
            );
            io::stdout()
                .write_all(hash.as_bytes())
                .expect("failed to write hash");
        }
        "decode" => {
            if args.len() != 2 && args.len() != 4 {
                eprintln!("Usage: encode_stdin decode [max_width max_height]");
                std::process::exit(1);
            }
            let ch = read_hash_from_stdin();
            let t = tunables_from_env();
            // Output gamut via env (keeps positional args stable for the
            // comparison harness): srgb (default) | displayp3 | adobergb.
            let out_gamut = match std::env::var("CHROMAHASH_OUT").as_deref() {
                Ok("displayp3") => Gamut::DisplayP3,
                Ok("adobergb") => Gamut::AdobeRgb,
                _ => Gamut::Srgb,
            };
            let (w, h, rgba) = if args.len() == 4 {
                let max_w: u32 = args[2].parse().expect("invalid max_width");
                let max_h: u32 = args[3].parse().expect("invalid max_height");
                ch.decode_capped_to_tuned(max_w, max_h, out_gamut, &t)
            } else {
                ch.decode_to_tuned(out_gamut, &t)
            };
            let header = format!("{w} {h}\n");
            io::stdout()
                .write_all(header.as_bytes())
                .expect("failed to write header");
            io::stdout().write_all(&rgba).expect("failed to write RGBA");
        }
        "average-color" => {
            let rgba = read_hash_from_stdin().average_color();
            io::stdout()
                .write_all(&rgba)
                .expect("failed to write average color");
        }
        "batch-encode" => {
            // Read one image, encode it `count` times through the parallel
            // BatchEncoder. Used to benchmark bulk throughput.
            if args.len() != 6 {
                eprintln!("Usage: encode_stdin batch-encode <width> <height> <gamut> <count>");
                std::process::exit(1);
            }
            let w: u32 = args[2].parse().expect("invalid width");
            let h: u32 = args[3].parse().expect("invalid height");
            let gamut = parse_gamut(&args[4]);
            let count: usize = args[5].parse().expect("invalid count");

            let expected_len = (w as usize) * (h as usize) * 4;
            let mut rgba = vec![0u8; expected_len];
            io::stdin()
                .read_exact(&mut rgba)
                .expect("failed to read RGBA from stdin");
            let rgba: Arc<[u8]> = Arc::from(rgba);
            let tier = tier_from_env();

            let items: Vec<ImageInput> = (0..count)
                .map(|_| ImageInput {
                    w,
                    h,
                    rgba: Arc::clone(&rgba),
                    gamut,
                    quality: tier,
                })
                .collect();

            let encoder = BatchEncoder::new();
            let hashes = encoder.encode_batch(&items);
            // Write one result-derived byte so the work cannot be optimized away.
            io::stdout()
                .write_all(&[hashes[0].as_bytes()[0]])
                .expect("failed to write checksum");
        }
        "bench-encode" => {
            // In-process encode timing: read one image, loop `iters` times, print
            // the mean nanoseconds per encode to stdout. The comparison harness
            // uses this so ChromaHash timing excludes process-spawn overhead and
            // is measured on the same terms as the in-process npm formats.
            if args.len() != 6 {
                eprintln!("Usage: encode_stdin bench-encode <width> <height> <gamut> <iters>");
                std::process::exit(1);
            }
            let w: u32 = args[2].parse().expect("invalid width");
            let h: u32 = args[3].parse().expect("invalid height");
            let gamut = parse_gamut(&args[4]);
            let iters: u32 = args[5].parse().expect("invalid iters");

            let expected_len = (w as usize) * (h as usize) * 4;
            let mut rgba = vec![0u8; expected_len];
            io::stdin()
                .read_exact(&mut rgba)
                .expect("failed to read RGBA from stdin");
            let t = tunables_from_env();
            let tier = tier_from_env();

            // Warmup (also validates the input before the timed loop).
            std::hint::black_box(ChromaHash::encode_tuned_quality(
                w, h, &rgba, gamut, &t, tier,
            ));
            let start = std::time::Instant::now();
            for _ in 0..iters {
                std::hint::black_box(ChromaHash::encode_tuned_quality(
                    w, h, &rgba, gamut, &t, tier,
                ));
            }
            let ns_per_op = start.elapsed().as_nanos() / u128::from(iters.max(1));
            println!("{ns_per_op}");
        }
        "bench-decode" => {
            // In-process decode timing: read one hash, loop `iters` times, print
            // the mean nanoseconds per decode to stdout. Optional max dims use the
            // capped decode path (same as `decode [max_w max_h]`).
            if args.len() != 3 && args.len() != 5 {
                eprintln!("Usage: encode_stdin bench-decode <iters> [max_width max_height]");
                std::process::exit(1);
            }
            let iters: u32 = args[2].parse().expect("invalid iters");
            let ch = read_hash_from_stdin();
            let t = tunables_from_env();
            let out_gamut = match std::env::var("CHROMAHASH_OUT").as_deref() {
                Ok("displayp3") => Gamut::DisplayP3,
                Ok("adobergb") => Gamut::AdobeRgb,
                _ => Gamut::Srgb,
            };
            let cap = if args.len() == 5 {
                let max_w: u32 = args[3].parse().expect("invalid max_width");
                let max_h: u32 = args[4].parse().expect("invalid max_height");
                Some((max_w, max_h))
            } else {
                None
            };
            let run = || match cap {
                Some((mw, mh)) => ch.decode_capped_to_tuned(mw, mh, out_gamut, &t),
                None => ch.decode_to_tuned(out_gamut, &t),
            };

            std::hint::black_box(run());
            let start = std::time::Instant::now();
            for _ in 0..iters {
                std::hint::black_box(run());
            }
            let ns_per_op = start.elapsed().as_nanos() / u128::from(iters.max(1));
            println!("{ns_per_op}");
        }
        "dump-coeffs" => {
            // Print the encoder's scale-normalized AC coefficients, one per
            // line as "<group> <value>" (groups l/a/b/alpha). The harness pools
            // these across the tuning corpus to train Lloyd-Max codebooks.
            if args.len() != 5 {
                eprintln!("Usage: encode_stdin dump-coeffs <width> <height> <gamut>");
                std::process::exit(1);
            }
            let w: u32 = args[2].parse().expect("invalid width");
            let h: u32 = args[3].parse().expect("invalid height");
            let gamut = parse_gamut(&args[4]);

            let expected_len = (w as usize) * (h as usize) * 4;
            let mut rgba = vec![0u8; expected_len];
            io::stdin()
                .read_exact(&mut rgba)
                .expect("failed to read RGBA from stdin");

            let dump = encode_debug_coefficients(
                w,
                h,
                &rgba,
                gamut,
                &tunables_from_env(),
                tier_from_env(),
            );
            let mut out = String::new();
            for (group, values) in [
                ("l", &dump.l),
                ("a", &dump.a),
                ("b", &dump.b),
                ("alpha", &dump.alpha),
            ] {
                for v in values {
                    out.push_str(group);
                    out.push(' ');
                    out.push_str(&format!("{v:.17}"));
                    out.push('\n');
                }
            }
            io::stdout()
                .write_all(out.as_bytes())
                .expect("failed to write coefficients");
        }
        "batch-decode" => {
            // No batch decode API exists; loop the single decode `count` times.
            if args.len() != 3 {
                eprintln!("Usage: encode_stdin batch-decode <count>");
                std::process::exit(1);
            }
            let count: usize = args[2].parse().expect("invalid count");
            let ch = read_hash_from_stdin();
            let mut acc = 0u8;
            for _ in 0..count {
                let (_w, _h, rgba) = ch.decode();
                acc ^= rgba[0];
            }
            io::stdout()
                .write_all(&[acc])
                .expect("failed to write checksum");
        }
        _ => usage(),
    }
}
