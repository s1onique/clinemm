# TCL-PARENT-ADV-E: ADVERSARIAL E

TEST=task-control-liveness.tcl-parent.adversarial.test.ts:495
OBSERVED=Cannot read properties of undefined (reading 'resolve')
EXPECTED=bResolver = resolverQueue[1]; bResolver.resolve("session-B")

PRODUCTION_SEAM=resolverQueue
INVARIANT=L1 + L4 (cancel fence precedes abort)

TEST_SCHEDULE=Same as D plus a forced startNewSession rejection
PRODUCTION_POSSIBLE=YES
CURRENT_SOURCE_BEHAVIOR=CORRECT — same root cause as D
CLASSIFICATION=TEST_FIXTURE_DEFECT
DISCRIMINATOR=Same as D.
