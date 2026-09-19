# ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01

## Purpose

Falsify (or confirm) the next causal discriminator implied by the prior
ACT's evidence but never run: **if the trusted LaunchAgent helper installs
lineage observation BEFORE it spawns the command root**, does
kqueue+reconciliation retain complete ownership through Node
`detached:true`, Python `start_new_session=True`, immediate double-fork,
exec, and reparenting?

This ACT exists because the predecessor's conclusion
(`NO_SAFE_GENERAL_DESCENDANT_CONTAINMENT_AVAILABLE` per
`ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01`) **exceeded its
discriminator evidence**. The predecessor's `MECHANISM_B =
RACE_REFUTED` is correct **for the spawn-then-attach sequence**, but
the predecessor's own `B_DOUBLE_FORK_ZERO = PASS (when race avoided)`
arm proves the primitive's attach-then-spawn direction was never
falsified. Per Factory reviewer
(`HALT_CONTAINMENT_CONCLUSION_EXCEEDS_DISCRIMINATOR`, 2026-09-19):

    NO_SAFE_GENERAL_DESCENDANT_CONTAINMENT_AVAILABLE

is unjustified. What was actually proven is:

    NO_SAFE_POST_SPAWN_CONTAINMENT
    AVAILABLE_IN_CURRENT_ARCHITECTURE

…which is load-bearing: the same experiment already provided the next
causal discriminator — helper-mediated preattach — and skipping it would
shortcut the most obvious engineering experiment.

## Inputs (predecessor)

`.factory/evidence/ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01/`

  - `20-mechanism-b-capability.txt` — `B_DOUBLE_FORK_ZERO = PASS
    (when race avoided, by external sequencing)`.
  - `24-mechanism-b-double-fork.json` — tracked=[root, grandchild1,
    grandchild2] under attach-before-fork sequencing.
  - `23-mechanism-b-race-stress.json` — 5/5 immediate-fork iterations
    miss both grandchildren (load-bearing RED of the post-spawn
    sequence).
  - `25-mechanism-b-control.txt` + `45-mechanism-b-negative-control.json`
    — `PROCESS_NAME_INDEPENDENT = PASS`, `UNRELATED_CONTROL_SURVIVES
    = PASS`, `NO_SAME_UID_SWEEP = PASS`. The negative-control axis is
    already clean; it does not need to be re-falsified in this ACT.
  - `30-mechanism-c-availability.txt`, `31-mechanism-c-entitlement.txt`
    — `C_RUNTIME_ELIGIBILITY = UNAVAILABLE` on this substrate
    (framework absent + adhoc-signed). C is **out of scope** for this
    ACT.

## Epistemic question (single)

If the helper installs kqueue+EVFILT_PROC on a root PID BEFORE that
root PID's first fork, can the helper retain complete ownership of the
subtree through every escape class the predecessor ACT catalogued?

If yes for all escape classes AND the negative-control axis remains
clean → `KQUEUE_PRIMITIVE = VIABLE` in the helper-mediated-spawn
architecture, and the spawn race (not the primitive) is the production
defect.

If no (any descendant survives) → `KQUEUE_PRIMITIVE = REFUTED` even
under helper-mediated spawn, and the next discriminator is C
(Endpoint Security) under a Developer-ID-signed helper, or a
policy-layer decision (prohibit detached process creation in ClineMM-
owned commands).

## Method (native probe only — no helper-protocol change)

The minimal experiment is to install the kqueue watch under a
**kernel-enforced** pre-execution barrier so the attach happens before
the root can execute a single user-space instruction. Darwin exposes
exactly this primitive: `POSIX_SPAWN_START_SUSPENDED`, a documented
Apple extension to `posix_spawnattr_setflags(3)`:

> If this bit is set, then the child process will be created with its
> task suspended, permitting debuggers, profilers, and other programs
> to manipulate the process before it begins execution in user space.
> (Apple, `posix_spawnattr_setflags(3)`; flag defined in
> `<sys/spawn.h>` as `0x0080`.)

```
kq = kqueue();
posix_spawnattr_init(&attr);
posix_spawnattr_setflags(&attr, POSIX_SPAWN_START_SUSPENDED);
pid_t root = posix_spawn(... root-binary argv ..., &attr);
// root exists but has executed ZERO user-space instructions.
watch(root);                    // EVFILT_PROC | NOTE_FORK | NOTE_EXEC | NOTE_EXIT
verify kevent() registration succeeded;
kill(root, SIGCONT);            // kernel-resume; root may immediately
                                // fork/exec/setsid with NO artificial delay
// kevent loop: NOTE_FORK -> reconcile via sysctl KERN_PROC -> watch
// all newly-discovered children recursively.
```

**No cooperative fixture delay is permitted.** Adversarial roots MUST
be allowed to fork/exec/setsid on their first possible user-space
instruction. The ROOT_CAUSE_OF_RACE discriminator therefore stops being
"can kqueue outrun a 5 ms cooperative sleep?" and becomes "does the
kqueue primitive survive a kernel-suspended preattach followed by
immediate adversarial behavior?". A PASS here is meaningful; the prior
5 ms-budget experiment was a race with a cooperative fixture and is
explicitly removed.

This ACT does NOT wire the experiment into `CommandJobManager`. The
spec demands **native probe only**. Three new probe binaries under
`tools/macos-host-helper/native/containment-probe/`:

  - `30-helper-preattach-driver.c` — the orchestrator (analogous to
    `23-mechb-full-test.c` but with kqueue established via the
    `POSIX_SPAWN_START_SUSPENDED` barrier BEFORE the root's first
    user-space instruction, NOT attached to an already-running PID).
  - `31-helper-preattach-root.c` — the user-command-equivalent root.
    Implements six sub-fixtures via `--fixture=<name>` cmdline arg:
      shell-A, node-B, python-C, mixed-D, node-escape, python-escape.
      The escape variants call `setsid()+setpgid()` /
      `start_new_session=True` equivalent **as their very first
      user-space instruction** (no pre-fork delay, no fixture-side
      "attach window" sleep). The fork-storm variant performs ≥ 16
      `fork()` calls in immediate succession on its first user-space
      path, with no `nanosleep`/`usleep` between iterations.
  - `32-helper-preattach-emulator.c` — a helper-driven fork-storm
    emulator that performs `fork()` repeatedly (≥ 16 iterations) so
    the driver has to reconcile a flood, not a single fork. The
    emulator's fork loop performs ZERO `sleep`/`nanosleep`/`usleep`
    calls; it is intentionally an adversarial burst. Used for the
    race-hammer pass.

The driver's job, in pseudo-C:

```c
kq = kqueue();
posix_spawnattr_init(&attr);
posix_spawnattr_setflags(&attr, POSIX_SPAWN_START_SUSPENDED);
pid_t root = posix_spawn(...root-binary argv..., &attr);
// root is born SUSPENDED at the kernel boundary; it has executed
// zero user-space instructions and cannot until SIGCONT is delivered.
verify_watch_registration(root, NOTE_FORK | NOTE_EXEC | NOTE_EXIT);
kill(root, SIGCONT);            // kernel resume — root may now run
                                // whatever its first instruction is.
// kevent loop: NOTE_FORK -> reconcile via sysctl KERN_PROC -> watch
// all newly-discovered children recursively.
```

There is **no timing assumption**. The kernel holds the root inert
until `kill(root, SIGCONT)` returns; the driver returns from
`kevent()` registration before that resume. Apple's `EVFILT_PROC`
semantics fit this experiment: the watched PID is `ident`, and
`NOTE_FORK` reports that the watched process created a child; the
existing reconciliation machinery (sysctl `KERN_PROC`) remains
necessary because Apple does not specify the child PID in
`kevent.ident` / `data` (per predecessor evidence
`23-mechb-race-stress.json` and Apple's `kevent(2)` man page).

### Driver identity vs production-helper identity

`30-helper-preattach-driver` runs **as the user** (the same UID as the
fixture root), not as the LaunchAgent. This is a deliberate scope
limitation:

  ```
  SIGNAL_AUTHORITY = inherited from predecessor LIVE helper evidence
                     (ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01
                      + ACT-CLINEMM-SANDBOX-OWNED-PROCESS-TERMINATION01
                      + ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01
                      §10-mechanism-a-recon.txt records EPERM for
                      same-UID probes; signal authority lives with
                      the gui/501 LaunchAgent helper, not the probe)
  THIS_ACT         = lineage-observation discriminator only.
                     No kill(2) capability is asserted by this ACT,
                     and no kill(2) capability is required.
  ```

The predecessor ACT (`ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01`)
records EPERM for the same-UID probe (`10-mechanism-a-recon.txt`:
"My user cannot kill processes spawned by the fixture (verified:
'Operation not permitted' for the spawned rootPid, identical to the
production EPERM substrate)") and assigns signal authority to the
LaunchAgent-managed helper, not to a same-UID process. This ACT
therefore falsifies **only the lineage-observation primitive** under
suspended-preattach sequencing; it does NOT re-falsify the
helper-mediated kill chain, which is already proven on the live
permanent helper. If the primitive survives the ACT and
`HELPER_SUPERVISED_SPAWN_IMPLEMENTATION01` is later authorized, the
production helper will own both the spawn (with
`POSIX_SPAWN_START_SUSPENDED`) AND the kill chain, closing the
remaining same-UID limitation by virtue of LaunchAgent signal
authority.

## RED/GREEN matrix (mandatory)

| Fixture                         | Predecessor (spawn-then-attach) | This ACT (preattach-then-spawn) |
|---------------------------------|--------------------------------:|--------------------------------:|
| shell-A (inherited PGID)        | PASS                            | MUST PASS                       |
| node-B (inherited PGID)         | PASS                            | MUST PASS                       |
| python-C (inherited PGID)       | PASS                            | MUST PASS                       |
| mixed-D (inherited PGID)        | PASS                            | MUST PASS                       |
| node-escape E (detached:true)   | RED (misses grandchild)         | MUST PASS                       |
| python-escape F (setsid)        | RED (misses grandchild)         | MUST PASS                       |
| immediate double-fork           | RED (both grandchildren lost)   | MUST PASS                       |
| fork storm (≥ 16 forks, no inter-iteration sleep)  | N/A                             | MUST PASS                       |
| unrelated same-UID sleep x 2    | unrelated sleep ALIVE           | MUST remain ALIVE               |

### Race hammer (mandatory)

```
≥ 100 immediate-fork iterations of 30-helper-preattach-driver
missed_descendants = 0
```

If even one descendant escapes across 100 iterations:

```
HALT_HELPER_SUSPENDED_PREATTACH_KQUEUE_RACE
```

### Negative controls (mandatory)

Two `bash -c 'sleep 600'` siblings of the fixture root must remain
ALIVE after the driver's kill phase (already proven by
`45-mechanism-b-negative-control.json` for the primitive; this ACT
re-runs them under preattach sequencing to confirm the negative
control axis is preserved when the attach order changes).

## Evidence

`.factory/evidence/ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01/`

  - `00-entry.txt`                        — entry freeze (substrate, helper build_id)
  - `01-predecessor-freeze.txt`           — link to predecessor ACT + verbatim
                                            evidence pointers (20, 23, 24, 25, 45)
  - `10-driver-design.md`                 — kqueue + reconcile + sysctl design,
                                            POSIX_SPAWN_START_SUSPENDED barrier
                                            (kernel-enforced pre-exec suspension
                                            rather than cooperative delay), and
                                            the rationale for the same-UID probe
                                            (not helper-driven; signal authority
                                            inherited from the live LaunchAgent
                                            helper evidence)
  - `20-fixture-shell-A.json`             — shell-A preattach result
  - `21-fixture-node-B.json`              — node-B preattach result
  - `22-fixture-python-C.json`            — python-C preattach result
  - `23-fixture-mixed-D.json`             — mixed-D preattach result
  - `24-fixture-node-escape-E.json`       — node-escape E preattach result
  - `25-fixture-python-escape-F.json`     — python-escape F preattach result
  - `26-fixture-immediate-double-fork.json` — immediate double-fork preattach
  - `27-fixture-fork-storm.json`          — ≥ 16 forks, no inter-iteration
                                            sleep, under suspended preattach
  - `30-negative-control.json`            — unrelated same-UID sleeps survive
  - `40-race-hammer.json`                 — 100 iterations, missed_descendants count
  - `50-gates.txt`                        — gates run
  - `result.json`                         — final discriminator verdict

## Probe binaries (production-code-delta NONE)

`tools/macos-host-helper/native/containment-probe/`

  - `30-helper-preattach-driver.c`        — orchestrator (in-process kqueue +
                                            sysctl reconcile)
  - `31-helper-preattach-root.c`          — fixture root (6 sub-fixtures)
  - `32-helper-preattach-emulator.c`      — fork-storm emulator

None wired into the production helper protocol. None modify the wire
format. None modify `CommandJobManager`. None modify `helper.c`.

## Verdict taxonomy (this ACT)

```
KQUEUE_PRIMITIVE_VIABLE_UNDER_SUSPENDED_HELPER_SPAWN    = PASS iff matrix green
KQUEUE_PRIMITIVE_NOT_VIABLE_EVEN_UNDER_PREATTACH        = REFUTED iff any
                                                            escape iteration
                                                            survives
PRODUCTION_SPAWN_ARCHITECTURE                           = ROOT_CAUSE_OF_RACE
                                                            iff primitive viable
```

Per the reviewer's narrowing: the question this ACT answers is **not**
"is `NO_SAFE_GENERAL_DESCENDANT_CONTAINMENT_AVAILABLE` true?" — that
statement was retracted by the reviewer's HALT. The question is
"does moving the watch to the other side of the spawn race — via
`POSIX_SPAWN_START_SUSPENDED`, a kernel-enforced pre-execution
barrier rather than a cooperative fixture delay — eliminate the
defect?"

## Production consequence (per verdict)

If `KQUEUE_PRIMITIVE = VIABLE_UNDER_SUSPENDED_HELPER_SPAWN`:

```
NEXT = ACT-CLINEMM-HELPER-SUPERVISED-SPAWN-IMPLEMENTATION01
       (helper becomes the spawn authority; command-job-manager
        delegates posix_spawn + initial kqueue register to helper)
```

If `KQUEUE_PRIMITIVE = NOT_VIABLE_EVEN_UNDER_PREATTACH`:

```
NEXT = ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01
       (now narrowed: policy-layer decision between prohibit / accept-gap /
        Endpoint-Security-on-Developer-ID)
```

If verdict is **mixed** (some escape classes survive, some don't):

```
HALT_HELPER_SUSPENDED_PREATTACH_KQUEUE_PARTIAL
NEXT = ESCAPED-DESCENDANT-REMEDIATION-DECISION01
       (with a frozen enumeration of which classes survived)
```

In NO case does this ACT itself select a production mechanism. That
selection belongs to the successor.

## Halt conditions

  - `HALT_HELPER_SUSPENDED_PREATTACH_KQUEUE_RACE` — any descendant survives
    across 100 race-hammer iterations.
  - `HALT_UNRELATED_PROCESS_TARGETED` — negative control regression.
  - `HALT_UNEXPECTED_TRACKED_DIRT` — unexpected production-side change.
  - `HALT_SUBSTRATE_CANNOT_DELIVER_SIGCONT_TO_SPAWNED_CHILD` — runtime halt
    raised when the substrate blocks the driver from delivering
    `kill(root, SIGCONT)` after `POSIX_SPAWN_START_SUSPENDED`. This is the
    same EPERM boundary the predecessor ACT documented in
    `10-mechanism-a-recon.txt` and the production helper exists to bridge.
    On a substrate where same-UID parent→child signal delivery works, this
    halt does not trigger. On a substrate where it does not, the SIGCONT
    step requires the helper (an additive `signal.cont` capability on the
    existing `process-group.register-owned` job binding). See
    `.factory/evidence/ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01/60-substrate-halt.md`
    for the full substrate analysis and the three bounded options the
    reviewer can choose between to make this ACT runnable.

## Halt conditions NOT triggered (verifying non-halt)

  - `HALT_CLIENT_ISOLATION_BROKEN` — no production wire change.
  - `HALT_STALE_PID_CAN_BE_KILLED` — driver uses pid+start_time identity
    inherited from predecessor primitive; binding unchanged.
  - `HALT_TERMINATION_WINDOW_ESCAPE` — out of scope; helper signal
    authority unchanged.

## Substrate

  macOS 14.7.4 (23H420), Darwin 23.6.0, arm64.
  Helper build_id (live): c5f3ea0322ae92a6ea5378577e39fef95696057b8ad6fba63a1fce57f80b74b9
  Helper pid (live): 9582
  Helper socket (live): /Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock

## Successor ACT (TBD by verdict)

  - On PASS: `ACT-CLINEMM-HELPER-SUPERVISED-SPAWN-IMPLEMENTATION01`
  - On REFUTED: `ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01`
  - On MIXED: `ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01`
    with partial-classification evidence.

## STOP rule

This ACT does NOT enter the policy/remediation decision tree until the
preattach experiment has been falsified or confirmed. The
predecessor's `ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01`
is NOT authorized by this ACT.

## Correction history

  - 2026-09-19: bounded correction
    `HALT_PREATTACH_DISCRIMINATOR_STILL_HAS_A_RACE` (Factory reviewer,
    macOS process-control engineer). The original §Method placed the
    preattach barrier in a **cooperative 5 ms fixture sleep**, which
    was still a race — merely a race with a cooperative fixture.
    Replaced the cooperative-delay scheme with the documented Darwin
    primitive `POSIX_SPAWN_START_SUSPENDED` (`<sys/spawn.h>` flag
    `0x0080`): the root is born with its task suspended at the kernel
    boundary and cannot execute a single user-space instruction until
    the driver delivers `SIGCONT`. All adversarial roots MUST be
    permitted to fork/exec/setsid on their first possible user-space
    instruction; the fork-storm emulator performs zero
    `sleep`/`nanosleep`/`usleep` between iterations. Renamed the
    primary verdict label to
    `KQUEUE_PRIMITIVE_VIABLE_UNDER_SUSPENDED_HELPER_SPAWN` and the
    halt labels to `HALT_HELPER_SUSPENDED_PREATTACH_KQUEUE_RACE` /
    `HALT_HELPER_SUSPENDED_PREATTACH_KQUEUE_PARTIAL`. Traveled the
    small correction to §Driver identity: the predecessor ACT
    records EPERM for same-UID probes and assigns signal authority
    to the LaunchAgent-managed helper, so this ACT inherits
    `SIGNAL_AUTHORITY` from the LIVE helper evidence chain rather
    than asserting a same-UID `kill(2)` capability it does not
    actually exercise. Probe-binary hygiene preserved: `.c` sources
    tracked, build artifacts ignored. **After bounded fix: C1: GO.**

  - 2026-09-19: substrate-level execution halt
    `HALT_SUBSTRATE_CANNOT_DELIVER_SIGCONT_TO_SPAWNED_CHILD`. The three
    probe binaries (`30-helper-preattach-driver`,
    `31-helper-preattach-root`, `32-helper-preattach-emulator`) were
    built cleanly with the kernel barrier (`POSIX_SPAWN_START_SUSPENDED`)
    correctly wired, and the driver correctly registers the kqueue
    watch BEFORE delivering `kill(root, SIGCONT)`. On the substrate
    this ACT was executed on, the parent cannot deliver signals to
    its own children — `kill(root, SIGCONT)` returns EPERM. The
    minimal reproduction (plain `fork()` + `kill(child, SIGTERM)`)
    returns the same EPERM. This is the SAME boundary the
    predecessor ACT documented in
    `ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01/10-mechanism-a-recon.txt`
    ("My user cannot kill processes spawned by the fixture...
    'Operation not permitted'... identical to the production EPERM
    substrate") and the production helper exists to bridge via
    LaunchAgent signal authority.

    This is **not a defect in the probe binaries or in the corrected
    ACT design** — those are both verified. The §Method and
    §Driver identity of the corrected ACT are mutually consistent
    on a substrate where same-UID signal delivery works (which is
    the normal macOS substrate; the reviewer cited Apple's XNU
    tests as a known-working precedent). The substrate this ACT
    was executed on has a tool-layer sandbox that blocks same-UID
    signal delivery from any descendant of VSCodium Helper. The
    experiment did not run; no RED/GREEN matrix entry was
    produced.

    Three bounded options the reviewer can choose between to make
    this ACT runnable:

      (A) Add a `signal.cont` (or similarly named) capability to
          the helper protocol, gated by the existing kernel-
          authenticated peer binding of `process-group.register-owned`.
          Additive; does not change the helper's behavior for any
          other consumer; production wire change.

      (B) Bundle the SIGCONT delivery with the existing helper
          wire as a single bounded additive change for this ACT
          only. Same as (A) but bounded explicitly to the
          preattach discriminator.

      (C) Re-route to a successor ACT (`...DISCRIMINATOR02`) that
          runs the experiment on a substrate where same-UID
          signal delivery works (clean macOS shell outside
          VSCodium, or a Developer-ID-signed helper build where
          signal authority is established via LaunchAgent).

    See
    `.factory/evidence/ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01/60-substrate-halt.md`
    for the full substrate analysis. Predecessor ACT unchanged:
    `B_spawn_then_attach = RACE_REFUTED`, retracted claim unchanged,
    successor purpose unchanged. **Until A, B, or C is chosen:
    C1: HALT (substrate).**
