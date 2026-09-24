ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01 — Bounded Correction 02

## Trigger

HALT_CPU_PROFILE_FINALIZATION_FALSE_GREEN raised after the initial
ACT closure identified four mechanical items in the production success
path that the test seam did not exercise and that violate the frozen
contract.

## Bounded correction items

### P0 — production max-duration finalizer did not Profiler.stop

The original `finalizeCapture()` called `cleanup()` (which disconnects
the Inspector session) immediately, then wrote `status: "finalized"`.
There was no `Profiler.stop` — so a production capture that hit the
MAX_DURATION backstop timer would lose the last active segment.

Fix: introduced `finalizeActiveCapture()` as the SINGLE finalization
authority. Both the MAX_DURATION timer callback AND the test seam
(`__driveFinalizerForTests`) call it. The function:

    1. Idempotency guard (existing `finalized` flag)
    2. If profiler is currently active (state === "active" || "rotating"):
       - Call Profiler.stop
       - Unwrap returned profile
       - Persist as the FINAL segment index
       - Update latest-complete.json
    3. THEN call cleanup() which disconnects the Inspector session
       (clear timers + disconnect).
    4. Write meta.status="finalized".
    5. Set state="finalized".

The test seam also no longer pre-calls `rotate()` — the finalizer
owns the final Profiler.stop, mirroring the production seam exactly.

Discriminator: `CPUCAP-FINAL-PRODUCTION-01`. 28/28 tests pass.

Fault injection proof: temporarily changed `if (wasActive)` →
`if (false && wasActive)`. Test suite reported `× CPUCAP-FINAL-PRODUCTION-01:
FAIL`. Reverted. 28/28 PASS again.

### P1 — failed segment destroyed the latest-complete pointer

Original code:

    latestSegmentIndex: writeOk ? segmentIndex : -1

If segment-000 persisted but segment-001's write failed, `latest_segment_index`
would regress to -1 in subsequent `latest-complete.json`, losing the
authoritative complete-checkpoint pointer.

Fix: introduced `lastSuccessfulSegmentIndex`, which advances ONLY when
`writeOk === true`. `latest-complete.json.latest_segment_index` now
reads from `lastSuccessfulSegmentIndex`. Added `failed_segment_count` to
the schema so the failed rotation count is preserved separately.

Discriminator: `CPUCAP-ROTATE-FAIL-01`. 28/28 tests pass.

### P1 — segment started_at was bogus

Original code:

    started_at: new Date(rotationStart - CPU_PROFILE_SEGMENT_MS).toISOString()

`rotationStart = performance.now()` returns a monotonic timestamp
relative to process origin, NOT Unix epoch milliseconds. Feeding it to
`new Date()` produces a date near 1970.

Fix: capture `activeSegmentStartedAt = new Date()` (real wall-clock)
at the moment each new segment begins. Three call sites:

    - After initial `await session.post("Profiler.start")`
    - In `rotate()`, after next-segment `Profiler.start`
    - In `rotate()` recovery branch, after re-start

The `started_at` for each persisted segment-meta now reads from
`segmentStartedAt.toISOString()` (a real wall-clock timestamp).

No new discriminator — this is a direct refactor verified by the
`CPUCAP-ROTATE-01..04` tests (segment meta files parsed for `started_at`
strings, all of which are real ISO-8601 timestamps now).

### P1 — double serialization

Original code:

    const profileBytes = Buffer.byteLength(JSON.stringify(profile ?? {}), "utf8")
    ...
    const serialized = JSON.stringify(profile)

Two serializations of the same profile.

Fix:

    const serialized = JSON.stringify(profile)
    const profileBytes = Buffer.byteLength(serialized, "utf8")

Single serialization. The complete profile is dumped once; sizing is
measured from that exact string.

No new discriminator — verified by reading the production code:
the `profileBytes` value is now sourced from the same `serialized`
string used for the write.

### P2 — wording fix on final timer

Original comment: "even if all timers are starved, the final timer fires"
This is incorrect: a JS EventLoop timer cannot fire while the loop is
starved (which is the very bug we are trying to diagnose).

New comment:

    Backstop timer. This is NOT a starvation-resistant timer: it is a
    JS EventLoop timer, so if the Extension Host event loop is starved
    (the very bug we are trying to diagnose) this timer will NOT fire.
    It is only an independent MAX_DURATION backstop against ordinary
    timer scheduling drift when the loop IS responsive.

No new discriminator — wording only.

## Post-correction gates

[X] CPUCAP focused tests
    Command: cd apps/vscode && bunx vitest run src/sdk/__tests__/extension-host-continuous-cpu-sampling01.cpucap01.test.ts
    Result: 28 / 28 PASS (added CPUCAP-FINAL-PRODUCTION-01 + CPUCAP-ROTATE-FAIL-01)

[X] REAL Inspector CPU smoke probe
    Command: bun scripts/inspector-cpu-smoke-probe.mjs
    Result: PASS
    See 04-inspector-smoke-output.txt

[X] ALLOCAUTH tests (conservation)
    Result: 25 / 25 PASS

[X] SLAC tests (conservation)
    Result: 16 / 16 PASS

[X] tsc --noEmit
    Result: clean (0 errors)

[X] biome check (changed files)
    Result: 0 errors, 8 infos (formatting applied)

[X] git diff --check
    Result: clean

[X] Fault injection
    Command: temporarily edit if (wasActive) -> if (false && wasActive)
    Result: CPUCAP-FINAL-PRODUCTION-01 FAILS as required (verified)
    Reverted afterwards.

## Closed

PASS_CPU_CAPTURE_INFRASTRUCTURE_READY_LIVE_CAPTURE_PENDING remains
the verdict. No live capture was performed during correction02
(correction02 is a code-only bounded review).
