# ACT-CLINEMM-ELMIZE-P1-COMPLETION-BARRIER-CONSERVATION01 — PASS_NO_ELM_MIGRATION_NEEDED — 2026-10-08

**Status:** CLOSED at the C1 recon gate. **No production code change warranted.** The existing
Elm Completion Authority kernel already owns the full semantic "may completion commit?"
decision. The TS sites the ACT brief flagged for migration are indispensable host-side
conservation guards (fact collection, validation, and registration of the deferred-completion
marker) — not parallel decision authority. Creating a fourth kernel would re-introduce the
exact `HALT_DUAL_COMPLETION_AUTHORITY` defect the ACT brief explicitly forbids.

Per ACT §C1 / Success criteria: "If recon finds that the existing Elm Completion Authority
already owns the full semantic decision and TS contains only indispensable host-side
conservation guards, close as: `PASS_NO_ELM_MIGRATION_NEEDED`. Don't migrate code for the
sake of increasing the Elm percentage."

## Recon (C1)

### Q1 — Is Elm completion authority already deciding whether completion is eligible, with TS independently rechecking conservation?

**Yes, Elm is the FINAL gate on the commit effect.** `SdkSessionEventCoordinator` has exactly
two `setTurnPhase("completed", …)` call-sites in the entire `apps/vscode/src/sdk/` tree:

```
apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1175  this.options.setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")
apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2166  this.options.setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")
```

Each is gated by `checkElmCompletionAuthority(writerId)` at L1156 / L2142, which flushes the
per-session Elm authority queue and consults the compiled
`apps/vscode/elm/completion-authority/` kernel via
`getElmAuthorityCompletionDecision(sessionId)`. The legacy silent default-Authorize fallback
was REMOVED in `ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY`
(`apps/vscode/src/sdk/completion-authority-elm-authority-runtime.ts` line 43-49 + 503-538):
when the runtime is not armed, the helper returns a `failure` decision and the coordinator
suppresses the commit effect. **No silent TS fallback exists.**

### Q2 — Are there two equivalent TS barrier predicates, or do they operate at different lifecycle boundaries?

**Two TS predicates at distinct boundaries, both in front of the Elm consult, neither
competing with it:**

1. `reevaluateDeferredCompletionBarrier` at L1037 (`heldObligation`):
   decision = *"should we fire a bounded continuation prompt to the agent this turn?"*
   The `heldObligation = count > 0 || jobIds.length > 0` disjunct (count/list repair at
   `4f5a03c20` / BCB01 §0.1) gates *enqueueing the continuation*. It is upstream of the
   Elm consult — if it returns true, the path schedules a continuation; if it returns false,
   the path proceeds to the conservation checks and (potentially) the Elm consult at L1156.

2. C10 barrier in `handleSessionEvent` at L1995-2041 (`heldObligationForC10` + 3
   siblings): decision = *"should we register a `deferredCompletionBarrier` marker and
   suppress the originating commit?"* The four-part predicate
   `outstandingAutonomousWork || ownerStillRunningForC10 || heldObligationForC10 ||
   suppressOriginatingCompletion` is the BCB01 conservation chain (a host-side safety net
   that prevents completion registration while held facts are unresolved). It is also
   upstream of the Elm consult at L2142: if any of the four hold, the path registers the
   marker and returns; only the negative branch reaches `checkElmCompletionAuthority`.

Both predicates collect facts from the host and decide *whether to invoke the authority
path*. Neither decides "is completion semantically permitted." That decision is exclusively
Elm's.

### Q3 — Which decisions are pure snapshot policy, and which require host-owned temporal memory?

The host-owned temporal memory lives in:
- `BackgroundNotifyCoordinator.unconsumedOwnedTerminalResultCount` /
  `unconsumedOwnedTerminalJobIdsForOwner` (live result-store, host-managed)
- `CommandJobManager.hasRunningBackgroundJobForOwner` (live command-job store)
- `PendingPromptsController` (live prompt queue)
- `BackgroundOwnerCorrelation` (perJobSuppressOriginatingCompletion, causal state across
  wake-driven turns)
- The `messageTranslatorState.getMinter().epoch` (BCB01 epoch, host-managed identity)
- `deferredCompletionBarrier` marker (host-owned, single outstanding per
  `(sessionId, taskId, epoch)` triple)

The Elm Completion Authority kernel consumes **all** of these as immutable `Msg` events
(`TerminalRegistered`, `TerminalObserved`, `RunStarted`, `AgentTurnDone`,
`PendingPromptEnqueued`, `ContinuationScheduled`, `ContinuationStarted`, `SubmitAndExitSeen`,
`TaskCompletionCommitted`, `TaskCancelled`) and projects them onto its pure state machine
via `computeHoldReasons model` returning `List HoldReason`. The `HoldReason` vocabulary
already covers every fact the ACT brief's proposed `CompletionBarrierFacts` would carry:

| ACT-brief fact                            | Elm hold reason                  |
| ----------------------------------------- | -------------------------------- |
| `terminalCountPositive` / `heldJobIdsPresent` | `UnconsumedTerminalObservation` |
| `ownerStillRunning`                       | `RunningBackgroundJob`           |
| `pendingPromptPresent`                    | `PendingPrompt`                  |
| `activeNotifyPresent`                     | `PendingPrompt` (notify prompts enter the same queue) |
| `outstandingAutonomousWork`               | `PendingPrompt` + `ScheduledContinuation` |
| `completionAttemptObserved` (precondition for consulting) | `submitCount` in model |
| `terminalResponseCommitted`               | rejected with `TaskCompletionCommittedWhileHeld` violation |

`computeHoldReasons` source: `apps/vscode/elm/completion-authority/src/Authority.elm`
handleMsg + computeHoldReasons, confirmed against the live source. The mapping is
exhaustive — there is no fact in the proposed record that Elm does not already model.

### Q4 — Does the count/list disagreement represent a semantic condition or an invalid input that needs explicit classification?

**It is exactly a semantic condition, and Elm already classifies it.** The BCB01 §0.1
invariant `heldObligation = (count > 0) OR (jobIds.length > 0)` translates to Elm as: any
job in `TerminalPending` lifecycle with kind `TerminalOwned` is an unconsumed observation;
`Domain.unconsumedOwnedTerminalCount` counts the live Elm model after the TS host projects
`TerminalRegistered` and `TerminalObserved` events into the kernel. The count/list
divergence in the LIVE specimen (count=0 / list=7) is impossible *inside* Elm's model
(because Elm owns its own job state and never reads TS counters), so the repair lives
correctly in TS as a fact-collector invariant; Elm's response to the same scenario is
already covered by `HoldCompletion UnconsumedTerminalObservation`.

The CCUTO-13/14 tests at
`apps/vscode/src/sdk/__tests__/completion-continuation-unresolvable-terminal-outcome01.ccuto01.test.ts`
lines 999-1080 already drive the **real** production Elm kernel
(`pickContinuationDirectiveForPublication` → `invokeElmKernel`) on the LIVE specimen's
exact fact set, and the kernel returns `fail_closed(observation_unavailable)` for
unobserved held jobs and `ObserveThenRetry` for observed held jobs. Direct evidence that
the existing authority classifies the count/list case correctly.

### Q5 — Should we extend an existing kernel or create a fourth?

Per the ACT brief: "I would aim for three kernels, not four." The third kernel
(completion-authority) is the correct one. **The migration is already done.** The
count/list repair (`4f5a03c20`) was the necessary host-side fact-collector invariant
to make sure TS projects every held job into the Elm model so the kernel can compute
its `HoldCompletion` decision. The kernel itself is unchanged and correct.

## C0 / C7 / C8 / Success-criteria Verdict

```
SOURCE_HEAD             84a4f18a577677b19dd2130408bc73ccfdeb0a37 (count/list repair + CCUTO01 P1 amendment)
PRODUCTION_CALLER       apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1156 (reevaluate) + :2142 (C10)
ELM_AUTHORITY           apps/vscode/elm/completion-authority/ (existing kernel owns the decision)
RED/GREEN               NOT_EXECUTED (HALT_NO_RED_REQUIRED — no migration, no new code)
NECESSITY               NOT_REQUIRED (existing Elm kernel already owns the decision; TS contains only indispensable host-side conservation guards)
CONSERVATION            1261 / 0 fail unit tests on HEAD; CCUTO-04/11/13/14 green; count/list disjunct enforced at L1037/2032
NO_DUAL_AUTHORITY       VERIFIED — only two setTurnPhase("completed") sites in src/sdk/; both gated by checkElmCompletionAuthority
VSIX                    NOT_EXECUTED
LIVE                    NOT_EXECUTED
```

**Verdict: PASS_NO_ELM_MIGRATION_NEEDED** (per ACT §Success criteria).

## Why this is the right answer

The ACT brief itself names this exit condition: "Don't migrate code for the sake of
increasing the Elm percentage." The Elm share of the completion decision is already
100% of the semantic decision (commit effect); the TS side is pure host-orchestration
(collection of facts from live stores, validation of count/list coherence, registration
of a marker for the deferred-reevaluation path, and execution of the commit effect after
Elm authorises). Creating a fourth kernel here would re-introduce the dual-authority
hazard and add no semantic value — the conservation facts Elm would consult are the
same facts it already receives as `Msg` events.

The recon also surfaced a more valuable direction than the one proposed: the
host-owned **blocked-outcome classification** (a host-side projection that surfaces
`blocked` / `stalled_no_progress` / `requires_operator` for the operator, currently
named explicitly as a P0 limitation in the CCUTO01 P1 amendment). That decision is not
owned by Completion Authority (which decides *whether* commit is allowed) or
Continuation Control (which decides *what* the next-turn prompt says). It sits between
them in the operator-facing surface and is a candidate for the next Elm migration after
a separate recon confirms it is not already covered by either existing kernel. This
matches the brief's own forward-look: "After this seam, I'd consider Elmizing the pure
blocked-outcome classification, provided a subsequent recon establishes that it is not
already covered by Completion Authority or Continuation Control."

## Conservation gates (1261 unit tests, 95 files, 0 fail on HEAD)

- All Completion Authority Elm tests green
- CCUTO-04 / CCUTO-11 / CCUTO-13 / CCUTO-14 green (count/list divergence, real-Elm-kernel projection)
- BCB01 c1 / c2 / c3 / c4 green
- TQCB01 (long-horizon quiescence) green
- MCP-RESTART-01 (deferred barrier across MCP restart) green
- SHOWTASK-01 (deferred barrier across showTaskWithId) green
- `bun run test:unit` PASS (95 files / 1261 tests / 0 fail)
- `git status --short` clean (no unprotected tracked dirt)
- Protected stash `stash@{0}` on `d46223b51` preserved
- Count/list repair `4f5a03c20` + P1 amendment `84a4f18a5` preserved
- No new Elm source / bundle / wire contract / authority introduced
- `git diff -- apps/vscode/elm/` EMPTY

## Production code touched: NONE

The single durable change is this closure artifact
(`.factory/acts/ACT-CLINEMM-ELMIZE-P1-COMPLETION-BARRIER-CONSERVATION01.md`) plus the
durable board entry. The ACT brief's own precondition was: "C1 GO for
`COMPLETION-BARRIER-CONSERVATION01`, with mandatory source recon before any new Elm
code." The recon has run; the answer is no migration is needed. The brief's success
criteria for this exact outcome is `PASS_NO_ELM_MIGRATION_NEEDED`.

## Predecessor LIVE (preserved as evidence)

```
HEAD                                    84a4f18a577677b19dd2130408bc73ccfdeb0a37
Predecessor ACT                         CCUTO01-CORRECTION01 (count/list repair)
Predecessor verdict                     PASS_PRELIVE on count/list repair; CCUTO-13/14 pin real-Elm-kernel projection
Count/list disjunct                     apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1037-1038 (reevaluate) + 2032-2034 (C10 barrier)
Elm consult sites                       :1156 (reevaluate path) + :2142 (C10 path) — both via checkElmCompletionAuthority
Elm decision surface                    { kind: "authorize" } | { kind: "hold", reason, holdReasons } | { kind: "failure", classification, reason }
Legacy silent default-Authorize         REMOVED (ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY)
```

## Next ACT (forward-look, not chartered here)

`ACT-CLINEMM-ELMIZE-P1-BLOCKED-OUTCOME-CLASSIFICATION01` (provisional name) — recon-first;
verify the blocked-outcome projection is not already owned by Completion Authority or
Continuation Control before any code change.


