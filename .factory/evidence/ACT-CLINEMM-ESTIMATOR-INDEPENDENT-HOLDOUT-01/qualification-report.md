# Qualification report — ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01

## Verdict

**AWAITING_INDEPENDENT_DOGFOOD_SESSION**

No eligible independent dogfood trace exists. The evidence discovery was performed in the
prescribed order against the explicitly known sanitized trace locations, and every surviving
latency-trace export carries the **training** session identity. The previously known independent
export was overwritten at its canonical path and its session predates the authoritative capture
contract, so it is ineligible on two independent grounds.

No holdout statistics are reported. A frozen coefficient was **not** refit, an estimator was
**not** implemented, a compaction policy was **not** changed, and no live session was invented.

## Repository and artifact identity

- Repository: `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm`
- Remote: `git@github.com:s1onique/clinemm.git`
- Branch: `main` (no branch created, no worktree created, no push, no PR)
- **ENTRY_HEAD**: `e5343571df97e5b2ef9c68fe1ddfd32d93acaf31`
- Expected history confirmed: `f87e1547d` (dogfood capture default) → `88f7ce2ca` (offline
  calibration evidence) → `e5343571d` (bounded evidence-identity correction) is HEAD.
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

## Frozen holdout evaluation

**Not performed — no qualified attempt exists.** The pre-registered interpretation for zero
qualified attempts is `CAPTURE_INSUFFICIENT`; however, the pre-registered *operator boundary*
takes precedence: with no eligible independent trace at all, the required disposition is
**`AWAITING_INDEPENDENT_DOGFOOD_SESSION`**, and no empty evidence files were fabricated to
satisfy the deliverable list.

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

### Commands actually executed

| Command | Result | Observed |
|---|---|---|
| `bun test ./.factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/tool/analyze.test.ts` | PASS | 16 pass, 0 fail, 24 expect() calls (T1–T16) |
| `bun test ./.factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/holdout.test.ts` | PASS | 12 pass, 0 fail, 76 expect() calls (V1–V12) |
| `bun test <both files>` | PASS | 28 pass, 0 fail, 100 expect() calls |
| `ENTRY_HEAD=$(git rev-parse HEAD) TOOL_SHA256=$(shasum -a 256 …/tool/holdout.ts) bun …/tool/run.ts` | PASS | 2 exports, both training; `DUPLICATE_EXPORT_SAME_SESSION`; 0 eligible attempts |
| `git diff --stat HEAD -- .factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/` | PASS | empty — previous calibration artifacts byte-identical and untouched (V7) |

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

   - SHA-256 and byte size,
   - installed extension version and bundle SHA-256,
   - model/provider identity,
   - trace schema, event count, truncation and integrity status,
   - Strata version/configuration identity when observable.
6. Keep the raw exported trace **outside Git**. Do not include private candidate snapshots in any
   committed output.

**Once the artifact exists**, add its path to `KNOWN_TRACE_LOCATIONS` in `tool/run.ts` and re-run:

```
ENTRY_HEAD=$(git rev-parse HEAD) \
TOOL_SHA256=$(shasum -a 256 .factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/holdout.ts | awk '{print $1}') \
bun .factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/run.ts
```

The frozen coefficients are already in place and **must not** be changed, fitted, or optimized
after inspecting the holdout.

