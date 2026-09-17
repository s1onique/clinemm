# TCL-PARENT01

TEST=task-control-liveness.tcl-parent.test.ts:445
OBSERVED=expected undefined to be 'session-B'
EXPECTED=taskBeforeClear?.taskId === 'session-B'

PRODUCTION_SEAM=SdkTaskStartCoordinator.initTask
INVARIANT=L1 + L2 (latest selection wins; clear supersedes older show)

TEST_SCHEDULE=
1. initPromise = taskStart.initTask("test prompt")
2. setTimeout(0)
3. expect task="session-B", activeSession=undefined
4. await taskControl.clearTask()
5. fx.hostHandle.startResolver.resolve("session-B")
6. await initPromise
7. TASK_SESSION_PAIR_INVARIANT

PRODUCTION_POSSIBLE=YES
CURRENT_SOURCE_BEHAVIOR=CORRECT — same root cause as A
CLASSIFICATION=TEST_FIXTURE_DEFECT
DISCRIMINATOR=Same diagnostic as A.
