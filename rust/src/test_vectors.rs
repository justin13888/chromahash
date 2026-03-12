/// Generate golden test vectors from the Rust reference implementation.
/// Run with: cargo test --manifest-path rust/Cargo.toml -- generate_test_vectors --nocapture --ignored
#[cfg(test)]
mod tests {
    use crate::ChromaHash;
    use crate::aspect::{decode_aspect, decode_output_size, encode_aspect};
    use crate::color::{gamma_rgb_to_oklab, linear_rgb_to_oklab, oklab_to_linear_srgb};
    use crate::constants::Gamut;
    use crate::dct::triangular_scan_order;
    use crate::mulaw::{mu_compress, mu_expand, mu_law_dequantize, mu_law_quantize};

    fn solid_image(w: u32, h: u32, r: u8, g: u8, b: u8, a: u8) -> Vec<u8> {
        let n = (w * h) as usize;
        let mut rgba = vec![0u8; n * 4];
        for i in 0..n {
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = b;
            rgba[i * 4 + 3] = a;
        }
        rgba
    }

    fn gradient_image(w: u32, h: u32) -> Vec<u8> {
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let tx = x as f64 / (w - 1).max(1) as f64;
                let ty = y as f64 / (h - 1).max(1) as f64;
                let idx = ((y * w + x) * 4) as usize;
                rgba[idx] = (tx * 255.0) as u8;
                rgba[idx + 1] = ((1.0 - tx) * ty * 255.0) as u8;
                rgba[idx + 2] = ((1.0 - ty) * 255.0) as u8;
                rgba[idx + 3] = 255;
            }
        }
        rgba
    }

    fn checkerboard_alpha(w: u32, h: u32) -> Vec<u8> {
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let idx = ((y * w + x) * 4) as usize;
                if (x + y) % 2 == 0 {
                    rgba[idx] = 255;
                    rgba[idx + 1] = 0;
                    rgba[idx + 2] = 0;
                    rgba[idx + 3] = 255;
                } else {
                    rgba[idx] = 0;
                    rgba[idx + 1] = 0;
                    rgba[idx + 2] = 255;
                    rgba[idx + 3] = 0;
                }
            }
        }
        rgba
    }

    #[test]
    #[ignore]
    fn generate_test_vectors() {
        let spec_dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../spec/test-vectors");
        std::fs::create_dir_all(&spec_dir).unwrap();

        // --- unit-color.json ---
        {
            let mut cases = Vec::new();

            let color_tests: &[(&str, [f64; 3], Gamut, &str)] = &[
                ("white_srgb", [1.0, 1.0, 1.0], Gamut::Srgb, "sRGB"),
                ("black_srgb", [0.0, 0.0, 0.0], Gamut::Srgb, "sRGB"),
                ("red_srgb", [1.0, 0.0, 0.0], Gamut::Srgb, "sRGB"),
                ("green_srgb", [0.0, 1.0, 0.0], Gamut::Srgb, "sRGB"),
                ("blue_srgb", [0.0, 0.0, 1.0], Gamut::Srgb, "sRGB"),
                ("mid_gray_srgb", [0.5, 0.5, 0.5], Gamut::Srgb, "sRGB"),
                ("red_p3", [1.0, 0.0, 0.0], Gamut::DisplayP3, "Display P3"),
                ("red_adobe", [1.0, 0.0, 0.0], Gamut::AdobeRgb, "Adobe RGB"),
            ];

            for &(name, rgb, gamut, gamut_name) in color_tests {
                let lab = linear_rgb_to_oklab(rgb, gamut);
                let rt = oklab_to_linear_srgb(lab);
                cases.push(format!(
                    r#"  {{
    "name": "{name}",
    "input": {{ "linear_rgb": [{}, {}, {}], "gamut": "{gamut_name}" }},
    "expected": {{
      "oklab": [{}, {}, {}],
      "roundtrip_srgb": [{}, {}, {}]
    }}
  }}"#,
                    rgb[0], rgb[1], rgb[2], lab[0], lab[1], lab[2], rt[0], rt[1], rt[2],
                ));
            }

            // Gamma-encoded color tests
            let gamma_tests: &[(&str, [f64; 3], Gamut, &str)] = &[
                ("gamma_red_srgb", [1.0, 0.0, 0.0], Gamut::Srgb, "sRGB"),
                ("gamma_mid_srgb", [0.5, 0.5, 0.5], Gamut::Srgb, "sRGB"),
            ];
            for &(name, rgb, gamut, gamut_name) in gamma_tests {
                let lab = gamma_rgb_to_oklab(rgb[0], rgb[1], rgb[2], gamut);
                cases.push(format!(
                    r#"  {{
    "name": "{name}",
    "input": {{ "gamma_rgb": [{}, {}, {}], "gamut": "{gamut_name}" }},
    "expected": {{ "oklab": [{}, {}, {}] }}
  }}"#,
                    rgb[0], rgb[1], rgb[2], lab[0], lab[1], lab[2],
                ));
            }

            let json = format!("[\n{}\n]\n", cases.join(",\n"));
            std::fs::write(spec_dir.join("unit-color.json"), json).unwrap();
        }

        // --- unit-mulaw.json ---
        {
            let mut cases = Vec::new();
            for &v in &[-1.0, -0.75, -0.5, -0.25, 0.0, 0.25, 0.5, 0.75, 1.0] {
                let c = mu_compress(v);
                let e = mu_expand(c);
                for bits in [4u32, 5, 6] {
                    let q = mu_law_quantize(v, bits);
                    let dq = mu_law_dequantize(q, bits);
                    cases.push(format!(
                        r#"  {{
    "name": "v={v}_bits={bits}",
    "input": {{ "value": {v}, "bits": {bits} }},
    "expected": {{ "compressed": {c}, "expanded": {e}, "quantized": {q}, "dequantized": {dq} }}
  }}"#,
                    ));
                }
            }
            let json = format!("[\n{}\n]\n", cases.join(",\n"));
            std::fs::write(spec_dir.join("unit-mulaw.json"), json).unwrap();
        }

        // --- unit-dct.json ---
        {
            let mut cases = Vec::new();
            for &(nx, ny) in &[(3, 3), (4, 4), (6, 6), (7, 7)] {
                let order = triangular_scan_order(nx, ny);
                let pairs: Vec<String> = order
                    .iter()
                    .map(|&(cx, cy)| format!("[{cx},{cy}]"))
                    .collect();
                cases.push(format!(
                    r#"  {{
    "name": "scan_order_{nx}x{ny}",
    "input": {{ "nx": {nx}, "ny": {ny} }},
    "expected": {{ "ac_count": {}, "scan_order": [{}] }}
  }}"#,
                    order.len(),
                    pairs.join(","),
                ));
            }
            let json = format!("[\n{}\n]\n", cases.join(",\n"));
            std::fs::write(spec_dir.join("unit-dct.json"), json).unwrap();
        }

        // --- unit-aspect.json ---
        {
            let mut cases = Vec::new();
            for &(w, h, label) in &[
                (1u32, 1u32, "1:1"),
                (3, 2, "3:2"),
                (4, 3, "4:3"),
                (16, 9, "16:9"),
                (4, 1, "4:1"),
                (1, 4, "1:4"),
                (2, 1, "2:1"),
                (1, 2, "1:2"),
                (100, 25, "100:25"),
            ] {
                let byte = encode_aspect(w, h);
                let decoded_ratio = decode_aspect(byte);
                let (dw, dh) = decode_output_size(byte);
                cases.push(format!(
                    r#"  {{
    "name": "aspect_{label}",
    "input": {{ "width": {w}, "height": {h} }},
    "expected": {{ "byte": {byte}, "decoded_ratio": {decoded_ratio}, "output_width": {dw}, "output_height": {dh} }}
  }}"#,
                ));
            }
            let json = format!("[\n{}\n]\n", cases.join(",\n"));
            std::fs::write(spec_dir.join("unit-aspect.json"), json).unwrap();
        }

        // --- integration-encode.json ---
        {
            let mut cases = Vec::new();

            let test_images: Vec<(&str, u32, u32, Vec<u8>, Gamut)> = vec![
                (
                    "solid_gray_4x4",
                    4,
                    4,
                    solid_image(4, 4, 128, 128, 128, 255),
                    Gamut::Srgb,
                ),
                (
                    "solid_red_4x4",
                    4,
                    4,
                    solid_image(4, 4, 255, 0, 0, 255),
                    Gamut::Srgb,
                ),
                (
                    "solid_green_4x4",
                    4,
                    4,
                    solid_image(4, 4, 0, 255, 0, 255),
                    Gamut::Srgb,
                ),
                (
                    "solid_blue_4x4",
                    4,
                    4,
                    solid_image(4, 4, 0, 0, 255, 255),
                    Gamut::Srgb,
                ),
                (
                    "solid_white_4x4",
                    4,
                    4,
                    solid_image(4, 4, 255, 255, 255, 255),
                    Gamut::Srgb,
                ),
                (
                    "solid_black_4x4",
                    4,
                    4,
                    solid_image(4, 4, 0, 0, 0, 255),
                    Gamut::Srgb,
                ),
                (
                    "gradient_16x16",
                    16,
                    16,
                    gradient_image(16, 16),
                    Gamut::Srgb,
                ),
                ("gradient_8x4", 8, 4, gradient_image(8, 4), Gamut::Srgb),
                ("gradient_4x8", 4, 8, gradient_image(4, 8), Gamut::Srgb),
                (
                    "checkerboard_alpha_8x8",
                    8,
                    8,
                    checkerboard_alpha(8, 8),
                    Gamut::Srgb,
                ),
                (
                    "solid_1x1",
                    1,
                    1,
                    solid_image(1, 1, 200, 100, 50, 255),
                    Gamut::Srgb,
                ),
                (
                    "solid_p3_4x4",
                    4,
                    4,
                    solid_image(4, 4, 200, 100, 50, 255),
                    Gamut::DisplayP3,
                ),
            ];

            for (name, w, h, rgba, gamut) in &test_images {
                let hash = ChromaHash::encode(*w, *h, rgba, *gamut);
                let bytes: Vec<String> = hash.as_bytes().iter().map(|b| b.to_string()).collect();
                let avg = hash.average_color();
                let rgba_str: Vec<String> = rgba.iter().map(|b| b.to_string()).collect();
                let gamut_name = match gamut {
                    Gamut::Srgb => "sRGB",
                    Gamut::DisplayP3 => "Display P3",
                    Gamut::AdobeRgb => "Adobe RGB",
                    Gamut::Bt2020 => "BT.2020",
                    Gamut::ProPhotoRgb => "ProPhoto RGB",
                };
                cases.push(format!(
                    r#"  {{
    "name": "{name}",
    "input": {{ "width": {w}, "height": {h}, "gamut": "{gamut_name}", "rgba": [{rgba_list}] }},
    "expected": {{ "hash": [{hash_list}], "average_color": [{},{},{},{}] }}
  }}"#,
                    avg[0],
                    avg[1],
                    avg[2],
                    avg[3],
                    rgba_list = rgba_str.join(","),
                    hash_list = bytes.join(","),
                ));
            }
            let json = format!("[\n{}\n]\n", cases.join(",\n"));
            std::fs::write(spec_dir.join("integration-encode.json"), json).unwrap();
        }

        // --- integration-decode.json ---
        {
            let mut cases = Vec::new();

            let test_hashes: Vec<(&str, u32, u32, Vec<u8>, Gamut)> = vec![
                (
                    "solid_gray_4x4",
                    4,
                    4,
                    solid_image(4, 4, 128, 128, 128, 255),
                    Gamut::Srgb,
                ),
                (
                    "solid_red_4x4",
                    4,
                    4,
                    solid_image(4, 4, 255, 0, 0, 255),
                    Gamut::Srgb,
                ),
                (
                    "gradient_16x16",
                    16,
                    16,
                    gradient_image(16, 16),
                    Gamut::Srgb,
                ),
                (
                    "checkerboard_alpha_8x8",
                    8,
                    8,
                    checkerboard_alpha(8, 8),
                    Gamut::Srgb,
                ),
            ];

            for (name, w, h, rgba, gamut) in &test_hashes {
                let hash = ChromaHash::encode(*w, *h, rgba, *gamut);
                let (dw, dh, decoded_rgba) = hash.decode();
                let bytes: Vec<String> = hash.as_bytes().iter().map(|b| b.to_string()).collect();
                let decoded_str: Vec<String> = decoded_rgba.iter().map(|b| b.to_string()).collect();
                cases.push(format!(
                    r#"  {{
    "name": "{name}",
    "input": {{ "hash": [{hash_list}] }},
    "expected": {{ "width": {dw}, "height": {dh}, "rgba": [{rgba_list}] }}
  }}"#,
                    hash_list = bytes.join(","),
                    rgba_list = decoded_str.join(","),
                ));
            }
            let json = format!("[\n{}\n]\n", cases.join(",\n"));
            std::fs::write(spec_dir.join("integration-decode.json"), json).unwrap();
        }

        eprintln!("Test vectors generated in {:?}", spec_dir);
    }
}
