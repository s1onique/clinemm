# Exact-source evidence report

## Scope and classification

This ACT qualifies one production slice: C9 completion attempt → Elm C10
authorization → TypeScript phase effect → committed phase → authoritative
completion-marker promotion.

Qualification: `PASS_STRUCTURAL_ONLY`.

The executable tests drive the real `SdkSessionEventCoordinator`, the real
`MessageTranslatorState`, the real `TurnStateTracker`, and the real webview
`applyMessage` reducer. The Elm decision provider is injected at the existing
production provider boundary, so these are production-seam conformance tests,
not copied state-machine tests. Live installed-VSIX qualification was not run
in this checkout; no synthetic evidence is presented as live.

## Ownership map

See `ownership-map.md`.

## Transition coverage

| Transition | Decision evidence | Effect evidence | Result |
|---|---|---|---|
| A-03 | `checkElmCompletionAuthority` consumes closed Elm decision; trace stage `authority_decision` | N/A: authorization only | PASS |
| A-04 | Same decision id enters requested effect | `TurnStateTracker.currentPhase === "completed"`; trace stages `effect_requested` and `phase_commit_observed` | PASS |
| A-05 | Trace stage `authority_decision` with `held`/`failure` | No phase commit; no marker promotion; `marker_suppressed` present | PASS |
| P-06 | Authorized A-03 decision id | Same-`ts` promoted row and real webview completed framing; trace stages `effect_executed` and `marker_promoted` | PASS |

## Observable versus inferred boundaries

Observed in executable production-seam tests:

- policy decision and outcome;
- requested completed-phase effect;
- committed `TurnStateTracker` phase;
- marker effect execution and same-row promotion;
- real webview reducer projection;
- HOLD/FAILURE suppression;
- trace-disabled and trace-enabled equivalence.

Not claimed:

- a live installed-extension capture;
- an independently persisted completion identity across process restarts;
- a React functional-updater commit boundary (this path uses the tracker snapshot);
- a new general-purpose tracing framework.

## Counterexample

ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01-CORRECTION01 strengthened the causal
validator; the pre-correction validator accepted a chain carrying only the
authority decision, the effect execution, and the marker promotion, and
ignored the task id, the turn sequence, the transition identities, and the
ordering of the commit relative to the promotion.

The validator now requires the complete successful chain
(`authority_decision` → `effect_requested` → `phase_commit_observed` →
`effect_executed` → `marker_promoted`) with one shared execution context and
strict ordering. Witnesses `RED-06` … `RED-11` cover: a chain whose phase
commit was never observed, a chain whose phase request was never observed, a
foreign task id, a foreign turn sequence, a wrong transition identity on the
commit, and a commit observed after the marker promotion. Each witness was
confirmed to FAIL against the pre-correction validator and PASS against the
corrected one.

## Contract-to-diagram synchronization

ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01-CORRECTION01 replaced the pre-correction
contract validator, which used a hardcoded `requiredStatePairs` map and
separately checked that each transition id appeared somewhere in the Mermaid
text. Those independent checks admitted a PASS for an altered contract state
and for a transition id attached to the wrong edge (both reproduced: the old
validator returned exit 0 on a swapped-label mutation).

The validator now maps each contract `source_state`/`target_state` to an
explicit Mermaid state id, parses the actual labeled edges, and asserts the
association per transition id. Witnesses `MUT-01` … `MUT-06` cover an altered
`source_state`, an altered `target_state`, a transition id on the wrong edge, a
duplicated transition id, a removed label id, and a non-`stateDiagram-v2`
diagram.

## Effect failure

The harness injects failure in the production marker update channel. The
trace contains a committed phase but no `effect_executed` or
`marker_promoted`; the suite does not falsely claim publication success.

## Deferred and duplicate behavior

The existing production-seam suite in the same file verifies:

- Elm HOLD at turn end, then later authorization through
  `notifyAgentTurnDone` / `reevaluateDeferredCompletionBarrier`, promotes the
  existing row with the same `ts` and without early promotion;
- a permanently held completion never claims authority;
- the webview reducer drops an older-epoch stale promotion;
- an uncontended completion commits once and presents one completed row.

The selected ACT adds no duplicate-event policy behavior; the existing
exactly-once completion identity remains owned by `nextCompletionCommitEventId`.

## Commands and results

- `node scripts/verify-lifecycle-transition-contract.ts` — PASS.
- `cd apps/vscode && ./node_modules/.bin/vitest run --config vitest.config.ts ...` — focused suite PASS.
- `cd apps/vscode && ./node_modules/.bin/tsc --noEmit --pretty false` — PASS.

The local shell did not expose `bun`/`bunx` on PATH. The repository's
installed Vitest and TypeScript binaries were invoked through Node instead;
this changes no repository script or dependency. Vitest emitted a non-fatal
pool-worker `kill EPERM` warning during teardown after reporting all tests
passed.

## Artifacts

Artifact hashes and byte sizes are recorded in `artifact-manifest.tsv` after
the subject commit is created.
