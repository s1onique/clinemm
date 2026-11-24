# ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01

Epic: A02b-R14

Entry head: `1988a44ec71625c881b862e8f9dc116e77dbcac1`

## Purpose

Determine whether further investment in semantic evidence carry-forward is
justified, by measuring whether the EXISTING mechanism has behavioural
utility.

This is NOT a production implementation ACT. No new selection heuristic, no
value-qualification pairing, no new memory subsystem, no expanded oracle.

## Verdict

```text
VERDICT=CLOSE_COMPACTION_SELECTION_NOT_QUALIFIED
```

The behavioural utility of the existing mechanism IS established — the
monotone ordering A < B < C is measured on the same model, endpoint,
reasoning policy and generation budget, with three physical requests and no
summarization request. But the existing selection does not reach the
capacity that an oracle-guided restoration reaches, and the direct source
adjudication establishes a SINGLE cause for all three remaining failures:

> The carried unit is the tool OUTPUT, stripped of the COMMAND that produced
> it. 0 of 8 carried fragments included their command.

Value-qualification pairing would pair fragments with each other while the
missing information is the frame that says what each fragment is a fragment
OF. It is aimed at the wrong layer.

## What was measured

```text
arm A (ordinary continuation)              0 of 3 correct   (O1/O4/O7 all INCORRECT)
arm B (existing S2@2048 selection)         2 of 3 partial   (O1 and O7 recover)
arm C (oracle-guided minimal restoration)  3 of 3 partial   (O4 additionally recovers)

PHYSICAL_INFERENCE_REQUESTS = 3
ADDITIONAL_SUMMARIZATION_REQUESTS = 0
PRODUCTION_DELTA = NONE
```

## The three findings

1. **The predecessor's baseline omitted the retained tail.** The real
   production projection scores `critOmitted=3`, not 5. Every structural
   number in the predecessor's report was measured against a context that did
   not exist in production.

2. **The remaining gap is a contract defect, not a selection defect.** The
   admission contract carries the output without its command, and bounds each
   output line at 300 characters. O1's decisive clause is cut by the bound;
   O4's counting definition and O7's constant-to-provider binding live in
   the command.

3. **The automated scorer under-reports.** Three of nine adjudications are
   scorer false negatives, and arm B's answer contradicted the carried
   evidence while the scorer reported `MATERIAL_DISTORTIONS=0` — because the
   factual scorer reads only the generated summary and not the retained tail.

## The evidence

- `.factory/evidence/ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01/01-entry-and-freeze.md`
- `.factory/evidence/ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01/02-review-findings.md`
- `.factory/evidence/ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01/03-direct-adjudication.md`
- `.factory/evidence/ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01/04-behaviour.md`
- `.factory/evidence/ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01/05-gates.md`
- `.factory/evidence/ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01/06-exit-report.md`

## The production delta

```text
sdk/packages/core/scripts/compaction-utility-final-discriminator.arms.ts        (NEW)
sdk/packages/core/scripts/compaction-utility-final-discriminator.adjudication.ts (NEW)
sdk/packages/core/scripts/compaction-utility-final-discriminator.probe.ts        (NEW)
sdk/packages/core/scripts/compaction-utility-final-discriminator.score.ts       (NEW)
```

No production module was touched. The source-bound evidence remains DEFAULT
OFF; the PCK remains DEFAULT OFF. No packaging or installation.

## The next ACT

None. This ACT ends with a decision, not a new speculative mechanism.

The bounded repairs that block any future activation are enumerated in the
exit report: the invocation correlation, the publication boundary, the
production selector divergence, the factual scorer's blind spot, and the
carried unit's shape. The first five are repairs to existing code. The sixth
is a contract decision with a confidentiality trade-off, and it is the
review's point 5 taken seriously.
