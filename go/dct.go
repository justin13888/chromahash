package chromahash

import "math"

// triangularScanOrder computes the AC scan order for an nx×ny DCT grid.
// Per spec §6.6: row-major, condition cx*ny < nx*(ny-cy), skip DC (0,0).
func triangularScanOrder(nx, ny int) [][2]int {
	var order [][2]int
	for cy := 0; cy < ny; cy++ {
		cxStart := 0
		if cy == 0 {
			cxStart = 1
		}
		for cx := cxStart; cx*ny < nx*(ny-cy); cx++ {
			order = append(order, [2]int{cx, cy})
		}
	}
	return order
}

// dctEncode performs forward DCT encoding for a channel.
// Per spec §12.7 dctEncode.
// Returns (dc, ac_coefficients, scale).
func dctEncode(channel []float64, w, h, nx, ny int) (float64, []float64, float64) {
	wh := float64(w * h)
	dc := 0.0
	var ac []float64
	scale := 0.0

	for cy := 0; cy < ny; cy++ {
		cxStart := 0
		if cy == 0 {
			cxStart = 0
		}
		_ = cxStart
		for cx := 0; cx*ny < nx*(ny-cy); cx++ {
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
			if cx > 0 || cy > 0 {
				ac = append(ac, f)
				if math.Abs(f) > scale {
					scale = math.Abs(f)
				}
			} else {
				dc = f
			}
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
