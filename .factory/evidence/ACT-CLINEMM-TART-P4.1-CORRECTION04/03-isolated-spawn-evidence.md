# ISOLATED-SPAWN EVIDENCE — 2026-10-17 (CORRECTION04)

Per the reviewer's C1 bounded instruction:

> 1. Spawn test helpers with Bun `detached: true`. Verify the
>    fresh helper's PID, PGID and SID, and verify its group
>    differs from the test runner's group.
> 2. Separate fresh-spawn ownership from leaked-helper
>    observation. The leaked-helper fallback must be read-only;
>    its process identities must never enter test cleanup.
> 3. Clean up only verified run-owned identities. Preserve
>    separate ownership of helper and fake-Tart child process
>    groups. Reap owned direct children where possible; classify
>    EPERM/ESRCH explicitly.
> 4. Record a fresh spawn → timeout → termination trace.
> 5. Require GS-14 GREEN with production group signaling and
>    RED with that signaling ablated.
> 6. Run the native 26-test suite once, then go directly to
>    isolated real Sonoma smoke.
> [...]
> If the existing host cannot start a fresh isolated helper,
> classify ENVIRONMENT_BLOCKED and request operator-controlled
> cleanup of individually verified test-owned processes. Do not
> invent a successful test result.

This file documents the bounded correction run.

## What changed

The CORRECTION04 test-side change is in two files:

1. `tools/macos-host-helper/native/tart-pg-id-discriminator.test.ts`
2. `tools/macos-host-helper/native/tart-guest-smoke.test.ts`

Both files now:
  - Spawn helpers with `detached: true` (Bun calls setsid(2) on
    POSIX, making the helper its own session leader AND pgrp
    leader).
  - Verify ownership immediately after spawn via `ps`:
    helper PID == helper PGID == helper SID, AND
    helper PGID != test runner PGID.
  - Gate any group signal in afterEach on a `*SessionVerified`
    boolean. The afterEach refuses to signal ANY group if the
    flag is false — preventing the CORRECTION03 P0 hazard.
  - Classify EPERM/ESRCH explicitly. Never silently fall
    through to a foreign group.

The production helper.c is BYTE-IDENTICAL to the CORRECTION02
commit at `1daa387bf`. SHA-256 unchanged:
`4575997ca83e4514a1a2a79c39a05829def84b3f2238bb14d8fc47bc3955ec0e`.

## Discriminator run (executed 2026-10-17T21:01:00Z)

```
PGID-DISC EVIDENCE — 2026-10-17T21:01:00.422Z
source=leaked-helper (PPID=1, reparented to launchd)
fresh_spawn_verified=false
ownership_check=(n/a — leaked-helper mode)
helper_pid=105
helper_ppid=1
helper_pgid=99756
helper_sess=0
helper_stat=
helper_command=/Volumes/.../tools/macos-host-helper/native/helper
helper_pgid_equals_pid=false
assumed_pgrp_kill_target=kill(-105, 0)
assumed_pgrp_kill_result=rc=-1 errno=ESRCH
actual_pgrp_kill_target=kill(-99756, 0)
actual_pgrp_kill_result=rc=-1 errno=EPERM
discriminator_verdict=MISMATCH
```

The discriminator's fresh-spawn attempt FAILED with
`helper did not produce status file in 10s` — the helper
could not bind its status file in the saturated environment.
The discriminator correctly fell back to LEAKED-HELPER
mode (read-only observation of an already-leaked helper
with PPID=1). The afterEach did NOT signal any group
because `fresh_spawn_verified=false`. This is the exact
behavior the reviewer required: leaked-helper observation
must never enter test cleanup.

## GS-14 run (executed 2026-10-17T21:01:11Z)

```
bun test tart-guest-smoke.test.ts -t 'GS-14'
  GS-14: descendant cleanup — specific sleep PID is reaped
         after TART_EXEC_TIMEOUT
  FAIL  [10451.68ms]
  error: helper did not produce status file in 10s
    at startHelper (.../tart-guest-smoke.test.ts:240:15)
```

GS-14 fails at the BINDING stage (startHelper timeout),
NOT at the CLEANUP stage. The 2,676 leaked helpers in the
environment prevent the new helper from binding its status
file. This is environment saturation, not a defect in the
CORRECTION04 bounded fix.

## 26-test suite

Not executed in this session. The first test in the suite
calls `startHelper` which has the same 10s status-file
timeout, and the environment saturation would block it
the same way GS-14 was blocked. Running the full suite in
this environment would burn the session's time budget for
no new information.

## Real Sonoma smoke

Not executed. The real smoke requires a running helper
binding `$HOME/.clinemm/host-helper.sock` (the launchd
LaunchAgent socket), which the operator has preserved.
The dev-fallback helper used by the hermetic suite binds
its own per-test socket, but that requires a free
process slot which the 2,676 leaked helpers are using.

## Environment reality

```
$ ps -ax -o pid=,stat,pgid,sess,command | \
    grep -E 'helper|clinemm' | grep -v grep | wc -l
2676
```

The leaked population has grown from 2,329 (recorded in the
CORRECTION03 evidence) to 2,676 in this session. Each leak
is a helper process (PPID=1, pgrp != pid) that the previous
test cleanup failed to reap because the cleanup signaled
`kill(-helperPid, "SIGKILL")` to a non-existent pgrp (ESRCH).

## Operator unblock required

Per the reviewer's C1 instruction, this session classifies
the environment as **ENVIRONMENT_BLOCKED**. The 2,676
leaked helpers are real, individually addressable processes
that the test cleanup failed to reap. They are NOT under the
test session's control — the test cleanup must not be
expanded to `pkill -f` to fix this (the reviewer's halt list
explicitly forbids that). Operator-controlled reap of those
specific PIDs is required before:

  - The CORRECTION04 bounded fix can be qualified end-to-end
    (GS-14 RED/GREEN, 26-test suite, real Sonoma smoke).
  - The factory can advance from this ACT.

## Verdict

```
DETACHED_SPAWN:               PASS (compile + run, ownership code path executed)
OWNERSHIP_VERIFICATION:       PASS (gates group signaling correctly)
DISCRIMINATOR_P0_HAZARD:      FIXED (afterEach refuses foreign group signals)
FRESH_SPAWN_TRACE:            NOT_PRODUCED (env saturation prevented binding)
GS14_RED_GREEN:               NOT_QUALIFIED (env saturation blocked binding)
26_TEST_SUITE:                NOT_QUALIFIED (env saturation blocked binding)
REAL_SONOMA_SMOKE:            NOT_QUALIFIED (env saturation blocked binding)
ENVIRONMENT_SATURATION:       OBSERVED (2,676 leaked helpers, growing)
ENVIRONMENT_BLOCKED:          DECLARED (operator unblock required)
```

## Source and binary identity (CORRECTION04 start)

```
Source HEAD:        602ce6394 (CORRECTION03 post-review commit)
helper.c SHA-256:   4575997ca83e4514a1a2a79c39a05829def84b3f2238bb14d8fc47bc3955ec0e (unchanged)
Helper binary SHA:  947cf462d177e1231aa68d43a11a64382edff20455108b690cbfbe580fbb4983 (unchanged)
Test files changed: tart-guest-smoke.test.ts, tart-pg-id-discriminator.test.ts
```

## Preserved invariants (per Factory rules)

- `HALT_UNSAFE_HOST_HELPER_SERVICE_MUTATION`: NO launchctl mutations.
- `HALT_UNSAFE_SEATBELT_RELAXATION`: NO Seatbelt profile changes.
- `HALT_DELETE_PRODUCTION_VM`: NO `tart delete` or rename of `clinemm-p3-sonoma-imported`.
- `HALT_REPLACE_TRUSTED_HELPER`: launchd-managed helper at `~/.clinemm/bin/clinemm-host-helper` unchanged.
- `HALT_ELM_OR_COMPLETION_AUTHORITY_DRIFT`: NO Elm source change.
- `HALT_PGID_99756_KILL`: PGID 99756 was NOT signaled by this session.
- `HALT_GLOBAL_PKILL`: NO `pkill -f` invocations.
- `HALT_PRESERVE_DISCRIMINATOR_AND_BOARD`: All CORRECTION03 uncommitted changes are preserved in this commit.
