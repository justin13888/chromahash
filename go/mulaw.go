package chromahash

import "math"

// muCompress applies µ-law compression: value in [-1,1] → compressed in [-1,1].
func muCompress(value float64) float64 {
	v := clampNeg1To1(value)
	return math.Copysign(math.Log(1.0+mu*math.Abs(v))/math.Log(1.0+mu), v)
}

// muExpand applies µ-law expansion: compressed in [-1,1] → value in [-1,1].
func muExpand(compressed float64) float64 {
	return math.Copysign((math.Pow(1.0+mu, math.Abs(compressed))-1.0)/mu, compressed)
}

// muLawQuantize quantizes a value in [-1,1] using µ-law to an integer index.
// Per spec §12.7 muLawQuantize.
func muLawQuantize(value float64, bits uint) int {
	compressed := muCompress(value)
	maxVal := (1 << bits) - 1
	index := int(roundHalfAwayFromZero((compressed + 1.0) / 2.0 * float64(maxVal)))
	if index < 0 {
		return 0
	}
	if index > maxVal {
		return maxVal
	}
	return index
}

// muLawDequantize dequantizes an integer index back to a value in [-1,1].
// Per spec §12.7 muLawDequantize.
func muLawDequantize(index int, bits uint) float64 {
	maxVal := (1 << bits) - 1
	compressed := float64(index)/float64(maxVal)*2.0 - 1.0
	return muExpand(compressed)
}
