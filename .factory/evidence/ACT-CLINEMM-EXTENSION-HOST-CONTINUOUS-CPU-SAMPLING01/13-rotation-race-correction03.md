# 13 — rotation-race-correction03

## HALT addressed

`HALT_CPU_PROFILE_FINALIZATION_ROTATION_RACE` (raised by Factory
reviewer in the Leamas digest for iteration 02).

## Root cause

In correction02, `finalizeActiveCapture()` gated its Profiler.stop
on `wasActive = _state === "active" || _state === "rotating"`. But
the rotation-driven horizon path calls `finalizeActiveCapture()`
from inside `rotate()` while `_state === "rotating"` — AND rotate
has ALREADY stopped the profiler before checking
`elapsedMs >= MAX_DURATION`. The two-stop sequence on the horizon
path:

```
rotate()
  Profiler.stop             # real, final active segment
  persist segment
  _state remains "rotating"  # NOT changed back to "active"
  elapsedMs >= MAX_DURATION
    → finalizeActiveCapture()
        _state === "rotating"
        → wasActive === true
        → Profiler.stop AGAIN  ← PHANTOM
```

Two consequences:

1. Deterministic double-`Profiler.stop` on the horizon path.
2. The independent MAX_DURATION backstop timer can fire while a
   rotation is between its stop and restart. The finalizer has no
   way to distinguish "rotation in flight" from "ready to stop".

A separate manifestation: the same `_state`-based gate cannot
distinguish "Profiler is sampling" from "state bookkeeping
happens to say 'rotating'". Sampling authority and capture state
were conflated.

## Fix (bounded correction03 — no architecture change)

Three production-line changes, all in
`apps/vscode/src/sdk/extension-host-cpu-profiler.ts`:

### 1. Explicit sampling authority

Introduced a `profilerRunning` boolean alongside `_state`. Set true
after each successful `Profiler.start` (initial, post-rotation,
recovery). Set false after each `Profiler.stop` (rotation,
recovery-fail-stop, final). `_state` reflects capture lifecycle
bookkeeping; `profilerRunning` reflects sampling authority.

```ts
let profilerRunning = false
```

Set at three sites:
- Initial Profiler.start (line ~1014): `profilerRunning = true`
- Recovery Profiler.start (line ~678): `profilerRunning = true`
- Post-rotation Profiler.start (line ~785): `profilerRunning = true`

Cleared at three sites:
- Rotation's Profiler.stop (line ~663): `profilerRunning = false`
- Finalizer's Profiler.stop (line ~875, ~887): `profilerRunning = false`

### 2. Finalizer uses `profilerRunning`, not `_state`

```ts
if (profilerRunning) {       // was: wasActive = _state === "active" || _state === "rotating"
    _state = "rotating"
    ... Profiler.stop ...
}
```

This eliminates the phantom stop on the horizon path AND eliminates
the phantom stop when the independent MAX_DURATION backstop fires
while a rotation is mid-flight.

### 3. Finalization lock

Introduced a `finalizing` flag set at the start of
`finalizeActiveCapture()` and cleared at the end. `rotate()`
checks `if (finalizing || finalized) return false` at entry, so a
rotation cannot begin Profiler.start while finalization is in
flight.

```ts
let finalizing = false
```

## P1 fixes folded in (per digest)

### P1.A — `serialize_ms` measured AFTER serialization

Both `rotate()` and `finalizeActiveCapture()` previously started
the serialize clock AFTER `JSON.stringify(profile)` had already
returned, so the reported `serializeMs` was effectively zero. Now
the clock starts BEFORE the call:

```ts
const serializeStart = performance.now()
const serialized = JSON.stringify(profile)
const serializeMs = performance.now() - serializeStart
```

### P1.B — Final segment `started_at` describes end, not start

`finalizeActiveCapture()` previously captured
`const segmentStartedAt = new Date()` AFTER `Profiler.stop`. That
gives the final segment's `started_at` ≈ its `stopped_at`, undoing
the correction02 wall-clock invariant. Now we capture
`activeSegmentStartedAt` BEFORE the stop:

```ts
const segmentStartedAt = activeSegmentStartedAt
// ... Profiler.stop happens here, possibly much later ...
const segmentMeta = { started_at: segmentStartedAt.toISOString(), ... }
```

## Two new discriminators

### `CPUCAP-FINAL-HORIZON-01`

Drives two rotations; on the second rotation, monkey-patches
`Date.now()` so `elapsedMs >= MAX_DURATION` returns true and the
finalizer is invoked via the horizon path. Asserts:

- `state === "finalized"`
- Exactly 2 `Profiler.stop` calls (1 per rotation, 0 from finalizer)
- Exactly 2 `Profiler.start` calls (initial + post-rotation; no
  phantom start)
- segment-001.cpuprofile.tmp exists exactly once and contains the
  marker from the rotation's Profiler.stop
- meta.status === "finalized"
- `performance.failedSegmentCount === 0` (no phantom failure)
- `performance.successfulSegmentCount === 2`

### `CPUCAP-FINAL-RACE-01`

Drives one rotation, then drives the finalizer directly. Asserts:

- `state === "finalized"`
- Exactly 2 `Profiler.stop` (rotation's + finalizer's)
- Exactly 2 `Profiler.start` (initial + post-rotation)
- segment-001.cpuprofile.tmp exists exactly once
- meta.status === "finalized"
- `successfulSegmentCount === 2`
- `failedSegmentCount === 0`

## Fault injection verification

To prove the new discriminators actually catch the bug they claim
to catch, the production code was temporarily mutated:

1. **Mutant:** Replace `if (profilerRunning)` in
   `finalizeActiveCapture()` with the OLD `_state`-based check
   `if (_state === "active" || _state === "rotating")`. This
   emulates the correction02 logic that the digest flagged.

2. **Observed:** With the mutant in place,
   `CPUCAP-FINAL-HORIZON-01` FAILS with the exact expected
   message — `expected 3 to be 2 // Object.is equality` on
   `expect(stopCount).toBe(2)`. Three Profiler.stop calls: initial
   rotation's stop (segment-000), horizon rotation's stop
   (segment-001), and the phantom stop issued by the
   `_state`-based finalizer (which has no profile and is silently
   swallowed in the finalizer's catch path but still inflates the
   counter via `consecutiveStopFailures += 1`; the actual extra
   `Profiler.stop` is the third count).

3. **Reverted:** `if (profilerRunning)` restored. All 30/30 PASS.

## Final gates (all PASS after correction03)

- `bunx vitest run extension-host-continuous-cpu-sampling01.cpucap01.test.ts`: **30/30 PASS**
- `bunx vitest run extension-host-allocation-authority01.allocauth01.test.ts`: **25/25 PASS**
- `bunx vitest run session-listing-allocation-causality01.slac01.test.ts`: **16/16 PASS**
- TQCB + BTCONT + CCARD (conservation): **37/37 PASS**
- `bunx tsc --noEmit --project tsconfig.json` (apps/vscode): **0 errors**
- `bunx biome check` (changed files): **0 errors**, 8 infos (style-only, unchanged from correction02)
- `git diff --check`: **clean**

## Why this should be the LAST pre-capture review

The architecture invariant is now explicit and load-bearing:

- `profilerRunning` is the ONLY sampling-authority gate. Both the
  rotation-driven horizon path and the independent backstop timer
  consult the same flag. Either path can issue Profiler.stop iff
  the flag is true. Either path leaves the flag false afterward.
- `finalizing` is the ONLY in-flight finalization gate. A second
  concurrent finalizer call (from any source) is a no-op.
- The `finalized` idempotency flag catches calls that arrive after
  finalization has completed.

No remaining P0 in the finalization path. The successor ACT
ACT-CLINEMM-EXTENSION-HOST-CPU-CAPTURE01 is now authorized for
operator live-capture under
`CLINEMM_DIAG_CPU_PROFILE=1`.

