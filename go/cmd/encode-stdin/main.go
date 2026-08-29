package main

import (
	"fmt"
	"io"
	"os"
	"runtime"
	"strconv"
	"time"

	chromahash "github.com/visualcommons/chromahash/go"
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

// sink absorbs a byte of every benchmarked result. Package-level and written
// through, so the compiler cannot prove the work dead and elide it.
var sink byte

// rejectRustOnlyEnv fails loudly if asked for a knob only the Rust harness has.
//
// CHROMAHASH_TUNE overrides format constants through chromahash::Tunables,
// which no binding exposes (verified against bindings/uniffi, bindings/c and
// bindings/wasm) — and CHROMAHASH_OUT selects a decode output gamut this CLI
// does not implement. Silently ignoring either is the dangerous failure: a
// sweep would label shipped-default numbers as an ablation, and nothing
// downstream could tell. Fail fast at the boundary instead.
func rejectRustOnlyEnv() {
	for _, key := range []string{"CHROMAHASH_TUNE", "CHROMAHASH_OUT"} {
		if v, ok := os.LookupEnv(key); ok && v != "" {
			fmt.Fprintf(os.Stderr, "%s is not supported by this harness (Rust-only); refusing to report numbers that would be silently mislabelled\n", key)
			os.Exit(1)
		}
	}
}

func benchEnvInt(key string, def int64) int64 {
	raw, ok := os.LookupEnv(key)
	if !ok || raw == "" {
		return def
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: invalid value %q\n", key, raw)
		os.Exit(1)
	}
	return v
}

// runBench warms up for CHROMAHASH_BENCH_WARMUP_MS, then runs
// CHROMAHASH_BENCH_REPS timed blocks of iters iterations, printing one mean
// ns/op line per block on stdout. Everything else goes to stderr.
//
// Warmup is time-based rather than count-based because this contract is shared
// across seven harnesses whose per-op costs differ by two orders of magnitude.
func runBench(iters int, op func() byte) {
	reps := benchEnvInt("CHROMAHASH_BENCH_REPS", 1)
	if reps < 1 {
		reps = 1
	}
	warmupMs := benchEnvInt("CHROMAHASH_BENCH_WARMUP_MS", 0)

	// At least one iteration, so the default also validates the input before
	// the first timed block.
	warmStart := time.Now()
	for {
		sink ^= op()
		if time.Since(warmStart).Milliseconds() >= warmupMs {
			break
		}
	}

	if iters < 1 {
		iters = 1
	}
	for r := int64(0); r < reps; r++ {
		start := time.Now()
		for i := 0; i < iters; i++ {
			sink ^= op()
		}
		fmt.Println(time.Since(start).Nanoseconds() / int64(iters))
	}
	fmt.Fprintf(os.Stderr, "checksum=%x\niters=%d\n", sink, iters)
}

func usage() {
	fmt.Fprintln(os.Stderr, "Usage:")
	fmt.Fprintln(os.Stderr, "  encode-stdin encode <width> <height> <gamut>")
	fmt.Fprintln(os.Stderr, "  encode-stdin decode")
	fmt.Fprintln(os.Stderr, "  encode-stdin average-color")
	fmt.Fprintln(os.Stderr, "  encode-stdin batch-encode <width> <height> <gamut> <count>")
	fmt.Fprintln(os.Stderr, "  encode-stdin batch-decode <count>")
	fmt.Fprintln(os.Stderr, "  encode-stdin bench-encode <width> <height> <gamut> <iters>")
	fmt.Fprintln(os.Stderr, "  encode-stdin bench-decode <iters> [max_width max_height]")
	fmt.Fprintln(os.Stderr, "  encode-stdin bench-batch <width> <height> <gamut> <count>")
	fmt.Fprintln(os.Stderr, "  encode-stdin bench-info")
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
		ch, err := chromahash.FromBytes(hash)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
		_, _, rgba := ch.Decode()
		os.Stdout.Write(rgba)

	case "average-color":
		hash, err := io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to read hash from stdin: %v\n", err)
			os.Exit(1)
		}
		ch, err := chromahash.FromBytes(hash)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
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

		tier := tierFromEnv()
		items := make([]chromahash.ImageInput, count)
		for i := range items {
			items[i] = chromahash.ImageInput{W: w, H: h, Rgba: rgba, Gamut: gamut, Quality: tier}
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
		ch, err := chromahash.FromBytes(hash)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
		var acc byte
		for i := 0; i < count; i++ {
			_, _, rgba := ch.Decode()
			acc ^= rgba[0]
		}
		os.Stdout.Write([]byte{acc})

	case "bench-encode":
		if len(os.Args) != 6 {
			fmt.Fprintln(os.Stderr, "Usage: encode-stdin bench-encode <width> <height> <gamut> <iters>")
			os.Exit(1)
		}
		rejectRustOnlyEnv()
		w := mustAtoi(os.Args[2], "width")
		h := mustAtoi(os.Args[3], "height")
		gamut := parseGamut(os.Args[4])
		iters := mustAtoi(os.Args[5], "iters")
		rgba := readRGBA(w, h)
		tier := tierFromEnv()
		runBench(iters, func() byte {
			return chromahash.EncodeWithQuality(w, h, rgba, gamut, tier).Hash[0]
		})

	case "bench-decode":
		if len(os.Args) != 3 && len(os.Args) != 5 {
			fmt.Fprintln(os.Stderr, "Usage: encode-stdin bench-decode <iters> [max_width max_height]")
			os.Exit(1)
		}
		rejectRustOnlyEnv()
		iters := mustAtoi(os.Args[2], "iters")
		ch := readHashArg()
		capped := len(os.Args) == 5
		var maxW, maxH int
		if capped {
			maxW = mustAtoi(os.Args[3], "max_width")
			maxH = mustAtoi(os.Args[4], "max_height")
		}
		runBench(iters, func() byte {
			var w, h int
			var rgba []byte
			if capped {
				w, h, rgba = ch.DecodeCapped(maxW, maxH)
			} else {
				w, h, rgba = ch.Decode()
			}
			return rgba[0] ^ byte(w) ^ byte(h)
		})

	case "bench-batch":
		if len(os.Args) != 6 {
			fmt.Fprintln(os.Stderr, "Usage: encode-stdin bench-batch <width> <height> <gamut> <count>")
			os.Exit(1)
		}
		rejectRustOnlyEnv()
		w := mustAtoi(os.Args[2], "width")
		h := mustAtoi(os.Args[3], "height")
		gamut := parseGamut(os.Args[4])
		count := mustAtoi(os.Args[5], "count")
		rgba := readRGBA(w, h)
		tier := tierFromEnv()
		items := make([]chromahash.ImageInput, count)
		for i := range items {
			items[i] = chromahash.ImageInput{W: w, H: h, Rgba: rgba, Gamut: gamut, Quality: tier}
		}
		threads := int(benchEnvInt("CHROMAHASH_BATCH_THREADS", 0))
		var be *chromahash.BatchEncoder
		if threads > 0 {
			be = chromahash.NewBatchEncoderN(threads)
		} else {
			be = chromahash.NewBatchEncoder()
		}
		defer be.Close()
		// One batch is one iteration, so the printed number is ns per batch.
		runBench(1, func() byte { return be.EncodeBatch(items)[0].Hash[0] })

	case "bench-info":
		fmt.Println("runtime=go")
		fmt.Println("go_version=" + runtime.Version())
		fmt.Println("arch=" + runtime.GOARCH)
		fmt.Printf("threads=%d\n", runtime.NumCPU())

	default:
		usage()
	}
}

func mustAtoi(s, what string) int {
	v, err := strconv.Atoi(s)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid %s: %v\n", what, err)
		os.Exit(1)
	}
	return v
}

func readRGBA(w, h int) []byte {
	expectedLen := w * h * 4
	rgba := make([]byte, expectedLen)
	n, err := io.ReadFull(os.Stdin, rgba)
	if err != nil || n != expectedLen {
		fmt.Fprintf(os.Stderr, "expected %d bytes, got %d\n", expectedLen, n)
		os.Exit(1)
	}
	return rgba
}

func readHashArg() chromahash.ChromaHash {
	hash, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to read hash from stdin: %v\n", err)
		os.Exit(1)
	}
	ch, err := chromahash.FromBytes(hash)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
	return ch
}
