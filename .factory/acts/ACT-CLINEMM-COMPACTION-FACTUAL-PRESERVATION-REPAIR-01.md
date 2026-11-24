# ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01

```text
ACT:        ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01
TYPE:       bounded production repair (factual preservation at the compaction seam)
EPIC:       A02b-R12
ENTRY_HEAD: 4d72dfc2defee99addd16d062130fe2d599c5b3b
BRANCH:     main
VERDICT:    HALT_FACTUAL_PRESERVATION_NOT_ESTABLISHED
EVIDENCE:   .factory/evidence/ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01/
```

## PRIMARY OBJECTIVE

Establish and, if qualified, implement a bounded ordinary-compaction mechanism
that preserves acquired semantic knowledge without introducing factual
distortion, unauthorized disclosure or additional mandatory inference requests.

Primary objective: SPEED x CORRECTNESS.
Primary epistemic purpose: factual-preservation repair.

## WHAT THE PREDECESSOR ESTABLISHED (not reopened)

- Evidence omission before summarization.
- Targeted original-evidence restoration improves downstream answers.
- Evidence-enhanced summarization improves coverage but introduces factual
  mistranscription.
- The existing closed PCK vocabulary provides no established incremental
  utility on the examined workload.

## THE REVIEWER'S BOUNDED CORRECTIONS (completed in THIS ACT)

### C2.1 — Source-boundary witness

The predecessor's post-boundary negative control was DEFECTIVE: it appended
the synthetic observation to the collection it then passed as the "frozen
prefix", so the boundary MOVED to include the synthetic messages. The
identity of the output therefore only demonstrated that the synthetic
observation did not influence the carry-forward output — NOT that it was
inaccessible.

This ACT repairs the witness:

- the synthetic observation is appended to the ORIGINAL canonical history;
- the ORIGINAL frozen boundary is used to re-derive the prefix;
- the SAME continuation assembly path is exercised;
- a POSITIVE control advances the boundary deliberately and shows that an
  eligible synthetic observation becomes visible.

### C2.2 — Semantic scoring

The predecessor scored O7 as `PARTIALLY_PRESERVED` although the summary
published `1500 ms` for a subject whose observed value is `1000 ms`. A
material wrong value is `DISTORTED` or `CONTRADICTED`, never "partial".

This ACT adds a contradiction-detecting scoring layer with adversarial
witnesses for:

- correct subject, wrong value;
- correct value, wrong subject;
- correct number, wrong unit;
- reversed success/failure polarity;
- missing qualification (still PARTIAL);
- explicit contradiction alongside a correct statement.

### C2.3 — Evidence identity

The report distinguishes, and never conflates:

- TARGETED_ORIGINAL_EVIDENCE_RESTORATION
- MINIMAL_BOUNDED_RESTORATION
- EVIDENCE_ENHANCED_SUMMARIZATION
- DETERMINISTIC_EVIDENCE_CARRY_FORWARD

## THE CANDIDATE LADDER

| Candidate | Mechanism | Inference requests |
|---|---|---|
| A | Ordinary compaction (production omission policy) | 1 |
| B | Evidence-enhanced summarization with a factual-preservation instruction | 1 |
| C | Hybrid extractive/abstractive: ordinary summary + deterministic carry-forward of approved source-bound evidence | 1 |
| D | Selective references inside the existing summarization request | 1 (only if C cannot meet the budget) |

C is preferred: the production ALREADY owns a deterministic, idempotent,
boundary-stable carry-forward mechanism
(`applyVerifiedEvidenceToCompactedMessages` -> `applyEvidenceToSummary` ->
`renderEvidenceSection`). Candidate C extends that EXISTING primitive to
carry source-bound evidence fragments, so the model is never asked to
regenerate an authoritative observation.

## WHAT IS FORBIDDEN

- No new memory store, database, retrieval service or public protocol.
- No PCK vocabulary revival.
- No generalized semantic-memory framework.
- No increase of the context window.
- No second inference request.
- No packaging or installation.

## THE EXIT GATES

See the ACT specification's §12 summary block. A valid terminal verdict is one
of:

- GO_EXACT_HEAD_PACKAGING
- HALT_FACTUAL_PRESERVATION_NOT_ESTABLISHED
- HALT_EVIDENCE_TRUST_BOUNDARY
- HALT_COMPLETE_REQUEST_BUDGET
- CAPTURE_INSUFFICIENT

Do not force GO.

## THE VERDICT, AND WHY

```text
VERDICT=HALT_FACTUAL_PRESERVATION_NOT_ESTABLISHED
```

The mechanism is built, measured, and DEFAULT OFF. The SELECTION is not yet
good enough to ship it.

- Candidate B (the cheapest candidate) was MEASURED and recovered NOTHING
  that the baseline did not already have. The reviewer's prediction — a
  prompt cannot guarantee a value's preservation — is confirmed.
- Candidate C (the hybrid) recovered O7 and introduced ZERO material
  distortions, and the ablation proves the improvement is CAUSAL. But O1 and
  O4 are still lost, and the complete request grows 44 %.
- The shape-based selector cannot reliably reach the decisive fragment, and
  it can carry a NEIGHBOURING subject's value — which reproduces the
  predecessor's mistranscription mode in a new form.

The NEXT ACT must solve the SELECTION, not the MECHANISM.
