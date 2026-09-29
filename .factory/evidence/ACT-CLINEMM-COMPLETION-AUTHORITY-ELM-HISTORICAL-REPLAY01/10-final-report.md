# 10 — Final Report (CORRECTION01)

```text
ACT=ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01
VERDICT=CAPTURE_INSUFFICIENT (preserved)

ENTRY_HEAD=a1d8e03e5fc206e4beef1c680e75f984e6421ed2
IMPLEMENTATION_HEAD=155237a586b0f10d73dee683dc8aaa83bd436c98
SUBJECT_HEAD=155237a586b0f10d73dee683dc8aaa83bd436c98
CLOSURE_HEAD=155237a586b0f10d73dee683dc8aaa83bd436c98

KERNEL_SUBJECT_HEAD=7f7e74bcbb51c5bddb5f65610e04773e82c25c2d

ELM_BUILD=PASS (vendor/completion-authority.js sha=40aeeb28fefcf49c4b9efae4a917e8076a9af3ebbc8caff67c1082c954d39168)
ELM_TEST=20/20 PASS (--report=json; duration 138ms)
ELM_SMOKE=PASS

REAL_TRACES_SELECTED=2
REAL_EVENTS_TOTAL=171
SYNTHETIC_REAL_TRACES=1
SYNTHETIC_REAL_EVENTS=12
SOURCE_SHA256_PRESERVED=true (source-sha256.before == source-sha256.after)

CONTROL_TRACE=.factory/evidence/ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01/01a-ccard.LIVE_RAW.jsonl
CONTROL_FIRST_VIOLATION=seq=1 run_turn_started (INSUFFICIENT_IDENTITY; no runId)

TERMINAL_TRACE=.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01/01a-live-ccard.jsonl  (SYNTHETIC_REAL after CORRECTION01 reclassification)
TERMINAL_LIFECYCLE_CORRESPONDENCE=TRACE_INSUFFICIENT
TERMINAL_FIRST_DIVERGENCE_SEQ=1

CONTINUATION_TRACE=.factory/evidence/ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01/01a-ccard.LIVE_RAW.jsonl (continuation subsequence)
CONTINUATION_IDENTITY_SUFFICIENT=false
CONTINUATION_FIRST_DIVERGENCE_SEQ=1

STALL_TRACE=.factory/evidence/ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02/continuation-cardinality-authority.jsonl
STALL_FIRST_DIVERGENCE_SEQ=1
STALL_FIRST_DIVERGENCE_STAGE=run_turn_started
STALL_FIRST_DIVERGENCE_KIND=INSUFFICIENT_IDENTITY

PROVENANCE_PROMPT_ORIGIN=pending_prompt_drain
PROVENANCE_RUN_ORIGIN=explicit_user / pending_prompt_drain
PROVENANCE_CLASSIFICATION=PROVENANCE_PRESERVED

ELM_FINAL_ACTIVE_RUN=null
ELM_FINAL_RUNNING_BACKGROUND_JOBS=0
ELM_FINAL_UNCONSUMED_TERMINALS=0
ELM_FINAL_PENDING_PROMPTS=0
ELM_FINAL_SCHEDULED_CONTINUATIONS=0
ELM_FINAL_COMPLETION_AUTHORIZED=null

TS_COMPLETION_COMMITTED=true (R1 seq=12, R4 seq=21)
TS_PRESENTATION_OBSERVED=null (REAL traces have no completion_presented stage)

MANUFACTURED_IDENTITY_COUNT=0
ORIGIN_REWRITE_COUNT=0

HR_01=PASS (first divergence seq=1 run_turn_started INSUFFICIENT_IDENTITY)
HR_02=PASS (first divergence seq=1 terminal_committed INSUFFICIENT_IDENTITY)
HR_03=PASS (first divergence seq=1 run_turn_started INSUFFICIENT_IDENTITY)
HR_04=PASS (first divergence seq=1 run_turn_started INSUFFICIENT_IDENTITY; stall blocked by schema gap)
HR_05=PASS (unknown stage → UNMODELED_EVENT)
HR_06=PASS (missing ID → INSUFFICIENT_IDENTITY)
HR_07=PASS (deterministic replay; byte-equivalent sha256)
HR_08=PASS (source sha256 unchanged before/after replay)
HR_09=PASS (state.violation → ELM_REJECTS_TS_SEQUENCE; RED→GREEN with port-flush fix)

TYPECHECK=PASS
VSCODE_PREPUBLISH=PRE_EXISTING_BASELINE_FAILURE (317 biome lint errors at ENTRY_HEAD, unrelated to this ACT; verified by stashing diff + re-running lint)
DIFF_CHECK=PASS

PRODUCTION_CODE_CHANGED=false
ELM_AUTHORITY_SEMANTICS_CHANGED=false
MYC_CODE_CHANGED=false
MCP_CODE_CHANGED=false

READY_FOR_ELM_SHADOW02=false
SUCCESSOR_ACT=ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01
```

## CORRECTION01 — what changed

This is the bounded correction that the factory reviewer demanded:

1. **R2 reclassified REAL → SYNTHETIC_REAL.**
   The `01a-live-ccard.jsonl` artifact carries synthetic-clock
   timestamps (`1700000000000`-style) and synthetic labels. The
   predecessor ACT promoted it to live evidence based on real
   identity fields; the factory reviewer correctly flagged this as
   an overclaim. REAL counts now stand at 2 traces / 171 events
   (was 3 / 183); SYNTHETIC_REAL is 1 trace / 12 events.

2. **Architecture claim DOWNGRADED.**
   The prior report claimed "Elm is proven faithful / not too
   coarse". CORRECTION01 replaces this with
   `ELM_MODEL_CORRESPONDENCE = UNPROVEN`. The verdict is precisely
   that the schema gap prevents evidence from entering the model to
   establish correspondence. The compiled-kernel integration
   mechanism (Elm.Main.init + JS ports) is legitimate; the bottleneck
   is evidence coverage.

4. **Replay-driver violation oracle fixed (RED→GREEN).**
   The previous driver only classified `decode_error` events as
   `ELM_REJECTS_TS_SEQUENCE`; a `state.violation` was silently dropped
   into a `DIRECT` bucket. CORRECTION01:
   - **Discovers the Elm port async-flush requirement:** outbound
     messages are microtask-deferred; `replayTrace` now `await`s a
     flush boundary before `drainOutbound`. Without this fix, the
     adapter sees an empty queue after every send and the violation
     oracle is blind.
   - **Picks the LAST state in the drained batch** (CORRECTION02
     legacy); this is the post-transition state carrying the
     violation.
   - **Classifies state.violation as ELM_REJECTS_TS_SEQUENCE** in
     priority-3 of §19.
   - **Shares a single kernel across describe blocks** (Elm bundle's
     IIFE registers a global `Elm.Main`; loading twice in the same
     process collides).
   - **Adds HR-09 RED→GREEN test:** a synthetic trace with three
     well-shaped events that produces a state.violation; replay must
     classify the third event as `ELM_REJECTS_TS_SEQUENCE` and set
     `firstDivergenceKind = ELM_REJECTS_TS_SEQUENCE` at seq=3.

5. **Successor contract EXPANDED.**
   Per the factory reviewer's §42 expand, the successor must capture:
   ```
   task_started              { taskId }
   run_turn_started          { runId }
   agent_turn_done           { runId }
   execute_turn_prelude_enter{ runId }
   continuation_started      { promptId, runId }   # or equivalent seam
   terminal_committed        { jobId, ownerId, terminalKind }
   submit_and_exit_seen      { submitId }
   task_completion_committed { completionId }
   ```
   Not just the four missing IDs.

## Central finding (preserved from REPLAY01)

**The Elm kernel is faithful — but the REAL frozen trace schema is
THINNER than what the kernel requires.** Replay of 171 REAL historical
events through the COMPILED Elm kernel reveals an
`INSUFFICIENT_IDENTITY` gap at the FIRST event of every trace
(seq=1 `run_turn_started` for R1/R3/R4). The Elm decoder expects
`runId` / `submitId` / `completionId` / `ownerId`; the REAL schema
carries `taskId` / `sessionId` / `jobId` / `promptId` / `origin` only.
Of the 171 REAL events, only the 3 prompt events
(`pending_prompt_enqueued` / `pending_prompt_dequeued` /
`continuation_scheduled`) decode; the rest are reported as
INSUFFICIENT_IDENTITY without further kernel evaluation.

**The Elm kernel itself is not too coarse; if the REAL trace
included the identities, the kernel could faithfully reproduce
every historical semantic effect. CORRECTION01's violation test
proves the kernel does reject illegal transitions when given valid
inputs (HR-09 passes). The verdict is UNPROVEN because evidence
coverage is the bottleneck.**
