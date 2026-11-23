# 04 — The preserved constraints and the verdict

## The reviewer's requirement #4

> Preserve the implementation constraints. C1 requires making canonical
> evidence IDs available or providing an equivalent trustworthy binding.
> C2 requires deterministic continuity when the summarizer omits a
> candidate. Neither may be treated as already solved.

This document records that neither C1 nor C2 is solved, states precisely
what is known about each, and forbids the successor ACT from treating
either as a precondition that has already been met.

## C1 — canonical evidence identity

```text
STATUS:   OPEN — NOT SOLVED
EVIDENCE: 1 of 10 live runs resolved canonical references; 0 of 10 were
          accepted. The model cited tool NAMES, synthetic LABELS and
          INVENTED ids in every run that cited anything at all.
```

What the corrected receipts establish about C1:

1. The model **can** emit the envelope shape with the qualification
   intact — 9 of 10 runs.
2. The model **cannot** cite canonical ids it was never given — 9 of 10
   runs cited something non-canonical.
3. The contract **correctly rejects** those citations — this is the
   designed behaviour, and it is what makes C1 a design constraint
   rather than a defect.

The successor ACT must either:

- make the canonical tool-call id **available** to the model (in the
  tool result, in the tool schema, or in the tool-call description), or
- provide an **equivalent trustworthy binding** that does not require the
  model to name the id.

**and must prove it with separately tested evidence.** The current
measurement is the *baseline that must improve*, not a demonstration that
the constraint is satisfiable.

The successor MUST also decide the fate of gate 3. The current envelope
schema carries no source-revision field, so `source_revision_bound` is
structurally `false`. An implementation that leaves the schema unchanged
will produce `candidate_accepted = false` for every candidate, forever.

## C2 — deterministic continuity under summarizer omission

```text
STATUS:   OPEN — NOT SOLVED
EVIDENCE: The predecessor's mandatory G4.3-B negative control showed
          that a summarizer which OMITS the candidate loses it, despite
          the candidate having survived M1. That boundary is measured,
          classified, and unfilled.
```

This ACT did not touch C2 and does not claim to have moved it. The
summarizer-omission boundary is exactly as the predecessor measured it.

The successor ACT must establish **deterministic** continuity — i.e. a
mechanism whose retention does not depend on the summarizer choosing to
retain the candidate — and must prove it with separately tested evidence,
including the negative control that the predecessor already specified.

## The remaining constraints, carried forward unchanged

```text
C3  Publication is reliable but NOT guaranteed. The corrected receipts
    measure 9 of 10 schema-valid publications. A missing envelope is a
    NORMAL, EXPECTED outcome and must be handled as one.

C4  The candidate remains PROVISIONAL. It must never become a system or
    developer instruction, and it must never be promoted above the
    canonical evidence.

C5  The vocabulary is TEST-LOCAL. Promoting it to a global ClineMM API
    requires its own ACT.
```

## The predecessor's structural verdict is PRESERVED

```text
PASS_PROBE_CONTINUITY_STRUCTURAL
```

The reviewer's own finding was that this verdict "remains supported for
the existing-carrier feasibility tests". Nothing in this ACT
re-litigates it, and nothing in this ACT weakens it:

```text
assistant `text` is a viable carrier                        PRESERVED
assistant text survives M1; thinking blocks do not            PRESERVED
canonical persistence preserves the carrier in tested paths  PRESERVED
the strict parser rejects malformed/unsupported shapes       PRESERVED
the summarizer CAN omit an otherwise valid candidate        PRESERVED
production delta of the predecessor                          ZERO
```

## The verdict of THIS ACT

```text
PASS_CORRECTION_EVIDENCE_RECONCILED
```

What is established:

1. **The live-harness correlation is fixed**, with executable
   counterexamples that reproduce the legacy defect and demonstrate the
   corrected behaviour.
2. **The live receipts are reconciled**: 10 runs, 10 distinct committed
   receipts, every reported statistic derivable from the committed
   transcript.
3. **Schema validity is separated from contract acceptance**: the four
   gates are reported independently; the demonstrated `call_1` reference
   fails gate 2 as required; run 4 proves the gates are independent.
4. **The constraints are preserved as OPEN**: C1 and C2 are explicitly
   not solved.

What is explicitly NOT established, and must not be claimed downstream:

- Live compliance. There is no live compliance figure. The only live
  figure is `9/10 schema-valid publication`, and acceptance was `0/10`.
- The universal same-turn property. It is **refuted**, not repaired.
- That the output contract is a deployed security guarantee. It is not
  deployed; the parser is test-local.

## The next action

**`ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01`** may now
proceed — but only with C1 and C2 as **explicit, separately tested
prerequisites**, not assumptions:

```text
C1  must be discharged by the implementation itself, with evidence that
    canonical evidence ids are resolvable (or equivalently bound) in a
    LIVE run, and with a decision on the gate-3 revision field.
C2  must be discharged by a deterministic retention mechanism, with the
    G4.3-B omission negative control re-measured.
```

The successor's acceptance criterion must be stated in terms of
`candidate_accepted`, not `schema_valid`. A successor that reports
"the model published the envelope" as evidence of success would repeat
exactly the conflation this ACT was created to remove.

## Scope note

The reviewer classified six whitespace diagnostics and unrelated stale
gate-summary metadata as **P2, NON-BLOCKING**. They are out of scope for
this bounded correction and are **not claimed as fixed**. The gate
summary metadata was left untouched by design: this ACT does not
regenerate it, and the stale entries it contains remain stale.
