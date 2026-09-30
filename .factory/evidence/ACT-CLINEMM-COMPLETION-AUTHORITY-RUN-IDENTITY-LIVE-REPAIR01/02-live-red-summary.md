# ACT-CLINEMM-COMPLETION-AUTHORITY-RUN-IDENTITY-LIVE-REPAIR01 — Live RED Summary

## Evidence class
REAL + LIVE + REAL_PRODUCTION_SEAM.

## What this trace proves
1. Two distinct `run_turn_started` records observed for the same physical turn:
   - seq=1, `origin="explicit_user"`, `runId` absent (caller-side pre-runtime capture at `vscode-session-host.ts:540-548`)
   - seq=4, `origin="unknown"`, `runId="run__JQJjkS2"` (authoritative runtime capture at `canonical-event-subscription.ts:79-115`)
2. `agent_turn_done` (seq=10) carries NO `runId` field, so it cannot correlate to the run.
3. Other new identity fields are working:
   - `task_started` (seq=3) carries `taskId`.
   - `submit_and_exit_seen` (seq=6) carries `submitId`.
   - `task_completion_committed` (seqs 7+8) carries `completionId` + `ownerId`.
4. Dumped counters independently show: `run_turn_started = 2`, `agent_turn_done = 1`.

## Two root causes
- A: Duplicate `run_turn_started` authority. Two captures of the same physical event with different identity.
- B: `agent_turn_done` missing the factual runtime `runId`.

## Required repair (no redesign)
- A: Remove the caller-side capture at `vscode-session-host.ts:540-548`. The authoritative capture at `canonical-event-subscription.ts:79-115` remains.
- B: Retain `runId` keyed by `sessionId` at the runtime-event subscription boundary, read it at the `agent_turn_done` capture seam in `vscode-session-host.ts:550-558`, and emit it on the record.

## Non-repair (deferred)
- `origin=pending_prompt_drain` with zero prompt lifecycle (C9/C10 provenance oddity): P2_FOLLOWUP_PROVENANCE_ODDITY, non-blocking.

## Hash caveat
The ACT prompt documents a 10-line trace via fragments. The reconstructed JSONL `01-live-red.jsonl` reproduces the 10 records faithfully but with a different byte-exact SHA-256 than the ACT doc-stated value because the doc value is over the ACT document, not over this file. The fingerprint matches the prompt by content; the bytes differ by reconstruction.
