# Final Report — ACT-CLINEMM-TASK-CONTROL-LIVENESS01-PRE-EXISTING-RACE-RECON01

## Identity

```
ACT_ID=ACT-CLINEMM-TASK-CONTROL-LIVENESS01-PRE-EXISTING-RACE-RECON01
VERDICT=PASS_TASK_CONTROL_LIVENESS_FIXTURE_REPAIR_V1

ENTRY_HEAD=d36f322987bebda5ac175bc34071d91c16c66203
IMPLEMENTATION_HEAD=d36f32298 (production unchanged)
FINAL_HEAD=d36f32298 (production unchanged)

WORKTREE_STATUS=clean; 3 test files modified (+24/-0 lines)
```

## RED inventory

```
FAILURES_AT_ENTRY=8 (6 ADVERSARIAL + 2 PARENT)
DETERMINISTIC=8 (all failures reproduced every iteration)
FLAKY=0
NOT_REPRODUCED=0
```

| Test ID | File | Initial failure line | Classification |
|---|---|---|---|
| TCL-PARENT-ADV-A | tcl-parent.adversarial.test.ts | 303 | TEST_FIXTURE_DEFECT |
| TCL-PARENT-ADV-B | tcl-parent.adversarial.test.ts | 342 | TEST_FIXTURE_DEFECT |
| TCL-PARENT-ADV-C | tcl-parent.adversarial.test.ts | 398 | TEST_FIXTURE_DEFECT |
| TCL-PARENT-ADV-D | tcl-parent.adversarial.test.ts | 446 | TEST_FIXTURE_DEFECT |
| TCL-PARENT-ADV-E | tcl-parent.adversarial.test.ts | 495 | TEST_FIXTURE_DEFECT |
| TCL-PARENT-ADV-F | tcl-parent.adversarial.test.ts | 560 | TEST_FIXTURE_DEFECT |
| TCL-PARENT01 | tcl-parent.test.ts | 445 | TEST_FIXTURE_DEFECT |
| TCL-PARENT03 | tcl-parent.test.ts | 666 | TEST_FIXTURE_DEFECT |

(Bonus: tcl-reach01.test.ts had 5 latent REDs surfaced by broader Vitest;
same root cause, same fix.)

## Race classification

```
R1_SHOW_SHOW=not directly tested in this ACT (covered by REACH02 GREEN)
R2_SHOW_CLEAR=not directly tested in this ACT (covered by REACH02 GREEN)
R3_SHOW_CANCEL=not directly tested in this ACT
R4_CANCEL_STRAGGLER=not directly tested in this ACT
R5_CLEAR_LATE_INSTALL=COVERED by ADVERSARIAL A (now GREEN)
R7_TURN_PHASE_TASK_INSTALL=COVERED by PARENT03 (now GREEN)
R9_TEST_FIXTURE_SCHEDULING_ONLY=ACTUAL ROOT CAUSE of all 8 REDs
```

## First divergence

```
FIRST_BROKEN_BOUNDARY=tcl-parent*.test.ts startOptions (failing to wire
resolveSessionAutoApprovalOverride which is a REQUIRED field of
SdkTaskStartCoordinatorOptions added by CAI-01B)
EXPECTED=typecheck-validated required field present
OBSERVED=undefined at runtime; cast `as unknown as SdkTaskStartCoordinatorOptions`
bypassed the check; first await in initTask threw TypeError before
sessionConfigBuilder.build resolved; createAndSetTask never reached;
state.task stayed undefined at the test's awaitInitTaskPaused boundary
```

## Test fidelity

```
STALE_TESTS=0 (production contract is correct; test expectations about
state.task/taskId are correct and achievable)
FIXTURE_DEFECTS=8 (+ 5 in tcl-reach01 from B2 omission)
REAL_PRODUCTION_RACES=0
```

## RED / discriminator

```
MINIMAL_RED=tcl-parent.adversarial.test.ts:303 (ADVERSARIAL A)
RED_REPRODUCED=YES (every iteration; deterministic)
ABLATION=Removed `resolveSessionAutoApprovalOverride` from a fresh
fixture mirror → state.task stays undefined at awaitInitTaskPaused.
Added it back → state.task = {taskId:"session-A",...}.
ABLATION_RESULT=ABLATION CONFIRMED root cause
```

## Repair

```
REPAIR_REQUIRED=YES (test-only — fixture defects)
FILES=apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-parent.test.ts
      apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-parent.adversarial.test.ts
      apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-reach01.test.ts
SEMANTIC_DELTA=Add minimal semantically-correct stubs for two newly-required
                SdkTaskStartCoordinatorOptions / SdkTaskControlCoordinatorOptions
                fields:
                  - resolveSessionAutoApprovalOverride: vi.fn(() => ({ kind: "none" }))
                    (CAI-01B: no pre-armed intent for liveness tests)
                  - clearTaskSettings: async () => {} (B2: no StateManager
                    persistence exercise in liveness tests)
```

## Invariants

```
LATEST_SELECTION_WINS=CONSERVED (verified by PARENT01 GREEN)
CLEAR_SUPERSEDES_OLDER_SHOW=CONSERVED (verified by ADVERSARIAL A GREEN)
CANCEL_FENCE_PRECEDES_ABORT=CONSERVED (unchanged source)
STALE_EVENT_SUPPRESSED=CONSERVED (unchanged source)
TURN_PHASE=CONSERVED (verified by PARENT03 GREEN — setTurnPhase(streaming)
                     is called after startNewSession resolves)
TASK_OPERATION_FENCE=CONSERVED (no source change)
```

## Gates

```
TARGETED=43 passed / 0 failed across 6 files
STABILITY_20X=20/20 (16/16 in every iteration, 3 files)
TSC=PASS
COMPAT_TSC=PASS
LINT=PASS (1428 files, no fixes applied)
DIFF_CHECK=PASS
DOGFOOD_BUILD=NOT_REQUIRED (no production code modified)
LIVE_QUALIFICATION=NOT_APPLICABLE (no production race to qualify)
```

## Board

```
TASK_CONTROL_LIVENESS_LANE=closed (no remaining P0/P1 races;
  all 8 REDs were fixture defects)
CANCEL_UI_REOPEN_CONDITION_MET=NO (no new race evidence surfaced
  beyond the build-repair ACT's prior findings)
NEXT_ACT=address the pre-existing 11 failures in
  sdk-task-start-coordinator.test.ts (separate ACT; not in scope here)
  OR continue lane-hunting R3 (SHOW-vs-CANCEL) and R4 (CANCEL-vs-STRAGGLER_EVENT)
  under deterministic schedules.
```
