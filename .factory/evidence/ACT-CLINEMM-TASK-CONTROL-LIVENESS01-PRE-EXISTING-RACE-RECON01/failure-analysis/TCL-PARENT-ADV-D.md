# TCL-PARENT-ADV-D: ADVERSARIAL D

TEST=task-control-liveness.tcl-parent.adversarial.test.ts:446
OBSERVED=Cannot read properties of undefined (reading 'resolve')
EXPECTED=bResolver = resolverQueue[1]; bResolver.resolve("session-B")

PRODUCTION_SEAM=resolverQueue[i] — managed by makeControllableHost
INVARIANT=L1 (stale A host.start resolves after B must not replace B)

TEST_SCHEDULE=
1. initAPromise
2. awaitInitTaskPaused (expect task="session-A")
3. sessionConfigBuilder.build → session-B
4. initBPromise (queues second host.start → resolverQueue[1])
5. awaitInitTaskPaused
6. bResolver = resolverQueue[1]
7. bResolver.resolve("session-B")

PRODUCTION_POSSIBLE=YES (host.start is called by initTask via lifecycle.
startNewSession)
CURRENT_SOURCE_BEHAVIOR=CORRECT — production code is correct; the
failure is downstream of the missing resolveSessionAutoApprovalOverride:
initTask throws before reaching startNewSession, so host.start is never
called for either A or B, leaving resolverQueue empty.
CLASSIFICATION=TEST_FIXTURE_DEFECT
DISCRIMINATOR=resolverQueue would have entries [0] (A's start) and [1]
(B's start) once the fixture is complete. With the fix, A's start is
queued first, B's is queued second, and resolverQueue[1] resolves cleanly.
