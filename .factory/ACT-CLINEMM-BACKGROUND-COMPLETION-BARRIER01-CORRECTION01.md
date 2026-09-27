# ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01

## Mission
Single purpose: "Bind deferred completion to terminal-result consumption, not merely terminal-job cardinality."

## Frozen invariant (BCB01 §0.1, unchanged)
```
task_completion_committed
  ⇒ owned_background_jobs_nonterminal == 0
  AND unconsumed_owned_terminal_results == 0
```

## Concretely required production change

In addition to the existing `hasRunningBackgroundJobForOwner` check (BCB01 §conclusion-A, KEEP), add a SECOND conjunct to both the re-evaluation seam AND the C10 commit seam:

```text
unconsumedTerminalResultCount(activeSession.sessionId) == 0
```

`unconsumedTerminalResultCount` MUST be backed by an authoritative counter covering BOTH:
1. notify=true jobs that have a wake in flight or in `heldTerminalResults` queue (already in `BackgroundNotifyCoordinator`, but no aggregate accessor exposed)
2. notify=false jobs that have reached terminal state (currently no terminal identity exists for these)

For (2), the production path must surface a terminal identity for EVERY task-owned job at the moment of completion — the architecture's "BACKGROUND != DETACHED" principle means even fire-and-forget jobs have an authority-consumer relationship with the agent that ran them.

## Required production seams

### Seam 1: New optional counter
```text
getUnconsumedOwnedTerminalResultCount?: (sessionId: string) => number
```
- Added to SdkSessionEventCoordinatorOptions
- Wired in SdkController
- Returns 0 for non-task-owned jobs
- Counts terminal jobs whose result has not been delivered into the agent's conversation (PendingPromptsController has the wake OR BackgroundNotifyCoordinator.heldTerminalResults is non-empty)

### Seam 2: C10 predicate extension
At sdk-session-event-coordinator.ts:~521-535 (re-evaluation) AND ~968-989 (C10 commit):
- Add `unconsumedOwnedTerminalResults > 0` check to the predicate
- Same fail-closed semantics (unknown = held)

### Seam 3: BackgroundNotifyCoordinator authority surface
- Add a public `unconsumedTerminalCountForOwner(sessionId, taskId)` that returns `notificationMarkers.size + heldTerminalResults.get(ownerK)?.length + wakeEnqueuedJobIds.size - wakeAuthoritySettledJobIds.size` for that owner (with full accounting for cancel/duplicates).
- Wire `SdkController.getUnconsumedOwnedTerminalResultCount` to it.
- For notify=false jobs, the production path `vscode-run-commands-tool.ts:890-892` (terminalPromise.then) MUST extend to register a "non-notify terminal identity" — either by adding a new method `BackgroundNotifyCoordinator.registerNonNotifyTerminalIdentity({jobId, sessionId, taskId})` that lives in a parallel counter, OR by adding the job to the wakeEnqueuedJobIds set so the wake authority tracker sees it.

## Required RED → GREEN test set

| ID | Scenario | Asserts |
|----|----------|---------|
| BCB-13 | 4 notify=true terminals, 0 consumed, submit_and_exit | HELD (unconsumed > 0) |
| BCB-14 | 4 notify=true terminals, all 4 consumed, submit_and_exit | 1 commit |
| BCB-15 | 4 notify=false terminals, 0 consumed, submit_and_exit | HELD (unconsumed > 0) — proves production path surfaces terminal identity for notify=false |
| BCB-16 | Mixed: 2 notify=true + 2 notify=false, all 6 terminal, 0 consumed | HELD |
| BCB-17 | Cancelled jobs | NOT counted as unconsumed (no information content) |
| BCB-18 | Failed jobs (non-zero exit) | terminal IS counted (failed result is information) |
| BCB-19 | MAX_OUTSTANDING_TERMINAL_CONTINUATIONS = 1 (real PendingPromptsController drain) | Even with 4 unconsumed terminals, only 1 outstanding conversational authority |
| BCB-20 | Real PendingPromptsController (via getPendingPromptCount driven by wakeSink.queued) | pendingPromptCount == wakeSink.queued.length, not 0 |

## Test harness corrections

The existing BCB01 test harness has `getPendingPromptCount: () => ({count: 0})`. CORRECTION01 fixes this to `() => ({count: wakeSink.queued.length})`.

A new harness variant (or extension) drives the REAL `BackgroundNotifyCoordinator` authority surface (via `SdkController`-style wiring) so `unconsumedTerminalCountForOwner` is tested end-to-end.

## Conservation matrix (must remain GREEN after change)
- BCB-01 through BCB-12 (14): BCB-01..12 stay GREEN; BCB-02..04 must still pass with the ADDED unconsumed check (drain releases them only after consumption)
- TQCB01 (15), BCNEX01 (7), BCCOC01 (7), BCTPA01 (6), BCTCONT01 (10), BCAFG01 (5), BCNT01 (24), BCP (5), BNCA-FRAMEWORK (3), BNCA-GREEN (3), BNCA-ABLATION (2), CCARD01 (12), SWCM04 (16), AGCONT01 (7) = 124 conservation tests

## Coalescing
- MAX_OUTSTANDING_TERMINAL_CONTINUATIONS = 1 is now asserted against REAL PendingPromptsController behaviour, not test-harness visibility. The deferredCompletionBarrier marker (BCB01 conclusion-C) preserves the ≤1 outstanding terminal-result continuation invariant.

## Scope
IN: C10 commit predicate, re-evaluation predicate, BackgroundNotifyCoordinator public API, SdkController wiring, test harness.
OUT: myc-prime-* source, myc/* modules, any session-bound MCP tree, continuation-cardinality capture (OFF remains OFF).

## LIVE qualification
Deferred to operator per ACT-MYC-CLINEMM03-LIVE-DIAG01 pause condition. LIVE-A..D not re-attempted in this ACT.
