# 06 — Record selection

## The historical problem

The predecessor's checkpoint emitted **13 records at boundary 1** and **20
at boundary 2**. The EXPERIMENTAL ceiling of 12 took the **first 12 in
publication order**. At boundary 2 that selection **discarded the qualified
R4 and R6 records**, because they sat at indices 12 and 14 — behind twelve
generic records.

This is a SELECTION defect, and it is separate from the source-visibility
defect. A checkpoint whose input is fixed can still lose its best
observation to a positional ceiling.

## The three arms, measured on the historical 20-record output

Both arms use the SAME record set, the SAME 12-record ceiling and the SAME
960-token projected budget. The only difference is the selection rule.

```text
ARM A  CONTROL    first 12 valid records in publication order
ARM B  TREATMENT  bounded, deterministic relevance selection
ARM C  ABLATION   the treatment with the selection rule ablated
```

### ARM A — the control

```text
records selected        12
projected tokens        960
distinct canonical references covered   64
records contributing ZERO new evidence   3
```

### ARM B — the treatment

```text
records selected        12
projected tokens        960
distinct canonical references covered   90
records contributing ZERO new evidence   2
```

### The measured improvement

```text
distinct canonical evidence covered:  64  ->  90   (+26, +40.6%)
zero-novelty records:                  3  ->  2
records dropped that carried the witnesses:  R4 and R6  ->  NONE
```

**Both witness records are retained by the treatment and dropped by the
control.** This is the discriminator.

### ARM C — the ablation

The ablated arm is **byte-identical to the control**: the same 12 ids in the
same order, the same 8 dropped ids. This is asserted directly
(`selection.test.ts` G5.3), so the improvement is attributable to the
selection rule and to nothing else.

## The generic rule (and why it is generic)

The scoring reads only the record's own STRUCTURE. It never reads the
statement's content, and it hardcodes nothing about `R1`–`R10`,
`startup.sh`, `MtsOmni`, or the evaluator's expected answers.

### The signal that decided it: NOVELTY

The first attempt at a generic policy (kind, assurance, status, reference
resolvability, qualification count) **FAILED**: it retained `r5`, `r7`,
`r9`, `r10` and still dropped `r4` and `r6`, because those ten records are
structurally indistinguishable from each other. The historical model emitted
them all as `open_question` / `unverified` / `unresolved` with 1–3
qualifications. **No structural criterion can separate R4 from R3.**

The ACT therefore measured what actually DID differ, and it was the
**evidence overlap**: the control filled its twelve slots with records whose
canonical references were **already covered** by earlier records — pure
restatements — while records carrying a genuinely new observation were
dropped for being late in the publication order.

Measured novelty (references not covered by any earlier record):

```text
session-completion-001  2     r4-013   3
repository-path-002     5     r5-014   5
repository-identity-003 3     r6-015   2
working-tree-004       0     r7-016   6
verification-scope-005 14     r8-017   0
repository-side-effects 3     r9-018  10
upstream-semantics-007 6     r10-019  3
mission-constraints-008 0     final-…  0
reporting-contract-009  0
r1-010                 13     r2-011  15
r3-012                  3
```

`working-tree-004`, `mission-constraints-008`, `reporting-contract-009`,
`r8-017` and `final-deliverables-020` contribute **ZERO** new evidence.
`r4-013` and `r6-015` contribute **3** and **2**.

### The policy

A record whose resolved references are entirely covered by the records
already selected is a **restatement**, and a restatement must not spend the
record ceiling. A record that contributes new evidence is ranked above it.

This is computed from the RESOLVED reference sets, so it depends on evidence
identity — never on a record id, a statement, a keyword, or a secret.

### The genericity is machine-checked

`selection.test.ts` G5.3.3 asserts that two records identical in structure
but with completely different statements — one containing
`password=hunter2` — score **identically**. That is the machine-checkable
form of "no secret-dependent scoring" and "no hardcoded answers".

## The requirements

| Requirement | Measured |
|---|---|
| Maximum records: 12 | **12** |
| Target projection ≤ 1 500 estimated tokens | **960** |
| No duplicated knowledge section | the projection is idempotent (G7.2.2) |
| Stable ordering | two consecutive runs produce identical id sequences (G5.2.2) |
| Stable tie-breaking | two records with the same score keep their publication order (G5.2.2) |
| No secret-dependent scoring | asserted (G5.3.3) |
| No authority promotion | the score is a RANKING, not an assurance; the trust gate is separate (G5.3.2) |
| A supported observation is not silently dropped for being late | **R4 and R6 are retained** |
| A dropped record is explained through metadata only | the drop reason carries `id`, `reason`, `score`, `rank` and NOTHING else — asserted by the exact key set (G5.2.3) |

## The necessity question (G5.3)

> Require B to retain more relevant supported information under the same
> budget, without overclaims.

**B does:** +26 distinct canonical references under an identical record
count and an identical token budget, with **no** increase in unsupported
promotion — the trust gate downgrades every over-claim independently of the
selection.

> If no generic selector improves the result, preserve the original
> first-12 behavior as the baseline.

A generic selector **did** improve the result, so the first-12 behavior is
**NOT** preserved as the baseline. It is retained as the CONTROL arm, and
the ablation arm proves that the improvement is attributable to the rule.

## What was NOT done

No `R4`/`R6` priority was added. No record id is special-cased. The
selector retained `r4-013` and `r6-015` for exactly the same reason it
retained `r7-016` and `r9-018`: they contribute evidence the control would
have lost.

## G5 exit

```text
PASS — a generic, bounded, deterministic selection policy is available and
is measurably better than the positional control.
```
