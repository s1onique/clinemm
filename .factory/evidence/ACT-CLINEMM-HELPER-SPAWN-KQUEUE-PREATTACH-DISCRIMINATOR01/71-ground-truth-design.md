# 71-ground-truth-design.md

## What was added (this round)

The driver (`30-helper-preattach-driver.c`) and fixtures
(`31-helper-preattach-root.c`, `32-helper-preattach-emulator.c`) now
implement an independent ground-truth oracle in addition to the existing
kqueue reconciliation. This breaks the prior circular proof where
`missed_descendants_count` was computed by enumerating current children of
already-tracked PIDs (which cannot independently detect a descendant that
forks, escapes/reparents, and ends up with PPID=1).

### Ground-truth channel contract

- `CLINEMM_GROUND_TRUTH_FD=<write-fd>` is exported into the spawned fixture
  tree via a fresh env constructed by the driver (the driver's own environ
  is not mutated).
- The driver `pipe(2)`s BEFORE `posix_spawn`, preserves the write end on
  `gt_write_fd`, and reads from `gt_read_fd` after the kevent loop.
- Each fixture-created process writes one line as soon as its identity is
  valid:

  ```
  CREATE pid=<pid> ppid=<pid> pgid=<pid> start_us=<value>
  ```

  `start_us` is the kernel process start time (`p_starttime.tv_sec * 1e6 +
  tv_usec`) read via `sysctl(KERN_PROC)` for self. May be `0` if the read
  races a not-yet-published proc entry or if the writer is a shell wrapper
  that can't easily call sysctl.

### Identity discrimination (start_us > pid)

The driver maintains a `pid_start[]` table populated each time `watch()`
discovers a tracked pid (best-effort lookup via sysctl). The MISSED
discriminator is computed as:

```
MISSED = GROUND_TRUTH_CREATED - KQUEUE_TRACKED
        by start_us when GT record has start_us > 0,
        else by pid (fallback)
```

Empirical verification: on this substrate, `fork()` creates a child with a
different `start_us` than its parent (verified via a /tmp/forkstart repro:
parent `1789807010311285`, child `1789807011033633`). So `start_us` is a
per-probe-unique identifier.

### WATCH_ESRCH_SHORT_LIVED classification

Each `kevent(EVFILT_PROC)` registration that returns `ESRCH` is classified
as `ESRCH_SHORT_LIVED` (the watched identity was already gone before the
watch armed). This is NOT a primitive failure unless that identity had
ground-truth descendants. A different errno is classified as `FAILED_OTHER`
(a real primitive failure).

### End-event schema (new)

```json
{
  "event": "end",
  "tracked": [pid, ...],
  "ground_truth_created": [
    { "pid": N, "ppid": N, "pgid": N, "start_us": N }
  ],
  "watch_esrch": [pid, ...],
  "watch_failed_other": [pid, ...],
  "missed_ground_truth": [pid, ...],
  "missed_ground_truth_count": N,
  "duration_ms": N,
  "counters": {
    "fork_events": N,
    "watch_attempts": N,
    "watch_success": N,
    "watch_esrch": N,
    "watch_failed_other": N,
    "ground_truth_created_count": N,
    "ground_truth_seen_count": N,
    "ground_truth_missed_count": N
  }
}
```

### Fixtures

Existing six (A-F) updated with GT announce on every fork/spawn. New three
fixtures per ACT §13-§15:

  - `double-fork-setsid` (G): root -> fork child1 -> setsid() -> fork
    child2 -> child1 exits. Child2 is reparented to launchd.
  - `exec-fork` (H): root forks -> child execs /bin/sh -> shell does
    `setsid sleep &`. Tests NOTE_EXEC + NOTE_FORK composition.
  - `termination-window` (I): signal-handler forks detached child on
    SIGTERM (gated by `CLINEMM_FIXTURE_I_SIGNAL` env var so it stays a
    no-op by default).

## What was deliberately NOT added

- No `signal.cont` capability to the production helper (per ACT §19).
- No changes to `apps/`, `sdk/`, `helper.c`, `protocol.ts`, `client.ts`,
  `CommandJobManager` (per ACT §19, §27).
- No telemetry / UI changes (per ACT §20).
- No new probe binaries (the three existing ones carry the work).

## Build verification

```
$ make clean && make
cc ... -o 30-helper-preattach-driver 30-helper-preattach-driver.c
cc ... -o 31-helper-preattach-root 31-helper-preattach-root.c
cc ... -o 32-helper-preattach-emulator 32-helper-preattach-emulator.c
(0 warnings on -Wall -Wextra)
```

## Independent GT-channel smoke test (agent-side)

The agent shell cannot run the full driver (SIGCONT EPERM, same as RUN_1 /
RUN_2), so a small smoke harness was used that does NOT call SIGCONT and
just spawns the fixture tree to verify the GT channel end-to-end. Results on
the agent substrate:

```
fixture=shell-A:
  CREATE pid=61193 ppid=61192 pgid=61190 start_us=1789809340065416
  CREATE pid=61203 ppid=61193 pgid=61190 start_us=1789809340274940
  CREATE pid=61205 ppid=61203 pgid=61190 start_us=0
  CREATE pid=61210 ppid=61203 pgid=61190 start_us=0

fixture=python-escape:
  CREATE pid=62882 ppid=62881 pgid=62880 start_us=1789809602858886
  CREATE pid=62930 ppid=62882 pgid=62880 start_us=1789809603171480
  CREATE pid=62952 ppid=62930 pgid=62952 start_us=0

fixture=double-fork-setsid:
  CREATE pid=63630 ppid=63629 pgid=63627 start_us=1789809607893422
  CREATE pid=63631 ppid=63630 pgid=63627 start_us=1789809607895291
  CREATE pid=63632 ppid=63631 pgid=63631 start_us=1789809607895890

fixture=exec-fork:
  CREATE pid=63658 ppid=63657 pgid=63655 start_us=1789809609909917
  CREATE pid=63659 ppid=63658 pgid=63655 start_us=1789809609912358
  CREATE pid=63660 ppid=63659 pgid=63655 start_us=0

fixture=fork-storm (8 iterations):
  11 distinct identities captured (root + child1 + grandchild + 8 storm
  children). All start_us values populated for C-side announces.
```

This confirms the GT channel is correctly plumbed end-to-end on the agent
substrate. The actual discriminator (MISSED vs TRACKED) can only be
exercised once the operator runs the driver from Terminal.app where SIGCONT
works.

## Status

```
KQUEUE_PRIMITIVE_VIABILITY   = NOT_YET_ADJUDICATED
GROUND_TRUTH_CHANNEL         = IMPLEMENTED
GROUND_TRUTH_INDEPENDENT     = YES (oracle is fixture-owned; kqueue census is tracker-owned)
ORACLE_BUILDS_CLEAN          = YES (0 warnings)
READY_FOR_OPERATOR_RUN       = YES
NEXT                         = HUMAN_OPERATOR_RUNS_FROM_TERMINAL
```

## Operator handoff packet

See `73-operator-handoff.md` for the exact commands the human operator runs
from Terminal.app, plus the file paths ClineMM will subsequently read for
adjudication.
