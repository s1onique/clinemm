§20 Ablation — captured 2026-10-01T11:41Z.

## Structural ablation proof

The shadow observer is attached inside
`captureContinuationCardinalityAuthorityRecord` via a single
branch:

```ts
const shadowWants = !captureEnabled ? isElmShadowObserverActive() : true
if (!captureEnabled && !shadowWants) return
// ... construct record ...
if (captureEnabled) {
  buffer.push(rec); counter.count++; ...
}
try {
  observeElmShadowFireAndForget(rec)
} catch { /* never propagate */ }
```

To ablate the observer, set the shadow gate to disabled:

```ts
_shadow.setElmShadowEnabled(false, null)
```

Now `isElmShadowObserverActive()` returns false. The forward call
becomes a no-op. The CCARD ring and counters are unchanged.

## Equivalence of disabled-shadow to pre-SHADOW02 behavior

The RED stage (§16) proved: when the shadow module does not exist
(no `import * as shadow from "../completion-authority-elm-shadow"`
succeeds), `resolveShadowGate()` returns null and
`isElmShadowObserverActive()` returns false. The CCARD module
behaves identically to the predecessor.

The GREEN stage proves: with the shadow module present and
enabled, the same factual CCARD record also drives the shadow.

The two together prove: shadow wiring is necessary for shadow
observations and unnecessary for CCARD behavior.

## Test-observable ablation

The test file `completion-authority-elm-shadow02.test.ts` includes
ELS02-01.B which proves the disabled-shadow no-op. ELS02-01.C
proves the disabled-shadow + CCARD-on behavior is unchanged.
Together these are the structural ablation proof.

For ELS02-02/03/06/07 (the four "shadow wiring is necessary" REDs),
the SHADOW02 implementation depends on the shadow being enabled. If
the shadow is disabled (no `setElmShadowEnabled(true, ...)` call),
those tests fail because the ring stays empty.

## Verification (assertion-level)

Ablation-01: shadow disabled → ring stays empty even with CCARD on.
  - Test: ELS02-01.B (PASS).
  - Mechanism: `isElmShadowObserverActive()` returns false;
    `observeElmShadowFireAndForget` is a no-op (returns early on
    `!enabled`).

Ablation-02: shadow disabled + CCARD on → CCARD ring still works.
  - Test: ELS02-01.C (PASS).
  - Mechanism: the CCARD `if (captureEnabled) { buffer.push; ... }`
    block is unaffected by the shadow gate. Existing CCARD
    semantics are unchanged.

Ablation-03: shadow enabled → all 14 ELS02 tests pass.
  - Tests: 14/14 PASS in §17 GREEN.

This proves both directions:
  - shadow wiring is necessary for shadow observations (Ablation-01
    inverted: if shadow were necessary for CCARD, ELS02-01.C would
    fail; it does not)
  - shadow wiring is unnecessary for production behavior
    (Ablation-02: CCARD ring still works without shadow).
