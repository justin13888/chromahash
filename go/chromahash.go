// Package chromahash implements the ChromaHash LQIP (Low Quality Image
// Placeholder) format — a fixed 32-byte representation of an image.
package chromahash

// ChromaHash is a 32-byte LQIP representation of an image.
type ChromaHash struct {
	Hash [32]byte
}

// Encode encodes an RGBA image into a ChromaHash.
//
// w, h are the image dimensions (>=1 each).
// rgba is the pixel data in RGBA format (4 bytes per pixel, row-major).
// gamut is the source color space.
//
// Panics if dimensions are out of range or rgba length doesn't match.
func Encode(w, h int, rgba []byte, gamut Gamut) ChromaHash {
	if w < 1 {
		panic("chromahash: width must be >= 1")
	}
	if h < 1 {
		panic("chromahash: height must be >= 1")
	}
	if len(rgba) != w*h*4 {
		panic("chromahash: rgba length mismatch")
	}

	pixelCount := w * h

	// 1-2. Convert all pixels to OKLAB, accumulate alpha-weighted average.
	oklabPixels := make([][3]float64, pixelCount)
	alphaPixels := make([]float64, pixelCount)
	avgL, avgA, avgB, avgAlpha := 0.0, 0.0, 0.0, 0.0

	for i := 0; i < pixelCount; i++ {
		r := float64(rgba[i*4]) / 255.0
		g := float64(rgba[i*4+1]) / 255.0
		b := float64(rgba[i*4+2]) / 255.0
		a := float64(rgba[i*4+3]) / 255.0

		lab := gammaRgbToOklab(r, g, b, gamut)

		avgL += a * lab[0]
		avgA += a * lab[1]
		avgB += a * lab[2]
		avgAlpha += a

		oklabPixels[i] = lab
		alphaPixels[i] = a
	}

	// 3. Compute alpha-weighted average color.
	if avgAlpha > 0.0 {
		avgL /= avgAlpha
		avgA /= avgAlpha
		avgB /= avgAlpha
	}

	// 4. Composite transparent pixels over average.
	hasAlpha := avgAlpha < float64(pixelCount)
	lChan := make([]float64, pixelCount)
	aChan := make([]float64, pixelCount)
	bChan := make([]float64, pixelCount)

	for i := 0; i < pixelCount; i++ {
		alpha := alphaPixels[i]
		lChan[i] = avgL*(1.0-alpha) + alpha*oklabPixels[i][0]
		aChan[i] = avgA*(1.0-alpha) + alpha*oklabPixels[i][1]
		bChan[i] = avgB*(1.0-alpha) + alpha*oklabPixels[i][2]
	}

	// 5. Derive adaptive grid dimensions (v0.2).
	aspectByte := encodeAspect(w, h)
	lBaseN := 7
	if hasAlpha {
		lBaseN = 6
	}
	lNx, lNy := deriveGrid(aspectByte, lBaseN)
	cNx, cNy := deriveGrid(aspectByte, 4)
	alphaNx, alphaNy := 3, 3
	if hasAlpha {
		alphaNx, alphaNy = deriveGrid(aspectByte, 3)
	}

	// 6. DCT encode each channel.
	lDC, lACRaw, lScale := dctEncode(lChan, w, h, lNx, lNy)
	aDC, aACRaw, aScale := dctEncode(aChan, w, h, cNx, cNy)
	bDC, bACRaw, bScale := dctEncode(bChan, w, h, cNx, cNy)

	var alphaDC, alphaScale float64
	var alphaACRaw []float64
	if hasAlpha {
		alphaDC, alphaACRaw, alphaScale = dctEncode(alphaPixels, w, h, alphaNx, alphaNy)
	}

	// Cap to bit budget and zero-pad (per spec §10).
	lCap := 27
	if hasAlpha {
		lCap = 20
	}
	lAC := make([]float64, lCap)
	copy(lAC, lACRaw)
	aAC := make([]float64, 9)
	copy(aAC, aACRaw)
	bAC := make([]float64, 9)
	copy(bAC, bACRaw)
	var alphaAC []float64
	if hasAlpha {
		alphaAC = make([]float64, 5)
		copy(alphaAC, alphaACRaw)
	}

	// 7. Quantize header values.
	lDCQ := uint64(roundHalfAwayFromZero(127.0 * clamp01(lDC)))
	aDCQ := uint64(roundHalfAwayFromZero(64.0 + 63.0*clampNeg1To1(aDC/maxChromaA)))
	bDCQ := uint64(roundHalfAwayFromZero(64.0 + 63.0*clampNeg1To1(bDC/maxChromaB)))
	lSclQ := uint64(roundHalfAwayFromZero(63.0 * clamp01(lScale/maxLScale)))
	aSclQ := uint64(roundHalfAwayFromZero(63.0 * clamp01(aScale/maxAScale)))
	bSclQ := uint64(roundHalfAwayFromZero(31.0 * clamp01(bScale/maxBScale)))

	// Aspect byte already computed above.
	aspect := uint64(aspectByte)

	// 8. Pack header (48 bits = 6 bytes), little-endian.
	hasAlphaFlag := uint64(0)
	if hasAlpha {
		hasAlphaFlag = 1
	}
	header := lDCQ |
		(aDCQ << 7) |
		(bDCQ << 14) |
		(lSclQ << 21) |
		(aSclQ << 27) |
		(bSclQ << 33) |
		(aspect << 38) |
		(hasAlphaFlag << 46) |
		(1 << 47) // version bit = 1 (v0.2+)

	var hash [32]byte
	for i := 0; i < 6; i++ {
		hash[i] = byte((header >> (i * 8)) & 0xFF)
	}

	// 9. Pack AC coefficients with µ-law companding.
	bitpos := 48

	quantizeAC := func(value, scale float64, bits uint) int {
		if scale == 0.0 {
			return muLawQuantize(0.0, bits)
		}
		return muLawQuantize(value/scale, bits)
	}

	if hasAlpha {
		alphaDCQ := int(roundHalfAwayFromZero(31.0 * clamp01(alphaDC)))
		alphaSclQ := int(roundHalfAwayFromZero(15.0 * clamp01(alphaScale/maxAAlphaScale)))
		writeBits(hash[:], bitpos, 5, alphaDCQ)
		bitpos += 5
		writeBits(hash[:], bitpos, 4, alphaSclQ)
		bitpos += 4

		// L AC: first 7 at 6 bits, remaining 13 at 5 bits
		for _, v := range lAC[:7] {
			q := quantizeAC(v, lScale, 6)
			writeBits(hash[:], bitpos, 6, q)
			bitpos += 6
		}
		for _, v := range lAC[7:20] {
			q := quantizeAC(v, lScale, 5)
			writeBits(hash[:], bitpos, 5, q)
			bitpos += 5
		}
	} else {
		// L AC: all 27 at 5 bits
		for _, v := range lAC[:27] {
			q := quantizeAC(v, lScale, 5)
			writeBits(hash[:], bitpos, 5, q)
			bitpos += 5
		}
	}

	// a AC: 9 at 4 bits
	for _, v := range aAC {
		q := quantizeAC(v, aScale, 4)
		writeBits(hash[:], bitpos, 4, q)
		bitpos += 4
	}

	// b AC: 9 at 4 bits
	for _, v := range bAC {
		q := quantizeAC(v, bScale, 4)
		writeBits(hash[:], bitpos, 4, q)
		bitpos += 4
	}

	if hasAlpha {
		// Alpha AC: 5 at 4 bits
		for _, v := range alphaAC {
			q := quantizeAC(v, alphaScale, 4)
			writeBits(hash[:], bitpos, 4, q)
			bitpos += 4
		}
	}

	_ = bitpos
	return ChromaHash{Hash: hash}
}

// FromBytes creates a ChromaHash directly from a raw 32-byte array.
func FromBytes(b [32]byte) ChromaHash {
	return ChromaHash{Hash: b}
}

// Decode decodes the ChromaHash into an RGBA image.
// Returns width, height, and RGBA pixel data (row-major, 4 bytes per pixel).
func (ch ChromaHash) Decode() (int, int, []byte) {
	hash := ch.Hash[:]

	// 1. Unpack header (48 bits).
	var header uint64
	for i := 0; i < 6; i++ {
		header |= uint64(hash[i]) << (i * 8)
	}

	lDCQ := int(header & 0x7F)
	aDCQ := int((header >> 7) & 0x7F)
	bDCQ := int((header >> 14) & 0x7F)
	lSclQ := int((header >> 21) & 0x3F)
	aSclQ := int((header >> 27) & 0x3F)
	bSclQ := int((header >> 33) & 0x1F)
	aspect := int((header >> 38) & 0xFF)
	hasAlpha := ((header >> 46) & 1) == 1

	// 2. Decode DC values and scale factors.
	lDC := float64(lDCQ) / 127.0
	aDC := (float64(aDCQ) - 64.0) / 63.0 * maxChromaA
	bDC := (float64(bDCQ) - 64.0) / 63.0 * maxChromaB
	lScale := float64(lSclQ) / 63.0 * maxLScale
	aScale := float64(aSclQ) / 63.0 * maxAScale
	bScale := float64(bSclQ) / 31.0 * maxBScale

	// 3-4. Decode aspect ratio and compute output size.
	w, h := decodeOutputSize(aspect)

	// 5. Dequantize AC coefficients.
	bitpos := 48

	alphaDCVal := 1.0
	alphaScaleVal := 0.0
	if hasAlpha {
		alphaDCVal = float64(readBits(hash, bitpos, 5)) / 31.0
		bitpos += 5
		alphaScaleVal = float64(readBits(hash, bitpos, 4)) / 15.0 * maxAAlphaScale
		bitpos += 4
	}

	var lAC []float64
	if hasAlpha {
		lAC = make([]float64, 0, 20)
		for i := 0; i < 7; i++ {
			q := readBits(hash, bitpos, 6)
			bitpos += 6
			lAC = append(lAC, muLawDequantize(q, 6)*lScale)
		}
		for i := 7; i < 20; i++ {
			q := readBits(hash, bitpos, 5)
			bitpos += 5
			lAC = append(lAC, muLawDequantize(q, 5)*lScale)
		}
	} else {
		lAC = make([]float64, 0, 27)
		for i := 0; i < 27; i++ {
			q := readBits(hash, bitpos, 5)
			bitpos += 5
			lAC = append(lAC, muLawDequantize(q, 5)*lScale)
		}
	}

	aAC := make([]float64, 0, 9)
	for i := 0; i < 9; i++ {
		q := readBits(hash, bitpos, 4)
		bitpos += 4
		aAC = append(aAC, muLawDequantize(q, 4)*aScale)
	}

	bAC := make([]float64, 0, 9)
	for i := 0; i < 9; i++ {
		q := readBits(hash, bitpos, 4)
		bitpos += 4
		bAC = append(bAC, muLawDequantize(q, 4)*bScale)
	}

	var alphaAC []float64
	if hasAlpha {
		alphaAC = make([]float64, 0, 5)
		for i := 0; i < 5; i++ {
			q := readBits(hash, bitpos, 4)
			bitpos += 4
			alphaAC = append(alphaAC, muLawDequantize(q, 4)*alphaScaleVal)
		}
	}

	// Derive adaptive grid and compute usable scan orders (v0.2).
	lDecCap := 27
	if hasAlpha {
		lDecCap = 20
	}
	lBaseN := 7
	if hasAlpha {
		lBaseN = 6
	}
	lNx, lNy := deriveGrid(aspect, lBaseN)
	cNx, cNy := deriveGrid(aspect, 4)

	lScanFull := triangularScanOrder(lNx, lNy)
	lUsable := lDecCap
	if len(lScanFull) < lUsable {
		lUsable = len(lScanFull)
	}
	lScan := lScanFull[:lUsable]
	lACUsed := lAC[:lUsable]

	chromaScanFull := triangularScanOrder(cNx, cNy)
	cUsable := 9
	if len(chromaScanFull) < cUsable {
		cUsable = len(chromaScanFull)
	}
	chromaScan := chromaScanFull[:cUsable]
	aACUsed := aAC[:cUsable]
	bACUsed := bAC[:cUsable]

	var alphaScan [][2]int
	var alphaACUsed []float64
	if hasAlpha {
		aNx, aNy := deriveGrid(aspect, 3)
		alphaScanFull := triangularScanOrder(aNx, aNy)
		aUsable := 5
		if len(alphaScanFull) < aUsable {
			aUsable = len(alphaScanFull)
		}
		alphaScan = alphaScanFull[:aUsable]
		alphaACUsed = alphaAC[:aUsable]
	}

	// 6. Render output image.
	rgba := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			l := dctDecodePixel(lDC, lACUsed, lScan, x, y, w, h)
			a := dctDecodePixel(aDC, aACUsed, chromaScan, x, y, w, h)
			b := dctDecodePixel(bDC, bACUsed, chromaScan, x, y, w, h)
			var alpha float64
			if hasAlpha {
				alpha = dctDecodePixel(alphaDCVal, alphaACUsed, alphaScan, x, y, w, h)
			} else {
				alpha = 1.0
			}

			// Clamp L from DCT ringing, soft gamut clamp (v0.2).
			lClamped := clamp01(l)
			clamped := softGamutClamp(lClamped, a, b)
			rgbLin := oklabToLinearSrgb(clamped)
			idx := (y*w + x) * 4
			rgba[idx] = linearToSrgb8(clamp01(rgbLin[0]))
			rgba[idx+1] = linearToSrgb8(clamp01(rgbLin[1]))
			rgba[idx+2] = linearToSrgb8(clamp01(rgbLin[2]))
			rgba[idx+3] = byte(int(roundHalfAwayFromZero(255.0 * clamp01(alpha))))
		}
	}

	return w, h, rgba
}

// AverageColor extracts the average color from the ChromaHash without a full decode.
// Returns r, g, b, a as uint8 values. Per spec §11.2.
func (ch ChromaHash) AverageColor() (r, g, b, a uint8) {
	hash := ch.Hash[:]

	var header uint64
	for i := 0; i < 6; i++ {
		header |= uint64(hash[i]) << (i * 8)
	}

	lDCQ := int(header & 0x7F)
	aDCQ := int((header >> 7) & 0x7F)
	bDCQ := int((header >> 14) & 0x7F)
	hasAlpha := ((header >> 46) & 1) == 1

	lDC := float64(lDCQ) / 127.0
	aDC := (float64(aDCQ) - 64.0) / 63.0 * maxChromaA
	bDC := (float64(bDCQ) - 64.0) / 63.0 * maxChromaB

	// Apply soft gamut clamp to DC values (v0.2).
	lClamped := clamp01(lDC)
	clamped := softGamutClamp(lClamped, aDC, bDC)
	rgbLin := oklabToLinearSrgb(clamped)

	var alphaF float64
	if hasAlpha {
		alphaF = float64(readBits(hash, 48, 5)) / 31.0
	} else {
		alphaF = 1.0
	}

	r = linearToSrgb8(clamp01(rgbLin[0]))
	g = linearToSrgb8(clamp01(rgbLin[1]))
	b = linearToSrgb8(clamp01(rgbLin[2]))
	a = byte(int(roundHalfAwayFromZero(255.0 * clamp01(alphaF))))
	return
}
