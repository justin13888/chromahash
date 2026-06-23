//go:build linux && arm64

package chromahash

// See cgo_linux_amd64.go for how the per-platform link path is resolved.

/*
#cgo LDFLAGS: -L${SRCDIR}/lib/linux_arm64
*/
import "C"
