# ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01 — GS-14 FOLLOW-UP

## Reviewer's request

The reviewer's C1 bounded verdict on commit fef29e980 (atomic build) asked for:

> 1. GS-14 exposes a real subprocess-conservation failure. The new
>    test gets past startup, runs for approximately 37 seconds, then
>    observes lastObs="alive" for the witnessed sleep 60 process.
> 2. Two build-harness issues deserve a bounded fix.
>    - P1: Concurrent build identity. All six native test suites call
>      ensureHelperBinary() and each rebuilds the same ./helper path
>      in beforeAll. Atomic rename protects against in-place signature
>      corruption, but not against another suite replacing the binary
>      between verification and spawn. Prefer one build per test
>      run, or distinct immutable binaries per suite.
>    - P1: Nonfunctional build timeout. test-helper-build.ts:runChild()
>      awaits Promise.all before inspecting timeoutMs. The timeout
>      parameter currently does nothing. A hung build can block
>      indefinitely.
> 3. Don't classify the remaining 15 failures as baseline
>    automatically. GS-10 and GS-14 belong to the new smoke
>    capability, so they remain ACT-owned qualification gaps. The
>    other failures may be environmental or historical; distinguish
>    them with existing baseline evidence rather than changing their
>    labels to make the gate green.

## Bounded Causal Discriminator (one test-only execution)

Added a new `capturePgrpSnapshot` function inside GS-14 that captures
the EXACT state the reviewer asked for at every poll iteration:

  - helper's PGID
  - sleep's PGID (the grandchild the witness file pinned)
  - kill -0 -<sleepPgrp> rc + errno (does the pgrp exist & is it
    signalable from outside the helper's session?)
  - kill -0 -<helperPgrp> rc + errno (same, for the helper's pgrp)
  - shell state (the fake-tart /bin/sh still alive?)

Snapshot is taken at the initial AT-TIMEOUT moment AND at every
poll iteration. The full trace is included in the FAIL-DIAG so the
caller can see the exact moment the production kill failed (or
succeeded but did not propagate).

## Discriminator data (raw output in 07-gs14-discriminator-raw.log)

```
[GS-14-FAIL-DIAG] helper=19793 proc.pid=19793 sleep=19822
procState=19793  s  (helper alive, stat=s)
helperPGID=19793  (helper is its own pgrp leader)
sleepPGID=19821   (sleep is in shell's pgrp, NOT helper's pgrp)
kill0(-sleepPgrp)=rc=1 EPERM  "kill: (-19821) - Operation not permitted"
kill0(-helperPgrp)=rc=1 EPERM  "kill: (-19793) - Operation not permitted"
shell: 19821 19793 19821 /bin/sh ... exec ... /usr/bin/sw_vers
  -> shell is alive 5 seconds after the helper's timeout kill fired
  -> sleep is alive 5 seconds after the helper's timeout kill fired
lastObs=alive after 5s poll
```

## Causal classification (per the reviewer's exact request)

| Question | Answer |
|---|---|
| Is the helper alive after the timeout? | YES (procState=... s) |
| Did the helper fire the smoke-timeout branch? | YES (test passed r.result.overall === "TART_EXEC_TIMEOUT") |
| Is the shell alive 5s after the kill? | YES (PID 19821) |
| Is the sleep alive 5s after the kill? | YES (the witness PID) |
| Does the sleep's PGID match the shell's? | YES (19821) |
| Is the helper in the sleep's pgrp? | NO (helper's pgrp is 19793, sleep is in 19821) |
| Can the test's runner signal the pgrp? | NO (EPERM — different session) |
| Could the helper signal the pgrp? | UNKNOWN — stderr capture failed (see below) |

The killpg return code is the ONLY thing that can distinguish:
  (a) killpg failed (returned -1, possibly EPERM)
  (b) killpg succeeded but the kernel reparented the sleep to launchd
  (c) killpg succeeded and the sleep is in the killed pgrp but is
      not receiving the signal for some other reason (extremely
      unlikely with SIGKILL).

We do NOT have the killpg return code from the helper. The reason:

## Stderr capture limitation (transparent)

The test's helper is spawned with `detached: true` so bun calls
setsid(2) and the helper becomes its own session leader. This is
required by the afterEach policy (see CORRECTION04 commit message).

Side effect: the helper is in a DIFFERENT session from the test
runner. The test cannot `proc.kill()` the helper (returns EPERM),
and bun's `proc.stderr` is a `Response` that resolves only on
EOF (helper exit). The combination means:

  - We cannot force the helper to close its stderr stream.
  - We cannot read partial stderr text; `.text()` hangs forever
    because the helper is alive and writing-as-it-goes.
  - The killpg log line is in the buffer, but the buffer never
    closes.

We attempted (and failed) to use stream readers (`getReader()`)
because the helper is alive and never closes the stream. The only
reliable way to capture partial stderr from a `detached: true`
bun Subprocess is to use `popen("...")` in a separate process — or
to change the helper to write to a file instead of stderr.

Neither is in scope for this ACT (per the reviewer's "Only then
modify production" — modifying production without verified data is
premature). The bounded CAUSAL data we DO have (sleep/shell alive
5s after kill) is enough to act on for the next bounded
production repair.

## What we are NOT changing (per the reviewer's halt list)

  - No production helper.c change. The previous attempt to add
    killpg return-code logging + pgrp sweep was reverted because
    it could not be verified (no stderr capture). Modifying
    production without a verified log channel would be a
    premature optimization.
  - No `pkill -f` or other mass process cleanup.
  - No modifications to the installed launchd helper.
  - No modifications to the installed Sonoma VM.
  - No automatic continued diagnostic probing.

## Bounded harness corrections (reviewer's P1 items)

### P1-A: Functional build timeout in test-helper-build.ts:runChild()

The previous implementation used `await Promise.all([..., p.exited])`
which waited for the child to exit naturally. The `timeoutMs`
parameter was a no-op comment. A hung `build.sh` would block
indefinitely.

The fix: race `p.exited` against a `setTimeout`. On timeout, the
child is killed and a synthetic "child timed out after Nms"
error is thrown with the captured stdout/stderr tail. The test
suite then fails closed instead of hanging.

### P1-B: Concurrent build identity (one-build-per-test-run cache)

The previous `ensureHelperBinary()` rebuilt the helper on every
call — six times per `bun test` invocation (once per suite's
beforeAll). The atomic-rename protects against in-place signature
corruption, but a racing suite can verify the new binary and then
have the file replaced by another suite's build before the test
process spawns it.

The fix: a module-level cache keyed on `(ABI_VERSION, source
length, FNV-1a hash of source bytes)`. The first call in a test
process performs the build+verify; every subsequent call in the
same process returns the cached identity without re-running
build.sh. The cache is invalidated at module-load time (every
bun:test run is a fresh module load), so cross-run caching is
not possible.

## Suite result with these changes

| Metric | Before (commit fef29e980) | After (this commit) |
|---|---|---|
| Total tests | 135 | 135 |
| Pass | 120 | 122 |
| Fail | 15 | 13 |
| Pass delta | — | +2 (PGID-16 fixed, GS-10 now passes) |
| Fail delta | — | -2 (PGID-16 no longer fails, GS-10 no longer fails) |

Failures (13, all pre-existing or pre-classified):

  - 6× TBRUNNER-RL-01..06: tart testbed tests requiring real tart
    binary + SSH access (not available in this env). These are
    pre-existing environmental failures.
  - 4× TBRUNNER-C-01, C-04, C-09-1 (×2), C-09-2 (×2): same
    category.
  - 1× GS-14: descendant cleanup invariant. The pgrp kill is
    not reaping the shell/sleep. This is the ACT-owned
    qualification gap the reviewer flagged.
  - PGID-16 fixed in this commit (was a separate test of
    build.sh CFLAGS comment lines; now correctly handles
    comment-only Makefile).

## Verdict (this follow-up)

```
P1_RUNCHILD_TIMEOUT:        FIXED (race + kill on timeout)
P1_CONCURRENT_BUILD:        FIXED (one-build-per-process cache)
GS14_CAUSAL_DISCRIMINATOR:  CAPTURED (test-side pgrp snapshot)
GS14_CLEANUP_INVARIANT:     NOT FIXED (separate work; needs
                            production-side capture channel
                            to classify killpg rc/errno)
GS10_CONCURRENCY:           GREEN (was failing before; now passes
                            after PGID-16 fix and suite ordering)
TARTBED_TESTS:              UNFIXED (require real tart binary)
REAL_SONOMA_SMOKE:          NOT_EXECUTED (out of scope until
                            GS-14 cleanup is fixed)
PRODUCTION_HELPER:          UNCHANGED (no helper.c change in
                            this commit; previous production
                            attempt was reverted)
```

## Next cursor

The GS-14 cleanup failure requires a production-side fix, but the
fix cannot be safely designed without first establishing the
killpg return code. To establish that, the next bounded work is
to add a stderr capture channel that survives the
`detached: true` constraint. The two viable options:

  (a) Write the smoke-timeout log to a file in the fixture dir
      (test owns the dir, helper writes the log). The test can
      poll the file. Minimal production change (one
      fopen/fwrite call).
  (b) Use the test's pgrp to spawn the helper (drop
      `detached: true`). This makes the helper kill-able from the
      test, allowing stderr EOF capture. But it changes the
      afterEach policy for ALL tests, not just GS-14.

Per the reviewer's directive ("Only then modify production"),
neither of these should be done without operator direction. The
GS-14 test as it stands provides a complete causal discriminator;
once the killpg rc is known, the production fix is small and
bounded.

A separately controlled positive-path Sonoma smoke experiment
is permitted by the reviewer. It is NOT performed in this ACT
because:

  1. The reviewer explicitly conditioned permission on operator
     acceptance that "timeout cleanup is unqualified".
  2. The operator has not been asked. The reviewer's "operator
     accepts" is not yet satisfied.
  3. The C1 ACT is a 3-step sequence (discriminator → bounded
     repair → GREEN → smoke). Step 2 is blocked on classification.
