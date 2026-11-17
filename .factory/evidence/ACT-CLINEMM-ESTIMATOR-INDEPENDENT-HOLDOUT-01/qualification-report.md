# Qualification report — ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01

## Correction notice (CORRECTION01)

This report was corrected under the bounded offline-correction authorization that followed the
review of the evidence-discovery commit `2d5f8c00c`. Three **P0 evidence-integrity defects** and
one **P1 verdict defect** were reproduced and fixed in the offline adapter only. **No production
estimator, compaction policy, Strata configuration, runtime diagnostic, coefficient, VSIX or
Round C run was changed.**

| ID | Defect | Correction |
|---|---|---|
| P0-1 | Zero observations produced `productionProposalSuitable: true` — absence of evidence became a positive safety claim. | `productionSuitability()` is now three-state. With zero qualified observations it returns `status: "NOT_EVALUATED"`, `productionProposalSuitable: false`, `reasons: ["NO_QUALIFIED_OBSERVATIONS"]`. |
| P0-2 | Duplicate exports of one holdout session were processed independently, doubling every eligible row while still reporting one independent session. | `deduplicateHoldoutExports()` now de-duplicates **by session identity before dataset construction**. Byte-identical re-exports collapse to one; exports of one session that disagree are a conflict and the whole session is rejected. Duplicates and conflicts contribute zero rows. |
| P0-3 | The runner hard-coded historical test results into a fresh `test-receipt.json`, so a subsequent `--trace` run would falsely claim the earlier run's tests and observations. | `buildTestReceipt()` separates `commands` (ONLY the tests the current invocation actually executed) from `historicalTestEvidence` (explicitly labelled `HISTORICAL_TEST_EVIDENCE`). An evaluation run that executes no suite records `commands: []` and `testsExecutedByThisRun: 0`. |
| P1 | An independent trace yielding zero eligible attempts was reported as `AWAITING_INDEPENDENT_DOGFOOD_SESSION`, telling the operator to collect a session that had already been collected. | `decideVerdict()` (new `tool/verdict.ts`) returns `CAPTURE_INSUFFICIENT` when an independent session exists but yields zero eligible attempts, and `AWAITING_INDEPENDENT_DOGFOOD_SESSION` only when no independent session exists at all. |

The RED→GREEN witnesses for all four defects live in `tool/guards.test.ts` (11 tests). They
exercise the **real** analysis functions — the holdout adapter, the receipt builder and the
verdict selector — not re-implementations.

## Verdict

**AWAITING_INDEPENDENT_DOGFOOD_SESSION**

No eligible independent dogfood trace exists. The evidence discovery was performed in the
prescribed order against the explicitly known sanitized trace locations, and every surviving
latency-trace export carries the **training** session identity. The previously known independent
export was overwritten at its canonical path and its session predates the authoritative capture
contract, so it is ineligible on two independent grounds.

No holdout statistics are reported. A frozen coefficient was **not** refit, an estimator was
**not** implemented, a compaction policy was **not** changed, and no live session was invented.

**Holdout qualification remains `HALT_HOLDOUT_EVIDENCE_GUARDS`** until an operator supplies a
genuine independent trace with authoritative attempt identity.

## Repository and artifact identity

- Repository: `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm`
- Remote: `git@github.com:s1onique/clinemm.git`
- Branch: `main` (no branch created, no worktree created, no push, no PR)
- **ENTRY_HEAD**: `2d5f8c00ccc050f8105af65787d265cbe1ba5069` (the evidence-discovery commit; the
  evidence-discovery run itself was executed at `e5343571df97e5b2ef9c68fe1ddfd32d93acaf31`)
- Expected history confirmed: `f87e1547d` (dogfood capture default) → `88f7ce2ca` (offline
  calibration evidence) → `e5343571d` (bounded evidence-identity correction) → `2d5f8c00c`
  (independent-holdout evidence discovery).
- Unexpected tracked dirt: **none** (`git status --porcelain=v1` was empty at entry).
- Existing worktrees were left untouched, including the recovery worktree
  `/private/tmp/clinemm-stash-recovery-20261117`.


## Evidence discovery (prescribed order)

### 1. Explicitly known sanitized dogfood trace locations

| Path | Session ID | SHA-256 | Bytes | Role |
|---|---|---|---:|---|
| `~/.vscodium-roz/user-data/User/globalStorage/s1onique.clinemm/roundc-latency-trace.json` | `1794881611778_557z3` | `601450ac…f5ed` | 647,103 | TRAINING_SOURCE |
| `~/Downloads/roundc-latency-trace.json` | `1794881611778_557z3` | `601450ac…f5ed` | 647,103 | TRAINING_SOURCE |

Both exports are **byte-identical** (`601450acb83dad00a84451147b194ed01010190763b9442d6ed8693900eef5ed`).
They are **one session exported twice**, not two independent samples. The executable
independence gate classifies this as `DUPLICATE_EXPORT_SAME_SESSION`.

### 2. Available trace manifests

- `~/.vscodium-roz/cline-data/private/compaction-candidates/` — contains two PRIVATE candidate
  snapshots, both for the training session (`1794881611778_557z3_16_15…` and `_32_31…`). These are
  unsubmitted private compaction candidates, not provider usage labels; excluded by design.
- `~/Downloads/clinemm_roundc_sanitized_profile.json` — session `1794702518894_gui73` (Nov 15).
  A genuinely different session, but **not** the latency-trace schema: its `model_turns` carry
  only `event_index`, `ts_utc`, `model_elapsed_ms`, `input_tokens`, `output_tokens`,
  `cache_read_tokens`, `cache_write_tokens`. It has **no** `preparationRequestId`,
  `modelRequestId`, `estimatedFinalInputTokens`, `requestTriggerTokens`, `maxInputTokens`,
  `rawMaxInputTokens` or `underestimateFactor`. It cannot produce an authoritative join and is
  therefore ineligible.

### 3. Does a second independent session already exist?

Two adjacent ClineMM sessions exist in the session store, both `openai-compatible` /
`qwen3.8-flash-next-iq3_s` on the Keycloak repository:

| Session | Window | Provider / model | Ineligibility reason |
|---|---|---|---|
| `1794835772204_hvkkv` | Nov 16 13:29 → 20:24 | openai-compatible / qwen3.8-flash-next-iq3_s | Ran **before** `03ad308f4` (authoritative capture contract, Nov 17 04:53). No per-attempt identity. |
| `1794860704742_kxlwr` | Nov 16 20:25 → Nov 17 00:52 | openai-compatible / qwen3.8-flash-next-iq3_s | Same. Its trace was analysed by ACT-CLINEMM-COMPACTION-ESTIMATOR-PARITY-01 under **`INFERRED_CHRONOLOGICAL_PAIRING`** — explicitly *not* authoritative same-request identity. |
| `1794881611778_557z3` | Nov 17 02:13 → 03:11 | openai-compatible / qwen3.8-flash-next-iq3_s | The **training** session. Not a holdout. |

The PARITY01 trace for `1794860704742_kxlwr` (SHA-256
`631a506d0719314373bab801dfc70f646cca508318f87c59cdc5e3e2a1e517df`, 2,750 events) was the only
independent-session export that ever existed at the canonical path. **That file has been
overwritten** by the later training-session export at the same path. The hash is still recorded
in the committed PARITY01 evidence, but the bytes are gone; and even if recovered, its pairing
authority was `INFERRED_CHRONOLOGICAL_PAIRING` and it predates the authoritative capture
contract, so it could not serve as this ACT's holdout regardless.

No filesystem-wide search was performed.


## Frozen calibration (unchanged, verified)

| Candidate | Formula | Coefficient |
|---|---|---|
| Baseline | `E` | — |
| Constant (primary) | `ceil(0.79935 × E)` | `0.79935` |
| Model-scoped constant | `ceil(0.79935 × E)` | `0.79935` |
| Affine (exploratory) | `ceil(0.8078297287430471 × E − 601.9734484558503)` | frozen |

Training source: session `1794881611778_557z3`, source trace SHA-256
`601450acb83dad00a84451147b194ed01010190763b9442d6ed8693900eef5ed`.
Target scope: `provider = openai-compatible`, `model = qwen3.8-flash-next-iq3_s`.

The coefficients live in `tool/holdout.ts` as `Object.freeze`d constants. Witness **V2** proves
that a deliberate mutation attempt throws and that the serialized candidate set is byte-identical
before and after an evaluation. The prior analyzer's `fitConstant` / `fitAffine` are deliberately
**not imported** by this ACT, so no refit path exists. `frozen-candidates.json` records
`refitOnHoldout: false`.

## Authoritative holdout dataset

**Eligible attempts: 0. Exclusions: 0 attempts could even be considered** — the holdout source
set is empty after the training session is removed.

| Measure | Value |
|---|---|
| Independent sessions | 0 |
| Eligible provider attempts | 0 |
| Distinct holdout session ids | none |
| Duplicate exports of the same session | 1 (both training exports) |
| Holdout exports accepted after de-duplication | 0 |
| Holdout exports rejected as duplicates | 0 |
| Holdout sessions rejected for conflicting exports | 0 |

**CORRECTION01 (P0-2).** Holdout exports are now de-duplicated **by session identity before any
dataset is constructed**. Byte-identical re-exports of one session collapse to a single accepted
export; exports of one session whose content hashes disagree are a conflict and the whole session
is rejected. Neither duplicates nor conflicts contribute any row. `holdout-manifest.json` records
this under `exportDeduplication`, including
`contributingRowsFromDuplicates: 0` and `contributingRowsFromConflicts: 0`.

In this run the de-duplication step had no holdout candidates to act on: both discovered exports
carry the **training** session id and are excluded before de-duplication as
`EXCLUDE_FROM_HOLDOUT`. The two exports are nevertheless documented as the same session exported
twice by the independence gate (`DUPLICATE_EXPORT_SAME_SESSION`).


## Frozen holdout evaluation

**Not performed — no qualified attempt exists.** The pre-registered interpretation for zero
qualified attempts is `CAPTURE_INSUFFICIENT`; however, the pre-registered *operator boundary*
takes precedence: with no eligible independent trace at all, the required disposition is
**`AWAITING_INDEPENDENT_DOGFOOD_SESSION`**, and no empty evidence files were fabricated to
satisfy the deliverable list.

**CORRECTION01 clarification.** These two outcomes are now distinguished by the executable
verdict selector (`tool/verdict.ts`):

| State | Verdict |
|---|---|
| No independent session exists at all | `AWAITING_INDEPENDENT_DOGFOOD_SESSION` |
| An independent session exists but yields zero eligible attempts | `CAPTURE_INSUFFICIENT` |

This run found **no independent session at all**, so `AWAITING_INDEPENDENT_DOGFOOD_SESSION` is
correct. The P1 defect was that the runner returned `AWAITING_INDEPENDENT_DOGFOOD_SESSION` even
when an independent trace *was* present but unusable — that case now correctly yields
`CAPTURE_INSUFFICIENT`.

Training-session observations (baseline median absolute error 9,806; constant 443; constant
underestimates 20/32 with a maximum of 954) are **training results, not holdout results**, and
are not restated here as holdout evidence.

## Safety discrimination

**Not performed on a holdout**, because there is no holdout. The following are the pre-registered
criteria and their status:

| Class | Status |
|---|---|
| A. Underestimation frequency and magnitude | NOT EVALUATED (0 eligible attempts) |
| B. False-safe trigger (`actual ≥ trigger` AND `estimate < trigger`) | NOT EVALUATED |
| C. Effective-ceiling false safety (`actual > max` AND `estimate ≤ max`) | NOT EVALUATED |
| D. Near-limit coverage (≥ 0.9 × trigger / ≥ 0.9 × ceiling) | **NEAR_LIMIT_SAFETY_UNOBSERVED** |
| E. Selection bias | APPLICABLE — see below |


**Selection bias (E)** is structural, not incidental: the current budget guard may prevent unsafe
requests from ever reaching the provider, so completed-request samples never cover all possible
overflow cases. Unsubmitted or rejected requests are therefore **UNLABELLED** — no actual provider
token usage exists for them.

**Completed-request evidence vs unsubmitted compaction counterfactuals.** These are distinct
representations and are never conflated:

- A **completed request** has an authoritative provider completion: `inputTokens` is the provider's
  complete prompt count, and `cacheReadTokens` is a **subset** of it that is never added again.
- An **unsubmitted compaction candidate** (the pre-compaction decision candidate) was never sent
  to the provider. It has **no** authoritative label. The provider usage of a post-compaction or
  `beforeModel`-transformed request is a *different representation* and is **not** a label for that
  candidate. The compaction decision measures the pre-compaction candidate; the completed provider
  request may represent a post-compaction projection.


**`NEAR_LIMIT_SAFETY_UNOBSERVED` is a coverage statement, not a safety claim.** No zero-risk
conclusion is drawn from zero examples.

## Pre-registered interpretation (unexercised)

The frozen factor is **not suitable for a production proposal** if a holdout demonstrates a
false-safe ceiling crossing, unsupported request accounting, or a significant unmitigated
underestimate near the effective limit. This ACT produced no holdout, so the criterion was not
exercised. **Production deployment remains out of scope regardless.**

## Production-suitability gate (CORRECTION01)

The gate is **explicitly not evaluated** in the absence of observations. It is NOT a pass and NOT
a positive safety claim:

```json
"productionSuitability": {
  "status": "NOT_EVALUATED",
  "productionProposalSuitable": false,
  "reasons": ["NO_QUALIFIED_OBSERVATIONS"],
  "evaluatedRequests": 0
}
```

The pre-correction artifact asserted `productionProposalSuitable: true` with an empty `reasons`
array on an empty dataset. That was an evidence-integrity defect (P0-1) and has been corrected.

## Executable gates

| Gate | Assertion | Result |
|---|---|---|
| V1 | Training and holdout session ids are disjoint | PASS |
| V2 | Frozen calibration constants cannot change during evaluation | PASS |
| V3 | Exact provider-attempt identity required | PASS |
| V4 | Ambiguous retries excluded, not arbitrarily selected | PASS |
| V5 | Cached-token subset never double-counted | PASS |
| V6 | No same-session duplicate export counted as independence | PASS |
| V7 | New trace cannot overwrite previous calibration artifacts | PASS |
| V8 | Compaction timing not inferred from hard-coded row ordinal | PASS |
| V9 | False-safe ceiling and trigger cases classified correctly | PASS |
| V10 | Zero near-limit observations produce `NEAR_LIMIT_SAFETY_UNOBSERVED` | PASS |
| V11 | Unknown model/provider configuration remains unqualified | PASS |
| V12 | Output contains no prompts, conversation content, tools or credentials | PASS |

### CORRECTION01 guard witnesses (`tool/guards.test.ts`)

| Witness | Assertion | Result |
|---|---|---|
| P0-1 | Zero evaluated requests yield `NOT_EVALUATED` / `NO_QUALIFIED_OBSERVATIONS` and `productionProposalSuitable: false` | PASS |
| P0-1 | A populated observation set with no pre-registered failure remains `EVALUATED` and suitable | PASS |
| P0-2 | Byte-identical duplicate exports collapse to one accepted export | PASS |
| P0-2 | Conflicting exports for one session are rejected wholesale, not combined | PASS |
| P0-2 | A conflicting session contributes no rows | PASS |
| P0-2 | The independence gate sees one session for duplicated exports | PASS |
| P0-3 | A fresh run with no executed tests records `commands: []` | PASS |
| P0-3 | Historical test evidence is separately and explicitly labelled | PASS |
| P1 | An independent trace with zero eligible attempts is `CAPTURE_INSUFFICIENT` | PASS |
| P1 | No independent session at all is `AWAITING_INDEPENDENT_DOGFOOD_SESSION` | PASS |
| P1 | The populated-dataset verdict authority is unchanged | PASS |

### Finding raised by witness V4

The prior analyzer's `buildDataset` reports `MULTIPLE_ATTEMPTS_FOR_ONE_PREPARATION` when a
preparation has more than one provider attempt, but it **retains the first attempt it saw** and
drops only the later one. That is an arbitrary selection between two competing provider attempts
— precisely what this ACT forbids. The committed analyzer was **not modified**. Instead
`tool/holdout.ts` adds `qualifyDataset()`, a strict second pass that removes every ambiguous
preparation entirely and reports it as `AMBIGUOUS_RETRY_PREPARATION_EXCLUDED`. A duplicate
completion event for the *same* attempt id is correctly treated as a deduplication, not an
ambiguity. The faulty behaviour is demonstrated inside the V4 witness so the guard cannot silently
regress.

### Commands actually executed for this correction

| Command | Result | Observed |
|---|---|---|
| `bun test ./.factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/guards.test.ts` | PASS | 11 pass, 0 fail, 40 expect() calls (P0-1 ×2, P0-2 ×4, P0-3 ×2, P1 ×3) |
| `bun test ./.factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/tool/analyze.test.ts ./.factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/holdout.test.ts ./.factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/guards.test.ts` | PASS | 39 pass, 0 fail, 140 expect() calls across 3 files (16 T1–T16 + 12 V1–V12 + 11 CORRECTION01) |
| `ENTRY_HEAD=$(git rev-parse HEAD) TOOL_SHA256=$(shasum -a 256 …/tool/holdout.ts) bun …/tool/run.ts` | PASS | 2 exports, both training; `DUPLICATE_EXPORT_SAME_SESSION`; 0 eligible attempts; verdict `AWAITING_INDEPENDENT_DOGFOOD_SESSION`; suitability `NOT_EVALUATED` |

The **historical** test evidence from the evidence-discovery run (`2d5f8c00c`) is preserved in
`test-receipt.json` under `historicalTestEvidence`, each entry explicitly labelled
`HISTORICAL_TEST_EVIDENCE` with the commit it belongs to. The current run's `commands` list is
empty because the runner executed no test suite — it evaluated traces. That separation is the
P0-3 correction.

The prior ACT's tool hashes were re-verified against its committed manifest:
`analyze.ts` = `ddbb74e9…b471`, `analyze.test.ts` = `73051cfd…d231`,
`calibration-candidates.json` = `fd95749d…7597`. **No historical calibration receipt was
rewritten or normalized.**


## Required operator collection instructions

To unblock this ACT, one real ClineMM dogfood session is required. The exact artifact and the
procedure:

**Required artifact** — a sanitized latency-trace export in the `cline.roundc-latency-trace.v1`
schema, exported from the installed dogfood extension, whose `sessionId` differs from
`1794881611778_557z3`, and whose `provider_completed` events carry the authoritative triple
`preparationRequestId` + `modelRequestId` + provider usage.

**Procedure**

1. Launch the installed dogfood extension with the dogfood runtime profile active
   (`CLINEMM_RUNTIME_PROFILE=dogfood`), so the Round C latency trace is armed automatically, and
   keep the private compaction-candidate capture at its dogfood default.
2. Select the same provider/model scope: `openai-compatible` /
   `qwen3.8-flash-next-iq3_s`. Keep the effective model formatting/options unchanged, or record
   any difference explicitly.
3. Run a **naturally occurring, useful coding task** through `codium-clinemm` — a bounded task on
   the existing Keycloak repository is acceptable; a different repository is acceptable and gives
   useful distribution-shift evidence. Do **not** repeat the complete Round C audit and do
   **not** deliberately inflate context toward overflow. Aim for at least ten eligible completed
   provider attempts through normal useful work, but do not extend the task artificially to reach
   that count.
4. After the task, export the trace with the installed workflow (the
   `cline.debug.dumpRoundcLatencyTrace` command, or the extension-owned dump at
   `<globalStorage>/s1onique.clinemm/roundc-latency-trace.json`).
5. Copy the exported file to a location that will not be overwritten by a later session — e.g.
   `~/Downloads/holdout-<sessionId>.json` — and record:
   - session ID,
   - export path,
   - SHA-256 and byte size,
   - installed extension version and bundle SHA-256,
   - model/provider identity,
   - trace schema, event count, truncation and integrity status,
   - Strata version/configuration identity when observable.
6. Keep the raw exported trace **outside Git**. Do not include private candidate snapshots in any
   committed output.

**Once the artifact exists**, evaluate it with the existing `--trace <path>` option. **No source
edit to `KNOWN_TRACE_LOCATIONS` is necessary** — the option is repeatable, so several exports may
be supplied at once:

```
ENTRY_HEAD=$(git rev-parse HEAD) \
TOOL_SHA256=$(shasum -a 256 .factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/holdout.ts | awk '{print $1}') \
bun .factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/run.ts \
  --trace ~/Downloads/holdout-<sessionId>.json
```

Duplicate exports of the same session are collapsed by SHA-256, and conflicting exports of one
session are rejected wholesale (P0-2 correction). A supplied independent trace that yields zero
eligible attempts is reported as `CAPTURE_INSUFFICIENT` with the exact missing identity or
accounting field (P1 correction), not as `AWAITING_INDEPENDENT_DOGFOOD_SESSION`.

The frozen coefficients are already in place and **must not** be changed, fitted, or optimized
after inspecting the holdout.

## Scope compliance

| Constraint | Status |
|---|---|
| Production estimator changes | NONE |
| Compaction-policy changes | NONE |
| Strata modifications | NONE |
| New runtime diagnostics | NONE |
| Additional shadow inference | NONE |
| Artificial token-padding tests | NONE |
| Full Round C repeat | NONE |
| New estimator coefficient | NONE |
| Branch / worktree / push / PR | NONE |
| Raw traces or private candidate JSON committed | NONE |
| Previous ACT's evidence modified | NONE (empty git diff, hashes re-verified) |
| Filesystem-wide search | NONE (explicit known locations + manifests only) |

## Next evidence requirement

Record the independent-session trace collection as the next required evidence. Once acquired, the
frozen candidates can be evaluated without any refit. If near-limit coverage remains missing after
that, record it as a further evidence requirement rather than manufacturing risk claims — and do
not start another calibration review cycle merely because some statistics are inconclusive.

