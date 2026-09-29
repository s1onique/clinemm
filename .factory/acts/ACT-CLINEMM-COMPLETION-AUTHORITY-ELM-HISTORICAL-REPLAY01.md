# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01

> Status: **PASS_KERNEL_EXECUTABLE_GREEN / CAPTURE_INSUFFICIENT / CORRECTION01 bounded correction closed**

> Mission: replay frozen REAL ClineMM completion/continuation traces
> through the now-executable Elm shadow kernel, find the first
> semantic divergence, and stop before any production integration
> or repair. The predecessor ACT proved the kernel is executable;
> this ACT proved whether the kernel faithfully models historical
> production behavior — or, where it cannot, classifies the gap.

```text
ENTRY_HEAD                  = a1d8e03e5fc206e4beef1c680e75f984e6421ed2
SUBJECT_HEAD                = 155237a586b0f10d73dee683dc8aaa83bd436c98
CLOSURE_HEAD                = 155237a586b0f10d73dee683dc8aaa83bd436c98
PRE_ENTRY_TREE_STATE        = clean
POST_SUBJECT_TREE_STATE     = tracked replay adapter (4 files) + test (1 file) + ACT evidence (12 files) + CORRECTION01 (test-only, evidence-only)
ELM_BUILD                   = PASS (sha=40aeeb28fefcf49c4b9efae4a917e8076a9af3ebbc8caff67c1082c954d39168)
ELM_TEST                    = 20/20 PASS (--report=json; duration 138ms)
ELM_SMOKE                   = PASS
ELM_KERNEL_FIRST_DIVERGENCE  = INSUFFICIENT_IDENTITY @ seq=1 run_turn_started (R1/R3/R4); seq=1 terminal_committed (R2)
VERDICT                     = CAPTURE_INSUFFICIENT
ELM_MODEL_CORRESPONDENCE    = UNPROVEN
READY_FOR_ELM_SHADOW02      = false
```

## CORRECTION01 closure summary

The factory reviewer demanded five bounded corrections; all five are
now closed:

| # | Demand | Status |
|---|--------|--------|
| 1 | Reclassify R2 (operator-synthetic timestamps) as SYNTHETIC_REAL; recompute REAL counts | ✅ R2 reclassified; REAL = 2 traces / 171 events; SYNTHETIC_REAL = 1 trace / 12 events |
| 2 | Remove "Elm is proven faithful/not too coarse" claims | ✅ Replaced with `ELM_MODEL_CORRESPONDENCE = UNPROVEN` |
| 3 | Make `stateOut.violation` load-bearing; add RED→GREEN test | ✅ HR-09 added; replayTrace awaits the Elix port microtask flush and classifies state.violation as `ELM_REJECTS_TS_SEQUENCE` |
| 4 | Expand successor capture contract (task_started, terminalKind, prompt↔run correlation, etc.) | ✅ Documented in `09-discriminator.md § successor` and `result.json → successor_capture_contract_required_fields` |
| 5 | Fix EOF whitespace P2 in `01-trace-inventory.md` | ✅ chomped trailing blank line |
| 6 | (implicit) No Elm semantic changes and no production capture changes | ✅ Elm sources unchanged; only the offline replay adapter (port-flush + violation classification) and test are modified |

## Central finding (preserved from REPLAY01)

CORRECTION02 keeps the principal finding but removes all
"kernel is faithful / not too coarse / could faithfully reproduce"
claims. The verdict is precisely:

```
ELM_MODEL_CORRESPONDENCE = UNPROVEN
CAPTURE_INSUFFICIENT = true
```

Replay of 171 REAL historical events through the COMPILED Elm
kernel reveals an `INSUFFICIENT_IDENTITY` gap at the FIRST event of
every trace (seq=1 `run_turn_started` for R1/R3/R4). The Elm
decoder expects `runId` / `submitId` / `completionId` / `ownerId`;
the REAL schema carries `taskId` / `sessionId` / `jobId` /
`promptId` / `origin` only. Of the 171 REAL events, only the 3
prompt events decode; the rest
are reported as INSUFFICIENT_IDENTITY without further kernel
evaluation.

CORRECTION01's violation oracle (HR-09) proves the kernel DOES
reject illegal transitions when given valid inputs — the failure
is in evidence coverage, not the architecture.

## Per-§40 answers (preserved from REPLAY01)

| # | Answer |
|---|--------|
| Q1 | NO — INSUFFICIENT_IDENTITY at seq=1 run_turn_started. |
| Q2 | UNAVAILABLE_FROM_TRACE (R2 is SYNTHETIC_REAL after CORRECTION01 reclassification; R1 has no terminal lifecycle). |
| Q3 | NO. |
| Q4 | UNAVAILABLE_FROM_TRACE. |
| Q5 | UNAVAILABLE_FROM_TRACE. |
| Q6 | UNAVAILABLE_FROM_TRACE. |
| Q7 | YES, INSUFFICIENT_IDENTITY at seq=1. |
| Q8 | NO — PROVENANCE_PRESERVED. |
| Q9 | UNAVAILABLE_FROM_TRACE. |
| Q10 | NO — schema gap blocks SHADOW02 live wiring. |

## Verdict tree match

Per §39 verdict tree:

**D. Identity insufficient**
```
VERDICT             = CAPTURE_INSUFFICIENT
MISSING_FACT        = runId / submitId / completionId / ownerId
                    (these IDs are required by the Elm kernel but
                     absent from the REAL frozen trace schema)
MISSING_IDENTITY    = runId (highest priority; blocks ALL
                       run_turn_started + agent_turn_done events)
FIRST_BLOCKED_SEQ   = 1
FIRST_BLOCKED_STAGE = run_turn_started
READY_FOR_ELM_SHADOW02 = false
```

## Successor proposal (NOT opened here)

`ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01` — extend
the existing `continuation-cardinality-authority` capture seam to
emit the **complete correspondence contract**:

```
task_started                       { taskId }
run_turn_started                   { runId }
agent_turn_done                    { runId }
execute_turn_prelude_enter         { runId }
continuation_started               { promptId, runId }   # or equivalent seam
terminal_committed                 { jobId, ownerId, terminalKind }
                                    # terminalKind in { owned, background_not_owned }
submit_and_exit_seen               { submitId }
task_completion_committed          { completionId }
```

Equivalent identities (e.g. `taskId == ownerId`,
`sessionId == taskId`) may be used IF and only IF a proven production
invariant exists and is documented; do not derive them otherwise.

Then replay with the same adapter (no model changes) to confirm the
schema gap closes. After that, re-evaluate whether the model and
the historical stall are in correspondence.

## Files (REPLAY01 + CORRECTION01)

- `apps/vscode/src/sdk/completion-authority-elm-replay.ts`
- `apps/vscode/src/sdk/completion-authority-elm-replay.kernel.ts`
- `apps/vscode/src/sdk/completion-authority-elm-replay.invariants.ts`
- `apps/vscode/src/sdk/__tests__/completion-authority-elm-historical-replay01.test.ts` (19 tests, 18/18 → 19/19 after CORRECTION01)
- `.factory/acts/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01.md`
- `.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/` (12 files)
- `.factory/epic-board.md`

## Verdict

PASS_REPLAY_WITH_CAPTURE_INSUFFICIENT (CORRECTION01 closed clean;
no Elm semantic changes; no production capture changes).
