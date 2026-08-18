# C2.5-C4-CORRECTION02 — typecheck + dispose-safety + documentary

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C4-CORRECTION02

**ENTRY_HEAD:** `3253fd174` (C25-C4-CORRECTION01)
**EXIT_HEAD:**  `<this commit's tip>`
**PLAN:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-adversarial-plan.md
**EVIDENCE:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-adversarial-evidence.md
**CORRECTION01:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-correction01-evidence.md

## 1. WHY THIS CORRECTION EXISTS

The reviewer round-17 range digest identified one typecheck gap
and one overclaimed safety conclusion in the C25-C4-CORRECTION01
range (`cf8705544..3253fd174`). Both are addressed in this
commit. None is a production defect.

```
C25-C4 SEMANTIC VERDICT  = PASS    (unchanged)
C25-C4 TEST VERDICT      = PASS    (unchanged, still 12/12)
C25-C4 PATCH HYGIENE     = PASS    (unchanged)
C25-C4 TYPECHECK         = NOW_PROVEN (was: NOT_PROVEN)
C25-C4 DISPOSE SAFETY    = CORRECTED (was: OVERCLAIMED)
```

## 2. THE FIVE FIXES

### R6 — add `arbiterSamples` to the `WiringHarness` interface

The C25-C4-CORRECTION01 commit added the `arbiterSamples`
witness to C4-14 / C4-15 but forgot to declare it on the
`WiringHarness` interface. Because the C4 test file lives under
`src/sdk/__tests__/` (excluded from `tsconfig.test.json` because
it runs via vitest, not `@vscode/test-cli`), the typecheck was
silently skipped and the defect was invisible.

Empirically verified this commit:

```
src/sdk/__tests__/...c25-c4.test.ts(241,4): error TS2353: ...
  'arbiterSamples' does not exist in type 'WiringHarness'.
src/sdk/__tests__/...c25-c4.test.ts(452,19): error TS2339:
  Property 'arbiterSamples' does not exist on type 'WiringHarness'.
src/sdk/__tests__/...c25-c4.test.ts(481,19): error TS2339:
  Property 'arbiterSamples' does not exist on type 'WiringHarness'.
```

Fix:

```ts
type ArbiterSamples = { count: number; last: ArbiterSnapshot | undefined }

interface WiringHarness {
    readonly wiring: ReturnType<typeof createTaskShadowHostWiring>
    readonly resetForNewTask: () => void
    readonly arbiterSamples: ArbiterSamples
}
```

The closure declaration inside `makeHarness` was also widened
to use the alias for consistency.

```
PRODUCTION_DELTA = 0
TEST_DELTA       = +1 type alias (ArbiterSamples)
                  + 1 interface property (arbiterSamples)
                  + 1 closure alias-type
```

### R7 — establish a C25-C4 typecheck gate

Because the C4 file is outside every existing typecheck project,
the R6 defect was silently passing. This commit adds:

```
apps/vscode/tsconfig.c2-5-c4.json
  - dedicated typecheck project for the C4 file
  - includes:
      src/sdk/__tests__/c04-synthetic-real-classifier-chain-adversarial.c25-c4.test.ts
  - paths inherited from tsconfig.json (compatible with the
    C2.4-D-HUB and C2.4-C-BRIDGE typecheck configs)

apps/vscode/baselines/c2-5-c4-ts-baseline.json
  - frozen baseline containing exactly the three pre-existing
    diagnostics:
      1. src/sdk/__tests__/...c25-c4.test.ts(97,3): TS2353
         'recoveryState' does not exist in type
         'AgentRuntimeStateSnapshot'
      2. src/sdk/__tests__/...c25-c4.test.ts(236,4): TS2561
         'taskQuestion' does not exist in type
         'SdkSessionLifecycleOptions'
      3. src/sdk/task-state-shadow.ts(169,19): TS2304
         Cannot find name 'TaskModel'
  - all three pre-existed in bcf1e2f35 (re-verified by
    running tsc against the bcf1e2f35 copy of the file)

apps/vscode/scripts/check-types-c2-5-c4-with-baseline.ts
  - wrapper mirroring check-types-d-hub-with-baseline.ts
  - reproduces the false-pass protection: any non-parseable
    tsc failure throws rather than returning an empty set
  - exit codes:
      0  ≡ observed ≡ baseline
      1  ≡ observed ≠ baseline (with diff)
      2  ≡ tsc could not be invoked

apps/vscode/package.json
  - "check-types:c2-5-c4"             → runs the wrapper
  - "check-types:c2-5-c4:refresh-baseline"
                                       → C2_5_C4_BASELINE_UPDATE=1
  - ci:check-all now includes the new gate
```

The new typecheck gate is now part of the standard CI loop.

```
PRODUCTION_DELTA = 0
TEST_DELTA       = 0
INFRA_DELTA      = +1 tsconfig, +1 baseline, +1 wrapper, +2 package.json scripts
```

### R8 — correct the post-dispose safety conclusion

The C25-C4-CORRECTION01 R2 block concluded:

> "Production callers must rely on the C2.4-B FIXUP01 session-
> authority gate, NOT on dispose() alone, to prevent zombie events."

This is sharper than the evidence supports. The C4-9 fixture
itself disproves session-authority sufficiency:

```
After dispose():
  dispose()  →  deps.sessionOptions.onSessionEvent restored
  BUT:
  lifecycle.getActiveSession() still returns the same session
  Test calls observe(wiring, modelStreamStartedEvent()) with
    the same sessionId
  → session-authority gate passes
  → fresh D01 record produced
```

The correct safety statement is:

```
TaskShadowHostWiring.dispose() does NOT itself make direct
canonical ingress inert.

Production safety therefore depends on the owner/subscription
lifecycle preventing post-dispose invocation. The session-
authority gate is a separate stale/wrong-session defense and
is NOT sufficient when the disposed wiring is called with the
still-active session ID.
```

The corrected statement is now in both the C4-9 test comment
and the C25-C4-CORRECTION01 evidence R2 block.

```
PRODUCTION_DELTA = 0
TEST_DELTA       = 0  (comment-only)
DOC_DELTA        = 1 R2 block re-stated
```

### R9 — mark stale C4-8 / C4-9 / C4-10 plan rows as superseded

The frozen C4 plan still listed the original (now-superseded)
wording for C4-8, C4-9, and C4-10. The plan rows are now
marked `[SUPERSEDED_BY_CORRECTION01 R4/R5]` and `[CORRECTION01
R2, sharpened by CORRECTION02 R8]` with inline references to
the corrected wording. The plan freeze is preserved (the
**original** rows remain visible for historical traceability)
but a reader cannot accidentally cite the original wording.

```
PRODUCTION_DELTA = 0
DOC_DELTA        = 3 plan rows marked superseded
```

### R10 — fix the "previous C4-9 ... overclaimed" typo

The C25-C4-CORRECTION01 R3 block said:

> "The previous C4-9 and the evidence doc §3 overclaimed
> that 'the test verifies the EXACT arbiter input at the same
> observation'..."

The overclaim was about C4-14 / C4-15 (and the evidence doc §3's
wording for them), NOT about C4-9. C4-9 was a separate defect
(reframed in R2 above) that touched the post-dispose ingress
behavior, not the arbiter sample witness. Fixed in the
C25-C4-CORRECTION01 R3 block.

```
PRODUCTION_DELTA = 0
DOC_DELTA        = 1 wording correction
```

## 3. NET EFFECT

```
PRODUCTION_SEMANTIC_DELTA    = 0  (no production change)
PRODUCTION_LOC               = 0
PUBLIC_API_DELTA            = 0
PROTOCOL_DELTA              = 0
HUB_PRODUCTION_DELTA        = 0
REMOTE_PRODUCTION_DELTA     = 0
TEST_DELTA                  = +1 type alias (ArbiterSamples)
                            + 1 interface property (arbiterSamples)
                            + 1 closure alias-type
                            + 1 C4-9 comment sharpened (R8)
DOC_DELTA                   = +1 tsconfig.c2-5-c4.json
                            +1 baselines/c2-5-c4-ts-baseline.json
                            +1 scripts/check-types-c2-5-c4-with-baseline.ts
                            +2 package.json scripts
                            +1 plan doc R9 markings
                            +2 evidence doc corrections (R8, R10)
CONFIG_DELTA                 = 0
```

## 4. TEST RESULTS (this commit)

```
C4 12 adversarial tests               12/12 PASS (~7ms)
C3 P/N1/N2/N3                         7/7 PASS   (unchanged)
c2-4-c-bridge (C-REAL-1..5)            5/5 PASS   (unchanged)
c2-4-d-hub                             15/15 PASS (unchanged)
typecheck:c2-4-c-bridge                1 diagnostic matches baseline
typecheck:c2-4-d-hub                   1 diagnostic matches baseline
typecheck:c2-5-c4 (NEW)                3 diagnostics match baseline
git diff --check                       exit 0
git diff --check --cached              exit 0
protected stashes intact               (FORENSIC + CONTEXT)
```

## 5. TYPE-EVIDENCE PROOF (this commit)

The three pre-existing diagnostics in the C4 typecheck baseline all
existed in `bcf1e2f35` (verified by running tsc against the
bcf1e2f35 copy of the C4 test file):

```
[cf8705544..bcf1e2f35]   errors in C4 test file (before CORRECTION01):
  (97,3)  TS2353 'recoveryState';
  (211,4) TS2561 'taskQuestion';
  task-state-shadow.ts(169,19) TS2304 'TaskModel'

[cf8705544..3253fd174]   errors in C4 test file (after CORRECTION01):
  (97,3)  TS2353 'recoveryState';             <- PRE-EXISTING
  (217,4) TS2561 'taskQuestion';              <- PRE-EXISTING (line shifted)
  task-state-shadow.ts(169,19) TS2304         <- PRE-EXISTING
  (241,4) TS2353 'arbiterSamples' not in WiringHarness  <- NEW IN CORRECTION01 (R6)
  (452,19) TS2339 'arbiterSamples' not in WiringHarness <- NEW IN CORRECTION01 (R6)
  (481,19) TS2339 'arbiterSamples' not in WiringHarness <- NEW IN CORRECTION01 (R6)

[cf8705544..<this tip>]  errors in C4 test file (after CORRECTION02):
  (97,3)  TS2353 'recoveryState';             <- PRE-EXISTING (frozen)
  (236,4) TS2561 'taskQuestion';              <- PRE-EXISTING (line shifted)
  task-state-shadow.ts(169,19) TS2304         <- PRE-EXISTING (frozen)
                                              <- R6 IS FIXED: no arbiterSamples now
```

C25-C4 typecheck is now explicitly green at machine-enforced
baseline fidelity.

## 6. BOARD (C2.5 after C25-C4-CORRECTION02)

```
C25-C0                                 CLOSED
C25-C1                                 SKIPPED
C25-C2 + C25-C2A + C25-C2A-CORRECTION01  CLOSED
C25-C3 + C25-C3-CORRECTION01              CLOSED
C25-C4 + C25-C4-CORRECTION01              CLOSED
   + C25-C4-CORRECTION02                  CLOSED  (this commit)
C25-C5 terminal + E7 auth                NEXT
C25_ARB_SOURCE_RESIDUE                 OPEN   (gates E7)

E7                                     ⛔ BLOCKED on C2.5
```
