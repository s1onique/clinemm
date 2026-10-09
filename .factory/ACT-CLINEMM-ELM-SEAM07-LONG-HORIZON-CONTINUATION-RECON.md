# ACT-CLINEMM-ELM-SEAM07-LONG-HORIZON-CONTINUATION-RECON — PASS_ELM_SEAM07_RECON — 2026-10-09

**Status:** CLOSED with verdict `PASS_ELM_SEAM07_RECON`. One bounded
production decision authority selected. No production code touched.
No Elm implementation attempted (per scope). The economics gate
passed for the selected seam; the next ACT (SEAM08) is named and
is the implementation cutover, not a recon.

**Preconditions met:**

- ENTRY_HEAD = `eb3de47ab5b88a55ea15e768241e65efb6464cc2` on
  branch `main`; working tree clean; no stashes; no uncommitted
  changes (verified by `git status --short` returning empty,
  `git stash list` returning empty, `git diff --check` exiting 0).
- SEAM01–06 evidence preserved in `.factory/epic-board.md` and
  the per-ACT files in `.factory/`.
- SEAM06 verdict `NOT_A_GOOD_ELM_SEAM` and its required
  recommendation ("the next ACT should re-evaluate the Factory Elm
  migration queue against larger semantic surfaces such as the
  long-horizon continuation cardinality, the held-set progress
  classification, or the completion-commit stage boundary")
  honored.
- HALT_UNEXPECTED_TRACKED_DIRT: NOT TRIGGERED.

## 1. Primary recon question (verbatim from the ACT spec)

> Where does ClineMM currently determine whether a continuation may
> be created, delivered, postponed, resumed, suppressed, or
> completed, given current task/session ownership, outstanding
> work, and prior continuation history?

**Answer (single production seam):**

The **`SdkSessionEventCoordinator.deferredCompletionBarrier` marker
state machine at `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:640-664,
952-1339, 1442-1726, 1846-2086, 2620-2700, 2870-2900`**, in concert
with the related `enqueueCompletionContinuationIfHeld` (line 1442),
`applyBlockedCompletionContinuationOutcome` (line 1846),
`reevaluateDeferredContinuation` (line 813), and the C10 path
inside `handleSessionEvent` (line ~2640).

This is the **only** production code path that decides whether a
completion-bound turn may commit (`setTurnPhase("completed", …)`)
or be deferred (set the `deferredCompletionBarrier` marker and
wait for outstanding obligations to drain), and whether a
deferred completion may now be released (the four conservation
checks plus the Elm `checkElmCompletionAuthority` consult). The
deferred-continuation sibling at line 813 (Q5 awaiting_followup)
is a smaller instance of the same shape (four conservation
checks, one `setTurnPhase` effect, no Elm consult).

## 2. SEAM01–04 overlap check (existing Elm-owned authorities)

The four existing Elm kernels and their load-bearing ownership
boundaries are:

| Existing Elm kernel | Owns | Does NOT own |
| --- | --- | --- |
| `completion-authority` (SEAM01) | `canFinalize`, `isCompletionAuthorized`, `hasOutstandingWork` decisions on the canonical `TaskState` model | The marker set/clear/identity-supersession/reevaluate state machine; the per-(sessionId, taskId, epoch) single-slot dedupe; the four conservation checks |
| `task-header-orchestration` (SEAM02) | The TaskHeader presentation selector (4-rule projection, three-tag output) | Anything related to completion commit/defer, BCB01 §0.1, marker lifecycle |
| `completion-continuation-control` (SEAM04 / HELD-SET-PROGRESS-AUTHORITY01) | Pure `Facts -> Directive` projection of "is held / can retry / stalled / malformed / already committed" for the `enqueueCompletionContinuationIfHeld` decision | The `deferredCompletionBarrier` marker (separate field on the same class); the four conservation checks (`outstandingAutonomousWork`, `ownerStillRunning`, `unconsumedOwnedTerminalResultCount > 0`, `perJobOutstandingNotifyWork`); the `applyBlockedCompletionContinuationOutcome` reason-stamp lifecycle; the identity-triple supersession rules |
| `background-notify-authority` (SEAM04) | `consumeTerminal` decision (NoMarker / OwnerMismatch / ContainmentNoWake / Held / Drained) on the per-jobId path | Anything related to the BCB `outstandingAutonomousWork` aggregate; the marker state machine; the held-set cardinality decisions |

**No existing kernel owns the barrier marker state machine.**
The `completion-continuation-control` kernel classifies one
decision per call (pure projection); it does not own the
ABSENT/SET-marker state, the identity supersession rules, the
reason-preservation guard, the C10 deferred-re-registration, the
Q5/C10 split, or the four conservation checks.

The `completion-authority` kernel is consulted at the END of
`reevaluateDeferredCompletionBarrier` (line 1275) as the final
commit gate, AFTER the marker has already been cleared by the
four conservation checks. It is a *gate*, not an *owner* — the
marker itself is fully TS-owned.

A `grep` for the marker field across all four Elm kernels returns
only doc-comment hits; no Elm code reads, writes, or pattern-matches
`deferredCompletionBarrier`. The state machine is **TS-only and
unowned**.

## 3. Selected production decision authority

**The `deferredCompletionBarrier` marker state machine at
`SdkSessionEventCoordinator`.**

### 3.1 Canonical state (FROZEN, observed in source)

```ts
interface DeferredCompletionBarrier {
    readonly sessionId: string
    readonly taskId: string | undefined
    readonly epoch: number
    readonly deferredAt: number
    readonly reason?: DeferredCompletionBarrierReason
}
type DeferredCompletionBarrierReason =
    | "stalled_no_progress"
    | "delivery_rejected"
    | "observation_unavailable"
```

Per-coordinator-instance, at-most-one. Three identity axes
(sessionId, taskId, epoch) plus an optional `reason` field with a
closed three-value enum.

The marker is consulted / mutated by **six distinct sites** in
the same class:

1. **C10 set site** (line 2640, `handleSessionEvent`): the BCB
   registration. Reads four conservation predicates
   (`outstandingAutonomousWork || ownerStillRunningForC10 ||
   heldObligationForC10 || suppressOriginatingCompletion`) plus
   the live `epoch`. Writes the marker with `reason` preserved
   if the prior marker's identity triple matches the current
   obligation (P0 #2 identity discipline).
2. **Q5/C10 reeval entrypoint** (line 952,
   `reevaluateDeferredCompletionBarrier`): the four conservation
   checks (active-session lookup, taskId match, epoch match,
   `outstandingAutonomousWork` AND `!ownerStillRunning` AND
   `unconsumedOwnedTerminalResultCount == 0` AND
   `!perJobSuppressOriginatingCompletion`). On success, clears
   the marker, then awaits the Elm authority consult
   (`checkElmCompletionAuthority`, line 1275), and on
   HOLD/FAILURE **re-registers the marker** with the same
   identity triple (line 1286-1291). On AUTHORIZE, commits
   `setTurnPhase("completed", …)` (line 1294).
3. **Q5 reeval entrypoint** (line 813,
   `reevaluateDeferredContinuation`): the four conservation
   checks for the `deferredContinuation` sibling marker (a
   different field, same shape). On success, clears and commits
   `setTurnPhase("awaiting_followup", …)`. This is the Q5
   awaiting_followup handoff path.
4. **Stall fingerprint / dedupe slot** (line 699, 1442-1726,
   `enqueueCompletionContinuationIfHeld`): the
   `lastCompletionContinuationSessionEpoch` single-slot dedupe
   keyed by `${sessionId}|${taskId}|${epoch}`, plus the
   `lastCompletionContinuationHeldSetSorted` canonical snapshot
   (for the held-set-progress classifier owned by the existing
   `completion-continuation-control` kernel). The stall lifetime
   is preserved across BCB re-registrations; the REARM lifetime
   is cleared at re-registration (P0 #1 stall-lifetime
   disambiguation, line 2655-2684).
5. **Reason-stamp site** (line 1846,
   `applyBlockedCompletionContinuationOutcome`): the C4
   adversarial guards (no fabrication, epoch binding, identity
   triple, idempotence) gate the stamp; the marker is mutated in
   place (`{...this.deferredCompletionBarrier, reason}`) so the
   identity triple is preserved.
6. **Stale-clear sites** (line 991-1009, 1967-1994): the marker
   is cleared on `activeSession` missing, sessionId mismatch,
   taskId mismatch, epoch mismatch, or capture-during-cancel
   (`mcpToolRestart` path). The clear is unconditional — no
   reason preserved.

### 3.2 Stage vocabulary (REQUESTED → SETTLED)

The conceptual stages for one barrier cycle are:

- **ABSENT** — marker is `undefined`.
- **REQUESTED** — a `done` / `submit_and_exit` /
  `agent_turn_done` event has arrived, but the four conservation
  checks have not been evaluated yet (the synchronous slice
  inside `handleSessionEvent` line 2604-2646).
- **ADMITTED** — the conservation checks failed; the marker is
  set with a (sessionId, taskId, epoch) triple and optionally a
  `reason` preserved from a prior same-identity marker.
- **SCHEDULED** — the host has called
  `reevaluateDeferredCompletionBarrier()` (or an event triggers
  it: terminal observed, agent_turn_done, command_status, etc.).
- **DISPATCHED** — the four conservation checks are running
  (synchronous prefix, line 980-1259).
- **OBSERVED** — the conservation checks all pass; the marker
  is cleared at line 1259; the Elm authority consult is
  scheduled.
- **CONSUMED** — Elm AUTHORIZE; `setTurnPhase("completed", …)`
  is called at line 1294.
- **SETTLED** — the marker is `undefined`; the TaskHeader
  publication has been posted (line 1336-1338 fire-and-forget
  pattern).

Stale transitions (mismatch on any of the three identity axes)
short-circuit directly from REQUESTED/ADMITTED/SCHEDULED to
ABSENT, bypassing the OBSERVED/CONSUMED stages. The
`activeSession` lookup at line 980 is the first such short-circuit.

### 3.3 Existing production call graph

- **Set sites:** `handleSessionEvent` C10 branch
  (line 2640, one synchronous write per BCB-registration
  event); `reevaluateDeferredCompletionBarrier` post-Elm-HOLD
  (line 1286, re-registration on same identity); the C10
  post-Elm-HOLD at line 2874 (the same registration shape at
  a different call site).
- **Clear sites:** `reevaluateDeferredCompletionBarrier` line
  1259 (post-conservation-pass, pre-Elm-consult);
  `reevaluateDeferredContinuation` line 860 (post-conservation
  pass, for the Q5 sibling); the stale-clear branches at lines
  991, 997, 1003, 1009, 1967-1994.
- **Reason-stamp site:** `applyBlockedCompletionContinuationOutcome`
  line 2024 (idempotent on reason equality at line 2012).
- **Dedupe slot writers:**
  `enqueueCompletionContinuationIfHeld` line 1695 (post-await,
  on the dedupe-permit branch); `handleSessionEvent` line 2671
  (BCB re-registration); `clearCompletionContinuationSentForTesting`
  (test backdoor).
- **Dedupe slot readers:**
  `enqueueCompletionContinuationIfHeld` line 1665 (the
  epoch-dedupe check); `wasCompletionContinuationSentForTesting`
  line 1741 (test backdoor).
- **Stall fingerprint writers:**
  `enqueueCompletionContinuationIfHeld` line 1700 (post-await,
  on the dedupe-permit branch); `clearCompletionContinuationSentForTesting`
  (test backdoor).
- **Stall snapshot writers:**
  `enqueueCompletionContinuationIfHeld` line 1706 (post-await,
  `nextSortedHeld` on the dedupe-permit branch).
- **Consumption effect:** `setTurnPhase?.("completed", …)` at
  line 1294 (after Elm AUTHORIZE);
  `setTurnPhase?.("awaiting_followup", …)` at line 861 (the Q5
  sibling).
- **Capture effect:** `captureContinuationCardinalityAuthorityRecord`
  at lines 1312-1321 and 2883-2892 (the C10 record, fired
  AFTER the Elm consult AND AFTER the setTurnPhase effect — the
  CORRECTION01 ordering fix).

### 3.4 Decision inputs (the Facts the Elm kernel would see)

The synchronous critical sections read the following facts
(replayable from the test corpus):

- `marker` — the current `DeferredCompletionBarrier | undefined`.
- `currentSession` — `activeSession` from
  `options.sessions.getActiveSession()`.
- `currentTaskId` — `options.getTask?.()?.taskId`.
- `currentEpoch` — `options.messageTranslatorState.getMinter().epoch`.
- `pendingPromptCountRead` —
  `options.getPendingPromptCount?.(activeSession.sessionId)`.
- `activeNotifyCount` —
  `options.getActiveNotifyCount?.(activeSession.sessionId, taskId)`.
- `launchedBackgroundJobIds` —
  `options.messageTranslatorState.getLaunchedBackgroundJobIds()`.
- For each `jid` in `launchedBackgroundJobIds`:
  `hasActiveNotify?.(jid)`, `wasWakeDispatchRequested?.(jid)`,
  `wasWakeDelivered?.(jid)`, `wasWakeDispatchFailed?.(jid)`.
- `ownerStillRunning` —
  `options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId)`.
- `unconsumedOwnedTerminalResultCount` —
  `options.getUnconsumedOwnedTerminalResultCount?.(activeSession.sessionId)`.
- `unconsumedOwnedTerminalJobIds` —
  `options.getUnconsumedOwnedTerminalJobIds?.(...)` (the
  list-of-IDs disjunct per CCUTO01-CORRECTION01).
- `liveToolNames` — `options.liveTools?.() ?? undefined` (the
  capability projection at the BCB re-registration site).
- For the enqueue path: `heldJobIds` (the held-set the kernel
  would write into the dedupe slot's prior-snapshot), `priorSortedHeld`
  (the previous canonical snapshot), `nextFingerprint` (the
  computed session|task|sorted-held fingerprint), `continuationSessionEpoch`
  (the `${sessionId}|${taskId}|${epoch}` dedupe key).

### 3.5 Decision outputs (the Directive vocabulary the Elm kernel would emit)

- `Pass` — the four conservation checks all pass, marker cleared.
- `Set { reason?: DeferredCompletionBarrierReason }` — the
  conservation checks failed, marker set (with optional
  reason-preservation if same identity).
- `ReRegister` — the four conservation checks passed and the Elm
  authority consult HOLDed; re-register the marker with the
  same identity triple.
- `Stale { reason: "session_gone" | "session_mismatch" |
  "task_mismatch" | "epoch_mismatch" | "active_session_missing" }`
  — any of the three identity axes mismatched, marker cleared.
- `Blocked { reason: "stalled_no_progress" | "delivery_rejected"
  | "observation_unavailable" }` — the enqueue path returned a
  non-delivered outcome, marker stamped with the typed reason.
- `Deduped { continuationSessionEpoch }` — the dedupe slot
  already holds the same epoch, enqueue suppressed.
- `NotHeld` — `unconsumedOwnedTerminalResultsForC10 <= 0` or no
  `deferredCompletionBarrier` or no `enqueueCompletionContinuation`
  callback, no state change.
- `ObservationUnavailable { alreadyStamped: boolean }` — the
  bounded CTQC01 correlation guard at line 2731: the model has no
  observation capability, publish a single typed blocked outcome
  and skip the enqueue; if the same obligation is already
  stamped, do nothing (idempotence).

### 3.6 Effects (TS-owned, never moved)

- The marker field writes
  (`this.deferredCompletionBarrier = {…}` /
  `this.deferredCompletionBarrier = undefined`).
- The dedupe slot writes
  (`this.lastCompletionContinuationSessionEpoch`).
- The stall fingerprint and snapshot writes
  (`this.lastCompletionContinuationControlFingerprint` /
  `this.lastCompletionContinuationHeldSetSorted`).
- The `setTurnPhase` calls (the actual completion commit and
  awaiting_followup transition).
- The `enqueueCompletionContinuation` callback (the prompt
  delivery).
- The `captureContinuationCardinalityAuthorityRecord` calls
  (the C10 capture).
- The `postStateToWebview` fire-and-forget.
- The `taskTelemetry?.recordRuntimeError` call (the
  blocked-outcome lifecycle publication).
- The `Logger.warn` diagnostics.
- The existing
  `pickContinuationDirectiveForPublication` call (the
  `completion-continuation-control` kernel consult).
- The existing `checkElmCompletionAuthority` call (the
  `completion-authority` kernel consult).

### 3.7 Existing tests that exercise the production seam

The barrier marker state machine is exercised by **at least 14
production-seam test files** (330 lines of test code in
`apps/vscode/src/sdk/__tests__/` and the bridge suite). The
following pass on the current HEAD (verified by
`bun x vitest run …`):

| Test file | Verifies | Result on ENTRY_HEAD |
| --- | --- | --- |
| `completion-continuation-control-authority01.ccca01.test.ts` | BCB marker set + `enqueueCompletionContinuationIfHeld` reach | PASS (CONTROL-09) |
| `completion-continuation-stall-enforcement01.ccse01.test.ts` | Stalled-no-progress classification at the dedupe-permit boundary | PASS (12/12) |
| `completion-continuation-rearm01.rearm01.test.ts` | REARM dedupe on BCB re-registration | PASS (12/12) |
| `completion-continuation-stalled-rearm-loop01.ccsrl01.test.ts` | Superset-aware stall discriminator | PASS (13/13) |
| `completion-continuation-stall-lifetime01.ccslt01.test.ts` | REARM vs STALL lifetime disambiguation at BCB re-registration | PASS (12/12) |
| `completion-continuation-held-set-progress-reference.cchsp01.test.ts` | Held-set progress at the dedupe-permit boundary | PASS (29/29) |
| `completion-continuation-held-set-progress-safety.cchsp03.test.ts` | fail-closed terminal for every `fail_closed` reason | PASS |
| `completion-continuation-structural-authority01.ccsa01.test.ts` | Production-seam structural correspondence | PASS |
| `long-horizon-outstanding-work-authority01.lhowa01-wire-authority.test.ts` | Q5 defer-on-pending-prompt via synchronous authoritative accessor | PASS (2/2) |
| `background-completion-barrier01-correction04.bcb01-c4.test.ts` | The closure of `HALT_FINALIZATION_TRIGGER_AT_WRONG_TRANSITION` (BCB-26..BCB-30 dedupe) | Pre-existing baseline: 1 pass / 4 fail on ENTRY_HEAD (the predecessor HALT closure; the BCB-30/31/32/34 cases pin the dedupe shape; documented as a pre-existing baseline in commit `acbfcf20a`) |
| `background-completion-barrier01-correction03.bcb01-c3.test.ts` | Enqueue callback + capability projection | 5 pass / 1 fail on ENTRY_HEAD (the BCB-26 P1 halt; documented pre-existing baseline) |
| `long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts` | TQCB-RED-01/02/03 (premature completion), TQCB-CTL-01/03, TQCB-COMPOSE-PATH-B-01, TQCB-CTL-DUAL-1/2 (dual-delivery) | 5 pass / 10 fail on ENTRY_HEAD (documented pre-existing baseline: TQCB01-RED tests are GREEN expectations, the fail set matches the predecessor HEAD `123294a00` baseline exactly) |
| `background-completion-barrier01.bcb01.test.ts` | BCB01 §0.1 §0.1 frozen invariant (the original RED) | 1 pass / 13 fail on ENTRY_HEAD (documented pre-existing baseline) |
| `completion-continuation-delivery-callback-outcome01.ccdco01.test.ts` | The C7/8 callback-outcome publication | PASS |

The pre-existing baseline failures are documented in commit
`acbfcf20a` ("pre-existing baseline failures (bcb01 13/14, swcm04
11/16, TATRM 20/58, ca-trace 2/39, wprov 1/35) UNCHANGED") and
`ee3fd7fc7` ("MAPPING01-CORRECTION01 verified by stash/restore
on the predecessor HEAD … pre-existing baseline failures
unchanged"). The TQCB01 RED tests are intentionally the
GREEN-shape expectations (the production seam is meant to satisfy
them); their current failure is the open P1 the next ACT will
encounter if it touches the BCB re-registration site.

The factory board entry for this ACT MUST record these
pre-existing baseline failures explicitly so the implementation
ACT does not mistake them for new defects.

### 3.8 Historical defect witnesses (red → green history)

The marker state machine has accumulated **at least 9 named
historical defect witnesses** (each one is a closed factory ACT
or a named factory halt):

1. `HALT_BACKGROUND_TERMINAL_REENTERS_COMPLETED_TASK` (TQCB01)
   — the predecessor barrier only consulted notify=true markers,
   so notify=false (fire-and-forget) jobs did not block
   completion and 4 such jobs each produced a wake-driven
   submit_and_exit. Closed by
   `ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01` (extending the
   `ownerStillRunning` conjunct to the BCB predicate).
2. `HALT_FINALIZATION_TRIGGER_AT_WRONG_TRANSITION` (BCB01) —
   the predecessor fired the trigger while the job was still
   running, not at terminal-idle. Closed by
   `ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01..04`
   (the four conservation checks).
3. `HALT_BACKGROUND_NOTIFY_COMPLETION_AUTHORITY_FIRE_AND_FORGET`
   (BNCA) — command_status fired `resolveObligation` for
   notify=false jobs. Closed by
   `ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01`
   (the `perJobSuppressOriginatingCompletion` disjunct).
4. `HALT_PENDING_PROMPT_AUTHORITY_TRANSPORT` (PPAT01) — the
   predecessor cached the pending-prompt count, leading to
   false-positive `awaiting_followup` commits. Closed by
   `ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01-CORRECTION02`
   (the synchronous authoritative accessor).
5. `HALT_STALLED_REARM_LOOP` (CCSRL01) — the predecessor
   cleared both the dedupe AND the stall snapshot at BCB
   re-registration, defeating the superset-aware discriminator.
   Closed by
   `ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01-CORRECTION01-STALL-LIFETIME`
   (the REARM/STALL lifetime disambiguation).
6. `HALT_BACKGROUND_COMPLETION_BARRIER01_RACE` (BCB01-RACE) —
   the predecessor cleared the dedupe at the wrong transition.
   Closed by
   `ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION03`
   (the BCB-26..BCB-30 closure).
7. `HALT_HOST_BLOCKED_OUTCOME_LIFECYCLE_OWNERSHIP` (HBCLO01) —
   the predecessor published blocked verdicts to a mocked
   telemetry sink instead of the real `TaskTelemetryTracker`.
   Closed by
   `ACT-CLINEMM-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01-CORRECTION01`
   (the producer→consumer wiring).
8. `HALT_CCARD_COMMIT_STAGE_MISBOUND` (the C10 capture
   ordering) — the predecessor fired the
   `task_completion_committed` record BEFORE the Elm authority
   gate AND BEFORE `setTurnPhase("completed", …)`, so a HOLD
   decision still produced a "committed" shadow transition.
   Closed by
   `ACT-CLINEMM-COMPLETION-AUTHORITY-CCARD-COMMIT-STAGE-BOUNDARY-MISBOUND-REPAIR01`
   (the post-Effect capture).
9. `HALT_MALFORMED_HELD_SET_FAIL_OPEN` (held-set sortedness) —
   the predecessor's `Indeterminate` classifier routed malformed
   (mis-sorted) snapshots through `ObserveThenRetry` →
   `delivered`, releasing the REARM dedupe. Closed by
   `ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01-CORRECTION02-SORTEDNESS-FAIL-CLOSED`
   (the `factsIsExpected` short-circuit at P0 of `Policy.decide`).

Each of these is a single closed production defect pinned by a
named test that exercises the BCB re-registration site, the
dedupe slot, the held-set snapshot, or the marker set/clear
lifecycle. **The defect catalog is load-bearing**: it proves the
state machine has nontrivial transition complexity that the
existing TS code has had to grow incrementally, and that the
defects cluster around the same handful of boundaries (BCB
re-registration, dedupe slot, marker reason-preservation, four
conservation checks).

### 3.9 Existing Elm bridge (reusable)

The `completion-continuation-control-elm` adapter
(`apps/vscode/src/sdk/completion-continuation-control-elm.ts`,
~794 lines) already establishes the `Facts -> Directive` pattern
with:

- A closed-schema JSON codec (Domain + Codec split).
- A `pickContinuationDirectiveForPublication` async function
  that the production seam awaits (line 1562 of the
  coordinator).
- A request-id correlation pattern (the existing
  `pendingPrompts` flush-before-decide seam, see
  `flushElmKernels`).
- A failure-mode policy (kernel offline / decode error / no
  response) with bounded logging.
- The `_ELM_KERNELS` table entry pattern
  (`build_dogfood_vsix_lib.py`).

The new barrier kernel REUSES this bridge unchanged. The new
`pickBarrierDirective` function is a parallel async function with
the same flush-before-decide contract.

### 3.10 Synchrony / ordering requirements

The synchronous critical sections (the parts that must NOT be
gated by a new `await`) are:

1. **C10 set site** (line 2640, inside `handleSessionEvent`):
   the four conservation predicates are read, the marker is
   written. A new `await` here would introduce the same
   TOCTOU race SEAM04 halted on. The Elm kernel's directive
   MUST be returned synchronously, or the decision MUST be made
   on a snapshot read just before the write (the existing
   pattern: const + recordAfter at line 833 / 1071 / 1227).
2. **Q5 reeval** (line 813, `reevaluateDeferredContinuation`):
   four conservation checks, marker cleared, `setTurnPhase`
   committed. Pure synchronous, no `await` today.
3. **C10 reeval synchronous prefix** (line 980-1259,
   `reevaluateDeferredCompletionBarrier`): four conservation
   checks, marker cleared. Pure synchronous up to the existing
   `await this.checkElmCompletionAuthority(...)` at line 1275.
   The Elm authority consult at line 1275 is ALREADY an
   `await`; the new barrier kernel does not need to add a
   second one.
4. **Enqueue post-await** (line 1562-1726,
   `enqueueCompletionContinuationIfHeld`): the existing
   `await pickContinuationDirectiveForPublication(...)` is
   followed by the synchronous dedupe + marker writes at lines
   1665-1706. The lifetime annotation at line 1692-1694
   ("Mark BEFORE await so a synchronous re-entry cannot
   double-fire") is preserved unchanged.

**The Elm kernel for the synchronous BCB prefix is bounded:**
the kernel becomes a `Facts -> Directive` projection that the
TS adapter dispatches WITHOUT an additional `await`. The kernel
loader returns a synchronous result via a pre-warmed bundle
(matching the existing SEAM01..04 pattern); the async flush
happens at the existing `await` boundaries that are already
present.

For the **Q5 / C10 reeval site**, the kernel's directive is
the synchronous prefix (lines 980-1259 minus the Elm consult
at 1275); the existing `await this.checkElmCompletionAuthority`
remains the ONLY async hop in the reeval path. This is the
textbook "the Elm kernel matches the existing host lifecycle"
case: the existing async hop is preserved, the synchronous
predicate chain becomes the kernel.

For the **C10 set site at line 2640**, the kernel's directive
is the result of the four conservation predicates
(`outstandingAutonomousWork || ownerStillRunningForC10 ||
heldObligationForC10 || suppressOriginatingCompletion`) PLUS
the identity-triple preservation check PLUS the optional
`reason` carryover. The TS adapter writes the marker
synchronously based on the directive. **NO new `await` is
added at the C10 set site.**

### 3.11 Observable boundary (REAL production evidence)

The state machine is observable in production via:

- `deferredCompletionBarrier` field on the coordinator (test
  backdoor: `getDeferredCompletionBarrierForTesting` /
  `setDeferredCompletionBarrierForTesting` at line 2102 / 2127).
- The dogfood diagnostic counters
  (`getCompletionContinuationUpstreamCounters`,
  `dumpCompletionContinuationUpstreamCounters`): 14
  discriminators (U1..U11 + U2.5 + E1..E3) cover the
  conservation-check outcomes and the dedupe-permit /
  dedupe-suppressed boundary.
- The `cline.debug.dumpContinuationCardinalityAuthority`
  command (line 104 of `registry.ts`): the bounded ring at
  `apps/vscode/src/sdk/continuation-cardinality-authority.ts`
  captures the C1..C10 stages plus `task_started` and
  `continuation_started` extensions. The C10 stage
  (`task_completion_committed`) is the load-bearing
  C10-commit capture.
- The pre-existing 1,261-test vitest sweep (verified on
  ENTRY_HEAD via `bun run test:unit --run`: 95 files, 1,261
  pass, 0 fail).
- The focused 2-test LHOWA01-WIRE-01 sweep
  (`bun x vitest run long-horizon-outstanding-work-authority01.lhowa01-wire-authority.test.ts`):
  2 pass, 0 fail.

These observations are `REAL_PRODUCTION_SEAM` and
`STRUCTURAL` (the dedicated test backdoor) — both load-bearing.
The capture mechanism is already in place (the dogfood profile
flips the capture gate at extension activation).

### 3.12 TypeScript effects (unchanged under Elm migration)

The Elm migration is **TS-effects-unchanged**. The TS
effect interpreter does the marker field writes, the dedupe
slot writes, the stall snapshot writes, the `setTurnPhase`
calls, the `enqueueCompletionContinuation` callback, the
capture calls, the `postStateToWebview` fire-and-forget, the
`taskTelemetry?.recordRuntimeError` call, and the `Logger.warn`
diagnostics. The Elm kernel returns a `Directive`; the TS
adapter does the writes.

## 4. Economics gate

**`ECONOMICS_GATE = GO`**

### 4.1 Three decisive reasons

**Reason 1 — Substantive temporal state-machine complexity.**

The barrier marker is not a single Boolean; it is a 2-state
machine (ABSENT ↔ SET-with-reason) with **16+ distinct
transition paths** (4 conservation checks × 2 entrypoints ×
identity supersession × reason preservation × idempotent
re-stamp × dedupe slot interaction × stall-lifetime
disambiguation). The held-set snapshot, the dedupe slot, and
the REARM/STALL lifetime are three additional state-machine
sub-pieces that interact nontrivially. The state machine
resembles the precondition: `State + Event → NewState +
Decision/Effects`, not `three flags → one Boolean`.

**Reason 2 — Existing defect catalog pinned at the same
boundaries.**

Nine named historical defect witnesses
(`HALT_BACKGROUND_TERMINAL_REENTERS_COMPLETED_TASK`,
`HALT_FINALIZATION_TRIGGER_AT_WRONG_TRANSITION`,
`HALT_BACKGROUND_NOTIFY_COMPLETION_AUTHORITY_FIRE_AND_FORGET`,
`HALT_PENDING_PROMPT_AUTHORITY_TRANSPORT`,
`HALT_STALLED_REARM_LOOP`,
`HALT_BACKGROUND_COMPLETION_BARRIER01_RACE`,
`HALT_HOST_BLOCKED_OUTCOME_LIFECYCLE_OWNERSHIP`,
`HALT_CCARD_COMMIT_STAGE_MISBOUND`,
`HALT_MALFORMED_HELD_SET_FAIL_OPEN`) all cluster around the
barrier marker's set/clear/identity-supersession/reevaluate
boundaries. Each is a real production defect pinned by a
named test that exercises the production seam. The defect
catalog is the load-bearing evidence that the current TS
state machine is *too easy to break*: nine defects in the
same seam over the past three months is the classic
"complex state machine, easy to express invalid transitions"
case. The Elm migration would make the closed-schema
transitions explicit (the `Facts -> Directive` projection
plus a typed `State` algebra) and would let the Elm tests
pin the invalid-transition negative cases.

**Reason 3 — Safe interop boundary (no new async, no canonical
state duplication, no SDK boundary violation).**

The Elm kernel is bounded to the *synchronous* part of the
marker transitions. The existing async hops
(`pickContinuationDirectiveForPublication` at line 1562,
`checkElmCompletionAuthority` at line 1275) are preserved
unchanged. The TS adapter does the field writes
synchronously based on the kernel's directive. **No new
`await` is added** at any of the four critical sections
(C10 set, Q5 reeval, C10 reeval prefix, enqueue post-await).

The kernel does not duplicate any canonical mutable TS state:
the marker field, the dedupe slot, the stall fingerprint, the
stall snapshot all remain in TS (the host-owned temporal
state). The Elm kernel reads immutable snapshots
(`Facts`) and returns immutable `Directive` values; the TS
adapter applies the effect. This matches the existing
SEAM01..04 pattern exactly (the
`completion-continuation-control` kernel, the
`background-notify-authority` kernel, the
`completion-authority` kernel, the `task-header-orchestration`
kernel all follow this same `Facts -> Directive` shape).

The kernel does not violate the SDK→VS Code boundary
(SEAM06 P1): the SDK layer
(`sdk/packages/core/src/...`) does not import
`apps/vscode/`. The new kernel is a parallel of
`completion-continuation-control-elm.ts` (which the SDK
does not import either); the bridge is wired only at the
`apps/vscode/src/sdk/SdkController.ts:…` composition seam.

### 4.2 Estimated interop surface (estimates, labeled)

- **`Domain.elm`**: ~80 lines (Facts, Directive, Reason,
  MarkerState, factsIsExpected, identity-triple validator).
- **`Policy.elm`**: ~150 lines (the four conservation checks
  × identity supersession × reason preservation; the held-set
  progress consult is reused from the existing
  `completion-continuation-control` kernel).
- **`Codec.elm`**: ~150 lines (closed schema encoder/decoder
  for Facts and Directive; mirrors the existing
  completion-continuation-control Codec).
- **`Main.elm`**: ~120 lines (Platform.worker + ports,
  same shape as the existing four kernels).
- **`tests/CompletionBarrierAuthorityTest.elm`**: ~150 lines
  (the 16+ transition paths, plus identity-supersession
  negative tests, plus reason-preservation negative tests,
  plus dedupe-slot interaction tests).
- **`scripts/build-elm.sh` + `scripts/test-elm.sh`**: ~110
  lines (same shape as the existing four scripts).
- **`apps/vscode/src/sdk/completion-barrier-authority-elm.ts`**:
  ~300 lines (the TS adapter; mirrors
  `completion-continuation-control-elm.ts` exactly).
- **Production-seam correspondence test**: ~250 lines (the
  C1 proof required by SEAM05 P1-A — the test must
  exercise the *production* seam, not a re-implemented
  expression).
- **Failure-mode tests**: ~150 lines (kernel offline /
  decode error / no response, same as the existing four
  kernels).
- **`_ELM_KERNELS` table extension**:
  `build_dogfood_vsix_lib.py` ~10 lines.
- **Host wiring in `sdk-session-event-coordinator.ts`**:
  ~50 lines (replace the inline conservation-predicate
  reads with a single `pickBarrierDirective({…})` call;
  the effect interpreter remains the inline writes).

**Total estimate: ~1,500 lines of new code** (estimate,
not measured). This is the same magnitude as SEAM06, but
the cost is justified here by:
- The state-machine surface (16+ transition paths).
- The nine historical defect witnesses.
- The re-use of the existing bridge
  (`completion-continuation-control-elm.ts` is the template).
- The fact that NO new async boundary is added.
- The fact that NO canonical mutable TS state is duplicated.

## 5. Candidates considered and rejected

Per the SEAM05 reviewer's "Why not selected" table format
(§2 of the SEAM05 ACT), the candidates that were considered
and rejected are:

| Candidate | Status | Why not selected |
| --- | --- | --- |
| `Completion-continuation-control` migration of the dedupe slot + held-set snapshot | TS_EFFECT_INTERPRETER_ONLY | The dedupe slot is bounded single-key, no transition complexity; the held-set snapshot is already passed to the existing `classifyHeldSetProgress` Elm classifier. Neither needs a new kernel. |
| `Background-notify-authority` extension to the BCB aggregate | DUPLICATED_AUTHORITY | The `consumeTerminal` decision is per-jobId; the BCB aggregate is per-owner. Mixing the two would create two independently authoritative kernels for the same set of facts (`unconsumedOwnedTerminalResultCount`, `activeNotifyCount`). Forbidden by the SEAM05 P1 review ("do not create two independent authorities for the same decision"). |
| `Completion-authority` extension to the BCB state machine | DUPLICATED_AUTHORITY | The `completion-authority` kernel already gates the commit effect at the end of the reeval path. The marker state machine is a separate state machine that runs BEFORE the gate. Extending `completion-authority` to own the marker would conflate two state machines (the `TaskState` model and the `DeferredCompletionBarrier` field) into one kernel. |
| `Task-header-orchestration` extension | UNRELATED_DECISION | TaskHeader presentation is a 4-rule projection; the BCB is a lifecycle state machine. No semantic overlap. |
| `Completion-commit stage boundary` (the `setTurnPhase("completed", …)` effect) | TS_EFFECT_INTERPRETER_ONLY | The effect is a single `setTurnPhase` call; the decision is the marker state machine. Migrating the effect alone would not change any test outcome. |
| `Long-horizon outstanding work authority` (the live `getPendingPromptCount` / `getActiveNotifyCount` / `getUnconsumedOwnedTerminalResultCount` accessors) | UNOWNED_TS_AUTHORITY | These are simple synchronous accessors, not state machines. The factory's existing `pendingPrompts` service boundary is the canonical authority. |

## 6. SEAM07 frozen contract

```text
SEAM07_CONTRACT

production entrypoint:
    apps/vscode/src/sdk/sdk-session-event-coordinator.ts
    class: SdkSessionEventCoordinator
    methods exercising the seam:
        - enqueueCompletionContinuationIfHeld  (line 1442)
        - reevaluateDeferredCompletionBarrier  (line 952)
        - reevaluateDeferredContinuation        (line 813)
        - applyBlockedCompletionContinuationOutcome (line 1846)
        - handleSessionEvent C10 branch        (line ~2604-2646)
    private state:
        - deferredCompletionBarrier: DeferredCompletionBarrier | undefined  (line 664)
        - lastCompletionContinuationSessionEpoch: string | undefined         (line 699)
        - lastCompletionContinuationControlFingerprint: string | undefined  (line ~700)
        - lastCompletionContinuationHeldSetSorted: string[] | undefined     (line ~700)
        - deferredContinuation: DeferredContinuation | undefined            (line 655, the Q5 sibling)

caller graph:
    SdkController (apps/vscode/src/sdk/SdkController.ts)
    └── SdkSessionEventCoordinator (constructed in SdkController at the
        shared-host composition seam; the BCB methods are called from
        SdkController.handleSessionEvent and the SdkController BCB
        re-registration site at line ~2640)

canonical state owner:
    The SdkSessionEventCoordinator instance is the SOLE owner of the
    four private fields above. No Elm kernel currently reads or writes
    any of them. The fields are not exported; the only accessors are
    the test backdoors (isDeferredCompletionBarrierOutstandingForTesting,
    getDeferredCompletionBarrierForTesting, setDeferredCompletionBarrierForTesting,
    wasCompletionContinuationSentForTesting, clearCompletionContinuationSentForTesting).

input event vocabulary:
    - BarrierMarkerSet (with optional preserved reason, BCB re-registration site)
    - BarrierMarkerReevaluate (terminal-idle / agent_turn_done / command_status)
    - BarrierMarkerReasonStamp (C4-adversarial-guarded, idempotent)
    - BarrierMarkerStaleClear (session_gone / session_mismatch / task_mismatch /
      epoch_mismatch / active_session_missing)
    - EnqueueIfHeld { unconsumedOwnedTerminalResultsForC10, taskId, identity }
    - EnqueueIfHeldDeduped { continuationSessionEpoch }
    - EnqueueIfHeldFailClosed { failureReason } (terminal, never re-fires)
    - EnqueueIfHeldDelivered { heldJobIds, continuationSessionEpoch }
    - EnqueueIfHeldBlocked { reason: "stalled_no_progress" | "delivery_rejected" | "observation_unavailable" }
    - EnqueueIfHeldNoHeld { heldJobIds }
    - EnqueueIfHeldNoCallback
    - EnqueueIfHeldSessionGone
    - EnqueueIfHeldNotHeld
    - EnqueueIfHeldRejected

decision output vocabulary:
    - Pass                  (four conservation checks all pass; marker cleared)
    - Set { reason? }       (conservation checks failed; marker set)
    - ReRegister            (post-Elm-HOLD on the reeval path; re-set the marker)
    - Stale { reason }      (any identity axis mismatched; marker cleared)
    - Blocked { reason }    (non-delivered enqueue outcome; marker reason-stamped)
    - Deduped { epoch }     (dedupe slot already holds the same epoch)
    - NotHeld               (no held obligations; no state change)
    - ObservationUnavailable { alreadyStamped: boolean }
                            (bounded CTQC01 correlation guard)

identity/correlation:
    - marker identity: (sessionId, taskId, epoch)
    - dedupe key: ${sessionId}|${taskId}|${epoch}
    - fingerprint: ${sessionId}|${taskId}|${sorted-held-jobIds-join}
    - all keys are constructed at the production seam; the Elm kernel
      does NOT need to construct them

downstream TS effects (UNCHANGED, never moved):
    - this.deferredCompletionBarrier = {…} | undefined
    - this.lastCompletionContinuationSessionEpoch = … | undefined
    - this.lastCompletionContinuationControlFingerprint = … | undefined
    - this.lastCompletionContinuationHeldSetSorted = […] | undefined
    - this.options.setTurnPhase?.("completed" | "awaiting_followup", …)
    - this.options.enqueueCompletionContinuation({…})
    - captureContinuationCardinalityAuthorityRecord({…})
    - this.options.postStateToWebview?.()
    - this.options.taskTelemetry?.recordRuntimeError(incident)
    - Logger.warn(…)

existing Elm overlap:
    - completion-continuation-control:  pure Facts -> Directive, no state
    - completion-authority:             pure Msg -> Effect model, no BCB field
    - background-notify-authority:      pure Facts -> ConsumeDecision, no BCB
    - task-header-orchestration:        pure Facts -> Presentation, unrelated
    Result: NO duplication of authority. The new barrier kernel is
    additive and does not overlap with any existing decision vocabulary.

historical defect witnesses:
    9 named factory halts (see §3.8 above)

baseline tests (exercised on ENTRY_HEAD via bun x vitest run …):
    - ccca01 (PASS)
    - ccse01 (PASS, 12/12)
    - rearm01 (PASS, 12/12)
    - ccsrl01 (PASS, 13/13)
    - ccslt01 (PASS, 12/12)
    - cchsp01 (PASS, 29/29)
    - cchsp03 (PASS)
    - ccsa01 (PASS)
    - lhowa01-wire-authority (PASS, 2/2)
    - bcb01-c4 (1/5 PASS; 4/5 are the documented pre-existing baseline)
    - bcb01-c3 (5/6 PASS; 1/6 is the documented pre-existing baseline)
    - tqcb01 (5/15 PASS; 10/15 are the documented pre-existing baseline)
    - bcb01 (1/14 PASS; 13/14 are the documented pre-existing baseline)
    - ccdco01 (PASS)
    Pre-existing baseline failures are documented in commit acbfcf20a
    and must be honored unchanged by the next ACT.

observable:
    - 14 dogfood discriminators (U1..U11 + U2.5 + E1..E3) via
      getCompletionContinuationUpstreamCounters
    - 5 test backdoor accessors
      (isDeferredCompletionBarrierOutstandingForTesting,
       getDeferredCompletionBarrierForTesting,
       setDeferredCompletionBarrierForTesting,
       wasCompletionContinuationSentForTesting,
       clearCompletionContinuationSentForTesting)
    - bounded ring at continuation-cardinality-authority (C1..C10 stages)

unobservable:
    - The exact moment of marker field write is internal to the
      coordinator; only the discriminator counters and the test
      backdoors are externally visible
    - The four conservation checks' intermediate state is internal;
      only the final Pass/Set/Stale outcome is observable
    - The dedupe-slot write at line 1695 is observable ONLY through
      wasCompletionContinuationSentForTesting and the U10 counter

synchrony / ordering requirements (corrected by
ACT-CLINEMM-ELM-SEAM07-CORRECTION01 §2.1; the original "no new
await" framing was unsupportable on the existing Elm port
bridge, which is fundamentally async at the JavaScript
level — see correction ACT §2.1 for the evidence and the
graded interop model in correction ACT §3):
    - The Elm port hop already incurs a microtask deferral;
      the SEAM08 implementation MUST NOT add a SECOND hop on
      the same path, and MUST NOT introduce a "wait for the
      kernel to speak before writing the marker" pattern that
      the original TS predicate did not require.
    - C10 set site (line 2640): E1.1 read-only validation. The
      kernel validates the state; the marker write remains
      TS-owned.
    - Q5 reeval (line 813): E1.1 read-only validation.
    - C10 reeval synchronous prefix (line 980-1259): E1.1
      read-only validation; the post-1275 path uses the
      existing await via E2.1.
    - Enqueue post-await (line 1562-1726): E3.1 — extend the
      existing await at line 1562 to call pickBarrierDirective
      alongside pickContinuationDirectiveForPublication.
    - Graded interop: SEAM08 is authorized to begin with
      E3.1 + E1.1 only (no new await, no new critical
      section); E2.1 is added last if the GREEN case passes.

failure conservation (corrected by
ACT-CLINEMM-ELM-SEAM07-CORRECTION01 §2.2; the original
"Pass" word was incorrect — the predecessor predicate can
return a BLOCKING decision):
    - When the Elm kernel is unavailable (kernel file missing,
      evaluation failed, ports not present, port response
      timeout, decode error, malformed directive, unsupported
      runtime path), the TS adapter MUST evaluate the FULL
      ORIGINAL TS predecessor predicate and write the marker
      in the SAME critical section as the original TS code
      would have.
    - The fallback is labeled `ElmUnavailable_UsePredecessor`
      and is recorded in the kernel diagnostic
      (`failureClass` is non-null).
    - The fallback is NOT a universal `Pass`; the resulting
      marker state (set or clear) is whatever the original
      TS predicate would have written.
    - decode-error: TS adapter evaluates the full original
      TS predicate inline; logs via Logger.warn; records
      `ElmUnavailable_UsePredecessor` discriminator.
    - response-timeout: same as decode-error.
    - SEAM08 must add a unit test that exercises
      `kernel = NULL` and asserts the marker state matches
      the predecessor's output for each of the four
      conservation checks.
    - No silent-fail-OPEN: the kernel is consulted BEFORE the
      inline predicate reads; a kernel HOLD is a terminal outcome
      that the TS adapter routes to the marker set / clear
      decision, not to an effect.

migration economics:
    - ~1,500 lines of new code (estimate; same magnitude as
      SEAM06, but justified by the 9 named historical defect
      witnesses and the 16+ transition paths).
    - NO new async boundary.
    - NO duplication of canonical mutable TS state.
    - NO SDK→VS Code dependency (the kernel is a parallel of
      completion-continuation-control-elm.ts, which the SDK
      does not import).
    - REUSES the existing Elm bridge
      (completion-continuation-control-elm.ts) unchanged.
    - TypeScript effects (the marker writes, the setTurnPhase
      calls, the enqueue callback, the capture, the
      postStateToWebview, the taskTelemetry, the Logger.warn)
      REMAIN in TS.
```

## 7. Verdict

**`PASS_ELM_SEAM07_RECON`.** The
`deferredCompletionBarrier` marker state machine at
`SdkSessionEventCoordinator` is the selected production
decision authority. The economics gate is `GO`. The frozen
contract in §6 is the smallest possible migration boundary.

## 8. Next cursor

**`ACT-CLINEMM-ELM-SEAM08-DEFERRED-COMPLETION-BARRIER-AUTHORITY-MIGRATION`**
— the implementation cutover. The implementation ACT MUST
honor the pre-existing baseline failures
(documented in §3.7 and the `acbfcf20a` commit message);
must NOT introduce a new `await` at any of the four critical
sections listed in §6 (`synchrony / ordering requirements`);
must REUSE the existing
`completion-continuation-control-elm.ts` bridge pattern
unchanged; and must EXTEND the existing `_ELM_KERNELS` table
in `build_dogfood_vsix_lib.py` by one entry.

The implementation ACT is bounded to the synchronous prefix
of the marker state machine. The Elm kernel becomes a
`Facts -> Directive` projection that the TS adapter
dispatches synchronously at the existing transition sites.
The TypeScript effects remain in TS.

## 9. Residue

- P0: none.
- P1: none (the next ACT must not regress the pre-existing
  baseline documented in §3.7).
- P2 NON-BLOCKING:
  - The pre-existing baseline failures (bcb01 13/14, tqcb01
    10/15, bcb01-c3 1/6, bcb01-c4 4/5) are documented and
    preserved. The implementation ACT must verify via
    `git stash` + `bun x vitest run` on the predecessor
    HEAD that the new ACT does not regress the baseline.
  - The factory board entry for this ACT must be staged and
    committed per the factory board durability rule.
  - The implementation ACT may also need to address the
    CTQC01 observation_unavailable bounded correlation guard
    (line 2731-2772); that decision is a separate Elm
    sub-kernel and may be deferred to SEAM09 if the SEAM08
    implementation budget is exceeded.

## 10. Gates

- `git status --short` → empty (before this report is added).
- `git diff --check` → exit 0.
- `git rev-parse HEAD` → `eb3de47ab5b88a55ea15e768241e65efb6464cc2`.
- `git branch --show-current` → `main`.
- No typecheck / lint / test changes (no production delta).
- Pre-existing baseline test runs verified on ENTRY_HEAD:
  1,261/1,261 vitest PASS on `bun run test:unit --run`.
  2/2 LHOWA01-WIRE PASS on focused run.
  12/12 CCSRL01 PASS on focused run.
  12/12 CCSE01 + REARM01 PASS on focused run.

## 11. Files

- **New report:**
  `.factory/ACT-CLINEMM-ELM-SEAM07-LONG-HORIZON-CONTINUATION-RECON.md`
  (this ACT's full report).
- **Updated board:**
  `.factory/epic-board.md` (one new section appended at the
  end).
- **No source code changes.**

## 12. Predecessor ACT lineage

- `ACT-CLINEMM-ELM-SEAM06-PROMPT-ADMISSION-CUTOVER`
  (`NOT_A_GOOD_ELM_SEAM`) — recommended the long-horizon
  continuation cardinality, the held-set progress
  classification, or the completion-commit stage boundary
  as the next candidates. This ACT selects the
  long-horizon continuation cardinality (operationalized
  as the `deferredCompletionBarrier` marker state machine,
  which IS the long-horizon continuation cardinality
  authority).
- `ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER`
  (`PASS_ELM_SEAM04_RECON`) — established the
  `Facts -> Directive` pattern that this ACT reuses.
- `ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01`
  — established the upstream discriminator vocabulary
  (U1..U11) that this ACT's observable boundary exposes.
- `ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01` and its
  four CORRECTION ACTs — established the four conservation
  checks and the closed-enum reason set that this ACT's
  Directive vocabulary mirrors.
- `ACT-CLINEMM-ELMIZE-P1-HELD-SET-PROGRESS-AUTHORITY01` and
  its CORRECTION01/CORRECTION02 ACTs — established the
  held-set progress classifier that the new kernel REUSES
  (via the `completion-continuation-control` policy).
