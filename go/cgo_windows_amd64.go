//go:build windows && amd64

package chromahash

// See cgo_linux_amd64.go for how the per-platform link path is resolved. The
// committed Windows lib is the windows-gnu (mingw) static archive, and the Rust
// staticlib pulls in these Windows system libs.

/*
#cgo LDFLAGS: -L${SRCDIR}/lib/windows_amd64 -lws2_32 -lbcrypt -luserenv -lntdll
*/
import "C"
