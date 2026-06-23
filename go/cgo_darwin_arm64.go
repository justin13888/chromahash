//go:build darwin && arm64

package chromahash

// See cgo_linux_amd64.go for how the per-platform link path is resolved.

/*
#cgo LDFLAGS: -L${SRCDIR}/lib/darwin_arm64 -framework CoreFoundation -framework Security
*/
import "C"
