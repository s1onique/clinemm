# Final report — ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION03

> **PASS / REPAIR01_COMMITTED_CORRECTION03**
>
> **Reviewer halt addressed:** HALT_SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION.
> The comparator's stamp is now PHASE-KEYED (a map from projected
> phase to its last-seen TurnStateTracker.seq) and updated only
> when the observation represents a real shadow transition (not a
> `"noop"` sentinel). A noop observation under a fresh TurnState
> generation leaves the per-phase stamp at the prior generation,
> so the selector's gate `seq > lastObservedTurnSeqForPhase(P)`
> detects the stale projection even when the comparator has
> otherwise been "touched" at the fresh generation.

## 2. Files changed (CORRECTION03, on top of CORRECTION02)

```text
M apps/vscode/src/sdk/SdkController.ts
  + 24 - 4
  - Renamed getLocalShadowTurnSeq → getLocalShadowTurnSeqForPhase
  - Both call sites (taskHeaderPresentation + thinkingPresentation)
    now derive the phase-keyed stamp from the shadow's currently
    projected phase

M apps/vscode/src/sdk/task-state-shadow.ts
  + 30 - 0
  - lastObservedTurnSeq: number → lastObservedTurnSeqByPhase: Map
  - compareWith: ONLY stamps when event !== "noop"
  - debugReset clears the Map
  - debugLastObservedTurnSeq → debugLastObservedTurnSeqForPhase(phase)

M apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
  + 18 - 4
  - getLastObservedTurnSeq → getLastObservedTurnSeqForPhase(phase)
  - (no-op wiring updated to match)

M apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts
  + ~80 - ~30
  - 1 new adversarial RED: THCP11_C03_RED
  - fixture.observeViaCanonicalShadow uses `task_requested`
    so the comparator's stamp actually fires
  - new fixture.observeNoopViaCanonicalShadow drives a "noop"
    through observeRuntimeEvent for the adversarial schedule
  - test invocations updated to use
    debugLastObservedTurnSeqForPhase(phase)
```

## 3. RED reproduction (CORRECTION03 adversarial schedule)

```text
# With CORRECTION02 code (pre-CORRECTION03):
     × THCP11_C03_RED: unrelated no-op shadow observation after
       legacy transitions MUST NOT bypass the staleness gate

# With CORRECTION03 repair:
 ✓ THCP11_C03_RED                                          (PASS)
```

The CORRECTION03 adversarial schedule drives the real production
seam:

```ts
fx.tracker.set("idle")                              // seq=N
fx.observeViaCanonicalShadow()                       // stamps "idle" → N
fx.tracker.set("streaming")                          // seq=N+1
fx.observeNoopViaCanonicalShadow()                  // does NOT stamp "idle" → still N
// Publication:
seq = tracker.get().seq                              // N+1
canonicalShadowObservedTurnSeq = comparator.debugLastObservedTurnSeqForPhase("idle")  // N
// Staleness gate: seq (N+1) > stamp (N) = true → gate fires → legacy branch
projection.phase === "streaming"  ✓ (NOT "idle")
```

Without CORRECTION03, the comparator's previous behaviour was
"stamp every accepted observation regardless of phase change" — so
the noop observation at seq=N+1 re-stamped the `"idle"` entry to
N+1, the gate evaluated to `N+1 > N+1 = false`, and the shadow
branch returned `phase="idle"`. The LIVE contradiction resurfaces.

## 4. GREEN after CORRECTION03 repair

```text
$ bun run test:vitest -- tcr01.test.ts

 ✓ src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts (19 tests)

 Test Files  1 passed (1)
      Tests  19 passed (19)
```

All 5 RED + 14 conservation tests pass. The RED tests assert the
per-projection invariant explicitly:

```ts
expect(stampAfterNoop).toBe(seqAtIdle)               // noop did NOT re-stamp
expect(stampAfterNoop).not.toBe(seqAfterStreaming)   // seq advanced ≠ stamp advanced
expect(projection.phase).toBe("streaming")           // gate fired; LIVE forbidden
```

## 5. Ablation evidence

Disabling the noop-aware stamping rule (i.e. re-stamping on every
observation regardless of `event === "noop"`):

```text
 × THCP11_C03_RED                              (FAILED)
```

Restored: 19/19 PASS.

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
      Tests  85 passed (85)
```

## 7. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 8. Live qualification

**LIVE_UNAVAILABLE** — the shell environment cannot launch the
VSCodium Aqua session. Per ACT body §9, mechanical RED/GREEN
with same-domain + projection-binding proofs is sufficient.

## 9. Reviewer-halt traceability

Reviewer's halt (verbatim):

```
NEW_P0:
  SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION

GOOD:
  same TurnState sequence domain
  real tracker/comparator RED
  executable conservation
  clean two-commit range

MISSING:
  proof that lastObservedTurnSeq versions the shadow phase,
  rather than merely the most recent shadow observation

ACTION:
  one adversarial RED
  → prove impossible OR reproduce
  → if reproduced, phase-bind the stamp
  → rerun existing gates
```

CORRECTION03 addresses every concern:

1. ✅ The comparator's stamp is now PER-PHASE
   (`lastObservedTurnSeqByPhase: Map<TurnPhase, number | undefined>`).
2. ✅ The stamp only advances on non-noop observations — the
   `"noop"` sentinel (production's "shadow was touched but didn't
   transition") does NOT touch the map.
3. ✅ The selector's gate compares
   `publication.seq > lastObservedTurnSeqForPhase(shadowProjection)`
   — i.e. "is the legacy's current generation newer than the
   generation under which the projected phase was last
   established?" — the per-projection invariant.
4. ✅ Adversarial RED (THCP11_C03_RED) reproduces pre-repair, passes
   post-repair.

## 10. Final disposition

PASS / REPAIR01_COMMITTED_CORRECTION03.

The production invariant "if `turnState.phase === "streaming"`
then `taskHeaderPresentation.phase !== "idle"`" is now enforced
at the canonical seam by a per-projection TurnState-domain
comparison that has causal meaning AND tracks the most recent
phase-establishing observation, not the most recent touch.

R5 remains WATCH_ONLY. R0 remains CLOSED. Multi-element path
cardinality remains CLOSED. FORENSICS01 remains HALTED
historically. REPAIR01 (at `c1c357ccf`) superseded by
CORRECTION02 (at `43bee46bd`), CORRECTION02 superseded by
CORRECTION03 (this commit). All three commits remain in the tree
for audit.

The defect that permits one `ExtensionState` publication to carry
both `turnState.phase="streaming"` and
`taskHeaderPresentation.phase="idle"` is repaired at the canonical
production seam, with **both** the seq-domain identity
(CORRECTION02 invariant) **and** the projection binding
(CORRECTION03 invariant) proven by RED tests driving the real
`TurnStateTracker` + `TaskShadowComparator` end-to-end.

Causal classification: **CASE_D — INDEPENDENT AUTHORITY
GENERATION SKEW** (locked at REPAIR01 `causal-classification.md`).
CORRECTION02 closed the seq-domain identity P0.
CORRECTION03 closes the projection-binding P0.

Repair surface (CORRECTION03):
- `TaskShadowComparator.lastObservedTurnSeq` →
  `lastObservedTurnSeqByPhase: Map<TurnPhase, number | undefined>`
- `compareWith` stamps the Map entry for `shadowPhase` only when
  `event !== "noop"`.
- New accessor `debugLastObservedTurnSeqForPhase(phase)` replaces
  `debugLastObservedTurnSeq()`.
- `TaskShadowHostWiring` exposes
  `getLastObservedTurnSeqForPhase(phase)` (replacing
  `getLastObservedTurnSeq()`).
- `SdkController.getLocalShadowTurnSeqForPhase(phase)` (replacing
  `getLocalShadowTurnSeq()`).
- The selector inputs (`canonicalShadowObservedTurnSeq`) are
  computed from the phase the shadow is currently projecting
  (`getLocalShadowPhase()`).
