# TCL-PARENT-ADV-F: ADVERSARIAL F

TEST=task-control-liveness.tcl-parent.adversarial.test.ts:560
OBSERVED=expected undefined to be 'session-A'
EXPECTED=state.task?.taskId === 'session-A' after first awaitInitTaskPaused

PRODUCTION_SEAM=SdkTaskStartCoordinator.initTask
INVARIANT=L1 (stale reinit must not terminate current B; B's host.stop must not be called)

TEST_SCHEDULE=
1. initAPromise = initTask("prompt A")
2. awaitInitTaskPaused (expect task="session-A")
3. initBPromise = initTask("prompt B") with sessionConfigBuilder→session-B
4. awaitInitTaskPaused; bResolver.resolve("session-B"); await initBPromise
   (B becomes current)
5. aResolver.resolve("session-A"); await initAPromise
6. expect task="session-B" (stale A must not clobber B)

PRODUCTION_POSSIBLE=YES
CURRENT_SOURCE_BEHAVIOR=CORRECT — same root cause as A
CLASSIFICATION=TEST_FIXTURE_DEFECT
DISCRIMINATOR=Same as A.
