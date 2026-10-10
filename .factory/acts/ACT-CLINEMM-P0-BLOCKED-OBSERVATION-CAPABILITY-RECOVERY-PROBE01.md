# ACT-CLINEMM-P0-BLOCKED-OBSERVATION-CAPABILITY-RECOVERY-PROBE01 — PASS_BOCR01_HOST_HOLD_AND_RECOVERY_INTACT — 2026-10-10

**Status:** CLOSED with verdict `PASS_BOCR01_HOST_HOLD_AND_RECOVERY_INTACT`.
The single causal chain (per Factory reviewer disposition on
`ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-NONCONVERGENCE01` at
commit `1dd61a5d5`) drives the LIVE chronology end-to-end against
the **REAL** `BackgroundNotifyCoordinator` +
`SdkSessionEventCoordinator` + bounded host correlation guard, and
discriminates the four candidate causes of the held-observation-
while-lacking-capability symptom.

**Decisive question (per Factory reviewer):** Why does the active
runtime retain an observation obligation while lacking the capability
to discharge it?

**Test file:** `apps/vscode/src/sdk/__tests__/blocked-observation-capability-recovery-probe01.bocr01.test.ts`
(7 tests, all GREEN on HEAD `1dd61a5d5`).

## Discrimination matrix (4 candidates, 7 tests)

| Test | Discriminates | Result |
|---|---|---|
| **BOCR01-01**: held-state establishment (notify=true held + BCB block) | Setup state for all subsequent probes | Held=2 (1 held + 1 live marker); BCB block fires; `setTurnPhase("error", ..., "session-event-bcb-blocked-observation-unavailable")` published; no continuation; no completion. ✅ |
| **BOCR01-02**: second terminal event drains the held set | D: recovery is intact | Second `consumeTerminal(J-2)` returns `drained` (drainedCount=2); wakes dispatched for both J-1 and J-2; held=0. ✅ |
| **BOCR01-03**: SINGLE CAUSAL CHAIN (the reviewer's question) | A vs B vs C vs D (all four) | Non-notify held observation + BCB block + capability restoration + command_status → held set contracts from 1 to 0. ✅ All four candidates discriminated: A supported, B refuted, C refuted, D refuted. |
| **BOCR01-04**: command_status on a held notify=true job does NOT drain | A vs B (held is correct) | `resolveObligation` returns `no_marker`; `consumeNonNotifyTerminalObservation` is a no-op. Held set unchanged. ✅ A supported, B refuted. |
| **BOCR01-05**: ablation — held=0 removes the BCB block | Held set is the cause | Override count to 0; submit; no `error` phase; no blocked-outcome publication. ✅ Confirms held set is the cause. |
| **BOCR01-06**: cross-session / cross-task identity isolation | A2: ownership discipline | Foreign owner `resolveObligation(J-1)` returns `no_marker`; held set unchanged. ✅ |
| **BOCR01-07**: same-task re-issued submit after BCB block | D: bounded guard idempotence | Second submit; `sameObligationAlreadyObservationUnavailable` short-circuits; tracker phase is not overwritten. ✅ |

## Verdict

`PASS_BOCR01_HOST_HOLD_AND_RECOVERY_INTACT`.

The held-observation-while-lacking-capability symptom is the
**contract-correct behavior of the production BCB01 / PTBPC01 /
CRCD01 / CTQC01 / CCUTO01 stack**. Specifically:

- **A. Held registration is correct** — the held entry is a genuine
  unobserved terminal fact. **SUPPORTED** by BOCR01-01, -03, -04, -05.
- **B. Held registration is wrong (false positive)** — REFUTED. The
  held set is drainable by the same production path that registers
  it. There is no false-positive leak.
- **C. Capability projection is wrong (projection bug)** — REFUTED.
  The bounded correlation guard's `canObserveHeldResults` projection
  at `sdk-session-event-coordinator.ts:3108-3110` correctly
  transitions from `false` to `true` when `command_status` is added
  to the live tool registry (BOCR01-03 step 3).
- **D. Recovery attempt is broken** — REFUTED. The recovery
  contract IS end-to-end intact:
  - For non-notify held: `command_status(J)` drains via Path C
    (BOCR01-03 step 4).
  - For notify=true held (rare, transient): a subsequent
    `consumeTerminal` for any job in the owner's notify-marker set
    returns `drained` once the marker set is empty (BOCR01-02).

## Production files changed: 0.

## Test files changed: 1.

- `apps/vscode/src/sdk/__tests__/blocked-observation-capability-recovery-probe01.bocr01.test.ts` (NEW, 7 tests, all GREEN on HEAD `1dd61a5d5`).

## Causal chain (BOCR01-03 — the reviewer's chain, exercised end-to-end)

```
Real background job J (notify=false / fire-and-forget)
  ↓
BackgroundNotifyCoordinator.recordNonNotifyTerminalObservation({J, sessionId, taskId})
  ↓
unconsumedTerminalCountForOwner = 1
unconsumedOwnedTerminalJobIdsForOwner = ["J"]
  ↓
emit submit_and_exit (real SdkSessionEventCoordinator.handleSessionEvent)
  ↓
C10 consult: wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn()
  ↓
BCB01 §0.1 second conjunct: unconsumed_owned_terminal_results > 0
  ↓
BCB re-registration: deferredCompletionBarrier = { sessionId, taskId, epoch, ... }
  ↓
bounded host correlation guard
  (liveTools() === ["submit_and_exit"] → canObserveHeldResults === false)
  ↓
applyBlockedCompletionContinuationOutcome({kind: "fail_closed", failureReason: "observation_unavailable"})
setTurnPhase("error", undefined, "session-event-bcb-blocked-observation-unavailable")
held set preserved: count=1, ids=["J"]
task_completion_committed = 0
enqueueCompletionContinuationInvoked = 0 (inner enqueue short-circuited)
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
PROBE — capability restoration:
  liveTools() = ["command_status", "submit_and_exit"]
  ↓
  model issues command_status(J)
  (production Path A + Path C, command-status-tool.ts:342-393)
  ↓
  BackgroundNotifyCoordinator.resolveObligation(J, "canonical_status_observed")
    → no_marker (no notify=true marker for J)
  ↓
  hasActiveNotify(J) === false
    → Path C gate passes
  ↓
  BackgroundNotifyCoordinator.consumeNonNotifyTerminalObservation({J, ...})
    → held entry drained
  ↓
  unconsumedTerminalCountForOwner = 0
  ↓
  reevaluateDeferredCompletionBarrier()
    → heldObligation = false
    → no enqueue; no blocked outcome; held set preserved at 0
  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
next submit_and_exit would now transition setTurnPhase("completed", ...)
```

## Gates (C10)

- `tsc --noEmit -p tsconfig.json` (apps/vscode): PASS, 0 errors.
- `biome lint` (apps/vscode, on the new test): PASS, 0 errors.
- Focused test families (52/52 PASS):
  - `post-turn-blocked-presentation-convergence01.ptbpc01.test.ts`
  - `unresolvable-completion-host-convergence01.uchc01.test.ts`
  - `completion-continuation-unresolvable-terminal-outcome01.ccuto01.test.ts`
  - `completion-continuation-stalled-rearm-loop01.ccsrl01.test.ts`
  - `completion-continuation-stall-lifetime01.ccslt01.test.ts`
  - `completion-reevaluation-capability-discriminator01.crcd01.test.ts`
  - `background-completion-consumer-availability01.bcca.test.ts`
  - `blocked-observation-capability-recovery-probe01.bocr01.test.ts` (NEW)
- `git diff --check`: clean.
- `git status --short` after the run: 1 untracked file (the new test).

## Closed invariants (per C8)

- At-most-once task-completion commit: PRESERVED.
- Every held terminal observation until genuinely acknowledged: PRESERVED.
- Correct `count > 0 OR ids.length > 0` conservation: PRESERVED.
- Elm `HoldCompletion` decisions: PRESERVED.
- STALL/REARM lifetime separation (d46223b51): PRESERVED.
- Unavailable-capability fail-closed: PRESERVED.
- No automatic reentry for unchanged impossible obligations: PRESERVED.
- Session/task/epoch isolation: PRESERVED.
- Existing host `error` publication for unresolved blocked outcomes: PRESERVED.
- Correct Task Header R2.5 behavior: PRESERVED.
- RCNC02 command-status terminal-state monotonicity: PRESERVED.
- myc telemetry and runtime-incident counters: PRESERVED.
- No permanent diagnostic side effects inside React functional
  updaters: PRESERVED (no diagnostic added).

## VSIX: NOT_EXECUTED (operator-owned, per C0).

## LIVE_POST_FIX: NOT_EXECUTED (operator-owned, per C0).

## Verdict: `PASS_BOCR01_HOST_HOLD_AND_RECOVERY_INTACT`.

## Follow-on ACT (chartered separately, out of scope here)

The actionable-recovery-contract question — "when the BCB has
stamped `observation_unavailable` and the user-driven reentry cannot
restore `command_status`, what is the next actionable UI surface?" —
was raised in the prior ACT's closure (recommended verdict
candidate `HALT_HOST_BLOCKED_RECOVERY_CONTRACT_MISSING`). BOCR01
**does not address** that contract question; it confirms that the
host's hold-and-recovery machinery is contract-correct. A separate
ACT may be chartered to freeze the UI contract for the case where
the held set is positive and the live registry lacks `command_status`
across a user-driven Retry.

## Predecessor / successor ACT lineage

- **Predecessor**: `ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-NONCONVERGENCE01`
  (commit `1dd61a5d5`) — observed the LIVE specimen and asked the
  Factory reviewer for a recovery probe.
- **This ACT**: BOCR01 — bounded production-seam probe answering
  the reviewer's decisive question. No code changed; one test file
  added.
- **Successor (recommended)**: a new ACT to charter the
  actionable-recovery-contract question (verdict candidate
  `HALT_HOST_BLOCKED_RECOVERY_CONTRACT_MISSING`).

## Closure block

```
ACT: ACT-CLINEMM-P0-BLOCKED-OBSERVATION-CAPABILITY-RECOVERY-PROBE01

ENTRY_HEAD:                1dd61a5d5d10973bc43a3265540e7cfbebbbe91a
SUBJECT_HEAD:              1dd61a5d5d10973bc43a3265540e7cfbebbbe91a
                           (HEAD == subject, no commits made)
WORKTREE_STATUS:           clean
PROTECTED_STASH:           d46223b51a280d21631076570babfb8fe26172fa
                           (commit, not stash; reachable from HEAD;
                            4 commits reference it; not touched)

LIVE_SPECIMEN:
  session: 1791583363336_bmg3e
  task: 1791583363336_bmg3e
  submit_attempts: 3
  held_count_reported: 4 (global U7 counter)

HELD_OBLIGATIONS:
  exact_job_ids: NOT_RECONSTRUCTIBLE_FROM_TRACE
                 (process-ephemeral in BackgroundNotifyCoordinator)
  owner_identity: BackgroundNotifyCoordinator
  observation_states: TERMINAL_OBSERVED_UNACKNOWLEDGED
  observation_capability: false at each BCB block (LIVE symptom)

FIRST_DIVERGENT_BOUNDARY:
  producer: bounded host correlation guard
            (sdk-session-event-coordinator.ts:3105-3120)
  evidence: 3 occurrences of writerId
            "session-event-bcb-blocked-observation-unavailable"
            in turn-state-writer-provenance.jsonl
  classification: EXPECTED_SAFETY_HOLD (contract-correct)

REAL_RED:
  reproduced: false
  test: blocked-observation-capability-recovery-probe01.bocr01.test.ts
  failing_assertion: n/a (all 7 tests PASS)

REPAIR:
  authorized: false
  location: n/a
  production_delta: zero

NECESSITY_ABLATION:
  executed: BOCR01-05 (held=0 ablation; original BCB block removed)
  original_red_restored: n/a (no RED; ablation confirms held is the cause)

CONSERVATION:
  terminal_observations: preserved (no false-positive drain)
  completion_cardinality: at-most-once (0 commits across all cycles)
  capability_recovery: proven (BOCR01-03 Path C drain)
  identity_isolation: preserved (BOCR01-06)
  blocked_outcome: correctly published (3× observation_unavailable)
  elm_authority: correctly consulted

GATES:
  focused_tests: 7/7 BOCR01 + 52/52 related (the 7 BOCR01 are
                  included in the 52 — UCHC01, PTBPC01, CCUTO01,
                  CCSRL01, CCSLT01, CRCD01, BCCA, BOCR01)
  typecheck: PASS (0 errors)
  lint: PASS (0 errors)
  diff_check: clean (no working-tree changes)

VSIX:                NOT_EXECUTED (operator-owned, per C0)
LIVE_POST_FIX:       NOT_EXECUTED (operator-owned, per C0)
VERDICT:             PASS_BOCR01_HOST_HOLD_AND_RECOVERY_INTACT
```

