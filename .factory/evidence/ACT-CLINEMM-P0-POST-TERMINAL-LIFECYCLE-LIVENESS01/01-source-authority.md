# 01 — Source Ownership Map (R0)

ENTRY_HEAD = `bbb5c484d797dd5bc1e4b76246cc9b0d1ebc5672` (branch `main`)

## 1.1 Evidence availability (recorded first, per §1.6)

The ACT-supplied captures dated `2026-10-23` are **NOT PRESENT** anywhere in the
repository or the known ClineMM `globalStorage` capture directory
(`~/Library/Application Support/Code/User/globalStorage/` contains only
`dirac-run.dirac`, `emptyWindowChatSessions`, `state.vscdb`, `storage.json` —
no ClineMM extension directory at all).

Searched (repo-scoped only; no filesystem-wide sweep):
- `.factory/evidence/**` for `turn-state-writer-provenance*`,
  `task-header-selector-input-capture*`, `post-terminal-authority-diagnostic*`,
  `continuation-cardinality-authority*`, `completion-continuation-*.counters*`,
  `bcb-observation-unavailable-capture*`, `lifecycle-clear.counters*`,
  `extension-host-hotloop-diagnostic*`.

The only matches are **earlier, differently-dated** captures:
- `ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01-CORR01/live-captures/*(20261012-*)`
- `ACT-CLINEMM-P0-COMPLETION-COMMIT-SHADOW-DIVERGENCE-RECONREPAIR01/sources/*.jsonl`
- `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/live-20260829T134901Z/*.jsonl`

### Discriminators this prevents (exact)

| Supplied capture | Discriminator it uniquely provides | Status |
|---|---|---|
| `turn-state-writer-provenance(20261023-131638)` | Per-write `{writerId, epoch, phase}` for legacySeq 12621; proves whether the final streaming write was followed by ANY terminal write | `UNAVAILABLE_FROM_TRACE` |
| `continuation-cardinality-authority(20261023-131644)` | `submitId` for the **final** C9 (seq=624) and the `completionId` of any attempted C10 | `UNAVAILABLE_FROM_TRACE` |
| `completion-authority-elm-authority.counters` (per-epoch) | Whether the **final** epoch-18 Elm consult returned AUTHORIZE or HOLD, and with what reason | `UNAVAILABLE_FROM_TRACE` (only aggregate counters supplied) |
| `bcb-observation-unavailable-capture(6).jsonl` | Whether each of the 5 held jobIds' observation was actually *consumed* vs merely *status-read* | `UNAVAILABLE_FROM_TRACE` |
| `post-terminal-authority-diagnostic-webview/extension` | Webview-side vs extension-side `taskHeader.phase` agreement at the incident instant | `UNAVAILABLE_FROM_TRACE` |
| `lifecycle-clear.counters(5).json`, `extension-host-hotloop-diagnostic(2).json` | Background-loop liveness during the stall | `UNAVAILABLE_FROM_TRACE` |

**Consequence:** the §4 exact-epoch identity correlation (`FINAL_C9_IDENTITY`,
`ELM_DECISION_FOR_FINAL_ATTEMPT`, `BCB_JOB_IDS_AFTER_OBSERVATION`, …) **cannot be
closed from trace**. This ACT therefore does NOT claim an exact-epoch historical
cause. It proceeds to R2/R3 with **real-seam RED reproduction** at the production
boundary, which is the §5-authorized substitute path, and states the historical
cause as `UNAVAILABLE_FROM_TRACE`.

---

## 1.2 Causal progression map (the §3.1 chain)

```
submit_and_exit (tool call)
  → C9 submit_and_exit_seen          [sdk-session-event-coordinator.ts:~2900-3070]
  → terminal response committed      [messageTranslatorState.setTerminalResponseCommittedThisTurn]
  → BCB admission/hold               [sdk-session-event-coordinator.ts:3031-3078  register deferredCompletionBarrier]
  → held result observation          [background-notify-coordinator.ts  recordNonNotifyTerminalObservation]
  → BCB settlement                   [command-status-tool.ts  consumeTerminalAuthority]
  → continuation lifecycle           [sdk-session-event-coordinator.ts:1695 enqueueCompletionContinuationIfHeld]
  → agent_turn_done                  [SdkController.ts:2800 setAgentTurnDoneSemanticTrigger → notifyAgentTurnDone:1625]
  → Elm completion authority         [sdk-session-event-coordinator.ts:929 checkElmCompletionAuthority]
  → canonical C10 commit             [sdk-session-event-coordinator.ts:1547 setTurnPhase("completed") + 1565 CCARD record]
  → legacy phase write               [SdkController.ts:2302 turnStateTracker.setWithWriter]
  → webview publication              [sdk-session-event-coordinator.ts:1589 postStateToWebview]
  → TaskHeader projection            [webview-ui/.../buttonConfig.ts:353 getButtonConfigForMessages]
```
## 1.3 Transition table

| # | Transition | AUTHORITATIVE_OWNER | INPUT_IDENTITY | TRIGGER | GUARD | SUCCESS_EFFECT | FAILURE/HOLD_EFFECT | EXISTING_TEST | OBSERVABILITY |
|---|---|---|---|---|---|---|---|---|---|
| T1 | C9 capture | `handleSessionEvent` | sessionId, epoch | `done` event | none (records) | CCARD `submit_and_exit_seen` | — | BCB01-C4 | CCARD |
| T2 | BCB admission | `handleSessionEvent` | marker{sessionId,taskId,epoch} | outstanding autonomous work \|\| running owner \|\| held obligation | 4 conjuncts | register `deferredCompletionBarrier` | return (held) | BCB01-C1..C4 | CCARD |
| T3 | Terminal observation | `BackgroundNotifyCoordinator` | jobId, sessionId, taskId | job reaches terminal | ownership correlation | register held terminal fact | reject foreign owner | BCB-31..35 | CCU counters |
| T4 | BCB settlement | `command-status-tool.ts` | jobId | `command_status` call | `consumeTerminalAuthority` | remove held fact | preserve | BCCA | — |
| T5 | Continuation | `enqueueCompletionContinuationIfHeld` | (sessionId,taskId,epoch) | reevaluate + heldObligation | Elm E3.1 + dedupe | `sdkHost.send` | `already_sent`/`no_held_job_ids` | BCB01-C4 | delivery counters |
| T6 | `agent_turn_done` | `notifyAgentTurnDone:1625` | sessionId | semantic trigger | — | flush Elm + reevaluate | — | — | `notifyAgentTurnDoneEntered` |
| T7 | Elm authority | `checkElmCompletionAuthority:929` | sessionId | T6/T8 | — | `authorize` | `hold` (re-register marker L1539) / `failure` (suppress) | CAE01, CASE01 | Elm counters |
| T8 | **Barrier reevaluate** | `reevaluateDeferredCompletionBarrier:1205` | marker vs live session/task/epoch | **only** T6 and `updateBackgroundCommandState` | identity triple (L1248-1264) | L1547 commit + L1565 C10 + L1589 publish | clear marker silently | BCB01-C4 | CCU U1..U11 |
| T9 | Legacy phase write | `turnStateTracker.setWithWriter` | phase, writerId | T8 | — | `turnState.phase` | — | — | turn-state-writer-provenance |
| T10 | Webview publish | `postStateToWebview` | ExtensionState | T8 L1589 | — | committed state | — | ELMIZE-P0-THTC | PTAD |
| T11 | TaskHeader | `getButtonConfigForMessages` | phase/partial | render | — | `secondaryAction:"cancel"` iff streaming | — | AOC02 §6 | selector capture |

## 1.4 The TWO defects, at their own boundaries

### L1 — completion liveness: `reevaluateDeferredCompletionBarrier` is trigger-starved

The barrier is re-evaluated from **exactly two** call sites
(`grep reevaluateDeferredCompletionBarrier` over non-test sources):

1. `sdk-session-event-coordinator.ts:1649` — inside `notifyAgentTurnDone`
2. `SdkController.ts:5458` — inside `maybeReevaluateDeferredContinuation`
   (the terminal-idle / background-command-state transition)

There is **no** trigger on the transition that actually mattered in the
incident: the BCB obligation set draining (observations being consumed). The
consequence is a **terminal stranding**: if the LAST
`agent_turn_done` lands while the Elm authority still holds on
`scheduled_continuation` / `pending_prompt`, T8 re-registers the marker at
L1539 and returns. If no further `agent_turn_done` (T6) and no further
terminal-idle transition (site 2) occurs, the marker survives with all
obligation predicates already false and C10 is **never** attempted.

Evidence this matches the capture: the aggregate `completion-continuation-upstream`
counters show `reevaluateEntered=686` but `markerPresent=16` — the vast majority
of reevaluations found no marker. The final epoch-18 C10 is absent while
`attemptCompletionSeen=true` and `terminalResponseCommitted=true`, i.e. C9 was
Secondary fail-open found at the same boundary (recorded, **not** repaired here):
`SdkController.ts:2649-2659 getUnconsumedOwnedTerminalResultCount` returns `0`
when `getActiveSession()` is absent — an unavailable authority read as
"no obligations". Same shape at L2664-2673 for the IDs list. This is the
`pendingPromptAuthorityUnknown` fail-closed idiom NOT being applied to the BCB
provider. It is a real hazard but it is **fail-toward-completion**, i.e. the
opposite of the reported symptom (false Working), so it is out of this ACT's
repair scope and is recorded as a follow-up.

### L2 — cancellation liveness: `cancelTask` early-returns with no lifecycle transition

`sdk-task-control-coordinator.ts:100-111`:

```ts
const activeSession = this.options.sessions.getActiveSession()
recordCancelLivenessRequest({...})
this.options.interactions.clearPending("Task cancelled")
if (!activeSession) {
    Logger.warn("[SdkController] cancelTask: No active session")
    return          // <-- no fence, no phase write, no publication
}
```

When there is no active session, Cancel performs **no** lifecycle transition:
`raiseCancelFence()` is not called (so the epoch is NOT bumped and straggler SDK
events are NOT dropped), no `setTurnPhase` write occurs, and
`postStateToWebview()` is never invoked. The webview's committed state is
unchanged, so `turnState.phase` stays `streaming` and the TaskHeader keeps
rendering `BUTTON_CONFIGS.partial` (`secondaryAction: "cancel"`,
`webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts:207-214`) —
which dispatches `TaskServiceClient.cancelTask` again. This is a **self-
perpetuating** false-Working/Cancel state: clicking Cancel re-enters the same
no-op branch forever.

Reachability from the production webview action is **REAL**, not
method-call-only:
`TaskHeader`/footer `ActionButtons` → `useMessageHandlers.ts:583` →
`TaskServiceClient.cancelTask` (gRPC) → `src/core/controller/task/cancelTask.ts`
→ `controller.cancelTask()` → `SdkTaskControlCoordinator.cancelTask()`.

Cancel diagnostics (`cancel-liveness-diagnostic.ts`,
`cancel-liveness-diagnostic-runtime.ts`) **ARE present at HEAD**, DEFAULT_OFF,
dogfood-profile-wired, 5 sub-boundary counters with an explicit H-A signature
`(req=1, acc=0, inv=0, cmp=0, pub=0)` that is exactly this branch.

## 1.5 Primary repair seam

- **L1**: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` —
  `reevaluateDeferredCompletionBarrier` (missing causal re-evaluation trigger on
  obligation-drain). Integration module (at most one): the BCB drain producer in
  `background-notify-coordinator.ts`, so the trigger is raised by the *actual*
  causal event rather than polled.
- **L2**: `apps/vscode/src/sdk/sdk-task-control-coordinator.ts` — `cancelTask`
  no-active-session branch (must reach a supported recovery transition).

Both are single-module, bounded, and at the real production seam.
captured and C10 was never reached, which is only possible if T8 either was
not entered again after the obligations cleared, or cleared the marker on an
identity-mismatch branch (L1260-1264) before reaching the Elm gate.