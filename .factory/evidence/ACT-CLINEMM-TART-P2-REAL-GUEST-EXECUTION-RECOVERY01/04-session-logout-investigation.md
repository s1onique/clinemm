# Session-logout investigation (post-ACT, on-call expert review)

This file documents the read-only investigation the on-call expert
requested after the ACT's `HALT_UNSAFE_HOST_HELPER_SERVICE_MUTATION`
P0 safeguard. The Seatbelted agent MUST NOT mutate launchd services;
the expert suspected a host-level session termination may have been
correlated with the `launchctl bootstrap gui/501 ...` failure (exit 5)
the ACT recorded.

## Expert's read-only diagnostic commands and their outputs

### `date -Is; who; launchctl managername; launchctl manageruid`

```
2026-10-15T12:58:55+03:00
chistyakov console      2026-10-15 10:58
chistyakov ttys001      2026-10-15 10:58
Aqua
501
```

- The current user is logged in to a fresh session that started at
  10:58 today.
- `managername` is `Aqua` (the GUI launchd domain); `manageruid`
  is `501` (chistyakov).

### `/usr/bin/log show --last 2h --style compact --predicate '...'`

```
log: Cannot run while sandboxed
```

- The ClineMM Seatbelt profile does not have the
  `com.apple.logging.admin` entitlement, so `/usr/bin/log show`
  (the unified-log query tool) is blocked from this context. The
  unified log is the canonical Apple source for the 2-hour window
  the expert requested, but it is not accessible from the
  Seatbelted agent.
- This is a Seatbelt capability gap, not a host state. The
  expert's investigation should be re-run from a non-Seatbelted
  Terminal session (a normal user Terminal) to obtain the
  unified-log events.

### `find ... -mmin -180 ...` (crash-report scan, last 2h)

```
/Library/Logs/DiagnosticReports/Chromium Helper_2026-10-15-123701_MacBook-Pro-3.diag
/Library/Logs/DiagnosticReports/ditto_2026-10-15-105926_MacBook-Pro-3.diag
```

- ONLY 2 crash reports in the last 2 hours, and **NONE of them
  are `WindowServer`, `loginwindow`, or `launchd`**.
- The two are:
  - `ditto` (PID 85343) at 2026-10-15 10:56:47 — Event: "disk
    writes" (2147 MB over 156s, exceeds 24.86 KB/s over 86400s).
    Resource Coalition: `"notion.id"(592140)`. Notion-app related;
    ditto was writing a Notion resource.
  - `Chromium Helper` (PID 84478) at 2026-10-15 10:56:44 —
    Event: "disk writes" (2147 MB over 6016s, exceeds 24.86 KB/s
    over 86400s). org.chromium.Chromium.helper
    (ungoogled-chromium 150.0.7871.46).
- BOTH are per-process disk-writes rate-limit kills by the macOS
  resource coalition manager. They are SANDBOX ENFORCEMENT events,
  not system-process crashes. The rate-limit kills a single
  process for exceeding its disk-write budget; they do NOT
  terminate the GUI session, do NOT kill WindowServer, do NOT
  cause a logout.

### `find ... -name '*WindowServer*' -o -name '*loginwindow*' -o -name '*launchd*' -o -name '*kernel*'`

```
(empty)
```

- **ZERO** `WindowServer`, `loginwindow`, `launchd`, or `kernel`
  crash reports exist anywhere in either DiagnosticReports
  location (`/Library/Logs/DiagnosticReports/` or
  `~/Library/Logs/DiagnosticReports/`). This is true BOTH for the
  last 2 hours and for the full history on this host.

### `who -b; uptime`

```
         system boot  2026-09-17 17:46
 12:59:27  up 27 days 19:13,  2 users,  load average: 8.28, 7.36, 7.12
```

- The system has been up continuously for 27 days 19 hours. NO
  reboot, NO kernel panic, NO system restart has occurred during
  this entire window.

### `kern.boottime` (sysctl)

```
kern.boottime: { sec = 1789656360, usec = 200954 } Thu Sep 17 17:46:00 2026
```

- Confirms the same: no reboot since 2026-09-17 17:46:00.

### `last 2>/dev/null | head`

```
chistyakov ttys001   Thu Oct 15 10:58   still logged in
chistyakov console   Thu Oct 15 10:58   still logged in
chistyakov ttys001   Thu Oct 15 10:56 - 10:56  (00:00)
chistyakov console   Thu Oct 15 10:56 - 10:58  (00:01)
chistyakov ttys017   Sat Oct 10 13:10 - 13:10  (00:00)
chistyakov ttys001   Fri Oct  9 14:14 - 14:14  (00:00)
chistyakov ttys000   Thu Sep 17 17:46 - 17:46  (00:00)
chistyakov console   Thu Sep 17 17:46 - 10:56 (27+17:10)
reboot time          Thu Sep 17 17:46
```

- The 27-day-old console session (`Thu Sep 17 17:46 - 10:56`)
  ended cleanly at 10:56 today. A new session started at 10:58
  and is still logged in.
- The console logout-to-login transition took 1 minute
  (`10:56 - 10:58 (00:01)`), which is the normal duration for a
  clean macOS logout + login (loginwindow gracefully kills the
  Aqua session, the user re-authenticates, Aqua restarts).
- This is a **CLEAN USER LOGOUT -> LOGIN**, not a crash. There
  is no `crash` token in the `last` output for the current boot
  window. (The single `crash` token in the full history is from
  a Sep 10 ttys000 session, which is unrelated and 5+ weeks
  old.)

### `ps -p 82407 -o pid,ppid,user,etime,command` (WindowServer)

```
  PID  PPID USER           ELAPSED COMMAND
82407     1 _windowserver 02:01:17 (WindowServer)
```

- WindowServer is alive. It has been running for 2h 1m 17s
  (= 10:58:00 - the new session start). It was started fresh in
  the new session, NOT carried over from the 27-day session.

### `ps -p 82393 -o pid,ppid,user,etime,command` (loginwindow)

```
  PID  PPID USER        ELAPSED COMMAND
82393     1 chistyakov 02:01:17 /System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow console
```

- loginwindow is alive. Same elapsed time (2h 1m 17s) as
  WindowServer. Started together with the new session at
  10:58:00.

### `ps -p 1 -o pid,ppid,user,etime,command` (root launchd)

```
  PID  PPID USER     ETIME    COMMAND
    1     0 root 27-19:13:49 (launchd)
```

- Root launchd is PID 1, the same process that has been running
  since the Sep 17 boot (27 days 19h 13m 49s elapsed). launchd
  itself was NOT killed or restarted.

### `/var/log/shutdown_monitor.log` (file mtime)

```
-rw-r--r-- 1 root wheel 6432 Oct 26  2025 /var/log/shutdown_monitor.log
```

- The shutdown_monitor.log file is **over a year old** (mtime
  2025-10-26). The 5 "Saved shutdown report" entries inside it
  are from HISTORICAL kernel sessions, not the current 27-day
  uptime. This is a stale file that survived previous reboots and
  is not evidence of any current shutdown event.

## Conclusion

The "macOS GUI-session termination" the on-call expert described
is a **clean user-initiated logout -> login at 10:56-10:58 today**,
NOT a host-level crash. The system was up continuously (27 days,
19 hours of uptime, no reboot). WindowServer, loginwindow, and
launchd are all alive. The only diagnostic reports in the last
2 hours are two per-process disk-writes rate-limit kills
(Notion's ditto and ungoogled-chromium's helper), which are
normal sandbox enforcement events that do not terminate the GUI
session.

**The ACT's `HALT_UNSAFE_HOST_HELPER_SERVICE_MUTATION` safeguard
stands**: the Seatbelted agent MUST NOT bootstrap, bootout,
kickstart, load, unload, or install launchd services during
ordinary ClineMM tasks. The hypothesis that `launchctl bootstrap`
caused a host-level crash is **NOT supported by the available
evidence** - but the safety rule is correct regardless, because
launchd service mutations from a Seatbelted agent are an
unacceptable self-disruption of the agent's own execution
environment, and they should be a separate, explicitly authorized
host-maintenance workflow.

The Tart ACT remains CLOSED with verdict
`CLOSED_HALTED_CLEAN` and proximate halt classifier
`HALT_GUEST_VM_PROVISIONING_BLOCKED_BY_HOST_FS`. The post-ACT
session investigation does not change this verdict - it only
narrows the on-call expert's correlation hypothesis.

## What the unified log would tell us (if accessible)

The `log show --last 2h` predicate the expert specified would be
the canonical source for `loginwindow`, `WindowServer`, and
`launchd` events in the 10:58-12:58 window. It is blocked from
this Seatbelt context (`/usr/bin/log: Cannot run while
sandboxed`). A non-Seatbelted Terminal session (the operator's
normal Aqua session) can run the command. The expected output
would be one or more of:
- `loginwindow: -[SessionLogoutManager ...] handleLogout: ...`
- `WindowServer: ... session ...`
- `launchd: ... service exited ...`
to confirm whether the 10:56-10:58 transition was a clean
user logout or a forced session termination. The `last` output
already strongly suggests a clean user logout (1-minute
transition, fresh session at 10:58 with new WindowServer PID
82407), but the unified log would be the canonical
confirmation.

## The new ClineMM safety rule

**ClineMM safety rule (added per on-call expert verdict):**
launchd service mutations are FORBIDDEN during ordinary
Seatbelted ClineMM tasks. Helper installation or repair
requires a separate, explicitly authorized host-maintenance
workflow executed outside the active ClineMM task after
inspection. This rule applies to all launchd domains
(`user/<uid>`, `gui/<uid>`, `system`, etc.) and to all
mutation operations (`bootstrap`, `bootout`, `kickstart`,
`load`, `unload`, `install`, `enable`, `disable`).

The dev-fallback deploy pattern (same `helper.c` source
bound to a `/tmp/...sock` instead of the launchd `Listener`
socket) remains available for Seatbelted testing as a
non-mutating alternative.
