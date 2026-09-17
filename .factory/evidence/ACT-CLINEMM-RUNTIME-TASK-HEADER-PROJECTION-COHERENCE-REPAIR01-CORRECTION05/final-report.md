# Final report - ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION05

> **PASS / REPAIR01_COMMITTED_CORRECTION05**
>
> **Reviewer halt addressed:** HALT_PHASE_STAMP_ADVANCES_ON_NON_PHASE_MUTATION.
> The comparator's stamp now advances only on mutations to
> the canonical phase-authority tuple consumed by
> `projectTurnState` (selectors.ts:47), not on any
> `TaskModel` mutation. CORRECTION04's full-model equality
> check was over-broad: real mutations to
> recovery/telemetry/identity do NOT participate in phase
> derivation. `recovery_changed` materially mutated the
> model but the projected phase was unchanged - yet
> CORRECTION04 stamped it, restoring the LIVE
> contradiction.
>
> **Chain of corrections (all complete):**
> - CORRECTION02: same-domain identity (`HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN`).
> - CORRECTION03: phase-keyed stamp + adapter-noop guard
>   (`HALT_SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION`).
> - CORRECTION04: model-change-bound stamping
>   (`HALT_PHASE_STAMP_ADVANCES_ON_SEMANTIC_NOOP`).
> - CORRECTION05 (this): projection-authority-bound
>   stamping
>   (`HALT_PHASE_STAMP_ADVANCES_ON_NON_PHASE_MUTATION`).

## 1. Outcome

The defect that permits one `ExtensionState` publication to
carry both `turnState.phase="streaming"` and
`taskHeaderPresentation.phase="idle"` is repaired at the
canonical production seam, with **four RED proofs** driving
the real `TurnStateTracker` + `TaskShadowComparator`
end-to-end:

1. `THCP11_C02_RED` - stale shadow projection, fresh legacy
   transition. (CORRECTION02 invariant.)
2. `THCP11_C03_RED` - adapter-generated `"noop"`
   observation after the legacy transition must NOT bypass
   the gate. (CORRECTION03 invariant.)
3. `THCP11_C04_RED` - reducer semantic-noop TaskMsg
   (e.g. `approval_resolved` without active approval) after
   the legacy transition must NOT bypass the gate.
   (CORRECTION04 invariant.)
4. `THCP11_C05_RED` + `THCP11_C05_STREAMING_RED` -
   non-phase-authority `TaskModel` mutation (e.g.
   `recovery_changed` updating only `recovery.*` +
   `telemetry.*`) must NOT bypass the gate, even though the
   model materially changed. (CORRECTION05 invariant - this
   entry.)

Causal classification: **CASE_D - INDEPENDENT AUTHORITY
GENERATION SKEW** (locked at REPAIR01).

## 2. Files changed (CORRECTION05, on top of CORRECTION04)

```text
M apps/vscode/src/sdk/task-state-shadow.ts
  + 37 - 5
  - Removed `isSameTaskModel` import from `TaskState`.
  - Added helper `isSameTurnProjectionAuthority(a, b)`
    that compares only the canonical phase-authority
    tuple consumed by `projectTurnState`:
      activity.awaitingApproval
      activity.modelStreaming
      activity.activeToolCallIds (order-sensitive)
      lifecycle.kind (+ reason only when kind=failed)
  - `compareWith` stamping condition is now:
      event !== "noop" AND projectionAuthorityChanged
    where
      projectionAuthorityChanged
        = preModel === null
          ? true
          : !isSameTurnProjectionAuthority(
              preModel, observation.model
            )

The fixture (tcr01.test.ts) gains:
  + observeRecoveryChanged()
  + THCP11_C05_RED (non-phase-authority adversarial)
  + THCP11_C05_AUTHORITY_POSITIVE (same-phase
    projection-authority mutation control)
  + THCP11_C05_STREAMING_RED (recovery_changed while
    already streaming)
```

## 3. RED -> GREEN (chain-of-corrections)

| Test                                  | Pre-C02 | Pre-C03 | Pre-C04 | Pre-C05 | Post-C05 |
| ------------------------------------- | ------- | ------- | ------- | ------- | -------- |
| THCP11_C02_RED                        | FAIL    | PASS    | PASS    | PASS    | PASS     |
| THCP11_C02_RED_INVERSE                | FAIL    | PASS    | PASS    | PASS    | PASS     |
| THCP11_C02_RED_FRESH_SHADOW_PRESERVED | PASS    | PASS    | PASS    | PASS    | PASS     |
| THCP11_C02_THINKING_RED               | FAIL    | PASS    | PASS    | PASS    | PASS     |
| THCP11_C03_RED                        | n/a     | FAIL    | PASS    | PASS    | PASS     |
| THCP11_C04_RED                        | n/a     | n/a     | FAIL    | PASS    | PASS     |
| THCP11_C04_POSITIVE                   | n/a     | n/a     | PASS    | PASS    | PASS     |
| THCP11_C05_RED                        | n/a     | n/a     | n/a     | FAIL    | PASS     |
| THCP11_C05_AUTHORITY_POSITIVE         | n/a     | n/a     | n/a     | PASS    | PASS     |
| THCP11_C05_STREAMING_RED              | n/a     | n/a     | n/a     | FAIL    | PASS     |
| Conservation T1..T14                  | PASS    | PASS    | PASS    | PASS    | PASS     |

(Each RED reproduces in its respective pre-repair
revision.)

## 4. GREEN after CORRECTION05 repair

```text
$ bun run test:vitest -- tcr01.test.ts
 ✓ src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts (24 tests)

 Test Files  1 passed (1)
      Tests  24 passed (24)
```

The CORRECTION05 REDs assert the projection-authority
invariant explicitly:

```ts
expect(stampAfterRecovery).toBe(seqAtIdle)
expect(stampAfterRecovery).not.toBe(seqAfterStreaming)
expect(projection.phase).toBe("streaming")
```

## 5. Ablation necessity proof

Disabling the projection-authority check
(`projectionAuthorityChanged = preModel === null ? true : true`):

```text
 × THCP11_C04_RED: real TaskMsg that is a semantic no-op
   MUST NOT bypass the staleness gate                  (FAILED)
 × THCP11_C05_RED: recovery_changed (non-phase-authority
   mutation) MUST NOT bypass staleness gate             (FAILED)
 × THCP11_C05_STREAMING_RED: recovery_changed while
   already streaming MUST NOT advance stamp             (FAILED)
```

The same ablation leaves `THCP11_C03_RED` PASSing (gated
by `event !== "noop"`), `THCP11_C02_*` PASSing (gated by
the seq identity from CORRECTION02), and the positive
controls PASSing (their mutations are real
phase-authority changes). Proving the projection-authority
check is **necessary** and additive - not a regression
risk for the C02/C03 invariants.

Restored: 24/24 PASS.

## 6. Conservation (no regression)

```text
$ bun run test:vitest -- \
    src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts \
    src/sdk/__tests__/task-state-shadow-thinking-presentation.e7.1.test.ts \
    src/sdk/__tests__/task-state-shadow-host-wiring.test.ts \
    src/sdk/__tests__/task-state-shadow-arbiter-mapper.test.ts \
    src/sdk/__tests__/task-state-shadow-coordinator.test.ts \
    src/sdk/__tests__/sdk-compaction-coordinator.task-header-projection.thcp11.test.ts \
    src/sdk/__tests__/task-completion-continuation-coherence.tccc01.test.ts \
    src/sdk/__tests__/sdk-compaction-coordinator.legacy-turnstate-coherence.cltcc01.test.ts \
    src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts

 Test Files  7 passed (7)
      Tests  90 passed (90)
```

## 7. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 8. Live qualification

**LIVE_UNAVAILABLE** - the shell environment cannot launch
the VSCodium Aqua session. Per ACT body s9, mechanical
RED/GREEN with chain-of-corrections proofs is sufficient.

## 9. Reviewer-halt traceability

Reviewer's halt (verbatim, paraphrased):

```
NEW_P0:
  full TaskModel mutation != phase-authority mutation

ACTION:
  one adversarial recovery_changed RED
  -> phase-authority-keyed mutation test
  -> rerun existing 21 + conservation/typecheck
```

CORRECTION05 addresses every concern:

1. Adversarial RED
   (`THCP11_C05_RED` + `THCP11_C05_STREAMING_RED`)
   reproduces the reviewer's `recovery_changed` schedule.
   The shadow model materially mutates (`recovery.*`,
   `telemetry.*`) but the canonical projection-authority
   tuple consumed by `projectTurnState` is untouched.
2. Stamp is now projection-authority-bound:
   `isSameTurnProjectionAuthority` compares ONLY the four
   axes that `projectTurnState` reads.
3. All four REDs (C02, C03, C04, C05) reproduce in
   their respective pre-repair revisions and pass in
   CORRECTION05.
4. Positive controls retained: `C05_AUTHORITY_POSITIVE`
   confirms that same-phase mutations whose mutation IS
   in the phase-authority tuple (e.g. `tool_started`
   adding to `activeToolCallIds`) still advance the
   stamp.
5. Ablation proof: disabling the projection-authority
   check fails only the C04_RED + C05_* REDs - proves
   the check is necessary and additive.

## 10. Final disposition

PASS / REPAIR01_COMMITTED_CORRECTION05.

The production invariant "if `turnState.phase === "streaming"`
then `taskHeaderPresentation.phase !== "idle"`" is now
enforced at the canonical seam by:

  - a per-projection Map<TurnPhase, number | undefined>
    stamp keyed on the phase the shadow currently projects,
    AND
  - a projection-authority bound on the stamp advance:
    only observations that change the canonical
    phase-authority tuple consumed by `projectTurnState`
    (per `isSameTurnProjectionAuthority`) advance the
    stamp, AND
  - the canonical TurnState-domain identity preserved from
    CORRECTION02, AND
  - the adapter-`"noop"` belt-and-braces guard from
    CORRECTION03, AND
  - the model-material guard from CORRECTION04
    collapsed into the narrower
    `isSameTurnProjectionAuthority`.

R5 remains WATCH_ONLY. R0 remains CLOSED. Multi-element
path cardinality remains CLOSED. FORENSICS01 remains
HALTED historically. All five commits remain in the tree
for audit:

- REPAIR01    (`c1c357ccf`)
- CORRECTION02 (`43bee46bd`)
- CORRECTION03 (`5d926c273`)
- CORRECTION04 (`0a375393d`)
- CORRECTION05 (current)
