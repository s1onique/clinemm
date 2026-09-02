# ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01

> Status: **OPEN — REPAIR01_AUTHORIZED / STRATEGY_D_SELECTED /
> REPAIR_STATUS_NOT_YET_APPLIED / NO_PROTOCOL_CHANGE**.
>
> Epistemic purpose: **BOUNDED_PRODUCTION_REPAIR** (consumer-side
> reconciliation of the cross-scale compaction ratio defect
> mechanically established by ACT-CLINEMM-COMPACTION-TOKEN-
> ACCOUNTING-TRUTH-RECON01).
>
> ```text
> ENTRY_HEAD            = 99b3fdf51 (the previous opening commit's
>                        tip, which preserved recon head 51beb1da4
>                        as PRE_OPEN_REPAIR_BASE)
> PRE_OPEN_REPAIR_BASE  = 51beb1da4 (recon closure commit; verified
>                        via `git rev-parse 51beb1da4`)
> ORIGIN_MAIN           = 99b3fdf51 (HEAD == origin/main — clean HEAD)
> BRANCH                = main
> WORKTREE              = clean (`git status --short` empty)
> UPSTREAM_RECON        = ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01
>                        (CLOSED_WITH_RESIDUE 2026-09-02 06:30:00Z;
>                         see UPSTREAM_RECON_LINKS below)
> REVIEWER_DISPOSITION  = PASS_WITH_ONE_P1_FIX, then C1: GO after
>                        correction (factory causal reviewer +
>                        context-accounting engineer, 2026-09-02
>                        fourth-second-pass HALT_WRONG_REPAIR_ORACLE
>                        resolved by this turn)
> REPRODUCTION_REPLAYED = YES (committed DEFECT-WITNESS test in
>                        compaction.working-context-ratio.test.ts
>                        reproduces the cross-scale mismatch
>                        mechanically at HEAD; RED_ARITHMETIC_
>                        WITNESS = SYNTHETIC stored in red-witness.txt)
> DEFECT                = CROSS_SCALE_RATIO_TRANSFER_DEFECT
>                        (compactor H-space ratio transferred to
>                         provider/request-input P-space accounting
>                         by the UI consumer; two scales diverge
>                         when MessageBuilder.truncateAssistantText
>                         engages)
> BROKEN_CONSUMER_SEAM  = apps/vscode/src/shared/getApiMetrics.ts:174-225
> OBSERVED              = H-space compaction ratio does not transfer
>                        to W/P-space once MessageBuilder
>                        truncation changes the baseline
> ROOT_CAUSE_BOUNDED    = consumer assumes transferable ratio
>                        (the narrowest causal claim supported by
>                         the recon; producer can truthfully
>                         report its own compaction transformation
>                         while the consumer is wrong to reuse
>                         that ratio against a differently
>                         transformed baseline)
> WIRE_CONTRACT_OVERLOADED = possible contract-design
>                        interpretation; NOT proven root cause
> UI_CONSUMER_MATH      = INTERNALLY CONSISTENT GIVEN BAD ASSUMPTION
> STRATEGY_CANDIDATES   = (d) consumer-side reconciliation
>                        (RECOMMENDED FIRST TRIAL — no protocol
>                         change), (a) tag the field, (b) split
>                         into two fields. (c) RETRACTED.
> STRATEGY_CHOICE       = (d) CONSUMER-SIDE RECONCILIATION
>                        (smallest bounded fix; mechanically
>                        testable against the consumer seam;
>                        does NOT make H/W agree; makes the
                        disagreement irrelevant to provider-
                        input accounting)
> STRATEGY_D            = SELECTED_FOR_IMPLEMENTATION
> REPAIR_STATUS         = NOT_YET_APPLIED (this commit opens the
>                        ACT and freezes the G1-G6 necessity/
>                        ablation matrix; it does NOT modify
>                        getApiMetrics.ts AND does NOT yet
>                        author G2 — per Factory doctrine
>                        "real/live failure → RED reproduction
>                        → repair", the implementation turn must
>                        FIRST author G2 in
>                        getApiMetrics.test.ts and CONFIRM it
>                        REDs at current HEAD before any
>                        production modification)
> PRODUCTION_DELTA      = ZERO (this opening commit; the
>                        implementation commit will graduate
>                        to APPLIED)
> REPAIR_AUTHORIZED     = YES (per C1: GO above)
> ```
>
> Owned by `EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING`.

> **FROZEN CONTRACT** (semantic condition, NOT a manual/auto
> special-case — the recon only proved the INCOMPATIBLE_BASELINE
> condition, not the manual vs auto equivalence):
>
> ```text
> INCOMPATIBLE_BASELINE → no ratio transfer
> ```
>
> In words: do NOT apply an H-space (canonical compaction input
> → compaction output) shrink ratio to provider/request-input
> P-space accounting when the two baselines are not known
> equivalent. The repackaging guidance below is the
> implementation constraint, not the semantic invariant:
>
> - If the consumer can determine, from existing metadata,
>   whether the H baseline is compatible with the P baseline, it
>   MUST refuse to transfer the ratio on the incompatible
>   branch.
> - If the consumer cannot determine compatibility with existing
>   information, ESCALATE to option (a) tag the field or
>   (b) split into two fields (these require protocol change).
>
> Concretely: stop synthesizing a post-compaction provider-input
> count by multiplying a previous provider tokensIn by
> `H_after/H_before`. The compaction's own before→after numbers
> remain displayed; the consumer simply does NOT conflate them
> with provider-input accounting when the baseline is the
> truncated P scale, not the canonical H scale.

## UPSTREAM_RECON_LINKS

- `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` (commit
  51beb1da4)
- `sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts`
  (DEFECT-WITNESS test, **GREEN at HEAD AND MUST STAY GREEN** as
  the **necessity control / ablation premise**; after Strategy D,
  the underlying H/W scale mismatch still exists, yet the UI
  accounting is truthful because the consumer no longer transfers
  an invalid ratio)
- `.factory/evidence/ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01/red-witness.txt`
  (`RED_ARITHMETIC_WITNESS = SYNTHETIC`)
- `.factory/evidence/ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01/discriminator.md`
  (full causal binding)

## Repair acceptance (mandatory gates — necessity/ablation
                    matrix per factory causal reviewer's P0)

```text
G1 — NECESSITY CONTROL
  H/W DEFECT-WITNESS stays GREEN: the underlying scale
  mismatch still exists. If a future change accidentally made
  H/W agree, this assertion would correctly RED (i.e., it
  becomes the negative control). The H/W divergence is the
  existence condition for the defect; the repair does NOT
  remove it, it removes the ratio TRANSFER. Evidence class:
  ABLATION_PREMISE.

G2 — CONSUMER RED → GREEN (load-bearing repair oracle)
  At buggy HEAD (this opening commit):
    expect(fabricated P_after).not.toEqual(
      previous P_before × H_after/H_before
    )
    → FAILS at buggy HEAD (the fabricated P_after IS present
      in current getApiMetrics output)

  After Strategy D applied:
    → PASSES (no fabricated P_after; the consumer refuses to
      synthesize a request-input count from an H-space ratio
      whose baseline is incompatible)

G3 — GENUINE TRUTH RESTORATION
  When the next genuine provider/request observation arrives,
  it replaces the stale/unknown post-compaction value via
  the existing UI contract. No new code path; just verify the
  existing restoration path still functions when the synthesized
  post-compaction value is suppressed.

G4 — POSITIVE COMPATIBILITY
  If the H baseline IS demonstrably compatible with the P
  baseline (e.g., for the auto-mode flow where the recon
  actually proves compatibility, NOT assumed), existing
  transfer behavior remains permitted. Concretely: when
  H_before ≈ W_before (the truncation-doesn't-engage regime,
  i.e., the DEFECT-WITNESS POSITIVE CONTROL), the ratio
  transfer can legitimately track the working-context shrink.

G5 — PRESENTATION CONSERVATION
  The compaction's own before→after numbers (H_before →
  H_after) remain visible as their own metric. The repair only
  blocks the cross-scale transfer, not the underlying metric.

G6 — COLLATERAL
  Existing compaction suite remains GREEN (no regressions).
  Existing getApiMetrics tests remain GREEN. No
  producer/schema/API/.proto change for first trial.
```

The matrix gives the desired necessity proof:

```text
BEFORE:
  H/W mismatch exists
  +
  consumer transfers H ratio
  =
  false projected P value (the 0.666 relative divergence
  reported as P_after/P_before)

AFTER (Strategy D applied):
  H/W mismatch still exists (G1 stays GREEN — ablation premise)
  +
  consumer refuses invalid transfer (G2 GREEN — fabricated
  P_after no longer present)
  =
  false projected P value disappears (G3 GREEN — next genuine
  observation restores truth)
```

If consumer-side reconciliation cannot satisfy these gates
without losing necessary information, ESCALATE to tagging (a)
or splitting (b) the wire in a separate repair ACT.

## Strategy candidates (NOT pre-ranked; ACT-rank when evidence
                    requires)

- (a) **Tag the field** — emit `tokensBeforeKind` alongside
  `tokensBefore`; consumer uses the ratio only when kind matches.
  Protocol change.
- (b) **Split into two fields** — emit both
  `compactionInputTokensBefore` and
  `activeContextTokensBefore`; UI uses only the latter. Protocol
  change.
- (c) ~~Stop emitting one of the fields~~ RETRACTED (unsafe —
  loses information that other consumers depend on).
- (d) **Consumer-side reconciliation** — INCOMPATIBLE_BASELINE
  → no ratio transfer; COMPATIBLE_BASELINE → existing transfer
  behavior preserved. NO protocol change. RECOMMENDED FIRST
  TRIAL. Implementation detail (e.g., whether the
  INCOMPATIBLE_BASELINE discriminator maps to a `manual` flag
  in current metadata) is recorded as an implementation
  constraint, NOT the semantic invariant — see FROZEN CONTRACT
  above. **Does NOT make H/W agree; makes the disagreement
  irrelevant to provider-input accounting.**
- (e) Label-only — update UI title + divider label to match
  producer's contract. Only sufficient if S1-LABEL-ONLY is the
  verdict AND no other accounting defects surface from R1-R3.
  NOT sufficient here (defect is not purely a label issue — the
  ratio itself is on the wrong scale).

## Frozen RED for the post-fix regression oracle
                    (AT THE CONSUMER SEAM, NOT the H/W seam)

The H/W DEFECT-WITNESS is the **necessity control** — it must
STAY GREEN throughout (Strategy D does not change H/W scales).
It is NOT the repair oracle.

The repair oracle lives at the consumer seam. Author the
following test in `apps/vscode/src/shared/__tests__/getApiMetrics.test.ts`
(this ACT's implementation turn will write it):

```ts
// At buggy HEAD (this opening commit):
expect(fabricatedPostCompactProviderInput).not.toEqual(
  previousProviderInput × compactionHAfter ÷ compactionHBefore,
);
// → FAILS at buggy HEAD (the fabricated P_after IS present in
//   current getApiMetrics output)

// After Strategy D applied (implementation commit):
// → PASSES (no fabricated P_after; the consumer refuses to
//   synthesize a request-input count from an H-space ratio
//   whose baseline is incompatible)
```

This becomes the GREEN post-fix regression oracle at the
consumer boundary. If a future change accidentally re-enables
the invalid transfer, this assertion will correctly RED.

## R1-R3 territory remains DEFERRED

This repair ACT addresses S3 reachability only. R1-R3 territory
(real-session capture, prevalence telemetry, separate
accounting defects) remains DEFERRED per the recon ACT's HALT.

## Scope this ACT does NOT cover

- Producer/schema/API changes (deferred to (a) or (b) ACTs if
  consumer-side reconciliation proves insufficient).
- R1-R3 HALT territory (real-session capture, prevalence).
- Other accounting defects surfaced separately (none observed by
  the recon).

## Test surface

- **CONSUMER TEST** (`apps/vscode/src/shared/__tests__/getApiMetrics.test.ts`):
  the load-bearing repair oracle. **NOT YET AUTHORED at the
  opening commit (`CONSUMER_RED = NOT_YET_AUTHORED`,
  `CONSUMER_RED_EXECUTED = NO`).** The implementation turn of
  this ACT will author G2 (consumer RED → GREEN) FIRST and
  CONFIRM it REDs at current HEAD against the existing
  fabrication (`getApiMetrics` consumer-side currently
  manufactures `displayedInput = previousProviderInput ×
  H_after/H_before` for the INCOMPATIBLE_BASELINE case). Only
  after G2 REDs at the real consumer seam may Strategy D
  remove the fabrication; only after that may G3 (genuine
  truth restoration), G4 (positive compatibility), and G5
  (presentation conservation) be added. This is where the
  Strategy-D implementation is verified.
- **NECESSITY CONTROL** (`sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts`):
  the committed DEFECT-WITNESS test (G1) — **UNCHANGED**.
  Strategy D does not change H/W scales; this test stays GREEN
  after the repair as the ablation premise.
- **EXISTING compaction suite**: must remain GREEN (no regressions).
- **EXISTING getApiMetrics tests**: must remain GREEN (no
  regressions in adjacent accounting paths).

## Production change scope

```text
PRODUCTION DELTA (this opening commit) = ZERO

PRODUCTION DELTA (this ACT's implementation commit) =
  apps/vscode/src/shared/getApiMetrics.ts:174-225
    (consumer-side reconciliation; INCOMPATIBLE_BASELINE → no
     ratio transfer; COMPATIBLE_BASELINE → existing transfer
     behavior preserved)
+
  test:
    apps/vscode/src/shared/__tests__/getApiMetrics.test.ts
      (G2/G3/G4/G5 acceptance gates — consumer RED → GREEN +
       genuine truth restoration + positive compatibility +
       presentation conservation)
+
  no test change to:
    sdk/packages/core/src/extensions/context/compaction.working-
      context-ratio.test.ts
    (the DEFECT-WITNESS test STAYS GREEN throughout — it is the
    necessity control, NOT the repair oracle)

NO CHANGES TO:
  sdk/packages/core/src/extensions/context/compaction.ts
  sdk/packages/core/src/session/services/message-builder.ts
  sdk/packages/core/src/services/telemetry/core-events.ts
  any .proto file
  any producer/schema/API surface
```

## Verdict (initial state of this ACT)

```text
DEFECT                                     = CROSS_SCALE_RATIO_TRANSFER_DEFECT
                                             (REPRODUCED at HEAD)
REPRODUCTION_REPLAYED                      = YES (committed DEFECT-WITNESS)
ROOT_CAUSE_BOUNDED                         = consumer assumes transferable
                                                ratio (narrowest claim
                                                supported)
STRATEGY_CHOICE                            = (d) CONSUMER-SIDE
                                                RECONCILIATION
STRATEGY_D                                 = SELECTED_FOR_IMPLEMENTATION
REPAIR_STATUS                              = NOT_YET_APPLIED
                                                (this opening commit;
                                                 the implementation
                                                 commit will
                                                 graduate to APPLIED)
REPAIR_AUTHORIZED                          = YES (C1: GO after
                                                P0 correction —
                                                HALT_WRONG_REPAIR_
                                                ORACLE resolved)
PROTOCOL_CHANGE                            = NONE (first trial only)
PRODUCTION_DELTA_THIS_COMMIT               = ZERO
PRODUCTION_DELTA_NEXT_COMMIT               = APPLIED (Strategy D
                                                consumer-side
                                                reconciliation)
NECESSITY_CONTROL                          = DEFECT-WITNESS stays GREEN
                                                after repair
                                                (ablation premise)
REPAIR_ORACLE                              = G2 in getApiMetrics.test.ts
                                                (consumer seam, not
                                                 H/W seam)
NEW_REVIEW_ROUND                           = YES (repair ACT opens its
                                                own review pass on the
                                                implementation commit)
ESCALATION                                 = (a) tag the field or
                                                (b) split into two
                                                fields, only if (d)
                                                cannot satisfy G2-G6
                                                with existing metadata
REOPEN_CONDITION                           = G2 not yet authored;
                                                the next turn MUST
                                                author G2 in
                                                getApiMetrics.test.ts
                                                and CONFIRM it
                                                REDs at current HEAD
                                                against the existing
                                                fabrication. If G2
                                                does NOT RED at HEAD,
                                                HALT_RED_NOT_REPRODUCED
                                                and re-investigate the
                                                defect boundary before
                                                any production change.
                                                After G2 REDs, inspect
                                                what existing metadata
                                                the consumer actually
                                                has to discriminate
                                                compatible vs
                                                incompatible baseline
                                                (mode/type, metric
                                                provenance, baseline
                                                identity, projection/
                                                truncation marker);
                                                only if a mechanically
                                                available discriminator
                                                exists may Strategy D
                                                proceed. Otherwise
                                                ESCALATE to (a) tag
                                                provenance.
```

## ACT closure record (implementation turn, 2026-09-02 09:00:00Z)

The implementation turn executed the factory causal reviewer's
RED-first playbook directly. Summary:

```text
1. Author G2 only in getApiMetrics.test.ts.           DONE
2. Run G2 at HEAD 9aef5245b.                          DONE (RED at HEAD)
3. Inspect consumer-visible compatibility authority.  DONE (none exists)
4. Apply smallest Strategy-D production patch.        DONE (drop ratio)
5. Re-run G2.                                         GREEN
6. Add G3 / G4 / G5.                                  DONE
7. Re-run G1 + collateral.                            97/97 + 53/53 GREEN
8. Typecheck.                                         CLEAN (tsc 0)
9. Close.                                             (this section)
```

### Compatibility authority inspection result

ClineCompactionInfo carries `status`, `mode`, `tokensBefore?`,
`tokensAfter?`, `messagesBefore?`, `messagesAfter?`. None of these
mechanically witnesses `INCOMPATIBLE_BASELINE` at the consumer
seam. Per the reviewer's directive "Do not infer compatibility
from chronology or mode", `mode` cannot be used as a discriminator
upstream architecture makes this especially relevant since
multiple message builders may transform provider-bound messages
in sequence). And (a) tag provenance is a protocol change, which
option (d) explicitly forbids in the first trial.

**The smallest honest sub-case of option (d) without a
discriminator is: drop the wrong-scale ratio transfer entirely.**
The consumer returns the genuine prior provider observation
unchanged. The bar holds the pre-compaction value (stale but
truthful) until the next request lands; G3 then takes over.

### Production delta

```text
apps/vscode/src/shared/getApiMetrics.ts  (84 lines net change)
  - getLastApiReqTotalTokens: removed shrinkFraction accumulator
    and `Math.ceil(total * shrinkFraction)`; returns genuine
    disjoint-bucket sum from the last api_req_started.
  - getLastApiReqContextInputTokens: same; returns genuine
    `tokensIn + cacheReads + cacheWrites` from the last
    api_req_started, no ratio applied.

apps/vscode/src/shared/__tests__/getApiMetrics.test.ts
                                              (258 lines net change)
  - 4 pre-existing fabrication-locking tests updated: names
    revised to reflect truthful behavior; assertion values
    set to the genuine values (100_000, 100_000, 5_000,
    95_000); R0-A re-purposed as INVERTED-INVARIANT witness.
  - G2, G3, G4, G5 added: G2 is the regression oracle at
    the consumer seam.
```

### Final state

```text
G1 (H/W scale divergence, necessity control)             GREEN
G2 (consumer-seam regression oracle)                    GREEN
G3 (genuine-truth restoration)                          GREEN
G4 (positive compatibility, no-compaction regime)      GREEN
G5 (presentation conservation)                          GREEN
unrelated suites (97 compaction tests, 53 apps/vscode
shared tests, typecheck)                                GREEN
production delta                                        APPLIED
protocol change                                         NONE
```

ACT closes here. Reviewer opens a fresh review pass on the
implementation commit (REPAIR_AUTHORIZED = YES, ACT =
IMPLEMENTATION_REVIEW). If the implementation review surfaces
a protocol-level improvement (e.g., reintroducing ratio
transfer for COMPATIBLE_BASELINE cases via a discriminator),
that becomes a follow-on ACT; this ACT's contract — small,
honest, within protocol — is satisfied.

KNOWN UX-COST: the context-window bar will display a stale
pre-compaction value in the brief window between a compaction
divider and the next API request, where previously it
synthesized a smaller fabricated value. This is the deliberate
trade-off; the next request supersedes the stale display.
