# ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01

> Status: **OPEN / IN_REVIEW** — bounded evidence-correction ACT against
> the live-probe harness and the live-compliance reporting of
> `ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01`. Authored
> 2026-11-23 in response to the factory reviewer's verdict
> `HALT_LIVE_EVIDENCE_CONTRADICTION`.
>
> **Primary purpose**: correct the G6 live-probe correlation logic, bind
> every claimed live measurement to a distinct committed receipt, and
> separate schema validity from contract acceptance — without changing
> any production code and without re-running the full suite.
>
> **Predecessor**:
> `ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01`
> (`PASS_PROBE_CONTINUITY_STRUCTURAL`). The predecessor's structural
> conclusion is **PRESERVED** and is not re-litigated here. This ACT
> targets only the live-measurement evidence that the reviewer found
> contradictory.
>
> **Forecasted outcome**: a `PASS_CORRECTION_EVIDENCE_RECONCILED` review
> verdict. Once this ACT closes GREEN, the implementation ACT
> `ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01` may proceed
> with C1 and C2 as explicitly tested prerequisites.

---

## FACTORY_REVIEWER_PROMPT (2026-11-23)

| Expert(s)                                                  | Question                                                 | Plan                                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| ClineMM runtime, LLM protocol engineering, evidence review | Does the output-contract probe authorize implementation? | Verify publication, evidence binding, compaction continuity and executable receipts |

**Review verdict: `HALT_LIVE_EVIDENCE_CONTRADICTION`**

The structural probe passes, but the implementation is **not** yet
authorized. There is a contradiction between the committed live evidence
and the report's stronger claims.

### The two P0 findings

**P0-1 — the committed live measurement contradicted the exit report.**

| Source                       | Live runs | Valid publications | Same-turn tool use |
| ---------------------------- | --------- | ------------------ | ------------------ |
| `06-adversarial-controls.md` | 9         | 8                  | Claims 8/8         |
| `07-contract-decision.md`    | 10        | 9                  | Claims success     |
| `gate8-live-model-probe.txt` | **1**     | **1**              | **False**          |

The single committed live observation is a direct counterexample to the
universal same-turn claim.

**P0-2 — two live-probe correlation metrics were incorrectly implemented.**

- **Same-turn correlation:** `turnToolCallCounts` records every turn,
  whereas `turnCarriers` records only turns containing text. Indexing one
  array with the other's position breaks if a preceding turn has tools but
  no text.
- **After-tool-result correlation:** `sawTextAfterToolResult` is set based
  on text emitted in a tool-calling turn, even though that text was
  emitted **before** the result was appended. It is not tied to the
  actual adjudication carrier.

Both are bounded diagnostic defects, not production defects.

### The required correction — one bounded cycle

1. **Fix the live harness correlation.** Record the canonical/provider
   turn index with each assistant-text carrier. Derive same-turn tool use
   from that exact turn and derive post-result publication from the
   actual message chronology. Add counterexamples with tool-only turns.
2. **Reconcile the live receipts.** Bind each of the claimed 10 runs to a
   distinct sanitized observation, or withdraw the 9/10 statistic and
   report only the measurements that can be verified.
3. **Separate schema validity from contract acceptance.** Report
   `schema_valid`, `canonical_refs_resolved`, `source_revision_bound`,
   and `candidate_accepted` independently. The demonstrated `call_1`
   reference must fail the second gate.
4. **Preserve the implementation constraints.** C1 requires making
   canonical evidence IDs available or providing an equivalent
   trustworthy binding. C2 requires deterministic continuity when the
   summarizer omits a candidate. Neither may be treated as already
   solved.

No production changes, historical replay, new memory system or full-suite
rerun are required for this correction.

The six whitespace diagnostics and unrelated stale gate-summary metadata
are **P2, NON-BLOCKING**.

---

## MISSION

Apply the bounded correction above, in one cycle, and produce evidence
that is internally consistent and re-derivable from the committed
transcript alone.

### Required work

| # | Item | Artifact |
|---|------|----------|
| 1 | Turn-anchored correlation, with the legacy logic reproduced verbatim as an executable counterexample | `sdk/packages/core/scripts/adjudication-output-contract.correlation.ts`, `src/extensions/context/compaction.adjudication-output-contract.correction01.test.ts` |
| 2 | Ten distinct committed live receipts; every statistic derivable from them | `verification/gate8-live-model-probe-correction01.txt`, `02-live-receipts.md` |
| 3 | Four independent acceptance gates; the `call_1` reference must fail gate 2 | `03-acceptance-gates.md` |
| 4 | C1 and C2 explicitly OPEN; successor criterion stated in `candidate_accepted` terms | `04-constraints-and-verdict.md` |

### Conservation requirements

```text
PRODUCTION_DELTA                     ZERO (no src/ production module changed)
RED_WITNESS (adjudication-continuity.red01.test.ts)
                                     byte-identical to d69cfb9be
PRE-EXISTING TESTS                   none modified, skipped or deleted
NEW PUBLIC API                       none
NEW PERSISTENCE SUBSYSTEM            none
MEMORY SYSTEM                        none
FULL-SUITE RERUN                     none (context directory re-run only)
PREDECESSOR STRUCTURAL VERDICT       PRESERVED
```

### Out of scope (explicitly NOT claimed as fixed)

- The six whitespace diagnostics.
- The unrelated stale gate-summary metadata.

---

## EVIDENCE

`.factory/evidence/ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01/`

```text
00-entry-identity.md
01-harness-correction.md
02-live-receipts.md
03-acceptance-gates.md
04-constraints-and-verdict.md
artifact-hashes.json
verification/
```

## BOARD

`.factory/epic-board.md` — entry
`ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01`.
