# ACT-CLINEMM-EXACT-HEAD-DOGFOOD-C1-GO — closure report

**Verdict:** PASS
**Date:** 2026-10-12
**Author:** Cline (MiniMax M3, 2026-10-12)
**Authoritative verdict reference:** Expert reviewer C1: GO

## Expert verdict (input)

`PASS_WITH_NONBLOCKING_RESIDUE — C1: GO`

> The PPLC01/OCRRD01 build blocker is resolved according to the
> reported executable gates. Proceed with the exact-HEAD VSIX build.
> The attached digest confirms the correction is limited to four
> files: one bridge test, two TypeScript configurations, and the
> base Vitest configuration. No runtime implementation or Elm
> authority was changed.

Artifact identity caveat: the digest was captured at a dirty
worktree (HEAD `b1de112d2`), and the verdict explicitly instructed
"discover the current HEAD rather than assuming the old SHA is the
artifact source" and "Do not use an artifact built from an earlier
uncommitted state."

## Steps taken

1. **Discovered the current state.** The four PPLC01 wiring files
   (the bounded fix the Expert authorized) were still in the working
   tree as uncommitted modifications, and the latest committed HEAD
   was `b1de112d2` (the listener-signature fix from the same bounded
   cluster). The worktree was dirty.

2. **Verified the PPLC01/OCRRD01 gates on the dirty state** (matching
   the Expert's digest scope):
   - PPLC01 bridge test: 8/8 PASS
   - OCRRD01 bridge test: 5/5 PASS
   - Bridge typecheck: PASS (0 NEW diagnostics vs frozen baseline,
     PPLC01 in scope)

3. **Committed the 4 wiring files** as a single bounded commit so the
   artifact source matches the verdict:
   - `307bb1d46` `test(SDK): PPLC01/OCRRD01 build wiring — bake
     PPLC01 bridge test into canonical typecheck + base vitest
     exclude (matches OCRRD01 sibling)`

4. **Re-verified all 4 focused gates on the new HEAD:**
   - PPLC01 bridge: 8/8 PASS
   - OCRRD01 bridge: 5/5 PASS
   - Bridge typecheck: PASS
   - Lint on the 4 changed files: PASS (0 diagnostics, 0 fixes)

5. **Confirmed the pre-existing ACO01/ACO03 CASE_D_DEAD_ZONE
   failures are NOT a regression** of the PPLC01 wiring by
   re-running aco01 on the pristine pre-PPLC01 HEAD `b1de112d2`
   and observing the identical 2/3 failure shape. The test
   is designed to surface a known production gap; it is not a
   PPLC01/OCRRD01 gate.

6. **Ran the canonical exact-HEAD dogfood orchestrator** with
   `python3 scripts/build-dogfood-vsix.py`. The build ran in a
   detached worktree at exact HEAD `307bb1d46d92a0c0175e273f275a55629431032f`,
   through the full D01..D12 invariant pipeline.

7. **Captured the build manifest** (see result.json):
   - source_head, source_version, dogfood_version, artifact path,
     sha256, bytes, elm toolchain identity.
   - Verified externally with `shasum -a 256`.

## Build manifest

| Field | Value |
|---|---|
| source_head | `307bb1d46d92a0c0175e273f275a55629431032f` |
| source_version | `4.1.16-5a1c485cb` |
| dogfood_version | `4.1.16-5a1c485cb-307bb1d46` |
| artifact | `dist/dogfood/clinemm-4.1.16-5a1c485cb-307bb1d46.vsix` |
| sha256 | `1006d304a15cd5080f38d933574dd53f393694e217ef566d0958ffef355489be` |
| bytes | 44,018,517 (~41.98 MB) |
| skip_typecheck | false (full `bun run package` typecheck ran) |
| elm_version | 0.19.2 |
| elm_bin | /opt/homebrew/bin/elm (sha256 `3e65ac3e…`) |
| vsce tree | 211 files, 41.98 MB |
| runtime-assets | 10 files / 398.11 KB (5 Elm kernels + .sha256 sidecars) |

## Build environment

The build required two macOS tempdir workarounds documented
in the evidence file:

- `BUN_TMPDIR=/tmp/dogfood-bun-tmp` and `BUN_INSTALL=/tmp/dogfood-bun-install`
  to redirect Bun's cache to a writable location (the macOS
  `$TMPDIR` under `/private/var/folders/0g/...` is not writable
  for the Bun child process spawned from the git-worktree).
- `HOME=/tmp/dogfood-elm-home` (a pre-seeded copy of
  `~/.elm/0.19.2/packages/` with a writable `lock` file) to
  bypass the macOS provenance/sandbox denial on
  `/Volumes/UserData/Users/chistyakov/.elm/0.19.2/packages/lock`
  when the homebrew `elm` runs from the deeply-nested worktree.
  Without this, the Elm kernel build fails with
  `openFdAt: permission denied`.

Neither workaround is a code change; both are local-environment
quirks on this build host.

## Out of scope (not changed by this ACT)

- The `PendingPromptCountRead` discriminated-union cast in
  `getPendingPromptCount` (the Expert-classified P2 NON-BLOCKING
  type-safety concern) — NOT touched, per the verdict.
- The CASE_D_DEAD_ZONE production gap surfaced by
  `aco01.c24-c-bridge.test.ts` (parent ACT
  ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01's open
  work) — NOT in scope for PPLC01/OCRRD01.
- VSIX install — D11 OPTIONAL_INSTALL is left to the next
  step (installed LIVE recovery, which the Expert disposition
  leaves OPEN).

## Next steps (per the Expert disposition)

1. Install the artifact:
   `codium-cline --install-extension dist/dogfood/clinemm-4.1.16-5a1c485cb-307bb1d46.vsix`
2. Run the installed session demonstrating real observation
   consumption, truthful capability publication, and exactly one
   Elm-authorized completion commit.
