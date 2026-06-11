package chromahash

// Gamut identifies the source color space. Values match the chromahash-c ABI
// enum (and the Rust core's Gamut), so a plain conversion crosses the FFI.
type Gamut int

const (
	GamutSRGB Gamut = iota
	GamutDisplayP3
	GamutAdobeRGB
	GamutBT2020
	GamutProPhotoRGB
)
