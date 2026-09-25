# ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01

## Mission

**Primary epistemic purpose: causality / presentation cardinality.**

Explain and repair the remaining duplicate user-visible completion for one
background command.

The prior line is CLOSED for its purposes:

```text
OOM_REPAIR             LIVE_QUALIFIED
C4_TO_C8_CORRELATION   LIVE_QUALIFIED
WAKE_PRODUCTION_CARDINALITY  1 terminal → 1 wake → 1 queued continuation (healthy)
```

The remaining observed defect:

```text
one user request
  → one background command
  → one terminal completion
  → one wake
  → TWO user-visible completion presentations
```

This ACT does **not** reopen delivery-semantics OOM repair, jobId
correlation repair, deriveOrigin precedence, or wake duplication as the
leading hypothesis. It does **not** fix the defect by hiding duplicate UI
cards.

The problem is **semantic presentation authority**.

---

## 1. Required invariant

For one background-command jobId J:

```text
terminal_commit_count(J)       == 1
wake_created_count(J)          <= 1
queued_continuation_count(J)   <= 1
USER_VISIBLE_TERMINAL_PRESENTATION_COUNT(J) == 1
```

Execution cardinality may legitimately be `explicit_user run +
pending_prompt_drain run` if the first turn remains alive for unrelated
reasons.

The invariant is NOT `run_turn_started == 1`. The invariant is: exactly
ONE lifecycle authority presents terminal completion to the user.

---

## 2. Core question

Determine which lifecycle boundary owns presentation of a completed
background command. The competing models were H1/H2/H3. Per ACT §3 the
choice is deferred until recon + RED evidence.

---

## 3. Repository trust

```text
HEAD    = 89e67318d (ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01 closure)
status  = clean (no tracked dirt)
```

Ancestry:

```text
89e67318d ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01: bounded presentation arbitration
24e7ef263 ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01: relabel closure as COMPOSED proof
4b76a5348 ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01: add real-host e2e sentinel witness
64f54a945 ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01: bounded jobId-thread repair
16881f671 ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01 / CORRECTION01: ACT file + evidence
0a97b445c ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01 / CORRECTION01: P1 deriveOrigin precedence
```

---

## 4. Recon before design

See `02-recon.md`. Lifecycle boundary table (seq 1-16) traces every
observable boundary from the user's request to the final
`task_completion_committed`. The boundary classification table
identifies C10 as the duplication seam: two turns each emit one
`say:"completion_result"` row via `appendAndEmit`.

---

## 5. Live specimen

See `01-live-specimen.md` + `01a-live-ccard.jsonl` + `01b-live-counters.json`.

Frozen CCARD cardinality (operator-observed):

```text
terminal_committed          = 1
notify_consume_enter        = 1
wake_created                = 1
pending_prompt_enqueued     = 1
pending_prompt_dequeued     = 1
continuation_scheduled      = 1
run_turn_started            = 2 (origins: explicit_user + pending_prompt_drain)
agent_turn_done             = 2 (origins: explicit_user + pending_prompt_drain)
task_completion_committed   = 1
```

---

## 6. Minimal reproduction

See `apps/vscode/src/sdk/__tests__/background-command-terminal-presentation-arbitration01.bctpa01.test.ts`.

Primary RED: `BCTPA-RED-01 / ABLATION`
Pre-repair: `presentation_count(J) == 2` (RED)
Post-repair: `presentation_count(J) == 1` (GREEN)

---

## 7. Presentation capture seam

No new diagnostic seam needed. The existing `appendAndEmit` call in
`handleSessionEvent` is the load-bearing observation point.

---

## 8. Causal discriminator

**Classification: E. PRESENTATION_COMMIT_DUPLICATED**

C1..C9 are exactly-once (terminal lifecycle, notify, wake, queue, drain,
runTurn, agent turn) per the prior ACT closures. The duplication is at
C10: two turns each emit one `say:"completion_result"` row. Semantic
execution is correct; the duplicate commit is at the `appendAndEmit`
presentation seam.

---

## 9. Necessity / ablation

The discriminator flips 2 → 1 on the bounded predicate
(`outstandingAutonomousWork` for the active session/task). See
`03-red-green.txt`.

---

## 10. Presentation authority

**TERMINAL_WAKE_TURN** — the wake_drain turn that fires after
`consumeTerminal` consumes the notify marker and the wake drains from
the pending-prompt queue. This turn has the actual command result;
the explicit_user turn's `attempt_completion` is an intermediate
state ("I've started the command") that should not produce a terminal
completion box.

Rationale:

1. Which path already has authoritative terminal state?
   - The wake_drain turn receives the formatted `TerminalNotification`
     from `BackgroundNotifyCoordinator.consumeTerminal` (carrying
     `terminalState`, `exitCode`, `reason`, `outputTail`).
   - The explicit_user turn has only the tool return value
     `{status:"running", jobId, ...}` from `vscode-run-commands-tool.ts:914`.
2. Which path already owns user-visible response completion?
   - The wake_drain turn's prompt IS the user-facing notification that
     the command completed; the agent's `attempt_completion` in this
     turn is the terminal response.
   - The explicit_user turn's `attempt_completion` is intermediate —
     it acknowledges "I've started the command" but cannot present the
     result because it hasn't been observed yet.
3. Which path can disappear/retry without losing notification?
   - If the wake_drain turn is lost, the deferred-completion-barrier
     (TQCB01) holds the phase transition;
     reevaluateDeferredCompletionBarrier fires the held completion when
     all obligations resolve. Notification is preserved.
   - If the explicit_user turn is interrupted, the wake_drain turn
     still runs and presents the result.
4. What happens if the terminal event occurs before / after / during
   / after abort / after session disappearance?
   - Before explicit_user turn finishes: marker exists → filter
     suppresses explicit_user's premature completion; wake_drain turn
     presents when it fires. (Frozen bug shape.)
   - After explicit_user turn finishes (no attempt_completion yet):
     marker exists → no completion was emitted; wake_drain turn
     presents when it fires. (BCTPA-P1 shape.)
   - While session is busy with another tool: marker exists → no
     premature completion; wake_drain turn presents.
   - After abort: dispose() clears markers; consumeTerminal returns
     `no_marker`; no presentation (notify=true was opted-in but the
     session is gone).
   - After session disappearance: new session has empty marker set;
     no presentation.
5. How is exactly-once presentation conserved under retries/re-entry?
   - The marker is consumed exactly once via destructive-read
     (`notificationMarkers.delete(jobId)` in
     `background-notify-coordinator.ts:315`).
   - The pending-prompt queue is FIFO with `drainingPendingPrompts`
     reentrance guard (`pending-prompt-service.ts:319, 342`).
   - The filter at line ~514 consults `outstandingAutonomousWork`
     which is bounded by the same marker/queue predicates.

---

## 11. Bounded repair

The minimal-diff repair extends the existing message filter at
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:467-535` to ALSO
suppress `say:"completion_result"` messages when
`outstandingAutonomousWork === true` for the active session/task.

The predicate is the SAME one the existing `deferredCompletionBarrier`
already uses at line ~553 (`pendingPromptAuthorityUnknown ||
pendingPromptsKnown > 0 || activeNotifyCount > 0`). No new state, no
new protocol field, no UI dedupe, no string/content match.

Repair does NOT:
- Reopen delivery-semantics OOM repair
- Reopen jobId correlation repair
- Reopen deriveOrigin precedence
- Hide duplicate UI cards
- Add UI-only dedupe
- Add string/content equality dedupe
- Add timer/race heuristic
- Add arbitrary "if turn still active" without authoritative lifecycle predicate
- Restore `delivery` across drain → send
- Add a permanent diagnostic public field

---

## 12. Required adversarial cases

- **P1** terminal AFTER originating turn finishes → 1 presentation ✓
- **P2** terminal WHILE originating turn is still alive (frozen bug) → 1 presentation ✓
- **P3** two independent background jobs → each 1, no cross-job dedupe ✓ (conserved by BCNEX01 / CCARD01 / BCTCP01)
- **P4** held batch → each distinct jobId → 1 presentation ✓ (conserved by BCNEX01)
- **P5** duplicate terminal observation for same job → 1 presentation ✓ (conserved by `consumeTerminal` destructive-read)
- **P6** abort/session disappearance → no stale wake ✓ (conserved by BackgroundNotifyCoordinator.dispose())
- **P7** explicit user turn concurrent with terminal wake → unrelated user response NOT suppressed ✓
- **P8** queued/steer unchanged ✓ (conserved by DRP-DRAIN suite, 4/4 pass)
- **P9** OOM conservation → drain path still omits `delivery` ✓ (conserved by DRP-DRAIN-01)
- **P10** correlation conservation → same jobId traverses terminal wake → C4 → C8 ✓

---

## 13. Presentation cardinality invariant

For each terminal job identity J:

```text
terminal_commit(J)             == 1
terminal_presented(J)         == 1
```

NOT based on:
- message text equality
- prompt equality
- timestamps
- array index
- "last message"
- React render count

Identity: `jobId` (preferred at presentation commit seam where available).

---

## 14. RED/GREEN evidence

See `03-red-green.txt` + `04-green-output.txt` + `05-red-output.txt`.

```text
PRE-REPAIR:
  terminal_commit_count     = 1
  wake_created_count        = 1
  presentation_count        = 2
  RESULT                    = RED

ABLATION (filter engaged):
  terminal_commit_count     = 1
  presentation_count        = 1
  RESULT                    = discriminator flips

POST-REPAIR:
  terminal_commit_count     = 1
  presentation_count        = 1
  RESULT                    = GREEN
```

Adversarial cases P1, P7, P10: GREEN.

---

## 15. Gates

```text
bunx tsc --noEmit                                            → 0 errors (ACT_NEW_ERRORS = 0)
git diff --check                                             → 0 errors
background-notify-exactly-once-presentation01.bcnex01.test.ts   7/7 PASS
background-command-terminal-presentation-arbitration01.bctpa01.test.ts  5/5 PASS
sdk-user-message-mapping.test.ts                             17/17 PASS
message-translator.test.ts                                  167/167 PASS
continuation-cardinality-authority01.ccard01.test.ts        12/12 PASS
background-command-terminal-card-projection01.bctcp01-controller.test.ts  7/7 PASS
background-command-terminal-card-projection01.bctcp01-multi-job-controller.test.ts  5/5 PASS
background-command-proceed-abort-ownership-release01.pwaor01.test.ts  1/1 PASS
sdk-session-event-coordinator.test.ts (excluding pre-existing RED OWN01)  28/28 PASS
sdk/core/turn-queue/pending-prompt-service.test.ts          10/10 PASS
sdk/core/turn-queue/pending-prompt-service.drain-semantics.test.ts  4/4 PASS
```

Pre-existing RED test (`OWN01` in `sdk-session-event-coordinator.test.ts`)
is unrelated to this ACT and was failing before the fix.

---

## 16. Temporary diagnostics removal

N/A. The filter uses existing infrastructure (`outstandingAutonomousWork`
predicate from TQCB01 closure, `getPendingPromptCount` /
`getActiveNotifyCount` accessors already wired). No temporary diagnostic
plumbing was added.

---

## 17. Exact-head artifact

```text
SUBJECT_HEAD    = 89e67318df1855c6df555350a99f70df6b37669e
extension version = unchanged (no version bump)
VSIX path       = PENDING (cloud-agent context lacks dogfood VSIX infra)
byte size       = PENDING
SHA-256         = PENDING
extracted extension.js SHA-256 = PENDING
installed extension identity = PENDING
```

VSIX build deferred per the prior ACT pattern (cloud-agent context lacks
dogfood infra).

---

## 18. Live qualification

```text
LIVE_INPUT         = LIVE_OBSERVED (per ACT §0)
LIVE_REPRODUCTION  = EXECUTABLE / PRODUCTION-SHAPED (BCTPA01 5/5 PASS)
LIVE_DOGFOOD       = PENDING (deferred — cloud-agent context lacks dogfood infra)
```

Per ACT §19 LIVE_DOGFOOD = PENDING is acceptable for closure as long as
LIVE_REPRODUCTION is EXECUTABLE / PRODUCTION-SHAPED with the same
production seam.

---

## 19. Verdicts

### Success

```text
PASS_TERMINAL_PRESENTATION_ARBITRATION_LIVE_QUALIFIED
```

This conserves:

```text
PASS_DELIVERY_SEMANTICS_REPAIR_LIVE_QUALIFIED
PASS_CONTINUATION_CORRELATION_RESTORED_COMPOSED
PASS_PRESENTATION_EXACTLY_ONCE_REPAIRED_P1_CORRECTED
```

### RED fails to reproduce

NOT TRIGGERED — RED was reproduced via `BCTPA-RED-01 / ABLATION`.

### Evidence cannot distinguish ownership

NOT TRIGGERED — the `outstandingAutonomousWork` predicate (existing
TQCB01 surface) discriminates ownership cleanly between the two turns.

### OOM returns

NOT TRIGGERED — `bunx tsc --noEmit` clean, all suites pass.

### Correlation regresses

NOT TRIGGERED — BCTPA-P10 + BCNEX01 + CCARD01 + DRP-DRAIN all PASS.

### Exactly-once repair suppresses the only legitimate notification

NOT TRIGGERED — BCTPA-INV-01 confirms the wake_drain turn's
completion_result still flows through.

---

## 20. Factory cursor

```text
ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01

  LIVE_INPUT
    one explicit_user request
    one background job
    one terminal commit
    one wake

  ROOT_CAUSE
    E. PRESENTATION_COMMIT_DUPLICATED
    (the originating explicit_user turn's attempt_completion pushes
     a say:"completion_result" row via appendAndEmit BEFORE the
     deferred-completion-barrier can hold the phase; the subsequent
     wake_drain turn's attempt_completion pushes a SECOND row)

  PRESENTATION_AUTHORITY
    TERMINAL_WAKE_TURN

  REPAIR
    Extended the existing message filter at
    apps/vscode/src/sdk/sdk-session-event-coordinator.ts:467-535
    to suppress say:"completion_result" rows when
    outstandingAutonomousWork is true for the active session/task
    (same predicate as the deferred-completion-barrier)

  CARDINALITY
    terminal_commit     1
    wake_created        <=1 (1 in this specimen)
    terminal_presented  1   (was 2 pre-fix, now 1 post-fix)

  CONSERVATION
    OOM repair          PASS
    C4->C8 correlation  PASS
    queue/steer         PASS

  LIVE
    PASS_TERMINAL_PRESENTATION_ARBITRATION_LIVE_QUALIFIED
```

---

## 21. What comes after this ACT

Per ACT §21: `ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY04`
should NOT be pre-authorized. The current frozen specimen has
`terminal_committed = 1, wake_created = 1`; the prior "two-wake cardinality"
hypothesis is REFUTED in the current architecture. The post-fix
cardinality (one terminal, one wake, one presentation) closes the
duplication defect without re-opening wake-cardinality as a separate
problem.

If a later controlled multi-job specimen demonstrates genuine wake
cardinality inflation, open AUTHORITY04 from that new RED — do not
speculatively open it now.

---

## 24. Final verdict

```text
PASS_TERMINAL_PRESENTATION_ARBITRATION_LIVE_QUALIFIED
```
