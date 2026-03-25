package chromahash

/**
 * ChromaHash: modern, high-quality image placeholder representation.
 * A 32-byte LQIP (Low Quality Image Placeholder).
 */
class ChromaHash private constructor(
    /** The raw 32-byte hash data. */
    val hash: ByteArray,
) {
    companion object {
        /**
         * Encode an image into a ChromaHash.
         *
         * @param w image width (must be >= 1)
         * @param h image height (must be >= 1)
         * @param rgba pixel data in RGBA format (4 bytes per pixel)
         * @param gamut source color space
         */
        fun encode(
            w: Int,
            h: Int,
            rgba: ByteArray,
            gamut: Gamut,
        ): ChromaHash {
            require(w >= 1) { "width must be >= 1" }
            require(h >= 1) { "height must be >= 1" }
            require(rgba.size == w * h * 4) { "rgba length mismatch" }

            val pixelCount = w * h

            // 1-2. Convert all pixels to OKLAB, accumulate alpha-weighted average
            val oklabPixels = Array(pixelCount) { DoubleArray(3) }
            val alphaPixels = DoubleArray(pixelCount)
            var avgL = 0.0
            var avgA = 0.0
            var avgB = 0.0
            var avgAlpha = 0.0

            for (i in 0 until pixelCount) {
                val r = (rgba[i * 4].toInt() and 0xFF).toDouble() / 255.0
                val g = (rgba[i * 4 + 1].toInt() and 0xFF).toDouble() / 255.0
                val b = (rgba[i * 4 + 2].toInt() and 0xFF).toDouble() / 255.0
                val a = (rgba[i * 4 + 3].toInt() and 0xFF).toDouble() / 255.0

                val lab = gammaRgbToOklab(r, g, b, gamut)

                avgL += a * lab[0]
                avgA += a * lab[1]
                avgB += a * lab[2]
                avgAlpha += a

                oklabPixels[i] = lab
                alphaPixels[i] = a
            }

            // 3. Compute alpha-weighted average color
            if (avgAlpha > 0.0) {
                avgL /= avgAlpha
                avgA /= avgAlpha
                avgB /= avgAlpha
            }

            // 4. Composite transparent pixels over average
            val hasAlpha = avgAlpha < pixelCount.toDouble()
            val lChan = DoubleArray(pixelCount)
            val aChan = DoubleArray(pixelCount)
            val bChan = DoubleArray(pixelCount)

            for (i in 0 until pixelCount) {
                val alpha = alphaPixels[i]
                lChan[i] = avgL * (1.0 - alpha) + alpha * oklabPixels[i][0]
                aChan[i] = avgA * (1.0 - alpha) + alpha * oklabPixels[i][1]
                bChan[i] = avgB * (1.0 - alpha) + alpha * oklabPixels[i][2]
            }

            // 5. Derive adaptive grid dimensions (v0.2)
            val aspectByte = encodeAspect(w, h)
            val (lNx, lNy) = deriveGrid(aspectByte, if (hasAlpha) 6 else 7)
            val (cNx, cNy) = deriveGrid(aspectByte, 4)
            val (alphaNx, alphaNy) = if (hasAlpha) deriveGrid(aspectByte, 3) else Pair(3, 3)

            // 6. DCT encode each channel
            val (lDc, lAcRaw, lScale) = dctEncode(lChan, w, h, lNx, lNy)
            val (aDc, aAcRaw, aScale) = dctEncode(aChan, w, h, cNx, cNy)
            val (bDc, bAcRaw, bScale) = dctEncode(bChan, w, h, cNx, cNy)
            val (alphaDc, alphaAcRaw, alphaScale) =
                if (hasAlpha) {
                    dctEncode(alphaPixels, w, h, alphaNx, alphaNy)
                } else {
                    Triple(0.0, DoubleArray(0), 0.0)
                }

            // Cap to bit budget and zero-pad (per spec §10)
            val lCap = if (hasAlpha) 20 else 27
            val lAc = DoubleArray(lCap) { i -> if (i < lAcRaw.size) lAcRaw[i] else 0.0 }
            val aAc = DoubleArray(9) { i -> if (i < aAcRaw.size) aAcRaw[i] else 0.0 }
            val bAc = DoubleArray(9) { i -> if (i < bAcRaw.size) bAcRaw[i] else 0.0 }
            val alphaAc =
                if (hasAlpha) {
                    DoubleArray(5) { i -> if (i < alphaAcRaw.size) alphaAcRaw[i] else 0.0 }
                } else {
                    DoubleArray(0)
                }

            // 7. Quantize header values
            val lDcQ = roundHalfAwayFromZero(127.0 * clamp01(lDc)).toLong()
            val aDcQ = roundHalfAwayFromZero(64.0 + 63.0 * clampNeg1To1(aDc / MAX_CHROMA_A)).toLong()
            val bDcQ = roundHalfAwayFromZero(64.0 + 63.0 * clampNeg1To1(bDc / MAX_CHROMA_B)).toLong()
            val lSclQ = roundHalfAwayFromZero(63.0 * clamp01(lScale / MAX_L_SCALE)).toLong()
            val aSclQ = roundHalfAwayFromZero(63.0 * clamp01(aScale / MAX_A_SCALE)).toLong()
            val bSclQ = roundHalfAwayFromZero(31.0 * clamp01(bScale / MAX_B_SCALE)).toLong()

            // Aspect byte already computed above
            val aspect = aspectByte.toLong()

            // 8. Pack header (48 bits = 6 bytes)
            val header: Long =
                lDcQ or
                    (aDcQ shl 7) or
                    (bDcQ shl 14) or
                    (lSclQ shl 21) or
                    (aSclQ shl 27) or
                    (bSclQ shl 33) or
                    (aspect shl 38) or
                    (if (hasAlpha) 1L shl 46 else 0L) or
                    (1L shl 47) // version bit = 1 (v0.2+)

            val hashBytes = ByteArray(32)
            for (i in 0 until 6) {
                hashBytes[i] = ((header ushr (i * 8)) and 0xFF).toByte()
            }

            // 9. Pack AC coefficients with mu-law companding
            var bitpos = 48

            val quantizeAc = { value: Double, scale: Double, bits: Int ->
                if (scale == 0.0) {
                    muLawQuantize(0.0, bits)
                } else {
                    muLawQuantize(value / scale, bits)
                }
            }

            if (hasAlpha) {
                val alphaDcQ = roundHalfAwayFromZero(31.0 * clamp01(alphaDc)).toInt()
                val alphaSclQ = roundHalfAwayFromZero(15.0 * clamp01(alphaScale / MAX_A_ALPHA_SCALE)).toInt()
                writeBits(hashBytes, bitpos, 5, alphaDcQ)
                bitpos += 5
                writeBits(hashBytes, bitpos, 4, alphaSclQ)
                bitpos += 4

                // L AC: first 7 at 6 bits, remaining 13 at 5 bits
                for (j in 0 until 7) {
                    val q = quantizeAc(lAc[j], lScale, 6)
                    writeBits(hashBytes, bitpos, 6, q)
                    bitpos += 6
                }
                for (j in 7 until 20) {
                    val q = quantizeAc(lAc[j], lScale, 5)
                    writeBits(hashBytes, bitpos, 5, q)
                    bitpos += 5
                }
            } else {
                // L AC: all 27 at 5 bits
                for (j in 0 until 27) {
                    val q = quantizeAc(lAc[j], lScale, 5)
                    writeBits(hashBytes, bitpos, 5, q)
                    bitpos += 5
                }
            }

            // a AC: 9 at 4 bits
            for (acVal in aAc) {
                val q = quantizeAc(acVal, aScale, 4)
                writeBits(hashBytes, bitpos, 4, q)
                bitpos += 4
            }

            // b AC: 9 at 4 bits
            for (acVal in bAc) {
                val q = quantizeAc(acVal, bScale, 4)
                writeBits(hashBytes, bitpos, 4, q)
                bitpos += 4
            }

            if (hasAlpha) {
                // Alpha AC: 5 at 4 bits
                for (acVal in alphaAc) {
                    val q = quantizeAc(acVal, alphaScale, 4)
                    writeBits(hashBytes, bitpos, 4, q)
                    bitpos += 4
                }
            }

            return ChromaHash(hashBytes)
        }

        /** Create a ChromaHash from raw 32-byte data. */
        fun fromBytes(bytes: ByteArray): ChromaHash {
            require(bytes.size == 32) { "hash must be exactly 32 bytes" }
            return ChromaHash(bytes.copyOf())
        }
    }

    /**
     * Decode a ChromaHash into an RGBA image.
     * Returns a [DecodeResult] with width, height, and rgba_pixels.
     */
    fun decode(): DecodeResult {
        // 1. Unpack header (48 bits)
        var header = 0L
        for (i in 0 until 6) {
            header = header or ((hash[i].toInt() and 0xFF).toLong() shl (i * 8))
        }

        val lDcQ = (header and 0x7F).toInt()
        val aDcQ = ((header ushr 7) and 0x7F).toInt()
        val bDcQ = ((header ushr 14) and 0x7F).toInt()
        val lSclQ = ((header ushr 21) and 0x3F).toInt()
        val aSclQ = ((header ushr 27) and 0x3F).toInt()
        val bSclQ = ((header ushr 33) and 0x1F).toInt()
        val aspect = ((header ushr 38) and 0xFF).toInt()
        val hasAlpha = ((header ushr 46) and 1L) == 1L

        // 2. Decode DC values and scale factors
        val lDc = lDcQ.toDouble() / 127.0
        val aDc = (aDcQ.toDouble() - 64.0) / 63.0 * MAX_CHROMA_A
        val bDc = (bDcQ.toDouble() - 64.0) / 63.0 * MAX_CHROMA_B
        val lScale = lSclQ.toDouble() / 63.0 * MAX_L_SCALE
        val aScale = aSclQ.toDouble() / 63.0 * MAX_A_SCALE
        val bScale = bSclQ.toDouble() / 31.0 * MAX_B_SCALE

        // 3-4. Decode aspect ratio and compute output size
        val (outW, outH) = decodeOutputSize(aspect)

        // 5. Dequantize AC coefficients
        var bitpos = 48

        val alphaDcVal: Double
        val alphaScaleVal: Double
        if (hasAlpha) {
            alphaDcVal = readBits(hash, bitpos, 5).toDouble() / 31.0
            bitpos += 5
            alphaScaleVal = readBits(hash, bitpos, 4).toDouble() / 15.0 * MAX_A_ALPHA_SCALE
            bitpos += 4
        } else {
            alphaDcVal = 1.0
            alphaScaleVal = 0.0
        }

        // Derive adaptive grid dimensions from aspect byte
        val (lNx, lNy) = deriveGrid(aspect, if (hasAlpha) 6 else 7)
        val (cNx, cNy) = deriveGrid(aspect, 4)

        val lAc: DoubleArray
        if (hasAlpha) {
            val lac = DoubleArray(20)
            for (j in 0 until 7) {
                val q = readBits(hash, bitpos, 6)
                bitpos += 6
                lac[j] = muLawDequantize(q, 6) * lScale
            }
            for (j in 7 until 20) {
                val q = readBits(hash, bitpos, 5)
                bitpos += 5
                lac[j] = muLawDequantize(q, 5) * lScale
            }
            lAc = lac
        } else {
            val lac = DoubleArray(27)
            for (j in 0 until 27) {
                val q = readBits(hash, bitpos, 5)
                bitpos += 5
                lac[j] = muLawDequantize(q, 5) * lScale
            }
            lAc = lac
        }

        val aAc = DoubleArray(9)
        for (j in 0 until 9) {
            val q = readBits(hash, bitpos, 4)
            bitpos += 4
            aAc[j] = muLawDequantize(q, 4) * aScale
        }

        val bAc = DoubleArray(9)
        for (j in 0 until 9) {
            val q = readBits(hash, bitpos, 4)
            bitpos += 4
            bAc[j] = muLawDequantize(q, 4) * bScale
        }

        val alphaAc: DoubleArray
        if (hasAlpha) {
            val aac = DoubleArray(5)
            for (j in 0 until 5) {
                val q = readBits(hash, bitpos, 4)
                bitpos += 4
                aac[j] = muLawDequantize(q, 4) * alphaScaleVal
            }
            alphaAc = aac
        } else {
            alphaAc = DoubleArray(0)
        }

        // Precompute adaptive scan orders with usable capping
        val lScanFull = triangularScanOrder(lNx, lNy)
        val lDecCap = if (hasAlpha) 20 else 27
        val lUsable = minOf(lDecCap, lScanFull.size)
        val lScan = lScanFull.subList(0, lUsable)

        val chromaScanFull = triangularScanOrder(cNx, cNy)
        val cUsable = minOf(9, chromaScanFull.size)
        val chromaScan = chromaScanFull.subList(0, cUsable)

        val alphaScan =
            if (hasAlpha) {
                val (aNx, aNy) = deriveGrid(aspect, 3)
                val alphaScanFull = triangularScanOrder(aNx, aNy)
                val aUsable = minOf(5, alphaScanFull.size)
                alphaScanFull.subList(0, aUsable)
            } else {
                emptyList()
            }

        // 6. Render output image
        val rgba = ByteArray(outW * outH * 4)

        for (y in 0 until outH) {
            for (x in 0 until outW) {
                val l = dctDecodePixel(lDc, lAc, lScan, x, y, outW, outH)
                val a = dctDecodePixel(aDc, aAc, chromaScan, x, y, outW, outH)
                val b = dctDecodePixel(bDc, bAc, chromaScan, x, y, outW, outH)
                val alpha =
                    if (hasAlpha) {
                        dctDecodePixel(alphaDcVal, alphaAc, alphaScan, x, y, outW, outH)
                    } else {
                        1.0
                    }

                // Clamp L from DCT ringing, then soft gamut clamp (v0.2)
                val lClamped = clamp01(l)
                val gamutClamped = softGamutClamp(lClamped, a, b)
                val rgbLinear = oklabToLinearSrgb(gamutClamped)
                val idx = (y * outW + x) * 4
                rgba[idx] = linearToSrgb8(clamp01(rgbLinear[0])).toByte()
                rgba[idx + 1] = linearToSrgb8(clamp01(rgbLinear[1])).toByte()
                rgba[idx + 2] = linearToSrgb8(clamp01(rgbLinear[2])).toByte()
                rgba[idx + 3] = roundHalfAwayFromZero(255.0 * clamp01(alpha)).toInt().toByte()
            }
        }

        return DecodeResult(outW, outH, rgba)
    }

    /**
     * Extract the average color without full decode.
     * Returns an [RgbaColor] with components in [0, 255].
     */
    fun averageColor(): RgbaColor {
        var header = 0L
        for (i in 0 until 6) {
            header = header or ((hash[i].toInt() and 0xFF).toLong() shl (i * 8))
        }

        val lDcQ = (header and 0x7F).toInt()
        val aDcQ = ((header ushr 7) and 0x7F).toInt()
        val bDcQ = ((header ushr 14) and 0x7F).toInt()
        val hasAlpha = ((header ushr 46) and 1L) == 1L

        val lDc = lDcQ.toDouble() / 127.0
        val aDc = (aDcQ.toDouble() - 64.0) / 63.0 * MAX_CHROMA_A
        val bDc = (bDcQ.toDouble() - 64.0) / 63.0 * MAX_CHROMA_B

        // Apply soft gamut clamp to DC values (v0.2)
        val lClamped = clamp01(lDc)
        val gamutClamped = softGamutClamp(lClamped, aDc, bDc)
        val rgbLinear = oklabToLinearSrgb(gamutClamped)

        val alpha =
            if (hasAlpha) {
                readBits(hash, 48, 5).toDouble() / 31.0
            } else {
                1.0
            }

        return RgbaColor(
            r = linearToSrgb8(clamp01(rgbLinear[0])),
            g = linearToSrgb8(clamp01(rgbLinear[1])),
            b = linearToSrgb8(clamp01(rgbLinear[2])),
            a = roundHalfAwayFromZero(255.0 * clamp01(alpha)).toInt(),
        )
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ChromaHash) return false
        return hash.contentEquals(other.hash)
    }

    override fun hashCode(): Int = hash.contentHashCode()

    override fun toString(): String = "ChromaHash(${hash.joinToString(",") { (it.toInt() and 0xFF).toString() }})"
}
