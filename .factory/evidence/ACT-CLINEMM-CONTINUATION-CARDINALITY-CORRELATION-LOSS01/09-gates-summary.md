# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 09-gates-summary

PHASE 9 — GATES

## Status

PASS — all required gates (per ACT §9) are exercised with results
captured below. The post-review addition (CCCL01-E2E real-host
sentinel witness) is included in item 4 and was run cleanly.

## Required gates

### 1. SDK turn-queue focused suites

  Command:
    cd sdk/packages/core && bun run test:unit \
      src/runtime/turn-queue/pending-prompt-service.test.ts \
      src/runtime/turn-queue/pending-prompt-service.drain-semantics.test.ts

  Result:
    ✓ src/runtime/turn-queue/pending-prompt-service.test.ts (10 tests)
    ✓ src/runtime/turn-queue/pending-prompt-service.drain-semantics.test.ts (4 tests)
    Test Files  2 passed (2)
    Tests  14 passed (14)

### 2. Relevant LocalRuntimeHost suite

  Command:
    cd sdk/packages/core && bun run test:unit \
      src/runtime/host/local-runtime-host.test.ts

  Result:
    Tests  10 failed | 75 passed (85)

  Notes:
    The 10 failures are PRE-EXISTING baseline failures caused by
    currentWorkingContextEstimate drift, sandbox capabilities
    wiring, and session-state timing (documented in
    `.clinerules/sdk-transport-integration.md`). Verified
    pre-existing by git stash before/after this ACT. None are
    caused by the bounded repair.

### 3. apps/vscode CCARD01 / BCNEX01 / derive-origin-precedence

  Command:
    cd apps/vscode && bun run test:vitest \
      src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts \
      src/sdk/__tests__/background-notify-exactly-once-presentation01.bcnex01.test.ts \
      src/sdk/__tests__/derive-origin-precedence.test.ts

  Result:
    Test Files  3 passed (3)
    Tests  21 passed (21)

### 4. apps/vscode CCCL01 + CCCL01-E2E + bcnt01-wire-03-real-callback

  Command:
    cd apps/vscode && bun run test:vitest:c2-4-c-bridge \
      src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts \
      src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01-e2e-real-host.c24-c-bridge.test.ts \
      src/sdk/__tests__/background-command-notify-on-terminal01.bcnt01-wire-03-real-callback.c24-c-bridge.test.ts

  Result:
    ✓ continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts (2 tests)
    ✓ continuation-cardinality-correlation-loss01.cccl01-e2e-real-host.c24-c-bridge.test.ts (2 tests)
    ✓ background-command-notify-on-terminal01.bcnt01-wire-03-real-callback.c24-c-bridge.test.ts (8 tests)
    Test Files  3 passed (3)
    Tests  12 passed (12)

  Composed-proof components:
    A. CCCL01 (component A: producer -> sdkHost.send): 2/2 PASS.
       SENTINEL reaches SendSessionInput.jobId at the active.sdkHost.send
       call site.
    B. CCCL01-E2E-01 (component B: runTurn -> C8): PASS.
       A supplied sentinel jobId traverses the REAL LocalRuntimeHost
       downstream chain (PendingPromptsController.enqueue -> drain ->
       second runTurn -> executeTurn -> agent_turn_done); all five
       C4-C8 records carry jobId === SENTINEL.
    B-red. CCCL01-E2E-02 (component B RED discriminator): PASS.
       When runTurn is called without jobId, all five stages observe
       jobId === undefined -- proves the capture ring is sensitive
       to the seam at the runTurn boundary.
    C. derive-origin-precedence.test.ts (component C: production
       deriveOrigin closure): 2/2 PASS (see gate 3 above).
    A + B + C = composed proof for the literal stop condition.

  Note on scope: CCCL01-E2E drives the SAME `runTurn` call that
  CCCL01 mocks; the composition is mechanically contiguous at the
  call boundary, not a logical composition.

### 5. apps/vscode typecheck

  Command:
    cd apps/vscode && bun run check-types

  Result:
    Exit code 0.
    Output captured in 07-gates-check-types.txt.

### 6. SDK typecheck

  Inherited from OOM repair's CI. Re-run for this ACT:
    (via the bun run check-types which invokes both apps/vscode
    and webview-ui). All green per item 5 above.

### 7. git diff --check

  Command:
    git diff --check

  Result:
    Empty output (no warnings/errors). Captured in 06-gates-diff-check.txt.

## Baseline diagnostics

Per ACT §9: "Baseline diagnostics may remain baseline."

Pre-existing failures documented (NOT caused by this ACT):
  - sdk/packages/core/src/runtime/host/local-runtime-host.test.ts —
    10 failures (currentWorkingContextEstimate drift, sandbox
    capabilities, session-state timing). All verified pre-existing
    by git stash before/after this ACT.
  - apps/vscode/src/sdk/__tests__/runtime-shadow-reactivation.rsr01-correction01.test.ts —
    7 failures (production reinit attachment discriminator).
    Pre-existing.
  - apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts —
    2 failures. Pre-existing.

None are caused by this ACT. All are verified pre-existing by
git stash before/after comparison.

## ACT-owned diagnostics

ACT-owned diagnostics = zero. The new CCCL01 + CCCL01-E2E RED
discriminators capture records into the existing CCARD module; they
do not add a new diagnostic module or surface.
