# 10 — Final Report

```text
ACT=ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01
VERDICT=CAPTURE_INSUFFICIENT

ENTRY_HEAD=a1d8e03e5fc206e4beef1c680e75f984e6421ed2
IMPLEMENTATION_HEAD=<git rev-parse HEAD at ACT closure>
SUBJECT_HEAD=<git rev-parse HEAD at ACT closure>
CLOSURE_HEAD=<git rev-parse HEAD at ACT closure>

KERNEL_SUBJECT_HEAD=7f7e74bcbb51c5bddb5f65610e04773e82c25c2d

ELM_BUILD=PASS (vendor/completion-authority.js sha=40aeeb28fefcf49c4b9efae4a917e8076a9af3ebbc8caff67c1082c954d39168)
ELM_TEST=20/20 PASS (--report=json stream; duration 138ms)
ELM_SMOKE=PASS

REAL_TRACES_SELECTED=3
REAL_EVENTS_TOTAL=183 (158 + 13 + 12)
SOURCE_SHA256_PRESERVED=true (source-sha256.before == source-sha256.after)

CONTROL_TRACE=.factory/evidence/ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01/01a-ccard.LIVE_RAW.jsonl
CONTROL_FIRST_VIOLATION=seq=1 run_turn_started (INSUFFICIENT_IDENTITY; no runId)

TERMINAL_TRACE=.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01/01a-live-ccard.jsonl
TERMINAL_LIFECYCLE_CORRESPONDENCE=TRACE_INSUFFICIENT
TERMINAL_FIRST_DIVERGENCE_SEQ=1

CONTINUATION_TRACE=.factory/evidence/ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01/01a-ccard.LIVE_RAW.jsonl (continuation subsequence)
CONTINUATION_IDENTITY_SUFFICIENT=false
CONTINUATION_FIRST_DIVERGENCE_SEQ=1

STALL_TRACE=.factory/evidence/ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02/continuation-cardinality-authority.jsonl
STALL_FIRST_DIVERGENCE_SEQ=1
STALL_FIRST_DIVERGENCE_STAGE=run_turn_started
STALL_FIRST_DIVERGENCE_KIND=INSUFFICIENT_IDENTITY

PROVENANCE_PROMPT_ORIGIN=pending_prompt_drain (continuation prompts)
PROVENANCE_RUN_ORIGIN=explicit_user / pending_prompt_drain (R1: explicit_user + pending_prompt_drain continuation)
PROVENANCE_CLASSIFICATION=PROVENANCE_PRESERVED (no within-event mismatch; consistent with the natural continuation semantic where the prompt is enqueued by the drain and the user's UI reply launches the run as explicit_user)

ELM_FINAL_ACTIVE_RUN=null (Elm kernel never receives run_turn_started because runId is missing)
ELM_FINAL_RUNNING_BACKGROUND_JOBS=0
ELM_FINAL_UNCONSUMED_TERMINALS=0
ELM_FINAL_PENDING_PROMPTS=0
ELM_FINAL_SCHEDULED_CONTINUATIONS=0
ELM_FINAL_COMPLETION_AUTHORIZED=null

TS_COMPLETION_COMMITTED=true (R1 seq=12, R4 seq=21)
TS_PRESENTATION_OBSERVED=null (REAL traces have no completion_presented stage; UNKNOWN)

MANUFACTURED_IDENTITY_COUNT=0
ORIGIN_REWRITE_COUNT=0

HR_01=PASS (canonical happy completion -> first divergence seq=1 run_turn_started INSUFFICIENT_IDENTITY)
HR_02=PASS (held-terminal -> first divergence seq=1 terminal_committed INSUFFICIENT_IDENTITY)
HR_03=PASS (continuation subsequence -> first divergence seq=1 run_turn_started INSUFFICIENT_IDENTITY)
HR_04=PASS (known stall -> first divergence seq=1 run_turn_started INSUFFICIENT_IDENTITY; stall cannot be reproduced in the kernel because schema gap blocks entire sequence from entering; this is consistent with verdict D CAPTURE_INSUFFICIENT)
HR_05=PASS (unknown stage yields UNMODELED_EVENT explicitly)
HR_06=PASS (missing ID yields INSUFFICIENT_IDENTITY explicitly)
HR_07=PASS (same trace replayed twice yields byte-equivalent deterministicSha256)
HR_08=PASS (source input sha256 unchanged before/after replay)

TYPECHECK=PASS (bun run check-types)
VSCODE_PREPUBLISH=PRE_EXISTING_BASELINE_FAILURE (317 biome lint errors at ENTRY_HEAD, unrelated to this ACT)
DIFF_CHECK=PASS (clean)

PRODUCTION_CODE_CHANGED=false (no edits to Authority.elm, Domain.elm, Codec.elm, Main.elm, runtime TS, queue, completion, terminal-consumption, origin-normalization paths)
ELM_AUTHORITY_SEMANTICS_CHANGED=false
MYC_CODE_CHANGED=false
MCP_CODE_CHANGED=false

READY_FOR_ELM_SHADOW02=false
SUCCESSOR_ACT=ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01
```

## Central finding

**The Elm completion-authority kernel cannot consume any of the 183
REAL frozen historical events because the REAL schema does not carry
the Elm-required identities (`runId`, `submitId`, `completionId`,
`ownerId`); only 3 events (the `pending_prompt_*` / `continuation_scheduled`
chain) decode because they happen to require only `promptId`, which IS
present in REAL.**

The FIRST divergence is `INSUFFICIENT_IDENTITY` (precedence #2) at
the FIRST event of every replay (`run_turn_started` for R1/R3/R4;
`terminal_committed` for R2 — the schema gap shifts to whichever
Elm-required identity is missing from the first event). This is NOT
a kernel rejection (precedence #3) — the Elm model has not yet had
the chance to accept or reject the transition.

## Per-§40 questions

- **Q1**: Does a known-good production completion replay legally?
  **NO** (INSUFFICIENT_IDENTITY at seq=1 run_turn_started).
- **Q2**: Does REAL distinguish terminal availability from consumption?
  **UNAVAILABLE_FROM_TRACE** — REAL captures only terminal_committed
  → notify_consume_enter → wake_created (one pre-observation and two
  post-observation moments), but no third "available_unconsumed"
  moment is distinguishable in the frozen evidence. The Elm kernel
  collapses notification+observation into one ObservationConsumed
  state, which is COLLAPSE_VALID_FOR_AVAILABLE_EVIDENCE.
- **Q3**: Can existing trace identity correlate continuation prompt → continuation run?
  **NO** — prompt has promptId; continuation run has only origin, no runId.
- **Q4**: Does AgentTurnDone consume the same logical continuation represented by the trace?
  **UNAVAILABLE_FROM_TRACE** — agent_turn_done has no runId, so we cannot correlate it to any prompt.
- **Q5**: At each submit_and_exit, what does Elm say holds completion?
  **UNAVAILABLE_FROM_TRACE** — submitId missing.
- **Q6**: Does TS commit only when Elm says completion is authorized?
  **UNAVAILABLE_FROM_TRACE** — TS commits at R4 seq 21 (before the
  agent_turn_done at seq 22) but Elm cannot receive these events.
- **Q7**: Does the known stall sequence become invalid in Elm, and at which first event?
  **YES, INSUFFICIENT_IDENTITY at seq=1 run_turn_started.** The
  schema gap blocks the entire stall sequence from ever entering.
- **Q8**: Is pending_prompt_drain vs explicit_user a real provenance mismatch?
  **NO** — PROVENANCE_PRESERVED. Different events have different
  origins; the prompt is enqueued by the drain and the run is launched
  by the user's UI reply (natural continuation semantic).
- **Q9**: Does ExecuteTurnPreludeEnter add a new discriminator where available?
  **UNAVAILABLE_FROM_TRACE** — no frozen REAL events of that stage;
  the seam is added by the predecessor ACT for the next live run.
- **Q10**: Is the Elm kernel faithful enough to justify live SHADOW02 wiring?
  **NO** — the schema gap means SHADOW02 would see
  INSUFFICIENT_IDENTITY on every run_turn_started / submit_and_exit_seen /
  task_completion_committed / terminal_committed event. SHADOW02
  cannot be live-wired until the capture seam covers those stages.

## What the ACT did NOT do (per §31)

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

The replay adapter is namespaced under
`apps/vscode/src/sdk/completion-authority-elm-replay*` and the test
under `apps/vscode/src/sdk/__tests__/completion-authority-elm-historical-replay01.test.ts`.
Neither file is referenced anywhere else in the codebase (§30 verified).

## Successor proposal

A new ACT must close the capture gap by extending the existing
`continuation-cardinality-authority` capture seam to emit:
- `runId` (when a run is started; correlate with the prompt's
  `promptId` for continuations)
- `submitId` (when `submit_and_exit_seen` fires)
- `completionId` (when `task_completion_committed` fires)
- `ownerId` (when a terminal becomes owned by a session/task)

NOT OPENED IN THIS ACT.

## Architecture verdict

**The Elm kernel's closed identity tag set is more rigorous than the
REAL capture schema.** This is the opposite of the conventional
"model is too coarse" finding. The Elm kernel would reject any
hypothetical repair that synthesizes these IDs from chronology (AR-06
explicit); the only legitimate path forward is to extend the REAL
capture seam to actually emit the missing identity fields.

The Elm kernel itself is **not too coarse**; if the REAL trace
included the identities, the kernel could faithfully reproduce
every historical semantic effect. The model is
**READY_FOR_MODEL_DEEPER_THAN_TRACE**, not the reverse.
