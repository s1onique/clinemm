# LIVE evidence index (frozen)

Source root:
`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm/`

Every LIVE fact asserted in this ACT is quoted from one of the files below. No LIVE
fact is inferred.

| File | Facts used |
|------|------------|
| `turn-state-writer-provenance.jsonl` | The final phase writes: `session-event-turn-complete-resumable-straggler-preserve` → `awaiting_followup` (seq 132079); `session-event-pending-prompt-submitted` → `streaming` (seq 132080); `session-event-pending-prompt-submitted` → `streaming` (seq 132499). **No `controller-cancel-task` writer for this task** — the run was NOT user-cancelled. |
| `continuation-cardinality-authority.jsonl` | `submit_and_exit_seen` ×2 (seq 2138, 2146); `task_completion_committed` ×0; `pending_prompt_enqueued` (seq 2139); `pending_prompt_dequeued` (seq 2141); `continuation_scheduled` (seq 2142); `execute_turn_prelude_enter` (seq 2143); final `agent_turn_done` (seq 2147) with NO phase write. |
| `bcb-observation-unavailable-capture.jsonl` | The four held jobIds (`cmd_mvo9fosf9tyu4xb3`, `cmd_mvo9fosftrej06ye`, `cmd_mvo9fosfbixo2qfc`, `cmd_mvo9hvbop47y3i42`); `unconsumedOwnedTerminalResultsForC10: 4`; `heldObligationForC10: true`; `ownerStillRunningForC10: false`; `outstandingAutonomousWork: false`; `liveToolsIncludesCommandStatus: true`; `canObserveHeldResults: true`; `writerId: "session-event-bcb-eligible-no-bcb-writer"`. |
| `completion-authority-elm-authority.counters.json` | `authorize: 0`, `hold: 5`, `failure: 4`, `total: 5` — **the Elm authority never authorized**, so no C10 was possible. |
| `completion-continuation-upstream.counters.json` | `reevaluateEntered: 1841`, `markerPresent: 5`, `markerMissing: 1836`; `heldJobIdsCountLast: 4`; `enqueueCompletionContinuationInvoked: 1`; `stalledNoProgress: 1`; `lastStopReason: "authority_check_reached"`. |
| `completion-continuation-delivery.counters.json` | `delivered: 1`, `lastOutcome: "delivered"`, **`pendingPromptEnqueuedObserved: null`** — the enqueue was NOT independently observed from the delivery seam. |
| `post-terminal-authority-diagnostic-extension.jsonl` | `runtimeStatus: "aborted"`, `runtimeModelStreaming: false`, `runtimePendingToolCount: 0`, `shadowStatus: "aborted"`, `shadowRecoveryState: "recovering"`, `legacyPhase: "streaming"`, `legacySeq: 132499`, `taskHeaderPresentation: { phase: "streaming", source: "legacy" }`, `thinkingPresentation: { modelStreaming: false, source: "shadow" }`, `attemptCompletionSeen: true`, `terminalResponseCommittedThisTurn: true`. |
| `post-terminal-authority-diagnostic-webview.jsonl` | `appliedLegacyPhase: "streaming"`, `appliedLegacySeq: 132499`, `taskHeaderPresentation: { phase: "streaming", source: "legacy" }`, `buttonConfig: { secondaryText: "Cancel", secondaryAction: "cancel" }`, `messageTail: { say: "completion_result", partial: false, seq: 132748 }`, `stateVersion: 132749` — **the webview ACCEPTED the push**. |
| `task-header-selector-input-capture.jsonl` | `publicationShadowBinding: "UNBOUND"`, `canonicalShadowPhase: "completed"`, `currentLegacyPhase: "streaming"`, `selectedPhase: "streaming"`, `selectedSource: "legacy"`, `seq: 132499`. |
| `background-owner-correlation.jsonl` | The Q5 deferral decision: `currentPhase: "streaming"`, `candidatePhase: "awaiting_followup"`, `guardResult: true`, `pendingPromptCount: 3`, `activeNotifyCount: 1`, `outstandingAutonomousWork: true`, `candidateWriterId: "session-event-turn-complete-resumable-straggler-preserve"`. |

## Facts NOT observable from the capture (recorded, not claimed)

- Whether the runtime's `aborted` status was produced by an explicit user
  cancellation or by framework termination. **RESOLVED by proxy**: the provenance has
  no `controller-cancel-task` writer for this task, and `cancelTask()` writes
  `resumable` BEFORE aborting — so the run was framework-terminated.
- Whether a valid continuation would have arrived after the capture ended. **NOT
  EXCLUDED** — recorded as the residual. But the runtime was already `aborted` from
  1792961416077 (the FIRST captured push), 59 seconds before the capture end at
  1792961475571, so the `aborted` status is NOT a post-terminal artifact of the
  capture window.
