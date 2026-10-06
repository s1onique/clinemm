# ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — CORRECTION02 — SIGNAL ESCALATION

**Status:** CORRECTION02_CLOSED
**Date:** 2026-10-06
**Subject HEAD:** `tools/tart-testbed/` (same package; pure deltas from CORRECTION01)

---

## VERDICT

**PASS_CLINEMM_TART_TESTBED_SUBSTRATE_CORRECTION02_SIGNAL_ESCALATION**

CORRECTION01 closed the two P0s (real Tart wiring + `spawn()` lifecycle).
This correction closes the one remaining P1 implementation-contract
defect: `kill()` after `terminate()` did not actually send the second
signal because of a global `terminateInFlight` memoization. The
`TartBackend.stop()` escalation path is now provably correct: SIGTERM
then SIGKILL both reach the child.

```
PASS_CLINEMM_TART_TESTBED_SUBSTRATE_CORRECTION02_SIGNAL_ESCALATION
+ 82/82 tests green (7 files; +2 new: signal-escalation seam tests)
+ typecheck (tsc --strict, noUncheckedIndexedAccess) GREEN
+ git diff --check: clean
+ real-tart smoke: RealProcessRunner.spawn(["tart","--version"]) ->
  real child pid, exits 0
+ real-tart smoke: terminate() + kill() resolve as independent
  promises on a real child (per-signal memoization verified)
+ P2 cleanup: removed stale "timedOut=true is expected" comment in
  tart-backend.ts; rewrote stale "ProcessRunner.run with timeoutMs"
  comment in tart-cli.ts
+ no VM launched during closure
```
---

## Reviewer finding (recap)

**P1 (bounded implementation contract):** `RealProcessRunner.spawn()`
memoized a single `terminateInFlight` promise:

```ts
if (terminateInFlight) return terminateInFlight;
...
proc.kill(signal)
```

and both `terminate(signal)` and `kill(signal)` shared it. So
the intended escalation in `TartBackend.stop()`:

```
wait 5s -> SIGTERM -> wait 3s -> SIGKILL
```

did **not actually send SIGKILL** after SIGTERM had been called.
`kill()` just returned the completed/in-flight SIGTERM promise.
A child that ignores SIGTERM (or any stuck process) would never
receive SIGKILL through the runner.

**P2 (residue):** Two stale comments described the old broken
lifecycle (`tart run` via `run()` with `timeoutMs`, "timedOut=true
is the expected outcome"). They were not load-bearing but were
incorrect after CORRECTION01.

---

## Bounded fix (one seam)

### 1. Per-signal memoization in `RealProcessRunner.spawn()`

```ts
const inflight = new Map<NodeJS.Signals, Promise<void>>();

const send = (signal: NodeJS.Signals): Promise<void> => {
  const existing = inflight.get(signal);
  if (existing !== undefined) return existing;
  const p = (async () => {
    try { proc.kill(signal); } catch { /* already dead */ }
    await Promise.race([
      exitedPromise.then(() => undefined),
      new Promise<void>((res) => setTimeout(res, 5000)),
    ]);
  })();
  inflight.set(signal, p);
  return p;
};
```

Each call to `terminate(signal)` or `kill(signal)` looks up the
in-flight promise for THAT signal. SIGTERM and SIGKILL are now
distinct entries; calling `terminate(SIGTERM)` then `kill(SIGKILL)`
sends BOTH signals.

### 2. `FakeProcessHandle` mirrors the new contract

- `signalLog: NodeJS.Signals[]` records every signal call (test introspection).
- `ignoreSignals?: readonly NodeJS.Signals[]` in `FakeSpawnScript`
  lets tests model a process that swallows SIGTERM but dies on
  SIGKILL (the worst-case containment scenario).
- `kill()` is a separate operation from `terminate()` (no more
  `kill -> terminate` aliasing).

### 3. `RealProcessRunner.spawn` streams -> "ignore"

`stdout: "ignore"`, `stderr: "ignore"`. The `pipe` setting caused
`proc.exited` to hang if the caller did not drain the streams.
Daemon-like processes (`tart run`) stream a lot and we don't
need to capture it.

### 4. P2 cleanup

- `tart-backend.ts`: removed "timedOut=true is the expected
  outcome"; replaced with the CORRECTION01-correct description
  (`spawn()`, retained handle, never SIGKILLed).
- `tart-cli.ts`: removed the "orchestrator spawns it via
  ProcessRunner.run with timeoutMs = startMs" comment; replaced
  with the CORRECTION01-correct "MUST be `spawn()`, never `run()`".

---

## Tests added (2)

In `tests/tart-backend.test.ts` (new `describe` block):

- `SIGTERM is sent and ignored -> SIGKILL is actually sent -> handle exits on SIGKILL`
  - Spawns a fake `tart run` with `ignoreSignals: ["SIGTERM"]`.
  - Sends SIGTERM, asserts handle is still alive and `signalLog = ["SIGTERM"]`.
  - Sends SIGKILL, asserts handle exits and `signalLog = ["SIGTERM", "SIGKILL"]`.
  - This is the test the reviewer explicitly requested.
- `terminate and kill with the same signal dedupe; different signals do NOT`
  - Asserts the per-signal memoization dedupes same-signal calls
    but NOT different-signal calls (e.g. SIGTERM+SIGTERM dedupes,
    SIGTERM+SIGKILL does not).

---

## Verifiable executables (run from `tools/tart-testbed/`)

```
bun test tests/                                            # 82 pass
bunx tsc --noEmit -p tsconfig.json                         # clean
git diff --check                                           # clean
./bin/clinemm-testbed doctor                               # supported: true
./bin/clinemm-testbed run <spec> --backend fake            # PASS
./bin/clinemm-testbed run <spec> --backend tart            # rejected
```

Real-tart smoke (no VM):

```bash
bun -e 'import {RealProcessRunner} from "./src/process-runner.ts";
        const r = new RealProcessRunner();
        const h = await r.spawn({argv:["tart","--version"]});
        const e = await h.exited;
        console.log("pid", h.pid, "exit", e.exitCode);'    # pid <N> exit 0

bun -e 'import {RealProcessRunner} from "./src/process-runner.ts";
        const r = new RealProcessRunner();
        const h = await r.spawn({argv:["/bin/sh","-c","echo hi; exit 0"]});
        const p1 = h.terminate("SIGTERM");
        const p2 = h.kill("SIGKILL");
        await Promise.all([p1, p2]);
        console.log("per-signal memoization ok");'         # per-signal memoization ok
```

---

## What was preserved

- The CORRECTION01 80-test corpus: all still green.
- argv-only construction, VM ownership gate, structured result
  schema, artifact SHA-256, primary-failure preservation, `keepVm`.

---

## Non-goals (NOT done in CORRECTION02)

- No redesign of the package.
- No new backends.
- No CI workers, no live VM qualification, no nested virt.
- No changes to `tools/macos-vsix-testbed/`.

---

## Successor ACTs (unchanged, READY)

```
TART-CLINEMM-DOGFOOD01         install exact VSIX, launch ext host, collect logs
TART-MYC-SESSION-ISOLATION01   two real ClineMM sessions, separate myc children
TART-ELM-TASKHEADER-LIVE01     exercise Task Header, invoke diagnostics command
```

---

## Files changed in CORRECTION02

```
modified   tools/tart-testbed/src/process-runner.ts   (per-signal memoization;
                                                       FakeProcessHandle rewrite;
                                                       spawn streams -> ignore)
modified   tools/tart-testbed/src/tart-backend.ts     (P2: doc rewrite)
modified   tools/tart-testbed/src/tart-cli.ts          (P2: doc rewrite)
modified   tools/tart-testbed/tests/tart-backend.test.ts  (+2 signal-escalation tests)
added      .factory/acts/ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01-CORRECTION02-SIGNAL-ESCALATION.md
modified   .factory/epic-board.md                       (CORRECTION02 ledger row)
```
