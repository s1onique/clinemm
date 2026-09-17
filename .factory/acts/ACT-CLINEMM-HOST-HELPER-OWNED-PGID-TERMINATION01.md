# ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01

**Predecessor:** ACT-CLINEMM-REAL-LAUNCHAGENT-SIGNAL-DISCRIMINATOR02 (`GUI_LAUNCHAGENT_SIGNAL_ADVANTAGE = PROVEN`)

**Frozen facts:**

- ENTRY_HEAD = `e33feb373e1ef3eff0c79ac3f88b11883dd6d961`
- CURRENT_HELPER = `io.clinemm.host-helper`, per-user singleton, domain `gui/501`
- SOCKET = `/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock`
- HELPER_HEALTH = GREEN (PID 14133 at entry)
- SOCKET MODE = `srw-------` (0600)
- Forbidden architectural moves: `launchctl bootstrap`, `launchctl bootout`, sudo, root LaunchDaemon, SMJobBless, KeepAlive=true, global Chromium sandbox disable, naked pid/pgid/signal APIs, shell, command, argv, persistent process-management DB.

**Architecture (frozen):**

```
SpawnSupervisableShellCommand
  -> detached PGID
  -> helper.register-owned(client_token, pgid)
    -> ownership verification (peer_uid/pid, leader==pgid, etc.)
    -> JOB_TOKEN
  -> capability attached privately to job

CommandJobManager.cancel(jobId):
  1. terminateTree (direct)
     -> SIGTERM to -pgid
       -> ESRCH/PASS -> DONE
       -> EPERM     -> continue
  2. helper.terminate-owned(client_token, job_token)
     -> SIGTERM grace -> ESRCH | SIGKILL escalation
```

**Helper invariants conserved:**

- AF_UNIX, 0600
- `launch_activate_socket("Listener")`
- health method
- request_id correlation
- JSON output escaping, Unicode decode, embedded NUL preservation
- fail-closed launchd matrix
- testbed.run-installed-vsix-smoke (unchanged)
- 10 forbidden keys (anti-shell)
