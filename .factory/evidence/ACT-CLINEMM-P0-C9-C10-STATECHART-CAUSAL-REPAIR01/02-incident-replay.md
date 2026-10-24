# Phase 2 — Incident replay

## The tool

`tools/lifecycle-replay/replay.ts` — the smallest offline
trace-to-Mermaid projection over the EXISTING JSONL evidence.

It reads a continuation-cardinality-authority (CCARD) capture — the
bounded diagnostic JSONL produced by
`apps/vscode/src/sdk/continuation-cardinality-authority.ts` — and
projects it into a correlated timeline plus a Mermaid state diagram.

It adds NO live instrumentation. It reads no live state.

## Strict correlation

Every projected fact carries a `correlation` value:

| Value | Meaning |
|---|---|
| `exact` | Every available identity field matched. |
| `partial` | The available identity fields matched; at least one was absent from the source record. |
| `unknown` | The join could not be established. The fact is recorded as UNKNOWN, not inferred. |

The SESSION is the primary correlation key and is never guessed: a
record with a different `sessionId` is never merged into a
projection. `taskId` is used when present; when a session carries more
than one `taskId` and a fact carries none, the fact is `unknown`
(known to belong to the session, unknown which task).

## The incident session: NO RECORD

Running the replay against the incident session produces:

```
session: 1792824738628_cw4og
facts: 0
c9: 0  c10: 0  relation: unknown
  NOTE: NO_RECORD_FOR_SESSION: the trace contains no record with sessionId=1792824738628_cw4og.
```

Artifacts:
- `incident-timeline.incident-session-probe.json`
- `incident-path.incident-session-probe.mmd`

A repository-wide search for the literal `1792824738628_cw4og` finds
NO capture, transcript, or diagnostic dump — the only hit is this
ACT's own documentation. The CCARD dump is written by the dogfood
diagnostic profile and was not dumped for that session.

**This is recorded as a capture gap, NOT as evidence for or against
any hypothesis.** The replay therefore cannot establish the incident's
epoch-scoped identity, its per-job terminal observations, or its Elm
decision. Those remain UNKNOWN from the trace alone.

## The reference capture

The closest AVAILABLE durable capture with the SAME structural shape is
the one preserved by
`ACT-CLINEMM-P0-COMPLETION-COMMIT-SHADOW-DIVERGENCE-RECONREPAIR01`:

```
.factory/evidence/ACT-CLINEMM-P0-COMPLETION-COMMIT-SHADOW-DIVERGENCE-RECONREPAIR01/
  sources/continuation-cardinality-authority.jsonl
```

Projected output:
- `incident-timeline.json`
- `incident-path.mmd` (and `incident-path.1792045691672_s0nzn.mmd`)

The projection:

```
session: 1792045691672_s0nzn
taskIds: ['1792045691672_s0nzn']
records: 206
counters:
  execute_turn_prelude_enter : 3
  task_started                : 1
  run_turn_started            : 3
  terminal_committed          : 185
  submit_and_exit_seen        : 3     <-- C9
  task_completion_committed   : 0     <-- C10
  pending_prompt_enqueued     : 2
  pending_prompt_dequeued     : 2
  continuation_scheduled      : 2
  agent_turn_done             : 3
  continuation_started        : 2
c9Attempts: 3   c10Commits: 0   c9c10Relation: unknown
```

This is the SAME structural shape as the reported incident
(`C9 > 0`, `C10 = 0`), and it is what makes the reference projection
meaningful.

### What the replay ESTABLISHES

| Fact | Basis |
|---|---|
| The session made THREE completion ATTEMPTS (`submit_and_exit_seen`). | 3 records at that stage, each with its own monotonic `submitId`. |
| The session made ZERO completion COMMITS. | 0 records at `task_completion_committed`. Since the C10 capture is the ONLY event-creating seam for the commit, the task did NOT complete. |
| Every C9 attempt is UNCOMMITTED. | The C10 count is 0, so no attempt reached a commit. |
| The attempts were followed by continuation activity, not by a commit. | The stage order is `submit_and_exit_seen -> pending_prompt_enqueued -> pending_prompt_dequeued -> continuation_scheduled -> ...`, i.e. the barrier held and the system continued the conversation instead of completing. |

### What the replay does NOT establish (recorded as UNKNOWN)

| Unknown | Why |
|---|---|
| The epoch-scoped identity of any C9/C10 pair | The CCARD record carries no epoch field. |
| Which specific hold predicate fired | The CCARD capture is a cardinality record, not a predicate trace. The BCB writer capture and the Elm decision are separate diagnostics. |
| Whether the row carried the authority marker | The CCARD record carries no message shape. The presentation question is settled by the STRUCTURAL RED witness instead (see `01-causal-analysis.md` §4). |
| The C9 -> C10 pairing | The trace carries a `submitId` per C9 and a `completionId` per C10, but NO join key between them. Recorded as `C10_PRESENT_BUT_UNJOINED` / `C9 -> C10 relation: unknown`. |

The tool prints these as explicit `NOTE:` lines in the Mermaid output
so they cannot be mistaken for established steps.

## Where the evidence ends

The replay ends at the last record of the capture. Everything about the
LIVE incident session itself is UNKNOWN from the repository's evidence.
The causal classification in `01-causal-analysis.md` therefore rests on
the STRUCTURAL RED witness (a real-seam reproduction of the mismatch),
not on a replay of the incident's own trace.

## Why no new instrumentation was added

The ACT requires new live instrumentation ONLY if the replay
demonstrates a specific missing observable boundary. The replay
demonstrated that the capture gap is a DUMP gap (the CCARD file for
that session was never dumped), not a missing OBSERVABLE: the C9/C10
counters, the BCB writer capture, the Elm decision, and the phase
writer provenance all ALREADY exist as production diagnostics. The
structural RED reproduced the defect against the REAL seams without
them. So no new instrumentation was added.
