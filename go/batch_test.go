package chromahash

import (
	"bytes"
	"testing"
)

// mixedBatchItems is a spread of dimensions, gamuts, and alpha, mirroring the
// bulk-migration use case.
func mixedBatchItems() []ImageInput {
	return []ImageInput{
		{W: 4, H: 4, Rgba: solidImage(4, 4, 200, 100, 50, 255), Gamut: GamutSRGB},
		{W: 8, H: 4, Rgba: horizontalGradient(8, 4), Gamut: GamutDisplayP3},
		{W: 4, H: 8, Rgba: solidImage(4, 8, 30, 200, 120, 128), Gamut: GamutAdobeRGB},
		{W: 16, H: 16, Rgba: verticalGradient(16, 16), Gamut: GamutBT2020},
		{W: 1, H: 1, Rgba: solidImage(1, 1, 255, 0, 0, 255), Gamut: GamutProPhotoRGB},
	}
}

func TestBatchEncodeMatchesSerial(t *testing.T) {
	items := mixedBatchItems()
	be := NewBatchEncoder()
	defer be.Close()

	got := be.EncodeBatch(items)
	if len(got) != len(items) {
		t.Fatalf("expected %d hashes, got %d", len(items), len(got))
	}
	for i, it := range items {
		want := Encode(it.W, it.H, it.Rgba, it.Gamut)
		if !bytes.Equal(got[i].Hash, want.Hash) {
			t.Errorf("item %d: batch hash != serial hash", i)
		}
	}
}

func TestBatchEncodePreservesOrder(t *testing.T) {
	// Many same-shape items to exercise out-of-order completion.
	items := make([]ImageInput, 64)
	for i := range items {
		items[i] = ImageInput{
			W:     8,
			H:     8,
			Rgba:  solidImage(8, 8, byte(i), byte(255-i), byte(i*3), 255),
			Gamut: GamutSRGB,
		}
	}
	be := NewBatchEncoderN(4)
	defer be.Close()

	got := be.EncodeBatch(items)
	for i, it := range items {
		if !bytes.Equal(got[i].Hash, Encode(it.W, it.H, it.Rgba, it.Gamut).Hash) {
			t.Errorf("item %d out of order", i)
		}
	}
}

func TestBatchEncodeReusable(t *testing.T) {
	items := mixedBatchItems()
	be := NewBatchEncoder()
	defer be.Close()

	first := be.EncodeBatch(items)
	second := be.EncodeBatch(items)
	for i := range items {
		if !bytes.Equal(first[i].Hash, second[i].Hash) {
			t.Errorf("item %d differs across reuse", i)
		}
	}
}

func TestBatchEncodeEmpty(t *testing.T) {
	be := NewBatchEncoder()
	defer be.Close()
	if got := be.EncodeBatch(nil); len(got) != 0 {
		t.Errorf("expected empty result, got %d", len(got))
	}
}

func TestBatchEncodeInvalidPanics(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Errorf("expected panic on invalid item")
		}
	}()
	be := NewBatchEncoder()
	defer be.Close()
	be.EncodeBatch([]ImageInput{
		{W: 2, H: 2, Rgba: make([]byte, 3), Gamut: GamutSRGB}, // wrong length
	})
}
