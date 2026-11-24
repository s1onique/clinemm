# ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01

Epic: A02b-R13
Entry head: `428bf3028fdf6f4ae1b6919e400037dd6c355321`

## Purpose

Establish whether bounded task-conditioned selection of source-bound evidence
can preserve acquired semantic knowledge more efficiently than the current
shape-based selector.

The mechanism is reused; the ordinary summarizer and the deterministic
carry-forward are not replaced. The current production activation remains
unauthorized.

## Verdict

```text
VERDICT=HALT_FACTUAL_PRESERVATION_NOT_ESTABLISHED
```

The four mandatory corrections are executable and the selection now reaches
O7's decisive fragment with zero material distortions and zero additional
inference requests — but two of the three decisive items are still not
`PRESERVED`, the behavioural gate was not reached, and generalisation is not
established. No GO is forced.

## The four mandatory corrections

| correction | outcome |
|---|---|
| **C2.1** section-boundary RED/GREEN | RED 7/11 → GREEN 11/11; the shared primitive also repairs the two sibling sections |
| **C2.1** revocation | RED 4/8 → GREEN 8/8; the strip is now unconditional, so an absent admission result revokes |
| **C2.2** measurement correction | predecessor B reclassified PROMPT_ONLY_PRESERVATION; C−E relabelled STRUCTURAL_ABLATION; the four inference-accounting buckets separated; estimated and provider-observed tokens distinguished |
| **C2.3** projection witness | 3/3; the production projector accepts an internally consistent state; the forbidden construction is refused |
| **C2.4** scoring scope | 6/6; the source-bound evidence section is its own supply mechanism, and the masking defence is witnessed with the historical RED fixture |

## The evidence

- `.factory/evidence/ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01/01-corrections.md`
- `.factory/evidence/ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01/02-measurement-correction.md`
- `.factory/evidence/ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01/03-measurement.md`
- `.factory/evidence/ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01/04-source-identity-and-trust.md`
- `.factory/evidence/ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01/05-gates.md`
- `.factory/evidence/ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01/06-exit-report.md`

## The production delta

```text
sdk/packages/core/src/extensions/context/section-delimiters.ts                (NEW)
sdk/packages/core/src/extensions/context/task-conditioned-evidence-selection.ts (NEW)
sdk/packages/core/src/extensions/context/source-bound-evidence.ts              (MODIFIED)
sdk/packages/core/src/extensions/context/evidence-continuity.ts                (MODIFIED)
sdk/packages/core/src/extensions/context/compaction.ts                         (MODIFIED)
sdk/packages/core/src/extensions/context/knowledge-loss-discriminator/
    context-parts.ts                                                          (MODIFIED)
    inventory.ts                                                              (MODIFIED)
```

No new persistent store, no database, no retrieval service, no protocol
message, no public wire field, no new inference request. The source-bound
evidence remains DEFAULT OFF; the PCK remains DEFAULT OFF.

## The next ACT

`A02b-R14 Value-qualification pairing` — the material qualifications of O1,
O4 and O7 live in a fragment other than the value's, and the oracle's matcher
cannot bind them across the source's line structure. The next ACT should pair
a value fragment with the fragment that carries its qualification using the
source-established relationship, or render a contiguous source window that
keeps the two together — and must not tune the oracle.
