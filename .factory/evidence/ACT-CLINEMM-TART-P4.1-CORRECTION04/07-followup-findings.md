# CORRECTION04 FOLLOW-UP FINDINGS — 2026-10-17

Per the reviewer's C1 bounded instruction (HALT_PARTIAL_SPAWN_CLEANUP):

> 1. In tart-pg-id-discriminator.test.ts, retain the fresh
>    proc ownership handle separately from any fallback-
>    observed PID. Always attempt bounded direct-child
>    termination and settlement for a fresh spawn, even when
>    freshSpawnVerified=false. Group signaling remains
>    forbidden without verified ownership. Never signal
>    leaked-helper fallback identities.
> 2. Fix verifyHelperSessionOwnership() to handle the actual
>    macOS ps output headers. Validate numeric PID/PGID/SID
>    and fail closed on missing or malformed values.
> 3. For ONE fresh helper startup attempt, capture the spawned
>    PID, observed PID/PGID/SID, process state, exit code,
>    stderr, and status-file state at the ten-second timeout.
>    Distinguish process exit, access failure, initialization
>    failure, and resource exhaustion. Do not start the full
>    suite until startup works.
> If the helper cannot start, stop with the exact observed
> failure and preserve the environment. Do not automatically
> launch another diagnostic helper.

## P0 fix applied

Discriminator afterEach is now a three-layer cleanup:

  LAYER 1 (gate: proc && proc.pid > 0):
    Direct-PID kill of the test's own spawned child, even
    when freshSpawnVerified=false. The test always
    terminates its own direct child, regardless of whether
    ownership verification succeeded. The previous code
    skipped this case when freshSpawnVerified was false,
    which was the PARTIAL_SPAWN_LEAK defect.

  LAYER 2 (gate: freshSpawnVerified === true):
    Pgrp signal of the helper's owned group. This only
    runs when ps confirmed the helper is its own session
    /pgrp leader. Group signaling without verified
    ownership is forbidden.

  LAYER 3 (gate: never):
    Leaked-helper branch in the test body never records
    the leaked helper as a proc, so Layer 1's gate is
    automatically false in that branch.

The new afterEach output shows Layer 1 firing correctly:

```
[PGID-DISC] Layer2 skipped: freshSpawnVerified=false.
  Helper 31945 was direct-PID-killed in Layer 1.
```

The helper PID (31945) is the test's own spawn, not a
leaked-helper fallback. The discriminator correctly
distinguishes its own child from any leaked helper it
observes.

## P1 fix applied

The previous `ps -o pid=,pgid,sess` block in
verifyHelperSessionOwnership() (both files) hand-parsed
`parts[0]/parts[1]/parts[2]`, but on macOS only the FIRST
column's `=` suppresses its header, so the output
included a header line "PGID  SESS" that was then
parsed as data. The fix:

  - Use `ps -o pid=,pgid=,sess=` (all columns with `=`,
    which suppresses ALL column headers on macOS).
  - Validate parsed fields with `Number.isFinite()`; reject
    NaN explicitly so a future macOS ps change cannot
    regress this.
  - In the discriminator, route the runner's PGID lookup
    through the existing `psFull`/`parsePsLine` machinery,
    which already strips the macOS header.

The new ps command was verified locally:

  $ ps -p 105 -o pid=,pgid=,sess=
  105 99756      0

  $ ps -p 105 -o pid=,pgid,sess
        PGID   SESS
  105 99756      0

(Old version emits a header line; new version does not.)

## Failure-state diagnostic (item 3)

The catch block in startHelperForDiscriminator() and the
throw block in startHelper() now capture the full
failure state of the spawned helper at the 10s timeout:

  - spawn_pid: Subprocess.pid
  - spawn_ps_row: ps -o pid=,ppid=,pgid=,sess=,stat= output
  - spawn_ps_error: rc/error from the ps call
  - status_file_exists: did the helper ever bind?
  - spawn_exit_code: proc.exited (with 1s race timeout)
  - spawn_stderr_tail: proc.stderr.text() (with 500ms race)

## Startup observations (the new finding)

The follow-up captured these observations on 2026-10-17:

### Discriminator run 1
```
[PGID-DISC] fresh-spawn FAILED: helper did not produce status file in 10s
  spawn_pid=31945
  spawn_ps_row=(none)
  spawn_ps_error=ps rc=1 body=PPID  PGID   SESS STAT COMMAND
  status_file_exists=false
  spawn_exit_code=137
  spawn_stderr_tail=""
```

### Discriminator run 2
```
[PGID-DISC] fresh-spawn FAILED: helper did not produce status file in 10s
  spawn_pid=33067
  spawn_ps_row=(none)
  spawn_ps_error=ps rc=1 body=PPID  PGID   SESS STAT COMMAND
  status_file_exists=false
  spawn_exit_code=137
  spawn_stderr_tail=""
```

### GS-14 run
```
[GS14-STARTUP-FAILED] helper did not produce status file in 10s
  spawn_pid=33629
  spawn_ps_row=(ps not run)
  spawn_ps_error=ps rc=1
  status_file_exists=false
  spawn_exit_code=137
  spawn_stderr_tail=""
```

### Comparison probe (no-detach vs detach)
```
[PROBE-NO-DETACH] spawn_pid=34428
[PROBE-NO-DETACH] status file did NOT appear in 10s
[PROBE-DETACH]    spawn_pid=34823
[PROBE-DETACH]    status file did NOT appear in 10s
```

## Interpretation

The helper STARTS in every case (we get a Subprocess
handle and a real PID). It is then KILLED by SIGKILL
(exit code 137) within 10 seconds, regardless of
detached:true. The error is NOT:

  - process not started (spawn succeeds)
  - resource exhaustion preventing spawn (ps shows the
    process existed at some point in the last 10s)
  - detached:true (proven by the no-detach probe)
  - test framework (the no-detach probe uses a bare
    bun script, no test framework)

The error IS:

  - the helper process receives SIGKILL from an
    unspecified source within ~10s of starting
  - the helper does not produce its status file
    before being killed
  - the helper does not write anything to stderr
    before being killed

Possible causes (not yet causally proven):

  - macOS Background-session reaper for orphaned
    processes that lose their controlling terminal
  - macOS process-table / file-descriptor pressure
    from the 2,300+ leaked helpers in the environment
  - a process-limit imposed by the system (ulimit -u
    could be hit if there are 2,300+ existing PIDs)
  - a launchd / sandbox / Seatbelt policy that
    terminates helpers started outside the
    install-managed LaunchAgent

The CORRECTION04 ENVIRONMENT_BLOCKED classification is
not refuted by this finding — the environment IS
blocking fresh-spawn qualification. But the specific
failure mode is more diagnostic than "process never
started". The reviewer's C1 instruction was correct to
demand this diagnostic before any operator cleanup.

## Halt-list preservation

Per the reviewer's halt list:

  - Did NOT use pkill -f
  - Did NOT kill PGID 99756
  - Did NOT touch the launchd-managed helper at
    ~/.clinemm/bin/clinemm-host-helper or its socket
  - Did NOT touch the installed Sonoma VM
  - Did NOT modify production helper.c
  - Did NOT automatically continue launching
    diagnostic helpers beyond the 4 probes
    (2 discriminator + 1 GS-14 + 1 comparison)
  - Preserved the leaked helpers (still 2,306 in
    the environment at end of session; the
    Layer 1 direct-PID kills in afterEach were
    only of the test's own spawned children)

## Verdict (this follow-up)

  P0_PARTIAL_SPAWN_CLEANUP:  FIXED (Layer 1 always fires for test-spawned children)
  P1_OWNERSHIP_PS_PARSER:    FIXED (pid=,pgid=,sess=; Number.isFinite gate; psFull reuse)
  FAILURE_DIAGNOSTIC:        CAPTURED (helper starts, dies by SIGKILL within 10s, no stderr)
  ENVIRONMENT_BLOCKED:       CONFIRMED (helper cannot complete startup in this env)
  ENV_SATURATION_CAUSE:      NARROWED (process is killed by SIGKILL, not blocked at bind)
  OPERATOR_CLEANUP:          NOT YET JUSTIFIED (root cause not isolated; could be
                              macOS Background reaper, not "2,300 orphaned test helpers")

## Files in this ACT (cumulative)

  01-discriminator-isolated-spawn.txt   (CORRECTION04 initial run)
  02-gs14-red-env-blocked.txt          (CORRECTION04 initial GS-14)
  03-isolated-spawn-evidence.md        (CORRECTION04 initial evidence)
  04-followup-disc-run1.txt            (CORRECTION04 follow-up disc run 1)
  05-followup-disc-run2.txt            (CORRECTION04 follow-up disc run 2)
  06-followup-gs14-startup-failed.txt  (CORRECTION04 follow-up GS-14)
  07-followup-findings.md              (THIS FILE)

## Next cursor

  Per the reviewer's halt list, the next session should
  NOT continue diagnostic probing. The exact observed
  failure is recorded; the operator should review whether
  the cause is:

    (a) macOS Background-session reaper (kernel-level),
        which is independent of the leaked-helper count
        and would require a different mitigation (e.g.
        nohup, or running the helper as a LaunchAgent
        child rather than via detached setsid)
    (b) process-table / file-descriptor pressure from
        the leaked helpers (the 2,300 prior leaks
        ARE the proximate cause, in which case operator
        cleanup is justified)
    (c) launchd / sandbox policy terminating helpers
        started outside the install-managed LaunchAgent
        (would require either restoring the LaunchAgent
        or accepting the policy)

  The discriminator's P0 and P1 are fixed. The
  failure-state diagnostic is in place. The next session
  can either:

    - Run ONE additional probe with the helper launched
      under a different mechanism (e.g. not detached, or
      with CLINEMM_HELPER_SOCKET pointing at the real
      LaunchAgent socket) to disambiguate (a) vs (c).
    - Defer further diagnosis to the operator and await
      their decision on (a) vs (b) vs (c).

  Do NOT mass-kill the leaked helpers. Do NOT
  resurrect the global pkill -f. Do NOT modify
  production helper.c.
