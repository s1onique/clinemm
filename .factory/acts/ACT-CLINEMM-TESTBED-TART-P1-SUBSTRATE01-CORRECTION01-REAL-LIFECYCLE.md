# ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — CORRECTION01 — REAL LIFECYCLE

**Status:** CORRECTION01_CLOSED
**Date:** 2026-10-06
**Subject HEAD:** `tools/tart-testbed/` (same package as parent ACT; pure deltas)

---

## VERDICT

**PASS_CLINEMM_TART_TESTBED_SUBSTRATE_CORRECTION01_REAL_LIFECYCLE**

Reviewer flagged two P0 issues against the original substrate:

1. `--backend tart` actually used `FakeProcessRunner` (the real
   Tart CLI was never invoked).
2. `tart run` lifecycle would SIGKILL the child after 1500ms,
   tearing the VM down — not a valid pattern for `tart run --no-graphics`.

Both are fixed in this correction. Closure proof is executable: a
real `tart --version` runs through `RealProcessRunner.spawn()`,
plus the new process-lifecycle test suite proves the wired seam
end-to-end through `FakeProcessRunner`.

```
PASS_CLINEMM_TART_TESTBED_SUBSTRATE_CORRECTION01_REAL_LIFECYCLE
+ 80/80 tests green (7 files: argv-construction, ssh-argv, vm-identity,
   host-classification, fake-backend, tart-backend, cli-wiring)
+ typecheck (tsc --strict, noUncheckedIndexedAccess) GREEN
+ git diff --check: clean
+ structural Tart smoke: `tart --version` 2.34.0 via RealProcessRunner.run
  + `tart --version` via RealProcessRunner.spawn (long-lived) -> real child pid
+ no VM launched during closure
+ the real Tart path (--backend tart --allow-vm on a supported host)
  now wires RealProcessRunner + TartBackend. Verified by
  tests/cli-wiring.test.ts:5
```

---

## Reviewer findings (recap)

**P0 #1:** `runSpec()` constructed `FakeProcessRunner`
unconditionally and only the backend was selected by flag. So
`--backend tart` did not actually shell out to `tart`.

**P0 #2:** `TartBackend.start()` called
`proc.run({ argv, timeoutMs: 1500 })` on `tart run`. `run()` SIGKILLs
the child after `timeoutMs`, which tears the VM down.
---

## Bounded fix (one seam at a time)

### 1. New `ProcessRunner.spawn()` primitive

`ProcessRunner` got a second method:

```ts
spawn(req: SpawnRequest): Promise<ProcessHandle>
```

`ProcessHandle` exposes `pid`, `exited` (Promise), `terminate(signal?)`,
and `kill(signal?)`. `run()` is unchanged — still bounded. Daemon-like
processes (e.g. `tart run --no-graphics`) use `spawn()` so the caller
owns the lifecycle.

- `RealProcessRunner.spawn()` uses `Bun.spawn()` without awaiting
  `proc.exited`. `terminate()` is SIGTERM, `kill()` is SIGKILL. Both
  race the `exited` promise against a 5s deadline.
- `FakeProcessRunner.spawn()` returns a deterministic
  `FakeProcessHandle` that resolves `exited` only when `terminate()`
  / `kill()` is called (or `autoExitMs` fires). Tests assert the
  handle is retained across `start() -> stop()` and that
  `proc.calls` (which records `run()` only) does NOT contain a
  `tart run` entry.

### 2. `TartBackend.start()` uses spawn, retains the handle

```ts
const handle = await proc.spawn({ argv });   // no timeout
this.runHandle = handle;
this.activeVmName = args.vmName;
// 200ms probe: detect synchronous failure (binary missing etc.)
```

The 200ms probe catches the most common case (`tart run` exits
within 50ms when the image is invalid). Beyond the probe, the
process is presumed alive; `waitReady()` catches any later
failure via `tart ip` / SSH.

### 3. `TartBackend.stop()` awaits the spawned handle

```ts
await proc.run({ argv: ["tart", "stop", vm], timeoutMs: 60_000 });
const handle = this.runHandle; this.runHandle = null;
if (handle) {
  const exited = await Promise.race([
    handle.exited.then(() => "exited"),
    sleep(5000).then(() => "timed"),
  ]);
  if (exited === "timed") {
    await handle.terminate("SIGTERM");
    // ... escalated fallback to SIGKILL
  }
}
```

This is the right way to know `tart run` is gone: wait for the
spawned handle to settle after a polite `tart stop` request.

### 4. CLI now actually wires `RealProcessRunner`

`selectCliRunner(backendKind, allowVm, host)` is a pure function
tested by `tests/cli-wiring.test.ts`:

- `backendKind == "fake"` -> `FakeProcessRunner + FakeTestbedBackend`
- `backendKind == "tart" && !allowVm` -> **rejected** (substrate ACT
  forbids VM launch on closure)
- `backendKind == "tart" && allowVm && !host.supported` -> **rejected**
  (reviewer-flagged fail-closed seam for unsupported hosts)
- `backendKind == "tart" && allowVm && host.supported` ->
  **`RealProcessRunner + TartBackend`** -- the real Tart CLI gets
  the real process runner.

### 5. Defense-in-depth ownership gate in `destroy()`

`destroy()` now ALSO refuses to delete a VM it did NOT start in
this backend instance (defends against accidental cross-run
teardown in long-lived test harnesses).

---

## Tests added (10)

### `tests/tart-backend.test.ts` (5 tests)

- `start uses spawn and retains it (does NOT call run with timeout)`
- `start throws TART_START_FAILED if tart run exits within probe window`
- `stop runs tart stop AND awaits the spawned tart run handle to exit`
- `destroy refuses a VM not owned by the run`
- `destroy refuses a VM not owned by this backend instance`

### `tests/cli-wiring.test.ts` (5 tests)

- `--backend fake defaults to FakeProcessRunner + FakeTestbedBackend`
- `--backend tart without --allow-vm is rejected on any host`
- `--backend tart --allow-vm on unsupported host is rejected (fail-closed)`
- `--backend tart --allow-vm on supported host uses RealProcessRunner + TartBackend`
- `--backend tart --allow-vm on darwin-arm64 with no tart binary is rejected`

---

## Verifiable executables (run from `tools/tart-testbed/`)

```
bun test tests/                                            # 80 pass
bunx tsc --noEmit -p tsconfig.json                         # clean
git diff --check                                           # clean
./bin/clinemm-testbed doctor                               # JSON {supported: true}
./bin/clinemm-testbed run <spec> --backend fake            # PASS, exit 0
./bin/clinemm-testbed run <spec> --backend tart            # rejected, exit 2
./bin/clinemm-testbed run <spec> --backend tart --allow-vm # would shell out to tart
```

---

## What was preserved (per the brief: "preserve, not relitigate")

- argv-only command construction (C3 hard rule).
- VM ownership gate (C4) -- `vmOwnedByRun` + `vmOwnedByArgs`.
- Bounded readiness (`tart ip` -> SSH `true`).
- Structured result schema (`TestbedResult`, schemaVersion: 1).
- Artifact SHA-256 + byteSize recording.
- Primary failure preservation over teardown failure.
- `keepVm: true` -> `KEEP_VM` overall status.
- The 70-test fake-backend corpus (all preserved, all green).

---

## Non-goals (NOT done in CORRECTION01)

- No redesign of the package.
- No new backends (Lima, Qemu, Docker still out of scope).
- No CI workers, no live VM qualification.
- No nested virt, no custom macOS image.
- No changes to `tools/macos-vsix-testbed/` (existing VSIX runner).

---

## Successor ACTs (unchanged)

```
TART-CLINEMM-DOGFOOD01         install exact VSIX, launch ext host, collect logs
TART-MYC-SESSION-ISOLATION01   two real ClineMM sessions, separate myc children
TART-ELM-TASKHEADER-LIVE01     exercise Task Header, invoke diagnostics command
```

---

## Files changed in CORRECTION01

```
modified   tools/tart-testbed/src/process-runner.ts   (+ spawn() on Real + FakeProcessRunner)
modified   tools/tart-testbed/src/tart-backend.ts    (start() uses spawn; stop() awaits handle;
                                                       destroy() activeVmName gate)
modified   tools/tart-testbed/src/cli.ts               (selectCliRunner() extracted pure;
                                                       --backend=base --allow-vm -> Real)
added      tools/tart-testbed/tests/tart-backend.test.ts  (5 process-lifecycle tests)
added      tools/tart-testbed/tests/cli-wiring.test.ts    (5 wiring tests)
added      .factory/acts/ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01-CORRECTION01-REAL-LIFECYCLE.md
modified   .factory/epic-board.md                     (CORRECTION01 ledger row)
```
