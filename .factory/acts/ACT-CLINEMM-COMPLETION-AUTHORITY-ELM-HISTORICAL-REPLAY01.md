# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01

> Status: **PASS_KERNEL_EXECUTABLE_GREEN / PASS_REPLAY_WITH_CAPTURE_INSUFFICIENT**

> Mission: replay frozen REAL ClineMM completion/continuation traces
> through the now-executable Elm shadow kernel, find the first
> semantic divergence, and stop before any production integration
> or repair. The predecessor ACT proved the kernel is executable;
> this ACT proves the kernel faithfully models historical production
> behavior — or, where it cannot, classifies the gap.

```text
ENTRY_HEAD                 = a1d8e03e5fc206e4beef1c680e75f984e6421ed2
SUBJECT_HEAD               = <git rev-parse HEAD at ACT closure>
CLOSURE_HEAD               = <git rev-parse HEAD at ACT closure>
PRE_ENTRY_TREE_STATE       = clean (only predecessor evidence)
POST_SUBJECT_TREE_STATE    = tracked replay adapter (4 files) + test (1 file) + ACT evidence (12 files)
ELM_BUILD                  = PASS (sha=40aeeb28fefcf49c4b9efae4a917e8076a9af3ebbc8caff67c1082c954d39168)
ELM_TEST                   = 20/20 PASS (--report=json; duration 138ms; 0 failed)
ELM_SMOKE                  = PASS
ELM_KERNEL_FIRST_DIVERGENCE = INSUFFICIENT_IDENTITY @ seq=1 run_turn_started (R1/R3/R4); terminal_committed (R2)
VERDICT                    = CAPTURE_INSUFFICIENT
READY_FOR_ELM_SHADOW02     = false
```

## Central finding

The Elm completion-authority kernel cannot consume ANY of the 183
REAL frozen historical events because the REAL trace schema does
not carry the Elm-required identities (`runId`, `submitId`,
`completionId`, `ownerId`). Only the 3 prompt-stage events
(`pending_prompt_enqueued`, `pending_prompt_dequeued`,
`continuation_scheduled`) decode because they require only
`promptId`, which IS present in REAL.

The first semantic divergence is `INSUFFICIENT_IDENTITY` (precedence
#2 in §19) at the FIRST event of every replay:
- R1 control: `run_turn_started` @ seq=1
- R2 held-terminal: `terminal_committed` @ seq=1
- R3 continuation: `run_turn_started` @ seq=1
- R4 known stall: `run_turn_started` @ seq=1

This is NOT a kernel rejection (precedence #3). The Elm model has
not yet had the chance to accept or reject the transition because
the required identity to evaluate it is missing from the REAL
record.

## What this ACT did

1. **Re-proved the predecessor executable gate** — build PASS, test
   20/20 PASS, smoke PASS. The kernel is intact at SHA
   `7f7e74bcbb51c5bddb5f65610e04773e82c25c2d`.
2. **Established exact trace schema** (REAL, 4 evidence files,
   sha256-preserved) — see `02-schema-map.md` and
   `source-sha256.before` / `.after`.
3. **Built a lossless factual adapter** (`completion-authority-elm-replay.ts`)
   that maps REAL records to Elm Msg candidates WITHOUT manufacturing
   identity (AR-06 enforced), WITHOUT rewriting origin (AR-05
   enforced), and WITHOUT deriving ID from chronology.
4. **Built an offline replay driver** (`completion-authority-elm-replay.kernel.ts`)
   that loads the COMPILED `vendor/completion-authority.js` and drives
   it through JS interop.
5. **Built adapter self-invariants** (`completion-authority-elm-replay.invariants.ts`,
   AR-01..AR-06).
6. **Wrote 18 vitest tests** covering HR-01..HR-08 + 8 adapter
   self-invariants; 18/18 PASS.
7. **Wrote per-replay JSON outputs** for R1, R2, R3, R4.
8. **Wrote discriminator analysis** (`09-discriminator.md`).
9. **Wrote counter-conservation report** (`08-counter-conservation.md`).
10. **Wrote final report** (`10-final-report.md`) + `result.json`.

## What this ACT did NOT do (per §31)

- No edit to Authority.elm / Domain.elm / Codec.elm / Main.elm.
- No edit to runtime TS (LocalRuntimeHost, PendingPromptsController,
  SdkSessionEventCoordinator, command-status-tool).
- No edit to BCB / C10 / PCCA / CCARD.
- No edit to MCP / myc / React/webview.
- No edit to completion-presentation logic.
- No origin rewrite.
- No ID manufacturing.
- No diagnostic profile, no config flag, no extension activation,
  no runtime event feed wiring.
- No live integration of real KERNEL into production path.

Verified at §30: 0 production references to the replay adapter or
the compiled kernel JS.

## Per-§40 answers

| # | Answer |
|---|--------|
| Q1 | NO — INSUFFICIENT_IDENTITY at seq=1 run_turn_started. |
| Q2 | UNAVAILABLE_FROM_TRACE — REAL captures only terminal_committed → notify_consume_enter → wake_created; Elm collapses both observation stages into ObservationConsumed. |
| Q3 | NO — continuation prompt has promptId but the continuation run has no runId. |
| Q4 | UNAVAAILABLE_FROM_TRACE — agent_turn_done has no runId, cannot correlate to any prompt. |
| Q5 | UNAVAILABLE_FROM_TRACE — submitId missing on submit_and_exit_seen. |
| Q6 | UNAVAILABLE_FROM_TRACE — TS commits at R4 seq 21 (pre-agent_turn_done), but Elm cannot receive these events. |
| Q7 | YES — INSUFFICIENT_IDENTITY at seq=1; entire stall sequence blocked by schema gap. |
| Q8 | NO — PROVENANCE_PRESERVED. Prompt=pending_prompt_drain, run=explicit_user; this is the natural continuation semantic, not a contradiction. |
| Q9 | UNAVAILABLE_FROM_TRACE — no frozen REAL events of execute_turn_prelude_enter; the seam was added by the predecessor ACT for the next live run. |
| Q10 | NO — schema gap blocks SHADOW02 live wiring on every run_turn_started / submit_and_exit_seen / task_completion_committed / terminal_committed event. |

## Verdict tree match

Per §39 verdict tree:

**D. Identity insufficient**
```
VERDICT     = CAPTURE_INSUFFICIENT
MISSING_FACT= runId / submitId / completionId / ownerId
            (these IDs are required by the Elm kernel but absent
             from the REAL frozen trace schema)
MISSING_IDENTITY = runId (highest priority; blocks ALL
                       run_turn_started + agent_turn_done events)
FIRST_BLOCKED_SEQ = 1
FIRST_BLOCKED_STAGE = run_turn_started
READY_FOR_ELM_SHADOW02 = false
```

## Successor proposal (NOT opened here)

`ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01` — extend
the existing `continuation-cardinality-authority` capture seam to
emit the four missing identities:
- `runId` (correlate with `promptId` for continuations)
- `submitId` (correlate with the submit-and-exit moment)
- `completionId` (correlate with the commit moment)
- `ownerId` (correlate with the owning session/task)

Then replay with the same adapter (no model changes) to confirm the
schema gap closes. After that, re-evaluate whether the kernel
faithfully reproduces the historical stall.

## Architecture verdict

**The Elm kernel's closed identity tag set is MORE RIGOROUS than
the REAL capture schema.** This is the inverse of the conventional
"model is too coarse" finding. The Elm kernel would reject any
hypothetical repair that synthesizes these IDs from chronology
(AR-06 explicit). The only legitimate path forward is to extend
the REAL capture seam to actually emit the missing identity
fields.

The Elm kernel itself is NOT too coarse; if the REAL trace
included the identities, the kernel could faithfully reproduce
every historical semantic effect. The model is
**READY_FOR_MODEL_DEEPER_THAN_TRACE**, not the reverse.

## Files

- `apps/vscode/src/sdk/completion-authority-elm-replay.ts`
- `apps/vscode/src/sdk/completion-authority-elm-replay.kernel.ts`
- `apps/vscode/src/sdk/completion-authority-elm-replay.invariants.ts`
- `apps/vscode/src/sdk/__tests__/completion-authority-elm-historical-replay01.test.ts`
- `.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/{00..10}*.{txt,md,json}`
- `.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/source-sha256.{before,after}`

## Verdict

PASS_REPLAY_WITH_CAPTURE_INSUFFICIENT.
