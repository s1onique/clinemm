
# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01

## State (nineteenth-pass, 2026-09-03)

```text
W producer                = CLOSED
W cadence                 = CLOSED
runtime state             = CLOSED
runtime publication       = CLOSED
durable transition tests  = CLOSED
HOST_PUBLICATION          = COMPOSED PROOF / ACCEPTED
NO_INDEPENDENT_W_SCALAR_ON_EVENT = TRUE

Boundary 3 capture        = CLOSED (this commit)
Boundary 3 -> 4 transport = CLOSED (this commit)
Boundary 4 webview state  = CLOSED (this commit)
Boundary 5 header         = OPEN  (next cycle)

P0 / P1 / P2              = NONE
NEW_REVIEW_ROUND          = NO
C1                        = GO_P3_B5 (next cycle)
```

Reviewer on a04387552:
```text
HALT_RED_NOT_BOUND_TO_PROJECTION_SEAM.
C1: GO_P3 (real GREEN in this cycle).
```

## Boundary 3 -> 4 GREEN (this commit)

```text
AgentRuntime.emit(working-context-state-changed)
  snapshot.currentWorkingContextEstimate = W
   ↓
LocalRuntimeHost.subscribeRuntimeEvents fanout
   ↓
SdkController.attachCanonicalRuntimeEventSubscription
  wraps the existing TaskShadow wiring:
    1. workingContextHostCapture.observe(event)
         -> assignment semantics (UNDEFINED_W_STALE_
            REUSE = FORBIDDEN enforced at this layer)
    2. wiring.observeCanonicalRuntimeEvent(input)
         (shadow wiring unchanged)
   ↓
projectWorkingContextStateFromCarrier(capture)
  (PURE helper — single source of truth for
   the transport contract)
   ↓
getStateToPostToWebview delegates to the helper
   ↓
ExtensionState.currentWorkingContextEstimate = W
```

## Production code (this commit)

```text
NEW:
  apps/vscode/src/sdk/working-context-host-capture.ts
    WorkingContextHostCapture class.
    Assignment semantics on observe() —
    UNDEFINED_W_STALE_REUSE = FORBIDDEN is enforced
    at this layer (no conditional skip).

  apps/vscode/src/core/controller/state/
  working-context-state-projection.ts
    Pure projection helper extracted from
    getStateToPostToWebview so the W transport
    can be unit-tested without an extension-host
    bootstrap. Bigger function delegates to it
    (single source of truth).

MODIFIED:
  apps/vscode/src/shared/ExtensionMessage.ts
    ExtensionState.currentWorkingContextEstimate
    added (typed carrier into the webview).

  apps/vscode/src/core/controller/state/
  getStateToPostToWebview.ts
    Threads controller.workingContextHostCapture
    into the pure helper. Transport-only.

  apps/vscode/src/sdk/SdkController.ts
    Owns the carrier; wraps the existing
    TaskShadow wiring so the canonical event
    stream populates the carrier before
    forwarding to the shadow wiring (wiring
    itself unchanged).
```

## Sentinels

```text
P = 364_900   (provider / last api_req_started payload)
W = 271_337   (synthetic currentWorkingContextEstimate;
                deliberately distinct from live 264.3k
                which remains screenshot evidence only)
```

## Conservation (permanent)

```text
apps/vscode MUST NOT import / use:
  estimateRequestInputTokens
  estimateMessageTokens
for this projection. The carrier and the projection
helper are transport only; the producer delegates
to the helper.

Enforced permanently by the estimator-import probe
in the GREEN test file.

UNDEFINED_W_STALE_REUSE = FORBIDDEN:
  enforced at the carrier layer (unconditional
  assignment on observe()) — see
  apps/vscode/src/sdk/working-context-host-capture.ts.
  A no-W event sets the slot to undefined, NOT
  preserved as the prior W.

P remains available for provider / request metrics.
H_b / H_a remain compaction telemetry.
getApiMetrics Strategy-D stays untouched.
```

## Verification

```text
$ bunx vitest run --config vitest.config.ts \
    src/sdk/__tests__/working-context-webview-state-
    projection.test.ts
  Test Files 1 passed (1)
  Tests      7 passed (7)

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
BOUNDARY_RECON            = PASS / USEFUL
                             (legacy adapter is a
                              side branch, not on
                              the W transport path)
BOUNDARY_3_CAPTURE        = SYNTHETIC_REAL / PASS
BOUNDARY_3_TO_4_TRANSPORT = SYNTHETIC_REAL / PASS
HOST_PUBLICATION          = COMPOSED PROOF / PASS
NO_INDEPENDENT_W_SCALAR_ON_EVENT = TRUE
UNDEFINED_W_STALE_REUSE   = FORBIDDEN
RED                       =
  NOT_REPRODUCED_AT_HEAD
  (real production-seam GREEN in this commit;
   intentionally failing test removed)
NEW_REVIEW_ROUND          = NO
C1                        = GO_P3_B5
```

## Commit lineage

```text
c7:  STATE_BIND       (aec3ff0c6)
c8:  PUBLICATION_BIND (05ccaaf66)
                              └─ C1: GO_PUBLICATION_BIND
c9:  TEST_CORRECTION  (bb5588150)
          + P2_TERMINOLOGY
                              └─ C1: GO_P3
c10: P3_GO_SIGNAL     (c3c00cb45)
          + FACTORY_COMPACT
                              └─ C1: GO_P3
c11: P3_BOUNDARY_BIND (a04387552)
          + P1_TEXT_FIX
          + P2_TABLE_HEADING_FIX
          + RED_at_FIRST_MISSING_EDGE (synthetic)
                              └─ C1: GO_P3 (real GREEN
                                   required; this commit)
c12: P3_GREEN         (this commit)
          + REAL_PRODUCTION_SEAM_GREEN
          + INTENTIONALLY_FAILING_TEST_REMOVED
          + RECON_WITNESSES_RETIRED
                              └─ C1: GO_P3_B5 (next cycle)
```

## Next bounded cycle (separate commit, NOT here)

```text
Boundary 5: ChatView / TaskHeader consumes W for
the numerator (when present) instead of P
(lastApiReqContextInputTokens). The UNDEFINED_W_
FALLBACK decision (A=fall back to P vs B=
unavailable/unknown) is the single remaining
design question. Defer to that cycle: read the
existing ContextWindow.tsx:167 null-fallback
contract, then decide.

PRODUCTION_RUNTIME_DELTA = Boundary 3 -> 4 GREEN
                           + tests + factory compact
TYPECHECK_DELTA          = ZERO (vs apps/vscode
                                baseline)
DEFAULT_SUITE_STATE      = GREEN
NEW_REVIEW_ROUND         = NO
C1                       = GO_P3_B5
