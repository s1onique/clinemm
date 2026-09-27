# ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION02

**Status:** OPEN
**Predecessors:**
- ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01 (REOPENED — verifier halted)
- ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION01 (REOPENED — reviewer halted)

**Verifier halt (parent ACT):** `HALT_TERMINAL_RESULTS_NOT_CONSUMED`
**Reviewer halt (CORRECTION01):** `HALT_NON_NOTIFY_CONSUMER_NOT_WIRED`

## §0 Verdict target

```text
ACT                                 = PASS_NOTIFY_FALSE_CONSUMER
PRODUCER (terminal identity)        = PASS (unchanged from CORRECTION01)
BARRIER (both conjuncts)            = PASS (unchanged from CORRECTION01)
CONSUMER (real notify=false path)   = PASS — NEW BOUNDED REPAIR
```

## §0.1 Frozen invariants (unchanged)

```text
owned_background_jobs_nonterminal == 0
AND
unconsumed_owned_terminal_results == 0
```

## §1 Scope

ONE bounded change: **wire `command_status`'s existing Path B seam to also drain non-notify terminal observations when the snapshot is terminal.** The observation IS the consumption — when `command_status` returns the terminal result to the agent, that single in-band observation record acts as the "consumed" event for the BCB01 §0.1 second conjunct.

**Out of scope:**
- Multi-result coalescing beyond what BCB-19 already proves (≤1 outstanding commit when the barrier predicate releases).
- The full authority-boundary composition of queued wakes → ≤1 conversational authority → single submit_and_exit (deferred to ACT-MYC-CLINEMM04).
- Any change to notify=true behavior.

## §2 Why this fix is correct

For `notify=true`:
- Wake-driven turn delivers terminal fact in-band.
- Path A (terminal listener) drains the marker immediately.
- Path B (`command_status`) is the defense-in-depth drain — fires on observation.

For `notify=false`:
- Wake is deliberately suppressed (user opt-out).
- Path A STILL records the terminal observation (the CORRECTION01 producer-side repair).
- BUT nothing in production consumes it — this is the reviewer halt.

The agent's only way to learn the terminal fact is `command_status`. Therefore: **the act of `command_status` returning a terminal state IS the consumption event**. The Path B seam is the canonical place to drain both the notify marker (notify=true) and the non-notify observation (notify=false).

## §3 Required RED

```text
notify=false job started via real run_commands tool
→ submit_and_exit attempted → barrier holds (unconsumed == 1)

real command_status(jobId, waitMs) on the notify=false job
→ observation count 1→0 EXACTLY ONCE
→ barrier can release on next reevaluate
→ exactly 1 task_completion_committed

CURRENT (RED): observation count stays 1 after command_status → barrier remains blocked → task never completes
TARGET (GREEN): observation count drops to 0 after command_status → barrier releases → task completes
```

## §4 Finalization authority — confirmed present

The reviewer's secondary concern (`HALT_NON_NOTIFY_FINALIZATION_AUTHORITY_ABSENT`) was investigated and found **NOT APPLICABLE**:

- When `submit_and_exit` is held by the barrier, the tool returns "submitted" and `setTurnPhase("completed", ...)` is NOT called.
- `terminalResponseCommittedThisTurn` does NOT fire.
- The turn continues — the model is free to call `command_status` and other tools.
- The agent has the authority; it just needs the production consumer seam to actually wire observation to consumption.

Therefore the bounded fix is sufficient: wiring the consumer seam is enough. No additional finalization authority is needed.

## §5 Production change

Single seam modification:

**File:** `apps/vscode/src/sdk/command-status-tool.ts:240-261`
**Change:** Extend the existing Path B block to also call `backgroundNotifyCoordinator.consumeNonNotifyTerminalObservation({jobId: typed.jobId, sessionId: activeOwner.sessionId, taskId: activeOwner.taskId})` when the snapshot's state is terminal AND there is no active notify marker for the job (so we only drain non-notify observations). The call is idempotent (already true via `BackgroundNotifyCoordinator.consumeNonNotifyTerminalObservation`).

Owner identity check stays in place: only drain if `activeOwner` resolves AND matches the recorded owner triple. Stale cross-session polls cannot drain observations they don't own.

Idempotency is preserved: if the same `command_status` call is re-issued, the second drain is a no-op (the observation was already removed on the first call).

## §6 Conservation

Required:
- All 14 BCB01 (parent ACT, updated) tests still pass.
- All 8 BCB01-C (CORRECTION01) tests still pass (they use the manual harness consume, which is now redundant with the real production consumer, but still correct).
- New BCB01-C2 tests (BCB-21..BCB-24) cover the bounded production consumer seam.
- All 81 conservation tests (TQCB01, AGCONT01, BCNEX01, BCCOC01, BCTPA01, BTCONT01, BCAFG01, BCNT01) still pass.
- New: 1 real-path integration test (BCB-25) uses the real `run_commands` tool AND the real `command_status` tool to drive the full producer → barrier → consumer → commit cycle WITHOUT manually consuming in the harness.
- `bnca-*-red01` tests stay red (notify=false Path B suppression invariant preserved).
- `bnca-*-green01` tests stay green (Path B is still suppressed when notify-owned + waitMs > 0).
- `bunx tsc --noEmit` exit 0.
- `git diff --check` clean.

## §7 Files

Production:
- `apps/vscode/src/sdk/command-status-tool.ts` (+~10/-0) — extend Path B block with non-notify drain.
- `apps/vscode/src/sdk/background-notify-coordinator.ts` — NO CHANGE (consumeNonNotifyTerminalObservation already exists from CORRECTION01; just verify it's idempotent and applies to both re-registration cases).

Tests:
- `apps/vscode/src/sdk/__tests__/background-completion-barrier01-correction02.bcb01-c2.test.ts` (NEW, ~250 lines, 4 + 1 tests):
  - BCB-21: `command_status` Path B drains non-notify observation when notify-owned=false + state=terminal
  - BCB-22: `command_status` Path B does NOT drain when state=running
  - BCB-23: `command_status` Path B is idempotent — second call is no-op
  - BCB-24: `command_status` Path B owner-mismatch check — stale session cannot drain
  - BCB-25: REAL integration — real `run_commands` + real `command_status` → barrier releases → exactly 1 commit (the CORRECTION01 BCB-INT-01 contract but with REAL consumer, not harness manual consume)

Updates to existing test:
- `apps/vscode/src/sdk/__tests__/background-completion-barrier01.bcb01.test.ts` — update BCB-INT-01 comments to clarify that the manual `h.consumeNonNotifyTerminalObservation` call is now redundant with the real `command_status` Path B seam (it stays for backwards-compatibility with the harness's tracking model, but in real production the tool drains directly).

## §8 Verifier report (anticipated)

```text
NO_PREMATURE_COMPLETION_WHILE_RUNNING = PASS
TERMINAL_IDENTITY_RECORDING          = PASS
CONSUMPTION_BARRIER                  = PASS
REAL_NOTIFY_FALSE_CONSUMER           = PASS  ← NEW

VERDICT=PASS_NOTIFY_FALSE_CONSUMER
```

## §9 Successor

ACT-MYC-CLINEMM04 (myc live qualification resumption).
