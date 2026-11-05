# NEPCR01 — Source Seam Map (current HEAD)

Source HEAD at recon time: `b344741921bfe92a804bf3738f799aed123f7cac`
(branch `main`). All line anchors below are from that HEAD.

Primary source:
- `apps/vscode/src/sdk/command-job-manager.ts`
- `sdk/packages/core/src/extensions/tools/executors/bash.ts` (the production
  supervisor, re-exported by `@cline/core`)

---

## 1. Named boundaries

| Boundary | Location |
|---|---|
| `CommandJobManager.start()` | `apps/vscode/src/sdk/command-job-manager.ts:1555` |
| `CommandJobManager.terminate()` | `apps/vscode/src/sdk/command-job-manager.ts:2265` |
| `CommandJobManager.runTerminationSequence()` | `apps/vscode/src/sdk/command-job-manager.ts:2313` |
| `CommandJobManager.finalize()` | `apps/vscode/src/sdk/command-job-manager.ts:2501` |
| `childProcess.exit` transition | `apps/vscode/src/sdk/command-job-manager.ts:2054` |
| `defaultTerminalPostconditionProbe()` | `apps/vscode/src/sdk/command-job-manager.ts:3612` |
| `spawnSupervisableShellCommand()` | `sdk/packages/core/src/extensions/tools/executors/bash.ts:1738` |
| `SupervisableShellProcess` (interface) | `sdk/packages/core/src/extensions/tools/executors/bash.ts:869` |
| `terminateTree()` | `sdk/packages/core/src/extensions/tools/executors/bash.ts:1151` |
| `waitForGroupGone()` | `sdk/packages/core/src/extensions/tools/executors/bash.ts:1138` |
| `probePgidExists()` | `sdk/packages/core/src/extensions/tools/executors/bash.ts:1099` |
| supervisor `exit` promise creation | `sdk/packages/core/src/extensions/tools/executors/bash.ts:1026` |
| supervisor `exit` promise resolution | `sdk/packages/core/src/extensions/tools/executors/bash.ts:1219` (`child.on("close", …)`) |
| detached spawn (`detached: !isWindows`) | `sdk/packages/core/src/extensions/tools/executors/bash.ts:1011` |
| `pgid: isWindows ? undefined : childPid` | `sdk/packages/core/src/extensions/tools/executors/bash.ts:1242` |

## 2. Existing injection seams (present at HEAD, unchanged by this ACT)

| Seam | Manager field | Production default |
|---|---|---|
| `spawnFactory` | `command-job-manager.ts:1282` (ctor assignment `:1345`) | `spawnSupervisableShellCommand` |
| `terminalPostconditionProbe` | `command-job-manager.ts:1323` (ctor assignment `:1348`) | `defaultTerminalPostconditionProbe` |

**This ACT injects NEITHER.** Both defaults are exercised.

---

## 3. Path A — natural exit

```
CommandJobManager.start()                                  :1555
  └─ getShellInvocation(shell, command)                    :1570
  └─ this.spawnFactory({ executable, args, cwd, env, input }) :1813
       └─ spawnSupervisableShellCommand()                   bash.ts:1738
            ├─ spawn(executable, args, { detached: !isWindows, stdio: [pipe,pipe,pipe] })  bash.ts:1007-1013
            ├─ pgid = childPid (shell IS the PG leader)      bash.ts:1242
            ├─ exitPromise = new Promise(...)                bash.ts:1026
            └─ child.on("close", (code, signal) => exitResolve(...))   bash.ts:1219
                 ▲ RESOLVES ON "close" = root exit AND stdio drained
  └─ const exitTransition = childProcess.exit.then(...)     :2054
       └─ this.finalize(job, "exited", {exitCode, signal})  :2063
            └─ finalize()                                   :2501
                 └─ defaultTerminalPostconditionProbe(pgid)  :3612
                      process.kill(-pgid, 0)
                      rc=0   -> "alive"
                      EPERM  -> "eperm"
                      ESRCH  -> "gone"
                      other  -> "unknown"
                 └─ postcondition === "gone"
                      -> command_job_terminal_committed
                      -> job.state = "exited"
                    postcondition !== "gone"
                      -> command_job_residual_detected
                      -> job.terminationFailed = substrate_alive|eperm|unknown
                      -> job.state = "containment_failed"
                      -> NO command_job_terminal_committed
                 └─ this.active.delete(job.id)               :2736
                 └─ command_job_containment_failed           (post-delete gauge event)
```

**No group-level termination is performed on the natural-exit path.**
`terminateTree()` is never called from `finalize()`.

## 4. Path B — explicit termination (cancel / deadline)

```
CommandJobManager.cancel()                                 :3034
  └─ this.terminate(job, "cancel")                         :2265
       └─ job.terminationPromise = this.runTerminationSequence(job)  :2309
            └─ runTerminationSequence()                     :2313
                 └─ await job.process.terminateTree({gracefulSignal, graceMs})  (bash.ts:1151)
                      ├─ POSIX: signalGroup(SIGTERM) on -pgid
                      ├─ waitForGroupGone(pgid, graceMs)     bash.ts:1138
                      ├─ escalate: signalGroup(SIGKILL) on -pgid
                      └─ waitForGroupGone(pgid, graceMs)
                 └─ (EPERM only) helperOwnedPgidProvider.terminateOwned(...)
                 └─ await job.process.exit                  :2484
                      └─ exitTransition -> finalize(job, "cancelled"|"deadline_exceeded")  :2063
                           └─ defaultTerminalPostconditionProbe(pgid)
```

`terminateTree()` waits for the OWNED PROCESS GROUP to be gone before
`finalize()` probes it, so the explicit-termination path normally
observes `gone`.

---

## 5. Supervisor exit semantics — MEASURED, not assumed

`SupervisableShellProcess.exit` resolves on the child's **`close`** event
(`bash.ts:1219`). Node's `close` fires when the process has exited AND
all its stdio streams have been drained. Measured on this host:

| Workload | root `exit` event | supervisor `exit` promise | group at resolution |
|---|---|---|---|
| `( sleep 3 & echo DESC=$! ; exit 0 )` (descendant INHERITS stdout) | T+4ms | **T+3012ms** | gone (ESRCH) |
| `( sleep 3 </dev/null >/dev/null 2>&1 & echo DESC=$! ; exit 0 )` (descendant REDIRECTS stdio) | T+4ms | **T+12ms** | alive (EPERM) |

Therefore the supervisor's exit promise is:

- **NOT** a root-process-exit boundary,
- **NOT** a whole-process-group boundary,
- it IS a **stdio-closure** boundary, which is *incidentally* a
  whole-group boundary only when the surviving descendant happens to
  hold the inherited stdout pipe open.

This is the mechanism that makes a natural exit observable as
`containment_failed`: when the descendant does not hold the pipe, the
`close` event fires immediately and `finalize()` probes a still-live
group.

## 6. Boundaries that are safely observable vs. not

| Boundary | Observable? | How |
|---|---|---|
| Root process exit | YES | independent `ps` membership poll (leader pid disappears) |
| Supervisor `exit` promise resolution | YES | `childProcess.exit` resolution timestamp |
| Stdio closure | YES | implied by the above (same `close` event) |
| Immediate group existence | YES (read-only) | `process.kill(-pgid, 0)` errno: rc=0 → alive, EPERM → alive, ESRCH → gone |
| Later group disappearance | YES (read-only) | same probe, polled over a bounded window |
| Process-group MEMBERSHIP | YES (read-only) | `/bin/bash -c 'ps -axo pid=,ppid=,pgid=,stat=,lstart=,command='` |
| Signal delivery to another process/group | **NO on this host** | Seatbelt profile allows only `(allow signal (target self))` |

## 7. Substrate note (recorded, not worked around)

The ClineMM Seatbelt profile
(`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:~702`)
contains `(allow signal (target self))` and no `process-info` /
group-signal allowance. Consequently, on this host `process.kill(-pgid, 0)`
returns **EPERM** for a live group instead of rc=0.

The production probe therefore labels a live group `eperm`
(`containmentFailed: "substrate_eperm"`) where the LIVE incident recorded
`alive` (`substrate_alive`). **Both are non-`gone` and both produce the
identical `containment_failed` terminal state and the identical safety
hold.** The causal discrimination in this ACT is therefore based on the
READ-ONLY kernel-truth liveness + process membership, not on the label,
and is substrate-independent.

Unrestricted execution paths were sought and are NOT available here:
- `sandbox-exec` nesting → `sandbox_apply: Operation not permitted`
- `launchctl bootstrap` → `Input/output error`; `launchctl submit` → no output
- `osascript` → inherits the enclosing sandbox
- the ClineMM host helper (`~/.clinemm/host-helper.sock`) is reachable and
  DOES observe the group from outside the sandbox (verified: a
  `process-group.register-owned` call succeeds while the leader is alive
  and returns `DENY_LEADER_NOT_FOUND` after it exits), but it exposes no
  READ-ONLY group-liveness method — only `terminate-owned`, which is
  destructive.
