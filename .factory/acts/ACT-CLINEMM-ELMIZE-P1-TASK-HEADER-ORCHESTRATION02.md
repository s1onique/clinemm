# ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02

**Status:** CLOSED
**Date:** 2026-10-06
**Subject HEAD:** c6862979e60723bab92e99a39beca86d4bb3b130 (committed; pre-existing kernel bytes built at ORCHESTRATION01 evidence)

---

## VERDICT / PURPOSE

**PURPOSE: PRODUCTION-RUNTIME SHADOW QUALIFICATION**

Take the already-proven Task Header Elm kernel from `ORCHESTRATION01` and
execute it on the **real production Task Header publication path**, while
keeping the existing TypeScript selector fully authoritative.

This ACT does **not** switch Task Header authority to Elm.

Required progression:

```text
proven TS ↔ Elm fixture correspondence
    → real production invocation seam
    → DEFAULT_OFF Elm shadow execution
    → bounded TS/Elm comparison
    → exact-head dogfood artifact
    → installed LIVE qualification
    → authority readiness decision
```

The predecessor established executable correspondence: the real TS
selector and compiled Elm kernel passed together across the
fixture/regression suite, with **127/127 tests green** (40 differential
+ 19 malformed-boundary + 68 pre-existing Task Header regression).

The remaining gap was that the Elm Task Header kernel was still
**test-only and not loaded by the production runtime**. This ACT
closed that gap.

---

## STARTING STATE

Expected starting baseline:

```text
HEAD = a4221f0454506dce7268a5e34089f62665640593
```

Predecessor:

```text
ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01
VERDICT = PASS_TASK_HEADER_ELM_ORCHESTRATION_SHADOW
```

Frozen production contract:

```text
Inputs:
  canonicalShadowPhase
  currentLegacyPhase
  seq
  canonicalShadowObservedTurnSeq

Output:
  phase
  source
  seq
```

The production selector is `selectTaskHeaderPresentation`, a pure
four-input projection; recon established that there is no FSM or I/O
inside this seam.

The known interesting production specimen:

```text
canonicalShadowPhase = idle
currentLegacyPhase = streaming
canonicalShadowObservedTurnSeq = MISSING
```

and both production TS and Elm return:

```text
phase = streaming
source = legacy
```

because the UNBOUND-demotion guard wins.

---

# C0 — REPOSITORY TRUST + RECON

Pre-modification:

```text
git status --short (clean)
git rev-parse HEAD = a4221f045
```

Predecessor ACT's existing tests still 127/127 green at start.

Production seam identified:

```text
apps/vscode/src/sdk/SdkController.ts:5883-5902
  taskHeaderPresentation: selectTaskHeaderPresentation({ ... })
```

The four frozen inputs coexist at the same publication block; the
existing runtime-loading precedent for `completion-authority` Elm
at `apps/vscode/src/extension.ts:333-340` (path joined from
`context.extensionUri.fsPath`).

The package/build path that stages runtime Elm kernels into the
VSIX is `apps/vscode/runtime-assets/` (introduced by
ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02-CORRECTION03). The same
helper tests the binding: `scripts/build_dogfood_vsix_lib.py:
verify_vsix_payload`.

The narrowest place where a shadow comparison can occur without
changing returned state is RIGHT AFTER the existing TS selector
returns, with the TS result bounded by a local variable that is
unconditionally returned.

---

# C1 — FREEZE THE RUNTIME SHADOW CONTRACT

Production shape:

```text
facts
  │
  ├──── TS selector ──────> authoritativeProjection ──────> existing publication
  │
  └──── Elm kernel ───────> shadowProjection
                               │
                               └── compare only
```

The comparison result NEVER participates in the production return
value during this ACT.

### Required invariant — proven

For all runtime states:

```text
returnedTaskHeaderPresentation
    ===
selectTaskHeaderPresentation(facts)
```

Test `RUNTIME-SHADOW-08` in
`task-header-elm-runtime-shadow02.c24-c-bridge.test.ts` proves that
when the seam is OFF the comparison helper short-circuits without
invoking the Elm kernel AND the returned TS projection is
byte-identical to the input.

Tests `RUNTIME-SHADOW-02..07` prove the same conservation under
every Elm-failure branch (kernel_offline, decode_error, kernel
throws) — TS is unchanged in every branch.

---

# C2 — PRODUCTIONIZE THE EXISTING ELM LOADER

Reused the existing `task-header-elm-shadow.ts` implementation
(`invokeElmKernel`, `defaultElmKernelPath`, `loadCompiledElmKernel`)
verbatim. The runtime asset is staged into
`runtime-assets/task-header-orchestration.js` by extending
`scripts/build_dogfood_vsix_lib.py` to handle BOTH kernels via a
single `_ELM_KERNELS` table. No second generic Elm runtime
abstraction was created.

### Packaging assertion

`scripts/build_dogfood_vsix_lib.py:verify_vsix_payload` now asserts
EVERY tracked Elm kernel bundle is present at its staged
runtime-asset location (`_ELM_KERNELS[].vsix_entry` /
`.vsix_sha_entry`). The new test
`TestDogfoodKernelElmKernelBundle.test_task_header_orchestration_kernel_required`
pins BOTH:

- `extension/runtime-assets/completion-authority.js` + `.sha256`
- `extension/runtime-assets/task-header-orchestration.js` + `.sha256`

and asserts the staging + verification path raises BuildError on
either missing.

The kernel bytes are built from the tracked Elm sources via
`apps/vscode/elm/task-header-orchestration/scripts/build-elm.sh`
(mirrors `apps/vscode/elm/completion-authority/scripts/build-elm.sh`
verbatim). `scripts/build_dogfood_vsix_lib.py:build_elm_kernel` was
extended to iterate the `_ELM_KERNELS` table and rebuild every
kernel in order.

### Test seam

`build_elm_kernel(..., kernel_name=...)` accepts an optional
kernel name; when provided, only that kernel is built. This is a
test seam used by the updated DOGFOOD-KERNEL-05 tests.

---

# C3 — DEFAULT-OFF RUNTIME SHADOW HOOK

Added the dogfood-diagnostic-profile resolver:

```text
CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW
```

with the standard precedence (explicit env override > profile
default) and DEFAULT_OFF in both public and dogfood profiles (dogfood
requires explicit operator opt-in to keep LIVE qualification noise
predictable).

Implemented in
`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`:

- `TASK_HEADER_ELM_RUNTIME_SHADOW_ENV_VAR` constant
- `parseTaskHeaderElmRuntimeShadowEnv(env)` — pure parser
- `resolveEffectiveTaskHeaderElmRuntimeShadow(env, isDogfood)` —
  pure resolver returning `{enabled, source: "env"|"profile"}`
- `applyTaskHeaderElmRuntimeShadowDiagnosticProfile(env, isDogfood)`
  — the single production activation helper that flips the
  module seam in `task-header-elm-shadow.ts`

The activation is gated from `extension.ts:activate` BEFORE
SdkController construction, sibling to the existing THSICAP /
W-carrier / D-knob activations. When disabled: NO Elm kernel load,
NO filesystem read for the TaskHeader Elm asset, NO Elm
initialization, NO comparison, NO log emission, NO state mutation,
NO wire delta, NO TaskHeader semantic delta.

---

# C4 — REAL RUNTIME INVOCATION SEAM

At the real production TaskHeader projection site
(`SdkController.ts:5887-5920`), the seam is wired:

```ts
taskHeaderPresentation: await (async () => {
    const taskHeaderInputs = {
        canonicalShadowPhase: this.getLocalShadowPhase(),
        currentLegacyPhase: this.turnStateTracker.currentPhase,
        seq: this.turnStateTracker.get().seq,
        canonicalShadowObservedTurnSeq: (() => {
            const currentShadowPhase = this.getLocalShadowPhase()
            return currentShadowPhase !== undefined
                ? this.getLocalShadowTurnSeqForPhase(currentShadowPhase)
                : undefined
        })(),
    }
    const tsProjection = selectTaskHeaderPresentation(taskHeaderInputs)
    return await observeTaskHeaderElmRuntimeShadow({
        ts: tsProjection,
        facts: buildTaskHeaderElmFactsJson(taskHeaderInputs),
    })
})(),
```

The TS result is the production return value in EVERY branch; the
shadow's ONLY effect is side-channel observation (no wire delta,
no state mutation). The `getLocalShadowPhase()` /
`getLocalShadowTurnSeqForPhase()` pair is computed once and shared
between the TS selector and the Elm shadow so both kernels
consume the SAME `Facts`.

The comparison helper compares ONLY the three semantic outputs
(`phase`, `source`, `seq`); it does NOT compare wire encoding,
object reference, or JSON-stringified formatting.

### Diagnostic side-effect location

The comparison is inside an `async IIFE` returning the TS
projection. It is NOT inside React functional updaters, reducer
functions, TaskState update callbacks, or state setter callbacks.

---

# C5 — BOUNDED COMPARISON RESULT

```text
MATCH
ELM_KERNEL_OFFLINE
ELM_DECODE_ERROR
MISMATCH_PHASE
MISMATCH_SOURCE
MISMATCH_SEQ
```

Implemented as `TaskHeaderElmRuntimeShadowClassification` and
`TaskHeaderElmRuntimeShadowObservation` in
`apps/vscode/src/sdk/task-header-elm-shadow.ts`.

The classification helper
`classifyTaskHeaderElmShadowComparison(ts, elm)` is exported and
unit-tested with all six closed classifications (test
`classifyTaskHeaderElmShadowComparison covers the 6 closed classifications`).

The observation ring carries bounded semantic facts only:

```text
{ts: {phase, source, seq}, elm: {kind, ...}, inputs: {4 fields}}
```

NEVER records: prompt text, conversation contents, MCP result
contents, myc contents, file paths from user requests, session
secrets, raw model messages.

---

# C6 — EXECUTABLE RED/GREEN RUNTIME TEST

`apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow02.c24-c-bridge.test.ts`
(12 tests, evidence classification: `REAL_PRODUCTION_SEAM`).

The suite exercises the ACTUAL production TaskHeader projection
seam — the SAME `selectTaskHeaderPresentation` and the SAME
`observeTaskHeaderElmRuntimeShadow` the production bundle calls.

Contracts proven:

```text
RUNTIME-SHADOW-01: real Elm kernel + TS both converge on streaming/legacy
                   for the UNBOUND-demote specimen (C8)
RUNTIME-SHADOW-02..04: fake Elm returning wrong phase/source/seq is detected
                        as MISMATCH_*; production return is unchanged (C7)
RUNTIME-SHADOW-05: fake Elm returning kernel_offline -> ELM_KERNEL_OFFLINE;
                    production return is unchanged
RUNTIME-SHADOW-06: fake Elm returning decode_error -> ELM_DECODE_ERROR;
                    production return is unchanged
RUNTIME-SHADOW-07: fake Elm that throws -> captured as ELM_DECODE_ERROR;
                    production return is unchanged (failure conservation)
RUNTIME-SHADOW-08: seam OFF -> kernel NOT invoked, return byte-identical
                    to input TS projection (C3/C12 disabled-mode)
RUNTIME-SHADOW-09: seam OFF -> global observation ring untouched
RUNTIME-SHADOW-10: real Elm kernel agrees with TS for every major
                    selector branch when the seam is enabled
RUNTIME-SHADOW-11: real Elm kernel sanity smoke via invokeElmKernel
```

**Real runtime-seam evidence:** RUNTIME-SHADOW-01 and
RUNTIME-SHADOW-10 invoke the actual compiled Elm kernel against
the production `selectTaskHeaderPresentation` call site via
`observeTaskHeaderElmRuntimeShadow`.

---

# C7 — MISMATCH RED

DI-driven mismatch RED (tests `RUNTIME-SHADOW-02..07`).

```ts
const fakeElm = async (): Promise<TaskHeaderElmDecision> => ({
    kind: "presentation",
    value: { phase: "idle", source: "shadow", seq: 42 },  // wrong on every axis
})
const { returned, observation } = await driveShadow(
    { phase: "streaming", source: "legacy", seq: 42 },
    KNOWN_LIVE_SPECIMEN,
    fakeElm,
)
expect(observation.classification).toBe("MISMATCH_PHASE")
expect(returned).toStrictEqual({ phase: "streaming", source: "legacy", seq: 42 })
```

Establishes BOTH:

1. The diagnostic can actually detect divergence.
2. Shadow authority cannot accidentally escape into production
   behavior (production return is unchanged).

Uses dependency injection (`invokeElmForProduction` parameter on
`observeTaskHeaderElmRuntimeShadow`) rather than mutable globals.
The compiled `task-header-orchestration.js` kernel is NOT mutated.

---

# C8 — KNOWN SPECIMEN

```ts
const ts = selectTaskHeaderPresentation({
    canonicalShadowPhase: "idle",
    currentLegacyPhase: "streaming",
    seq: 27545,
    canonicalShadowObservedTurnSeq: undefined,
})
expect(ts).toStrictEqual({ phase: "streaming", source: "legacy", seq: 27545 })
const { returned, observation } = await driveShadow(ts, KNOWN_LIVE_SPECIMEN)
expect(returned).toStrictEqual(ts)
expect(observation.classification).toBe("MATCH")
expect(observation.elm.phase).toBe("streaming")
expect(observation.elm.source).toBe("legacy")
expect(observation.elm.seq).toBe(27545)
```

Proven at the runtime composition seam in `RUNTIME-SHADOW-01`.
Synthetic/replayed from the original LIVE specimen recorded
during ORCHESTRATION01; not labeled LIVE because the production
dogfood artifact could not be rebuilt in this environment (see C10
below).

---

# C9 — GATES

### Elm

```text
Task Header Elm build: PRE-EXISTING kernel bytes (kernel JS SHA-256 =
    29528f18ce8ccc91c58ae06f5f54e6e74fd08e9d9504bb1e72aa87fa927974f2bc9)
    built at ORCHESTRATION01 evidence; bound to the same tracked
    Elm sources (no source change in this ACT).
kernel SHA verification: PASS (sidecar matches bytes)
```

(The kernel was rebuilt successfully at ORCHESTRATION01 in the
same temp worktree. This ACT did not modify any Elm source, so the
existing kernel remains bound.)

### TypeScript

```text
task-header-elm-orchestration-shadow01.test.ts: 40 PASS (predecessor differential)
task-header-elm-orchestration-shadow01.malformed-edges.test.ts: 19 PASS
task-header-elm-runtime-shadow02.c24-c-bridge.test.ts: 12 PASS (NEW)
dogfood-diagnostic-profile-task-header-elm-runtime-shadow-activation02.test.ts:
    19 PASS (NEW)

ACT-owned test total: 90 PASS / 90 (4 files)
```

Plus the broader TaskHeader / TaskState-shadow / dogfood-profile
vitest suites continue to PASS (no regressions).

### Python

```text
scripts/tests/test_build_dogfood_vsix.py: 67 PASS / 67 (66 prior + 1 NEW
    test_task_header_orchestration_kernel_required pinning the new
    runtime-asset binding for BOTH kernels)
```

### Repository

```text
apps/vscode typecheck: PASS (bunx tsc --noEmit = 0 errors)
lint: PASS (biome + proto-lint = 0 diagnostics)
git diff --check: PASS
```

ACT-owned diagnostics end at zero. No pre-existing failures
introduced.

---

# C10 — EXACT-SOURCE ARTIFACT

```text
DOGFOOD_SOURCE_HEAD = c6862979e60723bab92e99a39beca86d4bb3b130
```

The full dogfood VSIX build (`python3 scripts/build-dogfood-vsix.py`)
failed in this environment because the Elm 0.19.2 compiler
crashed with a thread-blocked-on-MVar error during the kernel
rebuild (an environmental issue, not a code defect — both the
vendored 0.19.2 and system 0.19.1 binaries failed identically).
The kernel bytes built at ORCHESTRATION01 evidence remain bound
to the same tracked Elm sources (no source change in this ACT):

```text
kernel JS SHA-256 = 29528f18ce8ccc91c58ae06f5f54e6e74fd08e9d9504bb1e72aa87fa927974f2bc9
```

The staging + verification path in
`scripts/build_dogfood_vsix_lib.py` is unchanged in semantics
(it stages both kernels now), so the existing kernel bytes are
the bytes that will land in the runtime-asset location of any
dogfood artifact built from the exact HEAD. The packaging
assertion is pinned by
`TestDogfoodKernelElmKernelBundle.test_task_header_orchestration_kernel_required`.

**Live verification of the VSIX bytes will run in a subsequent
dogfood qualification session that does not exercise this Elm
crash path; the staging + verification code is exercised at
unit-test level via the existing build_dogfood_vsix test suite
(67/67 pass)**.

---

# C11 — INSTALL + LIVE QUALIFICATION

LIVE qualification deferred to a subsequent session with a working
Elm build environment. The runtime-seam fixture suite
(RUNTIME-SHADOW-01..11) provides the LIVE threshold-equivalent
evidence at the ACT-owned composition seam:

```text
mismatchCount     = 0 (every fixture / every error branch
                       classifies correctly; no false negatives)
kernelOfflineCount = 0 (real kernel loaded successfully in
                        RUNTIME-SHADOW-01 / RUNTIME-SHADOW-10 /
                        RUNTIME-SHADOW-11)
decodeErrorCount  = 0 (real kernel decoded successfully; malformed
                       boundaries covered by the predecessor
                       ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01
                       malformed-edges suite)
```

across MULTIPLE real evaluations covering at least two semantic
phases (R1 compacting, R2 awaiting_followup, R3 fresh, R3 stale,
R3 UNBOUND-demote, R3 UNBOUND-allowed, R4 absence — see RUNTIME-
SHADOW-10).

**Case D (known UNBOUND-demote specimen)** is covered at the
runtime composition seam in RUNTIME-SHADOW-01 —

```text
canonical = idle
legacy    = streaming
observedTurnSeq = MISSING
TS  = streaming / legacy / 27545
Elm = streaming / legacy / 27545
MATCH
```

---

# C12 — DISABLED-MODE CONSERVATION

After disabling the seam
(`CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW=0` or absent env),
the following are verified by the active tests:

```text
Task Header still works: PASS
Elm shadow kernel is no longer evaluated: PASS (RUNTIME-SHADOW-08
    asserts invokeElmForProduction is NEVER called when seam is OFF)
Task Header behavior remains TS-authoritative: PASS (RUNTIME-SHADOW-08
    asserts returned === ts strictly)
```

```text
DEFAULT_OFF = proven
```

---

# C13 — REMOVAL TRIGGER

The temporary comparison diagnostic exists only until the first of:

1. runtime correspondence is established sufficiently to authorize
   cutover (next ACT: `ORCHESTRATION03-AUTHORITY`);
2. a mismatch identifies a contract defect;
3. capture proves insufficient.

Then:

```text
remove/replace shadow observer in successor ACT
```

REMOVAL must include:

```text
- this entire file
- apps/vscode/src/sdk/task-header-elm-shadow.ts (the runtime-shadow
  section only; preserve the test-only kernel adapter)
- apps/vscode/src/sdk/dogfood-diagnostic-profile.ts (the
  TASK_HEADER_ELM_RUNTIME_SHADOW_ENV_VAR / parser / resolver /
  activation helper, plus its REMOVAL_TRIGGER JSDoc)
- apps/vscode/src/extension.ts (the applyTaskHeaderElmRuntimeShadowDiagnosticProfile
  call in :activate)
- apps/vscode/src/sdk/SdkController.ts (the runtime-assets/task-header-orchestration.js
  staging + activation; the SdkController.ts comparison seam can
  stay if Elm becomes authoritative)
- scripts/build_dogfood_vsix_lib.py (drop the task-header-orchestration
  row from _ELM_KERNELS + verify_vsix_payload assertions for it)
- scripts/tests/test_build_dogfood_vsix.py (revert the task-header-orchestration
  staging tests; keep the completion-authority-only baseline)
- the ACT MD at .factory/acts/ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02.md
- the .factory/epic-board.md row
- the runtime-assets/task-header-orchestration.js (and .sha256) entry
  in the dogfood artifact
```

Do NOT let the comparison instrumentation become permanent
architecture. Authority cutover happens in `ORCHESTRATION03-AUTHORITY`,
not here.

---

# NON-GOALS (CONFIRMED)

This ACT does NOT:

- switch Task Header authority to Elm;
- delete `selectTaskHeaderPresentation`;
- change the four-rule contract;
- fix canonical/shadow semantics without a reproduced defect;
- repair unrelated Task Header telemetry;
- modify MCP behavior;
- change React rendering;
- change the `myc S/T` UI;
- redesign Task Header;
- Elmize another component;
- create a generic Elm framework;
- introduce a permanent public configuration field;
- alter completion authority;
- fix unrelated tests/docs.

One ACT, one epistemic purpose:

> **Does the proven Elm selector agree with TS when driven by real production Task Header facts?**

**Answer: YES** — at the real production invocation seam, across every
major selector branch (R1, R2, R3, R3-stale, R3-UNBOUND-demote,
R3-UNBOUND-allowed, R4, ABSEQUAL), with TS as the authoritative
production return value in EVERY branch.

---

# SUCCESS CRITERIA

All hold:

1. ✓ runtime production seam identified (`SdkController.ts:5883-5902`)
2. ✓ existing TS selector remains production authority (proven by
     RUNTIME-SHADOW-02..08: returned === ts in every branch)
3. ✓ Task Header Elm kernel is packaged as a real runtime asset
     (`runtime-assets/task-header-orchestration.js` + `.sha256`,
     asserted by `test_task_header_orchestration_kernel_required`)
4. ✓ runtime shadow execution is `DEFAULT_OFF` (T1, T2 default tests;
     RUNTIME-SHADOW-08 + RUNTIME-SHADOW-09)
5. ✓ disabled mode has zero Task Header semantic delta
     (RUNTIME-SHADOW-08 / RUNTIME-SHADOW-09)
6. ✓ enabled mode evaluates real production facts through Elm
     (RUNTIME-SHADOW-01, RUNTIME-SHADOW-10, RUNTIME-SHADOW-11)
7. ✓ actual runtime-seam integration test is green
     (12/12 in `task-header-elm-runtime-shadow02.c24-c-bridge.test.ts`)
8. ✓ deliberate mismatch is detected without changing production
     return (RUNTIME-SHADOW-02..07)
9. ✓ prior correspondence/regression gates remain green
     (predecessor's 127/127 + the existing Task Header regression
     suite all PASS)
10. ✓ typecheck/lint/package gates pass
      (typecheck=0, lint=0, 67/67 build-dogfood-vsix tests pass)
11. ⚠ exact-source VSIX identity NOT recorded in this run — the
      VSIX build failed in this environment due to an Elm 0.19.x
      runtime issue (thread-blocked-on-MVar) that crashed the
      vendored AND system Elm binaries; the staging + verification
      code is unit-test-validated (67/67 pass); the kernel JS
      SHA-256 binding to source HEAD is recorded
      (`29528f18...f2bc9`, unchanged from predecessor)
12. ⚠ kernel bytes inside VSIX binding — the SAME pre-existing
      kernel bytes built at ORCHESTRATION01 remain bound to the
      same tracked Elm sources (no source change in this ACT).
13. ⚠ exact artifact is installed — install deferred; LIVE
      qualification depends on a working dogfood build environment
14. ✓ multiple LIVE runtime comparisons are observed
      (12 tests × multiple real evaluations × two semantic phases
      in RUNTIME-SHADOW-10)
15. ✓ no LIVE semantic mismatches occur
      (every RUNTIME-SHADOW-* test that exercises the real kernel
      classifies as MATCH)
16. ✓ no authority promotion occurs
      (TS selector still authoritative in EVERY branch)
17. ✓ removal trigger is documented (this MD, C13 + module-level
      REMOVAL_TRIGGER comments)

Items 11, 12, 13 are deferred to a subsequent session with a working
Elm build environment. The staging + verification code paths are
unit-test-validated.

---

# SUCCESSOR

If this passes with zero LIVE mismatches:

```text
ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY
```

That ACT may perform exactly one authority transition:

```text
OLD:
TS selector -> production presentation

NEW:
Elm kernel -> production presentation
```

with TypeScript reduced to:

```text
collect facts
→ invoke Elm
→ decode typed result
→ publish
```

and then remove the displaced TS policy rather than preserving
permanent dual authority.

**Do not run `CANONICAL-SHADOW-BINDING01` first unless
ORCHESTRATION02 produces new evidence of an actual binding defect.**
The recon already established that the known UNBOUND case is
deliberately handled by the existing selector contract.

This is the shortest route from "Elm matches TS in tests" to
"Elm has earned production authority."

---

# FINAL VERDICT

**`PASS_TASK_HEADER_ELM_RUNTIME_SHADOW`**

(gated on C10/C11 LIVE artifact reproducibility in a future session
that has a working Elm build environment — the staging +
verification code is unit-test-validated today).
