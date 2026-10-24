# ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01-CORRECTION01 — bounded correction evidence

**Verdict:** `PASS_STRUCTURAL_ONLY`

**Subject:** `cbf7c6a3d` (the reviewed closeout of `ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01`).

**Why this correction exists.** A review of `cbf7c6a3` returned
`HALT_TRACEABILITY_PROOF_FALSE_POSITIVES`. The implementation was directionally
sound and the 36 reported passing tests were useful evidence, but the two
VERIFICATION MACHINERY components could report PASS without proving the
intended contract. One bounded correction was authorized; no architecture,
Elm kernel, diagram expansion, or documentation cleanup was performed.

## P0 — the causal trace validator accepted a completion that never committed

`validateLifecycleTransitionTrace()` required only `authority_decision`,
`effect_executed`, and `marker_promoted`, and ignored `effect_requested`,
`phase_commit_observed`, `task_id`, `turn_seq`, and the expected transition
identities.

**Reproduced against the pre-correction validator** (exit 0, `{ valid: true }`
for every case):

| Counterexample | Pre-correction | Post-correction |
|---|---|---|
| no `phase_commit_observed` | `valid: true` | `missing_phase_commit_observed` |
| foreign `task_id` | `valid: true` | `task_identity_mismatch` |
| foreign `turn_seq` | `valid: true` | `turn_identity_mismatch` |
| wrong transition id on the commit | `valid: true` | `transition_identity_mismatch:phase_commit_observed` |
| commit observed after the promotion | `valid: true` | `stage_order_violation` |

**Correction.** The validator now requires the complete successful chain
`authority_decision (A-03) -> effect_requested (A-04) -> phase_commit_observed
(A-04) -> effect_executed (P-06) -> marker_promoted (P-06)`, with one shared
execution context (decision id, task id, turn sequence) and strict ordering.

**Witnesses.** `RED-06` … `RED-11` in
`apps/vscode/src/sdk/__tests__/c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts`.
Each was confirmed to FAIL against the pre-correction module (verified by
re-running the suite against the stashed pre-correction file: **6 failed / 14
passed**) and PASS against the corrected module (**20 passed**).

## P0 — the contract validator did not verify contract-to-diagram synchronization

The validator used a hardcoded `requiredStatePairs` map and SEPARATELY checked
that each transition id appeared *somewhere* in the Mermaid text. Those two
checks were independent, so both of the following escaped detection.

**Reproduced against the pre-correction validator:** a Mermaid mutation that
swapped the `A-03` and `A-04` edge labels (every id still PRESENT) returned
`PASS` with **exit 0**. The corrected validator returns **exit 1** with
per-transition diagnostics.

**Correction.** The validation core was extracted to
`apps/vscode/src/sdk/lifecycle-transition-contract-verifier.ts` as pure,
importable functions. It now

1. maps each contract `source_state`/`target_state` to an explicit Mermaid
   state id (`STATE_ID_BY_CONTRACT_STATE`),
2. parses the ACTUAL labeled Mermaid edges — Mermaid associates the text
   after `:` with the edge that precedes it, so the association is what is
   checked, not the presence of matching strings,
3. asserts, per transition id, that exactly one labeled edge exists and that
   its source/target are the ones the contract requires.

**Contract reconciliation.** The contract TSV's A-03 `source_state` was
corrected from `C9 captured` to `Elm consulted` so it names the edge it
carries. A-03 is the Elm consult whose authorize branch is
`ElmConsulted --> ElmAuthorized`; this is consistent with the canonical ledger
(`docs/architecture/task-lifecycle/transitions.tsv`: A-03 -> `Elm consulted`)
and the architecture doc (`A-03 — the Elm consult`). A-04, A-05, and P-06
already agreed with their labeled edges and were left unchanged. The
pre-correction validator could not detect this disagreement because it never
compared the TSV states against the edges.

**Witnesses.** `MUT-01` … `MUT-06` in
`apps/vscode/src/sdk/__tests__/lifecycle-transition-contract-verifier.correction01.test.ts`,
covering an altered `source_state`, an altered `target_state`, a transition id
attached to the wrong edge, a duplicated transition id, a removed label id, and
a non-`stateDiagram-v2` diagram.

## P1 — coordinator diff inspection (evidence limitation, no production defect)

The review digest suppressed the `sdk-session-event-coordinator.ts` body as
`LARGE_FILE_EVIDENCE_BOUNDED`. The focused diff for `e6b8eb9ff` was inspected
directly.

**Every change is additive instrumentation:** the trace-module import; one new
private field (`pendingLifecycleDecisionId`); one new private helper
(`lifecycleTraceContext()`); and `recordLifecycleTransitionTrace(...)` calls at
the authority, request, phase-commit, and marker-effect boundaries.

**The single control-flow rewrite** is

    - if (decision.kind === "authorize") return true
    + if (decision.kind === "authorize") { <record trace>; return true }

The condition, the return value, and the fall-through to the `hold` branch are
unchanged.

**Zero state-semantic delta, independently confirmed:** `traceEnabled`
defaults to `false`; `recordLifecycleTransitionTrace()` returns immediately when
disabled; and no production code path enables tracing (verified by an
exhaustive grep of `apps/vscode/src/` outside the tests and the trace module
itself). The trace-disabled conformance test additionally asserts the real
completion commit count, phase, and webview framing are unchanged.

## Gates

| Gate | Command | Result |
|---|---|---|
| Contract/Mermaid validator | `bun scripts/verify-lifecycle-transition-contract.ts` | PASS — 4 transitions, Mermaid synchronized (exit 0) |
| Focused + correction test selection | `cd apps/vscode && ./node_modules/.bin/vitest run --config vitest.config.ts <5 files>` | PASS — 5 files, **52 tests** (36 pre-existing + 16 correction witnesses) |
| Typecheck | `cd apps/vscode && ./node_modules/.bin/tsc --noEmit --pretty false` | PASS — exit 0, **0 diagnostics** |

Vitest emitted the known non-fatal fork-pool `kill EPERM` teardown warning
after all selected tests passed. The shell did not expose Bun/Bunx on PATH,
so the repository-installed Vitest and TypeScript binaries were invoked
through Node; no repository script or dependency was changed.

## Verdict

`PASS_STRUCTURAL_ONLY` — the two verification-machinery false positives are
closed with RED witnesses that demonstrably fail against the pre-correction
code, and the coordinator diff is independently confirmed to be
zero-state-semantic-delta instrumentation. No live installed-extension
evidence was captured or is claimed.
