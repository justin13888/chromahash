package main

import (
	"fmt"
	"io"
	"os"
	"strconv"

	chromahash "github.com/justin13888/chromahash/go"
)

func main() {
	if len(os.Args) != 4 {
		fmt.Fprintln(os.Stderr, "Usage: encode-stdin <width> <height> <gamut>")
		os.Exit(1)
	}

	w, err := strconv.Atoi(os.Args[1])
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid width: %v\n", err)
		os.Exit(1)
	}
	h, err := strconv.Atoi(os.Args[2])
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid height: %v\n", err)
		os.Exit(1)
	}

	var gamut chromahash.Gamut
	switch os.Args[3] {
	case "srgb":
		gamut = chromahash.GamutSRGB
	case "displayp3":
		gamut = chromahash.GamutDisplayP3
	case "adobergb":
		gamut = chromahash.GamutAdobeRGB
	case "bt2020":
		gamut = chromahash.GamutBT2020
	case "prophoto":
		gamut = chromahash.GamutProPhotoRGB
	default:
		fmt.Fprintf(os.Stderr, "unknown gamut: %s\n", os.Args[3])
		os.Exit(1)
	}

	expectedLen := w * h * 4
	rgba := make([]byte, expectedLen)
	n, err := io.ReadFull(os.Stdin, rgba)
	if err != nil || n != expectedLen {
		fmt.Fprintf(os.Stderr, "expected %d bytes, got %d\n", expectedLen, n)
		os.Exit(1)
	}

	hash := chromahash.Encode(w, h, rgba, gamut)
	os.Stdout.Write(hash.Hash[:])
}
