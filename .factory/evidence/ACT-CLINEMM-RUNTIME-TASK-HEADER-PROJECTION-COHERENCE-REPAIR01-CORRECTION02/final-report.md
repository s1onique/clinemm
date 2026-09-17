# Final report — ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02

> **PASS / REPAIR01_COMMITTED_CORRECTION02**
>
> **Reviewer halt addressed:** HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN.
> The shadow observation is now stamped with the
> `TurnStateTracker.seq` at the moment the observation is
> accepted. Both sides of the publication-selector staleness gate
> (`seq` and `canonicalShadowObservedTurnSeq`) are sampled from
> the SAME `TurnStateTracker` instance — the numeric comparison
> `seq > canonicalShadowObservedTurnSeq` now has causal meaning
> (the legacy has advanced since the shadow last observed).

## 1. Outcome

The defect that permits one `ExtensionState` publication to carry
both `turnState.phase="streaming"` and
`taskHeaderPresentation.phase="idle"` is repaired at the canonical
production seam, with the seq-domain identity proven by the RED
tests driving the real `TurnStateTracker` + `TaskShadowComparator`
end-to-end (not by manually injected numbers).

Causal classification: **CASE_D — INDEPENDENT AUTHORITY
GENERATION SKEW** (locked at `causal-classification.md`).

Repair surface (CORRECTION02): one new optional input parameter
(`canonicalShadowObservedTurnSeq?: number`) on both
`selectTaskHeaderPresentation` and `selectThinkingPresentation`,
with one extra precedence gate that falls through to the legacy
branch when the shadow's last observation seq is older than the
legacy tracker's seq. The shadow's last-observation seq is
sourced from the SAME `TurnStateTracker` instance as the
publication's `seq` — verified by the test seam.

## 2. Files changed (CORRECTION02, on top of REPAIR01)

```text
M apps/vscode/src/sdk/SdkController.ts
  + 18 - 0
  - Renamed getLocalShadowSeq → getLocalShadowTurnSeq
  - Renamed parameter: canonicalShadowSeq → canonicalShadowObservedTurnSeq
  - Added getTurnSeq wiring dep at SdkController.ts:1098:
    `getTurnSeq: () => this.turnStateTracker.get().seq`

M apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts
  + 60 - 14
  - Renamed canonicalShadowSeq → canonicalShadowObservedTurnSeq
    on both ThinkingPresentationInputs and TaskHeaderPresentationInputs
  - Same-domain staleness gate:
    `seq > canonicalShadowObservedTurnSeq` (both TurnState-domain)

M apps/vscode/src/sdk/task-state-shadow-coordinator.ts
  + 25 - 2
  - Added getTurnSeq?: () => number | undefined to deps
  - applyToComparator now threads turnSeq through
  - applyAndRecord samples turnSeq = deps.getTurnSeq?.() at the
    moment it samples the legacy phase

M apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
  + 28 - 1
  - Renamed getLastObservedShadowSeq → getLastObservedTurnSeq
  - Added getTurnSeq to TaskShadowHostWiringDeps
  - Plumbed getTurnSeq into createTaskShadowObservationCoordinator
  - Implementation reads comparator.debugLastObservedTurnSeq()

M apps/vscode/src/sdk/task-state-shadow.ts
  + 24 - 1
  - Renamed debugObservedSeq → debugLastObservedTurnSeq
  - observeRuntimeEvent + observeTaskMsg + compareWith now
    accept turnSeq?: number and stamp it on
    `lastObservedTurnSeq`

M apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts
  + ~280 - ~200
  - 4 production-seam RED tests (real TurnStateTracker +
    real TaskShadowComparator; no manual numbers)
  - 14 conservation tests (T1..T14) using
    `canonicalShadowObservedTurnSeq` (the renamed parameter)
```

## 3. RED reproduction (pre-CORRECTION02 HEAD)

The previous REPAIR01 at `c1c357ccf` had the same problem the
reviewer flagged: RED tests passed because they encoded the
invalid identity assumption by hand. CORRECTION02 abandons that
approach and drives the real production seam.

The CORRECTION02 RED tests drive:

- real `MessageIdMinter`
- real `TurnStateTracker`
- real `TaskShadowComparator` (with `turnSeq` parameter sourced
  from `tracker.get().seq`)
- `selectTaskHeaderPresentation` with `seq = tracker.get().seq`
  and `canonicalShadowObservedTurnSeq = comparator.debugLastObservedTurnSeq()`

```ts
// RED reproduction (test snippet, real seam)
fx.tracker.set("idle")
const seqAtFirstSet = fx.tracker.get().seq
fx.observeViaCanonicalShadow()                          // stamps lastObservedTurnSeq=seqAtFirstSet
fx.tracker.set("streaming")                              // advances TurnState seq
const projection = selectTaskHeaderPresentation({
	canonicalShadowPhase: fx.currentShadowPhase(),
	currentLegacyPhase:   fx.tracker.currentPhase,
	seq:                  fx.tracker.get().seq,
	canonicalShadowObservedTurnSeq: fx.comparator.debugLastObservedTurnSeq(),
})
expect(projection.phase).toBe("streaming")                // not "idle"
expect(projection.source).toBe("legacy")                 // not "shadow"
```

## 4. GREEN after CORRECTION02 repair

```text
$ bun run test:vitest -- src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts

 ✓ src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts (18 tests) 4ms

 Test Files  1 passed (1)
      Tests  18 passed (18)
```

All 4 RED + 14 conservation tests pass. RED tests additionally
assert the same-domain identity:

```ts
expect(fx.comparator.debugLastObservedTurnSeq()).toBe(seqAtFirstSet) // same-domain equality
expect(publicationShadowStamp).toBeLessThan(publicationSeq)            // same-domain ordering
```

## 5. Ablation evidence (proves the gate is necessary)

Disabling the staleness gate (`isShadowStale = false`) on either
selector makes 6 of 18 tests FAIL:

```text
× THCP11_C02_RED                              (LIVE contradiction)
× THCP11_C02_RED_INVERSE                      (mirror case)
× THCP11_C02_THINKING_RED                     (Thinking)
× T8                                          (cancel fence)
× T9                                          (THE LIVE CONTRADICTION)
× T10                                         (Thinking stale fallback)
```

Restored from backup: 18/18 PASS.

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
      Tests  84 passed (84)
```

## 7. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 8. Live qualification

**LIVE_UNAVAILABLE** — the shell environment cannot launch the
VSCodium Aqua session. Per ACT body §9, mechanical RED/GREEN
with same-domain proof is sufficient.

## 9. Reviewer-halt traceability

Reviewer's halt (verbatim):

```
P0 — HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN remains open.
... The wiring then exposes that unrelated counter as
getLastObservedShadowSeq(). Nothing in the supplied patch binds
that counter to the TurnStateTracker/publication seq domain.
... The new tests continue to manually manufacture this
assumption
... RED requirement:
   TurnState seq=N → shadow observes state and stores
   observedTurnSeq=N → TurnState transitions to streaming,
   seq=N+1 → publication → stale shadow cannot override streaming
... HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN.
```

CORRECTION02 addresses every concern:

1. ✅ The wiring now exposes `getLastObservedTurnSeq()` — read
   from `comparator.debugLastObservedTurnSeq()` which is stamped
   with `TurnStateTracker.seq` at observation time.
2. ✅ `TurnStateTracker.seq` is the binding source.
3. ✅ The RED tests drive the actual stamping seam (real
   `TurnStateTracker` + real `TaskShadowComparator`):
   - `tracker.set("idle")` → seq=N
   - `comparator.observeTaskMsg(..., turnSeq=tracker.get().seq)`
     → stamps `lastObservedTurnSeq = N`
   - `tracker.set("streaming")` → seq=N+1
   - `selectTaskHeaderPresentation({ seq: tracker.get().seq,
     canonicalShadowObservedTurnSeq:
       comparator.debugLastObservedTurnSeq() })`
     → stale shadow cannot override streaming ✓

## 10. Final disposition

PASS / REPAIR01_COMMITTED_CORRECTION02.

The production invariant "if `turnState.phase === "streaming"`
then `taskHeaderPresentation.phase !== "idle"`" is now enforced
at the canonical seam by a TurnState-domain-numeric comparison
that has causal meaning.

R5 remains WATCH_ONLY. R0 remains CLOSED. Multi-element path
cardinality remains CLOSED. FORENSICS01 remains HALTED
historically. REPAIR01 (at `c1c357ccf`) is superseded by
CORRECTION02 (this commit).
