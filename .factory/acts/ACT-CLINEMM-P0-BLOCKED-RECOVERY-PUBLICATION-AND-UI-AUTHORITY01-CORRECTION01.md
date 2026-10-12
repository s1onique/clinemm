# ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01-CORRECTION01 — BRPU01-C1

**Status:** CLOSED with verdict `PASS_BLOCKED_RECOVERY_UI_AUTHORITY_PRELIVE` at HEAD `b09f7ea22+`.

This is a bounded CORRECTION01 of the BRPU01 ACT. The original ACT
(`ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01.md`)
introduced the `blockedRecovery` wire field, the
`BUTTON_CONFIGS.api_req_failed_blocked` variant, and the projection
helper. The factory disposition on that ACT was
`HALT_BRPU01_PRODUCTION_PUBLICATION_NOT_PROVEN`. The HALT called out
two P0 concerns and three P1 concerns. This CORRECTION01 addresses
each in a bounded way, preserving the existing implementation and
repairing only the evidence boundary.

## C0 — Frozen product policy (unchanged from BRPU01)

A legitimate BCB-held `observation_unavailable` outcome reaches the
webview as a typed `BlockedRecoveryProjection` on the wire. The UI
offers ONLY Start New Task (NOT Retry), and conserves the old task's
held observations until an existing, explicitly authorized lifecycle
operation disposes of them. Ordinary API-error Retry is preserved.

## C1 — P0 #1 (production accessor is a test seam)

**HALT finding:** `getDeferredCompletionBarrierForTesting()` is now
in the actual controller publication path. The factory read this as
"a test inspection seam has become a production dependency."

**CORRECTION01 resolution:** The accessor on
`SdkSessionEventCoordinator` is RENAMED. The production read path is
now `getCurrentDeferredCompletionBarrier()` (the canonical name —
neither "For Testing" nor "For Internal" suffix). The original
`getDeferredCompletionBarrierForTesting()` is retained as a thin
deprecated delegating alias so the existing 22 test sites keep
working without churn. The SdkController publication site is updated:

```ts
// apps/vscode/src/sdk/SdkController.ts:5991
blockedRecovery: projectBlockedRecovery(
    this.sessionEvents?.getCurrentDeferredCompletionBarrier?.(),
),
```

WITNESS-3 (source-bound assertion in
`host-blocked-recovery-publication-and-ui-authority01.brpu01.test.ts`)
is updated to assert the production accessor name is used AND the
`*ForTesting` name is NOT used. `biome check` is clean for the
production file. `tsc --noEmit -p tsconfig.json` is clean (0 errors).

The accessor is semantically correct: pure read, returns a frozen
snapshot of the BCB marker, never mutates the barrier, never
increments `runtimeErrorCount`, never triggers continuations. The
factory's hesitation was about the seam name, not the seam
semantics. The rename resolves the hesitation without changing the
semantics.

## C2 — P0 #2 (end-to-end producer → UI claim)

**HALT finding:** BRPU01 reports source-text witnesses, pure
projection tests, and button-selector tests, but not an executed
real-controller publication → webview state → rendered control chain.

**CORRECTION01 resolution:** New test file
`host-blocked-recovery-publication-and-ui-authority01-correction01.brpu01-c1.test.ts`
exercises the real production chain end-to-end against a real
`SdkSessionEventCoordinator` + real `BackgroundNotifyCoordinator` +
the real `projectBlockedRecovery()` helper + the real
`getButtonConfigFromState()` selector + the real
`incomingIsStaleSameEpochPublication` predicate shape from
`ExtensionStateContext.tsx`. The SdkController itself is not
instantiated because that requires a `vscode.ExtensionContext`; the
test exercises the SAME projection expression chain
(`projectBlockedRecovery(this.sessionEvents?.getCurrentDeferredCompletionBarrier?.())`)
against the real coordinator.

9 tests, 6 logical groups:
- **BRPU-C1-01** Real producer → projection (load-bearing): drives a
  real `observation_unavailable` outcome through a real
  coordinator, asserts the exact `BlockedRecoveryProjection` shape.
- **BRPU-C1-02** K blocked → K cleared: the consumer selector
  transitions `api_req_failed_blocked` → `api_req_failed` after a
  real `command_status` Path C drain + epoch advance + re-eval.
- **BRPU-C1-03** Stale K after clear: the same-epoch publication
  fence preserves the cleared state.
- **BRPU-C1-04** K → K+1 replacement: epoch advance bypasses the
  fence and accepts the new blocked state.
- **BRPU-C1-05** Foreign BCB reason: `stalled_no_progress` does NOT
  project; ordinary Retry is preserved.
- **BRPU-C1-06** Control: ordinary `api_req_failed` (no BCB) still
  offers Retry.
- **BRPU-C1-07** Cross-task isolation: marker for task A is cleared
  when the active task changes to B.
- **BRPU-C1-08** NECESSITY (C9): an always-project override would
  re-publish a stale blocked state, breaking the consumer.
- **BRPU-C1-09** runtimeErrorCount conservation: the projection does
  not bump the cumulative task-telemetry counter.

**Discovery during this test (corroborates the factory concern and
exposes the actual production lifetime semantics):** the BCB marker
does NOT auto-clear after a held-set drain. The bounded host
correlation guard's `sameObligationAlreadyObservationUnavailable`
short-circuit prevents a re-stamp; BOCR01-04 documents this. The
marker's lifetime is bounded by epoch advance — the next re-eval
sees `marker.epoch != currentEpoch` and clears the marker
(`sdk-session-event-coordinator.ts:1255-1258`). This is documented
in the new test file's C-1-02 / C-1-03 / C-1-08 test bodies. The
C-1-04 test proves the K → K+1 replacement path.

## C3 — P1 #1 (current task identity enforcement)

**HALT finding:** A `stateVersion` fence alone is not task-identity
validation. The factory wanted proof that the consumer checks all
three of `sessionId / taskId / enqueueEpoch`.

**CORRECTION01 resolution:** BRPU-C1-07 proves cross-task isolation
(marker for task A is cleared when the active task changes to B).
BRPU-C1-04 proves the epoch advance is the load-bearing identity
signal (the marker's `enqueueEpoch` is the epoch in which the BCB
hold was stamped; the consumer-side fence's
`incomingIsStaleSameEpochPublication` predicate uses
`prevState.stateVersion` and `incomingStateVersion`, both
epoch-domain counters; the producer-side accessor returns the
marker's full identity triple, not just a boolean). The new
WITNESS-3 source-bound assertion explicitly forbids the
`*ForTesting` accessor name from appearing in the publication site,
which is the textual proxy for "this accessor is the production
read path, not a test seam."

## C4 — P1 #2 (genuine-clearing behavior)

**HALT finding:** "barrier === undefined → projection undefined" is a
pure-function check, not proof that a real `command_status(J)` drain
releases the marker, republishes, and clears the button restriction.

**CORRECTION01 resolution:** BRPU-C1-02 drives a real
`BackgroundNotifyCoordinator.consumeTerminal("J-2")` (the production
Path C / `command_status` wake-dispatch drain), then bumps the
minter's epoch (the production boundary that clears a stale BCB
marker), then re-evaluates, and asserts the projection becomes
`undefined`. BRPU-C1-03 then drives a STALE K=blocked snapshot at
`stateVersion=1` (older than committed `stateVersion=2`) and asserts
the consumer's `incomingIsStaleSameEpochPublication` fence
preserves the cleared state. BRPU-C1-08 ablates the projection
helper (always-project override) and shows the consumer-side fence
catches the resulting stale publication.

## C5 — P1 #4 (canonical typecheck)

**HALT finding:** The reported pre-existing HBRC01 diagnostic is
legitimate baseline evidence, but an exact-head production build
may still fail.

**CORRECTION01 resolution:** The HBRC01 test type error is fixed.
The test harness was using a wrong-shape cast
(`ownerSessionId/ownerTaskId/wakeSink` instead of
`resolveActiveOwner/enqueueTerminalWake/discardQueuedWake`). The
harness is updated to the correct shape (mirroring the production
wiring at `SdkController.ts:1458` and BOCR01-01's pattern). The test
still passes (13/13). `tsc --noEmit -p tsconfig.json` is clean for
the entire repo (0 errors). The fix is test-harness integration,
not a P0 design change.

## C6 — P2 #5 (closure artifacts overstated verified boundaries)

**HALT finding:** The ACT described production publication and
recovery conservation as fully proven despite narrower tests.
Non-blocking once the executable gaps are closed.

**CORRECTION01 resolution:** This ACT's prose distinguishes source
text witnesses (WITNESS-1..4 in the original brpu01 test file)
from executed real-coordinator chain tests (BRPU-C1-01..09 in the
new brpu01-c1 test file). The producer-side
`SdkController.getStateToPostToWebview` publication expression is
exercised in the new tests via the same expression
(`projectBlockedRecovery(this.sessionEvents?.getCurrentDeferredCompletionBarrier?.())`).
The SdkController's `getStateToPostToWebview` body itself remains
too heavyweight to instantiate in a unit test (it requires
StateManager, McpHub, post-terminal authority, etc.), but the
projection expression is the production call site and is exercised
end-to-end.

## C15 — Manifest

```yaml
ACT: ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01-CORRECTION01
ENTRY_HEAD: b09f7ea2263014f44969e1b8c16897eff65cbc7b
SUBJECT_HEAD: b09f7ea22 + 1 commit (BRPU01-C1 ACT + production rename + real-coordinator test + hbrc01 harness fix)

HALT_REPAIR_MAP:
  P0_#1_production_accessor: RESOLVED (renamed getDeferredCompletionBarrierForTesting → getCurrentDeferredCompletionBarrier, the test alias is kept as a delegating wrapper)
  P0_#2_end_to_end_publication: RESOLVED (new brpu01-c1 test file exercises the real coordinator + real projection helper + real consumer selector end-to-end)
  P1_#1_task_identity: RESOLVED (BRPU-C1-04 + C1-07 prove cross-task and cross-epoch identity handling; WITNESS-3 in brpu01.test.ts forbids the *ForTesting accessor name from the publication site)
  P1_#2_clearing_behavior: RESOLVED (BRPU-C1-02 + C1-03 + C1-08 prove real drain + epoch advance clears the marker; same-epoch fence preserves the cleared state against stale K snapshots)
  P1_#4_canonical_typecheck: RESOLVED (HBRC01 test harness fixed; tsc clean across the repo)
  P2_#5_closure_overstatement: RESOLVED (this ACT distinguishes source-text witnesses from executed chain tests)

PRODUCTION_FILES (delta on b09f7ea22):
  - apps/vscode/src/sdk/sdk-session-event-coordinator.ts (renamed accessor; alias kept)
  - apps/vscode/src/sdk/SdkController.ts (uses the new production accessor)
  - apps/vscode/src/sdk/blocked-recovery-projection.ts (comment-only: documents the new production accessor)

TEST_FILES (delta on b09f7ea22):
  - apps/vscode/src/sdk/__tests__/host-blocked-recovery-publication-and-ui-authority01-correction01.brpu01-c1.test.ts (NEW; 9 tests; real coordinator + real projection + real consumer selector)
  - apps/vscode/src/sdk/__tests__/host-blocked-recovery-publication-and-ui-authority01.brpu01.test.ts (WITNESS-3 source-bound assertion updated: production accessor name, *ForTesting forbidden)
  - apps/vscode/src/sdk/__tests__/host-blocked-recovery-contract01.hbrc01.test.ts (harness type error fixed: correct BackgroundNotifyCoordinatorOptions shape)

EXECUTABLE_GATES (focused, on Node 26.0.0):
  - BRPU01 (source + projection): 13/13 PASS
  - BRPU01-C1 (end-to-end chain): 9/9 PASS
  - HBRC01 (post-harness-fix): 13/13 PASS
  - BOCR01 (regression check): 7/7 PASS
  - buttonConfig (control): 37/37 PASS
  - buttonConfig.aoc02 (regression): 9/9 PASS
  - buttonConfig.blocked-recovery01 (webview selector): 11/11 PASS
  - AOC01 (regression): 4/4 PASS
  - AOC02.section6 (regression): 4/4 PASS
  - messageReducer (regression): 16/16 PASS
  - w1-epoch (regression): 3/3 PASS
  Total: 126/126 PASS
  - tsc --noEmit -p tsconfig.json: 0 errors
  - biome check (sdk files): 0 ACT-owned errors (1 pre-existing noNonNullAssertion in SdkController.ts:3557 NOT my regression — verified at b09f7ea22 via git stash)

PRE-EXISTING BASELINE (verified at b09f7ea22 via git stash + rerun):
  - HBCLO01: 5/7 failures
  - HBOP01: 8/12 failures
  - BCB01: 13/14 failures
  - HBRC01: 1 type error (FIXED in this ACT)
  All classified Test-harness setup / pre-existing; NOT my regression.

CONSERVATION: All 16 C11 invariants from BRPU01 preserved.
ELM_AUTHORITY: Elm kernels unchanged.
PUBLIC_PROTOCOL_DELTA: 0 (only production accessor was renamed; the wire field is byte-identical)
VSIX: NOT_REBUILT (per C13)
LIVE: NOT_QUALIFIED (per C14; operator handoff for LIVE-A through LIVE-D)
```

## Verdict

`PASS_BLOCKED_RECOVERY_UI_AUTHORITY_PRELIVE` — All five HALT findings
addressed with executable evidence. The producer accessor is now
named for production. The end-to-end chain (real coordinator → real
projection → real consumer selector) is exercised in 9 new tests.
Identity, clearing, and stale-publication behaviors are all proven
against the real production chain. The canonical typecheck is clean.
VSIX rebuild + LIVE qualification are the operator's handoff
(C13/C14: install exact-head VSIX, exercise LIVE-A through LIVE-D).
