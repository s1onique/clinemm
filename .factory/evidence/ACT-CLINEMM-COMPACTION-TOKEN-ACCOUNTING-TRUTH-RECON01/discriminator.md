# Discriminator execution report — working-context ratio

**Authored 2026-09-02.**

**Status:** EXECUTED. Discriminator results committed; S3 wire-contract-
overload REPRODUCED at the real production working-context seam.

## Harness

Drives `createCompactionStateAwarePrepareTurn` twice against identical
canonical state with exactly one manual compaction applied between captures.
Both captures invoke the same production state-aware prepareTurn seam;
the only difference is the compaction artifact installed via `saveState`.

Invariants (per factory causal reviewer's fourth-review-second-pass
PASS_WITH_ONE_P1_FIX, 2026-09-02):

```text
NON_MESSAGE_INPUTS_BEFORE == NON_MESSAGE_INPUTS_AFTER  (systemPrompt,
                                                         tools, model)
CANONICAL_BEFORE          == CANONICAL_AFTER           (identical
                                                         message array)
ONLY_MUTATED_AUTHORITY    == compactionState           (only saveState
                                                         differs)
```

`buildForApi` is invoked through a FRESH `MessageBuilder` per capture
(production rebuild-fresh-Message-objects pattern; the per-instance
`committedOutdatedRewrites` cache is intentionally not carried across A/B).
Source-verified: `MessageBuilder.buildForApi(messages: Message[]): Message[]`
accepts only its message argument and references no `compactionState`,
`session.compaction`, `currentCompaction`, or `compactionMode` parameters
(`sdk/packages/core/src/session/services/message-builder.ts:166`).

## Estimator

`estimateRequestInputTokens({systemPrompt, messages, tools})` from
`@cline/shared` — the canonical estimator that the producer's
`tokensBefore = estimate(systemPrompt + apiMessages + tools)` contract
calls. The discriminator uses the SAME estimator for both H and W so the
ratio comparison is on a single, consistent token basis.

## Tolerance

`RELATIVE_TOLERANCE = 0.10` — i.e., a 10% relative divergence between
`manualRatio` and `workingContextRatio` triggers `S3_REPRODUCED`. The
relative (not absolute) form is required because both ratios can be near
zero in heavy-compaction regimes; an absolute threshold would be
meaningless.

```text
relativeDiff = |manualRatio - workingContextRatio| /
                max(manualRatio, workingContextRatio, 1e-9)
verdict      = S3_REPRODUCED if relativeDiff > 0.10
               S3_RATIO_TRANSFER_NOT_REPRODUCED otherwise
```

## Cases

### Case 1 — trivial canonical history (small messages)

```text
canonical = 7 short messages (< 200K cap each)
manualRatio = 0.00718 (17555 → 126 chars)
workingContextRatio = 0.00718 (17555 → 126 chars)
verdict = S3_RATIO_TRANSFER_NOT_REPRODUCED
```

The compactor's ratio correctly predicts the working-context shrink
because buildForApi does not transform the small inputs. Ratios are
bit-identical.

### Case 2 — realistic canonical history (assistant text > 200K cap)

```text
canonical = 7 messages with 3 assistant texts of 600K chars each
            (engages MessageBuilder.truncateAssistantText at
            DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 200K)

manualRatio           = 0.000210  (600200 → 126 chars)
workingContextRatio   = 0.000629  (200186 → 126 chars)
relativeDiff          = 0.666     (66.6%)

verdict = S3_REPRODUCED
```

The compactor's claim of "99.98% reduction" overstates the actual
working-context shrink of "99.94%" by ~3×. The UI consumer at
`getApiMetrics.ts:174-225` applies the manual compactor's ratio to
provider-bound tokensIn. Applied to a hypothetical 100K-token
post-compaction active context, the UI would predict:
- `100000 × manualRatio = 21` tokens
- but the actual shrink produces `100000 × workingContextRatio = 63`
  tokens
- The UI displays a 3× lower figure than reality.

The defect is exactly what the recon predicted: the compactor
measures its own input/output (raw canonical → tiny summary) and
emits a shrink ratio on that scale. The UI consumer applies that
ratio to provider-bound tokensIn (which has ALREADY been processed
by buildForApi's truncation budgets). The two scales differ when
the working context is large enough to engage buildForApi's
budgets.

## Verdict (CAUSAL, not overclaimed)

**S3 REPRODUCED at the real production working-context seam.**

- The wire contract is overloaded: `tokensBefore` is emitted on the
  compactor's input scale (raw canonical) but the UI consumer applies
  the resulting ratio to provider-bound tokensIn (buildForApi output
  scale). When the working context engages buildForApi's truncation
  budgets, the two scales diverge.

- The defect is in the **wire / schema** (the producer emits a number
  on scale H without a `kind` discriminator), NOT in the producer's
  transformation (which is correct on its own terms), NOT in the UI
  consumer's math (which is correct given the wrong assumption), and
  NOT in the compactor entry points (which correctly implement their
  design intent of "intentionally summarizes the full canonical
  transcript").

- R1-R3 remain deferred (per the reviewer's HALT). This S3 verdict
  does NOT auto-prove S1-LABEL-ONLY or eliminate other accounting
  defects. Other defects may remain — the UI title still claims S2
  ("Current tokens used in this request"), and `getApiMetrics.ts`
  has its own rescaling logic that may or may not introduce additional
  defects.

## Repair options (NOT RANKED, sequenced into a separate ACT)

These are the bounded fixes that the recon enumerated. They are
NOT ranked here — the Factory doctrine prefers the smallest, which
may be (d) consumer-side reconciliation, but the ranking is for
the downstream repair ACT (`ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-
REPAIR01`), not this recon.

- (a) Tag the field — emit `tokensBeforeKind` alongside
  `tokensBefore`; consumer uses the ratio only when kind matches.
- (b) Split into two fields — `compactionInputTokensBefore` AND
  `activeContextTokensBefore`; UI uses only the latter.
- (c) RETRACTED as unsafe (per first-review).
- (d) Consumer-side reconciliation — for manual mode, do NOT
  rescale tokensIn (use a neutral divider label); for auto mode,
  keep the current rescaling.
- (e) Label-only — update UI title + divider label to match the
  producer's actual contract. Only sufficient if S1-LABEL-ONLY
  is the verdict AND no other accounting defects surface from
  R1-R3.

## Reopen-condition checklist

The fourth-review-second-pass PASS_WITH_ONE_P1_FIX prescribed
this checklist. Status:

- [x] **Identify the real producer of post-compaction working
      messages.** Done: `createCompactionStateAwarePrepareTurn`
      at `sdk/packages/core/src/extensions/context/compaction.ts:672-712`,
      driving `projectSessionCompactionState` at
      `sdk/packages/core/src/session/models/session-compaction.ts:161-193`.
- [x] **Verify buildForApi does not independently read mutable
      compaction state.** Done by source inspection of
      `MessageBuilder.buildForApi(messages: Message[]): Message[]`
      at `sdk/packages/core/src/session/services/message-builder.ts:166`.
      No `compactionState`, `session.compaction`,
      `currentCompaction`, or `compactionMode` parameters.
- [x] **Author the corrected discriminator formula.** Done: see
      `working-context-seam-recon.md` and this report. W rebound
      to the production state-aware prepareTurn seam.
- [x] **Execute the discriminator.** Done: this report.

## Production code delta

Zero. The discriminator is recon (test evidence) only; no
production code changed. The test file is added under
`sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts`.

## Test file

```text
sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts
```

## Validation

```text
bun x vitest run sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts
  → 3 tests passed, 0 failed

bun x vitest run sdk/packages/core/src/extensions/context/compaction.test.ts
  → 94 tests passed, 0 failed (no regressions)
```
