# §16 — Adversarial conservation

The repair preserves every adversarial case the predecessor identified.

| Adversarial case | Test | Status |
|---|---|---|
| completion with no submit | ELM-CWRA-R03, R05 | GREEN — `submitCount == 0` keeps `ActiveRun` blocking. |
| completion with independent hold (pending prompt) | ELM-CWRA-R04 | GREEN — pre-repair the test saw `ActiveRun` (since `computeHoldReasons` returns ActiveRun first); post-repair the suppression removes ActiveRun and the test now sees `PendingPrompt or ScheduledContinuation` — the next hold reason. **This is the expected post-repair classification.** |
| wrong `AgentTurnDone` ref | ELM-CWRA-R06 | GREEN — `RunClosedByOtherRef` still fires. |
| duplicate completion | ELM-CWRA-R07 | GREEN — `DuplicateCompletionRef` still fires (after first commit succeeds). |
| run resurrection after completion | ELM-CWRA-R10 | GREEN — `EventAfterCompletion` fires after `CompletionPresented`. |
| pending-prompt hold | ELM-AUTH-04, ELM-AUTH-11, ELM-CWRA-R04 | GREEN. |
| owned terminal hold | ELM-AUTH-02, ELM-AUTH-10, ELM-AUTH-12 | GREEN. |
| continuation hold | ELM-AUTH-04, ELM-AUTH-11, ELM-AUTH-14 | GREEN. |
| duplicate submit (no commit) | ELM-AUTH-15 path: `submitCount = 2` after first `SubmitAndExitSeen` | GREEN — handled by elm-test pre-repair and unchanged. |
| foreign AgentTurnDone | ELM-AUTH-08, ELM-CWRA-R06 | GREEN — `RunClosedByOtherRef`. |
| duplicate TerminalObserved | ELM-CONS-04 | GREEN. |

All 24 pre-existing tests remain GREEN.

The repair makes exactly **one previously-invalid semantic class** valid: the **C10-before-late-C8** chronology where `submitCount >= 1` proves the production BCB barrier cleared. Every other adversarial class remains protected.

## Conservation invariants confirmed

- `computeHoldReasons` is unchanged.
- `completionAuthorized` is unchanged.
- `presentationAuthorized` is unchanged.
- `deriveEffects` is unchanged.
- `handleAgentTurnDone` is unchanged (late C8 still clears `activeRun` and consumes `PromptRunning`).
- `handleRunStarted` is unchanged (still rejects double-starts).
- `ActiveRun` constructor still exists in `HoldReason`.
- `TaskCompletionCommittedWhileHeld ActiveRun` is still emitted when `submitCount == 0` AND `activeRun /= Nothing`.

The only behavioral change is the suppression of `ActiveRun` from the hold set when `submitCount >= 1`, scoped strictly to the `TaskCompletionCommitted` decision.
