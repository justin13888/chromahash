package main

import (
	"fmt"
	"io"
	"os"
	"strconv"

	chromahash "github.com/justin13888/chromahash/go"
)

func usage() {
	fmt.Fprintln(os.Stderr, "Usage:")
	fmt.Fprintln(os.Stderr, "  encode-stdin encode <width> <height> <gamut>")
	fmt.Fprintln(os.Stderr, "  encode-stdin decode")
	fmt.Fprintln(os.Stderr, "  encode-stdin average-color")
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

		hash := chromahash.Encode(w, h, rgba, gamut)
		os.Stdout.Write(hash.Hash[:])

	case "decode":
		var hash [32]byte
		_, err := io.ReadFull(os.Stdin, hash[:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to read hash from stdin: %v\n", err)
			os.Exit(1)
		}
		ch := chromahash.FromBytes(hash)
		_, _, rgba := ch.Decode()
		os.Stdout.Write(rgba)

	case "average-color":
		var hash [32]byte
		_, err := io.ReadFull(os.Stdin, hash[:])
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to read hash from stdin: %v\n", err)
			os.Exit(1)
		}
		ch := chromahash.FromBytes(hash)
		r, g, b, a := ch.AverageColor()
		os.Stdout.Write([]byte{r, g, b, a})

	default:
		usage()
	}
}
