# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION02-PRODUCTION-STAGE-VOCABULARY

> Status: **HALT_ARTIFACT_UNBOUND**

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
Same env constraint as predecessor ACT prevents the canonical 0.19.2
build, exact-head VSIX bind, host install, and LIVE qualification.

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

## RED reproduction (the load-bearing change vs. predecessor)

A NEW test file enters through `captureContinuationCardinalityAuthorityRecord(...)`
(the real production capture seam), NOT `enqueueElmAuthorityRecord(...)`. This is
the explicit operator ask in the ACT preamble.

`apps/vscode/src/sdk/__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts`:

```
✓ REAL-ELM-PROD-VOCAB-ADAPTER          (boundary invariant pin)
✓ REAL-ELM-PROD-VOCAB-AUTHORITY-FILTER  (filter accepts production source)
✓ REAL-ELM-PROD-VOCAB-HOLD              (commit suppressed while active)
✓ REAL-ELM-PROD-VOCAB-AUTHORIZE         (commit after agent_turn_done)
```

Pre-fix the FILTER and HOLD tests RED with character-identical failures
(`counters.states = 1`, `commitCount = 1`).

Post-fix they GREEN with the predicted outputs (`counters.states = 2`,
`commitCount = 0` for HOLD; `commitCount = 1` for AUTHORIZE).

Ablation: reverting ONLY the filter entry back to `run_started` returned
the REDs character-identically, proving necessity.

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
real_elm_provider01:                5/5 PASSED  (HOLD test updated to source vocab)
new_source_stage_vocabulary01:      4/4 PASSED
first_seam01_case01:                6/6 PASSED
first_seam01_preservation:          6/6 PASSED
shadow02:                          27/27 PASSED  (unchanged; fire-and-forget)
historical_replay01:               20/20 PASSED
bcb01 + 4 corrections:             38/38 PASSED
bnca (8 suites):                   20/20 PASSED
pcca01:                             4/4 PASSED
tqcb01:                            15/15 PASSED
ccard01:                           12/12 PASSED
full_unit_suite:  94 files / 1246 tests / 0 failures
```

Gates: typecheck PASSED, lint PASSED, diff-check PASSED. Canonical 0.19.2
build NOT POSSIBLE (same env constraint as predecessor).

## Artifact identity

```
SUBJECT_HEAD: 0f626ac9782020269bbf4d665700616060f88a06
CLOSURE_HEAD: 0f626ac9782020269bbf4d665700616060f88a06
ELM_KERNEL_SHA256: 40b9e7b39f8711a82db0a8e4e13c27ebd93f91c6fba0b585e0bd720c445cf0cd
  (unchanged from predecessor; Elm source not touched; no rebuild possible)
VSIX: NOT REBUILT (operator)
INSTALLED_VERSION: 4.1.16 (operator rebuild + install needed)
```

## Operator step (unchanged from predecessor)

```
python3 scripts/build-dogfood-vsix.py
codium --install-extension dist/clinemm-<...>.vsix

CLINEMM_RUNTIME_PROFILE=dogfood \
CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW=1 \
CLINEMM_COMPLETION_AUTHORITY_ELM=1 \
  # mundane task; capture authority counters + CCARD + shadow
  # verify: realElmProviderCalls > 0, authorize >= 1, fallbackUsed = 0,
  #         completion = 1, decodeErrors = 0, kernelErrors = 0
```

This ACT closes the vocabulary defect at the test layer. The operator step
remains for full PASS_FIRST_ELM_AUTHORITY_SEAM qualification per ACT §16-§19.

## What is proven NOW

- ACTUAL production capture seam (captureContinuationCardinalityAuthorityRecord)
  -> real Elm kernel -> real TS commit effect
- Production source stage `run_turn_started` reaches Elm authority (not just
  the hand-normalized Elm target tag the predecessor test had used)
- Elm HOLD(active_run) suppresses commit while run is active (PROD-VOCAB-HOLD)
- agent_turn_done clears activeRun; Elm AUTHORIZE; commit count = 1
- Single-line filter vocabulary fix is necessary and sufficient (ablation
  returns character-identical RED when reverted)

## What is deferred (operator)

- Canonical 0.19.2 rebuild → kernel SHA re-pin → re-run discriminators
  (kernel SHA is unchanged because Elm source is unchanged; re-pin is a no-op)
- Exact-head VSIX build (via `python3 scripts/build-dogfood-vsix.py`)
- Install VSIX into a Codium/VSCode host
- LIVE mundane task with the ON-env
- Capture authority counters + CCARD + shadow
- Verify `realElmProviderCalls > 0, authorize, fallbackUsed = 0, completion count = 1, decodeErrors = 0, kernelErrors = 0`

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
  02-red.txt                      PRE_FIX_REAL_PRODUCTION_SHAPED_RED
  03-green.txt                    POST_FIX_GREEN
  04-ablation.txt                 POST_FIX_ABLATION_RED
  05-vocab-audit.txt              §11 audit + deferred finding
  06-conservation.txt             §10 conservation table
  07-artifact.txt                 §14 artifact identity
  08-report.txt                   final report
  result.json                     machine-readable summary
```