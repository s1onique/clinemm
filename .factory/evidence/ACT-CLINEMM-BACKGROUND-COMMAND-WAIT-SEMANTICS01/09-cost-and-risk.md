# 09 — Cost and risk (qualitative)

Per ACT rubric — record qualitative cost categories. No fake
numerical scores.

## 9.1 Cost categories

```text
- model calls
- token consumption
- latency
- session complexity
- restart persistence
- unexpected notifications
- multi-job behavior
- cross-turn interference
- user surprise
- failure reporting
```

## 9.2 Per-candidate qualitative cost

### Candidate A — model polling only

```text
- model calls: HIGH under long waits (one call per poll interval).
- token consumption: HIGH (each poll re-sends full message context).
- latency: BLOCKED by model cadence (no async resume).
- session complexity: LOW (current implementation).
- restart persistence: N/A (no durable obligation).
- unexpected notifications: NONE (good).
- multi-job: trivially handled (each job has its own jobId).
- cross-turn: clean (no resurrection).
- user surprise: HIGH (the LIVE specimen — user asks "wait
  until finished", model stops polling, user gets nothing).
- failure reporting: same as today (tool-side error).
```

### Candidate B — opt-in notify-on-terminal

```text
- model calls: ONE additional call per notify=true job (the wake).
- token consumption: ONE additional context per wake (the wake prompt).
- latency: ZERO while waiting (no resume); bounded for the wake
  itself (model call latency after terminal).
- session complexity: MEDIUM (new schema field, new wake consumer,
  identity-bound, exactly-once rule).
- restart persistence: OPTIONAL for v1 (can be ephemeral; see §12).
- unexpected notifications: NONE when notify=false; ONE per
  notify=true job when notify=true.
- multi-job: TRIVIAL (each job has its own wake; conservation rules
  apply).
- cross-turn: HANDLED via delivery:"queue" or "steer" in the
  existing PendingPromptsController.
- user surprise: LOW (the wake is explicit; the prompt says "your
  background command X finished").
- failure reporting: covers all exit reasons (exited, deadline,
  cancelled, spawn_failed, containment_failed) via the terminal
  payload.
```

### Candidate C — explicit await-terminal

```text
- model calls: ZERO additional (suspended tool call resumes the
  existing turn).
- token consumption: ZERO additional (same turn continues).
- latency: ZERO while waiting; tool-result continuation seam.
- session complexity: HIGH (new suspended-tool state machine,
  restart-survival, new tool-result continuation).
- restart persistence: REQUIRED (suspension must survive restarts).
- unexpected notifications: NONE (turn never yields).
- multi-job: COMPLEX (per-job suspension; concurrency model).
- cross-turn: NEEDS RULE (what if a new user turn arrives during
  suspension? supersede? queue? abort?).
- user surprise: LOW (the strongest match for "wait until finished").
- failure reporting: covers all exit reasons via the tool result.
```

### Candidate D — explicit multi-mode

```text
- model calls: per mode (similar to B for notify, similar to C for
  wait, none for detach).
- token consumption: per mode.
- latency: per mode.
- session complexity: HIGHEST (union of B + C plus schema enum).
- restart persistence: REQUIRED for the "wait" mode.
- unexpected notifications: per mode.
- multi-job: COMPLEX (per-mode per-job).
- cross-turn: COMPLEX (per-mode rules).
- user surprise: LOW (every intent is explicit).
- failure reporting: per mode.
```

## 9.3 Risk categories

```text
RISK_CATEGORY         A         B            C          D
runtime defect        LOW       MEDIUM       HIGH       HIGH
product contract drift HIGH      LOW          LOW        LOW
schema breakage       NONE      LOW          LOW        MEDIUM
session corruption    LOW       LOW          HIGH       HIGH
restart regression    NONE      LOW          HIGH       HIGH
multi-job bug         LOW       LOW          HIGH       HIGH
notification storm    N/A       MEDIUM       N/A        MEDIUM
```

## 9.4 What this means for the contract decision

Candidate B has the best cost/risk profile among the four:

- Per-wake cost is bounded and explicit.
- Per-wake count is bounded by the user's opt-in.
- Failure modes are reportable through the existing terminal-event
  pipeline.
- The existing session identity machinery handles multi-job and
  cross-turn cases.
- Restart regression is OPTIONAL for v1 (ephemeral-only is
  acceptable for the initial implementation; persistence can be
  added in a later cycle).

Candidate A has the lowest implementation cost but the highest
"user surprise" cost — the user-visible promise does not match
the runtime behavior.

Candidate C/D have higher runtime complexity and restart-survival
risk that is not justified by the user-visible benefit.

**Decision implication**: the cost/risk analysis confirms the
rubric verdict (§7.5). Candidate B is the correct contract for v1.
