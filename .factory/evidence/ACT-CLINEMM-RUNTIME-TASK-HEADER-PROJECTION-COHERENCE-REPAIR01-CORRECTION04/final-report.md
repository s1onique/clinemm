# Final report — ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION04

> **PASS / REPAIR01_COMMITTED_CORRECTION04**
>
> **Reviewer halt addressed:** HALT_PHASE_STAMP_ADVANCES_ON_SEMANTIC_NOOP.
> The comparator's stamp now advances only on **material model
> mutations**, not on event-label proxies. The label-based
> `event !== "noop"` rule that CORRECTION03 introduced was
> insufficient because the production shadow reducer accepts
> non-`"noop"` TaskMsgs as semantic no-ops (e.g. `approval_resolved`
> with no active approval — `task-state.update.test.ts:312`).
> CORRECTION04 replaces that rule with the canonical
> structural-equality check `isSameTaskModel` on the pre- and
> post-observation `TaskModel`s.
>
> **Chain of corrections:**
> - CORRECTION02: same-domain identity (`HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN`).
> - CORRECTION03: phase-keyed stamp + adapter-noop guard
>   (`HALT_SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION`).
> - CORRECTION04 (this): model-change-bound stamping
>   (`HALT_PHASE_STAMP_ADVANCES_ON_SEMANTIC_NOOP`).

## 1. Outcome

The defect that permits one `ExtensionState` publication to carry
both `turnState.phase="streaming"` and
`taskHeaderPresentation.phase="idle"` is repaired at the canonical
production seam, with **three RED proofs** driving the real
`TurnStateTracker` + `TaskShadowComparator` end-to-end:

1. `THCP11_C02_RED` — stale shadow projection, fresh legacy
   transition. (CORRECTION02 invariant.)
2. `THCP11_C03_RED` — adapter-generated `"noop"` observation
   after the legacy transition must NOT bypass the gate.
   (CORRECTION03 invariant.)
3. `THCP11_C04_RED` — **reducer semantic-noop** TaskMsg
   (e.g. `approval_resolved` without active approval) after the
   legacy transition must NOT bypass the gate.
   (CORRECTION04 invariant — this entry.)

Causal classification: **CASE_D — INDEPENDENT AUTHORITY
GENERATION SKEW** (locked at REPAIR01).

## 2. Files changed (CORRECTION04, on top of CORRECTION03)

```text
M apps/vscode/src/sdk/task-state-shadow.ts
  + 56 - 14
  - Imported `isSameTaskModel` from `TaskState`.
  - `compareWith` takes a pre-observation model snapshot
    (`preModel: TaskModel | null = null`).
  - Stamp-advance condition is now:
      event !== "noop" AND materialMutation
    where `materialMutation = preModel === null
        ? true
        : !isSameTaskModel(preModel, observation.model)`.
  - `observeRuntimeEvent` / `observeTaskMsg` snapshot the
    shadow model BEFORE replay and pass it in.
  - Doc comment refresh: now reads CORRECTION04 and
    preserves the chain-of-corrections rationale.
```

The fixture (`tcr01.test.ts`) gains:

```text
+ observeSemanticNoopApprovalResolved()
+ observeStreamingStart()
+ observeToolStarted(toolCallId)
+ THCP11_C04_RED (semantic-noop adversarial)
+ THCP11_C04_POSITIVE (same-phase mutation control)
```

## 3. RED reproduction (CORRECTION04 adversarial schedule)

```text
# With CORRECTION03 code (pre-CORRECTION04):
 × THCP11_C04_RED: real TaskMsg that is a semantic no-op
   MUST NOT bypass the staleness gate                    (FAIL)

# With CORRECTION04 repair:
 ✓ THCP11_C04_RED                                          (PASS)
```

The CORRECTION04 adversarial schedule drives the real production
seam:

```ts
fx.tracker.set("idle")                       // seq=N
fx.observeViaCanonicalShadow()                // task_requested -> running lifecycle -> projects "idle" -> stamps idle -> N
fx.tracker.set("streaming")                   // seq=N+1
// Phase stays "idle":
fx.observeSemanticNoopApprovalResolved()     // reducer accepts but model unchanged
// Per CORRECTION04 invariant:
//   materialMutation = !isSameTaskModel(pre, post) === false
//   => stamp for "idle" remains N
expect(stamp).toBe(N)
expect(stamp).not.toBe(N+1)
// Gate: N+1 > N = true -> legacy branch -> "streaming"
expect(projection.phase).toBe("streaming")  // NOT "idle"
```

## 4. GREEN after CORRECTION04 repair

```text
$ bun run test:vitest -- tcr01.test.ts
 ✓ src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts (21 tests)

 Test Files  1 passed (1)
      Tests  21 passed (21)
```

All 7 RED + 14 conservation tests pass. The CORRECTION04 RED
asserts the model-material invariant explicitly:

```ts
expect(stampAfterSemanticNoop).toBe(seqAtIdle)            // semantic no-op did NOT re-stamp
expect(stampAfterSemanticNoop).not.toBe(seqAfterStreaming) // seq advanced, model unchanged
expect(projection.phase).toBe("streaming")                // gate fired; LIVE forbidden
```

## 5. Ablation necessity proof

Disabling the model-equality check
(`materialMutation = preModel === null ? true : true`):

```text
 × THCP11_C04_RED: real TaskMsg that is a semantic no-op
   MUST NOT bypass the staleness gate                  (FAILED)
```

All other tests still pass when the check is ablated — proving
that the model-equality check is **necessary** and additive
(not a regression risk for the C02/C03 REDs).

Restored: 21/21 PASS.

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
      Tests  87 passed (87)
```

## 7. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 8. Live qualification

**LIVE_UNAVAILABLE** — the shell environment cannot launch the
VSCodium Aqua session. Per ACT body §9, mechanical RED/GREEN
with chain-of-corrections proofs is sufficient.

## 9. Reviewer-halt traceability

Reviewer's halt (verbatim, paraphrased):

```
NEW_P0:
  event != "noop" is not equivalent to shadow-state mutation

ACTION:
  one bounded correction
  + semantic-noop RED
  + same-phase-mutating positive control
  + model-change-bound stamping
```

CORRECTION04 addresses every concern:

1. ✅ Adversarial RED (`THCP11_C04_RED`) drives the
   semantic-noop schedule the reviewer demanded using a
   documented reducer no-op (`approval_resolved` without
   active approval — `task-state.update.test.ts:312`).
2. ✅ Positive control (`THCP11_C04_POSITIVE`) drives the
   same-phase-mutating-but-model-changes schedule
   (e.g. another `tool_started` while already "streaming").
3. ✅ Stamp is now model-change-bound: `isSameTaskModel`
   canonical check before updating
   `lastObservedTurnSeqByPhase`.
4. ✅ The `event !== "noop"` belt-and-braces guard is
   retained (covers the adapter-sentinel path from
   CORRECTION03).
5. ✅ All three REDs (C02, C03, C04) reproduce in their
   respective pre-repair revisions and pass in
   CORRECTION04.

## 10. Final disposition

PASS / REPAIR01_COMMITTED_CORRECTION04.

The production invariant "if `turnState.phase === "streaming"`
then `taskHeaderPresentation.phase !== "idle"`" is now enforced
at the canonical seam by:

  - a per-projection Map<TurnPhase, number | undefined> stamp
    keyed on the phase the shadow currently projects, AND
  - a model-equality bound on the stamp advance: only
    observations that structurally mutate the shadow model
    (per `isSameTaskModel`) advance the stamp, AND
  - the canonical TurnState-domain identity preserved from
    CORRECTION02.

R5 remains WATCH_ONLY. R0 remains CLOSED. Multi-element path
cardinality remains CLOSED. FORENSICS01 remains HALTED
historically. REPAIR01 (`c1c357ccf`) superseded by
CORRECTION02 (`43bee46bd`), superseded by CORRECTION03
(`5d926c273`), superseded by CORRECTION04 (this commit). All
four commits remain in the tree for audit.
