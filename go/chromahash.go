// Package chromahash implements the ChromaHash LQIP (Low Quality Image
// Placeholder) format — a fixed 32-byte representation of an image.
//
// This package is a thin cgo wrapper over the chromahash-c C ABI, which exposes
// the zero-dependency Rust core. Output is byte-identical to every other
// ChromaHash implementation. Because it uses cgo, builds require a C toolchain
// (CGO_ENABLED=1) and the prebuilt static library under go/lib — run
// `just build-go` (which builds + stages it) rather than a bare `go build`.
package chromahash

/*
#cgo CFLAGS: -I${SRCDIR}/include
#cgo LDFLAGS: -L${SRCDIR}/lib -lchromahash_c
#cgo linux LDFLAGS: -lm -ldl -lpthread
#include "chromahash.h"
*/
import "C"

import (
	"runtime"
	"unsafe"
)

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

	var handle *C.ChromaHash
	status := C.chromahash_encode(
		C.uint32_t(w),
		C.uint32_t(h),
		(*C.uint8_t)(unsafe.Pointer(&rgba[0])),
		C.size_t(len(rgba)),
		C.ChromaHashGamut(gamut),
		&handle,
	)
	runtime.KeepAlive(rgba)
	if status != C.CHROMA_HASH_STATUS_OK || handle == nil {
		panic("chromahash: encode failed")
	}
	defer C.chromahash_free(handle)

	var out ChromaHash
	if C.chromahash_as_bytes(handle, (*C.uint8_t)(unsafe.Pointer(&out.Hash[0])), C.size_t(len(out.Hash))) != C.CHROMA_HASH_STATUS_OK {
		panic("chromahash: as_bytes failed")
	}
	return out
}

// FromBytes creates a ChromaHash directly from a raw 32-byte array.
func FromBytes(b [32]byte) ChromaHash {
	return ChromaHash{Hash: b}
}

// handle reconstructs an opaque C handle from the 32-byte hash. The caller must
// free it with C.chromahash_free.
func (ch *ChromaHash) handle() *C.ChromaHash {
	var handle *C.ChromaHash
	status := C.chromahash_from_bytes(
		(*C.uint8_t)(unsafe.Pointer(&ch.Hash[0])),
		C.size_t(len(ch.Hash)),
		&handle,
	)
	if status != C.CHROMA_HASH_STATUS_OK || handle == nil {
		panic("chromahash: from_bytes failed")
	}
	return handle
}

// Decode decodes the ChromaHash into an RGBA image.
// Returns width, height, and RGBA pixel data (row-major, 4 bytes per pixel).
func (ch ChromaHash) Decode() (int, int, []byte) {
	handle := ch.handle()
	defer C.chromahash_free(handle)
	var img C.ChromaHashImage
	if C.chromahash_decode(handle, &img) != C.CHROMA_HASH_STATUS_OK {
		panic("chromahash: decode failed")
	}
	return readImage(&img)
}

// DecodeCapped decodes into an RGBA image, capped at the given maximum
// dimensions. Returns width, height, and RGBA pixel data.
func (ch ChromaHash) DecodeCapped(maxW, maxH int) (int, int, []byte) {
	handle := ch.handle()
	defer C.chromahash_free(handle)
	var img C.ChromaHashImage
	if C.chromahash_decode_capped(handle, C.uint32_t(maxW), C.uint32_t(maxH), &img) != C.CHROMA_HASH_STATUS_OK {
		panic("chromahash: decode_capped failed")
	}
	return readImage(&img)
}

// readImage copies a library-owned ChromaHashImage into Go memory and frees it.
func readImage(img *C.ChromaHashImage) (int, int, []byte) {
	defer C.chromahash_image_free(img)
	n := C.int(img.rgba_len)
	var rgba []byte
	if n > 0 {
		rgba = C.GoBytes(unsafe.Pointer(img.rgba), n)
	}
	return int(img.width), int(img.height), rgba
}

// AverageColor extracts the average color from the ChromaHash without a full
// decode. Returns r, g, b, a as uint8 values. Per spec §11.2.
func (ch ChromaHash) AverageColor() (r, g, b, a uint8) {
	handle := ch.handle()
	defer C.chromahash_free(handle)
	var color C.ChromaHashColor
	if C.chromahash_average_color(handle, &color) != C.CHROMA_HASH_STATUS_OK {
		panic("chromahash: average_color failed")
	}
	return uint8(color.r), uint8(color.g), uint8(color.b), uint8(color.a)
}

// IsVersionSupported reports whether this hash uses the v0.6 bitstream this
// library implements. Decoding an unsupported (legacy) hash produces garbage,
// not an error — check this first for hashes of unknown provenance.
func (ch ChromaHash) IsVersionSupported() bool {
	handle := ch.handle()
	defer C.chromahash_free(handle)
	return bool(C.chromahash_is_version_supported(handle))
}
