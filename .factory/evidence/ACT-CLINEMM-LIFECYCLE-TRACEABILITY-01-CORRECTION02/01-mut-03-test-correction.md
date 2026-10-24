# ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01-CORRECTION02 — MUT-03 test correction evidence

**Verdict:** `CLOSED_CLEAN`

**Subject:** `72691cbeb` (the closeout of `ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01-CORRECTION01`).

**Why this correction exists.** The CORRECTION01 closeout was reviewed and the
`MUT-03` witness was found to be defective: it did not exercise the property
it claimed to exercise. This is a TEST-ONLY correction — bounded to one test
case in one file. No production code, contract TSV, Mermaid projection, or
architecture document changed.

## The defect in `MUT-03`

The CORRECTION01 `MUT-03` built its mutation with two sequential
`mutateEdgeLabel(...)` calls, and the SECOND call located its target edge by
the transition id `A-04`:

```ts
const mutatedDiagram = mutateEdgeLabel(
  mutateEdgeLabel(diagramText, "A-03", "A-04 authorize"),
  "A-04",
  "A-99 completed phase committed",
)
```

`mutateEdgeLabel` finds the FIRST labeled edge whose label id equals the
requested id. After the first call, the `A-03` edge (`ElmConsulted -->
ElmAuthorized`) had been RELABELED to carry `A-04`. The second call therefore
matched THAT already-mutated edge, not the real `A-04` edge (`ElmAuthorized
--> PhaseCommitted`).

**Measured result of the defective mutation:**

```
stateDiagram-v2
    ...
    ElmConsulted --> ElmAuthorized : A-99 completed phase committed   <-- A-03 edge, relabelled twice
    ...
    ElmAuthorized --> PhaseCommitted : A-04 completed phase committed  <-- real A-04 edge, NEVER TOUCHED
```

```
errors = ["A-03: absent from Mermaid projection (no labeled edge carries this transition id)"]
```

So the defective witness asserted only `errors.length > 0` and was satisfied by
a **MISSING transition id** (`A-03` had become `A-99`). `A-04` never appeared
in the errors at all. The witness proved that removing an id is detected; it
did **not** prove that a SWAPPED id-to-edge association is detected — the
precisely false-positive class that CORRECTION01 was raised to close.

## The corrected witness

The corrected `MUT-03` mutates two distinct edges **by their endpoints**, so
the second substitution can never match an already-mutated edge:

```ts
const mutatedDiagram = diagramText
  .replace(/(ElmConsulted\s*-->\s*ElmAuthorized\s*:\s*)A-03\b/, "$1A-04")
  .replace(/(ElmAuthorized\s*-->\s*PhaseCommitted\s*:\s*)A-04\b/, "$1A-03")
```

Mermaid associates the text after `:` with the edge that PRECEDES it, so this

## Acceptance contract — measured results

| # | Requirement | Measured | Status |
|---|---|---|---|
| 1 | Mutation verified: both IDs exist exactly once on the wrong edges | `A-03 -> ["ElmAuthorized --> PhaseCommitted"]`, `A-04 -> ["ElmConsulted --> ElmAuthorized"]` | PASS |
| 2 | Validator reports association mismatches for BOTH A-03 and A-04 | 2 errors, one per id, each `"<id>: Mermaid edge is ..."` | PASS |
| 3 | Neither transition reported missing | no error contains `"absent from Mermaid projection"` | PASS |
| 4 | Regression: existing 52-test selection retained, MUT-03 corrected | 5 files, 52 tests PASS | PASS |
| 5 | Scope: no production/contract/Mermaid/architecture change | only the test file + this evidence + the board + the manifest hash row | PASS |

**The two errors produced by the corrected validator on the swap:**

```
A-03: Mermaid edge is ElmAuthorized --> PhaseCommitted, but the contract requires ElmConsulted --> ElmAuthorized (from "Elm consulted" to "Elm authorized")
A-04: Mermaid edge is ElmConsulted --> ElmAuthorized, but the contract requires ElmAuthorized --> PhaseCommitted (from "Elm authorized" to "C10 committed")
```

## RED/GREEN — the corrected witness is load-bearing

The corrected `MUT-03` was checked against a faithful reimplementation of the
PRE-correction validator's semantics (`diagram.includes(id)` for substring
presence plus `diagram.includes("A --> B")` for edge EXISTENCE, i.e. no
association check):

| Validator semantics | Errors on the swap | Corrected MUT-03 assertion |
|---|---|---|
| pre-correction (independent substring + edge-existence checks) | `[]` — the swap was ACCEPTED | **FAILS** (RED) |
| CORRECTION01 corrected (per-transition association check) | 2 association errors, 0 absent | **PASSES** (GREEN) |

The pre-correction validator accepting the swap with zero errors is the exact
false positive CORRECTION01 was raised to close, so the corrected witness
demonstrably fails against the pre-correction behaviour and is not a vacuous
assertion.

For contrast, the DEFECTIVE witness was already green against the
pre-correction semantics (it produced a missing-id error rather than an
association error), which is why it passed without proving anything.

## Executed gates

| Command | Result |
|---|---|
| `cd apps/vscode && ./node_modules/.bin/vitest run --config vitest.config.ts src/sdk/__tests__/lifecycle-transition-contract-verifier.correction01.test.ts` | PASS — 1 file, 9 tests |
| `cd apps/vscode && ./node_modules/.bin/vitest run --config vitest.config.ts src/sdk/__tests__/c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01.test.ts src/sdk/__tests__/completion-authority-elm-first-seam01.case01.test.ts src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts src/sdk/__tests__/lifecycle-transition-contract-verifier.correction01.test.ts` | PASS — 5 files, **52 tests** |
| `cd apps/vscode && ./node_modules/.bin/tsc --noEmit --pretty false` | PASS — exit 0, 0 diagnostics |
| `bun scripts/verify-lifecycle-transition-contract.ts` | PASS — exit 0, "4 transitions, Mermaid synchronized" |

Vitest emitted the known non-fatal fork-pool `kill EPERM` teardown warning
after all selected tests passed. The contract validator was run with Bun
because the shell did not expose Bun/Bunx on the bare `PATH` in the prior
session and plain Node cannot resolve the extensionless TypeScript import;
no repository script or dependency was changed.

## Artifacts

- `apps/vscode/src/sdk/__tests__/lifecycle-transition-contract-verifier.correction01.test.ts` — the corrected `MUT-03`.
- `docs/acts/ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01/artifact-manifest.tsv` — the SHA-256/byte-count row for the corrected test file was refreshed so the G8 exact-source evidence stays truthful.
- `.factory/epic-board.md` — the CORRECTION02 board section.

produces a genuine association swap in which **both ids survive exactly once**
and each is attached to the other's edge.
