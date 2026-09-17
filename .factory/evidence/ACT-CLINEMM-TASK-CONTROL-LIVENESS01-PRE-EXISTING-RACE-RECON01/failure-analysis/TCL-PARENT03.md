# TCL-PARENT03

TEST=task-control-liveness.tcl-parent.test.ts:666
OBSERVED=setTurnPhase("streaming") was not called for the post-wedge New Task. Phase calls: []
EXPECTED=setTurnPhase("streaming") was called for the post-wedge initTask

PRODUCTION_SEAM=SdkTaskStartCoordinator.initTask (post-startNewSession
setTurnPhase("streaming", ..., "task-start-init-task") at line 263)
INVARIANT=L7 (cancel/clear is not completion — task becomes streaming when
a fresh New Task is submitted)

TEST_SCHEDULE=
1. Race initTask vs clearTask under the fence (expecting neither half installed)
2. Reconfigure sessionConfigBuilder → session-C
3. await taskStart.initTask("fresh prompt")
4. expect streaming phase was set

PRODUCTION_POSSIBLE=YES (production reaches setTurnPhase("streaming") at
line 263 after startNewSession returns successfully)
CURRENT_SOURCE_BEHAVIOR=CORRECT — same root cause as A; initTask never
reaches the streaming assertion because the fixture throws before
sessionConfigBuilder.build returns.
CLASSIFICATION=TEST_FIXTURE_DEFECT
DISCRIMINATOR=Same diagnostic as A.
