# TCL-PARENT-ADV-A: ADVERSARIAL A

TEST=task-control-liveness.tcl-parent.adversarial.test.ts:303
OBSERVED=expected undefined to be 'session-A'
EXPECTED=state.task?.taskId === 'session-A' after awaitInitTaskPaused()

PRODUCTION_SEAM=SdkTaskStartCoordinator.initTask (calls createAndSetTask at line 193)
INVARIANT=L5 (CLEAR-vs-LATE_INSTALL: superseded init must not install either half)

TEST_SCHEDULE=
1. initAPromise = taskStart.initTask("prompt A")
2. awaitInitTaskPaused (microtask drain)
3. expect task="session-A", activeSession=undefined

PRODUCTION_POSSIBLE=YES (production reaches createAndSetTask synchronously
between await getWorkspaceRoot and await startNewSession)

CURRENT_SOURCE_BEHAVIOR=CORRECT — production code is correct; the failure is
because the fixture does not wire `resolveSessionAutoApprovalOverride`
(CAI-01B required field), so initTask throws inside `sessionConfigBuilder.build`
on the first await and never reaches `createAndSetTask`.

CLASSIFICATION=TEST_FIXTURE_DEFECT

DISCRIMINATOR=Standalone diagnostic test mirroring the fixture with
`resolveSessionAutoApprovalOverride` wired logs SESSION_CONFIG_BUILD_CALLED,
STARTOPTIONS_SETTASK: session-A, and state.task = {taskId:"session-A",...}
on the very first awaitInitTaskPaused boundary. Without it, state.task
stays undefined and host.start is never called.

FIX=Add `resolveSessionAutoApprovalOverride: vi.fn(() => ({ kind: "none" }))`
to `startOptions` in tcl-parent.adversarial.test.ts fixture.
