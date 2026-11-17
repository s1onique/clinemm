# ACT-CLINEMM-DOGFOOD-VERSION-PROVENANCE-CORRECTION01 evidence

## Verdict

`PASS_VERSION_PROVENANCE_CORRECTED`

## Repository identity

- Branch: `main`
- Final HEAD: `9cfe80b634e220b39542f167954e33662f50f5b3`
- Commit: `fix(clinemm): correct dogfood version provenance`
- Canonical tree after commit: clean
- Push/PR/install: none

## Upstream ancestry and base version

- Verified merge base with `upstream/main`: `a6507a62a147db4a35e27f4294589742ccac5060`
- Last upstream integration merge: `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a`
  (parents: ClineMM `265044bf3...`, upstream `a6507a62...`)
- Verified upstream manifest at the merge base: `4.1.26`
- Source base version after repair: `4.1.26`
- Removed obsolete source suffix: `4.1.16-5a1c485cb`
- Build-specific version format: `X.Y.Z-<9-char-source-sha>`

## Repair

1. The staged `apps/vscode/package.json` is stamped after
   `bun install --frozen-lockfile` and before either canonical prepublish
   or the dogfood `protos + build:webview + esbuild --production` path.
2. The canonical source manifest is never stamped; the existing
   post-build byte/tree equality checks remain in force.
3. The existing `build-provenance.json` artifact is emitted by the dogfood
   builder with exact source HEAD, source package path/size/SHA-256,
   extension version, and independent bundle SHA-256.
4. The runtime verifier reads the installed package manifest independently
   and classifies runtime/manifest/provenance version disagreement as
   `MISMATCH`.
5. The builder independently verifies the VSIX manifest version, installed
   package version, and compiled runtime version before finalizing the
   artifact.
6. The two historical traces and their old version labels were not changed.

## Test receipts

- RED witness: the pre-repair focused builder test could not express a
  pre-compilation staged version and failed before production repair.
- `python3 scripts/tests/test_build_dogfood_vsix.py -q`: **73 passed**
- Focused VS Code Vitest identity/provenance suites: **18 passed**
  (`roundc-latency-trace-identity.qual01.test.ts`: 7;
  `automatic-incident-export01.aice01.test.ts`: 11)
- `bun run --cwd apps/vscode check-types`: **exit 0**
- Commit hook: gitleaks **no leaks**; staged Biome gate **exit 0**
- Isolated canonical build: frozen dependency install, SDK build,
  canonical prepublish, all five Elm kernels, VSIX package, manifest and
  payload verification: **exit 0**

The host did not expose Xcode/CLT for a fresh native `better-sqlite3`
compile. The isolated frozen install therefore reused the exact
lockfile-pinned `better-sqlite3@12.11.1` native binary already present in
the canonical checkout. No dependency, lockfile, or source version was
changed to accommodate the host.

## Final isolated VSIX identity

- Artifact: `/tmp/clinemm-version-provenance-final/clinemm-4.1.26-9cfe80b63.vsix`
- VSIX manifest version: `4.1.26-9cfe80b63`
- Installed `extension/package.json` version: `4.1.26-9cfe80b63`
- Compiled runtime version: `4.1.26-9cfe80b63`
- Latency trace identity extension version source:
  `ExtensionRegistryInfo.version` = `4.1.26-9cfe80b63`
- Extension bundle SHA-256:
  `213a5f5da9b22cbe076f315a9a782d23c162d6acd8943810b3985a3809c5e4f8`
- VSIX SHA-256:
  `22def0521aaba965e2440c2f5e30dd33afd169055f89cfd7b80ea5f61ac0e8dd`
- VSIX size: `50369900` bytes

## Build provenance recorded in the VSIX

```json
{
  "schemaVersion": 1,
  "sourceHead": "9cfe80b634e220b39542f167954e33662f50f5b3",
  "extensionVersion": "4.1.26-9cfe80b63",
  "sourcePackagePath": "apps/vscode/package.json",
  "sourcePackageSha256": "0f2e958b74d3f8b82db93a74dec2c74cc2e4ec51668439ae5b03093eedf76a7e",
  "sourcePackageBytes": 27067,
  "bundledExtensionSha256": "213a5f5da9b22cbe076f315a9a782d23c162d6acd8943810b3985a3809c5e4f8"
}
```

This establishes reproducible source binding, not bit-reproducible VSIX
bytes. The bundle digest remains an independent artifact identity.
