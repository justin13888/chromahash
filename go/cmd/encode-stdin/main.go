package main

import (
	"fmt"
	"io"
	"os"
	"strconv"

	chromahash "github.com/justin13888/chromahash/go"
)

// tierFromEnv reads the quality tier from CHROMAHASH_TIER, matching the Rust
// harness so the cross-language benchmark measures the same workload in every
// language. Defaults to the 32-byte tier.
func tierFromEnv() uint8 {
	raw, ok := os.LookupEnv("CHROMAHASH_TIER")
	if !ok || raw == "" {
		return chromahash.DefaultTier
	}
	tier, err := strconv.Atoi(raw)
	if err != nil || tier < 0 || tier > int(chromahash.MaxTier) {
		fmt.Fprintf(os.Stderr, "CHROMAHASH_TIER: %q is not a valid tier code (0..=%d)\n", raw, chromahash.MaxTier)
		os.Exit(1)
	}
	return uint8(tier)
}

func usage() {
	fmt.Fprintln(os.Stderr, "Usage:")
	fmt.Fprintln(os.Stderr, "  encode-stdin encode <width> <height> <gamut>")
	fmt.Fprintln(os.Stderr, "  encode-stdin decode")
	fmt.Fprintln(os.Stderr, "  encode-stdin average-color")
	fmt.Fprintln(os.Stderr, "  encode-stdin batch-encode <width> <height> <gamut> <count>")
	fmt.Fprintln(os.Stderr, "  encode-stdin batch-decode <count>")
	os.Exit(1)
}

func parseGamut(s string) chromahash.Gamut {
	switch s {
	case "srgb":
		return chromahash.GamutSRGB
	case "displayp3":
		return chromahash.GamutDisplayP3
	case "adobergb":
		return chromahash.GamutAdobeRGB
	case "bt2020":
		return chromahash.GamutBT2020
	case "prophoto":
		return chromahash.GamutProPhotoRGB
	default:
		fmt.Fprintf(os.Stderr, "unknown gamut: %s\n", s)
		os.Exit(1)
		return 0
	}
}

func main() {
	if len(os.Args) < 2 {
		usage()
	}

	switch os.Args[1] {
	case "encode":
		if len(os.Args) != 5 {
			fmt.Fprintln(os.Stderr, "Usage: encode-stdin encode <width> <height> <gamut>")
			os.Exit(1)
		}
		w, err := strconv.Atoi(os.Args[2])
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid width: %v\n", err)
			os.Exit(1)
		}
		h, err := strconv.Atoi(os.Args[3])
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid height: %v\n", err)
			os.Exit(1)
		}
		gamut := parseGamut(os.Args[4])

		expectedLen := w * h * 4
		rgba := make([]byte, expectedLen)
		n, err := io.ReadFull(os.Stdin, rgba)
		if err != nil || n != expectedLen {
			fmt.Fprintf(os.Stderr, "expected %d bytes, got %d\n", expectedLen, n)
			os.Exit(1)
		}

		hash := chromahash.EncodeWithQuality(w, h, rgba, gamut, tierFromEnv())
		os.Stdout.Write(hash.Hash[:])

	case "decode":
		hash, err := io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to read hash from stdin: %v\n", err)
			os.Exit(1)
		}
		ch := chromahash.FromBytes(hash)
		_, _, rgba := ch.Decode()
		os.Stdout.Write(rgba)

	case "average-color":
		hash, err := io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to read hash from stdin: %v\n", err)
			os.Exit(1)
		}
		ch := chromahash.FromBytes(hash)
		r, g, b, a := ch.AverageColor()
		os.Stdout.Write([]byte{r, g, b, a})

	case "batch-encode":
		// Read one image, encode it `count` times through the parallel
		// BatchEncoder. Used to benchmark bulk throughput.
		if len(os.Args) != 6 {
			fmt.Fprintln(os.Stderr, "Usage: encode-stdin batch-encode <width> <height> <gamut> <count>")
			os.Exit(1)
		}
		w, err := strconv.Atoi(os.Args[2])
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid width: %v\n", err)
			os.Exit(1)
		}
		h, err := strconv.Atoi(os.Args[3])
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid height: %v\n", err)
			os.Exit(1)
		}
		gamut := parseGamut(os.Args[4])
		count, err := strconv.Atoi(os.Args[5])
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid count: %v\n", err)
			os.Exit(1)
		}

		expectedLen := w * h * 4
		rgba := make([]byte, expectedLen)
		n, err := io.ReadFull(os.Stdin, rgba)
		if err != nil || n != expectedLen {
			fmt.Fprintf(os.Stderr, "expected %d bytes, got %d\n", expectedLen, n)
			os.Exit(1)
		}

		items := make([]chromahash.ImageInput, count)
		for i := range items {
			items[i] = chromahash.ImageInput{W: w, H: h, Rgba: rgba, Gamut: gamut}
		}
		be := chromahash.NewBatchEncoder()
		hashes := be.EncodeBatch(items)
		be.Close()
		// Write one result-derived byte so the work cannot be optimized away.
		os.Stdout.Write([]byte{hashes[0].Hash[0]})

	case "batch-decode":
		// No batch decode API exists; loop the single decode `count` times.
		if len(os.Args) != 3 {
			fmt.Fprintln(os.Stderr, "Usage: encode-stdin batch-decode <count>")
			os.Exit(1)
		}
		count, err := strconv.Atoi(os.Args[2])
		if err != nil {
			fmt.Fprintf(os.Stderr, "invalid count: %v\n", err)
			os.Exit(1)
		}
		hash, err := io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to read hash from stdin: %v\n", err)
			os.Exit(1)
		}
		ch := chromahash.FromBytes(hash)
		var acc byte
		for i := 0; i < count; i++ {
			_, _, rgba := ch.Decode()
			acc ^= rgba[0]
		}
		os.Stdout.Write([]byte{acc})

	default:
		usage()
	}
}
