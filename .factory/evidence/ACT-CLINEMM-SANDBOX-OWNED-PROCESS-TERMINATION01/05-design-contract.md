# ACT-CLINEMM-SANDBOX-OWNED-PROCESS-TERMINATION01 / 05-design-contract.md

## OWNED_PROCESS_TERMINATION_V1 (frozen)

A command execution owned by Cline MUST have:

1. Explicit host-side process ownership identity — the spawned child
   (and its descendants) is identifiable via `child.pid` on POSIX
   (process group leader) via `detached: !isWindows` on `spawn()`.
2. Cancellation independent of shell-trap cooperation — the supervisor
   sends signals to the PROCESS GROUP (`-pgid`), not to the shell PID.
3. Bounded graceful termination: SIGTERM to the owned execution tree.
4. Bounded escalation: if survivors remain after `TERM_GRACE_MS`,
   SIGKILL to the owned execution tree.
5. Completion only after owned processes are gone/reaped.
6. Zero signalling of unrelated processes — never use `killall`, `pkill`,
   `ps | grep`, or PID-scanning by command name.
7. Seatbelt confinement preserved — the child's Seatbelt profile
   (Cline's `(allow signal (target self))`) is unchanged.
8. Normal successful commands unchanged — no extra delay/grace on success.
9. No requirement for bash-specific behavior — the primitive operates on
   raw POSIX semantics (`kill(-pgid, signal)`).

INVARIANT:
  HOST_SPAWNED(P) AND CANCEL(P)
  ⇒ eventually NO_OWNED_DESCENDANT_ALIVE(P) within
       TERM_GRACE_MS + small scheduler bound.

## Frozen production seam geometry

```
spawn(executable, args, {
  detached: !isWindows,   // POSIX: child becomes NEW process group leader
  stdio: ["pipe","pipe","pipe"],
  windowsHide: true,
})
```

- POSIX: `child.pid == pgid` (because `detached: true` ⇒ new session/pgid)
- Windows: tracked via PID + `taskkill /T /F`

## Termination primitive (POSIX)

```ts
async terminateTree(opts: {
  gracefulSignal: NodeJS.Signals;
  graceMs: number;
}): Promise<{ treeTerminated: boolean; escalatedToKill: boolean }>
```

Steps:
1. `signalGroup(opts.gracefulSignal)` → `process.kill(-pgid, signal)`, ignore ESRCH.
2. `waitForGroupGone(pgid, opts.graceMs)` → poll `process.kill(-pgid, 0)` every 50ms.
   - `process.kill(-pgid, 0)` returns:
     - `0` ⇒ group exists (return false from probe)
     - `ESRCH` ⇒ group gone (return true from probe)
     - `EPERM` ⇒ group exists but we cannot signal it (return false; this is
        an invariant breach — surface via `treeEscapee=true`; do NOT claim success)
3. If grace expired: `signalGroup("SIGKILL")`, then `waitForGroupGone(pgid, opts.graceMs)`.
4. Resolve with `{ treeTerminated, escalatedToKill }`.

## Termination primitive (Windows)

```ts
child.kill(opts.gracefulSignal)         // shell gets TERM first
race: [child.exit, setTimeout(graceMs)]  // wait for shell exit
if (timed out): killProcessTree()       // taskkill /T /F on the shell PID
```

## Idempotency

`terminateInFlight` Promise latch: concurrent calls return the same
in-flight Promise, not a new one. First-writer-wins semantics at the
host level (`terminationPromise` on the CommandJob).

## Conservation invariants

- Foreign processes are NEVER signaled. The primitive operates on a
  process group received at spawn time.
- Concurrent executions: each invocation has its OWN detached child
  (= its OWN process group). Cancellation of group A never affects
  group B.
- Successful commands: no extra delay. `child.exit` resolves naturally;
  `treeTerminated` is observed but not enforced on success.
- Failed commands: exit code is preserved. Cancellation is distinct
  from command failure in result semantics.

## Substrate-availability gate

`HAS_SUBSTRATE` probe (factory pattern, mirrored from c3-real-kernel.test.ts):

```ts
const HAS_SIGNAL_SUBSTRATE = (() => {
  if (process.platform !== "darwin" && process.platform !== "linux") return false
  // Probe: spawn a child, kill it with SIGTERM, observe ESRCH on the PGID probe.
  // If the probe fails (EPERM, ESHUTDOWN, etc.), we cannot reliably observe
  // process-group state — substrate is unavailable for this test class.
  const child = spawn("/bin/sh", ["-c", "sleep 0.1"], { detached: true, stdio: "ignore" })
  const pid = child.pid!
  try {
    process.kill(-pid, "SIGTERM")
    return true   // probe succeeded
  } catch {
    return false
  } finally {
    try { process.kill(-pid, "SIGKILL") } catch {}
  }
})()
```

If `HAS_SIGNAL_SUBSTRATE` is false, the kill-on-child tests SKIP cleanly
(no false-failure). The architecture itself remains correct; the test
suite merely acknowledges that the in-host sandbox (Chromium zygote,
VSCodium --enable-sandbox) blocks signal delivery.

## Test matrix

| ID | Name | Substrate-gated |
|----|------|----------------|
| T1 | foreground child cancel | YES |
| T2 | shell builtin wait cancel | YES |
| T3 | TERM-ignoring child escalates to KILL | YES |
| T4 | grandchild tree dies | YES |
| T5 | foreign process conserved | YES |
| T6 | normal success unchanged | NO |
| T7 | ordinary failure unchanged | NO |
| T8 | timeout uses same termination primitive | YES |
| T9 | cancel-after-exit is safe no-op | NO |
| T10 | repeated cancel is idempotent | NO |

T6, T7, T9, T10 do not require signal delivery (they don't observe
process-group liveness), so they run unconditionally.
