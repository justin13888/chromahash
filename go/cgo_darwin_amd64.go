//go:build darwin && amd64

package chromahash

// See cgo_linux_amd64.go for how the per-platform link path is resolved. The
// Rust staticlib pulls in these system frameworks on macOS (harmless if unused).

/*
#cgo LDFLAGS: -L${SRCDIR}/lib/darwin_amd64 -framework CoreFoundation -framework Security
*/
import "C"
