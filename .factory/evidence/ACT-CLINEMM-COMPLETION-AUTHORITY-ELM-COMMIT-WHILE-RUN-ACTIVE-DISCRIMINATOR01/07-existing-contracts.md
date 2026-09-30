# §12 — CWRA-07: conservation semantics

## Existing tests for C10 / C8 ordering

| Test file | What it asserts | Classification |
|---|---|---|
| `apps/vscode/src/sdk/__tests__/completion-authority-run-identity-live-repair01.test.ts` | PRE-repair RED: `agent_turn_done` carries no runId; POST-repair GREEN: `agent_turn_done` carries runId. Does NOT assert relative ordering of C10 vs C8. | **never asserts relative order** |
| `apps/vscode/src/sdk/__tests__/completion-authority-elm-historical-replay01.test.ts` (HR-09) | Synthetic trace `task_started -> run_turn_started -> task_completion_committed` must classify the C10 as `ELM_REJECTS_TS_SEQUENCE`. This REPLICATES the LIVE divergence as a kernel test. The Elm kernel test `ELM-AUTH-09` is the model-side analog: `RunStarted R1 + TaskCompletionCommitted C1 -> TaskCompletionCommittedWhileHeld ActiveRun`. | **explicitly requires C10 without prior C8** (kernel-side; no production ordering constraint) |
| `apps/vscode/src/sdk/__tests__/post-consumption-completion-authority01.pcca01.test.ts` | `submit_and_exit_seen=2 and task_completion_committed=1` (PCCA-05: full chronology). Does NOT assert C8's relative position. | **merely tolerates C10<C8** (the chronology is observable but not asserted as an invariant) |
| `apps/vscode/src/sdk/__tests__/background-completion-barrier01.bcb01.test.ts` | Tests the BCB01 barrier: outstanding obligations hold C10. `agent_turn_done` is not in the test's chronology. | **never asserts relative order** |
| `apps/vscode/src/sdk/__tests__/background-command-terminal-presentation-arbitration01.bctpa01.test.ts` | Two `agent_turn_done` (origins: explicit_user + pending_prompt_drain) + 1 `task_completion_committed`. The wake_drain turn's `task_completion_committed` arrives AFTER both `agent_turn_done`s. | **explicitly requires C10 AFTER C8** (BCTPA01's invariant) |

## Existing Elm kernel tests for the active_run hold

From `apps/vscode/elm/completion-authority/tests/CompletionAuthorityTest.elm`:

- `ELM-AUTH-09`: `RunStarted R1 + TaskCompletionCommitted C1 -> TaskCompletionCommittedWhileHeld ActiveRun`
- `ELM-AUTH-13`: `ContinuationStarted(P, R) + AgentTurnDone R -> P becomes PromptConsumed` (P is consumed AFTER C8)
- `ELM-AUTH-15`: `RunStarted R1, AgentTurnDone R1, SubmitAndExitSeen -> AuthorizeTaskCompletion is in the effect set` (the AUTHORITATIVE production model: C8 BEFORE C9 BEFORE C10)

`ELM-AUTH-15` is the load-bearing evidence: **the Elm kernel's AUTHORITATIVE happy-path test asserts that C10 requires C8 to have fired first**. This is NOT a coincidence; this is the Elm model's contract.

## Important distinction

> Existing chronology is NOT automatically an invariant.

The Elm kernel's tests `ELM-AUTH-15` + `ELM-AUTH-09` together encode the invariant:

```
C8 (AgentTurnDone closingRef) MUST precede C10 (TaskCompletionCommitted)
IF activeRun was set by a RunStarted with the same closingRef.
```

The production seam reproduces this ordering 100% of the time (C10 fires inside `executeTurn`, C8 fires after `executeTurn` returns). But the production seam has a 51ms window where C10 has fired and C8 has not yet — which violates the Elm invariant precisely.

## Conclusion: structural analysis

The Elm kernel test `ELM-AUTH-09` is a deliberate, tested invariant: the kernel rejects C10 when `activeRun is set`. The production seam emits C10 BEFORE C8. These are CONTRADICTORY by construction.

The discriminator ACT's question is: **which is correct?**

The evidence in this ACT demonstrates:
- C10->C8 interval contains only bookkeeping (no semantic activity)
- No post-C10 failure can invalidate completion
- The Elm kernel would happily accept the completion if C8 fired first (counterfactual proof)

Therefore: the Elm kernel's invariant is CORRECT in spirit (it wants to enforce "completion is durable only after the run is closed") but WRONG in mechanism (it equates "run event not yet closed" with "completion must remain held"). The fix lives in the Elm model, not in production.

## Summary

| Test class | Classification |
|---|---|
| Existing tests that require C10 < C8 | NONE |
| Existing tests that tolerate C10 < C8 | post-consumption-completion-authority01, background-command-terminal-presentation-arbitration01 |
| Existing tests that never assert relative order | completion-authority-run-identity-live-repair01, background-completion-barrier01 |
| Elm kernel tests that require C10 AFTER C8 | `ELM-AUTH-09` (the active_run hold), `ELM-AUTH-15` (the happy-path AuthorizationToComplete fires only after C8) |

The Elm kernel has a tested, intentional invariant: completion is authorized ONLY after the run is closed. Production violates this 51ms window every turn.
