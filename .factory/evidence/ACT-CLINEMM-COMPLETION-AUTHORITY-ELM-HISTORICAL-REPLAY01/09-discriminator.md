# 09 — Discriminator (First Semantic Divergence)

The ACT's central question is: **when the REAL frozen trace is fed
through the adapter into the compiled Elm kernel, where is the FIRST
semantic divergence?**

Precedence (§19):
  1. UNMODELED_EVENT
  2. INSUFFICIENT_IDENTITY
  3. ELM_REJECTS_TS_SEQUENCE
  4. TS_EFFECT_CONTRADICTS_ELM_AUTHORITY
  5. PROVENANCE_UNRESOLVED
  6. MATCH

## R1 (control, canonical happy completion)

REAL trace: 13 events.

```
seq  1  run_turn_started        origin=explicit_user    →  INSUFFICIENT_IDENTITY (no runId)
seq  2  terminal_committed      origin=background_terminal →  INSUFFICIENT_IDENTITY (no ownerId)
seq  3  notify_consume_enter    origin=background_terminal →  INSUFFICIENT_IDENTITY (?)
seq  4  wake_created            origin=background_terminal →  INSUFFICIENT_IDENTITY (?)
seq  5  pending_prompt_enqueued origin=pending_prompt_drain promptId=pp-... → DIRECT
seq  6  pending_prompt_dequeued promptId=pp-... → DIRECT
seq  7  continuation_scheduled  promptId=pp-... → DIRECT
seq  8  run_turn_started        origin=explicit_user →  INSUFFICIENT_IDENTITY
seq  9  agent_turn_done         origin=explicit_user →  INSUFFICIENT_IDENTITY
seq 10  run_turn_started        origin=pending_prompt_drain →  INSUFFICIENT_IDENTITY
seq 11  agent_turn_done         origin=pending_prompt_drain →  INSUFFICIENT_IDENTITY
seq 12  submit_and_exit_seen    origin=pending_prompt_drain →  INSUFFICIENT_IDENTITY
seq 13  task_completion_committed origin=pending_prompt_drain →  INSUFFICIENT_IDENTITY
```

**FIRST_DIVERGENCE_SEQ = 1**
**FIRST_DIVERGENCE_STAGE = run_turn_started**
**FIRST_DIVERGENCE_KIND = INSUFFICIENT_IDENTITY** (precedence #2)
**CLASSIFICATION = INSUFFICIENT_IDENTITY** (not MATCH)

The known-good REAL completion trace CANNOT be replayed because the
REAL schema carries `taskId` / `sessionId` / `jobId` / `promptId` /
`origin` but does NOT carry `runId` / `submitId` / `completionId` /
`ownerId` that the Elm kernel requires.

## R2 (held terminal sequence)

REAL trace: 12 events. Same schema gap. First divergence at seq=1
`terminal_committed` (no ownerId).

**FIRST_DIVERGENCE_SEQ = 1**
**FIRST_DIVERGENCE_STAGE = terminal_committed**
**FIRST_DIVERGENCE_KIND = INSUFFICIENT_IDENTITY**

R2 has no `run_turn_started` preceding the terminal, so the first
gap is the ownerId on the terminal, not the runId on the run.

## R3 (continuation sequence)

The continuation is captured inside R1 as the second
`run_turn_started` (origin=pending_prompt_drain, seq 10) and its
matching `agent_turn_done` (seq 11). The schema gap is identical to
R1.

**FIRST_DIVERGENCE_SEQ = 1** (no separate R3 trace; same schema)
**FIRST_DIVERGENCE_KIND = INSUFFICIENT_IDENTITY**

## R4 (the decisive stall)

REAL trace: 158 events. Cardinality matches the predecessor's
stall fingerprint:
- pending_prompt_enqueued = 1
- pending_prompt_dequeued = 1
- continuation_scheduled = 1
- run_turn_started = 3
- agent_turn_done = 2
- submit_and_exit_seen = 2
- task_completion_committed = 1

```
seq  1  run_turn_started       origin=explicit_user sessionId=1790633511093_34re2 →  INSUFFICIENT_IDENTITY (no runId)
seq 20  submit_and_exit_seen   origin=pending_prompt_drain sessionId=1790633511093_34re2 taskId=... → INSUFFICIENT_IDENTITY (no submitId)
seq 21  task_completion_committed origin=pending_prompt_drain → INSUFFICIENT_IDENTITY (no completionId)
seq 22  agent_turn_done        origin=explicit_user → INSUFFICIENT_IDENTITY (no runId)
seq 23  run_turn_started       origin=explicit_user sessionId=1790633775136_8mrnl → INSUFFICIENT_IDENTITY (no runId)
... (130 more terminal_committed events with no ownerId) ...
seq 153 submit_and_exit_seen   origin=pending_prompt_drain sessionId=1790633775136_8mrnl taskId=... → INSUFFICIENT_IDENTITY (no submitId)
seq 154 pending_prompt_enqueued origin=pending_prompt_drain sessionId=1790633775136_8mrnl promptId=... → DIRECT
seq 155 agent_turn_done        origin=explicit_user sessionId=1790633775136_8mrnl → INSUFFICIENT_IDENTITY (no runId)
seq 156 pending_prompt_dequeued origin=pending_prompt_drain sessionId=1790633775136_8mrnl promptId=... → DIRECT
seq 157 continuation_scheduled  origin=pending_prompt_drain sessionId=1790633775136_8mrnl promptId=... → DIRECT
seq 158 run_turn_started       origin=explicit_user sessionId=1790633775136_8mrnl → INSUFFICIENT_IDENTITY (no runId)
```

**FIRST_DIVERGENCE_SEQ = 1**
**FIRST_DIVERGENCE_STAGE = run_turn_started**
**FIRST_DIVERGENCE_KIND = INSUFFICIENT_IDENTITY**

The Elm kernel cannot replay ANY of the 158 historical events in R4
because the REAL schema carries neither `runId` nor `submitId` nor
`completionId` nor `ownerId`. The Elm kernel only accepts the 3
events whose identity is directly present: pending_prompt_enqueued,
pending_prompt_dequeued, continuation_scheduled.

## Verdict implication

The first semantic divergence is **INSUFFICIENT_IDENTITY** at seq=1
`run_turn_started`, present in every frozen REAL trace. This is
precedence #2 — the kernel is NOT rejecting the events semantically;
it is missing the identity to evaluate the transition at all.

Per §39 verdict tree: this is verdict **D (CAPTURE_INSUFFICIENT)**
unless the frozen trace's coverage gap can be closed by extending
the capture seam in a successor ACT.

The capture seam (PCRS02 / execute_turn_prelude_enter) added by the
predecessor ACT was specifically designed to narrow this gap. The
post-stall02 result.json documents that a future live run with the
seam enabled is the next step. This ACT does not propose to close
the capture gap itself; per §31, that is a successor ACT.

## Discriminator question (§40)

By closure this ACT can answer:

- Q1: Does a known-good production completion replay legally?
  **NO. INSUFFICIENT_IDENTITY at seq=1 run_turn_started.**
- Q2: Does REAL production distinguish terminal availability from consumption?
  **UNAVAILABLE_FROM_TRACE** (R2's terminal_committed has no
  observed/registered distinction in the frozen trace; the only
  notion captured is `terminal_committed → notify_consume_enter →
  wake_created`).
- Q3: Can existing trace identity correlate continuation prompt → continuation run?
  **NO** (the continuation run has no `runId` in REAL; only its
  origin-tag distinguishes it from the explicit_user run).
- Q4: Does AgentTurnDone consume the same logical continuation represented by the trace?
  **UNAVAILABLE_FROM_TRACE** (the trace says `agent_turn_done`
  but without runId, we cannot correlate it to the prompt).
- Q5: At each submit_and_exit, what does Elm say holds completion?
  **UNAVAILABLE_FROM_TRACE** (submitId missing).
- Q6: Does TS commit only when Elm says completion is authorized?
  **UNAVAILABLE_FROM_TRACE** (the only TS commit event at seq 21
  precedes the agent_turn_done at seq 22 by ~1400 seconds; we cannot
  replay this sequence into the Elm kernel to compare).
- Q7: Does the known stall sequence become invalid in Elm, and at which first event?
  **YES, INSUFFICIENT_IDENTITY at seq=1.** The stall sequence is
  never even legal because the schema gap blocks it from entering.
- Q8: Is pending_prompt_drain vs explicit_user a real provenance mismatch?
  **NO. PROVENANCE_PRESERVED.** Different events have different
  origins; within an event, the prompt origin and run origin are
  consistent (prompt=pending_prompt_drain, run=explicit_user; this
  is the natural continuation semantic, not a contradiction).
- Q9: Does ExecuteTurnPreludeEnter add a new discriminator where available?
  **UNAVAILABLE_FROM_TRACE** (the seam is added by the predecessor
  ACT but no frozen REAL events of that stage exist; the stage
  is recorded in the kernel's closed tag set but not in any
  pre-stall02 frozen evidence).
- Q10: Is the Elm kernel faithful enough to justify live SHADOW02 wiring?
  **NO. The schema gap means SHADOW02 would see INSUFFICIENT_IDENTITY
  on every run_turn_started / submit_and_exit_seen /
  task_completion_committed event. SHADOW02 cannot be live-wired
  until the capture seam covers those stages.**

## Verdict

**VERDICT = CAPTURE_INSUFFICIENT**
**FIRST_BLOCKED_SEQ = 1**
**FIRST_BLOCKED_STAGE = run_turn_started**
**MISSING_FACT = runId / submitId / completionId / ownerId**
**MISSING_IDENTITY = runId (highest priority: blocks ALL run/agent events)**
**READY_FOR_ELM_SHADOW02 = false**

Successor: ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01
(extend the capture seam to emit runId / submitId / completionId /
ownerId in the REAL trace schema). NOT OPENED HERE.
