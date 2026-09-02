# ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01

> Status: **OPEN — REPAIR01_AUTHORIZED / REPRODUCTION_REPLAYED /
> STRATEGY_D_FIRST_TRIAL / NO_PROTOCOL_CHANGE**.
>
> Epistemic purpose: **BOUNDED_PRODUCTION_REPAIR** (consumer-side
> reconciliation of the cross-scale compaction ratio defect
> mechanically established by ACT-CLINEMM-COMPACTION-TOKEN-
> ACCOUNTING-TRUTH-RECON01).
>
> ```text
> ENTRY_HEAD            = 51beb1da4 (verified via `git rev-parse HEAD`)
> ORIGIN_MAIN           = 51beb1da4 (HEAD == origin/main — clean HEAD)
> BRANCH                = main
> WORKTREE              = clean (`git status --short` empty)
> UPSTREAM_RECON        = ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01
>                        (CLOSED_WITH_RESIDUE 2026-09-02 06:30:00Z;
>                         see UPSTREAM_RECON_LINKS below)
> REVIEWER_DISPOSITION  = PASS_WITH_ONE_P1_FIX, then C1: GO
>                        (factory causal reviewer + context-
>                         accounting engineer, 2026-09-02)
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
>                         testable against the same discriminator)
> PRODUCTION_DELTA      = APPLIED (this ACT; consumer-side only —
>                        getApiMetrics.ts logic, no protocol change)
> REPAIR_AUTHORIZED     = YES (per C1: GO above)
> ```
>
> Owned by `EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING`.

> **FROZEN CONTRACT** (semantic condition, NOT mode-name):
> Do not apply an H-space manual-compaction shrink ratio to
> provider/request-input token accounting unless the two baselines
> are known equivalent.
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
  (DEFECT-WITNESS test, GREEN at HEAD; will be inverted to
  `<= 0.10` as the post-fix regression oracle)
- `.factory/evidence/ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01/red-witness.txt`
  (`RED_ARITHMETIC_WITNESS = SYNTHETIC`)
- `.factory/evidence/ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01/discriminator.md`
  (full causal binding)

## Repair acceptance (mandatory gates)

```text
1. Existing DEFECT-WITNESS test goes GREEN under desired
   invariant:
     relativeDiff <= tolerance for any ratio actually
     transferred, OR the incompatible ratio is no longer
     transferred.

2. Small-input POSITIVE CONTROL remains GREEN.

3. Existing compaction suite remains GREEN (no regressions).

4. getApiMetrics tests prove:
   - no fabricated post-compaction request-input count from
     an incompatible H ratio;
   - next genuine provider/request observation restores truth.

5. No producer/schema/API change for first trial (this ACT).

6. UI still shows the compaction's own before→after numbers,
   but does NOT conflate them with provider-input accounting.
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
- (d) **Consumer-side reconciliation** — for manual mode, do
  NOT rescale (use a neutral divider label); for auto mode,
  preserve existing behavior only if recon/test demonstrates
  its input scale is compatible. NO protocol change. RECOMMENDED
  FIRST TRIAL.
- (e) Label-only — update UI title + divider label to match
  producer's contract. Only sufficient if S1-LABEL-ONLY is the
  verdict AND no other accounting defects surface from R1-R3.
  NOT sufficient here (defect is not purely a label issue — the
  ratio itself is on the wrong scale).

## Frozen RED for the post-fix regression oracle

When the consumer-side reconciliation is applied, the DEFECT-
WITNESS test's assertion must be INVERTED to:

```ts
expect(relativeDiff).toBeLessThanOrEqual(RELATIVE_TOLERANCE);
expect(verdict).toBe("S3_RATIO_TRANSFER_NOT_REPRODUCED");
```

This becomes the GREEN post-fix regression oracle. If a future
change accidentally reintroduces the cross-scale mismatch, this
assertion will correctly RED.

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

- INVARIANT TEST (`compaction.working-context-ratio.test.ts`):
  invert the DEFECT-WITNESS assertion to `<= 0.10` to become
  the post-fix regression oracle.
- CONSUMER TEST (`apps/vscode/src/shared/__tests__/getApiMetrics.test.ts`):
  add the four gates from the reviewer's acceptance list (no
  fabricated post-compaction count from H ratio; next genuine
  provider/request observation restores truth; auto-mode compat
  cases stay green; UI still shows compaction's own before→after
  numbers but does not conflate with provider-input accounting).
- EXISTING compaction suite: must remain GREEN.

## Production change scope

```text
PRODUCTION DELTA =
  apps/vscode/src/shared/getApiMetrics.ts:174-225 (consumer-side
                                                    reconciliation
                                                    only)
+
  test:
    sdk/packages/core/src/extensions/context/compaction.working-
      context-ratio.test.ts (DEFECT-WITNESS assertion inverted
                              to <= 0.10, GREEN post-fix)
+
  test:
    apps/vscode/src/shared/__tests__/getApiMetrics.test.ts
      (four new acceptance gates)

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
REPAIR_AUTHORIZED                          = YES (C1: GO)
PROTOCOL_CHANGE                            = NONE (first trial only)
PRODUCTION_DELTA                           = APPLIED (this ACT)
NEW_REVIEW_ROUND                           = YES (repair ACT opens its
                                                own review pass)
ESCALATION                                 = (a)/(b) only if (d)
                                                insufficient
```
