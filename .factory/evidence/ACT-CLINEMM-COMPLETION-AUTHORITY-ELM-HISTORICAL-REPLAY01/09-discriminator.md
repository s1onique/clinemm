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

## CORRECTION01 evidence classification (replaces prior claim)

```text
REAL traces              = 2 (R1, R4)
SYNTHETIC_REAL traces    = 1 (R2)
REAL events              = 13 + 158 = 171
SYNTHETIC_REAL events     = 12
Total events             = 183 (counted across all 3 sources)

ELM_MODEL_CORRESPONDENCE = UNPROVEN
REASON                    = CAPTURE_INSUFFICIENT

Previous claim that the Elm model "is faithful / not too coarse" is
REMOVED. The verdict is precisely that the schema gap prevents the
evidence from entering the model to establish correspondence. The
compiled-kernel integration mechanism itself (Elm.Main.init() + JS
ports) is legitimate and CORRECTION01's port-flush fix proves the
replay oracle actually exercises the kernel — the bottleneck is
evidence coverage, not architectural.
```

## Per-trace first divergence

### R1 (REAL control, canonical happy completion)

REAL trace: 13 events.

```
seq  1  run_turn_started        origin=explicit_user    →  INSUFFICIENT_IDENTITY (no runId)
seq  2  terminal_committed      origin=background_terminal →  INSUFFICIENT_IDENTITY (no ownerId; origin≠Elm kind)
seq  3  notify_consume_enter    origin=background_terminal →  DIRECT (jobId present)
seq  4  wake_created            origin=background_terminal →  DIRECT (jobId present)
seq  5  pending_prompt_enqueued origin=pending_prompt_drain promptId=pp-... → DIRECT
seq  6  pending_prompt_dequeued promptId=pp-... → DIRECT
seq  7  continuation_scheduled  promptId=pp-... → DIRECT
seq  8  run_turn_started        origin=explicit_user →  INSUFFICIENT_IDENTITY
seq  9  agent_turn_done         origin=explicit_user →  INSUFFICIENT_IDENTITY
seq 10  run_turn_started        origin=pending_prompt_drain →  INSUFFICIENT_IDENTITY
seq 11  agent_turn_done         origin=pending_prompt_drain →  INSUFFICIENT_IDENTITY
seq 12  submit_and_exit_seen    origin=pending_prompt_drain →  INSUFFICIENT_IDENTITY (no submitId)
seq 13  task_completion_committed origin=pending_prompt_drain →  INSUFFICIENT_IDENTITY (no completionId)
```

**FIRST_DIVERGENCE_SEQ = 1**
**FIRST_DIVERGENCE_STAGE = run_turn_started**
**FIRST_DIVERGENCE_KIND = INSUFFICIENT_IDENTITY** (precedence #2)

### R2 (SYNTHETIC_REAL held-terminal)

12 events. Same schema gap. First divergence at seq=1
`terminal_committed` (no ownerId).

**FIRST_DIVERGENCE_SEQ = 1**
**FIRST_DIVERGENCE_STAGE = terminal_committed**
**FIRST_DIVERGENCE_KIND = INSUFFICIENT_IDENTITY**

### R3 (REAL continuation subsequence of R1)

Schema gap identical to R1.

**FIRST_DIVERGENCE_SEQ = 1**
**FIRST_DIVERGENCE_STAGE = run_turn_started**
**FIRST_DIVERGENCE_KIND = INSUFFICIENT_IDENTITY**

### R4 (REAL decisive stall)

REAL trace: 158 events. Cardinality matches the predecessor ACT's
stall fingerprint (terminal_committed=147, run_turn_started=3,
agent_turn_done=2, submit_and_exit_seen=2,
task_completion_committed=1, pending_prompt_enqueued=1,
pending_prompt_dequeued=1, continuation_scheduled=1).

```
seq  1  run_turn_started       origin=explicit_user sessionId=…_34re2 →  INSUFFICIENT_IDENTITY (no runId)
seq 20  submit_and_exit_seen   origin=pending_prompt_drain sessionId=…_34re2 taskId=… → INSUFFICIENT_IDENTITY (no submitId)
seq 21  task_completion_committed origin=pending_prompt_drain → INSUFFICIENT_IDENTITY (no completionId)
seq 22  agent_turn_done        origin=explicit_user → INSUFFICIENT_IDENTITY (no runId)
seq 23  run_turn_started       origin=explicit_user sessionId=…_8mrnl → INSUFFICIENT_IDENTITY (no runId)
... (147 terminal_committed events with no ownerId) ...
seq 153 submit_and_exit_seen   origin=pending_prompt_drain sessionId=…_8mrnl taskId=… → INSUFFICIENT_IDENTITY (no submitId)
seq 154 pending_prompt_enqueued origin=pending_prompt_drain sessionId=…_8mrnl promptId=… → DIRECT
seq 155 agent_turn_done        origin=explicit_user sessionId=…_8mrnl → INSUFFICIENT_IDENTITY (no runId)
seq 156 pending_prompt_dequeued origin=pending_prompt_drain sessionId=…_8mrnl promptId=… → DIRECT
seq 157 continuation_scheduled  origin=pending_prompt_drain sessionId=…_8mrnl promptId=… → DIRECT
seq 158 run_turn_started       origin=explicit_user sessionId=…_8mrnl → INSUFFICIENT_IDENTITY (no runId)
```

**FIRST_DIVERGENCE_SEQ = 1**
**FIRST_DIVERGENCE_STAGE = run_turn_started**
**FIRST_DIVERGENCE_KIND = INSUFFICIENT_IDENTITY**

## Per-§40 questions (CORRECTION01)

- **Q1**: Does a known-good production completion replay legally?
  **NO** (INSUFFICIENT_IDENTITY at seq=1 run_turn_started).
- **Q2**: Does REAL distinguish terminal availability from consumption?
  **UNAVAILABLE_FROM_TRACE** (R2 SYNTHETIC_REAL captures terminal_committed → notify_consume_enter → wake_created; Elm collapses both into ObservationConsumed).
- **Q3**: Can existing trace identity correlate continuation prompt → continuation run?
  **NO** (prompt has promptId; continuation run has no runId).
- **Q4**: Does AgentTurnDone consume the same logical continuation?
  **UNAVAILABLE_FROM_TRACE** (agent_turn_done has no runId).
- **Q5**: At each submit_and_exit, what does Elm say holds completion?
  **UNAVAILABLE_FROM_TRACE** (submitId missing).
- **Q6**: Does TS commit only when Elm says completion is authorized?
  **UNAVAILABLE_FROM_TRACE** (TS commits at R4 seq 21; Elm cannot receive).
- **Q7**: Does the known stall sequence become invalid in Elm, and at which first event?
  **YES, INSUFFICIENT_IDENTITY at seq=1; entire sequence blocked by schema gap.**
- **Q8**: Is pending_prompt_drain vs explicit_user a real provenance mismatch?
  **NO — PROVENANCE_PRESERVED.**
- **Q9**: Does ExecuteTurnPreludeEnter add a new discriminator where available?
  **UNAVAILABLE_FROM_TRACE.**
- **Q10**: Is the Elm kernel faithful enough to justify live SHADOW02 wiring?
  **NO** — the schema gap blocks SHADOW02 live wiring on every run/agent/submit/commit/terminal event.

## Verdict

**VERDICT = CAPTURE_INSUFFICIENT**
**FIRST_BLOCKED_SEQ = 1**
**FIRST_BLOCKED_STAGE = run_turn_started**
**MISSING_FACT = runId / submitId / completionId / ownerId / task_started event / terminalKind / continuation_started {promptId, runId}**
**MISSING_IDENTITY = runId (highest priority; blocks ALL run/agent events)**
**READY_FOR_ELM_SHADOW02 = false**

## Successor capture contract (expanded per CORRECTION01 reviewer)

The successor ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01
must capture at minimum the following fields per stage:

```
task_started                          { taskId }
run_turn_started                      { runId }
agent_turn_done                       { runId }
execute_turn_prelude_enter            { runId }
continuation_started                  { promptId, runId }   # or equivalent proven
                                                            # seam correlating prompt to run
terminal_committed                    { jobId, ownerId, terminalKind }
                                       # terminalKind in { "owned", "background_not_owned" }
submit_and_exit_seen                  { submitId }
task_completion_committed             { completionId }
```

Equivalent equivalences (e.g. `taskId == ownerId`,
`sessionId == taskId`) may be used IF and only IF a proven production
invariant exists and is documented; do not derive them otherwise.

**NOT opened in this ACT.**
