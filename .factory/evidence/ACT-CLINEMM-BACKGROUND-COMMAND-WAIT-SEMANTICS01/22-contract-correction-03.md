ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01 — CORRECTION CYCLE 03 RECORD
=============================================================================

Reviewer verdict being closed: HALT_WAIT_SEMANTICS_CORRECTION02_STALE_EPOCH_AUTHORITY
Reviewer disposition when this cycle closes:
  C1: GO directly to ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 —
      no additional pre-execution review cycle unless a new P0 appears.

Cycle 02 verdict was HALT_WAIT_SEMANTICS_STALE_CONTRACT_AUTHORITY and was
closed by commit dc7178a20 (correction 02 record). Cycle 03 closes the
newest P0 + three P1 defects the Factory causal reviewer raised against
the cycle-02 packet. The architectural direction is unchanged: B is the
bounded v1 NOTIFY contract, strict WAIT is out of v1, the coordinator owns
both identity and active-notify semantics, the wake consumer MUST NOT
query CommandJobManager for notification semantics, and §10.8
NOTIFICATION_LIFETIME_INVARIANT governs the wake consumer using only
sessionId + taskId (NOT epoch).

The four defects raised are all *stale-authority residue*: text that
describes a design that cycle 02 already replaced but did not propagate
to every load-bearing section. The fix is bounded — edit four text
locations; no recon, no rubric rescoring, no architecture work.

## Defects closed

### P0 — STALE_EPOCH_SUMMARY_AUTHORITY (§10.7)

**Defect.** §10.7 ended with:

    Supersession: bound to sessionId + taskId + epoch.

This contradicts §10.8 (introduced in cycle 02), which explicitly states
that the wake consumer's lifetime decision is governed by sessionId +
taskId only and that EPOCH IS NOT USED. An implementation agent reading
the §10.7 summary instead of the §10.8 amendment could reintroduce the
exact S9 bug cycle 02 eliminated.

**Fix (file 10-concurrency-and-supersession.md, §10.7).**

  Before:
    - Supersession: bound to sessionId + taskId + epoch.

  After:
    - Supersession: bound to sessionId + taskId (NOT epoch; epoch
      is BTCONT turn-state machinery and is not reused for wake
      semantics per §10.8).

### P1 — S10_STALE_EPOCH_FIELD (S10 identity tuple)

**Defect.** S10 described identity capture at the coordinator seam as:

    (sessionId, taskId, epoch, notifyOnCompletion) per §15.7.1

But the authoritative NotificationMarker shape (introduced in cycle 02)
explicitly REMOVED epoch and added createdAtMs:

    NotificationMarker = {
      jobId,
      sessionId,
      taskId,
      notifyOnCompletion,
      createdAtMs
    }

**Fix (file 16-scenario-suite.md, §16.10).**

  Before:
    - J1, J2 identity captured at coordinator seam
      (sessionId, taskId, epoch, notifyOnCompletion) per §15.7.1

  After:
    - J1, J2 identity captured at coordinator seam
      (sessionId, taskId, notifyOnCompletion, createdAtMs) per §15.7.1

### P1 — S7_WRONG_INTENT_OWNER (S7 reads notify from CommandJob)

**Defect.** S7 said the wake consumer discards based on:

    notifyOnCompletion:false → wake consumer discards the event
    (per §15.7.3: j.notifyOnCompletion !== true → discard)

But §15.7.3 (rewritten in cycle 02) says CommandJob does NOT carry the
notify field and the consumer MUST consult markers.get(jobId). The S7
wording was self-contradictory with §15.7.3.

**Fix (file 16-scenario-suite.md, §16.7).**

  Before:
    - notifyOnCompletion:false → wake consumer discards the event
      (per §15.7.3: j.notifyOnCompletion !== true → discard)

  After:
    - wake consumer: marker = notificationMarkers.get(jobId)
      marker absent OR marker.notifyOnCompletion !== true
      → discard the event (per §15.7.3; CommandJob does NOT carry
        the notify field, so the marker is the only source of truth)

### P1 — OLD_TYPED_OR_COMMANDJOB_WORDING (07 stale alternatives)

**Defect.** Two earlier design statements in 07-contract-candidates.md
still described superseded alternatives:

  1. "the upstream emits steer_message with a formatted text prompt;
      we can emit a typed prompt instead"
     Contradicts §15.7.2 — v1 wake surface is a bounded generated
     prompt *string*, not a typed payload.

  2. Risks block: "Requires durable intent representation (a new
     schema field OR a new CommandJob internal flag)."
     Contradicts §15.7.1 + §15.7.3 — CommandJob does NOT carry
     notification semantics; the only v1 intent representation is a
     notification marker at the coordinator seam.

**Fix (file 07-contract-candidates.md).**

  Before (intro):
    This resembles upstream `notifyParent` but is not bound to copy
    its prompt-based mechanism (the upstream emits steer_message with
    a formatted text prompt; we can emit a typed prompt instead).

  After (intro):
    This resembles upstream `notifyParent` but is not bound to copy
    its prompt-based mechanism. Per §15.7.2 the v1 wake surface is a
    bounded generated prompt **string** delivered through
    `PendingPromptsController.enqueue`, which accepts `{ prompt: string }`
    only. There is no typed-payload alternative in v1.

  Before (Risks):
    - Requires durable intent representation (a new schema field OR a
      new CommandJob internal flag).

  After (Risks):
    - Requires durable intent representation (a new schema field on the
      notification marker at the coordinator seam — NOT on CommandJob,
      which would force a record-shape change in
      command-job-manager.ts; the v1 contract keeps CommandJob free of
      notification semantics per §15.7.1 + §15.7.3).

## Bounded-edit verification

```
git diff --check
  -> clean (no whitespace errors)

git grep -nE \
  'sessionId \+ taskId \+ epoch|j\.notifyOnCompletion|typed prompt instead|new CommandJob internal flag' \
  .factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01
  -> no load-bearing matches anywhere in the ACT directory

git grep -nE '\bj\.(notifyOnCompletion|epoch)' \
  .factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01
  -> no matches anywhere in the ACT directory
```

## Files modified (4 + 1 new + 2 metadata)

Production files touched: 0.
Test files touched: 0.

| File                                        | Lines |
|---------------------------------------------|-------|
| 07-contract-candidates.md                   | 2 edits |
| 10-concurrency-and-supersession.md          | 1 edit (§10.7) |
| 16-scenario-suite.md                        | 2 edits (§16.7 S7 + §16.10 S10) |
| 19-final-review.txt                         | cycle 03 record added |
| 22-contract-correction-03.md                | NEW (this file) |
| result.json                                 | correction_cycle block + verdict_basis extended |
| .factory/epic-board.md                      | Updated + cycle 03 record |

## Final state

- HEAD: the new correction 03 commit (loaded from `git rev-parse HEAD` after this commit lands)
- Contract-freeze commit (load-bearing, immutable successor binding): 769281892e43401bcf81f7e22765f24b60eb5932
- Successor binding head: 769281892e43401bcf81f7e22765f24b60eb5932
- Worktree: clean
- 13 freeze gates (G1-G13): all TRUE
- Verdict: PASS_WAIT_SEMANTICS_CONTRACT_FROZEN
- All 13 P0/P1 defects (5 from cycle 01 + 4 from cycle 02 + 4 from cycle 03): CLOSED

## Next step

ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 (bounded implementation
successor). Scope per §18 (corrected cycle 02). No additional
pre-execution review cycle unless a new P0 appears.
