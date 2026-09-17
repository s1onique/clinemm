# TCL-PARENT-ADV-B: ADVERSARIAL B

TEST=task-control-liveness.tcl-parent.adversarial.test.ts:342
OBSERVED=expected undefined to be 'session-A'
EXPECTED=state.task?.taskId === 'session-A' after first awaitInitTaskPaused

PRODUCTION_SEAM=SdkTaskStartCoordinator.initTask (first init)
INVARIANT=L1 (latest selection wins — same as A; B's supersession is the
test's later stage)

TEST_SCHEDULE=
1. initAPromise = taskStart.initTask("prompt A")
2. awaitInitTaskPaused
3. expect task="session-A"

PRODUCTION_POSSIBLE=YES
CURRENT_SOURCE_BEHAVIOR=CORRECT — same root cause as A
CLASSIFICATION=TEST_FIXTURE_DEFECT
DISCRIMINATOR=Same diagnostic as A: state.task never set because
resolveSessionAutoApprovalOverride is undefined.
FIX=Same as A.
