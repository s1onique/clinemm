# 02 — Timestamped correlation of the supplied incident

Identity binding for EVERY observation below:

    sessionId = 1792850126157_b9u7x
    taskId    = 1792850126157_b9u7x
    epoch     = 6
    jobId     = cmd_mvmh3u69j62aclho
    manager   = M2

Evidence root:
`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm/`

| ts (ms) | source file | fact | boundary |
|---|---|---|---|
| 1792850126152 | turn-state-writer-provenance.jsonl | `controller-epoch-transition-reseed` -> epoch 6 | epoch established |
| 1792850126361 | turn-state-writer-provenance.jsonl | `task-start-init-task` -> phase `streaming` (seq 5662) | task start |
| 1792854219876..1792854819267 | background-job-liveness-authority.jsonl | 256 records, all `managerInstance: M2` | liveness ring window |
| 1792854739012 | background-job-liveness-authority.jsonl | `job_active_removed` for `cmd_mvmjekhj7yer51hf`, `terminalState: "exited"`, `reason: "natural"` | the last CLEAN job of the window |
| 1792854752427 | continuation-cardinality-authority.jsonl seq 457 | `submit_and_exit_seen` (`submit-1792850126157_b9u7x-3`) | **C9 #1** |
| 1792854752430 | bcb-observation-unavailable-capture.jsonl | `unconsumedOwnedTerminalResultsForC10: 1`, `ownedTerminalJobIdsForC10: ["cmd_mvmh3u69j62aclho"]`, `heldObligationForC10: true`, `ownerStillRunningForC10: false`, `outstandingAutonomousWork: false`, `epoch: 6` | BCB #1 — the obligation is HELD on the incident job |
| 1792854752460 | continuation-cardinality-authority.jsonl seq 458-460 | `pending_prompt_enqueued` -> `pending_prompt_dequeued` -> `continuation_scheduled` | the coalesced continuation |
| 1792854752461 | turn-state-writer-provenance.jsonl | `session-event-pending-prompt-submitted` -> phase `streaming` (seq 20014) | the LAST phase write for this task |
| 1792854752483 | continuation-cardinality-authority.jsonl seq 462 | `agent_turn_done` (run `run_uO0qeum1`) | turn 1 end |
| 1792854767771 | background-job-liveness-authority.jsonl | `job_status_lookup` for `cmd_mvmh3u69j62aclho`: `source: "miss"`, `returnedState: null` | **manager MISS** — the ONLY record for this jobId in the entire ring |
| 1792854784687 | continuation-cardinality-authority.jsonl seq 465 | `terminal_committed` for `cmd_mvmjg5brj0ehl4dq` | another job's clean terminal |
| 1792854816761 | continuation-cardinality-authority.jsonl seq 466 | `terminal_committed` for `cmd_mvmjghrcphv4gsh4` | another job's clean terminal |
| 1792854831983 | continuation-cardinality-authority.jsonl seq 467 + bcb-observation-unavailable-capture.jsonl | `submit_and_exit_seen` (`submit-...-4`) **and** a SECOND BCB capture with the SAME facts: `unconsumedOwnedTerminalResultsForC10: 1`, `ownedTerminalJobIdsForC10: ["cmd_mvmh3u69j62aclho"]`, `heldObligationForC10: true` | **C9 #2** — the obligation is STILL held on the same jobId |
| 1792854832006 | post-terminal-authority-diagnostic-extension.jsonl | `attemptCompletionSeen: true`, `terminalResponseCommittedThisTurn: true`, `runtimeStatus: "completed"`, `shadowStatus: "completed"`, `shadowRecoveryState: "idle"`, **`legacyPhase: "streaming"`**, `taskHeaderPresentation: { phase: "streaming", source: "legacy" }`, `taskTelemetry.runtimeErrorCount: 2` | the RUNTIME finished; the LEGACY/TASK phase did NOT advance to `completed` |
| 1792854832048 | continuation-cardinality-authority.jsonl seq 468 | `agent_turn_done` (run `run_M1k-HS4x`) | turn 2 end |
| 1792854832089 | post-terminal-authority-diagnostic-webview.jsonl | last webview push, `legacyPhase: "streaming"` | the webview never received a `completed` phase |

## Boundary-by-boundary result

| Required boundary | Result | Evidence / reason |
|---|---|---|
| Job finalization — original terminal state and postcondition | **UNAVAILABLE_FROM_TRACE** | The liveness ring contains NO `job_active_removed` / `process_terminality_record` / `command_job_primary_group_cleanup` / `command_job_containment_failed` record for `cmd_mvmh3u69j62aclho`. The ring's ONLY record for that jobId is the `job_status_lookup` MISS at 1792854767771. Per the ACT's instruction, the finalization state is NOT inferred from the later manager miss. |
| Manager removal — why the entry disappeared | **UNAVAILABLE_FROM_TRACE** | No `job_active_removed` record exists for this jobId, so the removal cause (natural exit vs containment-failure delete vs bounded-FIFO eviction) cannot be established. The MISS at 1792854767771 is consistent with several causes. |
| Compact receipt — whether the terminal fact survived eviction | **UNAVAILABLE_FROM_TRACE** | The BCB receipt store is not in the uploaded evidence. Structural note: `recordTerminalReceiptFromLifecycle` only accepts `command_job_terminal_committed`, and the manager emits that ONLY on the `gone` path — so IF this job failed containment, it could never have had a receipt. |
| `command_status` — manager miss vs returned tool response | **Manager MISS observed** (1792854767771). The tool response itself is not captured. | background-job-liveness-authority.jsonl |
| BCB consumption — exact count before and after | **1 before, 1 after.** | bcb-observation-unavailable-capture.jsonl: both captures (1792854752430 and 1792854831983) report `unconsumedOwnedTerminalResultsForC10: 1` and `ownedTerminalJobIdsForC10: ["cmd_mvmh3u69j62aclho"]`. The obligation was NEVER drained. |
| Process safety — whether `gone` was ever observed | **UNAVAILABLE_FROM_TRACE** | No `command_job_primary_group_cleanup` record (the only carrier of `postcondition`) exists for this jobId anywhere in the ring. |
| Elm decision — HOLD/AUTHORIZE and input identity | **UNAVAILABLE_FROM_TRACE** | The Elm authority counters are process-global (`authorize: 2`, `hold: 2`, `failure: 0`, `sessionsActive: 3`, `lastDecision: "authorize"`) and carry no per-session, per-job, or per-decision identity. `lastHoldReasons: []`. They CANNOT be attributed to this session. |
| C10 — whether a committed phase write occurred | **NO — C10 did NOT occur.** | continuation-cardinality-authority.jsonl: `submit_and_exit_seen` = 2, `task_completion_committed` = 0 for this session. turn-state-writer-provenance.jsonl contains NO `session-event-turn-complete-completed` write for this task (only `task-start-init-task` and `session-event-pending-prompt-submitted`, both `streaming`). |
| Promotion — whether an authoritative row was actually published | **NO.** | `promoteCompletionAuthorityMarker` is invoked only from the C10 commit paths (L2007, L3898). With C10 = 0, no promotion occurred. |
| Webview — whether that row and phase were received and committed | **NO.** | The final webview push (1792854832089) carries `legacyPhase: "streaming"`. The final extension push (1792854832006) carries `legacyPhase: "streaming"` and `taskHeaderPresentation.phase: "streaming"`. |

## The two decisive corrections to the leading hypothesis

1. **The terminal observation was NOT consumed.** Both BCB captures report
   `unconsumedOwnedTerminalResultsForC10: 1` for the SAME jobId. The
   upstream counters agree: `unconsumedTerminalCountPositive: 4`,
   `unconsumedTerminalCountLast: 1`, `lastStopReason: "stalled_no_progress"`.
   The BCB HOLDED on the incident job for the entire window.

2. **C10 was NOT authorized.** `submit_and_exit_seen = 2` but
   `task_completion_committed = 0`. The provenance has no `completed` phase
   write. The upstream counters show `markerPresent: 7` re-evaluations that
   all ended at `stalled_no_progress`.

Therefore the hypothesis "the observation was consumed and the C10 was
authorized over an unresolved containment failure" is **NOT** what happened
in this incident. What happened is the **opposite failure mode**: the BCB
held the completion forever (`HALT`-shaped stall), the task phase never
left `streaming`, and the runtime's `completed` status and the task
phase's `streaming` disagreed.

### How the user-visible "Complete" could arise

The webview's "Complete" label is `stateLabel("completed")` — derived from
the TASK phase. The final captured phase is `streaming`, so the label
derived from the captured phase is "Working", not "Complete". The runtime
status was `completed`. The uploaded provenance capture ENDS before the
screenshot showing `Complete` (per the ACT's instruction), so the exact
producer of that later "Complete" is **UNAVAILABLE_FROM_TRACE** and is NOT
manufactured here.
