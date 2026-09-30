# ACT-CLINEMM-COMPLETION-AUTHORITY-RUN-IDENTITY-LIVE-REPAIR01 — Live RED Summary

## Evidence class
REAL + LIVE + REAL_PRODUCTION_SEAM.

The `01-live-red.jsonl` in this directory is a byte-exact copy
of:

```
/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm/continuation-cardinality-authority.jsonl
```

captured from a dogfood run of the unrepaired extension on the
mundane task:

> Inspect this repository and tell me the current Git HEAD and whether
> the working tree is clean. Do not modify any files.

SHA-256 of the file in this directory:
`aea2719c60131ba8ceffcf3558fb8af97e1fc6e7d5c45708eee77f484aa8e25f`.

## Exact 10-line trace (sequence verbatim)

| seq | at (epoch ms)     | stage                       | origin                | sessionId               | extra fields                                                                                  |
| --- | ----------------- | --------------------------- | --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | 1790805281545     | run_turn_started            | explicit_user         | 1790805281100_jbf6y     | (no runId)                                                                                     |
| 2   | 1790805281545     | execute_turn_prelude_enter   | explicit_user         | 1790805281100_jbf6y     |                                                                                                |
| 3   | 1790805281545     | task_started                | explicit_user         | 1790805281100_jbf6y     | taskId=1790805281100_jbf6y                                                                      |
| 4   | 1790805281564     | run_turn_started            | unknown               | 1790805281100_jbf6y     | runId=run__JQJjkS2                                                                             |
| 5   | 1790805284924     | terminal_committed          | background_terminal   | 1790805281100_jbf6y     | jobId=cmd_muon89b4c71md08o, ownerId=1790805281100_jbf6y                                          |
| 6   | 1790805285012     | terminal_committed          | background_terminal   | 1790805281100_jbf6y     | jobId=cmd_muon89b4b7pbghg9, ownerId=1790805281100_jbf6y                                          |
| 7   | 1790805285012     | terminal_committed          | background_terminal   | 1790805281100_jbf6y     | jobId=cmd_muon89b4twzm6tus, ownerId=1790805281100_jbf6y                                         |
| 8   | 1790805287318     | submit_and_exit_seen        | pending_prompt_drain  | 1790805281100_jbf6y     | taskId=1790805281100_jbf6y, submitId=submit-1790805281100_jbf6y-1                               |
| 9   | 1790805287318     | task_completion_committed   | pending_prompt_drain  | 1790805281100_jbf6y     | taskId=1790805281100_jbf6y, completionId=completion-1790805281100_jbf6y-1                       |
| 10  | 1790805287356     | agent_turn_done             | explicit_user         | 1790805281100_jbf6y     | (no runId)                                                                                     |

## What this trace proves (pre-repair state of the unrepaired extension)

1. **DUPLICATE_RUN_STARTED_AUTHORITY** — two `run_turn_started`
   records observed for the same physical turn:
   - seq=1, `origin="explicit_user"`, no runId (caller-side
     pre-runtime capture at `vscode-session-host.ts:540-548`).
   - seq=4, `origin="unknown"`, `runId="run__JQJjkS2"` (authoritative
     canonical-event-subscription capture carrying the factual
     runtime runId).
2. **AGENT_TURN_DONE_MISSING_FACTUAL_RUN_ID** — seq=10 carries no
   runId, so it cannot correlate to its start.
3. **Other new identity fields ARE working** in the unrepaired
   extension:
   - `task_started` (seq=3) carries `taskId`.
   - `terminal_committed` (seqs 5/6/7) carries `jobId` + `ownerId`.
   - `submit_and_exit_seen` (seq=8) carries `submitId`.
   - `task_completion_committed` (seq=9) carries `completionId`.
4. Dumped counters independently show:
   `run_turn_started = 2`, `agent_turn_done = 1`.

## P2 NON-BLOCKING — `submit_and_exit_seen` / `task_completion_committed`
## both carry origin=pending_prompt_drain with zero prompt lifecycle

These two records are present but the trace shows no preceding
`pending_prompt_enqueued` / `pending_prompt_dequeued` /
`continuation_scheduled` records for that prompt. Recorded as
`P2_FOLLOWUP_PROVENANCE_ODDITY` and deferred (not part of this ACT's
repair scope).

## Two root causes (driving the repair)
- A: DUPLICATE_RUN_STARTED_AUTHORITY
- B: AGENT_TURN_DONE_MISSING_FACTUAL_RUN_ID

## Required repair (no redesign)
- A: Remove the caller-side C7 capture at
  `vscode-session-host.ts:540-548`. The authoritative
  `canonical-event-subscription.ts:79-115` emission is the SOLE
  authority.
- B: Retain `runId` keyed by `sessionId` at the runtime-event
  subscription boundary (when `run-started` arrives). Read it at
  the `agent_turn_done` capture seam in `vscode-session-host.ts`
  and emit it on the record.
