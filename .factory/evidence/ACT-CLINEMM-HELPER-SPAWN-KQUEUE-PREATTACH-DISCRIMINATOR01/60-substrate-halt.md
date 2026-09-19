# 60-substrate-halt.md

## Halt

```
HALT_SUBSTRATE_CANNOT_DELIVER_SIGCONT_TO_SPAWNED_CHILD
```

## What was executed

Three probe binaries built clean (cc -O2 -Wall -Wextra, no warnings):

  - `tools/macos-host-helper/native/containment-probe/30-helper-preattach-driver`
    (51848 bytes; orchestrator; posix_spawn + kqueue + reconcile)
  - `tools/macos-host-helper/native/containment-probe/31-helper-preattach-root`
    (51048 bytes; six fixture variants via --fixture=<name>)
  - `tools/macos-host-helper/native/containment-probe/32-helper-preattach-emulator`
    (33936 bytes; immediate-double-fork + fork-storm)

The driver accepts the root binary as argv[1] and performs the four
required steps (spawn suspended, register kqueue, deliver SIGCONT,
run kevent loop). On a normal macOS substrate these four steps are
the entire experiment. On this substrate the third step fails.

## What was observed

Driver step 3 (`kill(root, SIGCONT)`) returns EPERM:

```
{"event":"spawn","pid":98913,"suspended":true}
{"event":"watch","pid":98913}
{"event":"halt","reason":"sigcont_failed","errno":1,"errstr":"Operation not permitted"}
```

This is **not specific to posix_spawn**. The same EPERM was reproduced
on a minimal native test (plain `fork()` + `kill(child, SIGTERM)`):

```
[parent] pid=11248 child=11257
[parent] kill(SIGTERM) -> -1 errno=1 (Operation not permitted)
[parent] waitpid WNOHANG -> 0 status=0
[child] pid=11257 ppid=1
[child] exiting normally
```

The child was reparented to launchd (ppid=1) because the parent could
not signal it; the child then ran to completion on its own.

This EPERM matches **exactly** the precedent the predecessor ACT
documented in `ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01/
10-mechanism-a-recon.txt`:

> My user cannot kill processes spawned by the fixture (verified:
> "Operation not permitted" for the spawned rootPid, identical to
> the production EPERM substrate).

The production helper exists precisely to bridge this boundary
(`11-mechanism-a-helper-driven.mjs` uses the LaunchAgent's
`process-group.terminate-owned` to deliver signals).

## Where the ACT contract has a hole

The corrected ACT's §Method is:

```
kq = kqueue();
posix_spawnattr_init(&attr);
posix_spawnattr_setflags(&attr, POSIX_SPAWN_START_SUSPENDED);
pid_t root = posix_spawn(... root-binary argv ..., &attr);
watch(root);
kill(root, SIGCONT);     // <-- FAILS WITH EPERM ON THIS SUBSTRATE
```

The corrected §Driver identity says:

```
SIGNAL_AUTHORITY = inherited from predecessor LIVE helper evidence
THIS_ACT         = lineage-observation discriminator only.
                   No kill(2) capability is asserted by this ACT,
                   and no kill(2) capability is required.
```

These two statements are mutually contradictory on a substrate where
the parent process cannot signal its own children: the §Method
requires `kill(root, SIGCONT)`, but §Driver identity disclaims any
`kill(2)` capability. On the substrate where same-UID signal
delivery is blocked (which is the substrate the production helper
exists to bridge), the §Method cannot complete.

The reviewer's check assumed the substrate would allow
`kill(child_pid, SIGCONT)` after `posix_spawn`. The Apple XNU tests
the reviewer linked do run on a normal macOS substrate where this
works. This substrate is not normal: every same-UID signal the user
shell sends to its own children returns EPERM.

## What was NOT done

The experiment itself was not run, because the substrate blocked
the SIGCONT step. There is no RED/GREEN matrix result, no race
hammer result, no per-fixture result. The probes themselves were
built and the design was verified to compile cleanly with the
right Darwin primitives linked (`posix_spawnattr_setflags`,
`kqueue`, `kevent`); only the runtime step that requires same-UID
signal authority was blocked.

## Honest verdict matrix

```
B_spawn_then_attach                           = RACE_REFUTED       (predecessor, unchanged)
NO_SAFE_GENERAL_DESCENDANT_CONTAINMENT        = RETRACTED          (predecessor, unchanged)
SUCCESSOR_ACT_PURPOSE                         = CORRECT            (predecessor, unchanged)
SUCCESSOR_ACT_METHOD                          = CORRECTED          (bounded correction landed)
SUCCESSOR_ACT_RUNNABLE_ON_THIS_SUBSTRATE      = NO                 (this halt)
PROBE_BINARIES_BUILT                          = YES                (3 binaries, clean compile)
PROBE_BINARY_HYGIENE                          = PASS               (.c tracked, .o ignored)
KERNEL_PREEXEC_BARRIER_AVAILABLE              = YES                (POSIX_SPAWN_START_SUSPENDED works)
SAME_UID_SIGNAL_AUTHORITY                     = NO                 (substrate blocks parent -> child signals)
PROBE_DESIGN_VS_SUBSTRATE                     = CONTRADICTORY      (§Method needs kill, §Driver identity disclaims it)
```

## Recommended next move

Three options the reviewer can choose between:

### Option A — add a `signal.cont` capability to the helper

Add `process-group.signal-owned` (or similar) to the helper protocol
that takes a registered job_token and a signal number, with the
same kernel-authenticated peer binding the existing
`process-group.terminate-owned` uses. Then the driver can register
the suspended root as "owned" via `register-owned` (the root
PID is valid even while suspended — `getpgid(pid) === pid` may not
hold during suspension, but the leader check can be relaxed for
suspended tasks or the call can be permitted with a flag), and
use `signal.cont` to resume it.

  Cost:    wire change to `tools/macos-host-helper/protocol.ts` and
           `tools/macos-host-helper/native/helper.c`. NOT a helper
           behavior change for any other consumer (the new method
           is additive and gated by the same kernel-authenticated
           peer binding).
  Benefit: production-spawn implementation now has a uniform way to
           preattach AND resume; the original ACT vision works.
  Risk:   the helper exposes a generic signal selector. The fix is
           to limit it to `SIGCONT` only (or to a small allow-list
           that does NOT include SIGKILL/SIGTERM — those continue
           to flow through `terminate-owned`).

### Option B — split the experiment: helper delivers SIGCONT, probe observes

Run the experiment with a helper-side launchctl exec that:
  1. registers the suspended root PID via `client.open` +
     `process-group.register-owned` (with relaxed leader check for
     suspended tasks; documented and gated)
  2. delivers `SIGCONT` via a new `signal.cont` capability (additive)
  3. the probe attaches kqueue via the helper's existing
     getpeereid-authenticated path

  This is the same as Option A, but bundled as a single bounded
  helper-side change for this ACT only. The change is additive and
  doesn't change the helper's behavior for any other consumer.

### Option C — accept that the ACT is not runnable on this substrate

Mark this ACT as substrate-blocked. Move the experiment to
ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR02 which
re-runs it on a substrate where the helper can deliver SIGCONT.
This requires either:
  - a Developer ID-signed helper build (the production build), or
  - a substrate where the same-UID signal authority boundary does
    not apply (a clean macOS shell outside VSCodium / Claude tool-runs).

  This option preserves all current ACT work (probe binaries,
  ACT spec, corrected closure) and just re-routes the execution.

## Reviewer ask

Choose A, B, or C and apply a bounded correction. The probes are
ready; only the SIGCONT delivery needs to come from the helper.

Until then: this ACT halts at
`HALT_SUBSTRATE_CANNOT_DELIVER_SIGCONT_TO_SPAWNED_CHILD` and the
result.json `verdict` is `HALT`.
