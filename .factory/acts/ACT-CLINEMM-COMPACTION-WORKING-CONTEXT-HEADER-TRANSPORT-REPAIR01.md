
# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01

## State (twentieth-pass, 2026-09-03)

```text
W producer                = CLOSED
W cadence                 = CLOSED
runtime state             = CLOSED
runtime publication       = CLOSED
durable transition tests  = CLOSED
HOST_PUBLICATION          = COMPOSED PROOF / ACCEPTED
NO_INDEPENDENT_W_SCALAR_ON_EVENT = TRUE

Boundary 3 capture        = CLOSED
Boundary 3 -> 4 transport = CLOSED
Boundary 4 webview state  = CLOSED
Boundary 5 header         = OPEN  (next cycle)

NECESSITY_OF_HOST_CAPTURE = PROVEN
NEW_REVIEW_ROUND          = NO
C1                        = GO_P3_B5 (next cycle)
```

Reviewer on c8897640d:
```text
HALT_REPAIR_WITHOUT_REPRODUCED_RED.
Implementation plausible; vacuous `{} as Extension
State` removed; intentionally failing default test
removed; assignment semantics explicit; W transported
not recomputed.
However the repair crossed the boundary without an
executable RED/necessity witness at the production
projection seam. P1: the visible tests exercise
capture + extracted helper, not the actual
getStateToPostToWebview producer.
C1: GO_P3 (NECESSITY_ABLATION_REQUIRED).
```

## A/B necessity/ablation (this commit)

```text
A:
  capture.observe(W=271337) + REAL getStateToPostTo
    Webview
  → payload.currentWorkingContextEstimate === 271337

B (ABLATION):
  capture.observe NEVER CALLED + REAL getStateTo
    PostToWebview
  → payload.currentWorkingContextEstimate ===
    undefined

A' (RESTORE):
  same capture, observe(W=271337) again + REAL
    getStateToPostToWebview
  → payload.currentWorkingContextEstimate === 271337

CONTROL (missing carrier):
  legacy / classic path with no carrier
  → payload.currentWorkingContextEstimate ===
    undefined (NOT 0, NOT last-known)

WIRING WRAP (P1_2):
  SdkController wrap pattern over a fake
    TaskShadowHostWiring
  → capture.observe(event) runs BEFORE
    wiring.observeCanonicalRuntimeEvent(input)
  → carrier holds W AND wiring saw the same
    envelope

WIRING WRAP FAIL-CLOSED:
  same wrap, drive a no-W event
  → carrier transitions to undefined
  → wiring saw the event envelope
```

NECESSITY_OF_HOST_CAPTURE = PROVEN: removing
the capture.observe call (B) brings back the defect
on the same producer; restoring it (A') flips GREEN
again.

## Production code (UNCHANGED this commit)

The repair is GREEN already. This commit only adds
the load-bearing evidence (A/B ablation + wiring
wrap tests). No production code is touched.

```text
NEW (already landed in c8897640d):
  apps/vscode/src/sdk/working-context-host-
  capture.ts
    WorkingContextHostCapture class.
    Assignment semantics on observe().
  apps/vscode/src/core/controller/state/
  working-context-state-projection.ts
    Pure projection helper extracted from
    getStateToPostToWebview.
  apps/vscode/src/sdk/__tests__/
  working-context-webview-state-projection.test.ts
    (this commit extends it; no production change)

MODIFIED (already landed in c8897640d):
  apps/vscode/src/shared/ExtensionMessage.ts
    ExtensionState.currentWorkingContextEstimate.
  apps/vscode/src/core/controller/state/
  getStateToPostToWebview.ts
    Delegates to the pure helper.
  apps/vscode/src/sdk/SdkController.ts
    Owns the carrier; wraps the existing
    TaskShadow wiring.

REMOVED (already landed in c8897640d):
  apps/vscode/src/sdk/__tests__/
  working-context-projection-p3.red01.test.ts
    (synthetic RED + recon probes).
```

## Sentinels

```text
P = 364_900   (provider / last api_req_started
                payload)
W = 271_337   (synthetic currentWorkingContext
                Estimate; deliberately distinct
                from live 264.3k which remains
                screenshot evidence only)
```

## Conservation (permanent)

```text
apps/vscode MUST NOT import / use:
  estimateRequestInputTokens
  estimateMessageTokens
for this projection. Enforced permanently by the
estimator-import probe in the GREEN test file.

UNDEFINED_W_STALE_REUSE = FORBIDDEN:
  enforced at the carrier layer (unconditional
  assignment on observe()) — see
  apps/vscode/src/sdk/working-context-host-capture.ts.
  Pinned by:
    test #2  (direct .observe(undefined))
    test #6  (W sequence with undefined transitions)
    WIRING WRAP FAIL-CLOSED (no-W event through
      the wrap clears the carrier).

P remains available for provider / request metrics.
H_b / H_a remain compaction telemetry.
getApiMetrics Strategy-D stays untouched.
```

## Verification

```text
$ bunx vitest run --config vitest.config.ts \
    src/sdk/__tests__/working-context-webview-
    state-projection.test.ts
  Test Files 1 passed (1)
  Tests      13 passed (13)

$ bun tsc --noEmit -p apps/vscode/tsconfig.json
  3 errors (== baseline; pre-existing in
   sdk-compaction.ts and
   task-state-shadow-coordinator.ts)

$ bunx vitest run (agents):
  Test Files 24 passed (24)
  Tests      408 passed (408)

$ bunx vitest run (core/src/extensions/context/):
  Test Files 5 passed | 1 skipped (6)
  Tests      116 passed | 1 skipped (117)
```

## Disposition

```text
BOUNDARY_RECON             = PASS / USEFUL
BOUNDARY_3_CAPTURE         =
  SYNTHETIC_REAL / PASS
BOUNDARY_3_TO_4_TRANSPORT  =
  SYNTHETIC_REAL / PASS
HOST_PUBLICATION           =
  COMPOSED PROOF / ACCEPTED
NECESSITY_OF_HOST_CAPTURE  = PROVEN
NO_INDEPENDENT_W_SCALAR    = TRUE
UNDEFINED_W_STALE_REUSE    = FORBIDDEN

RED                        =
  HISTORICAL (a04387552;
   superseded by A/B
   ablation)
PRE_REPAIR_RED             =
  historical / invalid witness
  (vacuous assertion against
   `{} as ExtensionState`)
POST_HOC_NECESSITY_ABLATION =
  SYNTHETIC_REAL / PASS
GREEN                      =
  SYNTHETIC_REAL / PASS
CAUSAL_COMPOSITION         =
  live UX symptom
  + structural missing host
    capture at entry
  + exact-edge ablation
    (capture.observe never called)
  + GREEN repair
    (capture.observe fired)

NEW_REVIEW_ROUND           = NO
C1                         = GO_P3_B5
```

## Commit lineage

```text
c7:  STATE_BIND       (aec3ff0c6)
c8:  PUBLICATION_BIND (05ccaaf66)
                              GO_PUBLICATION_BIND
c9:  TEST_CORRECTION  (bb5588150)
                              GO_P3
c10: P3_GO_SIGNAL     (c3c00cb45)
                              GO_P3
c11: P3_BOUNDARY_BIND (a04387552)
          (synthetic RED)
                              GO_P3 (real GREEN required)
c12: P3_GREEN         (c8897640d)
          + REAL_PRODUCTION_SEAM_GREEN
          + INTENTIONALLY_FAILING_RED_REMOVED
                              HALT_REPAIR_WITHOUT_
                                REPRODUCED_RED
                              (necessity ablation required)
c13: P3_NECESSITY_ABLATION (this commit)
          + A/B ABLATION on REAL getStateToPostToWebview
          + WIRING WRAP (P1_2) test on SdkController-style
            wrap pattern
                              GO_P3_B5 (next cycle)
```

## Next bounded cycle (separate commit,
NOT this commit)

```text
Boundary 5: ChatView / TaskHeader consumes W
for the numerator (when present) instead of P
(lastApiReqContextInputTokens).

UNDEFINED_W_FALLBACK (per reviewer preference,
twentieth-pass):
  default to B = unavailable/unknown rather
  than A = silently fall back to P.
  Why: P and W are explicitly different truth
  domains. Silently swapping them without
  telling the user is the category of bug this
  chain has been eliminating.

Decision binds from the existing
ContextWindow.tsx:167 null-fallback contract.

PRODUCTION_REWORK         = NONE (this commit
                              only adds evidence)
TYPECHECK_DELTA           = ZERO
DEFAULT_SUITE_STATE       = GREEN
NEW_REVIEW_ROUND          = NO
C1                        = GO_P3_B5
