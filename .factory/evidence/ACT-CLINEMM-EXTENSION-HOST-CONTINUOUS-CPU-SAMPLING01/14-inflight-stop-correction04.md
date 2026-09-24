# 14 — inflight-stop-correction04

## HALT addressed

`HALT_CPU_PROFILE_STOP_INFLIGHT_FINALIZER_RACE` (raised by the
Factory reviewer / ClineMM maintainer in the Leamas digest for
iteration 03).

## Reviewer's claim

> `profilerRunning` stays true for the entire period while
> `Profiler.stop` is in flight. `await session.post("Profiler.stop")`
> is an async boundary. The MAX_DURATION timer can fire during that
> window and the finalizer sees `profilerRunning === true` and
> posts a duplicate Profiler.stop.

The reviewer's diagnosis is correct. `correction03` is real but
incomplete: it gates on `profilerRunning` which is set false ONLY
AFTER the await resolves. Between the post and the resolve, a
concurrent finalizer can pass the gate.

The reviewer is also correct that `CPUCAP-FINAL-RACE-01` does NOT
prove the corrected invariant because the test awaits the rotation
to completion before driving the finalizer — by then, the rotation
has already cleared `profilerRunning`.

## Fix (bounded correction04, no architecture change)

Four production-line changes in
`apps/vscode/src/sdk/extension-host-cpu-profiler.ts`:

### 1. Explicit in-flight stop authority

Introduced `stopInFlight` boolean alongside `profilerRunning`.
Set true synchronously BEFORE every `await session.post("Profiler.stop")`
and false synchronously AFTER its settlement (both in `rotate()`
and in `finalizeActiveCapture()`). The invariant is now:

> at most one `Profiler.stop` may be outstanding at any moment.

`profilerRunning` is kept as a complementary signal (sampling
authority) but the in-flight gate is the load-bearing one.

### 2. Concurrent finalizer awaits the in-flight Promise

Introduced `inFlightStopPromise: Promise<unknown>` which captures
the in-flight stop. When `finalizeActiveCapture()` detects
`stopInFlight === true`, it does NOT post its own Profiler.stop.
Instead, it awaits `inFlightStopPromise` to observe the same
result. Both callers see the same stop outcome.

### 3. Rotation completion deferred

Introduced `rotationSettled: Promise<void>` which the rotation
resolves ONLY when its full body has settled (persist, counter
updates, post-rotation Profiler.start check). The deferred path
of the finalizer awaits both `inFlightStopPromise` and
`rotationSettled` before proceeding to cleanup() and meta
write, guaranteeing the finalizer's meta write observes the
rotation's counter updates.

### 4. Disconnected-session guard for post-rotation Profiler.start

Introduced `disconnected` boolean set inside `cleanup()`. The
rotation's post-rotation Profiler.start is guarded by
`if (disconnected) return false`. This prevents the rotation
from crashing when its stop Promise resolves AFTER the
finalizer has called cleanup() and disconnected the session.

## New discriminator

### `CPUCAP-FINAL-INFLIGHT-STOP-01`

Extends the fake session with a `_stopGate` / `_resolveStopGateWith`
mechanism: the first Profiler.stop returns a Promise that does not
resolve until the test calls `session._resolveStopGateWith(profile)`.

Steps:

1. Trigger capture; wait for state="active".
2. Drive rotation WITHOUT awaiting — the gated Profiler.stop is
   issued but does not resolve.
3. Yield microtasks; assert `_stopGateCalls === 1` and exactly
   one `Profiler.stop` in `_posts`.
4. Drive the finalizer while the gate is still parked.
5. Yield microtasks; assert still exactly ONE Profiler.stop
   outstanding (the finalizer saw `stopInFlight === true` and
   bailed on issuing its own).
6. Resolve the gate with a real profile so the rotation's
   persist path completes.
7. Await rotation + finalizer to settle.
8. Assert: total Profiler.stop count is 1, state=finalized,
   segment-000 written once, segment-001 NOT written, disconnect
   count = 1, meta.status="finalized",
   successfulSegmentCount=1, failedSegmentCount=0.

## Fault injection verification

Replaced the corrected gate
`if (profilerRunning && !concurrentStopInFlight)` with
`if (true)` (i.e. ignore the in-flight gate and always issue a
final Profiler.stop). This emulates the correction03 logic.

Result: CPUCAP-FINAL-INFLIGHT-STOP-01 FAILS with
`AssertionError: expected 2 to be 1` on
`expect(stopsAfterFinalizerEntered).toBe(1)`. The finalizer
posted a duplicate Profiler.stop — exactly the race the
reviewer described.

Reverted to `if (profilerRunning && !concurrentStopInFlight)`.
All 31/31 CPUCAP tests PASS again.

## Final gates (all PASS after correction04)

- CPUCAP focused: **31/31 PASS** (30 from correction03 + 1 new
  CPUCAP-FINAL-INFLIGHT-STOP-01)
- ALLOCAUTH01 conservation: **25/25 PASS**
- SLAC01 conservation: **16/16 PASS**
- TQCB + BTCONT + CCARD conservation: **37/37 PASS**
- **TOTAL: 109/109 PASS** across the 6 test files
- `bunx tsc --noEmit` (apps/vscode): **0 errors**
- `bunx biome check`: **0 errors, 8 infos** (style-only, unchanged)
- `git diff --check`: **clean**

## P2 wording fix folded in (per digest)

`result.json` iteration03 entry's `result` field is now consistent
with the top-level `verdict` /
`live_capture_authorized: true`. Both say "AUTHORIZED". The
classification string changed from
`PASS_CPU_CAPTURE_INFRASTRUCTURE_READY_LIVE_CAPTURE_PENDING` to
`PASS_CPU_CAPTURE_INFRASTRUCTURE_READY_LIVE_CAPTURE_AUTHORIZED`
in both the iteration history and the top-level field.
