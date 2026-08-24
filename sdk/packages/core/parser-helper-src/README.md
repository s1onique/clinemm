# Parser Helper Source — Reconstruction

`ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01` rebuilds the source for the
vendored `cline-parser-helper` Go binary from scratch against
`mvdan.cc/sh/v3` v3.13.1, pins the protocol-v2 surface, and verifies
behavioral equivalence against the legacy binaries frozen in
`.factory/oracle/LEGACY_HELPERS.txt`.

## Scope (Phase 1)

1. `freeze-legacy-helpers.mjs` records the 5 vendored binaries
   (size + SHA-256 + protocolVersion) and captures normalized outputs
   from the local-host binary against the v2 equivalence corpus
   → `.factory/oracle/REFERENCE_PROTOCOL_V2.json`.
2. `main.go` + `protocol.go` + `projection.go` reconstruct the
   wire-compatible Go helper, pinned to `mvdan.cc/sh/v3` v3.13.1.
3. `cross-compile.sh` cross-compiles the same 5 targets from
   tracked source.

## Strict scope guards (this ACT)

- **NO** `shellStatic` provenance added yet (deferred to a follow-on ACT).
- **NO** protocol version bump.
- **NO** replacement of vendored binaries.
- **NO** TS V2 echo authority touched.
- **NO** quoted-find work.

The first epistemic purpose is narrower:

> Can we reconstruct a tracked, buildable helper whose existing externally
> visible behavior matches the binary-only artifact we already shipped?

Only after Phase 1 equivalence passes should the helper be extended with
positive `shellStatic` provenance.

## Invariant

```
NO VENDORED PARSER BINARY WITHOUT TRACKED BUILDABLE SOURCE
```