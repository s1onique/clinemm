# Discriminator execution report — working-context ratio

**Authored 2026-09-02. Recalibrated 2026-09-02 (Factory form review).**

## Status

- **EXECUTED** — the discriminator harness reaches the real production
  working-context seam via `createCompactionStateAwarePrepareTurn` and
  applies one manual compaction between captures.
- **OBSERVED MISMATCH (REPRODUCED IN SYNTHETIC-REAL COMPOSITION)** —
  in the realistic case, `manualRatio = 0.000210` and
  `workingContextRatio = 0.000629`, with relative divergence
  `0.666` (66.6%). The relative divergence exceeds
  `RELATIVE_TOLERANCE = 0.10`.
- **RED WITNESS CAPTURED** — the reviewer-recommended strong Factory
  form (`expect(relativeDiff).toBeLessThanOrEqual(0.10)`) fails at
  HEAD with `"expected 0.666... to be less than or equal to 0.1"`.
  See `red-witness.txt` for the captured diagnostic.
- **DEFAULT-SUITE GREEN** — the committed test file uses the
  inverse assertion (`expect(relativeDiff).toBeGreaterThan(0.10)`)
  so the suite is GREEN at HEAD today (the defect IS
  reproducible) and would RED if the defect ever disappears. The
  RED witness is preserved in `red-witness.txt` for posterity.
- **ROOT_CAUSE NOT YET PROMOTED** — see "Causal ownership"
  section below.

## Harness

Drives `createCompactionStateAwarePrepareTurn` twice against
identical canonical state with exactly one manual compaction
applied between captures. Both captures invoke the same
production state-aware prepareTurn seam; the only difference is
the compaction artifact installed via `saveState`.

### Side-channel invariant (per factory reviewer's
   fourth-review-second-pass PASS_WITH_ONE_P1_FIX)

```text
NON_MESSAGE_INPUTS_BEFORE == NON_MESSAGE_INPUTS_AFTER
CANONICAL_BEFORE          == CANONICAL_AFTER
ONLY_MUTATED_AUTHORITY    == compactionState
```

- `systemPrompt`, `tools`, `model`, and all other non-message
  inputs are identical between A and B.
- canonical history is identical between A and B.
- the only state change between A and B is the compaction
  artifact.
- `buildForApi` is invoked through a FRESH `MessageBuilder` per
  capture (production rebuild-fresh-Message-objects pattern;
  the per-instance `committedOutdatedRewrites` cache is
  intentionally not carried across A/B).
- Source-verified: `MessageBuilder.buildForApi(messages:
  Message[]): Message[]` at
  `sdk/packages/core/src/session/services/message-builder.ts:166`
  accepts only its message argument and references no
  `compactionState`, `session.compaction`, `currentCompaction`,
  or `compactionMode` parameters. The base builder receives
  compaction only through its message argument.

### Estimator

`estimateRequestInputTokens({systemPrompt, messages, tools})`
from `@cline/shared` — the canonical estimator that the
producer's `tokensBefore = estimate(systemPrompt + apiMessages +
tools)` contract calls. The discriminator uses the SAME estimator
for both H and W so the ratio comparison is on a single,
consistent token basis.

### Tolerance

`RELATIVE_TOLERANCE = 0.10` — i.e., a 10% relative divergence
between `manualRatio` and `workingContextRatio` triggers
`S3_REPRODUCED`. The relative (not absolute) form is required
because both ratios can be near zero in heavy-compaction regimes.

```text
relativeDiff = |manualRatio - workingContextRatio| /
                max(manualRatio, workingContextRatio, 1e-9)
verdict      = S3_REPRODUCED if relativeDiff > 0.10
               S3_RATIO_TRANSFER_NOT_REPRODUCED otherwise
```

## Evidence class

The observation is **SYNTHETIC-REAL**: synthetic canonical history
and synthetic `manualCompact()` implementation drive the **real**
production seams (`createCompactionStateAwarePrepareTurn` and
`MessageBuilder.buildForApi`). The reachability of the
cross-scale ratio-transfer mismatch is mechanically established;
the prevalence in production telemetry remains DEFERRED per
R1-R3 HALT.

## Cases

### Case 1 — GREEN positive control (small canonical,
            buildForApi does not engage truncation)

```text
canonical = 7 short messages (< 200K cap each)
manualRatio           = 0.00718  (17555 → 126 chars)
workingContextRatio   = 0.00718  (17555 → 126 chars)
relativeDiff          = 0         (bit-identical)
verdict               = S3_RATIO_TRANSFER_NOT_REPRODUCED
```

Test asserts:
```ts
expect(wBefore.estimate).toBeLessThan(wBefore.estimate + 1); // sanity
expect(relativeDiff).toBeLessThanOrEqual(RELATIVE_TOLERANCE);
expect(verdict).toBe("S3_RATIO_TRANSFER_NOT_REPRODUCED");
```

The compactor's ratio correctly predicts the working-context
shrink because buildForApi does not transform the small inputs.
This is the GREEN positive control: when the canonical history
stays under the assistant-text cap, the two scales are
equivalent.

### Case 2 — RED-defect witness (realistic canonical,
            buildForApi DOES engage truncation)

```text
canonical = 7 messages with 3 assistant texts of 600K chars each
            (engages MessageBuilder.truncateAssistantText at
            DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 200K)

manualRatio           = 0.000210  (600200 → 126 chars)
workingContextRatio   = 0.000629  (200186 → 126 chars)
relativeDiff          = 0.666     (66.6%)

verdict = S3_REPRODUCED
```

Test asserts:
```ts
// causal control #1: scale divergence exists BEFORE compaction
expect(wBefore.estimate).toBeLessThan(hBefore.before);
// causal control #2: compactor's H scale < working-context W scale
expect(manualRatio).toBeLessThan(workingContextRatio);
// causal control #3 (LOAD-BEARING): relativeDiff > 0.10
expect(relativeDiff).toBeGreaterThan(RELATIVE_TOLERANCE);
// causal control #4: verdict categorical match
expect(verdict).toBe("S3_REPRODUCED");
```

The reviewer-recommended strong Factory form is
`expect(relativeDiff).toBeLessThanOrEqual(0.10)`. Captured RED
output (see red-witness.txt):

```
AssertionError: expected 0.6664678440519827 to be less than or equal to 0.1
```

This is the load-bearing RED: the compactor's claim of
"99.98% reduction" overstates the actual working-context
shrink of "99.94%" by ~3×. The cross-scale ratio-transfer
mismatch is real and reproducible at the real production
seam.

## Interpretation of scale divergence

The compactor measures its own input/output (raw canonical →
tiny summary) and the resulting ratio lives on the H scale:
        compactor = estimator(canonical input) / estimator(compactor output)
The UI consumer at getApiMetrics.ts:174-225 applies that ratio
to provider-bound tokensIn (which has ALREADY been processed
by buildForApi's truncation budgets) — i.e., the UI rescaling
implicitly assumes the compactor ratio tracks the
working-context shrink.

When the working context is large enough to engage
buildForApi's truncation budgets (the realistic case; the
defect is reachable at any history where assistant text > 200K),
the two scales diverge because buildForApi's truncation has
ALREADY done some of the shrinkage the compactor assumes is
undone.

## Causal ownership (CAUSAL, not overclaimed)

This experiment establishes, mechanically:

1. **manual-compaction ratio (H scale) ≠ working-context
   shrink ratio (W scale)** when canonical history engages
   buildForApi's truncation budgets.
2. `getApiMetrics.ts:174-225` applies the H scale ratio to
   provider-bound tokensIn (a P scale quantity).
3. The cross-scale ratio-transfer assumption is invalid.

What this **does NOT yet establish**:

- That the producer (`core-events.ts:773`) is contractually
  obligated to emit a ratio that supports this consumer-side
  rescaling. The semantic-contract recon (see
  `semantic-contract-recon.md`) established that the producer
  is allowed to report the transformation over its supplied
  input. Whether the published `tokensBefore`/`tokensAfter`
  fields are *contractually* meant to support cross-scale
  rescaling remains a contract-design question, not
  mechanically settled.
- That the UI consumer's rescaling math is wrong *on its own
  terms*. Given the wrong assumption (cross-scale ratio
  transfer), the math is internally consistent; the bug is
  in the assumption, not the calculation.

Better-bounded state of the world:

```text
ROOT_CAUSE                      = NOT_YET_PROMOTED
LIKELY_CAUSE                    = CROSS_SCALE_RATIO_TRANSFER_ASSUMPTION
BROKEN_CONSUMER_SEAM            = getApiMetrics.ts:174-225 applies
                                  compactor H-space ratio to provider-input
                                  P-space tokensIn
WIRE_CONTRACT_OVERLOADED        = POSSIBLE REPAIR/CONTRACT INTERPRETATION,
                                  NOT uniquely proven root cause
UI_CONSUMER_MATH                = INTERNALLY CONSISTENT GIVEN BAD ASSUMPTION
PRODUCER_CONTRACT               = TRANSFORMATION on supplied input (allowed;
                                  whether ratio supports cross-scale rescaling
                                  is a contract design question, not yet
                                  proven)
```

## Repair options (NOT RANKED in this recon, sequenced into
                    ACT-CLINEMM-COMPACTION-WIRE-CONTRACT-REPAIR01)

The smallest-bounded fix is **(d) consumer-side reconciliation**:
stop transferring the H-space ratio across incomparable scales
in the UI consumer. This is the recommended FIRST trial per
Factory doctrine, because it does not require protocol-level
schema changes and is mechanically testable against the same
discriminator.

```text
(a) Tag the field — emit tokensBeforeKind alongside tokensBefore;
    consumer uses the ratio only when kind matches.
(b) Split into two fields — compactionInputTokensBefore AND
    activeContextTokensBefore; UI uses only the latter.
(c) RETRACTED as unsafe (per first-review).
(d) Consumer-side reconciliation — for manual mode, do NOT
    rescale tokensIn (use a neutral divider label); for auto
    mode, keep current rescaling. RECOMMENDED FIRST TRIAL.
(e) Label-only — update UI title + divider label to match the
    producer's actual contract. Only sufficient if S1-LABEL-ONLY
    is the verdict AND no other accounting defects surface from
    R1-R3. NOT sufficient here because the defect is NOT purely
    a label issue — the ratio itself is on the wrong scale.
```

## Reachability vs prevalence

**Reachability:** mechanically established — the discriminator
constructs canonical histories large enough to engage
buildForApi's 200K assistant-text cap, and the
cross-scale mismatch is observed with 66.6% relative
divergence.

**Prevalence in production telemetry:** DEFERRED (R1-R3 HALT).
Not asserted by this recon; would require a real-session
capture to establish.

The recon does NOT claim "real sessions routinely exceed 200K
of assistant text" — only that the defect is reachable for
histories large enough to engage the 200K cap.

## Reopen-condition checklist

The fourth-review-second-pass PASS_WITH_ONE_P1_FIX prescribed
this checklist. Status:

- [x] Identify the real producer of post-compaction working
      messages. Done:
      `createCompactionStateAwarePrepareTurn` at
      `sdk/packages/core/src/extensions/context/compaction.ts:672-712`,
      driving `projectSessionCompactionState` at
      `sdk/packages/core/src/session/models/session-compaction.ts:161-193`.
- [x] Verify buildForApi does not independently read mutable
      compaction state. Done by source inspection of
      `MessageBuilder.buildForApi(messages: Message[]): Message[]`
      at
      `sdk/packages/core/src/session/services/message-builder.ts:166`.
      No `compactionState`, `session.compaction`,
      `currentCompaction`, or `compactionMode` parameters.
- [x] Author the corrected discriminator formula. Done: see
      `working-context-seam-recon.md` and this report. W rebound
      to the production state-aware prepareTurn seam.
- [x] Add a true invariant assertion (relativeDiff > tolerance)
      rather than a logged observation. Done in the committed
      test file; RED witness captured in `red-witness.txt`.
- [x] Calibrate causal ownership to NOT overclaim
      "WIRE_CONTRACT_OVERLOADED" before contract evidence
      uniquely assigns responsibility to the wire. Done: see
      "Causal ownership" section above.

## Production code delta

Zero. The discriminator is recon (test evidence) only; no
production code changed. The test file lives under
`sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts`.

## Test file

```text
sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts
```

## Validation

```text
bun x vitest run sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts
  → 3 tests passed, 0 failed
    • GREEN: positive control (no truncation engaged)
    • RED-WITNESS: realistic case (truncation engaged) — asserts
      the observed mismatch is currently reproducible; would
      RED if the defect ever disappears
    • buildForApi side-channel invariant confirmation

bun x vitest run sdk/packages/core/src/extensions/context/compaction.test.ts
  → 94 tests passed, 0 failed (no regressions)

One-time RED capture (file removed after capture):
  → AssertionError: expected 0.6664678440519827 to be less
    than or equal to 0.1
  → Captured in red-witness.txt
```
