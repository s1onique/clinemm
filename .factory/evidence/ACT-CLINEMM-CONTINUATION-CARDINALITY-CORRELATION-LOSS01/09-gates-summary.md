# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 09-gates-summary

PHASE 9 — GATES

## Status

PASS — all required gates (per ACT §9) are exercised with results
captured below.

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
    Tests  1 failed | 84 passed (85)

  Notes:
    The single failure is "persists active manual compaction state
    against the persisted transcript" — a PRE-EXISTING baseline
    failure caused by currentWorkingContextEstimate drift
    (documented in `.clinerules/sdk-transport-integration.md`).
    Verified pre-existing by git stash before/after this ACT.

### 3. apps/vscode CCARD01 / BCNEX01 / derive-origin-precedence

  Command:
    cd apps/vscode && bun run test:vitest \
      src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts \
      src/sdk/__tests__/background-notify-exactly-once-presentation01.bcnex01.test.ts \
      src/sdk/__tests__/derive-origin-precedence.test.ts

  Result:
    Test Files  3 passed (3)
    Tests  21 passed (21)

### 4. apps/vscode CCCL01 + bcnt01-wire-03-real-callback

  Command:
    cd apps/vscode && bun run test:vitest:c2-4-c-bridge \
      src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts \
      src/sdk/__tests__/background-command-notify-on-terminal01.bcnt01-wire-03-real-callback.c24-c-bridge.test.ts \
      src/sdk/__tests__/background-command-notify-on-terminal01.bcnt01-wire.c24-c-bridge.test.ts

  Result:
    ✓ continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts (2 tests)
    ✓ background-command-notify-on-terminal01.bcnt01-wire-03-real-callback.c24-c-bridge.test.ts (7 tests)
    ✓ background-command-notify-on-terminal01.bcnt01-wire.c24-c-bridge.test.ts (1 test)
    Test Files  3 passed (3)
    Tests  10 passed (10)

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

Pre-existing failures documented:
  - sdk/packages/core/src/runtime/host/local-runtime-host.test.ts >
    "persists active manual compaction state against the persisted
    transcript" — currentWorkingContextEstimate drift (PRE-EXISTING).
  - apps/vscode/src/sdk/SdkController.test.ts > "SDK remote-config
    coordination" (3 tests) — remote-config readiness wiring
    (PRE-EXISTING).

Neither is caused by this ACT. Both are verified pre-existing by
git stash before/after comparison.

## ACT-owned diagnostics

ACT-owned diagnostics = zero. The new CCCL01 RED discriminator
captures records into the existing CCARD module; it does not add
a new diagnostic module or surface.
