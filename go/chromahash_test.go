package chromahash

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// The Go package is now a thin cgo wrapper over the chromahash-c C ABI, so these
// tests exercise the public API end-to-end against the shared spec vectors —
// the cross-language parity gate. Per-function unit tests of the algorithm live
// in the Rust core (the single source of truth).

// ── helpers (shared with batch_test.go / batch_bench_test.go) ─────────────────

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
		t.Fatalf("integration-encode.json not found: %v", err)
	}
	var cases []encodeTestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse integration-encode.json: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("no encode vectors found")
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
			if !ch.IsVersionSupported() {
				t.Error("freshly encoded hash must report v0.6 supported")
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
		t.Fatalf("integration-decode.json not found: %v", err)
	}
	var cases []decodeTestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse integration-decode.json: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("no decode vectors found")
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			var hashBytes [32]byte
			for i, v := range tc.Input.Hash {
				hashBytes[i] = byte(v)
			}
			w, h, rgba := FromBytes(hashBytes).Decode()
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

// ── integration-decode-capped.json ────────────────────────────────────────────

type cappedDecodeTestCase struct {
	Name  string `json:"name"`
	Input struct {
		Hash     []int `json:"hash"`
		MaxWidth int   `json:"max_width"`
		MaxHt    int   `json:"max_height"`
	} `json:"input"`
	Expected struct {
		Width  int   `json:"width"`
		Height int   `json:"height"`
		RGBA   []int `json:"rgba"`
	} `json:"expected"`
}

func TestIntegrationDecodeCapped(t *testing.T) {
	data, err := os.ReadFile("../spec/test-vectors/integration-decode-capped.json")
	if err != nil {
		t.Fatalf("integration-decode-capped.json not found: %v", err)
	}
	var cases []cappedDecodeTestCase
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("parse integration-decode-capped.json: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("no capped decode vectors found")
	}
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			var hashBytes [32]byte
			for i, v := range tc.Input.Hash {
				hashBytes[i] = byte(v)
			}
			w, h, rgba := FromBytes(hashBytes).DecodeCapped(tc.Input.MaxWidth, tc.Input.MaxHt)
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

// ── property tests ─────────────────────────────────────────────────────────────

func TestEncodeProduces32Bytes(t *testing.T) {
	ch := Encode(4, 4, solidImage(4, 4, 128, 128, 128, 255), GamutSRGB)
	if len(ch.Hash) != 32 {
		t.Errorf("hash length = %d, want 32", len(ch.Hash))
	}
}

func TestDeterministicEncoding(t *testing.T) {
	rgba := horizontalGradient(16, 16)
	if Encode(16, 16, rgba, GamutSRGB).Hash != Encode(16, 16, rgba, GamutSRGB).Hash {
		t.Error("encoding not deterministic")
	}
}

func TestFromBytesRoundtrip(t *testing.T) {
	ch := Encode(4, 4, solidImage(4, 4, 128, 64, 32, 255), GamutSRGB)
	if FromBytes(ch.Hash).Hash != ch.Hash {
		t.Error("FromBytes roundtrip failed")
	}
}

func TestAllGamutsProduceOutput(t *testing.T) {
	rgba := solidImage(4, 4, 200, 100, 50, 255)
	for _, g := range []Gamut{GamutSRGB, GamutDisplayP3, GamutAdobeRGB, GamutBT2020, GamutProPhotoRGB} {
		if len(Encode(4, 4, rgba, g).Hash) != 32 {
			t.Errorf("gamut %v: did not produce 32 bytes", g)
		}
	}
}

func TestValidDecodeDimensions(t *testing.T) {
	ch := Encode(4, 4, solidImage(4, 4, 128, 64, 32, 255), GamutSRGB)
	w, h, pixels := ch.Decode()
	if w <= 0 || w > 32 || h <= 0 || h > 32 {
		t.Errorf("decoded dims out of range: %dx%d", w, h)
	}
	if len(pixels) != w*h*4 {
		t.Errorf("pixel length %d, want %d", len(pixels), w*h*4)
	}
}

func TestVerticalGradientDecodes(t *testing.T) {
	ch := Encode(16, 16, verticalGradient(16, 16), GamutSRGB)
	if w, h, _ := ch.Decode(); w <= 0 || h <= 0 {
		t.Errorf("vertical gradient decode produced %dx%d", w, h)
	}
}

func TestVersionSupportedForLegacyHash(t *testing.T) {
	ch := Encode(4, 4, solidImage(4, 4, 128, 128, 128, 255), GamutSRGB)
	if !ch.IsVersionSupported() {
		t.Error("v0.6 hash must be supported")
	}
	// Flip header bit 47 to simulate a legacy v0.2–v0.5 hash.
	legacy := ch.Hash
	legacy[5] |= 0x80
	if FromBytes(legacy).IsVersionSupported() {
		t.Error("bit 47 = 1 must be reported as unsupported")
	}
}
