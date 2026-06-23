//go:build linux && amd64

package chromahash

// Per-platform link path. `go get` consumers link the prebuilt static lib
// committed under go/lib/<goos>_<goarch>/ on the `go/vX.Y.Z` release tag (staged
// by .github/workflows/release-go.yml). Local dev builds instead pick up the
// freshly built go/lib/libchromahash_c.a from `just go-cbuild` via the -L in
// chromahash.go, which is searched first; -lchromahash_c and the linux system
// libs are declared there.

/*
#cgo LDFLAGS: -L${SRCDIR}/lib/linux_amd64
*/
import "C"
