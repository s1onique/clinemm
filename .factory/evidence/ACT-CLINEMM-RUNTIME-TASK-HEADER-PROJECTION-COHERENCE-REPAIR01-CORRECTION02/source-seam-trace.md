# Source-seam trace — ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02

> Purpose: prove that the CORRECTION02 repair uses a SHARED
> GENERATION DOMAIN between `seq` and the shadow's last-observation
> stamp. Both numbers are sampled from the same
> `TurnStateTracker.seq` counter, so the numeric comparison has
> causal meaning (the legacy has advanced since the shadow last
> observed).

## 1. Where `seq` is generated

`apps/vscode/src/sdk/turn-state-tracker.ts:23` stores `phase` and
`seq`. Each call to `set()` / `setWithWriter()` (line 95) advances
`seq` via `MessageIdMinter.nextSeq()` (line 103). This is the
**TurnState sequence domain** — the single authoritative counter
the webview uses for stale-push fencing and the legacy button /
composer authority.

## 2. Where the shadow's stamp is generated (CORRECTION02)

The wiring's `getTurnSeq` accessor (added in CORRECTION02) is
sourced from `turnStateTracker.get().seq` at the moment the wiring
samples the legacy phase:

```ts
// apps/vscode/src/sdk/SdkController.ts:1098
getTurnSeq: () => this.turnStateTracker.get().seq,
```

The coordinator (`apps/vscode/src/sdk/task-state-shadow-coordinator.ts`)
samples `deps.getTurnSeq?.()` at the moment it accepts an
observation, and threads the value into
`applyToComparator(input, legacyPhase, now, turnSeq)`.

`applyToComparator` (line 519) calls
`deps.comparator.observeRuntimeEvent(event, legacyPhase, now, turnSeq)`
or `deps.comparator.observeTaskMsg(msg, legacyPhase, now, turnSeq)`.

`TaskShadowComparator.compareWith` (line 173) stores the value:

```ts
this.lastObservedTurnSeq = turnSeq
```

Both sides of the publication-selector staleness gate now read
from the SAME `TurnStateTracker`:

- publication `seq`:
  `apps/vscode/src/sdk/SdkController.ts:3993` →
  `this.turnStateTracker.get().seq`
- `canonicalShadowObservedTurnSeq`:
  `apps/vscode/src/sdk/SdkController.ts:4001` →
  `this.getLocalShadowTurnSeq()` →
  `taskStateShadowWiring.getLastObservedTurnSeq()` →
  `comparator.debugLastObservedTurnSeq()` → the value
  `compareWith` stamped at observation time

Both are TurnStateTracker-derived.

## 3. Same-domain proof (in the test)

`apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts`
drives the real production seam end-to-end:

1. `fx.tracker.set("idle")` advances the TurnState seq.
2. `fx.observeViaCanonicalShadow()` reads `tracker.get().seq`
   AT THAT INSTANT and passes it to
   `comparator.observeTaskMsg(msg, legacyPhase, now, turnSeq)`.
   The comparator stamps `lastObservedTurnSeq = turnSeq`.
3. `fx.tracker.set("streaming")` advances the TurnState seq.
4. The publication reads `tracker.get().seq` for `seq` and
   `comparator.debugLastObservedTurnSeq()` for
   `canonicalShadowObservedTurnSeq`. Both values are derived
   from the SAME `TurnStateTracker` instance.

The test then asserts:

```ts
expect(fx.comparator.debugLastObservedTurnSeq()).toBe(seqAtFirstSet) // same-domain equality
expect(publicationShadowStamp).toBeLessThan(publicationSeq)            // same-domain ordering
```

## 4. What CORRECTION01 got wrong (vs CORRECTION02)

| Aspect                | CORRECTION01 (REPAIR01)              | CORRECTION02 (this fix)              |
| --------------------- | ----------------------------------- | ----------------------------------- |
| Shadow stamp source   | `TaskShadowComparator.seq` (counter of observed events) | `TurnStateTracker.seq` (sampled at observation) |
| Domain                | Shadow-observation-event cardinality | TurnState lifecycle cardinality |
| `5 > 2` meaning       | unrelated (different event sources)  | causal (legacy advanced N times since shadow last saw) |
| RED proof             | manually injected numbers (encoded assumption) | real `TurnStateTracker` + real `TaskShadowComparator` (drives the seam) |

## 5. Ablation evidence

Disabling the staleness gate (`isShadowStale = false`) on either
the TaskHeader or Thinking selector makes 6 of 18 tests FAIL:

```
× THCP11_C02_RED                                  (LIVE contradiction)
× THCP11_C02_RED_INVERSE                          (mirror case)
× THCP11_C02_THINKING_RED                         (Thinking)
× T8                                              (cancel fence)
× T9                                              (THE LIVE CONTRADICTION)
× T10                                             (Thinking stale fallback)
```

This proves the gate is **necessary** — not redundant with the
selector's branch logic.
