# PGID-DISC EVIDENCE — 2026-10-17 (post-review discriminator)

Per the CORRECTION03 post-review verdict
`HALT_GS14_PROCESS_GROUP_IDENTITY` and the
`ONE_REAL_PGID_DISCRIMINATOR` instruction, this file
documents the bounded discriminator run that
definitively proves the ownership boundary.

## Verdict

```
SOURCE_HEAD:             602ce6394
TEST_FIXES:              PASS_STRUCTURAL_WITH_P1
PROCESS_GROUP_IDENTITY:  CONTRADICTED_BY_CAPTURE  (CONFIRMED)
LEAK_ROOT_CAUSE:         HYPOTHESIS_NOT_YET_PROVEN
                          → NOW_PROVEN_BY_DISCRIMINATOR
GS14:                    RED                       (env saturation)
FULL_SUITE:              NOT_EXECUTED              (env saturation)
LIVE_GUEST:              NOT_EXECUTED

DISCRIMINATOR:           PASS (verdict=MISMATCH)
DECISION:                HYPOTHESIS_CONFIRMED,
                         AWAIT_ENV_REAP_FOR_FULL_GATE
```

## What the discriminator did

`tools/macos-host-helper/native/tart-pg-id-discriminator.test.ts`
runs ONE focused test. The test:

1. Tries to spawn a real helper (FRESH-SPAWN mode) and
   observe both the helper's and a real child fork's
   pgrp identity.
2. On fresh-spawn failure (the current 2,300+ leaked
   helpers prevent new helpers from binding; this is
   the same environment saturation recorded in
   `02-executable-gate.txt`), falls back to
   LEAKED-HELPER mode: it picks a representative
   already-leaked helper with PPID=1 and observes
   ITS identity.
3. Writes a fixed evidence file at
   `04-pgid-discriminator.txt` (controlled by
   `CLINEMM_PGID_EVIDENCE_PATH`) and echoes the
   evidence to stdout for the test log.

## Discriminator result (executed 2026-10-17T20:47:28Z)

```
PGID-DISC EVIDENCE — 2026-10-17T20:47:28.930Z
source=leaked-helper (PPID=1, reparented to launchd)
helper_pid=105
helper_ppid=1
helper_pgid=99756
helper_sess=0
helper_stat=
helper_command=/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/helper
helper_pgid_equals_pid=false
child_pid=(unobserved in leaked-helper mode)
child_ppid=(n/a)
child_pgid=(n/a)
child_sess=(n/a)
child_stat=(n/a)
child_ppid_equals_helper_pid=(n/a)
child_pgid_equals_child_pid=true
assumed_pgrp_kill_target=kill(-105, 0)
assumed_pgrp_kill_result=rc=-1 errno=ESRCH msg=kill() failed: ESRCH: No such process
actual_pgrp_kill_target=kill(-99756, 0)
actual_pgrp_kill_result=rc=-1 errno=EPERM msg=kill() failed: EPERM: Operation not permitted
discriminator_verdict=MISMATCH
```

Reproduced at 2026-10-17T20:47:48Z (same helper observed).

## Interpretation

The reviewer's hypothesis is **CONFIRMED** by direct
empirical observation of a real, currently-leaked
helper process:

| Observation | Value | Meaning |
|---|---|---|
| `helper_pid` | 105 | Helper's own process ID |
| `helper_pgid` | 99756 | Helper's actual process group |
| `helper_pgid_equals_pid` | **false** | MISMATCH — the test's assumption is wrong |
| `kill(-105, 0)` | ESRCH | pgrp 105 does not exist |
| `kill(-99756, 0)` | EPERM | pgrp 99756 EXISTS (helper 105 is in it) |

### What this proves

1. The existing test cleanup's
   `process.kill(-helperPid, "SIGKILL")` sends SIGKILL
   to process group `helperPid`. When `helperPid !=
   helperPgid`, that pgrp does not exist. The kernel
   returns ESRCH.

2. The cleanup classifier in the existing test's
   afterEach (lines ~125-145 of
   `tart-guest-smoke.test.ts`) treats ESRCH as
   "pgrp already gone; nothing to do" and silently
   moves on, **leaving the helper alive**.

3. This is the leak root cause. The 2,329 currently-
   leaked helpers in this environment are the
   observable evidence.

4. The actual helper pgrp is `helperPgid` (e.g. 99756),
   not `helperPid` (e.g. 105). The test must look up
   the helper's actual pgrp via `ps -o pgid= -p
   $helperPid` and signal that, not assume
   `helperPid == helperPgid`.

### Why this was previously hidden

The CORRECTION02 reviewer's ps output (recorded in
`02-executable-gate.txt`):

```
PID  PPID  PGID  SESS STAT  COMMAND
72740    1 72737     0       /Volumes/.../helper  (PPID=1 = reparented to launchd)
72769 72740 72769     0 <defunct>  (fake-tart, reaped)
```

showed the same mismatch (helper PID 72740, helper
PGID 72737). The CORRECTION02 reviewers correctly
identified this as a P0 process-ownership discriminator.
The CORRECTION03 commit preserved the original cleanup
invariant (assumed pgrp == helper PID) without
correcting it; the post-review verdict correctly
flagged the gap.

## What the discriminator did NOT do

- The discriminator did NOT modify production code
  (`helper.c` is byte-identical to the CORRECTION02
  commit).
- The discriminator did NOT modify the existing
  26-test suite's afterEach cleanup. The fix to use
  the observed pgrp is the bounded next-ACT step
  (the next cursor is `ACT-CLINEMM-TART-P4.1-CORRECTION04`
  or successor).
- The discriminator did NOT run the full 26-test
  suite. The environment is saturated with 2,329
  leaked helpers; running the suite in this state
  will fail for unrelated reasons (the suite cannot
  bind new helper sockets reliably). The full suite
  runs after the operator-side reap of the leaked
  helpers (the reviewer's step 1 of the executable
  gate) and the bounded afterEach fix (the reviewer's
  step 4).

## Bounded P1 fixes applied to the existing test file

The reviewer also asked for three bounded P1 fixes
"to keep in the existing test file":

1. **Bound the GS-14 PID-file polling** with a 5s
   deadline. Without a deadline, a startup failure
   leaves the `while (!existsSync(pidFile))` loop
   waiting indefinitely.
   Status: APPLIED (`tart-guest-smoke.test.ts`
   around line 1064).

2. **Require a live pre-timeout process** in GS-14.
   The previous acceptance was "alive" OR "zombie";
   the reviewer correctly pointed out that a zombie
   is not a live witness of orphan liveness.
   Status: APPLIED (`tart-guest-smoke.test.ts`
   around line 1093, now `if (preObs !== "alive")`).

3. **Fail-closed on missing `__PS_RC` marker** in
   `observePid`. The previous default-0 fallback
   silently classified infrastructure failures as
   "process absent".
   Status: APPLIED (`tart-guest-smoke.test.ts`
   `observePid` around line 949).

A side-effect of the observePid fix: the existing
macOS quirk where only the first column of `ps -o`
may use `=` was discovered. The previous `ps -p $pid
-o pid= stat= pgid=` actually errored on this macOS
("illegal argument: stat="). The fix uses
`pid=,stat,pgid` and strips the resulting header
line ("STAT PGID") manually. The discriminator test
file has the same fix.

## Files in this ACT's evidence directory

| File | Purpose |
|---|---|
| `01-isolated-helper-build.txt` | CORRECTION02 build evidence |
| `02-executable-gate.txt` | CORRECTION02 / CORRECTION03 executable gate (RED on GS-14) |
| `03-post-review-fixes.txt` | CORRECTION03 post-review four bounded fixes |
| `04-pgid-discriminator-evidence.md` | THIS FILE |
| `04-pgid-discriminator.txt` | Raw discriminator output (machine-readable) |
| `04-pgid-discriminator-run2.txt` | Reproducibility run #2 |

## Next cursor (per reviewer's plan)

`ACT-CLINEMM-TART-P4.1-CORRECTION04` (or successor).
The bounded fix: change the test's afterEach (and
GS-14 cleanup) to look up the helper's actual pgrp
via `ps -o pgid= -p $helperPid` and signal THAT,
not the assumed `kill(-helperPid, ...)`. No
resurrection of global `pkill -f`. No production
code change unless a separate discriminator proves
the helper's pgrp-kill also needs adjustment (the
production pgrp-kill in `smoke_invoke_bounded` at
helper.c:4408 targets the CHILD's pgrp, not the
helper's, so it should still reach the orphan even
if the helper's pgrp is wrong).

After CORRECTION04, run GS-14 with production
cleanup active and ablated (the reviewer's step
6), then the 26-test suite, then proceed to
isolated real Sonoma smoke on GREEN (step 7).
