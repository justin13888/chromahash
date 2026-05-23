package chromahash

import (
	"math"
	"sort"
)

// scanOrder computes the AC coefficient scan order for an nx×ny grid keyed on aspectByte.
// Per spec §6.2 (v0.4): coefficients are sorted ascending by per-pixel frequency priority
// `(cx*h)² + (cy*w)²` where (w,h) = decodeOutputSize(aspectByte).
// Ties broken by (cx, cy). Excludes DC at (0,0).
func scanOrder(nx, ny, aspectByte int) [][2]int {
	w, h := decodeOutputSize(aspectByte)

	type entry struct {
		priority uint64
		cx, cy   int
	}
	var entries []entry
	for cy := 0; cy < ny; cy++ {
		cxStart := 0
		if cy == 0 {
			cxStart = 1
		}
		for cx := cxStart; cx*ny < nx*(ny-cy); cx++ {
			a := uint64(cx) * uint64(h)
			b := uint64(cy) * uint64(w)
			entries = append(entries, entry{a*a + b*b, cx, cy})
		}
	}

	sort.SliceStable(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.priority != b.priority {
			return a.priority < b.priority
		}
		if a.cx != b.cx {
			return a.cx < b.cx
		}
		return a.cy < b.cy
	})

	order := make([][2]int, len(entries))
	for i, e := range entries {
		order[i] = [2]int{e.cx, e.cy}
	}
	return order
}

// dctEncode performs forward DCT encoding for a channel.
// Per spec §12.6 dctEncode (v0.4). AC values are emitted in `scan` order.
// Returns (dc, ac_coefficients, scale).
func dctEncode(channel []float64, w, h int, scan [][2]int) (float64, []float64, float64) {
	wh := float64(w * h)

	// DC = mean (cos(0)=1 everywhere)
	dc := 0.0
	for _, v := range channel {
		dc += v
	}
	dc /= wh

	ac := make([]float64, 0, len(scan))
	scale := 0.0
	for _, pair := range scan {
		cx, cy := pair[0], pair[1]
		f := 0.0
		for y := 0; y < h; y++ {
			fy := portableCos(math.Pi / float64(h) * float64(cy) * (float64(y) + 0.5))
			for x := 0; x < w; x++ {
				f += channel[x+y*w] *
					portableCos(math.Pi/float64(w)*float64(cx)*(float64(x)+0.5)) *
					fy
			}
		}
		f /= wh
		ac = append(ac, f)
		if math.Abs(f) > scale {
			scale = math.Abs(f)
		}
	}

	// Floor near-zero scale to exactly zero. When the channel is (near-)constant,
	// floating-point noise in cosine sums produces tiny AC values. Without this
	// threshold, dividing AC/scale amplifies platform-specific ULP differences
	// into divergent quantized codes.
	if scale < 1e-10 {
		for i := range ac {
			ac[i] = 0.0
		}
		scale = 0.0
	}

	return dc, ac, scale
}

// dctDecodePixel reconstructs a single pixel value using inverse DCT.
func dctDecodePixel(dc float64, ac []float64, scanOrder [][2]int, x, y, w, h int) float64 {
	value := dc
	for j, pair := range scanOrder {
		cx := pair[0]
		cy := pair[1]
		cxFactor := 1.0
		if cx > 0 {
			cxFactor = 2.0
		}
		cyFactor := 1.0
		if cy > 0 {
			cyFactor = 2.0
		}
		fx := portableCos(math.Pi / float64(w) * float64(cx) * (float64(x) + 0.5))
		fy := portableCos(math.Pi / float64(h) * float64(cy) * (float64(y) + 0.5))
		value += ac[j] * fx * fy * cxFactor * cyFactor
	}
	return value
}
