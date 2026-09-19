# 73-operator-handoff.md

## Round-2 fixes (since last operator packet)

Three reviewer-flagged issues were closed in this round. They are
called out here so the operator can audit the source if anything
looks surprising.

1. **P0-1 (oracle false-GREEN risk)**: the driver's `tracked_has`
   comparison used to fall through to pid-only when `start_us != 0`
   did not match. That allowed pid-reuse or unrelated pid matches to
   mask a missing identity. Fixed to require EXACT `(pid, start_us)`
   match when `start_us` is known, fail closed otherwise. Pid-only
   fallback is now explicit and is counted separately via
   `ground_truth_created_pid_only_count` so the operator can quantify
   how many cases relied on the weaker rule.

2. **P0-2 (env-as-argv bug)**: the previous `run` helper for the
   termination fixture wrote `CLINEMM_FIXTURE_I_SIGNAL=SIGTERM` as an
   argv element to the driver, which forwarded it as argv to the
   fixture root. `getenv()` saw nothing and the fixture took the
   no-signal branch. Fixed by adding `run_env <label> KEY=VAL -- args...`
   that uses `env KEY=VAL driver args...` so the variable is in the
   environment. **The matrix command below uses the fixed form.**

3. **P1 (oracle contamination by `ps`/`tr`)**: the shell fixtures
   used to spawn `ps -o pgid=` and `tr -d ' '` purely to enrich the
   diagnostic `pgid` field. Each such subprocess is itself a
   descendant that the oracle does NOT announce, weakening the claim
   that `GROUND_TRUTH_CREATED` contains every fixture-created
   process. Fixed: shell-announced records now use `pgid=0` (the
   driver's discrimination is by `(pid, start_us)`, not by pgid).
   No `ps`/`tr` subprocesses remain in any fixture.

4. **P1 (termination-fixture unsafe signal handler)**: the previous
   termination fixture did `fork+setsid+sleep+gt_announce` inside a
   signal handler, which is undefined behaviour for any function
   that allocates, calls `sysctl`, or writes to a pipe. It also
   self-raised SIGTERM, so it proved only "fork after self-triggering
   SIGTERM while kqueue observation exists", not "fork during external
   teardown". Fixed:
     - Renamed to `signal-triggered-fork` (honest semantics).
     - The fixture blocks SIGTERM/SIGINT with `sigprocmask`, then
       waits via `sigwait()` in normal control flow, then forks the
       detached child and announces it BEFORE exiting.
     - SIGKILL mode is documented as unsupported (SIGKILL cannot be
       caught or sigwait()ed).

## Why this packet exists

The ClineMM agent shell is sandboxed by VSCodium Helper (Plugin) and
cannot deliver `SIGCONT` to its own spawned children (EPERM on
`kill(root, SIGCONT)`, including `kill -0`). The kqueue primitive cannot
be exercised from the agent.

This packet contains the **exact commands** the human operator runs from
an unsandboxed Terminal.app. The output is written into the repository's
`.factory/tmp/` so ClineMM can read it back from its sandbox and continue
the adjudication in the same ACT.

## One-time setup

Open Terminal.app (NOT a ClineMM-controlled terminal). Confirm you are NOT
in a VSCodium-descended process tree:

```bash
echo "self=$$ parent=$PPID"
ps -o pid,ppid,command -p $PPID
```

The parent command should NOT include `VSCodium` or `claude-dev`. If it
does, open a fresh Terminal.app window from the Dock.

## Run the matrix

For each fixture, run the driver with the fixture root, redirect both
stdout (JSONL) and stderr (driver progress messages) to a single file,
append the exit code at the end. This is one command per fixture.

P0-2 fix: the operator-handoff `run` function now takes an explicit
"env" form for cases where the fixture is gated by an environment
variable. The original `CLINEMM_FIXTURE_I_SIGNAL=SIGTERM` was being
passed as an argv element to the driver (which forwards it to the
fixture root as argv[...]), NOT as an environment assignment. The
fixed `run_env` helper below correctly puts it into the environment.

```bash
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm

CAP=".factory/tmp/ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01/operator"
mkdir -p "$CAP"

# Standard run: no special env.
run() {
  local label="$1"; shift
  local out="$CAP/$label.jsonl"
  : > "$out"
  tools/macos-host-helper/native/containment-probe/30-helper-preattach-driver \
    "$@" >>"$out" 2>&1
  local rc=$?
  echo "RC=$rc run_start=$(date -u +%FT%TZ)" >>"$out"
  echo "[$label] done; rc=$rc; size=$(wc -c <"$out")"
}

# Env-aware run: takes env assignments as KEY=VAL pairs first, then
# the rest as the command. This is the ONLY safe way to pass
# CLINEMM_FIXTURE_I_SIGNAL to the fixture root.
# Usage: run_env <label> KEY=VAL [KEY=VAL ...] -- <driver-args...>
run_env() {
  local label="$1"; shift
  local out="$CAP/$label.jsonl"
  : > "$out"
  # Collect env assignments (KEY=VAL with no spaces) until we hit "--"
  local -a envs
  while [[ "$1" != "--" ]]; do
    envs+=("$1"); shift
  done
  shift  # consume the "--"
  env "${envs[@]}" \
    tools/macos-host-helper/native/containment-probe/30-helper-preattach-driver \
    "$@" >>"$out" 2>&1
  local rc=$?
  echo "RC=$rc run_start=$(date -u +%FT%TZ) env=${envs[*]}" >>"$out"
  echo "[$label] done; rc=$rc; size=$(wc -c <"$out"); env=${envs[*]}"
}

# Warmup (conservation controls) — should all show missed_ground_truth_count=0
run 71-shell-A        tools/macos-host-helper/native/containment-probe/31-helper-preattach-root --fixture=shell-A --duration=5
run 71-node-B         tools/macos-host-helper/native/containment-probe/31-helper-preattach-root --fixture=node-B  --duration=5
run 71-python-C       tools/macos-host-helper/native/containment-probe/31-helper-preattach-root --fixture=python-C --duration=5
run 71-mixed-D        tools/macos-host-helper/native/containment-probe/31-helper-preattach-root --fixture=mixed-D  --duration=5

# Escape discriminators
run 72-node-escape-E  tools/macos-host-helper/native/containment-probe/31-helper-preattach-root --fixture=node-escape   --duration=5
run 72-python-escape-F tools/macos-host-helper/native/containment-probe/31-helper-preattach-root --fixture=python-escape --duration=5

# NEW fixtures per ACT §13/§14/§15
run 74-double-fork-setsid-G tools/macos-host-helper/native/containment-probe/31-helper-preattach-root --fixture=double-fork-setsid --duration=5
run 75-exec-fork-H          tools/macos-host-helper/native/containment-probe/31-helper-preattach-root --fixture=exec-fork          --duration=5

# P1 termination fixture: renamed to `signal-triggered-fork` (honest
# semantics). CLINEMM_FIXTURE_I_SIGNAL is propagated via env (NOT
# argv). The fixture blocks SIGTERM/SIGINT with sigprocmask, waits via
# sigwait() in normal control flow, then forks a detached child and
# announces it BEFORE exiting. This proves the kqueue primitive
# captures the child even though it is created during teardown.
# Note: the driver's SIGCONT requirement still applies.
run_env 76-signal-triggered-fork-I CLINEMM_FIXTURE_I_SIGNAL=SIGTERM -- \
  tools/macos-host-helper/native/containment-probe/31-helper-preattach-root \
  --fixture=signal-triggered-fork --duration=5

# Fork-storm (immediate-double-fork + 16x storm)
run 77-fork-storm     tools/macos-host-helper/native/containment-probe/32-helper-preattach-emulator 16 5

# Single iteration immediate-double-fork (sanity check)
run 77-double-fork-1  tools/macos-host-helper/native/containment-probe/32-helper-preattach-emulator  1 5

echo "all single-shot runs complete"
ls -la "$CAP"
```

## Race hammer (100 runs)

This loops the fork-storm emulator 100 times. Each run produces a small
JSONL file. ClineMM will then aggregate them.

```bash
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm

CAP=".factory/tmp/ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01/operator"
mkdir -p "$CAP/race"

run_race() {
  local i="$1"
  local out="$CAP/race/run-$i.jsonl"
  : > "$out"
  tools/macos-host-helper/native/containment-probe/30-helper-preattach-driver \
    tools/macos-host-helper/native/containment-probe/32-helper-preattach-emulator \
    16 2 >>"$out" 2>&1
  echo "RC=$?" >>"$out"
}

for i in $(seq 1 100); do
  run_race "$i"
done

echo "race hammer complete"
ls "$CAP/race" | wc -l   # expect 100
```

## Negative controls (independent of the matrix)

Before AND after the matrix, verify the production helper survives:

```bash
# Before:
test -S /Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock \
  && echo "HELPER_SOCK=ALIVE" || echo "HELPER_SOCK=DEAD"
lsof -U /Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock

# Spawn an unrelated control (NOT included in any GT channel)
sleep 600 &
CONTROL_PID=$!
echo "CONTROL_PID=$CONTROL_PID"

# After matrix:
kill -0 "$CONTROL_PID" && echo "CONTROL_SURVIVES=PASS" || echo "CONTROL_SURVIVES=FAIL"
kill "$CONTROL_PID"
test -S /Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock \
  && echo "HELPER_SOCK=ALIVE_AFTER" || echo "HELPER_SOCK=DEAD_AFTER"
```

## What ClineMM will do next

After the operator runs the commands above, ClineMM ingests the JSONL
files from `.factory/tmp/ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-
DISCRIMINATOR01/operator/`. For each fixture it computes:

```
ground_truth_missed_count = |GROUND_TRUTH_CREATED - KQUEUE_TRACKED|
```

by start_us (when present) or pid (fallback). The PASS/REFUTED decision
per ACT §25 is based on:

  - E/F (node-escape, python-escape)              zero misses
  - immediate double-fork                          zero misses
  - fork-storm (single run)                        zero misses
  - double-fork-setsid-G                           zero misses
  - exec-fork-H                                    zero misses
  - signal-triggered-fork-I                        zero misses
  - 100/100 race hammer                            zero misses
  - permanent helper survives                      PASS
  - unrelated control survives                     PASS

If all of the above are GREEN:
  KQUEUE_PRIMITIVE_VIABLE_UNDER_SUSPENDED_HELPER_SPAWN = PASS
  → authorize ACT-CLINEMM-HELPER-SUPERVISED-SPAWN-IMPLEMENTATION01

If ANY descendant is missed:
  HALT_HELPER_SUSPENDED_PREATTACH_KQUEUE_RACE
  → authorize ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01

## What ClineMM will NOT do

- Will NOT modify `apps/`, `sdk/`, `helper.c`, `protocol.ts`, `client.ts`,
  `CommandJobManager`, telemetry, or UI (per ACT §19, §20, §27).
- Will NOT add `signal.cont` to the production helper (per ACT §19).
- Will NOT attempt to run any probe from its sandbox (EPERM is reproduced
  every time; this is the substrate-blocker the operator Terminal
  bypasses).

## Sanity check before running

If you want to confirm Terminal.app is unsandboxed before starting:

```bash
# Should be tiny (the macOS Terminal.app sandbox profile is permissive).
ps -p $$ -o pid,ppid,user,command
# Parent should be /System/Applications/Utilities/Terminal.app or similar
# loginwindow. NOT VSCodium, NOT Claude, NOT codium-clinemm.
```

Then proceed with the matrix commands above.

## Round-3 update: oracle mechanics

The oracle reader (`drain_ground_truth()`) is now LOSSLESS:

- Partial reads are retained across `read()` calls (per Apple `read(2)`).
- The driver's own write end of the GT pipe is closed immediately after
  `posix_spawn()`, so EOF is meaningful when the last fixture writer exits.
- The "best-effort final drain" that previously threw bytes away is removed.
- Carry overflow is a hard halt (exit 7), not a silent drop.
- Fixture `gt_announce()` retries on `EAGAIN`/`EINTR` and surfaces a
  `WRITE_FAILED` line on persistent failure (driver exit 6 if any).

The witness at `40-oracle-lossless-witness` validates this with 7
fragmented records (split across two writes with a 2ms gap) plus one
truncated-at-EOF record and one WRITE_FAILED announcement -- all
captured correctly. Run it from Terminal.app before the matrix if you
want to confirm the oracle mechanics:

```bash
./40-oracle-lossless-witness
# Expect:
#   records_seen=8, gt_with_start_us=7, gt_write_failures=1,
#   gt_reader_fault=0, truncated-at-EOF pid=888 survived, VERDICT=PASS
```

### Driver exit code meanings (round-3)

| Exit | Meaning |
|------|---------|
| 0    | PASS — every GT record was tracked by kqueue, no write failures |
| 5    | REFUTE (MISS) — `missed_ground_truth_count > 0` |
| 6    | REFUTE (ORACLE_WRITE_FAIL) — `ground_truth_write_failures > 0` |
| 7    | REFUTE (ORACLE_READER_FAULT) — `ground_truth_reader_fault > 0` |
| 1-4  | INFRASTRUCTURE ERROR — see halt event |

Exit codes 5/6/7 are all REFUTE modes (operator decision_rule says
PASS only on exit 0 with all gates green).

## Round-4 update: oracle write-side fail-safe

The round-3 in-pipe `WRITE_FAILED` signal uses the same pipe that
just failed. Per Apple pipe(2), if the read end is closed, that
diagnostic itself fails — leaving the driver with neither the CREATE
nor the failure signal. Round-4 makes the fixture's process exit
status the authoritative cross-process-boundary oracle-failure
signal.

### What the operator will see

- Fixture `_exit(86)` immediately on any unrecoverable GT write
  failure (EPIPE, EIO, ENXIO, EBADF, persistent EAGAIN underflow).
- `signal(SIGPIPE, SIG_IGN)` at fixture start so SIGPIPE doesn't kill
  the fixture before `_exit(86)` runs.
- Driver `waitpid(root)`s after the drain and inspects the exit
  status. Status 86 latches `gt_oracle_evidence_fail` (driver exit
  code 8). Signal-induced exit (e.g., signal-triggered-fork SIGTERM
  mode) is NOT latched — that's the contract for that fixture.

### Updated driver exit code table

| Exit | Meaning |
|------|---------|
| 0    | PASS — every GT record was tracked, no write failures |
| 5    | REFUTE (MISS) — `missed_ground_truth_count > 0` |
| 6    | REFUTE (ORACLE_WRITE_FAIL) — `ground_truth_write_failures > 0` (in-pipe WRITE_FAILED line received) |
| 7    | REFUTE (ORACLE_READER_FAULT) — `ground_truth_reader_fault > 0` |
| 8    | REFUTE (ORACLE_EVIDENCE_FAIL) — root exited 86 (kernel-mediated oracle write-side failure) |
| 1-4  | INFRASTRUCTURE ERROR — see halt event |

Exit codes 5/6/7/8 are all REFUTE modes. PASS only on exit 0.

### Witness to verify before the matrix

```bash
./41-oracle-broken-channel-witness
# Expect:
#   T1 broken-pipe (read end closed):  child exit_status=86 signaled=0  PASS
#   T2 broken-pipe diagnostic:        both writes fail with errno=32 (EPIPE)
#   T3 healthy-pipe control:          child exit_status=0  PASS
#   T4 [real fixture, broken GT]:     expected=86 got=86  PASS
#   failures=0 VERDICT=PASS
```

The T4 case `execl()`s the actual `31-helper-preattach-root` binary
with a closed GT read end and observes exit status 86 via `waitpid()`
— this proves the round-4 failsafe is wired into the production
fixture, not just a test mirror.

### PASS criterion (fail-closed)

`result.json.next_step.decision_rule` now requires:

```
ground_truth_oracle_evidence_fail == 0
ground_truth_write_failures == 0
ground_truth_reader_fault == 0
missed_ground_truth_count == 0
driver_exit_code == 0
```

Any single failure ⇒ REFUTE.

## Round-5 update: two-pipe topology (no exit code change)

Round-4 made the GT-pipe write fail-safe via `_exit(86)` on broken
channel. Round-5 refactors the oracle so that ONLY root writes to
GT, eliminating the risk that a single descendant's failed write
takes down an entire healthy fixture run.

### What changed in the oracle

**Two-pipe topology.** The driver now creates two pipes per fixture
run and exposes them to the spawned root via three env vars:

| Env var                      | FD             | Owner          |
|------------------------------|----------------|----------------|
| `CLINEMM_GROUND_TRUTH_FD`    | `gt_write_fd`  | root (writer)  |
| `CLINEMM_GT_DESC_READ_FD`    | `desc_read_fd` | root (reader)  |
| `CLINEMM_DESCENDANT_FD`      | `desc_write_fd`| descendants (writers) |

**Single-writer invariant.** Only the root process writes to the GT
pipe, via `gt_serialize_report()` (mutex-protected). If that write
fails, `_exit(86)` is called and the driver's `waitpid(root)` observes
it. The round-4 exit code 8 semantics are preserved exactly — no
new exit codes are added.

**Descendant report path.** Descendants write
`"pid=<N> start_us=<N>\n"` report lines to the descendant-report
pipe. Root's reader thread (detached `pthread`) drains it, dedupes
by pid (64-entry linear scan), and serializes each unique pid as a
CREATE record to GT. If a descendant write fails (EPIPE on the
descendant pipe), the report is silently dropped; root continues;
the driver detects via `missed_ground_truth_count`.

### Updated driver exit code table (round-5 — unchanged from round-4)

| Exit | Meaning |
|------|---------|
| 0    | PASS — every GT record was tracked, no write failures, no oracle evidence fail |
| 5    | REFUTE (MISS) — `missed_ground_truth_count > 0` |
| 6    | REFUTE (ORACLE_WRITE_FAIL) — `ground_truth_write_failures > 0` (in-pipe WRITE_FAILED line received) |
| 7    | REFUTE (ORACLE_READER_FAULT) — `ground_truth_reader_fault > 0` |
| 8    | REFUTE (ORACLE_EVIDENCE_FAIL) — root exited 86 (kernel-mediated oracle write-side failure) |
| 1-4  | INFRASTRUCTURE ERROR — see halt event |

Exit codes 5/6/7/8 are all REFUTE modes. PASS only on exit 0.

### Witness to verify before the matrix (round-5 addition)

```bash
./42-oracle-descendant-failure-witness
# Expect:
#   T1 [real fixture, GT broken pre-spawn]:        expected=86 got=86  PASS
#   T2 [real fixture, descendant pipe broken pre-spawn]: expected=0 got=0  PASS
#   T3 [healthy two-pipe control]:                  expected=0 got=0  PASS
#   failures=0 VERDICT=PASS
```

T1 confirms that a broken GT pipe still triggers `_exit(86)` (the
round-4 failsafe is preserved). T2 confirms that a broken descendant
pipe does NOT cascade into root `_exit(86)` — root continues and
exits cleanly (the round-5 invariant). T3 is the healthy control.

### Smoke test status (round-5, agent substrate)

```
shell-A/control:                CREATE=4 WRITE_FAILED=0 exit=0   PASS
exec-fork/control:              CREATE=3 WRITE_FAILED=0 exit=0   PASS
signal-triggered-fork/control:  CREATE=1 WRITE_FAILED=0 exit=0   PASS
signal-triggered-fork/SIGTERM:  CREATE=1 WRITE_FAILED=0 exit=-15 PASS
```

All 4 fixtures produce CREATE records, no WRITE_FAILED, exit codes
match expectations. The SIGTERM case exits with -15 because the
fixture's signal handler explicitly raises SIGTERM on itself as the
contract for that fixture (this is NOT an oracle failure — it's the
documented fixture behavior).

### PASS criterion (round-5 — same as round-4)

```
ground_truth_oracle_evidence_fail == 0
ground_truth_write_failures == 0
ground_truth_reader_fault == 0
missed_ground_truth_count == 0
driver_exit_code == 0
```

Any single failure ⇒ REFUTE. The strong-evidence path
(`ground_truth_created_with_start_us_count > 0`) must be exercised;
if the operator run reports ALL pid-only records, the result is
INDETERMINATE.

## Round-6 update: single-pipe topology (round-5 retracted)

Round-5 introduced a two-pipe topology (GT pipe + descendant-report
pipe) with a reader thread in root. The reviewer flagged a P0 in
that design: the expected set (GROUND_TRUTH_CREATED) was derived
from the descendant-report pipe, which was itself a source of loss.
If a report was dropped before becoming a CREATE, the expected set
was missing that pid and the driver could not detect the omission.
This is the textbook false-GREEN hazard. The bounded correction is
to simplify, not add a third channel.

### What changed

**Single-pipe topology.** The driver creates ONE pipe per fixture
run and exposes it via a single env var:

| Env var                      | FD             | Owner          |
|------------------------------|----------------|----------------|
| `CLINEMM_GROUND_TRUTH_FD`    | `gt_write_fd`  | root + every descendant (writers) |

There is no descendant-report pipe, no root reader thread, no
report->CREATE translation. GROUND_TRUTH_CREATED is built directly
from the GT pipe that the driver drains.

**Atomic writes.** Each CREATE record is 75-100 bytes, well below
`PIPE_BUF` (65536 bytes on macOS). POSIX `pipe(2)` guarantees atomic
writes for any payload `<= PIPE_BUF`, so concurrent writers from
different processes serialize at the kernel without interleaving.

**Round-4 failsafe preserved.** On a broken GT pipe
(`EPIPE`/`EIO`/`ENXIO`/`EBADF`), the writer process `_exit(86)`s
immediately. The driver `waitpid(root)` observes status 86 and
latches `gt_oracle_evidence_fail` (exit code 8).

**Multithreaded-fork hazard removed.** No `pthread` exists in root.
This eliminates the Apple `pthread_atfork(3)` warning about
restricted child-side behavior after `fork()` in a multithreaded
process.

### Updated driver exit code table (round-6 — unchanged from round-4)

| Exit | Meaning |
|------|---------|
| 0    | PASS — every GT record was tracked, no write failures, no oracle evidence fail |
| 5    | REFUTE (MISS) — `missed_ground_truth_count > 0` |
| 6    | REFUTE (ORACLE_WRITE_FAIL) — `ground_truth_write_failures > 0` (in-pipe WRITE_FAILED line received) |
| 7    | REFUTE (ORACLE_READER_FAULT) — `ground_truth_reader_fault > 0` |
| 8    | REFUTE (ORACLE_EVIDENCE_FAIL) — root exited 86 (kernel-mediated oracle write-side failure) |
| 1-4  | INFRASTRUCTURE ERROR — see halt event |

Exit codes 5/6/7/8 are all REFUTE modes. PASS only on exit 0.

### Witnesses to verify before the matrix (round-6)

```bash
./40-oracle-lossless-witness
./41-oracle-broken-channel-witness
./42-oracle-descendant-failure-witness
./43-oracle-composition-witness
```

42-witness confirms (round-6):
- T1 GT broken pre-spawn -> exit 86 (round-4 failsafe preserved).
- T2 signal-triggered-fork healthy -> exit 0 with C-side CREATE.
- T3 shell-A healthy -> exit 0 with all CREATEs.

43-witness confirms (round-6 composition):
- shell-A: 4 CREATEs (root + bash + 2 sleep grandchildren).
- double-fork-setsid: 4 CREATEs (root + child1 + grandchild + child1's re-announce of grandchild).
- exec-fork: 3 CREATEs (root + bash + setsid grandchild).

### Smoke test status (round-6, agent substrate)

```
shell-A/control:                CREATE=4 WRITE_FAILED=0 exit=0   PASS
exec-fork/control:              CREATE=3 WRITE_FAILED=0 exit=0   PASS
signal-triggered-fork/control:  CREATE=1 WRITE_FAILED=0 exit=0   PASS
signal-triggered-fork/SIGTERM:  CREATE=2 WRITE_FAILED=0 exit=-15 PASS
```

### PASS criterion (round-6 — same as round-4)

```
ground_truth_oracle_evidence_fail == 0
ground_truth_write_failures == 0
ground_truth_reader_fault == 0
missed_ground_truth_count == 0
driver_exit_code == 0
```

Any single failure ⇒ REFUTE. The strong-evidence path
(`ground_truth_created_with_start_us_count > 0`) must be exercised;
if the operator run reports ALL pid-only records, the result is
INDETERMINATE.

## Round-7 update: bounded executable witness for the MISS = GT - KQUEUE discriminator

Reviewer observed that 43-witness verifies the ORACLE OUTPUT
(MULTILEVEL_GT_RECORD_DELIVERY) but does not exercise the load-bearing
discriminator MISSED = GT - KQUEUE_TRACKED. The actual classifier
lived inline inside 30-helper-preattach-driver.c, so the witness
couldn't compile against it without forking the algorithm.

### What changed

**Shared header.** The pure miss classifier (gt_record_t,
pid_start_t, miss_classify() static inline) was extracted into
`tools/macos-host-helper/native/containment-probe/miss-classifier.h`.
Both the production driver (30-) and the new witness (44-) compile
against this header. The driver's local `tracked_has()` and the loop
body of `compute_missed()` were deleted; `compute_missed()` is now a
6-line wrapper that calls `miss_classify()`.

### Witnesses to verify before the matrix (round-7 — supersedes the round-6 list)

```bash
./40-oracle-lossless-witness           # round-3, lossless reader
./41-oracle-broken-channel-witness     # round-4, broken channel failsafe
./42-oracle-descendant-failure-witness # round-6, descendant isolation
./43-oracle-composition-witness        # round-6, multilevel GT delivery
./44-oracle-miss-classifier-witness    # round-7 NEW, MISS discriminator
```

44-witness exercises the actual production classifier (no algorithm
fork) with 5 cases including the root→child→grandchild scenario
the reviewer asked for: GT has all three, KQUEUE deliberately omits
the grandchild, expected missed_count=1 with pid=102 and
start_us=1200. Driver disposition = exit 5 (REFUTE / MISS).

### Smoke test status (round-7, agent substrate)

```
shell-A/control:                CREATE=4 WRITE_FAILED=0 exit=0   PASS
exec-fork/control:              CREATE=3 WRITE_FAILED=0 exit=0   PASS
signal-triggered-fork/control:  CREATE=1 WRITE_FAILED=0 exit=0   PASS
signal-triggered-fork/SIGTERM:  CREATE=2 WRITE_FAILED=0 exit=-15 PASS
```

### Updated gate list (round-7)

```
SINGLE_PIPE_TOPOLOGY             = PASS  (round-6)
LOSSLESS_READER                  = PASS  (round-3)
ATOMIC_RECORD_WRITES             = PASS  (round-6; PIPE_BUF floor asserted at startup)
MULTILEVEL_GT_DELIVERY           = PASS  (round-6 43-witness)
GT_MINUS_TRACKED_DISCRIMINATOR   = PASS  (round-7 44-witness)
READY_FOR_OPERATOR_RUN           = YES
```

### PASS criterion (round-7 — same as round-4)

```
ground_truth_oracle_evidence_fail == 0
ground_truth_write_failures == 0
ground_truth_reader_fault == 0
missed_ground_truth_count == 0
driver_exit_code == 0
```

Any single failure => REFUTE. The strong-evidence path
(`ground_truth_created_with_start_us_count > 0`) must be exercised;
if the operator run reports ALL pid-only records, the result is
INDETERMINATE.
