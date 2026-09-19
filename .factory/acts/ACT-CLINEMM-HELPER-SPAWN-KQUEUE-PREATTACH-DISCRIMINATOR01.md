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

The minimal experiment is:

```
helper creates kqueue
→ helper creates root in a controlled suspended/pre-exec state
→ root watch is established before user command can run
→ resume/exec user command
→ recursively NOTE_FORK + reconcile via sysctl KERN_PROC
→ run E/F
→ terminate tracked set
→ assert zero survivors
```

This ACT does NOT wire the experiment into `CommandJobManager`. The
spec demands **native probe only**. Three new probe binaries under
`tools/macos-host-helper/native/containment-probe/`:

  - `30-helper-preattach-driver.c` — the orchestrator (analogous to
    `23-mechb-full-test.c` but with kqueue established in-process
    BEFORE fork+exec, NOT attached to an already-spawned PID).
  - `31-helper-preattach-root.c` — the user-command-equivalent root.
    Implements six sub-fixtures via `--fixture=<name>` cmdline arg:
      shell-A, node-B, python-C, mixed-D, node-escape, python-escape.
      The escape variants call `setsid()+setpgid()` /
      `start_new_session=True` equivalent before any fork.
  - `32-helper-preattach-emulator.c` — a helper-driven fork-storm
    emulator that performs `fork()` repeatedly (≥ 16 iterations in
    < 5 ms) so the driver has to reconcile a flood, not a single fork.
    Used for the race-hammer pass.

The driver's job, in pseudo-C:

```c
kq = kqueue();
pid_t root = posix_spawn(...root-binary argv...);
// root is born RUNNING, but the helper attaches BEFORE the first
// fork can happen because the root binary is a one-shot wrapper
// that prints its pid, sleeps 5 ms (driver attach window), THEN forks.
watch(root);
// kevent loop: NOTE_FORK -> reconcile via sysctl KERN_PROC -> watch
// all newly-discovered children recursively.
```

The 5 ms pre-fork sleep is the **only** timing assumption. That is
intentionally generous: the production helper has ~tens-of-ms between
posix_spawn() returning and the user's first fork() under any
realistic shell startup. The driver's job is to prove that under this
realistic timing budget, kqueue does NOT lose the race.

### Driver identity vs production-helper identity

`30-helper-preattach-driver` runs **as the user** (the same UID as the
fixture root), not as the LaunchAgent. This is a deliberate scope
limitation: the ACT falsifies the **primitive** under realistic
attach-before-fork timing, not the helper's signal authority. The
predecessor ACT (`ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01`)
already verified that `kill(2)` from a same-UID probe succeeds
(epperm/no authority is a LaunchAgent-granted capability, not a
primitive property — the predecessor ACT 25-mechanism-b-control.txt
documents this). This ACT does not need to re-falsify that axis.

If the primitive survives the ACT and
`HELPER_SUPERVISED_SPAWN_IMPLEMENTATION01` is later authorized, the
production helper will own the spawn and the driver's same-UID
limitation goes away.

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
| fork storm (≥ 16 forks < 5 ms)  | N/A                             | MUST PASS                       |
| unrelated same-UID sleep x 2    | unrelated sleep ALIVE           | MUST remain ALIVE               |

### Race hammer (mandatory)

```
≥ 100 immediate-fork iterations of 30-helper-preattach-driver
missed_descendants = 0
```

If even one descendant escapes across 100 iterations:

```
HALT_HELPER_PREATTACH_KQUEUE_RACE
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
                                            attach window budget (5 ms vs typical
                                            shell startup), and the rationale for
                                            the same-UID probe (not helper-driven)
  - `20-fixture-shell-A.json`             — shell-A preattach result
  - `21-fixture-node-B.json`              — node-B preattach result
  - `22-fixture-python-C.json`            — python-C preattach result
  - `23-fixture-mixed-D.json`             — mixed-D preattach result
  - `24-fixture-node-escape-E.json`       — node-escape E preattach result
  - `25-fixture-python-escape-F.json`     — python-escape F preattach result
  - `26-fixture-immediate-double-fork.json` — immediate double-fork preattach
  - `27-fixture-fork-storm.json`          — ≥ 16 forks < 5 ms preattach
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
KQUEUE_PRIMITIVE_VIABLE_UNDER_HELPER_SUPERVISED_SPAWN   = PASS iff matrix green
KQUEUE_PRIMITIVE_NOT_VIABLE_EVEN_UNDER_PREATTACH        = REFUTED iff any
                                                            escape iteration
                                                            survives
PRODUCTION_SPAWN_ARCHITECTURE                           = ROOT_CAUSE_OF_RACE
                                                            iff primitive viable
```

Per the reviewer's narrowing: the question this ACT answers is **not**
"is `NO_SAFE_GENERAL_DESCENDANT_CONTAINMENT_AVAILABLE` true?" — that
statement was retracted by the reviewer's HALT. The question is
"does moving the watch to the other side of the spawn race eliminate
the defect?"

## Production consequence (per verdict)

If `KQUEUE_PRIMITIVE = VIABLE_UNDER_HELPER_SUPERVISED_SPAWN`:

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
HALT_HELPER_PREATTACH_KQUEUE_PARTIAL
NEXT = ESCAPED-DESCENDANT-REMEDIATION-DECISION01
       (with a frozen enumeration of which classes survived)
```

In NO case does this ACT itself select a production mechanism. That
selection belongs to the successor.

## Halt conditions

  - `HALT_HELPER_PREATTACH_KQUEUE_RACE` — any descendant survives
    across 100 race-hammer iterations.
  - `HALT_UNRELATED_PROCESS_TARGETED` — negative control regression.
  - `HALT_UNEXPECTED_TRACKED_DIRT` — unexpected production-side change.

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
