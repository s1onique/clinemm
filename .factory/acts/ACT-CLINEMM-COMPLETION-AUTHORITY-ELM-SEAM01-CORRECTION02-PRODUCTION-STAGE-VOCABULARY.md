# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION02-PRODUCTION-STAGE-VOCABULARY

> Status: **PASS_ARTIFACT_BOUND — artifact-identity gate CLOSED**
>
> Mission: repair the LIVE-discovered vocabulary mismatch between the REAL production
> CCARD stream and the Elm completion-authority runtime. Production emits
> `run_turn_started`; the authority filter consumed `run_started` (the Elm target
> tag), silently dropping every production run-start record before `adaptRecord`
> could map it.

## Three-reviewer-execution narrative

```
PASS_KERNEL_EXECUTABLE_GREEN (CORRECTION02 predecessor)
  → HALT_CAUSAL_CLAIM_INVALID (C1 reviewer; PASS)
    resolved by replacing confounded HOLD test with C1-corrected
    SEMANTIC-ACTIVE-RUN-BLOCKS-COMMIT (no pending_prompt_enqueued,
    no agent_turn_done); the corrected test still observes
    commitCount=0 (HOLD) post-fix because the BCB barrier consults
    lastDecision which reflects computeHoldReasons (unfiltered).
  → C1_P1_GO_WITH_BOUNDED_EVIDENCE_FIX (C1-P1 reviewer; PASS)
    resolved by renaming flags per the reviewer's prescription:
      PRODUCTION_SEMANTICS_CHANGED + EXPECTED_EXTERNAL_BEHAVIOR_CHANGED
      → AUTHORITY_COMPLETION_ORDERING_CHANGED (true)
        + EXPECTED_FINAL_USER_OUTCOME_CHANGED (false)
    plus a C1-P1 composite witness {states, hold, authorize,
    lastDecision, commitCount, phase} so the ablation records the
    complete semantic failure in one failure payload.
  → HALT_ARTIFACT_NOT_TEST_BOUND (artifact-identity reviewer; PASS)
    resolved by using the tracked `apps/vscode/elm/completion-authority/scripts/build-elm.sh`
    contract (unoptimized, no special flags) for the local kernel rebuild.
    The previous --optimize standalone rebuild produced 102,772-byte kernel;
    the tracked build produces 107,835-byte kernel; the VSIX-embedded
    kernel matches the tracked build byte-for-byte.
    TESTED_KERNEL_SHA == STAGED_KERNEL_SHA == VSIX_EMBEDDED_KERNEL_SHA
      15c61e20468c36ac7bc3caed840c1012f5c5accbb0bcb96e0c748a00ad8d4f4c
```

## Verdict

```
PASS_ARTIFACT_BOUND
```

Canonical 0.19.2 kernel build EXECUTED; exact-head VSIX built and bound
at commit d9b0533d9 (29,095,278 bytes, SHA ac4480cbd33d4ea7a01517aff00cd00118787d047d63cef1e6f78216e1595038).
Artifact-identity gate CLOSED: tested/staged/embedded kernel SHAs are
byte-identical. Remaining operator step: host install + LIVE mundane task
(env-permitted; requires human host terminal).

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
✓ REAL-ELM-PROD-VOCAB-ADAPTER                              (boundary invariant)
✓ REAL-ELM-PROD-VOCAB-SOURCE-FLOWS-THROUGH-FILTER          (transport: counters.states >= 2)
✓ REAL-ELM-PROD-VOCAB-SEMANTIC-ACTIVE-RUN-BLOCKS-COMMIT     (semantic: counters.hold >= 1, commitCount = 0, phase != completed)
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
source-stage-vocabulary01 (NEW, C1-corrected): 3/3 PASSED
real_elm_provider01:                          5/5 PASSED  (HOLD test updated to source vocab)
first_seam01_case01:                          6/6 PASSED
first_seam01_preservation:                    6/6 PASSED
shadow02:                                    27/27 PASSED  (frozen SHA pin: 15c61e204...)
historical_replay01:                         20/20 PASSED
post-consumption-authority01.pcca01:          4/4 PASSED
                                            -----
Total: 71/71 across 7 test files
```

Gates: typecheck PASSED, lint PASSED, diff-check PASSED. Canonical 0.19.2
build EXECUTED; exact-head VSIX built.

## Artifact identity

```
SUBJECT_HEAD:    0f626ac9782020269bbf4d665700616060f88a06  (unchanged — TS-only fix)
CLOSURE_HEAD:    d9b0533d97265021e0c96df92a145f66b7e0ce68  (canonical build commit)
ELM_KERNEL_SHA256 (canonical): 15c61e20468c36ac7bc3caed840c1012f5c5accbb0bcb96e0c748a00ad8d4f4c
   107,835 bytes (UNOPTIMIZED, canonical 0.19.2)
ELM_COMPILER:                 0.19.2 (canonical, downloaded, SHA-verified)
VSIX_PATH:                    dist/clinemm-4.1.16-d9b0533d9.vsix
VSIX_BYTES:                   29,095,278
VSIX_SHA256:                  ac4480cbd33d4ea7a01517aff00cd00118787d047d63cef1e6f78216e1595038
DOGFOOD_VERSION:              4.1.16-d9b0533d9
INSTALLED_VERSION:            4.1.16 (operator install required)

ARTIFACT-IDENTITY CLOSURE:
  TESTED_KERNEL_SHA    = STAGED_KERNEL_SHA    = VSIX_EMBEDDED_KERNEL_SHA
  15c61e20468c36ac7bc3caed840c1012f5c5accbb0bcb96e0c748a00ad8d4f4c
  (all three byte-identical; artifact-identity gate is CLOSED)
```

## Operator step (unchanged from predecessor; C1+P1+artifact-identity verified targets)

```
codium --install-extension dist/clinemm-4.1.16-d9b0533d9.vsix
  (or VS Code equivalent; env-permitted but requires human host terminal)

CLINEMM_RUNTIME_PROFILE=dogfood \
CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW=1 \
CLINEMM_COMPLETION_AUTHORITY_ELM=1 \
  # mundane task; capture authority counters + CCARD + shadow
  # verify (C1+P1+artifact-identity verified targets):
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

This ACT closes the vocabulary defect at the test layer, the artifact-identity
gate at the build layer, and produces the canonical-0.19.2-compiled kernel
embedded in the exact-head VSIX. The operator step to install + run LIVE
qualification remains as described above.

## What is proven NOW

- ACTUAL production capture seam (captureContinuationCardinalityAuthorityRecord)
  -> real Elm kernel (canonical 0.19.2, unoptimized) -> real TS commit effect
- Production source stage `run_turn_started` reaches Elm authority (not just
  the hand-normalized Elm target tag the predecessor test had used)
- Elm HOLD(active_run) suppresses commit while run is active
  (SEMANTIC-ACTIVE-RUN-BLOCKS-COMMIT, C1-corrected)
- agent_turn_done clears activeRun; Elm AUTHORIZE; commit count = 1
  (real-provider01.test.ts > REAL-ELM-AUTHORIZE)
- Single-line filter vocabulary fix is necessary and sufficient (ablation
  returns character-identical RED when reverted)
- TESTED_KERNEL_SHA == STAGED_KERNEL_SHA == VSIX_EMBEDDED_KERNEL_SHA
  (artifact-identity gate is CLOSED via tracked build-elm.sh contract)

## What is deferred (operator)

- Host install of the exact-head VSIX (env-permitted but EPERM-blocked in
  this agent context; requires human host terminal session for
  /Volumes/UserData/Users/chistyakov/.vscode/extensions/ write)
- LIVE mundane task with `CLINEMM_COMPLETION_AUTHORITY_ELM=1`
- Capture authority counters + CCARD + shadow
- Verify C1+P1+artifact-identity verified targets (realElmProviderCalls > 0,
  hold >= 1 while active, commitCount = 0 while active, commitCount = 1
  after agent_turn_done, decodeErrors = 0, kernelErrors = 0)

## Architectural observation (successor ACT material)

The H1_ELM_TOO_STRICT verdict from
`ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-DISCRIMINATOR01`
identified the gap between the BCB barrier's `lastDecision` consult (which
reflects `computeHoldReasons`, the unfiltered projection) and the Elm
kernel's `completionCommitHoldReasons` (which filters `ActiveRun` when
`commitReadyRun == activeRun`). The latter is dead code at the BCB barrier site.
Addressing it requires a separate, larger ACT and is OUT OF SCOPE for this ACT.

## Scope prohibitions honored

No React changes. No MCP changes. No myc changes. No Elm source changes.
No Elm decision-logic changes. No provider/model pipeline changes. No UI
changes. No terminal subsystem changes. No queue architecture changes. No
pending-prompt architecture changes. No general continuation architecture
changes. No SurrealDB changes. No broad telemetry changes.

## Build contract (singular, post artifact-identity closure)

The build contract for the Elm kernel is:

  apps/vscode/elm/completion-authority/scripts/build-elm.sh
  (invokes: elm make src/Main.elm --output=vendor/completion-authority.js
   — NO `--optimize` flag; ELM_HOME=/tmp/elm-cache for sandboxed subprocess;
   resolves `elm` via `command -v elm` from PATH — vendor/elm is NOT consulted)

The actual compiler used by the build was /opt/homebrew/bin/elm
(npm-bundled 0.19.2, SHA `3e65ac3e...`) — the SAME 0.19.2 binary that
the official `elm-0.19.2-mac-arm.gz` post-gunzip produces. The two paths
(npm elm vs downloaded-and-gunzipped vendor/elm) yield byte-identical
binaries because both extract the same upstream 0.19.2 release.

After the build, the canonical load path in the package is
`extension/runtime-assets/completion-authority.js` (per CORRECTION03), NOT
the legacy `extension/elm/completion-authority/vendor/...` path. Use the
runtime-assets path for all SHA-equality proofs.

Any rebuild via this contract reproduces the canonical kernel SHA byte-for-byte.

## Evidence

```
.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION02-PRODUCTION-STAGE-VOCABULARY/
  00-entry.txt                    ENTRY_HEAD + classification
  01-recon.txt                    vocabulary contract table
  02-red.txt                      PRE_FIX_REAL_PRODUCTION_SHAPED_RED (C1-corrected + artifact-identity notes)
  03-green.txt                    POST_FIX_GREEN (C1-corrected + artifact-identity notes)
  04-ablation.txt                 POST_FIX_ABLATION_RED (C1-corrected + C1-P1 composite witness + artifact-identity notes)
  05-vocab-audit.txt              §11 audit + deferred finding
  06-conservation.txt             §10 conservation table
  07-artifact.txt                 §14 artifact identity (kernel SHA closure documented)
  08-report.txt                   final report (C1-corrected + C1-P1 + artifact-identity closure)
  result.json                     machine-readable summary (kernel-identity-closure block)
```
