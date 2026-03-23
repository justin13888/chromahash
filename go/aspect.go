package chromahash

import "math"

// deriveGrid derives the adaptive DCT grid (nx, ny) from aspect byte and baseN. Per spec §3.2.
func deriveGrid(aspectByte, baseN int) (int, int) {
	ratio := portablePow(2.0, float64(aspectByte)/255.0*8.0-4.0)
	base := float64(baseN)
	var nx, ny int
	if ratio >= 1.0 {
		scale := math.Min(ratio, 16.0)
		s := portablePow(scale, 0.25)
		nx = int(roundHalfAwayFromZero(base * s))
		ny = int(roundHalfAwayFromZero(base / s))
	} else {
		scale := math.Min(1.0/ratio, 16.0)
		s := portablePow(scale, 0.25)
		nx = int(roundHalfAwayFromZero(base / s))
		ny = int(roundHalfAwayFromZero(base * s))
	}
	if nx < 3 {
		nx = 3
	}
	if ny < 3 {
		ny = 3
	}
	return nx, ny
}

// encodeAspect encodes an aspect ratio as a single byte. Per spec §8.1 (v0.3).
func encodeAspect(w, h int) int {
	ratio := float64(w) / float64(h)
	raw := (math.Log2(ratio) + 4.0) / 8.0 * 255.0
	b := int(roundHalfAwayFromZero(raw))
	if b < 0 {
		return 0
	}
	if b > 255 {
		return 255
	}
	return b
}

// decodeAspect decodes an aspect ratio from a byte. Per spec §8.1 (v0.3).
func decodeAspect(b int) float64 {
	return math.Pow(2.0, float64(b)/255.0*8.0-4.0)
}

// decodeOutputSize decodes output dimensions from an aspect byte.
// The longer side is 32 pixels. Per spec §8.4.
func decodeOutputSize(b int) (int, int) {
	ratio := decodeAspect(b)
	if ratio > 1.0 {
		h := int(math.Max(roundHalfAwayFromZero(32.0/ratio), 1.0))
		return 32, h
	}
	w := int(math.Max(roundHalfAwayFromZero(32.0*ratio), 1.0))
	return w, 32
}
