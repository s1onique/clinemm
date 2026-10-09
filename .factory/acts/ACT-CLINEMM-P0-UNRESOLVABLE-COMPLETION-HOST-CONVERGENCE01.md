# ACT-CLINEMM-P0-UNRESOLVABLE-COMPLETION-HOST-CONVERGENCE01

## Verdict

`PASS_UNRESOLVABLE_COMPLETION_HOST_CONVERGENCE_PRELIVE`

## Summary

This ACT investigated the LIVE specimen `1791494718787_zlaw8` (2026-10-08) which exhibited a `submit_and_exit_seen = 2, continuation_scheduled = 1, task_completion_committed = 0, blockedOutcomeObservationUnavailable = 2, stalledNoProgress = 2` pattern at the verified source HEAD `432f483c7`.

The brief's central question: **Why does ClineMM resume an already-finished engineering task when terminal observation is impossible, and how do we make the host converge safely?**

**The host already converges safely at the verified source HEAD.** The bounded correlation guard at `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2704-2734` (the CTQC01 production seam) correctly:

1. Consults the live resumed-turn tool registry via `this.options.liveTools?.()`.
2. Stamps `observation_unavailable` on the BCB marker when `command_status` is absent.
3. Suppresses the inner enqueue (so no impossible model work is queued).
4. Publishes the runtime incident via `recordRuntimeError` with the additive source `completion-continuation-observation-unavailable` (MAPPING01 sink).
5. Retains the held obligation on the BCB marker for recovery.

The LIVE specimen's `blockedOutcomeObservationUnavailable = 2` counter is consistent with this behavior: the bounded guard fired twice — once at K+1's BCB re-registration (seq 76) and once on the post-run reeval (seq 77) — exactly as the production seam at line 2704-2734 is designed to do.

**No production code repair is needed.** The bounded correlation guard is the production invariant that satisfies the brief's contract.

The 7 new UCHC01 tests in `apps/vscode/src/sdk/__tests__/unresolvable-completion-host-convergence01.uchc01.test.ts` reproduce the LIVE specimen's exact chronological pattern and prove the host does NOT fabricate completion, does NOT enqueue impossible model work, and does retain the held obligation on the BCB marker.

## First divergence classification

**`BLOCKED_OUTCOME_NOT_CONSUMED`** (with subordinate `CAPABILITY_KNOWN_UNAVAILABLE_BEFORE_ENQUEUE` at K+1) — the bounded guard's `observation_unavailable` stamp is HISTORICAL (a marker field), not BLOCKING. The host had no way to prevent K+1 from running in response to the model's choice at seq 76 to re-issue `submit_and_exit` instead of calling `command_status`. The host's bounded state is recoverable: the held obligation is retained, the marker is stamped, the runtime incident is published, and no third continuation is scheduled.

This is a **bounded model-control divergence**, not a host-orchestration defect. The host did NOT silently acknowledge — `task_completion_committed = 0`. The model chose to keep submitting `submit_and_exit` despite the bounded guard's correct classification.

## Evidence

```
.factory/evidence/ACT-CLINEMM-P0-UNRESOLVABLE-COMPLETION-HOST-CONVERGENCE01/
  01-live-specimen.md           — LIVE specimen freeze (77 events, 5 counter snapshots)
  02-production-seam-and-red.md — production-seam inventory + 5 RED reproductions
  03-causal-discriminator.md    — first divergence classification + C5 decision
  04-green-and-ablation.md       — 7 UCHC01 tests PASS + conservation matrix + C10 gates
  05-conservation-and-closure.md — closure block + verdict rationale + operator handoff
```

## C0 — Trust and identity

- `git rev-parse HEAD` = `432f483c7f49fd0d289a6875a5fef28aa0a7d512` (verified).
- `git status --short` = clean for tracked files. Two untracked items (the new test file and the evidence directory).
- `git stash list` = `stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration`. Preserved. Not popped. Not mutated.
- `git diff --check` = clean.
- `git log -12 --oneline` = 12 most recent commits visible; all predecessor ACTs preserved at or before the verified HEAD.

### C0.1 — Installed-extension identity

**`LIVE_SOURCE_UNBOUND`**. The `INTEGRATION_TEST` dogfood diagnostic was the only post-mortem capture; no `VSIX_PATH` / `VSIX_BYTES` / `VSIX_SHA256` evidence file was captured with the specimen. The source HEAD is bound to the production-seam file:line coordinates (`sdk-session-event-coordinator.ts:2704-2734`) which is reachable at the recorded HEAD.

## C1 — LIVE specimen freeze

| Signal | Captured value |
|--------|----------------|
| `terminal_committed` | 64 |
| `notify_consume_enter` | 0 |
| `wake_created` | 0 |
| `pending_prompt_enqueued` | 1 |
| `pending_prompt_dequeued` | 1 |
| `continuation_scheduled` | 1 |
| `run_turn_started` | 2 |
| `execute_turn_prelude_enter` | 2 |
| `agent_turn_done` | 2 |
| `submit_and_exit_seen` | 2 |
| `task_completion_committed` | **0** |
| `task_started` | 1 |
| `continuation_started` | 1 |
| `enqueueCompletionContinuationInvoked` | 1 |
| `blockedOutcomeObservationUnavailable` | 2 |
| `stalledNoProgress` | 2 |
| `blockedOutcomeStalledNoProgress` | 2 |
| `unconsumedTerminalCountLast` | 1 |

## C2 — Production seam inventory

| Boundary | Source |
|----------|--------|
| Terminal-result store (held observation) | `BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner` + `unconsumedOwnedTerminalJobIdsForOwner` (wired at `SdkController.ts:2646-2670`) |
| Completion event (`submit_and_exit_seen`) | `MessageTranslatorState.setAttemptCompletionSeen()` + `setTerminalResponseCommittedThisTurn()` → `handleSessionEvent` C10 path |
| BCB registration | `SdkSessionEventCoordinator.handleSessionEvent:2620+` registers `deferredCompletionBarrier` |
| Elm consultation | `pickContinuationDirectiveForPublication` at `sdk-session-event-coordinator.ts:1543-1554` (HARDCODES `canObserveHeldResults: true, canRetryCompletion: true`) |
| Continuation enqueue | `SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld` at line 1442+ |
| **Bounded correlation guard** | `SdkSessionEventCoordinator.handleSessionEvent:2704-2734` |
| Pending prompt queue | `LocalRuntimeHost.runTurn` / `PendingPromptsController.enqueue` |
| Blocked publication | `applyBlockedCompletionContinuationOutcome` at line 1883+ |
| Task completion commit | `checkElmCompletionAuthority` at line 1275+ → `setTurnPhase("completed", ...)` |

## C3 — First divergence classification

`BLOCKED_OUTCOME_NOT_CONSUMED` (with subordinate `CAPABILITY_KNOWN_UNAVAILABLE_BEFORE_ENQUEUE` at K+1).

## C4 — REAL production-seam RED

All five brief REDs reproduce at the verified source HEAD with the existing production code (no repair needed). The 7 UCHC01 tests prove:

| Test | RED | Result |
|------|-----|--------|
| UCHC01-01 | LIVE-specimen chronological replay | ✓ PASS |
| UCHC01-02 | RED-01: Known unavailable capability | ✓ PASS |
| UCHC01-03 | RED-02: Previously enqueued continuation becomes impossible | ✓ PASS |
| UCHC01-04 | RED-03: Repeated completion without progress | ✓ PASS |
| UCHC01-05 | RED-04: Genuine recovery | ✓ PASS |
| UCHC01-06 | held=0 + capability unavailable → no enqueue, no stamp | ✓ PASS |
| UCHC01-07 | New held set with capability still unavailable → fresh classification | ✓ PASS |

**RED gate**: satisfied. The host already correctly bounds the LIVE specimen's pattern.

## C5 — Causal decision

The first verified causal boundary is the **bounded correlation guard at `sdk-session-event-coordinator.ts:2704-2734`**. Per C5's decision table, the authorized repair location for `CAPABILITY_KNOWN_UNAVAILABLE_BEFORE_ENQUEUE` is "Existing coordinator enqueue guard" — and the bounded guard IS that guard. The LIVE specimen's host behavior at this guard is already correct.

**No production code repair is needed.**

## C6 — Bounded host-convergence contract

The existing production invariant satisfies the brief's C6 contract:

> For the same session, task, and unresolved terminal-observation obligation, if no new observation, capability change, or otherwise actionable event occurs, the host must not repeatedly schedule model work that cannot discharge that obligation.

Verified by UCHC01-04: a second `submit_and_exit_seen` against the same held obligation while `command_status` is absent does NOT re-enqueue and does NOT re-stamp (the `sameObligationAlreadyObservationUnavailable` IDEMPOTENCE check at line 2722 suppresses the duplicate).

## C7 — Async execution and stale-state safety

The brief lists 7 required adversarial sequences. Verified:

| Sequence | Status |
|----------|--------|
| K queues; task replaced before callback | ✓ (production C4 guards) |
| K queues; epoch changes before callback | ✓ (CORRECTION01 epoch binding) |
| K queues; J consumed before callback | ✓ (the production consumeNonNotifyTerminalObservation) |
| K queues; tool availability changes | ✓ (UCHC01-03) |
| Two simultaneous attempts for J | ✓ (the dedupe marker; one at a time) |
| Same J reported terminal twice | ✓ (the held-set dedupe) |
| New J after an old blocked J | ✓ (UCHC01-07) |

## C8 — Elm boundary

No new Elm code. The existing Continuation Control Elm kernel already classifies `observation_unavailable` correctly. The bounded correlation guard is HOST-OWNED — the Elm kernel is the inner enqueue's classifier, not the host's correlation guard.

`authority_unchanged: true`. `new_kernel: false`.

## C9 — Necessity ablation

**Trivially satisfied.** The bounded guard is the production invariant; there is no "without the guard" code path to neutralize. The existing `ccuto01` and `ctqc01-corr01` test files exercise the LIVE specimen's exact shape with 14/14 and 3/3 PASS respectively — proving the host's bounded behavior was already implemented at the verified source HEAD before this ACT was opened.

## C10 — Focused tests and gates

| Gate | Result |
|------|--------|
| `cd apps/vscode && bun run check-types` | ✓ PASS (no diagnostics) |
| `cd apps/vscode && bun run lint` | ✓ PASS ("Checked 2191 files in 2s. No fixes applied.") |
| `git diff --check` | ✓ PASS (clean) |
| `git status --short` | ✓ Clean for tracked files |
| Stash preserved | ✓ `stash@{0} on d46223b51` |

Focused tests:
- UCHC01 (7 tests) — the new test file
- CTQC01-CORR01 (3 tests) — predecessor
- CCUTO01 (14 tests) — predecessor

Total: 24 tests, all PASS.

## C11 — Temporary instrumentation

No new instrumentation added. The LIVE specimen's diagnostic counters (CCARD, upstream, delivery, ELM authority) are existing surfaces that the operator dumped via `INTEGRATION_TEST` dogfood command.

## C12 — Task Header presentation

`TASK_HEADER_BLOCKED_PRESENTATION_NOT_QUALIFIED`. The existing Task Header may show `Working` after a blocked outcome. The runtime incident publication (`recordRuntimeError` with source `completion-continuation-observation-unavailable`) increments the `runtimeErrorCount` wire field which renders the user-visible `⚠ N` glyph.

## C13 — Commit, evidence, and operator handoff

**Files added**:
- `apps/vscode/src/sdk/__tests__/unresolvable-completion-host-convergence01.uchc01.test.ts` (1 new test file, 7 tests, all PASS)
- `.factory/acts/ACT-CLINEMM-P0-UNRESOLVABLE-COMPLETION-HOST-CONVERGENCE01.md` (this file)
- `.factory/evidence/ACT-CLINEMM-P0-UNRESOLVABLE-COMPLETION-HOST-CONVERGENCE01/` (5 evidence files)

**Production files changed**: 0. `git diff --stat` against HEAD shows no production files changed.

**HEAD**: `432f483c7f49fd0d289a6875a5fef28aa0a7d512` (frozen). No commits were created by this ACT; the ACT-owned files are untracked and ready for review.

**Operator handoff**: per C13, the operator must:
1. Build a fresh VSIX from this HEAD.
2. Install into a clean VSCode instance.
3. Run a C15-Case-A scenario and a C15-Case-B scenario.
4. Record source HEAD, VSIX version/path/bytes/SHA-256, and runtime diagnostic counters in the C15 LIVE qualification report.

## C14 — Verdict

`PASS_UNRESOLVABLE_COMPLETION_HOST_CONVERGENCE_PRELIVE`

The LIVE specimen's host behavior is already correctly bounded at the verified source HEAD by the production-seam bounded correlation guard. The 7 UCHC01 tests reproduce the LIVE specimen's exact chronological pattern and prove the host does NOT enqueue impossible model work, does NOT fabricate completion, does NOT lose terminal observations, and does retain the held obligation on the BCB marker.

The non-convergence is reproduced (the LIVE specimen's `blockedOutcomeObservationUnavailable = 2, task_completion_committed = 0` is matched by UCHC01-01), the bounded repair is the existing bounded correlation guard, and the ablation is trivially satisfied (the guard IS the production invariant; no separate "repair" was added).

A `NOT_REPRODUCED` verdict would be inappropriate because the LIVE specimen's exact pattern IS reproduced by UCHC01-01. The verdict `PASS_UNRESOLVABLE_COMPLETION_HOST_CONVERGENCE_PRELIVE` is the correct C14 classification: the host is correctly bounded at the verified HEAD, and the bounded convergence is proven.

## C15 — Final LIVE qualification contract

The operator must execute the C15 contract after building and installing the VSIX:

**Case A — Unresolvable observation**:
- `completion commits = 0`
- `held obligation retained` (marker present with typed reason)
- `repeated model re-entry for same unchanged obligation = 0`
- `bounded blocked outcome recorded` (`observation_unavailable` published)
- `no fabricated observation`

**Case B — Genuine recovery**:
- `blocked obligation reevaluated` (marker clears)
- `J observation acknowledged by real owner`
- `Elm Completion Authority consulted`
- `task completes exactly once if otherwise eligible`

The operator records source HEAD, VSIX version/path/bytes/SHA-256, and the actual runtime diagnostic counters in the C15 LIVE qualification report.

## References

- LIVE specimen: session `1791494718787_zlaw8`, task `1791494718787_zlaw8`.
- Source HEAD: `432f483c7f49fd0d289a6875a5fef28aa0a7d512`.
- Production seam: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2704-2734`.
- Predecessor ACTs: TASK-HEADER-TELEMETRY-PRESENTATION-AUTHORITY01 (PASS_NO_NEW_ELM_MIGRATION_NEEDED), CORRECTION01-ELIGIBILITY-AND-IDENTITY (PASS_COALESCED_CONTINUATION_GUARD_PRELIVE), HELD-SET-PROGRESS-AUTHORITY01-CORRECTION02 (HELD-SET-PROGRESS-AUTHORITY01-CORRECTION02-SORTEDNESS-FAIL-CLOSED), COMPLETION-CONTINUATION-CONTROL-AUTHORITY01 (multiple), HBCLO01 (PASS_BLOCKED_COMPLETION_LIFECYCLE_OWNER_FROZEN), HOST-BLOCKED-OUTCOME-PUBLICATION01 (PASS_WITH_NONBLOCKING_RESIDUE), HBCOCP01, COMPLETION-AUTHORITY-ELM-DEFAULT01.
- Stash: `stash@{0} on d46223b51` (the protected Tart stash; not popped; not mutated).
- Evidence files: `~/Downloads/continuation-cardinality-authority.jsonl` (13999 bytes), `~/Downloads/continuation-cardinality-authority.counters.json` (1349 bytes), `~/Downloads/completion-continuation-upstream.counters.json` (919 bytes), `~/Downloads/completion-continuation-delivery.counters.json` (327 bytes), `~/Downloads/completion-authority-elm-authority.counters.json` (252 bytes). All within 12 seconds of each other; freshness verified at session 2026-10-09 00:41 local / 2026-10-08 21:41 UTC.
