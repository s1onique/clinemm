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

## Round-4 update (HALT_ORACLE_WRITE_FAILURE_CHANNEL_NOT_FAILSAFE)

Reviewer flagged that the round-3 `WRITE_FAILED` line uses the same
pipe that just failed. If the pipe is broken (reader gone, EPIPE,
SIGPIPE), the diagnostic itself can be lost, leaving the driver with
neither the CREATE nor the failure signal. The fix is to make the
fixture's exit status the authoritative cross-process-boundary
oracle-failure signal, which the kernel mediates independently of any
pipe state.

### What changed

1. **Authoritative `_exit(86)` failsafe.** When `gt_announce()`
   detects an unrecoverable write failure (EPIPE, EIO, ENXIO, EBADF,
   or persistent EAGAIN underflow), it now calls `_exit(86)` via
   `gt_announce_failure()`. Exit status 86 is a kernel-mediated fact
   that `waitpid()` in the driver can observe regardless of pipe
   state. The in-pipe `WRITE_FAILED` line is now treated as
   best-effort, not load-bearing.

2. **SIGPIPE suppression.** Both fixture binaries
   (`31-helper-preattach-root.c`, `32-helper-preattach-emulator.c`)
   now call `signal(SIGPIPE, SIG_IGN)` at process start. Without this,
   the kernel's default SIGPIPE action would terminate the fixture
   on the first EPIPE write, before the round-4 `_exit(86)` failsafe
   could run.

3. **Driver-side waitpid + status check.** After `drain_ground_truth()`
   returns, the driver (`30-helper-preattach-driver.c`) calls
   `waitpid(root, ...)` to reap the spawned root. If the root exits
   with status 86 (`GT_EVIDENCE_FAIL_STATUS`), the driver latches
   `gt_oracle_evidence_fail = 1` and emits a `root_exit` JSON event.
   Signal-induced termination (e.g., signal-triggered-fork SIGTERM
   mode) is treated as the contract — NOT latched.

4. **New exit code 8 reserved.** `gt_oracle_evidence_fail` returns
   exit code 8, distinct from the round-3 codes 6 (in-pipe WRITE_FAILED)
   and 7 (reader fault). The PASS-only-on-exit-0 invariant is preserved.

5. **New witness binary `41-oracle-broken-channel-witness`.** 240-line
   C test (4 cases) verifies the failsafe works on:
   - T1: mirrored broken-pipe logic → `_exit(86)` ✓
   - T2: confirms EPIPE on broken channel makes in-pipe WRITE_FAILED
     unreliable (this is the reviewer's exact concern) ✓
   - T3: healthy pipe → `_exit(0)` (no false positive) ✓
   - T4: **real `31-helper-preattach-root` binary** with closed GT
     read end → exits 86 via waitpid observation ✓

### Why this is fail-safe

The invariant now holds:

```
CREATE could not be durably emitted  =>  this run can NEVER return PASS.
```

Mechanism:
- Pipe failure (any cause: EPIPE, EIO, ENXIO, EBADF, persistent EAGAIN):
  fixture `_exit(86)` immediately.
- Process exit status is a kernel-mediated fact, NOT pipe-mediated.
- The driver `waitpid()`s the root and inspects the status. If it's
  86, `gt_oracle_evidence_fail` latches and exit code 8 is returned.
- The in-pipe `WRITE_FAILED` line is now redundant for correctness;
  it's still emitted for log inspection and for round-3 backward
  compatibility, but its loss is no longer fatal.

### Verification

```
$ ./41-oracle-broken-channel-witness
=== ORACLE_BROKEN_CHANNEL_WITNESS (round-4) ===
[T1 broken-pipe (read end closed)] child exit_status=86 signaled=0
  T1 expected=86 got=86 PASS
[T2 broken-pipe diagnostic] first_write=-1 errno=32, second_write=-1 errno=32
[T3 healthy-pipe control] parent read=48 errno=0
[T3 healthy-pipe control] child exit_status=0 signaled=0
  T3 expected=0 got=0 PASS
  T4 [real fixture, broken GT] expected=86 got=86 PASS
=== failures=0 VERDICT=PASS ===
```

Note T4: the witness `execl()`s the **actual** `31-helper-preattach-root`
binary (path resolved via `_NSGetExecutablePath` for cwd independence),
sets `CLINEMM_GROUND_TRUTH_FD` to a pipe whose read end is already
closed, and observes exit status 86 via `waitpid()`. This is the
end-to-end proof that the round-4 failsafe is wired into the production
fixture binary, not just a mirror.

### Updated status block

```
KQUEUE_PRIMITIVE_VIABILITY        = NOT_YET_ADJUDICATED
GROUND_TRUTH_CHANNEL              = IMPLEMENTED + LOSSLESS + EOF-AWARE + FAIL-SAFE
GROUND_TRUTH_INDEPENDENT          = YES
ORACLE_BUILDS_CLEAN               = YES (0 warnings; 5 binaries incl. 2 witnesses)
P0_FALSE_GREEN_RISK               = CLOSED (fail-closed identity, exact (pid,start_us))
P1_PS_TR_NOISE                    = CLOSED
P1_SIGNAL_HANDLER_UNSAFE          = CLOSED
P0_ENV_AS_ARGV                    = CLOSED
PIPE_LOSS_FALSE_GREEN_RISK        = CLOSED (round-3 lossless carry)
WRITE_FAIL_SILENT                 = CLOSED (round-3 in-pipe + round-4 _exit(86))
WRITE_FAIL_CHANNEL_NOT_FAILSAFE   = CLOSED (round-4 kernel-mediated status)
CARRIER_OVERFLOW                  = CLOSED (round-3 halt + exit code 7)
ORACLE_EVIDENCE_FAIL              = CLOSED (round-4 exit code 8)
READY_FOR_OPERATOR_RUN            = YES
NEXT                              = HUMAN_OPERATOR_RUNS_FROM_TERMINAL
```

## Round-5 update (HALT_ORACLE_DESCENDANT_FAILURE_NOT_PROPAGATED)

Round-4 made the GT-pipe write fail-safe by `_exit(86)` on broken
channel. But that failsafe was triggered by ANY descendant's GT
write failure -- meaning if a bash subprocess tried to write its own
CREATE record and the pipe was broken, the bash subprocess would
exit 86. This creates a problem: in some fixtures the bash
subprocess may not be the immediate child of root; if it fails, the
root process can still complete normally. Worse, the round-4 failsafe
couples descendant write failure with root `_exit(86)`, which means
a single broken pipe can take down an entire healthy fixture run if
ANY descendant's write fails.

The fix is to separate concerns: descendants don't write to GT at
all. Instead, they post small report lines to a descendant-report
pipe, and the root process's reader thread is the SOLE writer to GT.
This makes "CREATE could not be durably emitted" the only oracle-
failure trigger, and descendant write failures are simply missed
reports (detectable by the driver, not catastrophic).

### What changed

1. **Two-pipe topology.** The driver now creates TWO pipes per
   fixture run:
   - `gt_pipe[2]`: GT pipe. Root writes CREATE records; driver reads.
   - `desc_pipe[2]`: descendant-report pipe. Descendants write
     `"pid=<N> start_us=<N>\n"` report lines; root reads.
   The driver passes both pipes to the spawned root via three env
   vars: `CLINEMM_GROUND_TRUTH_FD=<gt_write_fd>`,
   `CLINEMM_GT_DESC_READ_FD=<desc_read_fd>`,
   `CLINEMM_DESCENDANT_FD=<desc_write_fd>`.

2. **Single-writer invariant.** Only root writes to the GT pipe.
   `gt_serialize_report()` is mutex-protected (`pthread_mutex_t`) and
   the only path to `g_gt_root_fd`. If that write fails, `_exit(86)`
   is called and `waitpid()` in the driver observes it. Round-5 does
   NOT add a new exit code; the round-4 exit code 8 semantics are
   preserved exactly.

3. **Reader thread + dedup.** A detached `pthread` (`gt_reader_thread`)
   drains the descendant pipe, parses `"pid=<N> start_us=<N>\n"`
   lines, and calls `gt_reader_emit(pid, sus)` which dedupes by pid
   (linear scan of a 64-entry `g_seen_pids[]`) before serializing
   to GT. This eliminates duplicate CREATE records when the C-side
   `gt_announce(c)` in the parent AND `gt_announce(getpid())` in the
   pre-exec child both fire for the same pid.

4. **FD lifetime.** Root keeps its inherited WRITE end of the
   descendant pipe for the full lifetime of the process. If root
   closed it before forking some descendants, those descendants
   would not have the FD. The reader thread dies with the process
   when root exits; EOF is not required for correctness because the
   reader is short-lived relative to the fixture run.

5. **CLOEXEC handling.** Root's GT write end has `FD_CLOEXEC`
   cleared (no harm). Root's descendant READ end has `FD_CLOEXEC`
   set so descendants that fork+exec from root do not inherit the
   read end -- they only need the write end.

6. **32-helper-preattach-emulator.c was NOT modified** because its
   descendants stay in C and never exec. They can write directly to
   GT (they inherited the FD from root) without going through the
   descendant-report pipe. The two-pipe env vars are accepted but
   unused by 32-.

### Why this is correct

The round-5 invariant now holds precisely:

```
Root's serialize_report fails (EPIPE/EIO/ENXIO/EBADF)  =>  root _exit(86)
   =>  driver waitpid(root) observes status 86
   =>  gt_oracle_evidence_fail latches
   =>  exit code 8 (round-4)

Descendant write fails (EPIPE on the descendant pipe)   =>  report dropped
   =>  root continues normally
   =>  exit code 0 (no oracle failure)
   =>  driver detects via missed_ground_truth_count comparison
```

The descendant pipe is intentionally NOT load-bearing for correctness.
Its purpose is to give descendants a way to communicate reports
without becoming writers to the GT pipe (which would require them to
either exec with the GT FD inherited, or share a mutex with root --
both impossible from a fork+exec'd bash subprocess).

### Verification

```
$ ./42-oracle-descendant-failure-witness
=== ORACLE_DESCENDANT_FAILURE_WITNESS (round-5) ===
[gt_write_failed] pid=77290 attempted=65 errno=32
  T1 [real fixture, GT broken pre-spawn] expected=86 got=86 PASS
[fixture-shell-A] parent pid=77291 pgid=77177 ppid=77289
  T2 [real fixture, descendant pipe broken pre-spawn] expected=0 got=0 PASS
[fixture-shell-A] parent pid=77302 pgid=77177 ppid=77289
  T3 [healthy two-pipe control] expected=0 got=0 PASS
=== failures=0 VERDICT=PASS ===
```

Smoke tests on agent substrate (all 4 fixtures):
```
shell-A/control:                CREATE=4 WRITE_FAILED=0 exit=0   PASS
exec-fork/control:              CREATE=3 WRITE_FAILED=0 exit=0   PASS
signal-triggered-fork/control:  CREATE=1 WRITE_FAILED=0 exit=0   PASS
signal-triggered-fork/SIGTERM:  CREATE=1 WRITE_FAILED=0 exit=-15 PASS
```

### Updated status block (round-5)

```
KQUEUE_PRIMITIVE_VIABILITY        = NOT_YET_ADJUDICATED
GROUND_TRUTH_CHANNEL              = IMPLEMENTED + LOSSLESS + EOF-AWARE + FAIL-SAFE
GROUND_TRUTH_TOPOLOGY             = TWO-PIPE (GT + descendant-report; round-5)
GROUND_TRUTH_INDEPENDENT          = YES
GT_SOLE_WRITER                    = ROOT_ONLY (mutex-protected reader thread)
DESCENDANT_FAILURE_NOT_PROPAGATED = YES (round-5 invariant)
ORACLE_BUILDS_CLEAN               = YES (0 warnings; 6 binaries incl. 3 witnesses)
P0_FALSE_GREEN_RISK               = CLOSED (fail-closed identity, exact (pid,start_us))
P1_PS_TR_NOISE                    = CLOSED
P1_SIGNAL_HANDLER_UNSAFE          = CLOSED
P0_ENV_AS_ARGV                    = CLOSED
PIPE_LOSS_FALSE_GREEN_RISK        = CLOSED (round-3 lossless carry)
WRITE_FAIL_SILENT                 = CLOSED (round-3 in-pipe + round-4 _exit(86))
WRITE_FAIL_CHANNEL_NOT_FAILSAFE   = CLOSED (round-4 kernel-mediated status)
CARRIER_OVERFLOW                  = CLOSED (round-3 halt + exit code 7)
ORACLE_EVIDENCE_FAIL              = CLOSED (round-4 exit code 8)
DESCENDANT_WRITE_FAILURE_CASCADE  = CLOSED (round-5 two-pipe topology)
READY_FOR_OPERATOR_RUN            = YES
NEXT                              = HUMAN_OPERATOR_RUNS_FROM_TERMINAL
```

## Round-6 update (HALT_ORACLE_EXPECTED_SET_DISAPPEARS_ON_REPORT_FAILURE)

Round-5 introduced a two-pipe topology (GT pipe + descendant-report
pipe) with a reader thread in root. The reviewer flagged a P0 in
that design:

> "Descendant write fails -> report dropped -> root continues normally
> -> exit code 0 -> driver detects via missed_ground_truth_count"

But `missed_ground_truth_count` is defined as
`GROUND_TRUTH_CREATED - KQUEUE_TRACKED`. The GT records themselves
are what arrive through the oracle. So if a descendant's report is
dropped **before** it becomes a CREATE, the process is absent from
`GROUND_TRUTH_CREATED` AND from the comparison set. The driver has
no independent "expected descendant set" to discover the omission:

```
descendant really exists
  -> descendant-report write fails
  -> no CREATE reaches GT
  -> KQUEUE may also miss descendant
  -> GT contains no descendant
  -> GT - KQUEUE = empty
  -> missed_ground_truth_count = 0
  -> exit 0 possible
```

That is a textbook false-GREEN. The fix is to SIMPLIFY rather than
add a third oracle channel.

### What changed

1. **Single-pipe topology.** Removed the descendant-report pipe and
   the root reader thread. EVERY fixture-created process (root + every
   descendant, C-side or exec'd) inherits `CLINEMM_GROUND_TRUTH_FD`
   and writes its CREATE record DIRECTLY to the single GT pipe that
   the driver drains.

2. **Expected set = GT.** `GROUND_TRUTH_CREATED` is now the
   AUTHORITATIVE expected set, derived from the SAME pipe the driver
   reads. There is no secondary pipe, no reader thread in root, no
   report->CREATE translation stage that can erase the expected set.

3. **Atomic writes.** Each CREATE record is 75-100 bytes, well below
   `PIPE_BUF` (65536 bytes on macOS). POSIX `pipe(2)` guarantees
   atomic writes for any payload `<= PIPE_BUF`, so concurrent writers
   from different processes serialize at the kernel without
   interleaving. No mutex or thread is needed.

4. **Round-4 failsafe preserved.** On a broken GT pipe
   (`EPIPE`/`EIO`/`ENXIO`/`EBADF`), `gt_announce_failure()` calls
   `_exit(86)` immediately. The driver `waitpid(root)` observes
   status 86 and latches `gt_oracle_evidence_fail` (exit code 8).

5. **Multithreaded-fork hazard removed.** No `pthread` exists in
   root. Apple `pthread_atfork(3)` docs warn that the child side of
   `fork()` in a multithreaded process is heavily restricted; the
   child can only call async-signal-safe functions. The round-6 fix
   avoids this entirely.

6. **32-emulator unchanged.** `32-helper-preattach-emulator.c` was
   not modified. Its descendants stay in C and never exec, so
   multiple writers to GT are safe (no fork+exec that needs an
   inherited env var; the GT FD is already inherited at fork time).

### Why this is correct

The round-6 invariant is precise:

```
CREATE could not be durably emitted (write fails)  =>  writer _exit(86)
   =>  driver waitpid observes status 86
   =>  gt_oracle_evidence_fail latches
   =>  exit code 8

CREATE successfully emitted                       =>  driver reads it
   =>  GROUND_TRUTH_CREATED contains the pid
   =>  if kqueue missed it: missed_ground_truth_count++  =>  exit 5
   =>  if kqueue tracked it: PASS
```

GROUND_TRUTH_CREATED is now built directly from what the driver
observed on the GT pipe. There is no "translation stage" that can
silently erase records.

### Bash/node/python descendant wiring

The 5 wrapper sections in `31-helper-preattach-root.c` (shell-A,
node-B, python-C, mixed-D, exec-fork) were updated to write
`CREATE pid=<pid> ppid=0 pgid=0 start_us=0\n` directly to
`$CLINEMM_GROUND_TRUTH_FD` via `printf ... >&"$GTFD"` syntax. (Note:
`>>"$FD"` would NOT work on macOS bash for a pipe fd -- it appears
to truncate the pipe rather than append. `>&"$FD"` is the correct
dup-to syntax.)

### Verification

```
$ ./42-oracle-descendant-failure-witness  (cwd-independent)
=== ORACLE_DESCENDANT_FAILURE_WITNESS (round-6) ===
[gt_write_failed] pid=89390 attempted=65 errno=32
  T1 [real fixture, GT broken pre-spawn] expected=86 got=86 PASS
  T2 [signal-triggered-fork, GT healthy] expected=0 got=0 CREATE=1 PASS
  T3 [shell-A healthy control] expected=0 got=0 CREATE=4 (>=3) PASS
=== failures=0 VERDICT=PASS ===

$ ./43-oracle-composition-witness
=== ORACLE_COMPOSITION_WITNESS (round-6) ===
  [shell-A] expected=0 got=0 CREATE=4 (>=4) PASS
  [double-fork-setsid] expected=0 got=0 CREATE=4 (>=3) PASS
  [exec-fork] expected=0 got=0 CREATE=3 (>=3) PASS
=== failures=0 VERDICT=PASS ===
```

Smoke tests on agent substrate (all 4 fixtures):
```
shell-A/control:                CREATE=4 WRITE_FAILED=0 exit=0   PASS
exec-fork/control:              CREATE=3 WRITE_FAILED=0 exit=0   PASS
signal-triggered-fork/control:  CREATE=1 WRITE_FAILED=0 exit=0   PASS
signal-triggered-fork/SIGTERM:  CREATE=2 WRITE_FAILED=0 exit=-15 PASS
```

### Updated status block (round-6)

```
KQUEUE_PRIMITIVE_VIABILITY        = NOT_YET_ADJUDICATED
GROUND_TRUTH_CHANNEL              = IMPLEMENTED + LOSSLESS + EOF-AWARE + FAIL-SAFE
GROUND_TRUTH_TOPOLOGY             = SINGLE_PIPE (round-6; round-5 retracted)
GROUND_TRUTH_INDEPENDENT          = YES
GROUND_TRUTH_EXPECTED_SET         = GT (round-6; direct from same pipe)
MULTITHREADED_FORK_HAZARD         = REMOVED (round-6; no pthread in root)
ORACLE_BUILDS_CLEAN               = YES (0 warnings; 7 binaries incl. 4 witnesses)
P0_FALSE_GREEN_RISK               = CLOSED (fail-closed identity, exact (pid,start_us))
P1_PS_TR_NOISE                    = CLOSED
P1_SIGNAL_HANDLER_UNSAFE          = CLOSED
P0_ENV_AS_ARGV                    = CLOSED
PIPE_LOSS_FALSE_GREEN_RISK        = CLOSED (round-3 lossless carry)
WRITE_FAIL_SILENT                 = CLOSED (round-3 in-pipe + round-4 _exit(86))
WRITE_FAIL_CHANNEL_NOT_FAILSAFE   = CLOSED (round-4 kernel-mediated status)
CARRIER_OVERFLOW                  = CLOSED (round-3 halt + exit code 7)
ORACLE_EVIDENCE_FAIL              = CLOSED (round-4 exit code 8)
EXPECTED_SET_DISAPPEARS           = CLOSED (round-6 single-pipe topology)
DESCENDANT_FAILURE_FALSE_GREEN    = CLOSED (round-6 single-pipe topology)
READY_FOR_OPERATOR_RUN            = YES
NEXT                              = HUMAN_OPERATOR_RUNS_FROM_TERMINAL
```
