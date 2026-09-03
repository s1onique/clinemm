# 01-production-spawn-callgraph.md

## Production seam

```
run_commands tool (apps/vscode/src/core/...)
  → CommandJobManager.start(...)        apps/vscode/src/sdk/command-job-manager.ts
    → sandboxBackend.prepare(...)       @cline/core runtime/sandbox/macos/seatbelt-backend.ts
       → /usr/bin/sandbox-exec -f profile.sb /bin/sh -c <command>     (REAL macOS Seatbelt)
    → spawnSupervisableShellCommand(...) @cline/core extensions/tools/executors/bash.ts:1550
       → buildShellProcess(...)          bash.ts:871
          → spawn(executable, args, { detached: !isWindows, ... })   bash.ts:917
             → child.pid = leader of NEW process group (POSIX: detached)
          → return SupervisableShellProcess {
              exit: child 'close' promise,
              pid:  childPid,
              killTree: SIGKILL to -pgid (no grace)            bash.ts:1135
              terminateTree({gracefulSignal, graceMs}):        bash.ts:1054
                send SIGTERM to -pgid
                poll process.kill(-pgid, 0) every 50ms
                if grace expires: send SIGKILL to -pgid
                resolve {treeTerminated, escalatedToKill}
            }
  → CommandJobManager.runTerminationSequence(job)  command-job-manager.ts:1140
    → job.process.terminateTree({ gracefulSignal: "SIGTERM", graceMs: TERM_GRACE_MS })
                                                              command-job-manager.ts:1154
    → await job.process.exit                                   command-job-manager.ts:1164
  → finalize()
```

## Authority chain

| Layer | Function | Authority |
|-------|----------|-----------|
| B1 tool executor | `executeCommandTool` (tool framework) | receives host request |
| B2 command runner | `CommandJobManager.start` | owns CommandJob, deadline, signal-abort |
| B3 sandbox wrapper | `SeatbeltSandboxBackendExperimental.prepare` | composes Seatbelt profile, returns prepared invocation |
| B4 OS spawn | `spawn(executable, args, { detached: !isWindows })` | creates NEW process group (POSIX) when detached |
| B5 process identity | `child.pid` returned (= PGID via `detached: true`) | this is the ownership handle |
| B6 cancel registration | `context.signal.addEventListener('abort', abortHandler)` | external abort surface |
| B7 termination | `job.process.terminateTree({gracefulSignal, graceMs})` | TERM→grace→KILL on -pgid |
| B8 wait/reap | `await job.process.exit` + PGID existence probe | dual completion gate |
| B9 result publication | `finalize()` transitions job.state to `cancelled`/`deadline` | canonical state |

## Key invariants present in current code

- `TERM_GRACE_MS = 5_000` (command-job-manager.ts:293)
- `spawn(...)` uses `detached: !isWindows` → leader of new process group (POSIX)
- `killProcessTree()` on POSIX: `process.kill(-childPid, "SIGKILL")` with fallback `child.kill("SIGKILL")` (bash.ts:944-988)
- `terminateTree()`: TERM to -pgid → poll ESRCH on -pgid every 50ms → if grace expires, SIGKILL to -pgid → re-poll → resolve `{treeTerminated, escalatedToKill}` (bash.ts:1054-1105)
- `runTerminationSequence`: idempotent terminationPromise (first-writer-wins), TERM_GRACE_MS=5_000, awaits both terminateTree AND child.exit before surfacing state (command-job-manager.ts:1140-1178)
- `treeEscapee` flag set if PGID remains alive after escalation (diagnostic) (command-job-manager.ts:1177)

## Existing RED tests in repo (already authored)

`sdk/packages/core/src/extensions/tools/executors/bash.supervised.test.ts`:
- "kills a SIGTERM-IGNORING descendant in the owned PG (CORRECTION03 P0)" (line 128-177)
- "gracefully terminates a cooperative tree (no SIGKILL needed)" (line 104-126)
- "is idempotent (concurrent terminateTree shares a single flow)" (line 179-191)

These tests fail in the VSCodium-sandboxed authoring shell because macOS Seatbelt
(Chromium Helper `--enable-sandbox` policy inherited through the process tree)
blocks signal delivery — `kill(pid, SIGTERM)` returns EPERM even for direct children.
The CORRECTION03 P0 fix itself is correct; tests are substrate-gated.

## Seatbelt profile signal policy

`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:10`:
`(allow signal (target self))`

This is the MINIMAL Seatbelt signal grant — it allows sandboxed processes to
signal themselves (e.g. for setpgid/setrlimit self-management) but does NOT
add a process-group-signal grant. The current production termination primitive
operates on `-pgid` from the HOST Node process (NOT inside the Seatbelt sandbox
of the spawned child). The child's Seatbelt profile does NOT block incoming
signals from outside (Seatbelt enforces outbound syscalls from sandboxed
processes, not inbound signals from the kernel/process tree).

In practice the sandboxed child RECEIVES SIGTERM/SIGKILL from its parent PGID
leader (which is outside any Cline Seatbelt profile — it's the bare Node parent
running with the VSCodium Helper sandbox that the ACT must not conflate with the
Cline Seatbelt policy). Signal delivery to the sandboxed child works at the
macOS kernel level regardless of the child's Seatbelt profile.
