# TCL-PARENT-ADV-C: ADVERSARIAL C

TEST=task-control-liveness.tcl-parent.adversarial.test.ts:398
OBSERVED=expected undefined to be 'session-A'
EXPECTED=state.task?.taskId === 'session-A' after first awaitInitTaskPaused

PRODUCTION_SEAM=SdkTaskStartCoordinator.initTask
INVARIANT=L2 (clear supersedes older show)

TEST_SCHEDULE=
1. initAPromise = taskStart.initTask("prompt A")
2. awaitInitTaskPaused
3. expect task="session-A" (pre-condition for later clear test)

PRODUCTION_POSSIBLE=YES
CURRENT_SOURCE_BEHAVIOR=CORRECT — same root cause as A
CLASSIFICATION=TEST_FIXTURE_DEFECT
DISCRIMINATOR=Same as A.
FIX=Same as A.
