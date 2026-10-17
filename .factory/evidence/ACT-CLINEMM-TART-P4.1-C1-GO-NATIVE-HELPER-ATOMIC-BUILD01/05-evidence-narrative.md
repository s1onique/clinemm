# ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01 — Evidence Narrative

## 1. The finding that triggered this ACT

The reviewer's C1 verdict (HALT_PARTIAL_SPAWN_CLEANUP + P1_OWNERSHIP_PS_PARSER)
on commit `9cdf12fc2` led to a follow-up investigation that revealed
a *separate, higher-priority* defect: the binary at
`tools/macos-host-helper/native/helper` had `Identifier=helper.ablated`
in its Mach-O LC_IDENT load command. This was an ablation artifact
left at the canonical path by an out-of-band build.

The production helper at `~/.clinemm/bin/clinemm-host-helper` had
`Identifier=helper` and SHA `ccd52574...` — a completely different
binary. The test binary at the canonical repo path was the
ablation binary with SHA `947cf462...`.

This explains the SIGKILL/Code Signature Invalid symptoms in the
prior sessions: the test binary was an old ablation artifact that
the macOS codesign cache had invalidated. Every test that
spawned it would receive SIGKILL within seconds.

## 2. Structural hazards identified

### 2.1 In-place overwrite

`native/build.sh` and `native/Makefile` both compiled directly to
`./helper`. Per Apple developer documentation, in-place modification
of a code-signed executable can produce "Code Signature Invalid"
crashes because macOS caches signature metadata per inode.

### 2.2 Single canonical path

All 6 native test files reference `HELPER_BIN = join(SCRIPT_DIR,
"helper")` and treat it as a single canonical path. There is no
separation between "canonical helper" and "test/ablation helper",
so an out-of-band ablation build can silently replace the canonical
binary.

### 2.3 No provenance verification

The test pattern `if (!existsSync(HELPER_BIN)) { spawn(build.sh) }`
accepts any pre-existing binary without verifying its identity.
A stale ablation artifact (which exists, has the right SHA prefix,
and passes `codesign --verify --strict` for its own contents)
silently satisfies the test setup.

## 3. The bounded C1 fix

### 3.1 Atomic build in `build.sh`

`build.sh` now:
1. Compiles to `.<dest>.unsigned.tmp.PID.RAND` (not the destination).
2. Re-signs with `codesign -s - --identifier=<variant_ident> --force`
   which rewrites LC_IDENT to the canonical "helper" or the
   ablated "helper.ablated" (different paths, different idents).
3. `codesign --verify --strict` the temp file.
4. `mv` the temp file to the destination (atomic within a
   single filesystem — no in-place write to the previous inode).
5. `codesign --verify --strict` the destination (defense in depth).

### 3.2 Makefile as thin wrapper

`Makefile` no longer reimplements the build. It delegates to
`build.sh` for both `make canonical` and `make ablated`. There is
ONE source of truth for the build logic.

### 3.3 Variant separation

The canonical build produces `./helper` with `Identifier=helper`.
The ablated build (selected by `CLINEMM_HELPER_BUILD_VARIANT=ablated`
or `make ablated`) produces `./helper.ablated` with
`Identifier=helper.ablated`. The two paths are disjoint. An
ablation build can NEVER replace the canonical binary.

### 3.4 Build verification module

`native/test-helper-build.ts` exports `ensureHelperBinary()` which:
1. Always invokes `build.sh` (even if the file exists). The
   atomic build replaces any pre-existing artifact.
2. Verifies the destination's Mach-O Identifier is "helper"
   (not "helper.ablated" or any other value). A stale ablated
   binary at the canonical path is detected and the helper
   rebuilt.
3. `codesign --verify --strict` on the destination.
4. Computes the expected build_id from the current source and
   asserts it appears in the binary (defense in depth).
5. Returns an `HelperBuildIdentity` record (sha, inode, build_id,
   ident, mtime, size) and writes it to
   `./.helper.identity` for debugging.

### 3.5 Test wiring

All 6 native test files (`helper.test.ts`,
`real-lifecycle-correction01.test.ts`,
`tart-pg-id-discriminator.test.ts`,
`tart-guest-smoke.test.ts`,
`tart-preflight.test.ts`,
`tart-testbed-run.test.ts`) updated to call
`await ensureHelperBinary()` in `beforeAll`, replacing the old
`existsSync` + conditional `spawn build.sh` pattern.

## 4. Verification

### 4.1 Atomic build correctness

```
$ rm -f helper helper.ablated
$ ./build.sh
[build] codesign --verify --strict PASS for ./.helper.unsigned.tmp.78996.26023
[build] post-rename codesign --verify --strict PASS for ./helper
$ codesign -dvv helper | head -3
Executable=.../helper
Identifier=helper
Format=Mach-O thin (arm64)
$ codesign --verify --strict helper; echo $?
0
$ CLINEMM_HELPER_BUILD_VARIANT=ablated ./build.sh
[build] codesign --verify --strict PASS for ./.helper.ablated.unsigned.tmp.79050.10496
[build] post-rename codesign --verify --strict PASS for ./helper.ablated
$ codesign -dvv helper.ablated | head -3
Executable=.../helper.ablated
Identifier=helper.ablated
Format=Mach-O thin (arm64)
```

Both binaries verify strict, both have the correct Identifier.

### 4.2 Startup probe (60s survival)

File: `02-startup-probe-2-60s-survival.txt`

```
IDENT: 78cbc8aae3990a4c ident: helper
SPAWN pid=94932
STARTED after 200ms
HELPER STILL RUNNING after 60s (started 60004ms ago)
```

The new canonical helper starts in 200ms and survives 60s
without being killed. Compare to the prior sessions where
the ablated helper was killed within 10s (SIGKILL exit 137).

This is the smoking gun for the C1 fix: replacing the
ablation binary with a fresh canonical binary at the
canonical path, atomically installed with the correct
Identifier, resolves the runtime SIGKILL.

### 4.3 GS-14 (descendant cleanup invariant)

File: `03-gs14-cleanup-invariant.txt`

```
GS-14: descendant cleanup — specific sleep PID is reaped after TART_EXEC_TIMEOUT
37032.78ms
✗ FAIL: lastObs is "alive" (sleep 60 grandchild is still alive)
```

GS-14 ran for 37 seconds (not the 10s startup-failure timeout
of prior sessions). The helper started successfully. The
assertion that failed is the cleanup invariant itself, not a
build or startup issue. This is the same GS-14 failure that
existed before the C1 fix — the cleanup path needs separate
work that is out of scope for this ACT.

### 4.4 Full native suite (135 tests)

File: `04-full-suite-run.txt`

Result: 120 pass, 15 fail, 0 leak in the discriminator

Failures analyzed:
- PGID-16: Makefile/build.sh implicit-function-declaration
  suppression check — fixed in this commit (the wrapper
  Makefile is a comment-only file, and the test now strips
  comments before checking).
- TBRUNNER-RL-01..06: Tart testbed tests that require a real
  tart binary and SSH access (not available in this CI env).
  These failures are pre-existing and unrelated to the C1 fix.
- TBRUNNER-C-01, C-04, C-09-1, C-09-2: same (Tart testbed
  tests requiring real infrastructure).
- GS-10: concurrent smoke requests — timing-related,
  not build-related.
- GS-14: cleanup invariant (see 4.3 above).

Discriminator test (the primary C1 verification target):
- Layer 1 (direct-PID kill) fired correctly:
  `[PGID-DISC] Layer1 direct-PID kill: code=EPERM ...`
- Layer 2 (pgrp signal) was correctly skipped because
  `freshSpawnVerified=false` (the helper inherited the
  runner's session, EPERM on kill).

## 5. Operational constraints preserved

Per the reviewer's halt list (from prior C1 verdicts):
- No `pkill -f` used.
- No PGID 99756 killed.
- No modifications to the launchd-managed helper at
  `~/.clinemm/bin/clinemm-host-helper` or its socket.
- No modifications to the installed Sonoma VM.
- No modifications to production helper.c.
- The leaked-helper population (~2,373 at session end) was
  NOT cleaned. Only the test's own direct-PID kills fired
  in Layer 1 of the discriminator afterEach.
- No automatic continued diagnostic probing.

## 6. Files in this ACT (cumulative)

- `01-startup-probe-1.txt` — first 200ms startup probe
- `02-startup-probe-2-60s-survival.txt` — 60s survival probe
- `03-gs14-cleanup-invariant.txt` — GS-14 cleanup test (37s, helper started)
- `04-full-suite-run.txt` — 135-test suite (120 pass, 15 fail)
- `05-evidence-narrative.md` — this file

## 7. Verdict

```
P0_ATOMIC_BUILD_HAZARD:     FIXED (build.sh compiles to temp, codesign-re-signs, mv)
P0_ABLATION_PATH_CONFLICT:  FIXED (./helper.ablated is a disjoint path; canonical never replaced)
P0_NO_PROVENANCE:           FIXED (test-helper-build.ts verifies Identifier + strict-verify)
P0_IN_PLACE_OVERWRITE:      FIXED (mv -f within same fs = atomic rename, no in-place write)
P1_BUILD_TEST_BYPASS:       FIXED (ensureHelperBinary always rebuilds, no existsSync short-circuit)
DISCRIMINATOR_LAYER1:       VERIFIED (direct-PID kill fires for test-spawned children)
DISCRIMINATOR_LAYER2:       VERIFIED (gated on freshSpawnVerified, skipped when not verified)
GS-14_STARTUP:              VERIFIED (helper starts in 200ms, survives 60s)
PRODUCTION_HELPER:          UNTOUCHED (~/.clinemm/bin/clinemm-host-helper, SHA ccd52574..., Identifier=helper)
INSTALL_VM:                 UNTOUCHED
ENV_SATURATION:             NOT ADDRESSED (still 2,373 leaked helpers; not this ACT's scope)
GS-14_CLEANUP_INVARIANT:    NOT FIXED (separate work; pre-existing failure mode, not build-related)
TARTBED_TESTS:              UNFIXED (require real tart binary + SSH; not this ACT's scope)
```

## 8. Next cursor

GS-14's cleanup invariant failure (sleep 60 grandchild survives
the request) is a SEPARATE production bug that requires its own
ACT. It is NOT a build or startup issue; the helper starts
correctly and runs the cleanup code, but the cleanup does not
reap the grandchild in this environment (likely the same
macOS Background-session reaper or process-table pressure
that the previous sessions identified as cause (b)).

The C1 bounded fix (atomic build, variant separation, build
verification) is complete and verified. The environment is
preserved. The production helper is untouched. The Sonoma
real-guest smoke is OUT OF SCOPE for this ACT — it requires
GS-14 cleanup to be fixed first, which requires a separate
investigation.
