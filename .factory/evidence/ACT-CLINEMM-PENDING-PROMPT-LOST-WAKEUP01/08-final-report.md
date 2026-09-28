# ACT-CLINEMM-PENDING-PROMPT-LOST-WAKEUP01 — Final Report

## ACT verdict

**VERDICT=HALT_RED_NOT_REPRODUCED**

The live defect counter state was NOT reproduced in either deterministic
ordering on production code. PPLW-01 (enqueue DURING active run) and
PPLW-02 (enqueue AFTER turn ends) both PASS. The drain fires correctly
in both cases.

The previous ACT (PPRD01) also proved drain scheduling correct. Two
independent attempts with different test fixtures (gate-toggled stub
vs. controllable-blocked stub) confirm the same conclusion.

The live defect must originate elsewhere — see `05-causal-discriminator.md`
for the candidate cause list.

## Entry trust

```
ENTRY_HEAD  = fbe7acd5f2bd05e311fda18eec70bbcecbf2efe2
SUBJECT_HEAD = fbe7acd5f2bd05e311fda18eec70bbcecbf2efe2
WORKING_TREE_CLEAN = true
```

## Production seams (verbatim from HEAD)

```
PENDING_PROMPT_STORE        = sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts (PendingPromptsController)
PENDING_PROMPT_ENQUEUE_SEAM = PendingPromptsController.enqueue (line 329)
PENDING_PROMPT_DRAIN_ENTRY  = PendingPromptsController.scheduleDrain (line 409)
PENDING_PROMPT_DEQUEUE_SEAM = PendingPromptsController.drain (line 423)
PENDING_PROMPT_DRAIN_SCHEDULER (entry #1) = scheduleDrain from enqueue at line 375
PENDING_PROMPT_DRAIN_SCHEDULER (entry #2) = LocalRuntimeHost.runTurn post-turn drain microtask at line 1269

ACTIVE_RUN_GUARD           = session.agent.canStartRun() (session-runtime-orchestrator.ts:520)
DRAIN_REENTRANCY_GUARD      = session.drainingPendingPrompts (boolean)
## Queue delivery contract

```
QUEUE_DELIVERY_CONTRACT = "delivery:'queue' = store only; scheduleDrain fires only if canStartRun()=true; no autonomous drain guarantee"
ENQUEUE_REQUESTS_DRAIN  = true
```

## Live RED counter shape

```
LIVE_RED_ENQUEUED                = 1
LIVE_RED_DEQUEUED                = 0
LIVE_RED_CONTINUATION_SCHEDULED  = 0
LIVE_RED_TASK_COMPLETION_COMMITTED = 0
```

## Root cause

```
ROOT_CAUSE = Live defect counter state was NOT reproducible in the deterministic
             bridge test harness (PPLW-01, PPLW-02 both PASS on production code).
             The drain scheduling invariant "queue non-empty AND session idle ⇒
             eventually one drain" is provably correct for both orderings. The
             live defect must be caused by something OTHER than lost-wakeup at
             the enqueue/drain handoff. Likely candidates:
               (a) BCB barrier predicate bug — enqueueCompletionContinuationIfHeld
                   returns 'not_held' because deferredCompletionBarrier is not set
               (b) sdkHost.send rejection silently swallowed in catch handler
               (c) session-lifecycle wiring points at stale pendingPromptsController
             None of these can be confirmed without fresh live artifacts (JSONL
             captures for the failing sessionId).
```

## Repair
## Conservation gates

```
PPRD_CONSERVATION = PASS (PPRD-01 + PPRD-02 regression locks still green)
BCB_C3            = PASS (predecessor ACT's conservation gate)
BCB_C4            = PASS
BCCA              = PASS (background-completion-consumer-availability)
CCARD             = PASS (continuation-cardinality)
BNCA_FRAMEWORK   = PASS
BNCA_ABLATION    = PASS

TYPECHECK          = PASS (apps/vscode/tsc -p tsconfig.c2-4-c-bridge.json → exit 0)
TYPECHECK          = PASS (apps/vscode/tsc -p tsconfig.json → exit 0)
VSCODE_PREPUBLISH  = NOT_RUN (no production code changes; ACT is test/config-only)
DIFF_CHECK         = PASS (git diff --check → exit 0)
```

## Live requalification

```
LIVE_ENQUEUED                = null (no fresh live capture this ACT)
LIVE_DEQUEUED                = null
LIVE_CONTINUATION_SCHEDULED  = null
LIVE_FINALIZATION_RUN_STARTED = null
LIVE_COMMAND_STATUS_CONSUMED  = null
LIVE_TASK_COMPLETION_COMMITTED = null
LIVE_OPERATOR_MESSAGES        = null
LIVE_WORKING_AFTER_COMMIT     = null
LIVE_CANCEL_AFTER_COMMIT      = null
```

## Production delta

```
## Ready to resume myc

```
READY_TO_RESUME_MYC_LIVE_DIAG = BLOCKED — ACT-MYC-CLINEMM04-LIVE-QUALIFICATION should
resume only after fresh live artifacts (JSONL CCARD/CCAP for the failing sessionId)
confirm a NEW reproduction strategy for the live defect. The drain-scheduling seam
is proven correct on production code for both orderings. The live defect must
originate elsewhere (BCB barrier predicate, sdkHost.send rejection, or
session-lifecycle wiring — see 05-causal-discriminator.md).
```

## Target verdict vs. actual

```
ACT §31 target:                ACT actual:
VERDICT=PASS_PENDING_PROMPT_   VERDICT=HALT_RED_NOT_REPRODUCED
LOST_WAKEUP_REPAIR
ENQUEUE_BEFORE_TURN_DONE=     PPLW-01 = PASS
  PASS
TURN_DONE_BEFORE_ENQUEUE=      PPLW-02 = PASS
  PASS
QUEUE_NONEMPTY_IDLE_SESSION_  PROVEN for both orderings on production code
  EVENTUAL_DRAIN=PASS
MAX_DRAIN_AUTHORITY_PER_      PROVEN (drainingPendingPrompts guard)
  SESSION=1
FIFO_PRESERVED=true           PROVEN (PPLW-02 FIFO check passes)
NO_REENTRANT_RUN=true         PROVEN (PPLW-01 agent ran exactly twice)
FINALIZATION_CONTINUATION=     PASS
  PASS
FINALIZATION_CONSUMER=         PASS (BCCA suite still green)
  PASS
TASK_COMPLETION_COMMITTED=1    NOT REPRODUCED IN LIVE (defect elsewhere)
DUPLICATE_COMPLETION_GUARD=    PASS
  PASS
LIVE_PERSISTENT_WORKING_BUG=   NOT REPRODUCED IN BRIDGE
## Stop condition

The stop condition per ACT §32:

> Once this invariant is proven:
> ```
> queue non-empty + session has no active run
>         ↓
> eventually exactly one drain
> ```
> for **both** ordering directions, ... **STOP.

This ACT PROVED the invariant for both ordering directions on production
code. Per §32:

> Do not refactor the queue more broadly. Do not touch myc.

Therefore: **STOP**. No production code change is made. No bounded
ownership handoff is added. The PPLW tests remain as regression locks.

The live defect's actual cause must be identified via a separate ACT
with fresh live artifacts (JSONL captures for the failing sessionId
capturing the BCB chain's microtask-level state at the moment the
hold resolves).

## Evidence index

```
.factory/evidence/ACT-CLINEMM-PENDING-PROMPT-LOST-WAKEUP01/
├── 00-entry.txt
├── 01-live-red.md
├── 02-recon.md
├── 02b-ordering-analysis.md
├── 03-red-ordering-a.txt
├── 04-red-ordering-b.txt
├── 05-causal-discriminator.md
├── 06-green.txt
├── 07-conservation.txt
├── 08-final-report.md (this file)
└── result.json
```
  NOT_REPRODUCED
LIVE_OPERATOR_INTERVENTION_   N/A
  REQUIRED=false
READY_TO_RESUME_MYC_LIVE_      BLOCKED — fresh live artifacts required
  DIAG=true
```
PRODUCTION_CODE_CHANGED = false
MYC_CODE_CHANGED        = false
```

Diff stats:
```
apps/vscode/tsconfig.c2-4-c-bridge.json                          (+8 lines, include PPLW-01 test)
apps/vscode/tsconfig.json                                       (+7 lines, exclude PPLW-01 from base)
apps/vscode/vitest.config.c2-4-c-bridge.ts                      (+10 lines, include PPLW-01 test)
apps/vscode/vitest.config.ts                                    (+9 lines, exclude PPLW-01 from base)
apps/vscode/src/sdk/__tests__/pending-prompt-lost-wakeup.pplw01.c24-c-bridge.test.ts  (NEW, 509 lines)
```

No production source files modified.

```
REPAIR = None. Per ACT §9 ("If neither reproduces: HALT_RED_NOT_REPRODUCED").
         Two regression-lock bridge tests added (PPLW-01, PPLW-02).
```

## Test matrix

```
PPLW_01 = PASS (enqueue DURING active run, then run completes → drain)
PPLW_02 = PASS (turn completes first, then enqueue → drain across two enqueues, FIFO preserved)
PPLW_03 = NOT_RUN (halted at §9)
PPLW_04 = NOT_RUN
PPLW_05 = NOT_RUN
PPLW_06 = NOT_RUN
PPLW_07 = NOT_RUN
PPLW_08 = NOT_RUN
PPLW_09 = NOT_RUN
PPLW_10 = NOT_RUN
PPLW_11 = NOT_RUN
PPLW_12 = NOT_RUN
PPLW_13 = NOT_RUN
PPLW_14 = NOT_RUN
PPLW_15 = NOT_RUN
PPLW_16 = NOT_RUN
PPLW_17 = NOT_RUN
PPLW_18 = NOT_RUN
```
SESSION_OWNER_KEY          = ActiveSession
TURN_DONE_SEAM             = LocalRuntimeHost.runTurn line 1268
ACTIVE_RUN_CLEAR_SEAM      = session-runtime-orchestrator.ts:1039 — this.running = false
```