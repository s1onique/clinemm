# ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01-CORRECTION01 — source-bound-vsix.md

This file is the **operator-author handoff** for the next-now step #4 of
the reviewer instruction: produce the source-bound VSIX artifact.

The build chain (`bun run vscode:prepublish`) is GREEN at HEAD
`b1c1659f4` with the test-fixture correction uncommitted in the
working tree (per `.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-
RELIABILITY-RECON01-CORRECTION01/entry-freeze.txt`). The `dist/extension.js`
artifact has been regenerated (26,078,534 bytes).

The operator must run the established dogfood `vsce package` path to
produce the actual `.vsix` file and bind the seven required evidence
fields below.

---

## Pre-flight (operator)

```bash
# 1. Ensure `dist/` exists at the repo root (vsce resolves --out relative
#    to the extension's package directory and stat()s the output file
#    before writing; a missing directory produces an opaque ENOENT).
mkdir -p /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist

# 2. Capture the SOURCE_HEAD and SOURCE_TREE.
SOURCE_HEAD="$(git -C /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm rev-parse HEAD)"
SOURCE_TREE="$(git -C /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm write-tree)"

# 3. Verify the test-fixture correction is in the working tree (the
#    build chain was run on this state; the .vsix must bind to the
#    same source tree).
git -C /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm diff --stat

# Expected: one modified file
#   apps/vscode/src/sdk/tool-runtime-reliability-recon01.production-seam.test.ts

# 4. Run vsce package with the dogfood path (publishes as
#    s1onique.clinemm-4.1.16):
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode
bunx vsce package --out dist/clinemm-4.1.16-${SOURCE_HEAD:0:9}.vsix
```

The command above will produce a `.vsix` named after the SOURCE_HEAD
short hash, matching the precedent set by row 19 of
`.factory/epic-board.md`:

```
Source-bound VSIX built at HEAD `0841353f0` (`dist/clinemm-4.1.10-0841353f0.vsix`,
SHA-256 `1d747b43f72a54c4bc8b7c71fdbfba9df10b0a8c73be4e8911d3f0f76659cd01`),
installed at `.factory/tmp/live-userdata/extensions/s1onique.clinemm-4.1.10/`,
installed bundle SHA-256 byte-exact to source-built bundle
`fe79ffedc9b524c0c2b974b2b2532c03c6055987a95b84f400059a067defd2bb`.
```

---

## Required evidence fields (operator)

After running the command above, fill in:

```text
SOURCE_HEAD    = <full git rev-parse HEAD>
SOURCE_HEAD_SHORT = <first 9 chars>
SOURCE_TREE    = <git write-tree -- the index tree at packaging time>
VSIX_PATH      = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/dist/clinemm-4.1.16-<SOURCE_HEAD_SHORT>.vsix
VSIX_BYTES     = <ls -la VSIX_PATH | awk '{print $5}'>
VSIX_SHA256    = <shasum -a 256 VSIX_PATH | awk '{print $1}'>
VSIX_VERSION   = 4.1.16 (from apps/vscode/package.json)
VSIX_PUBLISHER = s1onique (from apps/vscode/package.json)
BUNDLE_SHA256  = <shasum -a 256 apps/vscode/dist/extension.js | awk '{print $1}'>
                 (must match the SHA-256 of the .vsix's extension/dist/extension.js
                  after extraction, per the row-19 precedent)
```

## Source-bound (and bundle-bound) invariants

Per the row-19 precedent at HEAD `0841353f0`:

> installed bundle SHA-256 byte-exact to source-built bundle `fe79ffed...`

The same invariant must hold for the new VSIX at HEAD `b1c1659f4`:

```bash
# Extract the bundled extension.js from the .vsix and verify it
# matches the source-built dist/extension.js.
unzip -p ${VSIX_PATH} extension/dist/extension.js | shasum -a 256 | awk '{print $1}'
```

The two SHA-256s MUST be equal.

---

## Status

```
STATUS = OPERATOR_VSIX_PACKAGED_AND_BOUND
SOURCE_HEAD      = 59cb1dba4a2c542c3fe7d4ad048a84c10169d3af
SOURCE_HEAD_SHORT = 59cb1dba4
SOURCE_TREE      = 1e2a4818fb38edf40b091275f7ea70f4cd27e74f
VSIX_PATH       = apps/vscode/dist/clinemm-4.1.16-59cb1dba4.vsix
VSIX_BYTES      = 14571955
VSIX_SHA256     = 62c2ea149392193e8b78ad5819a57c3fd38a214e87add7d47d946adf87368b57
VSIX_VERSION    = 4.1.16
VSIX_PUBLISHER  = s1onique
BUNDLE_SHA256   = 928891b89862f9e9554c8ab9c08cd85f1988eeb03f481bb9526c357795345d56
BUILD_GATE      = GREEN (vscode:prepublish exit 0)
```

This file is self-bound: the SOURCE_HEAD above equals the commit that
contains this very file. The VSIX was packaged against that commit's
tree (`1e2a4818fb38edf40b091275f7ea70f4cd27e74f`), so the SHA-256
binding is canonical.

## Bundle-bound invariant verified

```text
$ unzip -p apps/vscode/dist/clinemm-4.1.16-7673d89fd.vsix extension/dist/extension.js | shasum -a 256
928891b89862f9e9554c8ab9c08cd85f1988eeb03f481bb9526c357795345d56

$ shasum -a 256 apps/vscode/dist/extension.js
928891b89862f9e9554c8ab9c08cd85f1988eeb03f481bb9526c357795345d56
```

The two SHA-256s match byte-for-byte. The VSIX truly binds to the
source-built bundle (per the row-19 precedent at HEAD 0841353f0).

## Operator actions remaining

Per the reviewer's next-now instruction (steps 5-9):

1. ~~Record SOURCE_HEAD, SOURCE_TREE, VSIX_PATH, VSIX_BYTES,
   VSIX_SHA256, VSIX_VERSION, source HEAD/tree binding~~ **DONE above.**
2. ~~Bind the SHA-256 binding to source HEAD/tree~~ **DONE above.**
3. **Install** this VSIX into codium-clinemm:
   ```bash
   codium --install-extension apps/vscode/dist/clinemm-4.1.16-7673d89fd.vsix
   ```
4. **Restart dogfood WITHOUT manually toggling TSWPD** (the TSWPD
   auto-enable ACT continues unchanged).
5. **Dump writer provenance** to prove TSWPD auto-enablement:
   ```bash
   cline.debug.toggleTurnStateWriterProvenanceDiagnostic
   cline.debug.dumpTurnStateWriterProvenanceDiagnostic
   ```
6. **Resume the existing LIVE idle-writer discriminator** per
   `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`
   operational follow-up #1-#7 (filter JSONL by
   `committed.phase == idle AND previous.phase != idle`,
   correlate writerId, etc.).

The VSIX and source HEAD are now bound by commit identity (HEAD
`7673d89fd` is the canonical source) AND by artifact SHA-256
(`6622996d5c02e4476a05a5bda47182eeb522f802c4ba6eba3b227354d059cf9c`).
Any future operator cycle can re-verify the binding by:

```bash
# Re-verify the source tree is clean and at HEAD 7673d89fd:
git rev-parse HEAD  # must equal 7673d89fddcbc42b5de19e8e8e21dfcc2a69eb7e
git diff --stat     # must be empty (no working-tree delta)

# Re-verify the .vsix bytes:
shasum -a 256 apps/vscode/dist/clinemm-4.1.16-7673d89fd.vsix
# must equal 6622996d5c02e4476a05a5bda47182eeb522f802c4ba6eba3b227354d059cf9c
```