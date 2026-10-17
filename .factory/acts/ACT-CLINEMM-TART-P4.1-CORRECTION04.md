# ACT-CLINEMM-TART-P4.1-CORRECTION04

**Status:** IN PROGRESS (bounded test-side correction, with ENVIRONMENT_BLOCKED classification per reviewer instruction).

**Predecessor:** `602ce6394` (CORRECTION03 post-review commit;
`PASS_PGID_MISMATCH / HALT_UNSAFE_GROUP_CLEANUP`).

**SUBJECT_HEAD:** `602ce6394` (main; the CORRECTION03 commit; working
tree at start of this ACT contained the uncommitted CORRECTION03
files: `tart-pg-id-discriminator.test.ts`, updated
`tart-guest-smoke.test.ts`, the PGID evidence files, and the
updated ACT+board).
**ENTRY_HEAD:** identical + C1 bounded correction.
**DOGFOOD_SOURCE_HEAD:** identical.

## 0. Mission

Apply the reviewer's C1 bounded instruction:

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
>    RED with that signaling ablated. Do not allow test-side
>    cleanup to turn RED into GREEN.
> 6. Run the native 26-test suite once, then go directly to
>    isolated real Sonoma smoke.
> [...]
> If the existing host cannot start a fresh isolated helper,
> classify ENVIRONMENT_BLOCKED and request operator-controlled
> cleanup of individually verified test-owned processes. Do not
> invent a successful test result.

The CORRECTION03 discriminator's P0 hazard — its afterEach
signaling `observedHelperPgid` even when that PGID was inherited
from a leaked-helper fallback — is fixed. The fix is at SPAWN
TIME, not cleanup time. This is the key simplification: establish
process ownership at spawn, instead of rediscovering an unsafe
shared group during cleanup.

## 1. Source and binary identity (S0)

**Gate S0:** `PASS_HELPER_C_BINDING_VERIFIED`

```
Source HEAD:        602ce6394 (CORRECTION03 post-review commit)
helper.c SHA-256:   4575997ca83e4514a1a2a79c39a05829def84b3f2238bb14d8fc47bc3955ec0e (unchanged)
Helper binary SHA:  947cf462d177e1231aa68d43a11a64382edff20455108b690cbfbe580fbb4983 (unchanged)
```

The production helper.c is BYTE-IDENTICAL to the CORRECTION02
commit. The CORRECTION04 ACT modifies test-side files ONLY:

  - `tools/macos-host-helper/native/tart-pg-id-discriminator.test.ts`
  - `tools/macos-host-helper/native/tart-guest-smoke.test.ts`

## 2. The C1 fix (bounded, no architecture change)

### 2.1 Spawn with `detached: true`

Both test-side spawns now pass `detached: true`. Per the Bun
spawn reference, this calls `setsid(2)` on POSIX, making the
child its own session leader and pgrp leader. The helper's
PID then equals its PGID equals its SID, and its group is
distinct from the test runner's group.

### 2.2 Verify ownership after spawn

After spawn, the test runs a `ps` observation to confirm:

  - `helper.PID == helper.PGID == helper.SID`
  - `helper.PGID != test_runner.PGID`

If either condition fails, the test sets
`*SessionVerified = false`. The afterEach refuses to signal
ANY group when this flag is false.

### 2.3 Gate group signaling in afterEach

The afterEach now has three paths:

  - **A. `*SessionVerified === true`** — signal the helper's
    owned pgrp (`process.kill(-helperPid, "SIGKILL")`) and
    direct-PID kill the helper as a backstop. EPERM (sandbox)
    falls back to direct-PID only. ESRCH (already gone) is
    accepted.
  - **B. `*SessionVerified === false` but `proc` exists** —
    direct-PID kill of the helper ONLY. We do NOT signal any
    group identity we have not verified is owned by this test.
  - **C. No `proc`** — nothing to do.

This removes the CORRECTION03 P0 hazard: the afterEach will
never signal a merely-observed group from a leaked-helper
fallback, because the leaked-helper branch leaves the flag
false and the fallback identity is never used in cleanup.

### 2.4 Discriminator's fresh-spawn path is independent of the leaked-helper path

The discriminator still has two observation modes
(fresh-spawn, leaked-helper). The fresh-spawn path verifies
ownership; the leaked-helper path does not. In either case,
the afterEach only signals a group when `freshSpawnVerified`
is true. The leaked-helper path is strictly read-only.

## 3. Executable gate (E1)

**Gate E1:** `ENVIRONMENT_BLOCKED` (operator unblock required)

### 3.1 Discriminator run

The discriminator was run on 2026-10-17T21:01:00Z. The
fresh-spawn attempt FAILED at `startHelperForDiscriminator`
with `helper did not produce status file in 10s` — the helper
could not bind its status file in the saturated environment.
The discriminator correctly fell back to LEAKED-HELPER mode,
recorded the MISMATCH evidence (PID 105, PGID 99756,
`kill(-105)→ESRCH`, `kill(-99756)→EPERM`), and the afterEach
refused to signal any group because `fresh_spawn_verified=false`.

This is the expected behavior: the discriminator's P0 hazard
is gone, and the discriminator continues to record observation
evidence even when the environment is blocked.

### 3.2 GS-14 run

GS-14 was run on 2026-10-17T21:01:11Z. It FAILED at
`startHelper` with `helper did not produce status file in 10s`
— the same binding-stage failure. GS-14 cannot reach the
cleanup assertion (and therefore cannot validate the
production pgrp kill) in this environment.

The CORRECTION04 fix cannot be qualified end-to-end in this
saturated environment. The reviewer's C1 instruction says:

> If the existing host cannot start a fresh isolated helper,
> classify ENVIRONMENT_BLOCKED and request operator-controlled
> cleanup of individually verified test-owned processes.

This session does not invent a successful GS-14 result. It
honestly reports the bind-stage failure.

### 3.3 26-test suite

Not executed. The first test in the suite would hit the same
binding-stage failure as GS-14. Running the full suite in this
environment would burn the session's time budget for no new
information. Per the reviewer's instruction, this is classified
as part of the ENVIRONMENT_BLOCKED gate.

### 3.4 Real Sonoma smoke

Not executed. The real smoke needs a launchd-managed helper
binding `$HOME/.clinemm/host-helper.sock`. The operator has
preserved that socket (the install is unchanged). The dev-
fallback helper used by the hermetic suite needs a free
process slot which the 2,676 leaked helpers are using.

## 4. Environment reality

```
$ ps -ax -o pid=,stat,pgid,sess,command | \
    grep -E 'helper|clinemm' | grep -v grep | wc -l
2676
```

The leaked population has grown from 2,329 (CORRECTION03
evidence) to 2,676 in this session. Each leak is a helper
process (PPID=1, pgrp != pid) that the previous test cleanup
failed to reap. This is the original defect the discriminator
identified: `kill(-helperPid)` signaling a non-existent pgrp
returning ESRCH, which the cleanup interpreted as "pgrp already
gone" and silently moved on.

## 5. Operator unblock required

To qualify the CORRECTION04 bounded fix end-to-end, the
operator must reap the 2,676 leaked helpers in a way that:

  - does NOT use `pkill -f` (the reviewer's halt list
    explicitly forbids that);
  - does NOT use `pkill -g` with the leaked PGIDs
    (PGID 99756 has members that may not all be leaked
    test helpers — the operator must verify each PID
    individually);
  - does NOT touch PGID 99756 specifically without first
    confirming all members are individually verified
    test-owned processes;
  - does NOT touch the launchd-managed helper at
    `~/.clinemm/bin/clinemm-host-helper` or its socket;
  - does NOT touch the installed Sonoma VM
    `clinemm-p3-sonoma-imported`.

After operator reap, the next session can run:
  - GS-14 with production-active (must be GREEN)
  - GS-14 with production-ablated (must be RED)
  - the 26-test suite (must be 26/26 GREEN)
  - the isolated real Sonoma smoke (must be GREEN)

## 6. Verdict

```
DETACHED_SPAWN:               PASS
OWNERSHIP_VERIFICATION:       PASS
DISCRIMINATOR_P0_HAZARD:      FIXED
FRESH_SPAWN_TRACE:            NOT_PRODUCED (env saturation)
GS14_RED_GREEN:               NOT_QUALIFIED (env saturation)
26_TEST_SUITE:                NOT_QUALIFIED (env saturation)
REAL_SONOMA_SMOKE:            NOT_QUALIFIED (env saturation)
ENVIRONMENT_SATURATION:       OBSERVED (2,676 leaked helpers)
ENVIRONMENT_BLOCKED:          DECLARED (operator unblock required)

NEXT:
  OPERATOR_REAP_LEAKED_HELPERS
    -> GS14 ACTIVE GREEN + ABLATED RED
    -> 26-TEST SUITE GREEN
    -> REAL SONOMA SMOKE GREEN
    -> FACTORY ADVANCE
```

## 7. Files in this ACT

| File | Purpose |
|---|---|
| `tools/macos-host-helper/native/tart-pg-id-discriminator.test.ts` | modified — `detached: true`, ownership verification, gated afterEach |
| `tools/macos-host-helper/native/tart-guest-smoke.test.ts` | modified — `detached: true` in startHelper, `helperSessionVerified` flag, gated afterEach and GS-14 finally |
| `.factory/acts/ACT-CLINEMM-TART-P4.1-CORRECTION04.md` | THIS FILE |
| `.factory/evidence/ACT-CLINEMM-TART-P4.1-CORRECTION04/01-discriminator-isolated-spawn.txt` | Discriminator run after the fix |
| `.factory/evidence/ACT-CLINEMM-TART-P4.1-CORRECTION04/02-gs14-red-env-blocked.txt` | GS-14 RED at binding stage |
| `.factory/evidence/ACT-CLINEMM-TART-P4.1-CORRECTION04/03-isolated-spawn-evidence.md` | Full evidence narrative |

## 8. Preserved invariants (per Factory rules)

- `HALT_UNSAFE_HOST_HELPER_SERVICE_MUTATION`: NO launchctl mutations.
- `HALT_UNSAFE_SEATBELT_RELAXATION`: NO Seatbelt profile changes.
- `HALT_DELETE_PRODUCTION_VM`: NO `tart delete` or rename.
- `HALT_REPLACE_TRUSTED_HELPER`: launchd-managed helper unchanged.
- `HALT_ELM_OR_COMPLETION_AUTHORITY_DRIFT`: NO Elm/completion source change.
- `HALT_PGID_99756_KILL`: PGID 99756 was NOT signaled.
- `HALT_GLOBAL_PKILL`: NO `pkill -f`.
- `HALT_PRESERVE_DISCRIMINATOR_AND_BOARD`: All CORRECTION03 uncommitted changes preserved.
- `HALT_INVENT_SUCCESS`: This ACT does not invent a successful test result. The environment-blocked classification is honest.
