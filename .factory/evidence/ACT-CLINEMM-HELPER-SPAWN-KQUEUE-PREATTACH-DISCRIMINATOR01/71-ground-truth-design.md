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

### Identity discrimination (P0-1, fail-closed)

The driver maintains a `pid_start[]` table populated each time `watch()`
discovers a tracked pid (best-effort lookup via sysctl). The MISSED
discriminator is computed as:

```
MISSED = GROUND_TRUTH_CREATED - KQUEUE_TRACKED

  Strong path (start_us != 0 in GT record):
    require EXACT (pid, start_us) match in pid_start[]
    if no exact match -> MISS (fail closed; no pid-only fallback)
    This prevents the false-GREEN class where pid-reuse or an
    unrelated process with the same pid could mask a missing identity.

  Weak path (start_us == 0 in GT record):
    pid-only match in tracked[]
    This is explicitly weaker evidence and is counted separately
    via ground_truth_created_pid_only_count so the operator can
    quantify how many cases relied on the weaker rule.
```

Empirical verification: on this substrate, `fork()` creates a child with a
different `start_us` than its parent (verified via a /tmp/forkstart repro:
parent `1789807010311285`, child `1789807011033633`). So `start_us` is a
per-probe-unique identifier.

Unit-test verification (in /tmp/test_tracked, runnable as
`cc -o /tmp/test_tracked /tmp/test_tracked.c && /tmp/test_tracked`):

```
PASS T1: GT(123,1000) matches tracked(123,1000)
PASS T2: GT(456,1000) does NOT match tracked(456,1001) [P0-1 fix verified]
PASS T3: GT(123,999) does NOT match tracked(123,1000) [P0-1 fix verified]
PASS T4: pid-reuse GT(123,1000) does NOT match overwritten tracked(123,2000)
PASS T5: GT(999,0) matches tracked(999) via pid-only fallback
PASS T6: GT(42,0) does not match (pid not tracked)
```

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
    "ground_truth_created_with_start_us_count": N,
    "ground_truth_created_pid_only_count": N,
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
  - `signal-triggered-fork` (I, renamed from `termination-window` per
    P1 review): the fixture blocks SIGTERM/SIGINT with `sigprocmask`,
    waits via `sigwait()` in normal control flow, then forks a
    detached child (setsid + sleep) and announces it BEFORE the
    parent exits. This is async-signal-safe (the heavy work happens
    outside the handler). Gated by `CLINEMM_FIXTURE_I_SIGNAL=SIGTERM`
    env var (or `SIGINT`); unset = no-signal control. SIGKILL mode is
    documented as unsupported (SIGKILL cannot be sigwait()ed).

**P1 oracle-contamination fix**: the shell fixtures used to spawn
`ps -o pgid= / tr -d ' '` to enrich the diagnostic `pgid` field.
Each such subprocess is itself a descendant the oracle does NOT
announce, weakening the GROUND_TRUTH_CREATED claim. After the fix,
shell-announced records use `pgid=0`; the driver's discrimination
is by `(pid, start_us)`, not by pgid. No `ps`/`tr` subprocesses
remain in any fixture.

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
fixture=shell-A (round-2, after ps/tr removal):
  CREATE pid=93348 ppid=93347 pgid=93347 start_us=1789815205123807
  CREATE pid=93349 ppid=93348 pgid=93347 start_us=1789815205126107
  CREATE pid=93351 ppid=93349 pgid=0       start_us=0   [bash announce, no ps/tr]
  CREATE pid=93353 ppid=93349 pgid=0       start_us=0   [bash announce, no ps/tr]

fixture=exec-fork (round-2, after ps/tr removal):
  CREATE pid=93482 ppid=93481 pgid=93480 start_us=1789815227638273
  CREATE pid=93483 ppid=93482 pgid=93480 start_us=1789815227640743
  CREATE pid=93484 ppid=93483 pgid=0       start_us=0   [bash setsid announce, no ps/tr]

fixture=signal-triggered-fork (round-2, SIGTERM self-raise):
  CREATE pid=93485 ppid=93480 pgid=93480 start_us=1789815227669777
  CREATE pid=93486 ppid=93485 pgid=93486 start_us=1789815227672245
  -- root exited with -15 (SIGTERM); pid=93486 detached (PPID=1, own pgid)

fixture=signal-triggered-fork (control, env unset):
  CREATE pid=93519 ppid=93517 pgid=93517 start_us=1789815235186239
  -- control case emits ONE record (the root only); exits 0
```

This confirms the GT channel is correctly plumbed end-to-end on the agent
substrate, including:

  - C-side announces carry accurate pgid and start_us
  - Bash-side announces now use pgid=0 and start_us=0 (no ps/tr noise)
  - signal-triggered-fork SIGTERM mode: parent exits via SIGTERM, detached
    child survives and is announced BEFORE the parent dies
  - signal-triggered-fork control mode: no spurious fork, exits 0

The actual discriminator (MISSED vs TRACKED) can only be
exercised once the operator runs the driver from Terminal.app where SIGCONT
works.

## Status

```
KQUEUE_PRIMITIVE_VIABILITY   = NOT_YET_ADJUDICATED
GROUND_TRUTH_CHANNEL         = IMPLEMENTED
GROUND_TRUTH_INDEPENDENT     = YES (oracle is fixture-owned; kqueue census is tracker-owned)
ORACLE_BUILDS_CLEAN          = YES (0 warnings)
P0_FALSE_GREEN_RISK          = CLOSED (fail-closed identity, exact (pid,start_us))
P1_PS_TR_NOISE               = CLOSED (no descendant spawns in fixtures)
P1_SIGNAL_HANDLER_UNSAFE     = CLOSED (sigwait() in normal control flow)
P0_ENV_AS_ARGV               = CLOSED (run_env helper, env KEY=VAL command)
READY_FOR_OPERATOR_RUN       = YES
NEXT                         = HUMAN_OPERATOR_RUNS_FROM_TERMINAL
```

## Operator handoff packet

See `73-operator-handoff.md` for the exact commands the human operator runs
from Terminal.app, plus the file paths ClineMM will subsequently read for
adjudication.

## Round-3 update (HALT_GROUND_TRUTH_PIPE_CAN_DROP_RECORDS)

Reviewer flagged that the previous oracle reader could silently drop
records when a `read()` returned a fragment containing no newline. Per
Apple `read(2)`, partial reads are legal on pipes; only regular files
guarantee a full requested read. The fix is lossless carry retention +
meaningful EOF semantics + visible write failures.

### What changed

1. **Lossless carry**: `drain_ground_truth()` now only resets `carry_len`
   when `scan >= carry_len` (consumed everything) or moves the residual
   to the front of `buf` when `scan > 0` (partial). If `scan == 0`
   (no newline yet), the carry is **kept** for the next `read()` to
   append to. Previously, `scan == 0` reset `carry_off = carry_len = 0`
   which silently dropped bytes from the prior read.

2. **EOF semantics**: the driver now closes its own `gt_write_fd`
   immediately after `posix_spawn()` succeeds (the spawned root
   inherited a duplicate, so the close is safe). Per Apple `pipe(2)`,
   EOF on the read end appears only after every write descriptor is
   closed; previously the driver kept `gt_write_fd` open until after
   the drain, so EOF was effectively unreachable.

3. **Final-drain removed**: the prior "best-effort final drain" called
   `read()` and threw bytes away. Every byte now goes through the
   same parser.

4. **Overflow halt**: `carry_len >= sizeof(buf)` latches
   `gt_reader_fault` (exit code 7) and emits a halt event. This is
   a hard halt, not a silent drop.

5. **EOF-branch carry handling**: when EOF arrives with a non-empty
   carry, the parser appends a sentinel newline (if missing) and
   attempts to parse the residual as a final record. A truncated
   record (no newline at EOF) is now visible.

6. **Visible write failures**: fixture `gt_announce()` now retries on
   `EAGAIN`/`EINTR` (3 attempts, 1ms backoff). On persistent failure
   it emits a `WRITE_FAILED pid=N attempted=N errno=N\n` line on the
   same pipe AND a stderr line. The driver parses `WRITE_FAILED`,
   increments `gt_write_failures`, and emits
   `ground_truth_write_failures` in the end event (exit code 6
   reserved for any non-zero count).

### Verification

**40-oracle-lossless-witness** (`tools/macos-host-helper/native/containment-probe/40-oracle-lossless-witness.c`,
245 lines, builds to a 34600-byte standalone test):

```
Fragmenter writes 7 records with split-half-and-sleep-each-side fragmentation,
plus 1 WRITE_FAILED line, plus 1 truncated-at-EOF record (no trailing newline).

records_seen=8
gt_with_start_us=7
gt_write_failures=1
gt_reader_fault=0
truncated-at-EOF record (pid=888) survived: YES
VERDICT=PASS
```

The fragmentation is the worst case for a non-lossless parser: every
record is split across two writes with a 2ms gap, forcing the parser
to retain carry across reads. The old parser would have captured
0-3 of the 7 fragmented records; the new parser captures all 7.

### Updated status block

```
KQUEUE_PRIMITIVE_VIABILITY   = NOT_YET_ADJUDICATED
GROUND_TRUTH_CHANNEL         = IMPLEMENTED + LOSSLESS + EOF-AWARE
GROUND_TRUTH_INDEPENDENT     = YES (oracle is fixture-owned; kqueue census is tracker-owned)
ORACLE_BUILDS_CLEAN          = YES (0 warnings; 4 binaries incl. witness)
P0_FALSE_GREEN_RISK          = CLOSED (fail-closed identity, exact (pid,start_us))
P1_PS_TR_NOISE               = CLOSED (no descendant spawns in fixtures)
P1_SIGNAL_HANDLER_UNSAFE     = CLOSED (sigwait() in normal control flow)
P0_ENV_AS_ARGV               = CLOSED (run_env helper, env KEY=VAL command)
PIPE_LOSS_FALSE_GREEN_RISK   = CLOSED (round-3 lossless carry + EOF semantics)
WRITE_FAIL_SILENT            = CLOSED (round-3 WRITE_FAILED line + counter)
CARRIER_OVERFLOW             = CLOSED (round-3 halt + exit code 7)
READY_FOR_OPERATOR_RUN       = YES
NEXT                         = HUMAN_OPERATOR_RUNS_FROM_TERMINAL
```
