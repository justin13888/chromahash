package chromahash

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// ── helpers ──────────────────────────────────────────────────────────────────

func solidImage(w, h int, r, g, b, a byte) []byte {
	rgba := make([]byte, w*h*4)
	for i := 0; i < w*h; i++ {
		rgba[i*4] = r
		rgba[i*4+1] = g
		rgba[i*4+2] = b
		rgba[i*4+3] = a
	}
	return rgba
}

func horizontalGradient(w, h int) []byte {
	rgba := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			t := float64(x) / math.Max(float64(w-1), 1)
			idx := (y*w + x) * 4
			rgba[idx] = byte(t * 255)
			rgba[idx+1] = byte((1.0 - t) * 255)
			rgba[idx+2] = 128
			rgba[idx+3] = 255
		}
	}
	return rgba
}

func verticalGradient(w, h int) []byte {
	rgba := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		t := float64(y) / math.Max(float64(h-1), 1)
		for x := 0; x < w; x++ {
			idx := (y*w + x) * 4
			rgba[idx] = byte(t * 255)
			rgba[idx+1] = byte(t * 128)
			rgba[idx+2] = byte((1.0 - t) * 255)
			rgba[idx+3] = 255
		}
	}
	return rgba
}

func absInt(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// ── math_utils ───────────────────────────────────────────────────────────────

func TestRoundHalfAwayFromZero(t *testing.T) {
	cases := [][2]float64{
		{0.5, 1.0},
		{1.5, 2.0},
		{2.5, 3.0},
		{-0.5, -1.0},
		{-1.5, -2.0},
		{-2.5, -3.0},
		{0.0, 0.0},
		{0.3, 0.0},
		{0.7, 1.0},
		{-0.3, 0.0},
		{-0.7, -1.0},
	}
	for _, c := range cases {
		got := roundHalfAwayFromZero(c[0])
		if got != c[1] {
			t.Errorf("roundHalfAwayFromZero(%v) = %v, want %v", c[0], got, c[1])
		}
	}
}

func TestCbrtSigned(t *testing.T) {
	cases := [][2]float64{
		{8.0, 2.0},
		{27.0, 3.0},
		{-8.0, -2.0},
		{-27.0, -3.0},
		{0.0, 0.0},
	}
	for _, c := range cases {
		got := cbrtSigned(c[0])
		if math.Abs(got-c[1]) > 1e-12 {
			t.Errorf("cbrtSigned(%v) = %v, want %v", c[0], got, c[1])
		}
	}
}

func TestClamp01(t *testing.T) {
	if clamp01(-0.5) != 0.0 {
		t.Error("clamp01(-0.5) should be 0")
	}
	if clamp01(0.5) != 0.5 {
		t.Error("clamp01(0.5) should be 0.5")
	}
	if clamp01(1.5) != 1.0 {
		t.Error("clamp01(1.5) should be 1")
	}
}

// ── transfer ─────────────────────────────────────────────────────────────────

func TestSrgbRoundtrip(t *testing.T) {
	for _, x := range []float64{0.0, 0.01, 0.04045, 0.1, 0.5, 0.9, 1.0} {
		linear := srgbEotf(x)
		gamma := srgbGamma(linear)
		if math.Abs(gamma-x) > 1e-4 {
			t.Errorf("sRGB roundtrip at %v: got %v", x, gamma)
		}
	}
}

func TestSrgbBoundaries(t *testing.T) {
	if srgbEotf(0.0) != 0.0 {
		t.Error("srgbEotf(0) != 0")
	}
	if math.Abs(srgbEotf(1.0)-1.0) > 1e-12 {
		t.Error("srgbEotf(1) != 1")
	}
	if srgbGamma(0.0) != 0.0 {
		t.Error("srgbGamma(0) != 0")
	}
	if math.Abs(srgbGamma(1.0)-1.0) > 1e-12 {
		t.Error("srgbGamma(1) != 1")
	}
}

func TestBt2020PqBoundaries(t *testing.T) {
	if bt2020PqEotf(0.0) != 0.0 {
		t.Error("bt2020PqEotf(0) != 0")
	}
	max := bt2020PqEotf(1.0)
	if max <= 0.9 || max >= 1.0 {
		t.Errorf("bt2020PqEotf(1.0) should be near 1.0, got %v", max)
	}
}

// ── unit-color.json ──────────────────────────────────────────────────────────

type colorTestInput struct {
	LinearRGB *[3]float64 `json:"linear_rgb"`
	GammaRGB  *[3]float64 `json:"gamma_rgb"`
	Gamut     string      `json:"gamut"`
}

type colorTestExpected struct {
	Oklab         [3]float64  `json:"oklab"`
	RoundtripSRGB *[3]float64 `json:"roundtrip_srgb"`
}

type colorTestCase struct {
	Name     string            `json:"name"`
	Input    colorTestInput    `json:"input"`
	Expected colorTestExpected `json:"expected"`
}

func gamutFromString(s string) Gamut {
	switch s {
	case "Display P3":
		return GamutDisplayP3
	case "Adobe RGB":
		return GamutAdobeRGB
	case "BT.2020":
		return GamutBT2020
	case "ProPhoto RGB":
		return GamutProPhotoRGB
	default:
		return GamutSRGB
	}
}

func TestUnitColor(t *testing.T) {
	data, err := os.ReadFile("../spec/test-vectors/unit-color.json")
	if err != nil {
		t.Skipf("unit-color.json not found: %v", err)
	}
	var cases []colorTestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse unit-color.json: %v", err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			g := gamutFromString(tc.Input.Gamut)
			var lab [3]float64
			if tc.Input.LinearRGB != nil {
				lab = linearRgbToOklab(*tc.Input.LinearRGB, g)
			} else if tc.Input.GammaRGB != nil {
				rgb := *tc.Input.GammaRGB
				lab = gammaRgbToOklab(rgb[0], rgb[1], rgb[2], g)
			}
			for i := 0; i < 3; i++ {
				if math.Abs(lab[i]-tc.Expected.Oklab[i]) > 1e-6 {
					t.Errorf("oklab[%d]: got %v, want %v", i, lab[i], tc.Expected.Oklab[i])
				}
			}
			if tc.Expected.RoundtripSRGB != nil {
				rt := oklabToLinearSrgb(lab)
				for i := 0; i < 3; i++ {
					if math.Abs(rt[i]-tc.Expected.RoundtripSRGB[i]) > 1e-6 {
						t.Errorf("roundtrip sRGB[%d]: got %v, want %v", i, rt[i], tc.Expected.RoundtripSRGB[i])
					}
				}
			}
		})
	}
}

// ── unit-mulaw.json ──────────────────────────────────────────────────────────

type mulawTestCase struct {
	Name  string `json:"name"`
	Input struct {
		Value float64 `json:"value"`
		Bits  uint    `json:"bits"`
	} `json:"input"`
	Expected struct {
		Compressed  float64 `json:"compressed"`
		Expanded    float64 `json:"expanded"`
		Quantized   int     `json:"quantized"`
		Dequantized float64 `json:"dequantized"`
	} `json:"expected"`
}

func TestUnitMulaw(t *testing.T) {
	data, err := os.ReadFile("../spec/test-vectors/unit-mulaw.json")
	if err != nil {
		t.Skipf("unit-mulaw.json not found: %v", err)
	}
	var cases []mulawTestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse unit-mulaw.json: %v", err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			c := muCompress(tc.Input.Value)
			if math.Abs(c-tc.Expected.Compressed) > 1e-12 {
				t.Errorf("compress(%v) = %v, want %v", tc.Input.Value, c, tc.Expected.Compressed)
			}
			e := muExpand(c)
			if math.Abs(e-tc.Expected.Expanded) > 1e-12 {
				t.Errorf("expand(%v) = %v, want %v", c, e, tc.Expected.Expanded)
			}
			q := muLawQuantize(tc.Input.Value, tc.Input.Bits)
			if q != tc.Expected.Quantized {
				t.Errorf("quantize(%v, %v) = %v, want %v", tc.Input.Value, tc.Input.Bits, q, tc.Expected.Quantized)
			}
			dq := muLawDequantize(q, tc.Input.Bits)
			if math.Abs(dq-tc.Expected.Dequantized) > 1e-12 {
				t.Errorf("dequantize(%v, %v) = %v, want %v", q, tc.Input.Bits, dq, tc.Expected.Dequantized)
			}
		})
	}
}

// ── unit-dct.json ─────────────────────────────────────────────────────────────

type dctTestCase struct {
	Name  string `json:"name"`
	Input struct {
		NX int `json:"nx"`
		NY int `json:"ny"`
	} `json:"input"`
	Expected struct {
		AcCount   int      `json:"ac_count"`
		ScanOrder [][2]int `json:"scan_order"`
	} `json:"expected"`
}

func TestUnitDCT(t *testing.T) {
	data, err := os.ReadFile("../spec/test-vectors/unit-dct.json")
	if err != nil {
		t.Skipf("unit-dct.json not found: %v", err)
	}
	var cases []dctTestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse unit-dct.json: %v", err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			order := triangularScanOrder(tc.Input.NX, tc.Input.NY)
			if len(order) != tc.Expected.AcCount {
				t.Errorf("scan order count = %v, want %v", len(order), tc.Expected.AcCount)
			}
			for i, pair := range order {
				if i >= len(tc.Expected.ScanOrder) {
					break
				}
				exp := tc.Expected.ScanOrder[i]
				if pair[0] != exp[0] || pair[1] != exp[1] {
					t.Errorf("scan[%d] = %v, want %v", i, pair, exp)
				}
			}
		})
	}
}

// ── unit-aspect.json ──────────────────────────────────────────────────────────

type aspectTestCase struct {
	Name  string `json:"name"`
	Input struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"input"`
	Expected struct {
		Byte         int     `json:"byte"`
		DecodedRatio float64 `json:"decoded_ratio"`
		OutputWidth  int     `json:"output_width"`
		OutputHeight int     `json:"output_height"`
	} `json:"expected"`
}

func TestUnitAspect(t *testing.T) {
	data, err := os.ReadFile("../spec/test-vectors/unit-aspect.json")
	if err != nil {
		t.Skipf("unit-aspect.json not found: %v", err)
	}
	var cases []aspectTestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse unit-aspect.json: %v", err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			b := encodeAspect(tc.Input.Width, tc.Input.Height)
			if b != tc.Expected.Byte {
				t.Errorf("encodeAspect(%v,%v) = %v, want %v", tc.Input.Width, tc.Input.Height, b, tc.Expected.Byte)
			}
			ratio := decodeAspect(b)
			if math.Abs(ratio-tc.Expected.DecodedRatio) > 1e-12 {
				t.Errorf("decodeAspect(%v) = %v, want %v", b, ratio, tc.Expected.DecodedRatio)
			}
			w, h := decodeOutputSize(b)
			if w != tc.Expected.OutputWidth || h != tc.Expected.OutputHeight {
				t.Errorf("decodeOutputSize(%v) = (%v,%v), want (%v,%v)", b, w, h, tc.Expected.OutputWidth, tc.Expected.OutputHeight)
			}
		})
	}
}

// ── bitpack roundtrip ─────────────────────────────────────────────────────────

func TestBitpackRoundtrip(t *testing.T) {
	buf := make([]byte, 4)
	writeBits(buf, 0, 8, 0xAB)
	if readBits(buf, 0, 8) != 0xAB {
		t.Error("basic roundtrip failed")
	}

	buf = make([]byte, 4)
	writeBits(buf, 3, 5, 0x1F)
	if readBits(buf, 3, 5) != 0x1F {
		t.Error("offset roundtrip failed")
	}

	buf = make([]byte, 4)
	writeBits(buf, 6, 8, 0xCA)
	if readBits(buf, 6, 8) != 0xCA {
		t.Error("cross-byte roundtrip failed")
	}
}

// ── integration-encode.json ──────────────────────────────────────────────────

type encodeTestCase struct {
	Name  string `json:"name"`
	Input struct {
		Width  int    `json:"width"`
		Height int    `json:"height"`
		Gamut  string `json:"gamut"`
		RGBA   []int  `json:"rgba"`
	} `json:"input"`
	Expected struct {
		Hash         []int  `json:"hash"`
		AverageColor [4]int `json:"average_color"`
	} `json:"expected"`
}

func TestIntegrationEncode(t *testing.T) {
	data, err := os.ReadFile("../spec/test-vectors/integration-encode.json")
	if err != nil {
		t.Skipf("integration-encode.json not found: %v", err)
	}
	var cases []encodeTestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse integration-encode.json: %v", err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			rgba := make([]byte, len(tc.Input.RGBA))
			for i, v := range tc.Input.RGBA {
				rgba[i] = byte(v)
			}
			ch := Encode(tc.Input.Width, tc.Input.Height, rgba, gamutFromString(tc.Input.Gamut))
			for i, want := range tc.Expected.Hash {
				if int(ch.Hash[i]) != want {
					t.Errorf("hash[%d] = %d, want %d", i, ch.Hash[i], want)
				}
			}
			r, g, b, a := ch.AverageColor()
			avg := [4]int{int(r), int(g), int(b), int(a)}
			for i := 0; i < 4; i++ {
				if avg[i] != tc.Expected.AverageColor[i] {
					t.Errorf("average_color[%d] = %d, want %d", i, avg[i], tc.Expected.AverageColor[i])
				}
			}
		})
	}
}

// ── integration-decode.json ──────────────────────────────────────────────────

type decodeTestCase struct {
	Name  string `json:"name"`
	Input struct {
		Hash []int `json:"hash"`
	} `json:"input"`
	Expected struct {
		Width  int   `json:"width"`
		Height int   `json:"height"`
		RGBA   []int `json:"rgba"`
	} `json:"expected"`
}

func TestIntegrationDecode(t *testing.T) {
	data, err := os.ReadFile("../spec/test-vectors/integration-decode.json")
	if err != nil {
		t.Skipf("integration-decode.json not found: %v", err)
	}
	var cases []decodeTestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse integration-decode.json: %v", err)
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			var hashBytes [32]byte
			for i, v := range tc.Input.Hash {
				hashBytes[i] = byte(v)
			}
			ch := FromBytes(hashBytes)
			w, h, rgba := ch.Decode()
			if w != tc.Expected.Width {
				t.Errorf("width = %d, want %d", w, tc.Expected.Width)
			}
			if h != tc.Expected.Height {
				t.Errorf("height = %d, want %d", h, tc.Expected.Height)
			}
			for i, want := range tc.Expected.RGBA {
				if int(rgba[i]) != want {
					t.Errorf("rgba[%d] = %d, want %d", i, rgba[i], want)
				}
			}
		})
	}
}

// ── property tests ────────────────────────────────────────────────────────────

func TestEncodeProduces32Bytes(t *testing.T) {
	rgba := solidImage(4, 4, 128, 128, 128, 255)
	ch := Encode(4, 4, rgba, GamutSRGB)
	if len(ch.Hash) != 32 {
		t.Errorf("hash length = %d, want 32", len(ch.Hash))
	}
}

func TestDeterministicEncoding(t *testing.T) {
	rgba := horizontalGradient(16, 16)
	ch1 := Encode(16, 16, rgba, GamutSRGB)
	ch2 := Encode(16, 16, rgba, GamutSRGB)
	if ch1.Hash != ch2.Hash {
		t.Error("encoding not deterministic")
	}
}

func TestFromBytesRoundtrip(t *testing.T) {
	rgba := solidImage(4, 4, 128, 64, 32, 255)
	ch := Encode(4, 4, rgba, GamutSRGB)
	ch2 := FromBytes(ch.Hash)
	if ch.Hash != ch2.Hash {
		t.Error("FromBytes roundtrip failed")
	}
}

func TestAllGamutsProduceOutput(t *testing.T) {
	rgba := solidImage(4, 4, 200, 100, 50, 255)
	gamuts := []Gamut{GamutSRGB, GamutDisplayP3, GamutAdobeRGB, GamutBT2020, GamutProPhotoRGB}
	for _, g := range gamuts {
		ch := Encode(4, 4, rgba, g)
		if len(ch.Hash) != 32 {
			t.Errorf("gamut %v: hash length = %d", g, len(ch.Hash))
		}
	}
}

func TestValidDecodeDimensions(t *testing.T) {
	rgba := solidImage(4, 4, 128, 64, 32, 255)
	ch := Encode(4, 4, rgba, GamutSRGB)
	w, h, pixels := ch.Decode()
	if w <= 0 || w > 32 {
		t.Errorf("decoded width out of range: %d", w)
	}
	if h <= 0 || h > 32 {
		t.Errorf("decoded height out of range: %d", h)
	}
	if len(pixels) != w*h*4 {
		t.Errorf("pixel data length mismatch: got %d, want %d", len(pixels), w*h*4)
	}
}

func TestSolidColorRoundtrip(t *testing.T) {
	rgba := solidImage(4, 4, 200, 100, 50, 255)
	ch := Encode(4, 4, rgba, GamutSRGB)
	r, g, b, a := ch.AverageColor()
	if absInt(int(r)-200) > 3 {
		t.Errorf("R: expected ~200, got %d", r)
	}
	if absInt(int(g)-100) > 3 {
		t.Errorf("G: expected ~100, got %d", g)
	}
	if absInt(int(b)-50) > 3 {
		t.Errorf("B: expected ~50, got %d", b)
	}
	if a != 255 {
		t.Errorf("A: expected 255, got %d", a)
	}
}

func TestGradientRoundtrip(t *testing.T) {
	rgba := horizontalGradient(16, 16)
	ch := Encode(16, 16, rgba, GamutSRGB)
	w, h, _ := ch.Decode()
	if w <= 0 || h <= 0 {
		t.Error("gradient decode produced zero dimensions")
	}
}

func TestVerticalGradientRoundtrip(t *testing.T) {
	rgba := verticalGradient(16, 16)
	ch := Encode(16, 16, rgba, GamutSRGB)
	w, h, _ := ch.Decode()
	if w <= 0 || h <= 0 {
		t.Error("vertical gradient decode produced zero dimensions")
	}
}

func TestTransparencyRoundtrip(t *testing.T) {
	w, h := 8, 8
	rgba := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			idx := (y*w + x) * 4
			if y < h/2 {
				rgba[idx] = 255
				rgba[idx+3] = 255
			} else {
				rgba[idx+3] = 0
			}
		}
	}
	ch := Encode(w, h, rgba, GamutSRGB)

	// Check has_alpha flag
	var header uint64
	for i := 0; i < 6; i++ {
		header |= uint64(ch.Hash[i]) << (i * 8)
	}
	hasAlpha := ((header >> 46) & 1) == 1
	if !hasAlpha {
		t.Error("semi-transparent image should have alpha flag")
	}

	dw, dh, pixels := ch.Decode()
	if dw <= 0 || dh <= 0 {
		t.Error("transparent decode produced zero dimensions")
	}
	aMin, aMax := byte(255), byte(0)
	for i := 3; i < len(pixels); i += 4 {
		if pixels[i] < aMin {
			aMin = pixels[i]
		}
		if pixels[i] > aMax {
			aMax = pixels[i]
		}
	}
	if aMax <= aMin {
		t.Error("alpha should vary across decoded image")
	}
}

func TestHasAlphaFlagOpaque(t *testing.T) {
	rgba := solidImage(4, 4, 128, 128, 128, 255)
	ch := Encode(4, 4, rgba, GamutSRGB)
	hasAlpha := (ch.Hash[5]>>6)&1 != 0
	if hasAlpha {
		t.Error("opaque image should not have alpha flag")
	}
}

func TestVariousAspectRatios(t *testing.T) {
	cases := [][2]int{{16, 4}, {4, 16}, {10, 10}, {3, 7}, {100, 25}}
	for _, wh := range cases {
		w, h := wh[0], wh[1]
		rgba := solidImage(w, h, 128, 64, 32, 255)
		ch := Encode(w, h, rgba, GamutSRGB)
		dw, dh, pixels := ch.Decode()
		if dw <= 0 || dh <= 0 {
			t.Errorf("%dx%d: decode produced zero dimensions", w, h)
		}
		if len(pixels) != dw*dh*4 {
			t.Errorf("%dx%d: pixel data length mismatch", w, h)
		}
	}
}
