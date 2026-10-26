# R3 — The complete inversion ledger

Every test assertion this ACT changed, and why. In every case the CHANGE is in
the TEST, never in the load-bearing invariant.

The pattern is uniform: a pinned assertion encoded "the hold publishes NO
phase" or "the phase stays the stale ACTIVE `streaming`". Both encodings were
artifacts of the DEFECT (the hold published nothing, so the phase froze at its
last ACTIVE value). The repair makes the hold publish a TRUTHFUL non-running
phase (`resumable`), so those assertions are inverted.

**In every inverted test, the load-bearing conservation invariant is preserved
verbatim and remains asserted:**

- NO `completed` phase is fabricated.
- ZERO C10 `task_completion_committed` records.
- NO authoritative completion display / badge.
- The deferred-completion marker is PRESERVED (the hold is a HOLD, not a release).

## The inverted assertions

| Suite | Test id | Before | After | Load-bearing invariant preserved |
|---|---|---|---|---|
| `ptwcr01c01` (NEW) | R1-01 | phase `resumable` (RED) | unchanged | no `completed` |
| `ptwcr01c01` (NEW) | R1-06 | "a `pending_prompt_submitted` does NOT clobber `completed`" | **REWRITTEN** — the guard is scoped to the live-barrier case; the PINNED T-08a contract is PRESERVED in the new R1-06b | — |
| `ptwcr01` (RED suite) | R1-01 | phase `streaming`; NO terminal phase; last writer = pending-prompt writer | phase `resumable`; the pending-prompt writer committed NOTHING; last writer = `session-event-bcb-hold-resumable` | — |
| `ptwcr01` (RED suite) | R1-06 | the aborted runtime is left at `streaming` | the aborted runtime is at `resumable` and NOT at `error` | the `error` CONTROL is unchanged |
| `ptwcr01` (RED suite) | R3-02 | the hold produces NO terminal phase at all | the hold produces ONLY `resumable` and NEVER `completed` / `error` / `awaiting_followup` | STRENGTHENED (the original forbade all terminal phases; the repaired form forbids every COMPLETION phase and REQUIRES the truthful `resumable`) |
| `ptwcr01` (RED suite) | R3-03 | after a conservative re-evaluation the phase is STILL `streaming` | after a conservative re-evaluation the phase is STILL `resumable` and STILL no completion phase | the marker is PRESERVED |
| `cpa01` | CPA-10 | `tracker.currentPhase` stays `streaming` | `tracker.currentPhase` stays NOT-completed → `resumable` | `not.toBe("completed")` unchanged |
| `c9c10scr01-cons` | CONS-01 | phase `streaming` | phase `resumable` | no C10 commit, no authoritative display, no published completion row — unchanged |
| `c9c10scr01-cons` | CONS-03 | phase `streaming` | phase `resumable` | no C10 commit, no authoritative display — unchanged |
| `c9c10scr01` | RED-01 | the legacy phase is still `streaming` | the legacy phase is the TRUTHFUL non-running `resumable` | (a) no C10 commit and (c) no authoritative display — unchanged |
| `c9c10scr01` | RED-02 | phase `streaming` | phase `resumable` | no C10 commit, no authoritative display — unchanged |
| `hbclo01` | HBCLO-20 | `getTurnPhase()` is `idle` | `getTurnPhase()` is `resumable` | `not.toBe("completed")` — the C11 "blocked verdict does NOT fabricate task completion" invariant — unchanged |
| `hbop01` | HBOP-03 | `getTurnPhase()` is `idle` | `getTurnPhase()` is `resumable` | `not.toBe("completed")` — "completion is NOT fabricated while held" — unchanged |

## The assertions that were NOT touched (deliberately)

- `ptwcr01` R1-02, R1-03, R1-05, R2-01..R2-04, R3-01, R3-04, R3-05 — the
  predecessor's negative witnesses for premature `completed`, the projection-seam
  reproductions, and the release-path ablation. All unchanged and all GREEN.
- `c9c10scr01-cons` CONS-02, CONS-04, CONS-05, CONS-06 — the exactly-once C10
  conservation suite. The C10 COUNTS are unchanged (1, 1, 1); only the held-phase
  projection changed. All GREEN.
- `cpa01` CPA-03, CPA-04, CPA-07, CPA-11, CPA-16 — the authoritative-marker
  and ordinary-task conservation. The marker COUNTS are unchanged (1, 1, 1);
  only the held-phase projection changed. All GREEN.
- `tpc01` T-01..T-09, G0..G5 — the pinned turn-phase contract. ALL GREEN
  (60/60). T-08a/T-08b/T-08c are explicitly re-asserted by the new
  `PTWCR01C01-R1-06b`.

## The one test that was REWRITTEN rather than inverted

`PTWCR01C01-R1-06` is the only assertion that was rewritten rather than
inverted, and the reason is recorded in `02-r1-repair-contract-and-red.md`:
its first-draft form asserted the predecessor's proposal LITERALLY ("a
`pending_prompt_submitted` does NOT clobber an existing `completed` phase"),
which contradicts the PINNED T-08a contract. **The test was corrected, not the
production code.** The rewritten pair (R1-06 + R1-06b) is strictly stronger
than the original: it asserts BOTH that the BCB-hold guard does not clobber
`completed` AND that the T-08a activation still happens without a barrier.
