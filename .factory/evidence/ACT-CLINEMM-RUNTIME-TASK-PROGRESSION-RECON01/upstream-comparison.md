# Upstream comparison — RADAR only

> Status: **SCAFFOLD ONLY — NOT YET POPULATED**. Upstream issues are
> **RADAR comparators** for this recon; they are **not causal proof**
> for ClineMM and do not by themselves establish a defect.

## Radar comparators (cluster `RUNTIME_THINKING_STALL` + adjacents)

| Upstream | Headline | Local canonical boundary | Same violated invariant? | Verdict |
|---|---|---|---|---|
| [#10537](https://github.com/cline/cline/issues/10537) | terminal-output then Thinking stall | (capture from recon) | yes/no/unverified | RADAR |
| [#12079](https://github.com/cline/cline/issues/12079) | command executes then "skipped" then Thinking stall | (capture from recon) | yes/no/unverified | RADAR |
| [#12827](https://github.com/cline/cline/issues/12827) | skipped tool call leaves UI indefinitely Thinking | (capture from recon) | yes/no/unverified | RADAR |
| [#10122](https://github.com/cline/cline/issues/10122) | stall + abort unavailable (mirrors our Cancel symptom) | (capture from recon) | yes/no/unverified | RADAR |
| [#12396](https://github.com/cline/cline/discussions/12396) | Resume Task fails after a stall | (capture from recon) | yes/no/unverified | RADAR |
| [#7898](https://github.com/cline/cline/issues/7898) | command succeeds but agent can't validate response (CLI path) | `TOOL_RESULT_TERMINAL_SEAM` for `command` tools returning empty/silent success | yes/no/unverified — **PROMOTED to RADAR for cluster `BACKGROUND_COMMAND_LIVENESS`** at TRIAGE_BIND 2026-08-28; same family as the new specimen but on a different tool path | RADAR (BACKGROUND_COMMAND_LIVENESS cluster) |
| [#10235](https://github.com/cline/cline/issues/10235) | command marked Skipped while still thinking | `TOOL_RESULT_TERMINAL_SEAM` ↔ `TASK_OWNER_SEAM` (Skipped projection misfires while agent is still active) | yes/no/unverified — **PROMOTED to RADAR for cluster `BACKGROUND_COMMAND_LIVENESS`**; same ownership-projection seam as the new specimen | RADAR (BACKGROUND_COMMAND_LIVENESS cluster) |

## Architectural reference (NOT a radar / NOT an import)

```text
Upstream background-terminal.ts (cline/sdk/examples/plugins/background-terminal.ts)
  Pattern observed:
    notifyParent = true
      -> on child exit: emit steer_message(sessionId, completion summary)
      -> session infrastructure wakes up and the bg-job completion is treated
         as a continuation stimulus for the owning agent

  ClineMM analogue (current source at HEAD 15f2adaf6):
    onBackgroundStateChange(running, jobId) wired at
      apps/vscode/src/sdk/SdkController.ts:987
    -> updates the projection (TaskHeader / composer) ONLY
    -> the structural absence of a paired wakeup semantics in this code path
       is supported by ACL02 (STRUCTURAL ABSENT on the c2-4-c bridge);
       on the live specimen cmd_mtcjhkhygpteq8v9 the terminal-state
       chronology is UNOBSERVED — see live-failure.json:scope_notes.
       (Historical product-contract record:
        HOST_DEFERRED_FOREGROUND_OWNERSHIP_CONTRACT = UNDEFINED.)

  Verdict: this upstream pattern informs the candidate contract
  OWNED/AWAITED vs DETACHED in live-failure.json:open_product_questions_recorded.
  It is NOT an import. Import requires all three of the promotion rule below.
```

## Promotion rule

Promote a radar to IMPORT only when ALL three hold:

```text
same production boundary
same violated invariant
same required fix contract
```

If even one of these is missing, the issue stays RADAR with a clear
re-promotion path. Do NOT speculate mapping at this stage.

## Source of canonical triage

`.factory/upstream/cline-upstream-triage.md` (Correction-04 already
explicitly proposed this epic; this ACT executes the proposal with
RECON + exact live RED rather than re-triage).
