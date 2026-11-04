# ACT-CLINEMM-BACKGROUND-EXEC-EPERM-LIVE-QUALIFICATION01 — Authority Map

## Real production chain (verified against the source at ENTRY_HEAD)

```
VS Code / Codium extension host  (pid 34640, uid 501)
  |  sandbox status: INSIDE the IDE's Chromium zygote sandbox
  |  (VSCodium Helper (Plugin) --enable-sandbox --service-sandbox-type=none)
  |  launchd domain: gui/501  ->  CLINEMM_HOST_HELPER_SOCKET NOT exported
  v
VscodeSessionHost.create()                    apps/vscode/src/sdk/vscode-session-host.ts:309
  |  helperOwnedPgidProvider: resolveLiveHelperOwnedPgidProvider()
  v
resolveLiveHelperOwnedPgidProvider()           apps/vscode/src/sdk/host-helper-pgid-adapter.ts:357
  |  PRE-REPAIR: process.env.CLINEMM_HOST_HELPER_SOCKET  (env-ONLY)  <-- THE DEFECT
  |  POST-REPAIR: resolveHostHelperSocketPath()  (env, then $HOME/.clinemm/host-helper.sock)
  v
CommandJobManager.start()                      apps/vscode/src/sdk/command-job-manager.ts:1857
  |  tryRegisterOwnedJob(childProcess)
  |    -> provider.clientOpen()      { client_token, peer_uid, peer_pid }
  |    -> provider.registerOwned()   { client_token, pgid }  -> { job_token }
  v
spawnSupervisableShellCommand()               sdk/packages/core/.../executors/bash.ts
  |  spawn({ detached: !isWindows })   -> child.pid === PGID === new session leader
  v
POSIX process group  (uid 501, pgid == child.pid)
  v
terminateTree()                                bash.ts:1151
  |  signalGroup(sig) -> process.kill(-childPid, sig)     bash.ts:1120
  |  EPERM captured as TerminateTreeResult.epermDetected
  v
CommandJobManager.runTerminationSequence()      command-job-manager.ts:2342
  |  if (treeResult.epermDetected && job.helperOwnedCapability)
  |     -> provider.terminateOwned({ clientToken, jobToken })
  v
HostHelperPgidProvider -> HelperWireClient     host-helper-pgid-adapter.ts:284
  v
AF_UNIX socket  /Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock  (mode 0600)
  v
native io.clinemm.host-helper  (uid 501, NOT root, NOT sandboxed — runs under launchd)
  |  handle_register_owned()   helper.c:2596
  |    - peer identity (getpeereid UID + LOCAL_PEERPID)  helper.c:2369
  |    - leader exists / start_us (PID-reuse) / getpgid(leader)==pgid
  |    - leader_uid == peer_uid
  |    - leader_ppid == peer_pid  (OR leader_pid == peer_pid)   helper.c:2669
  |  handle_terminate_owned()  helper.c:2742
  |    - SIGTERM to -pgid, grace, then SIGKILL to -pgid
  v
kernel termination observation
  v
finalize() -> postcondition probe (kill(-pgid,0)) -> terminal state commit
```

## Observed privilege / sandbox boundaries

| Boundary | UID | Sandbox | Notes |
|---|---|---|---|
| Extension host (34640) | 501 | Chromium zygote (`--enable-sandbox`) | `kill(-pgid, sig)` returns **EPERM** |
| Owned child process group | 501 | Cline Seatbelt (`allow signal (target self)`) | Seatbelt applies to the CHILD's outbound syscalls; it does NOT block the host's inbound signals. Not the EPERM cause. |
| Host helper (42547) | 501 | **none** (launchd LaunchAgent) | Can signal the owned group; unprivileged at OS level, authority only over registered+owned groups |
| `sandbox-exec` from inside the IDE tree | 501 | nested sandbox | `sandbox_apply: Operation not permitted` — Seatbelt cannot be applied from this authoring context; the REAL extension host CAN (see `.cline/data/sandbox-diag/net01-*.jsonl`: production `onInvocationPrepared` events with `/usr/bin/sandbox-exec` and profile SHA256) |

## The failing boundary

`resolveLiveHelperOwnedPgidProvider()` resolved the helper endpoint from the
environment **only**. The GUI launchd domain that starts VS Code / Codium does
not export `CLINEMM_HOST_HELPER_SOCKET`, so in the real extension host:

* the provider was `undefined`;
* `tryRegisterOwnedJob()` returned `undefined` (no registration);
* `job.helperOwnedCapability` was `undefined`;
* the EPERM-only fallback at `command-job-manager.ts:2397` was **unreachable**;
* the owned process group survived cancellation (orphan), and
* `await job.process.exit` (line 2484) never resolved, so `cancel()` **hung**.

The SAME env-only read existed at the SDK Seatbelt seam
(`seatbelt-backend.ts:524`), which additionally meant the sandboxed child got
neither the AF_UNIX socket rule nor the endpoint value in its environment.

The rest of the repository already used the correct two-tier resolution
(`tools/macos-host-helper/server.ts:218`, `tools/tart-testbed/src/cli.ts:273`):
env override, then `$HOME/.clinemm/host-helper.sock`. The VS Code adapter and
the Seatbelt backend were the only two outliers.
