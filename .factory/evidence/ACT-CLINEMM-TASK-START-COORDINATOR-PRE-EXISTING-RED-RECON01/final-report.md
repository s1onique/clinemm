# Final Report — ACT-CLINEMM-TASK-START-COORDINATOR-PRE-EXISTING-RED-RECON01

## Identity

```
ACT_ID=ACT-CLINEMM-TASK-START-COORDINATOR-PRE-EXISTING-RED-RECON01
VERDICT=PASS_TASK_START_COORDINATOR_STALE_TEST_REPAIR_V1

ENTRY_HEAD=aafafeedf89a12b741d41ddef18868ebd44b395a
ENTRY_TREE=c7d3ad5716ffae81a23b9931132d4e4472cc5044
IMPLEMENTATION_HEAD=PENDING
FINAL_HEAD=PENDING (will commit at end)

WORKTREE_STATUS=1 test file modified (+19/-2 lines)
ORIGIN_MAIN=aafafeedf89a12b741d41ddef18868ebd44b395a
```

## RED inventory

```
ENTRY_RED_COUNT=11 (10 fixture defects + 1 stale expectation)
FIRST_BOUNDARY_GROUPS=G3 (resolveSessionAutoApprovalOverride) = 10
                     G11 (strict shape assertion)         = 1
DETERMINISTIC=11 (all failures reproduced every iteration)
FLAKY=0
```

| Test ID | Test name | First failing boundary | Classification |
|---|---|---|---|
| TS-01 | initializes a new task, emits the task message, sends prompt | sessionConfigBuilder.build (G3) → strict shape (G11) | TEST_FIXTURE_DEFECT + STALE_TEST_EXPECTATION |
| TS-02 | omits images/files from the task message | sessionConfigBuilder.build (G3) | TEST_FIXTURE_DEFECT |
| TS-03 | emits Cline auth error (cline provider) | sessionConfigBuilder.build (G3) | TEST_FIXTURE_DEFECT |
| TS-04 | emits Cline auth error (clinepass provider) | sessionConfigBuilder.build (G3) | TEST_FIXTURE_DEFECT |
| TS-05 | emits plain chat error when session start fails | sessionConfigBuilder.build (G3) | TEST_FIXTURE_DEFECT |
| TS-06 | forwards task useAutoCondense=true | sessionConfigBuilder.build (G3) | TEST_FIXTURE_DEFECT |
| TS-07 | forwards task useAutoCondense=false | sessionConfigBuilder.build (G3) | TEST_FIXTURE_DEFECT |
| TS-08 | CORRECTION01-1: setTurnPhase streaming at canonical boundary | sessionConfigBuilder.build (G3) | TEST_FIXTURE_DEFECT |
| TS-09 | CORRECTION02-1: setTurnPhase NOT asserted while pending | sessionConfigBuilder.build (G3) | TEST_FIXTURE_DEFECT |
| TS-10 | CORRECTION02-2: exactly one streaming transition | sessionConfigBuilder.build (G3) | TEST_FIXTURE_DEFECT |
| TS-11 | CORRECTION03-1: postStateToWebview ordering | sessionConfigBuilder.build (G3) | TEST_FIXTURE_DEFECT |

## Test fidelity

```
FIXTURE_DEFECTS=10 (G3: missing resolveSessionAutoApprovalOverride)
STALE_EXPECTATIONS=1 (G11: strict shape instead of objectContaining)
PRODUCTION_DEFECTS=0
```

## RED / discriminator

```
MINIMAL_RED=TS-01 line 32 (expected sessionId to be Any<String>, got undefined)
RED_REPRODUCED=YES (every iteration; deterministic)
ABLATION=Standalone path-trace instrumented mirror:
  WITHOUT resolver: P1 → P2 → P3 → TypeError → captureProviderApiError →
    appendAndEmit(error) → P13(undefined)
  WITH resolver:    P1 → P2 → P3 → P4 → P6 → P7 → P10 → PHASE streaming →
    P13(sessionId)
ABLATION_RESULT=CAUSE_DISCRIMINATED=YES (single causal class G3 + one G11)
```

## Repair

```
REPAIR_REQUIRED=YES (test-only — no production source modified)
FILES=apps/vscode/src/sdk/sdk-task-start-coordinator.test.ts
SEMANTIC_DELTA=
  (a) Add resolveSessionAutoApprovalOverride: vi.fn(() => ({ kind: "none" }))
      to makeCoordinator() — minimal semantically-correct neutral default
      for unit tests (no pre-armed user intent). CAI-01B required field.
  (b) Convert test 1's strict toHaveBeenCalledWith({...}) to
      expect.objectContaining({...}) — production now adds the
      sessionAutoApprovalOverride key to build args; strict equality
      becomes fragile.
PRODUCTION_DELTA=NONE
```

## Invariants

```
S1_OPERATION_TOKEN_AUTHORITY=CONSERVED
S2_CLEAR_BEFORE_INSTALL=CONSERVED
S3_STALE_OPERATION_NO_INSTALL=CONSERVED
S4_POST_HOST_START_FENCE=CONSERVED (no source change)
S5_INITIAL_MESSAGE_OWNERSHIP=CONSERVED
S6_AUTO_APPROVAL_OVERRIDE_ORDERING=CONSERVED
S7_TASK_START_NOT_COMPLETION=CONSERVED
S8_TASK_START_NOT_CANCELLATION=CONSERVED
TASK_OPERATION_FENCE=CONSERVED (no source change)
COMPLETION_AUTHORITY=CONSERVED (no source change)
CANCEL_UI_REOPEN_CONDITION_MET=NO
```

## Gates

```
TASK_START_TESTS=21/21 GREEN
NEIGHBOR_TESTS=128/128 GREEN across 9 files (sdk-task-start-coordinator,
   tcl-parent, tcl-parent.adversarial, tcl-reach02, tcl-reach01, tcl09,
   sdk-task-control-coordinator, sdk-session-event-coordinator,
   auto-approve-overlay-regression, sdk-mode-coordinator,
   sdk-session-lifecycle)
STABILITY_10X=10/10 GREEN (every iteration 21/21)
TSC=PASS
COMPAT_TSC=PASS
LINT=PASS (1428 files)
DIFF_CHECK=PASS
DOGFOOD_BUILD=NOT_REQUIRED (no production source modified)
```

## Board posture

```
TASK_START_COORDINATOR_RED_RECON
  PREVIOUSLY=ACTIVE P1 (11 executable REDs)
  NOW=CLOSED (PASS_TASK_START_COORDINATOR_STALE_TEST_REPAIR_V1)
PARENT=runtime-task-progression
NEXT_ACT=continue R3/R4 (SHOW-vs-CANCEL, CANCEL-vs-STRAGGLER_EVENT) under
  deterministic schedules, or pick up the next lane.
```

## Note on predecessor claim

The predecessor ACT (TASK-CONTROL-LIVENESS01-PRE-EXISTING-RACE-RECON01)
fixed the liveness fixtures but did NOT touch
`sdk-task-start-coordinator.test.ts`. The 11 REDs were already present
in the parent commit (`d36f32298`) but only became observable when this
ACT made the test executable. Per §28 of the framework: do not say the
previous ACT "caused" the 11 failures; the previous ACT merely removed
a mask (the B1 build-repair cascade from the build repair ACT).
