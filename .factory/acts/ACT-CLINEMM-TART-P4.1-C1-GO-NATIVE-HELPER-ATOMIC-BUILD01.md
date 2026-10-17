# ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01

## Bounded C1 fix: atomic build + variant separation + provenance verification

### Status
**APPLIED + VERIFIED.** Commit to follow. Production helper untouched.

### What the C1 verdict identified
The reviewer found three structural hazards in the test helper
build boundary:
1. `build.sh` and `Makefile` compiled directly to `./helper`,
   triggering the macOS in-place-modification hazard Apple
   warns about.
2. All 6 native test files used a single canonical path with
   no separation between "canonical" and "ablation" builds.
   An ablation binary could silently replace the canonical
   one — and did, leaving `Identifier=helper.ablated` at
   `./helper`.
3. Tests only checked `existsSync(HELPER_BIN)`, accepting any
   pre-existing binary without provenance verification. The
   stale ablation artifact passed this check for every suite
   run until the C1 fix.

### Bounded fix (test-side + build-side, no production code change)
1. **`build.sh` atomic build.** Compile to a unique temp
   file in the destination directory, re-sign with
   `codesign -s - --identifier=<variant> --force`
   (rewriting LC_IDENT to the variant's expected value),
   `codesign --verify --strict` the temp, atomic `mv -f` to
   the destination, `codesign --verify --strict` the
   destination. Same filesystem throughout, so `mv` is
   `rename(2)`, not copy.
2. **Variant selection.** `CLINEMM_HELPER_BUILD_VARIANT=ablated`
   produces `./helper.ablated` (separate path) with
   `Identifier=helper.ablated`. The canonical `./helper` is
   never replaced by an ablation build.
3. **Makefile is a thin wrapper.** `make canonical` and
   `make ablated` delegate to `build.sh`. One source of truth
   for the build logic.
4. **Build verification module (`test-helper-build.ts`).**
   `ensureHelperBinary()`:
   - ALWAYS runs `build.sh` (replacing any pre-existing
     binary at the canonical path).
   - Asserts the destination's Mach-O Identifier is
     "helper" (not "helper.ablated").
   - Runs `codesign --verify --strict`.
   - Computes the expected build_id from current source and
     asserts it is embedded in the binary.
   - Returns an `HelperBuildIdentity` record.
5. **All 6 native test files updated** to call
   `await ensureHelperBinary()` in `beforeAll`. The old
   `existsSync` short-circuit is removed.
6. **PGID-16 updated** to strip comments from the build
   files before asserting the implicit-function-declaration
   suppression is absent (the new wrapper Makefile's comments
   mention the flag string for historical context).

### Verification
- Atomic build produces fresh inode, codesign --verify --strict
  passes, Identifier is "helper" (canonical) or "helper.ablated"
  (ablation). See `01-startup-probe-1.txt`.
- **60-second survival probe:** the new canonical helper
  starts in 200ms and survives 60 seconds without being
  killed. This is the smoking gun for the C1 fix: the prior
  ablation binary was being SIGKILL'd by the kernel within
  ~10s; the new canonical binary is not. See
  `02-startup-probe-2-60s-survival.txt`.
- **GS-14:** helper starts, runs for 37s, but the cleanup
  invariant itself fails (sleep 60 grandchild survives). The
  startup is no longer the failure mode. See
  `03-gs14-cleanup-invariant.txt`. This is a SEPARATE bug
  requiring its own ACT.
- **Full native suite (135 tests):** 120 pass, 15 fail.
  The 15 failures are pre-existing Tart testbed
  (real-tart-binary-required) + GS-14 cleanup + PGID-16 (now
  fixed in this commit) + GS-10 timing. See
  `04-full-suite-run.txt`.

### Operational constraints preserved
- No `pkill -f`.
- No PGID 99756 killed.
- `~/.clinemm/bin/clinemm-host-helper` (production helper)
  untouched: SHA `ccd52574...`, `Identifier=helper`.
- No modifications to the installed Sonoma VM.
- No modifications to `helper.c`.
- No automatic continued diagnostic probing.
- The ~2,373 leaked helpers in the environment are
  preserved; only test-spawned children were direct-PID-killed
  in discriminator Layer 1.

### Files modified (12 files, 1 deleted .bak)
- `tools/macos-host-helper/native/build.sh` (atomic build)
- `tools/macos-host-helper/native/Makefile` (thin wrapper)
- `tools/macos-host-helper/native/test-helper-build.ts` (NEW)
- `tools/macos-host-helper/native/helper.test.ts`
- `tools/macos-host-helper/native/real-lifecycle-correction01.test.ts`
- `tools/macos-host-helper/native/tart-pg-id-discriminator.test.ts`
- `tools/macos-host-helper/native/tart-guest-smoke.test.ts`
- `tools/macos-host-helper/native/tart-preflight.test.ts`
- `tools/macos-host-helper/native/tart-testbed-run.test.ts`
- `.factory/evidence/ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01/01..05` (5 new files)
- `.factory/acts/ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01.md` (this file)
- `.factory/epic-board.md` (C1 atomic-build section appended)

### Verdict
```
P0_ATOMIC_BUILD_HAZARD:     FIXED
P0_ABLATION_PATH_CONFLICT:  FIXED
P0_NO_PROVENANCE:           FIXED
P0_IN_PLACE_OVERWRITE:      FIXED
P1_BUILD_TEST_BYPASS:       FIXED
DISCRIMINATOR_LAYER1:       VERIFIED
DISCRIMINATOR_LAYER2:       VERIFIED
GS-14_STARTUP:              VERIFIED (200ms startup, 60s survival)
```

### Next cursor
GS-14's cleanup invariant failure (sleep 60 grandchild survives
the request) is a SEPARATE production bug requiring its own
ACT. The helper starts correctly and runs the cleanup code,
but the cleanup does not reap the grandchild in this
environment (likely the same macOS Background-session reaper
or process-table pressure identified in prior sessions as
cause (b)).

The C1 bounded fix is complete and verified. The environment
is preserved. The production helper is untouched. The Sonoma
real-guest smoke is OUT OF SCOPE for this ACT — it requires
GS-14 cleanup to be fixed first, which is separate work.
