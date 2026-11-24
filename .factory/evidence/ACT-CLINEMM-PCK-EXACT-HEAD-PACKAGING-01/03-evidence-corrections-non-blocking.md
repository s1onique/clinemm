# 03 — Evidence corrections carried from the CORRECTION02 review

The CORRECTION02 review corrected five statements in the CORRECTION02
report. They are recorded here verbatim so the record is corrected
rather than defended, and none of them is a defect in the code.

| Report wording | Actual evidence |
| --- | --- |
| "All six counterexamples reproduced" | Five of the six were NEW discriminator assertions. The directory-listing negative control (P0-2.6, `IMPLEMENTATION_INSPECTED`) ALREADY PASSED against CORRECTION01, because `run_commands` is a command execution and `IMPLEMENTATION_INSPECTED` required a `source_read`. The count is stated precisely here: FIVE new same-class counterexamples were reproduced. |
| "11 RED failures" | NINE assertion failures and TWO missing-export errors. The two missing exports (`DETERMINISTICALLY_ESTABLISHABLE_ATOMS`, `RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS`) were a consequence of the witness referencing symbols the predecessor implementation did not export. |
| "Clean patch hygiene" | The patch itself was clean (`git diff --check` exit 0). The five findings were EOF whitespace warnings in the RECEIPT files under `.factory/evidence/`, not in the source patch. |
| "Runtime/orchestration: 250 tests" | The 250 figure was the `src/runtime/orchestration/` tree ONLY. The predecessor's 421 figure covered a wider file set that included host tests. The two numbers are NOT comparable and the comparison must not be read as a regression. |
| "Gate summary" | The historical gate summary remains INVALID/UNBOUND. It was NOT repaired, per instruction. The authoritative evidence for every gate in this ACT is the COMMAND EXIT CODE of the command that produced it. |

## The terminal cleanup batch

The residue items are batched for terminal cleanup and are NOT repaired
here:

```text
receipt EOF whitespace warnings   -> terminal cleanup
invalid/unbound historical gate summary -> terminal cleanup (LEAMAS: LEAVE ALONE)
```

## The A10 and B06 items are untouched

Neither is repaired, and neither is claimed away:

```text
A10  ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01
     PRIORITY:          SECURITY
     EVIDENCE:          SYNTHETIC_REAL
     STATUS:            RED_REPRODUCED
     PRODUCTION_CHANGE: NONE

B06  COMPLETION-CONTINUATION-QUIESCENCE-RECON01
     Evidence:          LIVE transcript
     Causality:         UNRESOLVED
     Production repair: NOT_AUTHORIZED
```
