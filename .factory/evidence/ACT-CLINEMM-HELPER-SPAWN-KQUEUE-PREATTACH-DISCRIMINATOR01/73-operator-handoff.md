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
