package chromahash

import (
	"strconv"
	"testing"
)

// benchN is the number of images encoded per benchmark iteration.
const benchN = 2000

// benchImages builds a workload with varied size, content, gamut, and alpha so
// it resembles a real bulk job rather than a single hot cache line.
func benchImages(n int) []ImageInput {
	gamuts := []Gamut{GamutSRGB, GamutDisplayP3, GamutAdobeRGB, GamutBT2020, GamutProPhotoRGB}
	items := make([]ImageInput, n)
	for i := 0; i < n; i++ {
		w := 24 + i%40
		h := 24 + (i*7)%40
		rgba := make([]byte, w*h*4)
		for p := 0; p < w*h; p++ {
			rgba[p*4] = byte((p*3 + i) % 256)
			rgba[p*4+1] = byte((p*5 + i*2) % 256)
			rgba[p*4+2] = byte((p*7 + i*3) % 256)
			if i%3 == 0 {
				rgba[p*4+3] = 200
			} else {
				rgba[p*4+3] = 255
			}
		}
		// Explicit: Go has no way to leave a struct field unset, and the tier
		// codes are ordered by quality — so an omitted Quality is CompactTier,
		// and this benchmark would compare a 21-byte batch against the 32-byte
		// serial encode below.
		items[i] = ImageInput{
			W: w, H: h, Rgba: rgba, Gamut: gamuts[i%len(gamuts)], Quality: DefaultTier,
		}
	}
	return items
}

// BenchmarkSerialEncode is the baseline: a plain loop of per-image Encode calls.
func BenchmarkSerialEncode(b *testing.B) {
	items := benchImages(benchN)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, it := range items {
			_ = EncodeWithQuality(it.W, it.H, it.Rgba, it.Gamut, it.Quality)
		}
	}
	b.ReportMetric(float64(benchN*b.N)/b.Elapsed().Seconds(), "img/s")
}

// BenchmarkBatchEncode measures the parallel batch path at the default
// (NumCPU) worker count.
func BenchmarkBatchEncode(b *testing.B) {
	items := benchImages(benchN)
	be := NewBatchEncoder()
	defer be.Close()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = be.EncodeBatch(items)
	}
	b.ReportMetric(float64(benchN*b.N)/b.Elapsed().Seconds(), "img/s")
}

// BenchmarkBatchEncodeScaling sweeps the worker count to show scaling.
func BenchmarkBatchEncodeScaling(b *testing.B) {
	items := benchImages(benchN)
	for _, n := range []int{1, 2, 4, 8} {
		b.Run("threads="+strconv.Itoa(n), func(b *testing.B) {
			be := NewBatchEncoderN(n)
			defer be.Close()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_ = be.EncodeBatch(items)
			}
			b.ReportMetric(float64(benchN*b.N)/b.Elapsed().Seconds(), "img/s")
		})
	}
}
