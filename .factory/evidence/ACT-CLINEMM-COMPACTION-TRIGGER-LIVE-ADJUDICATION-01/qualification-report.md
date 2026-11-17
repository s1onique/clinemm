# Qualification report — ACT-CLINEMM-COMPACTION-TRIGGER-LIVE-ADJUDICATION-01

## Verdict

# `PASS_OBSERVED_TRIGGER_CAUSALITY`

The actual production decision contract and the authoritative dogfood trace jointly explain
the observed trigger.

**Scope of the qualification.** This qualifies **the one observed event** — the single
automatic compaction in session `1794892591345_7em4g`. It does **not** qualify every possible
compaction scenario, does not qualify the estimator's accuracy in general, and does not
qualify the canonical-evidence continuity question (RC-04).

---

## 1. Entry contract

| Requirement | Observation |
|---|---|
| Repository identity | `s1onique/clinemm` (origin `git@github.com:s1onique/clinemm.git`) |
| Branch | `main` |
| Actual `ENTRY_HEAD` | `5d75a7e635a77d8e55eb9771d33f509c8bd75565` — discovered with `git rev-parse HEAD`, not a predicted SHA |
| Working-tree state at entry | Clean (`git status --short` empty) |
| Eight regenerated RC-01 holdout artifacts committed | **Yes.** Committed in `5d75a7e63 test(clinemm): record independent estimator holdout`; the eight regenerated artifacts are `artifact-hashes.json`, `frozen-candidates.json`, `holdout-comparison.json`, `holdout-manifest.json`, `identity.json`, `join-audit.json`, `safety-discriminators.json`, `test-receipt.json` under `.factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/` |
| Unexpected tracked changes | None → no `HALT_UNEXPECTED_TRACKED_DIRT` |
| Worktrees / stashes / frozen evidence preserved | Untouched. `git worktree list` and `git stash list` were read only; no branch, worktree, push, PR, reset, stash pop or force operation was performed |

**Dispositions not taken:** `HALT_PENDING_RC01_PACKAGING` (RC-01 was packaged and committed),
`HALT_UNEXPECTED_TRACKED_DIRT` (tree was clean).

---

## 2. Authoritative input — identity and completeness

Source trace (read-only, never committed):
`~/Downloads/roundc-latency-trace(8).json`

| Attribute | Expected | Observed | Result |
|---|---|---|---|
| SHA-256 | `b84ee4a83f3819b4a849e2d05f95c044443e3d3fb036818aef98f9b7fe96b5e1` | identical | **MATCH** |
| Session | `1794892591345_7em4g` | identical | **MATCH** |
| Schema | `cline.roundc-latency-trace.v1` | identical | **MATCH** |
| Profile | `dogfood` | identical | **MATCH** |
| Requested model | `qwen3.8-flash-next-iq3_s` | identical | **MATCH** |
| Extension version | `4.1.16-5a1c485cb` | identical | **MATCH** |
| Extension bundle SHA-256 | `b8b63baaebf9b5a12e2a636004695fc4eccbde0fb2bf13b55ccf7107cf83263e` | identical | **MATCH** |
| Events | 418 | `eventCount` 418, `events.length` 418 | **MATCH** |
| Truncation | none | `truncation.truncated = false`, `droppedEventCount = 0`, `retainedEventCount = 418` | **NONE** |
| Integrity failures | 0 | `integrityFailureCount = 0`, `integrityFailures = []` | **0** |
| Completed model requests | 18 | 18 `compaction_decision` events, 18 `provider_completed` events, 18 `request_preparation` events | **MATCH** |
| Compactions | 1 | 1 `compaction` span (start + end) | **MATCH** |

**Bundle identity caveat (preserved).** The recorded extension bundle is an
**installed-runtime identity**, not proof that this repository HEAD produced the bundle. The
trace's own `identity.sourceHead` is `UNAVAILABLE_FROM_TRACE`. `identity.json` records the
bundle under `installedExtension.authority =
"INSTALLED_RUNTIME_IDENTITY_ONLY"`.

**Unavailable records.** 13, all on the `provider_first_text` boundary ("the provider did not
report this event"). **No compaction boundary is affected.** No compaction-relevant runtime
boundary is missing.

**Privacy.** The raw trace is not committed. No private message, prompt or tool payload was
copied into evidence. Every emitted value is a scalar, a classification, an opaque identifier
or a digest.

---

## 3. Causal discriminator

### 3.1 The production contract

From `sdk/packages/core/src/extensions/context/compaction.ts` (ENTRY_HEAD
`5d75a7e635a77d8e55eb9771d33f509c8bd75565`):

```
rawMaxInputTokens      = resolveEffectiveMaxInputTokens(model.info)      // 128000 × 0.9 = 115200
ceilingAdjusted        = applyUserContextCeiling(rawMax, userCeiling)    // min(...) — may only reduce
underestimateFactor    = min(4, max(1, actualPreviousInputTokens / requestInputTokens))
maxInputTokens         = rawMaxInputTokens / underestimateFactor
requestTriggerTokens   = maxInputTokens × COMPACTION_TRIGGER_RATIO       // 115200 × 0.9 = 103680
shouldCompact          = requestInputTokens >= requestTriggerTokens
```

and in `auto` mode the seam returns `undefined` — **no compaction work at all** — when
`shouldCompact` is false (`compaction.ts:908-910`).

### 3.2 The decisive evidence

All 18 decisions were reconstructed from the trace and joined by `sessionId`, `decisionId`,
`decisionOrdinal`, `preparationRequestId` and boundary identity. Every decision's
`decisionJoinAuthority` is `AUTHORITATIVE`.

| Check | Expected | Observed | Result |
|---|---|---|---|
| Decision #12 (`#12#11`, `req_B3-Yjnop`) arithmetic | 97,741 + 5,695 = **103,436** | `apiMessageTokens` 97,741, `requestOverheadTokens` 5,695 → 103,436 | **EXACT** |
| Decision #12 threshold | **103,680** | `requestTriggerTokens` 103,680 | **EXACT** |
| Decision #12 outcome | `shouldCompact=false` | `shouldCompact=false`, `compactionInitiated=false` | **EXACT** |
| Decision #13 (`#13#12`, `req_wdW3TYdm`) arithmetic | 102,585 + 5,695 = **108,280** | `apiMessageTokens` 102,585, `requestOverheadTokens` 5,695 → 108,280 | **EXACT** |
| Decision #13 threshold | **103,680** | `requestTriggerTokens` 103,680 | **EXACT** |
| Decision #13 outcome | `shouldCompact=true`, `compactionInitiated=true` | both `true` | **EXACT** |
| Actual preceding provider input | **83,984** | `actualPreviousInputTokens` 83,984; and `req_B3-Yjnop`'s own `provider_completed.inputTokens` = 83,984 | **EXACT** |
| Compaction duration | ≈ **64,564 ms** | `durationMs = 64,564.481` | **EXACT (within 1 ms)** |

The trigger threshold is reproduced **from first principles** by the production code:
`contextWindow 128000 × CONTEXT_WINDOW_INPUT_RATIO 0.9 = 115200`, then
`115200 × COMPACTION_TRIGGER_RATIO 0.9 = 103680`. The captured `userContextCeiling` of 128,000
cannot expand the canonical 115,200 (`applyUserContextCeiling` takes the minimum), so the
effective budget is the model's own.

### 3.3 Hypothesis A — CONFIRMED

> *Hypothesis A: compaction was caused by the current request's projected input crossing the
> configured trigger.*

**Confirmed.** The current request's production projection (108,280) crossed the configured
trigger (103,680) under the production `>=` branch, and the previous request's projection
(103,436) did **not**. The boundary is exactly where the contract says it is.

**Direct source evidence.** `compaction.ts:692` computes `shouldCompact` from
`requestInputTokens` — the estimate of the **candidate** — against `requestTriggerTokens`.
`compaction.ts:908-910` initiates compaction **only** when that comparison is true.

**Direct trace evidence.** All 18 decisions satisfy the production branch exactly:
`productionBranchInconsistencyCount = 0`. The 18-decision census (full per-decision record in
`decision-audit.json`) shows a single trigger, at ordinal 12 — the 13th decision — and the
threshold is constant at 103,680 across the whole session.

### 3.4 Hypothesis B — REFUTED

> *Hypothesis B: compaction was caused primarily by previous provider usage, a stale context
> authority, a different budget, or another mechanism.*

**Refuted, on four independent grounds.**

1. **The previous provider usage did not move the budget.** At decision #13,
   `actualPreviousInputTokens = 83,984` and `underestimateFactor = 1`, so
   `maxInputTokens = 115200 / 1 = 115200` and the trigger stayed 103,680. The production
   underestimate correction only engages when the estimate **under-counts** the previous
   provider usage; here it did not. `underestimateFactor` was `1` at **every one of the 18
   decisions**, and the trigger was constant at 103,680 throughout.
2. **The budget was the model's own, not a stale or different one.**
   `inputBudgetSource = "contextWindow"`, `effectiveMaxInputTokens = 115200`,
   `rawMaxInputTokens = 115200`. The trigger reproduces exactly from the production constants.
3. **The trigger was not caused by a later execution boundary.** The decision was published at
   `mono = 550,327.2` with `shouldCompact = true`, and the compaction span opened at the same
   instant (`mono = 550,327.2`). The previous decision (#12) had published
   `shouldCompact = false` at `mono = 518,461.8` and no compaction span was opened for it.
4. **A direct control against Hypothesis B was executed.** The disposable offline probe drove
   the **real** production seam with the decision #12 estimate magnitude but the trigger
   decision's previous provider usage (83,984). It classified as `shouldCompact=false` with
   `underestimateFactor = 1` and `requestTriggerTokens = 103680`. The previous usage alone
   does not cause a compaction.

### 3.5 The production seam predicts these decisions

The disposable offline probe drove the **real** `createContextCompactionPrepareTurn` with the
captured dogfood configuration (`contextWindow 128000`, `userContextCeiling 128000`,
`openai-compatible` / `qwen3.8-flash-next-iq3_s`) and read the production decision payload
directly:

- the captured budget authority reproduced exactly (`rawMaxInputTokens` 115200,
  `maxInputTokens` 115200, `requestTriggerTokens` 103680, `inputBudgetSource` contextWindow,
  `effectiveMaxInputTokens` 115200, `userContextCeiling` 128000);
- the last non-trigger magnitude → `shouldCompact=false`, `compactionInitiated=false`;
- the first-trigger magnitude → `shouldCompact=true`, `compactionInitiated=true`;
- the Hypothesis B control → `shouldCompact=false`.

**4 passed (4).** The probe was disposable and has been **deleted**; it is not committed.

---

## 4. Representation boundaries — preserved

### 4.1 The triggered candidate was never submitted

| | Pre-compaction candidate | Post-compaction request |
|---|---|---|
| Preparation request id | `req_wdW3TYdm` | `req_wdW3TYdm` |
| Working-context messages at decision | **34** | — |
| Messages in the request actually prepared | — | **6** |
| Token count | **108,280 — production ESTIMATE, `UNLABELLED`** | **15,607 — PROVIDER_REPORTED** |
| Submitted to the provider | **No** | Yes |

The decisive ordering proof, from the trace's own monotonic clock:

```
compaction_decision   start   mono 550327.2   34 messages   shouldCompact=true
compaction            start   mono 550327.2
compaction            end     mono 614891.7   duration 64,564.481 ms
                                             34 → 6 messages, 20 → 3 evidence refs
request_preparation   start   mono 615004.3    6 messages   ← AFTER the compaction ended
provider_submitted    start   mono 615004.7
provider_completed    start   mono 643303.5   inputTokens = 15,607
```

The request carrying `req_wdW3TYdm` was **prepared after** the compaction span closed, with
the 6-message post-compaction representation. The 34-message, 108,280-token candidate was
never prepared for submission and never reached the provider.

### 4.2 The unsupported-attribution guard

The **15,607-token provider response is NOT the token count of the unsubmitted 108,280-token
pre-compaction projection.** The adjudicator asserts the two values differ and records the
pre-compaction candidate's provider usage as `null` with authority
`UNLABELLED`. `decision-audit.json` carries this as
`representationBoundary.unsupportedAttributionGuard`.

### 4.3 The dropped working-context references

`compactionEvidenceRefsBefore = 20` → `compactionEvidenceRefsAfter = 3`, i.e. **17 dropped**
(0 replaced). Recorded as **OBSERVATION ONLY**. Whether the corresponding canonical evidence
survived belongs to **RC-04**, not to this ACT. This ACT makes no claim about it.

---

## 5. Evidence classification

| Fact | Classification | Authority |
|---|---|---|
| `requestTriggerTokens = 103,680` | **PRODUCTION_VALUE** | Published by the production seam; reproduces from the production constants |
| `requestInputTokens` (103,436 / 108,280) | **PRODUCTION_ESTIMATE** | Reconstructed by exact identity (`apiMessageTokens + requestOverheadTokens`) from the allowlisted fields; verified against the real production seam |
| `actualPreviousInputTokens = 83,984` | **PROVIDER_REPORTED** | The provider's usage for the **previous submitted** request (`req_B3-Yjnop`) |
| `inputTokens = 15,607` | **PROVIDER_REPORTED** | The provider's usage for the **submitted post-compaction** request |
| The 34-message candidate's token count | **UNLABELLED** | Never submitted; no provider ever reported usage for it |
| `compactionEvidenceRefsDropped = 17` | **OBSERVATION_ONLY** | RC-04 scope |
| Extension bundle SHA-256 | **INSTALLED_RUNTIME_IDENTITY** | Not a source identity |

---

## 6. Executed gates

All gates were executed in this session and their output observed.

| # | Gate | Result |
|---|---|---|
| G1 | Trace identity, SHA-256, schema and completeness (offline adjudicator) | `identityComplete: true` |
| G2 | Exact 18-decision census preserving decision identities | `observedDecisionCount: 18`, `decisionCountMatches: true`, `triggeredDecisionCount: 1`, `observedCompactionSpanCount: 1` |
| G3 | Arithmetic and classification for the last non-trigger and first trigger | `sumMatches: true` × 2, `observedMatches: true` × 2, `decisiveChecksPassed: true` |
| G4 | Direct consistency with the actual production decision branch | `productionBranchInconsistencyCount: 0` (all 18) |
| G5 | Exact pre-compaction vs post-compaction representation distinction | `preparedAfterCompactionEnded: true`, `projectionChangedBeforeSubmission: true`, `unsupportedAttributionGuard.guardSatisfied: true`, `droppedWorkingContextReferences.matches: true`, `compactionOutcome.durationMsMatches: true` |
| G6 | No unsupported attribution of provider token usage to an unsubmitted request | enforced in the artifact schema (`providerReportedInputTokens: null`, authority `UNLABELLED`) and asserted by G5 |
| G7 | Production compaction suites (real seam) | `bun x vitest run --config vitest.config.ts` over 6 files → **Test Files 6 passed (6); Tests 69 passed \| 1 skipped (70)** |
| G8 | Disposable offline probe against the **real** production seam | **Test Files 1 passed (1); Tests 4 passed (4)** |
| G9 | Frozen calibration coefficients / historical RC-01 evidence unmodified | `git diff --name-only HEAD` over `sdk/`, `apps/`, `src/` → **empty**; the RC-01 evidence directory is byte-identical to `5d75a7e63` |
| G10 | Production source unchanged | `git diff --stat HEAD -- sdk/ apps/` → **empty**. No estimator, policy, coefficient, Strata, protocol or telemetry change. |
| G11 | No raw trace, private message, prompt or tool payload committed | the raw trace path is outside the repository; the committed artifacts contain only scalars, classifications, opaque ids and digests |
| G12 | No new branch, worktree, push, PR, reset, stash pop or force operation | none performed |

---

## 7. Scope compliance

| Hard constraint | Status |
|---|---|
| No changes to the production estimator or compaction policy | **Honoured** |
| No coefficient refitting | **Honoured** |
| No Strata modifications | **Honoured** |
| No synthetic request inflation | **Honoured** — the probe's filler sizes were chosen to *reproduce the captured magnitudes*, not to inflate them; the decisive assertions are the production branch's classifications and budget arithmetic |
| No additional dogfood run | **Honoured** — the preserved trace was sufficient |
| No diagnostic side effects inside React functional updaters | **Honoured** — no React code touched |
| No new always-on telemetry or permanent API/protocol fields | **Honoured** — the offline adjudicator is evidence-only; the probe was deleted |
| No raw trace in Git | **Honoured** |
| No unrelated cleanup | **Honoured** |
| No second review cycle without a new P0 | **Honoured** |
| At most one small, disposable offline probe | **Honoured** — exactly one, and it was deleted after execution |

**Defect status.** No source-level mismatch was reproduced. The production branch and the
authoritative trace agree exactly at all 18 decisions. Accordingly **no RED test was
manufactured for an unreproduced defect**, and no repair was made. This ACT produced
**evidence only**.

---

## 8. Principal disposition

# `PASS_OBSERVED_TRIGGER_CAUSALITY`

The actual production decision contract and the authoritative trace jointly explain the
observed trigger. The event is **explained**: the current request's production projection
crossed the configured trigger exactly where the production `>=` branch says it should have.
This qualifies the observed event only.

---

## 9. Board implications (recorded in `.factory/epic-board.md`)

- **RC-02** — observed trigger causality **qualified**, with explicit scope: one observed
  event, one session; the production `>=` contract and the trigger budget are confirmed
  against the authoritative trace at all 18 decisions.
- **RC-04** — canonical evidence continuity **remains open**. The 17 dropped
  working-context references are recorded as an observation only.
- **RC-01** — independent calibration **remains replicated**; **no production deployment**.
  No coefficient was refit and no production estimator changed by this ACT.
