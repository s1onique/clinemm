# ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01 — closeout report

**Verdict:** `PASS_STRUCTURAL_ONLY`

## CORRECTION01 — bounded traceability-proof correction

A review of `cbf7c6a3` returned `HALT_TRACEABILITY_PROOF_FALSE_POSITIVES`: the
implementation was directionally sound, but the two VERIFICATION MACHINERY
components could report PASS without proving the intended contract. This
section records the bounded correction. No architecture, Elm kernel, diagram
expansion, or documentation cleanup was performed.

### P0 — the causal trace validator could accept a completion that never committed

`validateLifecycleTransitionTrace()` required only three records
(`authority_decision`, `effect_executed`, `marker_promoted`) and ignored
`effect_requested`, `phase_commit_observed`, `task_id`, `turn_seq`, and the
expected transition identities. A trace with NO observed phase commit
returned `{ valid: true }`.

Correction: the validator now requires the complete successful C9/C10 chain

    authority_decision (A-03)
      -> effect_requested (A-04)
      -> phase_commit_observed (A-04)
      -> effect_executed (P-06)
      -> marker_promoted (P-06)

with one shared execution context (decision id, task id, turn sequence) and
strict stage ordering. Failure reasons distinguish an absent stage
(`missing_<stage>`) from a wrong transition identity
(`transition_identity_mismatch:<stage>`), a task/turn drift
(`task_identity_mismatch` / `turn_identity_mismatch`), and an ordering
violation (`stage_order_violation`).

RED witnesses: `RED-06` … `RED-11` in
`apps/vscode/src/sdk/__tests__/c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts`.
All six FAIL against the pre-correction validator and PASS after it, which
was verified by re-running the suite against the stashed pre-correction
module (6 failed / 14 passed, then 20 passed).

### P0 — the contract validator did not verify contract-to-diagram synchronization

`scripts/verify-lifecycle-transition-contract.ts` used a hardcoded
`requiredStatePairs` map and separately asserted that each transition id
appeared *somewhere* in the Mermaid text. The two checks were INDEPENDENT,
so a contract state could be altered, or a transition id could be attached
to the WRONG edge, and verification still passed. This was reproduced: a
swapped-label mutation returned `PASS` (exit 0) under the old validator.

Correction: the validation core was extracted to
`apps/vscode/src/sdk/lifecycle-transition-contract-verifier.ts` as pure,
importable functions. It now

1. maps each contract `source_state`/`target_state` to an explicit Mermaid
   state id (`STATE_ID_BY_CONTRACT_STATE`),
2. parses the ACTUAL labeled Mermaid edges (the text after `:` is
   associated with the edge that precedes it, per Mermaid's own semantics),
3. asserts, per transition id, that exactly one labeled edge exists and that
   its source/target are the ones the contract requires.

The contract TSV's A-03 `source_state` was corrected from `C9 captured` to
`Elm consulted` so it names the edge it carries — A-03 is the Elm consult
whose authorize branch is `ElmConsulted --> ElmAuthorized`, consistent with
the canonical ledger (`transitions.tsv`) and the architecture doc
(`A-03 — the Elm consult`).

MUT witnesses: `MUT-01` … `MUT-06` in
`apps/vscode/src/sdk/__tests__/lifecycle-transition-contract-verifier.correction01.test.ts`,
covering an altered `source_state`, an altered `target_state`, a transition id
attached to the wrong edge, a duplicated transition id, a removed label id, and
a non-`stateDiagram-v2` diagram.

### P1 — coordinator diff inspection (evidence limitation, no defect)

The `sdk-session-event-coordinator.ts` body was suppressed as
`LARGE_FILE_EVIDENCE_BOUNDARY` in the review digest. The focused diff for
`e6b8eb9ff` was inspected directly. Every change is additive
instrumentation: the trace-module import, one new private field
(`pendingLifecycleDecisionId`), one new private helper
(`lifecycleTraceContext()`), and `recordLifecycleTransitionTrace(...)` calls
at the authority, request, phase-commit, and marker-effect boundaries.

The single control-flow rewrite is
`if (decision.kind === "authorize") return true` becoming
`if (decision.kind === "authorize") { <record trace>; return true }` — the
condition, the return value, and the fall-through to the `hold` branch are
unchanged. `recordLifecycleTransitionTrace()` returns immediately when
`traceEnabled` is false, `traceEnabled` defaults to false, and no
production code path enables tracing. The state-semantic delta is therefore
zero, now independently confirmed rather than merely asserted.

## Source identity

- `ENTRY_HEAD`: `4a66459e9d6ee94d2947e82f30f5ce39793ccb6f`
- `SUBJECT_HEAD`: `e6b8eb9ff1dbd46cda654fa8fffab6cefa2862e0`
- Branch: `main`
- Installed VSIX identity: not applicable; no live installed-extension qualification was performed.

## Changed production seams

- `apps/vscode/src/sdk/lifecycle-transition-trace.ts` — new DEFAULT_OFF,
  bounded causal observer and validator. It is not an authority and adds no
  public protocol field or permanent public API.
- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` — the existing
  decision consumer and effect executor now emit opt-in facts at the real
  authority, request, phase-commit, and marker-effect boundaries.

No completion authorization policy, lifecycle state ownership, Elm policy, or
wire protocol changed. The production behavioral delta is limited to
observability when explicitly enabled; disabled tracing emits no records and
does not alter the phase, marker, message, or Elm paths.

## Executed tests and actual results

| Command | Result |
|---|---|
| `node scripts/verify-lifecycle-transition-contract.ts` | PASS — 4 transitions, Mermaid synchronized |
| `cd apps/vscode && ./node_modules/.bin/vitest run --config vitest.config.ts src/sdk/__tests__/c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01.test.ts src/sdk/__tests__/completion-authority-elm-first-seam01.case01.test.ts src/sdk/__tests__/continuation-cardinality-authority01.ccard01.test.ts src/sdk/__tests__/lifecycle-transition-contract-verifier.correction01.test.ts` | PASS — 5 files, 52 tests (36 pre-existing + 16 correction witnesses) |
| `cd apps/vscode && ./node_modules/.bin/tsc --noEmit --pretty false` | PASS — 0 diagnostics |

Vitest reported a non-fatal fork-pool `kill EPERM` teardown warning after
all selected tests passed. The shell did not expose Bun/Bunx on PATH, so the
repository-installed Vitest and TypeScript binaries were run with Node; no
repository script or dependency was changed.

## Evidence classification and unobservable boundaries

- G0 real production seam: PASS.
- G1 source-bound contract: PASS.
- G2 decision/effect correlation: PASS in executable production-seam tests.
- G3 false-correlation rejection: PASS.
- G4 immediate/deferred/HOLD: PASS.
- G5 Mermaid synchronization: PASS (syntax/generated-output validation;
  Mermaid rendering was not executed because no renderer is configured).
- G6 default-off zero state-semantic delta: PASS by conformance test and
  bounded observer design.
- G7 relevant tests/typecheck: PASS.
- G8 exact-source evidence: PASS; see `artifact-manifest.tsv`.
- G9 live status: PASS — honestly classified `PASS_STRUCTURAL_ONLY`.

No live installed-extension evidence was captured. The trace module is
in-process and opt-in; it is not wired to a public dump command in this ACT.
The actual phase commit boundary is observable in `TurnStateTracker`; no React
functional updater participates in this slice. A live process-restart
identity claim is outside this evidence.

## Acceptance gates

| Gate | Result |
|---|---|
| G0 | PASS |
| G1 | PASS |
| G2 | PASS |
| G3 | PASS |
| G4 | PASS |
| G5 | PASS |
| G6 | PASS |
| G7 | PASS |
| G8 | PASS |
| G9 | PASS |

## Successor ACT rule

| Candidate | Current owner | Observable facts | Safe Elm boundary? | Evidence |
|---|---|---|---|---|
| Terminal completion marker presentation predicate | TypeScript/webview pure selector | row marker, task phase, mode | Yes, but it is presentation projection rather than new completion authority | P-04 and `resolveTerminalReportFraming` tests |
| Completion commit policy | Elm completion-authority kernel | C9/CCARD factual stages | No new boundary: already Elm-owned | A-03 and real Elm provider tests |
| Deferred-barrier conservation predicates | TypeScript coordinator | owner/job/pending-prompt/notify observations | Not established; inputs span timing-sensitive host observations | A-02/A-05 production-seam tests only |

No additional Elmization candidate is justified by this ACT. The evidence
supports a possible pure presentation projection follow-up only if a
separate ACT demonstrates input-capture and correspondence requirements.

## Artifact provenance

See `artifact-manifest.tsv` for byte sizes and SHA-256 values. The manifest
itself is committed in the closeout commit and therefore describes the
SUBJECT_HEAD source/evidence artifacts rather than recursively including its
own hash.
