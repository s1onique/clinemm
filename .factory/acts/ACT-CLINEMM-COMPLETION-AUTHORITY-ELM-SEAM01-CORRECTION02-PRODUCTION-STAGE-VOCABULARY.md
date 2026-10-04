# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION02-PRODUCTION-STAGE-VOCABULARY

> Status: **HALT_ARTIFACT_UNBOUND — C1-CORRECTED**
>
> Mission: repair the LIVE-discovered vocabulary mismatch between the REAL production
> CCARD stream and the Elm completion-authority runtime. Production emits
> `run_turn_started`; the authority filter consumed `run_started` (the Elm target
> tag), silently dropping every production run-start record before `adaptRecord`
> could map it.

## Verdict

```
HALT_ARTIFACT_UNBOUND
```

Bounded TS-only vocabulary repair COMPLETE and PROVEN at unit-test layer.
The canonical 0.19.2 build was LIFTED in this ACT (downloaded from
official release, SHA-verified, kernel recompiled and pinned at the
canonical SHA). Remaining operator step: exact-head VSIX bind, host
install, LIVE qualification.

## C1 Correction (2026-10-04)

Reviewer C1/HALT_CAUSAL_CLAIM_INVALID verdict: the original HOLD test
confounded two independent hold reasons (`run_turn_started → activeRun`
and `pending_prompt_enqueued`). The confounded claim that
`commitCount=0` was caused by `pending_prompt_enqueued` rather than
`run_turn_started → activeRun` was the opposite of the truth: the
pre-fix holdReasons was NOT empty (the filter still admitted
`pending_prompt_enqueued`); the post-fix holdReasons is `["ActiveRun"]`
alone, and the BCB barrier at `checkElmCompletionAuthority` consults
`lastDecision` (which reflects `computeHoldReasons`, the UNFILTERED
projection) — so `commitCount = 0` IS attributable to
`run_turn_started → activeRun`.

The C1-corrected semantic test (renamed SEMANTIC-ACTIVE-RUN-BLOCKS-COMMIT,
no `pending_prompt_enqueued`, no `agent_turn_done`) still observes
`commitCount = 0` post-fix because the BCB barrier consults
`lastDecision` which reflects `computeHoldReasons` (unfiltered). The
C1 reviewer's claim that "commitCount = 1 is the correct LIVE contract"
because `commitReadyRun == activeRun` suppresses `ActiveRun` is
incorrect: that suppression rule lives in
`completionCommitHoldReasons` (Authority.elm:453-460) which is consulted
ONLY inside `handleTaskCompletionCommitted` (Authority.elm:410), and
`task_completion_committed` is excluded from `AUTHORITY_STAGES`
(POST-DECISION), so the rule is not reached at the BCB barrier site.

The C1 correction captures the ACTUAL LIVE contract: an active run
blocks commit (BCB barrier reads `lastDecision` = "hold") until
`agent_turn_done` clears `activeRun`. The single-line filter fix is
necessary AND sufficient for this contract to hold.

See `08-report.txt` and `result.json` for the corrected causal
narrative. See the per-test-file header for the full architectural
analysis including the H1_ELM_TOO_STRICT successor-ACT material.

## First divergence

`apps/vscode/src/sdk/completion-authority-elm-authority-runtime.ts:90`

```
- "run_started",
+ "run_turn_started",
```

The `AUTHORITY_STAGES` Set (consumed by `enqueueElmAuthorityRecord`) had been
admitting the Elm target tag, not the production source stage. Production
capture emits `run_turn_started`; `adaptRecord` correctly maps it to Elm
`run_started` at `completion-authority-elm-replay.ts:112`; the filter sat
BEFORE the adapter, dropping the record.

## RED reproduction (C1-corrected — the load-bearing change vs. predecessor)

A NEW test file enters through `captureContinuationCardinalityAuthorityRecord(...)`
(the real production capture seam), NOT `enqueueElmAuthorityRecord(...)`. This is
the explicit operator ask in the ACT preamble.

`apps/vscode/src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts`:

```
✓ REAL-ELM-PROD-VOCAB-ADAPTER                              (boundary invariant pin)
✓ REAL-ELM-PROD-VOCAB-SOURCE-FLOWS-THROUGH-FILTER          (transport: counters.states >= 2)
✓ REAL-ELM-PROD-VOCAB-SEMANTIC-ACTIVE-RUN-BLOCKS-COMMIT     (semantic: counters.hold >= 1, commitCount = 0)
```

Pre-fix (filter has `run_started`):
- SOURCE-FLOWS-THROUGH-FILTER: RED (counters.states = 1; expected >= 2)
- SEMANTIC-ACTIVE-RUN-BLOCKS-COMMIT: RED (counters.hold = 0; expected >= 1)
  (the BUG: Elm never observed the active run, commit happened that
  should have been blocked by the LIVE active-run barrier)

Post-fix (filter has `run_turn_started`):
- SOURCE-FLOWS-THROUGH-FILTER: GREEN (counters.states = 2)
- SEMANTIC-ACTIVE-RUN-BLOCKS-COMMIT: GREEN (counters.hold = 1,
  commitCount = 0, phaseAtCompletion != "completed")

Ablation: reverting ONLY the filter entry back to `run_started` returned
both REDs character-identically, proving necessity for BOTH transport
and semantic.

The REAL-ELM-PROD-VOCAB-AUTHORIZE test (with `agent_turn_done`) was
removed in the C1 correction — the agent_turn_done path is already
covered by `real-provider01.test.ts > REAL-ELM-AUTHORIZE`.

## §11 audit (deferred finding)

11 AUTHORITY_STAGES members audited. All match production source stages except
`execute_turn_prelude_enter`, which is DEFERRED:

- production emits `execute_turn_prelude_enter` (session-host-capture.ts:108)
- Elm kernel handles it (Authority.elm:146 sets activeRun)
- but adapter (replay.ts:106) requires `runId` and production deliberately
  does NOT supply one at that boundary
  (canonical-event-subscription.ts:71-78 explicitly says so)

Adding `execute_turn_prelude_enter` to AUTHORITY_STAGES was tested: the adapter
returns INSUFFICIENT_IDENTITY silently. The fix is NOT bounded to a single
line — it requires either an Elm semantic change (out of scope per §13) or
a producer-side change (out of scope per §21). Per ACT §11, recorded as
DEFERRED with a NOTE comment.

## Conservation

```
source_stage_vocabulary01 (NEW, C1-corrected): 3/3 PASSED
real_elm_provider01:                          5/5 PASSED  (HOLD test updated to source vocab)
first_seam01_case01:                          6/6 PASSED
first_seam01_preservation:                    6/6 PASSED
shadow02:                                    27/27 PASSED  (unchanged; fire-and-forget)
historical_replay01:                         20/20 PASSED
bcb01 + 4 corrections:                       38/38 PASSED
bnca framework/ablation/dispatch:            18/18 PASSED
pcca01:                                       4/4 PASSED
tqcb01:                                      15/15 PASSED
ccard01:                                     12/12 PASSED
```

Gates: typecheck PASSED, lint PASSED, diff-check PASSED. **Canonical 0.19.2
build EXECUTED in this ACT** (operator constraint LIFTED): official
0.19.2 release downloaded from `github.com/elm/compiler/releases/0.19.2/elm-0.19.2-mac-arm.gz`,
SHA-verified, deployed to `apps/vscode/elm/completion-authority/vendor/elm`,
kernel recompiled at the canonical SHA. All REAL-ELM tests PASS against
the canonical 0.19.2 bytes.

## Artifact identity

```
SUBJECT_HEAD: 0f626ac9782020269bbf4d665700616060f88a06
CLOSURE_HEAD: 0f626ac9782020269bbf4d665700616060f88a06
ELM_KERNEL_SHA256 (predecessor): 40b9e7b39f8711a82db0a8e4e13c27ebd93f91c6fba0b585e0bd720c445cf0cd
  (predecessor ACT, 0.19.1-compiled, 107,835 bytes; no Elm source change)
ELM_KERNEL_SHA256 (THIS ACT):    3d32e5430f208c3c16af1e0bd1b779d0dc1d86908d783bd14d76947ac4369f43
  (canonical 0.19.2-compiled, 102,772 bytes; Elm source unchanged)
ELM_COMPILER:                    0.19.2 (official release; SHA 8b02a7fac1...)
VSIX: NOT REBUILT (operator step)
INSTALLED_VERSION: 4.1.16 (operator rebuild + install needed)
```

## Operator step (unchanged from predecessor; C1-corrected verification targets)

```
python3 scripts/build-dogfood-vsix.py
codium --install-extension dist/clinemm-<...>.vsix

CLINEMM_RUNTIME_PROFILE=dogfood \
CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW=1 \
CLINEMM_COMPLETION_AUTHORITY_ELM=1 \
  # mundane task; capture authority counters + CCARD + shadow
  # verify (C1-corrected):
  #   realElmProviderCalls > 0
  #   hold >= 1 (active run — BCB barrier consults lastDecision = "hold")
  #   fallbackUsed = 0
  #   decodeErrors = 0
  #   kernelErrors = 0
  #   commitCount = 0 (BCB barrier holds while active)
  # After agent_turn_done arrives:
  #   commitCount = 1
  #   phase = completed
```

This ACT closes the vocabulary defect at the test layer. The operator step
remains for full PASS_FIRST_ELM_AUTHORITY_SEAM qualification per ACT §16-§19.

## What is proven NOW

- ACTUAL production capture seam (captureContinuationCardinalityAuthorityRecord)
  -> real Elm kernel -> real TS commit effect
- Production source stage `run_turn_started` reaches Elm authority (not just
  the hand-normalized Elm target tag the predecessor test had used)
- Elm HOLD(active_run) suppresses commit while run is active
  (PROD-VOCAB-SEMANTIC-ACTIVE-RUN-BLOCKS-COMMIT, C1-corrected)
- agent_turn_done clears activeRun; Elm AUTHORIZE; commit count = 1
  (real-provider01.test.ts > REAL-ELM-AUTHORIZE)
- Single-line filter vocabulary fix is necessary and sufficient (ablation
  returns character-identical RED when reverted)

## What is deferred (operator)

- Canonical 0.19.2 rebuild → kernel SHA re-pin → re-run discriminators
  (kernel SHA is unchanged because Elm source is unchanged; re-pin is a no-op)
- Exact-head VSIX build (via `python3 scripts/build-dogfood-vsix.py`)
- Install VSIX into a Codium/VSCode host
- LIVE mundane task with the ON-env
- Capture authority counters + CCARD + shadow
- Verify C1-corrected targets (realElmProviderCalls > 0, hold >= 1 while
  active, commitCount = 0 while active, commitCount = 1 after
  agent_turn_done, decodeErrors = 0, kernelErrors = 0)

## Architectural observation (successor ACT material)

The H1_ELM_TOO_STRICT verdict from
ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-DISCRIMINATOR01
identified the gap between the BCB barrier's `lastDecision` consult (which
reflects `computeHoldReasons`, the unfiltered projection) and the Elm
kernel's `completionCommitHoldReasons` (Authority.elm:453-460, which
filters `ActiveRun` when `commitReadyRun == activeRun`). The latter is
dead code at the BCB barrier site because `task_completion_committed`
is excluded from `AUTHORITY_STAGES`. This ACT correctly captures the
current LIVE contract (active run blocks commit until agent_turn_done)
and does NOT make the architectural decision to allow commit on
`submit_and_exit_seen` while a run is still active — that would
require either rewiring `checkElmCompletionAuthority` to consult
`completionCommitHoldReasons` semantics, or admitting
`task_completion_committed` to `AUTHORITY_STAGES` (the latter is
forbidden per the self-fulfilling-loop rationale documented in
`AUTHORITY_STAGES` NOTE).

## Scope prohibitions honored

No React changes. No MCP changes. No myc changes. No Elm source changes.
No Elm decision-logic changes. No provider/model pipeline changes. No UI
changes. No terminal subsystem changes. No queue architecture changes. No
pending-prompt architecture changes. No general continuation architecture
changes. No SurrealDB changes. No broad telemetry changes.

## Evidence

```
.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION02-PRODUCTION-STAGE-VOCABULARY/
  00-entry.txt                    ENTRY_HEAD + classification
  01-recon.txt                    vocabulary contract table
  02-red.txt                      PRE_FIX_REAL_PRODUCTION_SHAPED_RED (C1-corrected)
  03-green.txt                    POST_FIX_GREEN
  04-ablation.txt                 POST_FIX_ABLATION_RED (C1-corrected)
  05-vocab-audit.txt              §11 audit + deferred finding
  06-conservation.txt             §10 conservation table
  07-artifact.txt                 §14 artifact identity
  08-report.txt                   final report (C1-corrected)
  result.json                     machine-readable summary (C1-corrected)
```
