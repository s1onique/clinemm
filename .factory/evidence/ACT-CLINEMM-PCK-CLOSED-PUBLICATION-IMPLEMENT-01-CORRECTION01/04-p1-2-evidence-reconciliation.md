# 04 — P1-2: the final evidence reconciliation

The review listed four discrepancies between the published claims and the
committed receipts. Each is reconciled here against the CORRECTED head.

```text
RECEIPTS:  verification/
```

## 4.1 — "55 ACT tests passed" vs "53 tests, five files"

```text
CLAIMED:     55 tests, five files
RECEIPTED:   53 tests, five files
```

The predecessor's receipt file `act-owned-tests.txt` recorded **53 tests
across 5 files** for the five files it listed. The `55` figure came from
the default suite run, which included `pck-default-off-equivalence.test.ts`
(a sixth file) that the receipt's file list did not enumerate. So the
published number and the enumerated file list disagreed.

The correction reconciles this by making the ACT-owned suite an EXPLICIT,
ENUMERATED list. The focused suite is now:

```text
pck-closed-contract.test.ts                  27 tests
pck-conservation-ablation.test.ts             9 tests
pck-default-off-equivalence.test.ts           2 tests
pck-knowledge-utility.test.ts                 6 tests
pck-observation-assurance.red01.test.ts       7 tests   NEW
pck-persistence-restoration.test.ts           3 tests
pck-production-seam.test.ts                   8 tests
pck-reference-confidentiality.test.ts          3 tests   NEW
                                              -------
EIGHT FILES                                  65 tests
```

The receipt `verification/act-owned-tests.txt` states BOTH the eight file
names and the 65-test total, so the number in the receipt and the number
in the file list now agree by construction. No claim rests on an
unenumerated file.

## 4.2 — "Two independent accepted runs" vs "one retained execution with rejection followed by acceptance"

```text
CLAIMED:     two independent accepted runs
RECEIPTED:   one execution: attempt 1 rejected (invalid JSON), attempt 2
             accepted
```

The predecessor's document `04-model-contract-qualification.md` claimed
"Both independent runs accepted a candidate" while its own committed
receipt showed a single execution with a rejection followed by an
acceptance. The claim and the receipt disagreed.

The correction makes the distinction EXPLICIT and keeps it:

```text
Four INDEPENDENT EXECUTIONS of the corrected script were performed.
Each execution is a separate process invocation against the live model.

run 1: 1 attempt  -> ACCEPTED
run 2: 2 attempts -> attempt 1 REJECTED (ATOM_NOT_IN_CLOSED_VOCABULARY),
                    attempt 2 ACCEPTED
run 3: 1 attempt  -> ACCEPTED
run 4: 1 attempt  -> ACCEPTED
```

Each run has its OWN receipt file. The receipt states the attempt
sequence and the rejection reason, so a reader can distinguish "four
executions, three of which needed one attempt and one of which needed two"
from any weaker claim. The predecessor's conflation is not repeated.

## 4.3 — "Structural gates met" vs "gate-summary binding invalid"

```text
CLAIMED:     structural gates met
RECEIPTED:   the gate-summary binding is invalid
```

The invalid gate-summary binding is a LIMITATION OF THE EVIDENCE PACKAGE,
not proof that the underlying tests failed. The predecessor's receipt
recorded the structural gate outcomes in a summary file whose binding to
the run it described could not be verified.

The correction does not attempt to repair the historical gate summary —
the review explicitly said *"Do not spend another ACT repairing LEAMAS."*
Instead:

```text
- the focused receipts are REGENERATED at the corrected head,
- each receipt states the command that produced it, and
- the exit code of each command is the authority, not a summary file.
```

## 4.4 — "Clean patch hygiene" vs "five trailing-blank-line findings"

```text
CLAIMED:     clean patch hygiene
RECEIPTED:   five trailing-blank-line findings
```

The predecessor's receipt recorded five whitespace findings in its own
patches. The correction does not rewrite the frozen historical receipts —
the review said not to. Instead:

```text
- the corrected patch carries NO trailing blank lines, and
- the frozen historical receipts keep their original findings, because
  rewriting them would destroy the record the review examined.
```

This is verified mechanically by the patch-hygiene receipt.

## 4.5 — The P2 batch (NON-BLOCKING)

The review batched five P2 items for terminal cleanup and explicitly said
not to rewrite frozen historical receipts:

```text
- Contradictory before/after wording in the seam-map document
- Whole-file formatting churn in package.json
- Five receipt whitespace warnings
- Missing evidence documents 05-08
- Historical baseline prose discrepancies
```

None of these is a trust-boundary defect, and none is repaired by a
bounded correction cycle that is scoped to:

```text
- correct false observation assurance
- execute the canonical-reference confidentiality discriminator
- correct the real-model qualification lifecycle
- refresh exact-head focused executable evidence
- commit the bounded correction
```

They remain recorded as P2, NON-BLOCKING.

## 4.6 — The two corrections that DID change a historical assertion

Two existing assertions encoded the defective behaviour and were
INVERTED by the correction. Both changes are recorded here so the diff is
auditable.

### G3.5 (closed contract)

```text
BEFORE:  expect(gate.records[0].assurance).toBe("tool_observed");
         expect(gate.records[0].statement)
             .toBe("bounded search returned no match");
AFTER:   expect(gate.records[0].assurance).toBe("model_reported");
         expect(gate.records[0].statement)
             .toBe("bounded search returned no match");
```

The test's NAME already said what it meant — *"a VALID but SEMANTICALLY
UNRELATED reference does NOT raise the assurance"* — but its ASSERTION
said the opposite. The assertion now matches the name and the corrected
semantics.

### G7.4d (conservation ablation)

```text
BEFORE:  expect(text).toContain(VALID_TOOL_CALL_ID);
AFTER:   expect(text).not.toContain(VALID_TOOL_CALL_ID);
         expect(text).toContain("ref-0");
```

The published section now carries an opaque alias rather than the raw
canonical identifier, so the assertion follows the corrected rendering.
