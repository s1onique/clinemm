#!/usr/bin/env node
// elm-package-proxy.mjs
//
// Placeholder. NOT a working solution.
//
// Earlier versions of this comment claimed that staging Elm package
// source trees under .elm-home/0.19.1/packages/ would be sufficient
// for offline builds. That is FALSE: Elm 0.19.1 consults a binary
// index at .elm-home/0.19.1/packages/registry.dat before it will
// trust the package trees. Without a genuine registry.dat from a
// real Elm 0.19.1 run the compiler falls back to a network fetch
// to package.elm-lang.org, which fails in TLS-restricted sandboxes.
//
// See ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW01-CORRECTION01:
// the correct staging path is to copy a complete
// ~/.elm/0.19.1/packages/ (including registry.dat) from an
// environment where Elm can reach the public package server.
//
// A real local mirror would need to:
//   1. Run an HTTPS server on 127.0.0.1:443 with a certificate
//      signed by a CA installed in the system trust store.
//      (Requires root / sudo to add the CA; impossible in this
//      sandbox.)
//   2. Add `127.0.0.1 package.elm-lang.org` to /etc/hosts.
//      (Requires root; impossible in this sandbox.)
//
// So for SHADOW01 this script is intentionally inert. It exists as
// a documented hook only.

console.error(
	"elm-package-proxy: placeholder, no action. See scripts/fetch-elm-packages.sh and ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW01-CORRECTION01.",
)
process.exit(0)
