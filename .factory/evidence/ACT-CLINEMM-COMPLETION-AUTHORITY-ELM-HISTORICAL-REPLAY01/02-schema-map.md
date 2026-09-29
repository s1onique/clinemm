# 02 — Schema Map: REAL Trace ↔ Elm Codec

The Elm `Codec.elm` defines the JSON wire contract. Each inbound tag
must decode via `Codec.decodeMsgFromTag`. The decoder is FROZEN.

## Per-stage field schema

The following table enumerates the JSON fields ACTUALLY PRESENT in the
frozen REAL traces for each stage. Compared with the Elm decoder
requirements, every "missing" field is a *direct* `INSUFFICIENT_IDENTITY`
finding for that event (per §9).

### `run_turn_started`

REAL (all three sources):
```
{ "seq", "at", "stage", "origin", "sessionId" }
{ "seq", "at", "stage", "origin", "sessionId", "taskId", "jobId" }   (presentation-surface + terminal-arbitration)
```

Elm decoder requires:
```
Decode.field "runId" (Decode.map RunRef Decode.string)
Decode.field "origin"  (mapped via tagToOrigin)
```

| Field | REAL? | Elm required? | Identity status |
|-------|-------|---------------|------------------|
| `runId` | **NOT in any REAL trace** | YES | `UNAVAILABLE` |
| `origin` | yes | yes | DIRECT |
| `taskId` | yes (some traces) | no | UNUSED |
| `sessionId` | yes | no | UNUSED |

**`runId` is missing in EVERY REAL instance of `run_turn_started`.**

### `agent_turn_done`

REAL fields:
```
{ "seq", "at", "stage", "origin", "sessionId" }
{ "seq", "at", "stage", "origin", "sessionId", "taskId", "jobId" }   (presentation-surface + terminal-arbitration)
```

Elm decoder requires:
```
Decode.field "runId" (Decode.map RunRef Decode.string)
```

| Field | REAL? | Elm required? | Identity status |
|-------|-------|---------------|------------------|
| `runId` | **NOT in any REAL trace** | YES | `UNAVAILABLE` |

**`runId` is missing in EVERY REAL instance of `agent_turn_done`.**

### `terminal_registered` (Elm) vs `terminal_committed` (REAL)

REAL stage is `terminal_committed`, NOT `terminal_registered`. The REAL
events have fields:
```
{ "seq", "at", "stage", "origin", "jobId" }
{ "seq", "at", "stage", "origin", "sessionId", "taskId", "jobId" }  (presentation-surface + terminal-arbitration)
```

The Elm decoder for `terminal_registered` requires:
```
Decode.field "jobId"  (Decode.map JobRef Decode.string)
Decode.field "ownerId" (Decode.map OwnerRef Decode.string)
Decode.field "kind"   (mapped via kindFromTag, accepts only "owned" or "background_not_owned")
```

| Field | REAL? | Elm required? | Identity status |
|-------|-------|---------------|------------------|
| `jobId` | yes | yes | DIRECT |
| `ownerId` | NO | yes | `UNAVAILABLE` |
| `kind` (Elm expects "owned"/"background_not_owned") | REAL `origin` is `"background_terminal"`; not a `kind` enum value | yes | **unmappable** (no "owned" / "background_not_owned" in REAL `origin`) |

**`ownerId` is missing in EVERY REAL `terminal_committed`.**
**The Elm `kind` enum cannot be derived from the REAL `origin` field** —
the REAL `origin` values are `background_terminal`, `pending_prompt_drain`,
`explicit_user`, etc. None of these are Elm `kind` enum values.

### `terminal_observed` (Elm)

REAL stage that *might* correspond: `notify_consume_enter` and
`wake_created` (both with `background_terminal` origin and same `jobId`).

REAL fields:
```
notify_consume_enter: { seq, at, stage, origin, sessionId, taskId, jobId }
wake_created:         { seq, at, stage, origin, sessionId, taskId, jobId }
```

Elm decoder for `terminal_observed` requires:
```
Decode.field "jobId" (Decode.map JobRef Decode.string)
```

| Field | REAL? | Elm required? | Identity status |
|-------|-------|---------------|------------------|
| `jobId` | yes | yes | DIRECT |

**`terminal_observed` is mappable IF the stage is renamed from
`notify_consume_enter`/`wake_created`. This is a stage-rename necessity
finding (see §11 / R2 analysis).**

### `pending_prompt_enqueued`

REAL fields:
```
{ seq, at, stage, origin, sessionId, promptId }              (stall02)
{ seq, at, stage, origin, sessionId, taskId, jobId, promptId }  (others)
```

Elm decoder requires:
```
Decode.field "promptId" (Decode.map PromptRef Decode.string)
Decode.field "origin"   (mapped via tagToPromptOrigin)
```

| Field | REAL? | Elm required? | Identity status |
|-------|-------|---------------|------------------|
| `promptId` | yes | yes | DIRECT |
| `origin` | yes | yes | DIRECT |

**`pending_prompt_enqueued` is fully mappable.**

### `pending_prompt_dequeued`

REAL fields: same as `pending_prompt_enqueued`.

Elm decoder requires:
```
Decode.field "promptId" (Decode.map PromptRef Decode.string)
```

**`pending_prompt_dequeued` is fully mappable.**

### `continuation_scheduled`

REAL fields: same as `pending_prompt_enqueued`.

Elm decoder requires:
```
Decode.field "promptId" (Decode.map PromptRef Decode.string)
```

**`continuation_scheduled` is fully mappable.**

### `submit_and_exit_seen`

REAL fields:
```
{ seq, at, stage, origin, sessionId, taskId }                  (stall02)
{ seq, at, stage, origin, sessionId, taskId }                  (presentation-surface)
```

Elm decoder requires:
```
Decode.field "submitId" (Decode.map SubmitRef Decode.string)
```

| Field | REAL? | Elm required? | Identity status |
|-------|-------|---------------|------------------|
| `submitId` | **NOT in any REAL trace** | YES | `UNAVAILABLE` |
| `taskId` | yes | no | UNUSED |

**`submitId` is missing in EVERY REAL `submit_and_exit_seen`.**

### `task_completion_committed`

REAL fields: same as `submit_and_exit_seen`.

Elm decoder requires:
```
Decode.field "completionId" (Decode.map CompletionRef Decode.string)
```

| Field | REAL? | Elm required? | Identity status |
|-------|-------|---------------|------------------|
| `completionId` | **NOT in any REAL trace** | YES | `UNAVAILABLE` |
| `taskId` | yes | no | UNUSED |

**`completionId` is missing in EVERY REAL `task_completion_committed`.**

### `completion_presented` (Elm)

No REAL events have this stage. Identity not probed.

### `task_cancelled` (Elm)

No REAL events have this stage. Identity not probed.

### `execute_turn_prelude_enter` (Elm)

No REAL events have this stage (the predecessor ACT added the seam for
the future operator live run; not present in current data).
`PRELUDE_EVIDENCE=UNAVAILABLE_FROM_TRACE`.

### `task_started` (Elm)

No REAL events have this stage. The Elm kernel starts in
`Idle = TaskState` and requires a `task_started` event before
`submit_and_exit_seen` is interpretable as "completion of a task".
`TASK_STARTED_EVIDENCE=UNAVAILABLE_FROM_TRACE`.

## Summary

The identity gap is *structural*, not a single missing field. The
frozen REAL `clineMessages`-style traces do not carry:

- `runId` (so `RunRef` cannot be derived)
- `ownerId` (so `OwnerRef` cannot be derived for terminal events)
- `submitId` (so `SubmitRef` cannot be derived)
- `completionId` (so `CompletionRef` cannot be derived)
- a `kind` enum for terminals (REAL `origin` is not Elm-shaped)

What IS available and directly mappable:
- `sessionId` (→ could be `TaskRef`; **NOT used**)
- `taskId` (→ could be `TaskRef`; **NOT used**)
- `jobId` (→ `JobRef`; mappable)
- `promptId` (→ `PromptRef`; mappable)
- `origin` (→ `RunOrigin` / `PromptOrigin`; mappable)
