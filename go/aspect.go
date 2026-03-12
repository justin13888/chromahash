package chromahash

import "math"

// encodeAspect encodes an aspect ratio as a single byte. Per spec §8.1.
func encodeAspect(w, h int) int {
	ratio := float64(w) / float64(h)
	raw := (math.Log2(ratio) + 2.0) / 4.0 * 255.0
	b := int(roundHalfAwayFromZero(raw))
	if b < 0 {
		return 0
	}
	if b > 255 {
		return 255
	}
	return b
}

// decodeAspect decodes an aspect ratio from a byte. Per spec §8.1.
func decodeAspect(b int) float64 {
	return math.Pow(2.0, float64(b)/255.0*4.0-2.0)
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
