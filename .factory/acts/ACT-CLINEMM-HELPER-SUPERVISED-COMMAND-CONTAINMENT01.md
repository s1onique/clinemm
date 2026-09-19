# ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01

## Purpose

`CONTAINMENT_PRIMITIVE_DISCRIMINATOR`. Discriminate three candidate
macOS containment primitives against the predecessor ACT's reproduced
E/F escape (Node `detached:true`, Python `start_new_session=True`).

## Inputs (predecessor)

`.factory/evidence/ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01/`

  - shell-A.json, node-B.json, python-C.json, mixed-D.json
    (bounded inherited PGID trees — helper-mediated cleanup succeeds)
  - node-escape.json, python-escape.json
    (setsid()/detached:true escape — helper-mediated cleanup misses)
  - result.json invariant classification:
      DESCENDANT_CONSERVATION: REFUTED
      CASE_B: REPRODUCED

The successor ACT MUST find which macOS primitive can contain
descendants that escape the inherited PGID/session, without
killing unrelated same-UID processes.

## Discriminator

Three candidates evaluated against the same six fixtures:

  A: cleanup-time PPID-chain ancestry reconstruction
  B: kqueue EVFILT_PROC NOTE_FORK event-time lineage
  C: Endpoint Security descendants client

## Evidence

`.factory/evidence/ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01/`

  00-entry.txt                       entry freeze
  01-predecessor-freeze.txt          predecessor contract
  10-mechanism-a-cleanup-ancestry.json   full A result matrix
  10-mechanism-a-recon.txt               A narrative
  11-mechanism-a-node-escape.json        E run, A_REFUTED
  12-mechanism-a-python-escape.json      F run, A_REFUTED
  20-mechanism-b-capability.json         B cross-process attach test
  20-mechanism-b-capability.txt          B 5 capability probes
  25-mechanism-b-control.json            B negative control run
  25-mechanism-b-control.txt             B narrative
  30-mechanism-c-availability.txt        C 3-blocker diagnosis
  31-mechanism-c-entitlement.txt         C codesign + entitlement
  40-comparison-matrix.md
  41-mechanism-b-control.json (negative controls)
  50-gates.txt
  result.json

## Probe binaries (production-code-delta NONE)

`tools/macos-host-helper/native/containment-probe/`

  20-mechb-kqueue-probe.c        NOTE_FORK capability probe
  22-mechb-emulator.c            setsid+fork+sleep emulator
  22-mechb-cross-process-test.c  cross-process kqueue test
  22-mechb-self-fork-test.c      same-process fork test
  23-mechb-full-test.c           recursive watcher with sysctl reconcile
  10-mechanism-a-cleanup-ancestry.mjs   non-helper driver (initial)
  11-mechanism-a-helper-driven.mjs      helper-driven (real test)
  22-mechb-capability.mjs               B capability test driver

None of these are wired into the production helper protocol.

## Mechanism verdicts

### A — cleanup-time ancestry reconstruction: REFUTED

After the helper kills the inherited PGID, the detached/setsid'd
grandchild has `ppid=1, pgid=itself`. Current-ppid BFS from rootPid
cannot reach it (macOS does not expose original_ppid to user-space
processes; ppid is rewritten on reparenting).

Apple Developer Documentation confirms the model:
  ppid: "The parent process identifier. ..."
There is no API to retrieve the original parent post-reparent.

Helper-driven test results (`11-mechanism-a-helper-driven.mjs`):

  shell-A       A_NO_ESCAPES_OBSERVED  (helper cleanup succeeded)
  node-B        A_NO_ESCAPES_OBSERVED
  python-C      A_NO_ESCAPES_OBSERVED
  mixed-D       A_NO_ESCAPES_OBSERVED
  node-escape   A_REFUTED              (sleep: ppid=1, pgid=itself)
  python-escape A_REFUTED              (sleep: ppid=1, pgid=itself)

A_CURRENT_PPID_RECONSTRUCTION = REFUTED.

### B — kqueue event-time lineage: RACE_REFUTED

Cross-process kqueue EVFILT_PROC attachment WORKS (Apple's
"If a process can normally see another process, it can attach
an event to it."). On macOS 14.7.4 arm64, the probe attached
to a detached+setsid+exec emulator process and successfully
received subsequent NOTE_FORK events.

However:

  1. **kevent.data is NOT the child PID.** Apple documents
     NOTE_FORK as "The process created a child process via
     fork(2)" — without promising child PID delivery. In every
     observed fork event, kevent.data == 0. The probe must
     reconcile by enumerating children via sysctl KERN_PROC
     after each NOTE_FORK.

  2. **FORK-BEFORE-ATTACH race.** The probe attaches AFTER the
     fixture has been spawned (the production model is
     spawn-then-attach). The fixture's FIRST fork (e.g.
     shell -> node) happens during the spawn window, before
     the helper can install its first watch. The intermediate
     child is invisible to the helper, and the helper has no
     way to discover it.

  3. **5/5 immediate-fork iterations missed** the grandchildren.
     The race is not a one-off — it is the deterministic
     outcome of the production sequence.

Per spec §6.B3:
    If any iteration escapes tracking:
        MECHANISM_B = RACE_REFUTED
        No retries may promote that to safe containment.

B_NOTE_FORK_CAPABILITY = PARTIAL
B_NODE_ESCAPE_ZERO     = RACE_REFUTED
B_PYTHON_ESCAPE_ZERO   = RACE_REFUTED
B_RACE_STRESS_ZERO     = FAIL
B_DOUBLE_FORK_ZERO     = PASS (when race avoided, by external sequencing)

B_NOTE_FORK_CHILD_PID_AVAILABLE = NO

The primitive is structurally correct on the negative-control
axis (process-name-independent, no same-UID sweep, unrelated
PIDs survive — see 25-mechanism-b-control.*). The defect is
specifically the FORK-BEFORE-ATTACH race.

To make B race-free would require:
    1. Helper-mediated spawn (out of scope)
    2. AND pre-spawn snapshot + watch installation before any
       new process is created
    3. AND continuous reconcile against sysctl KERN_PROC for
       owned-UID processes

These are substantial architecture changes beyond this ACT.

### C — Endpoint Security descendants: UNAVAILABLE

Three independent blockers on this substrate:

  1. macOS 14.0 CommandLineTools SDK does NOT ship
     EndpointSecurity.framework headers.
  2. Runtime framework absent from /System/Library/Frameworks,
     /System/Library/PrivateFrameworks, and Cryptex root.
  3. Helper binary is adhoc-signed without a Developer Team,
     so `com.apple.developer.endpoint-security.client`
     entitlement cannot be granted.

C_RUNTIME_ELIGIBILITY = UNAVAILABLE is a legitimate discriminator
result (per spec §24 and §28).

SDK_HAS_es_new_descendants_client       = NO
RUNTIME_OS_HAS_SYMBOL                   = NO
HELPER_CODESIGN_ENTITLEMENT_PRESENT     = NO
CAN_CREATE_DESCENDANTS_CLIENT           = NO

If ES descendants were ever adopted in the future, the
prerequisites are: Developer ID signing, ES-client entitlement,
and a target macOS where the runtime framework is present.

## Selection

This ACT selects **NONE for the current spawn-then-attach production
architecture** and authorizes the next causal discriminator ACT.

A is REFUTED on correctness (cannot reach reparented grandchild).
B is **RACE_REFUTED only in the spawn-then-attach production
sequence**. B's primitive attach-then-spawn direction is PASS
(see `B_DOUBLE_FORK_ZERO = PASS (when race avoided, by external
sequencing)`, `24-mechanism-b-double-fork.json`). The defect is
the spawn-race in the production sequence, NOT the primitive.
C is UNAVAILABLE on this Sonoma 14.7.4 / installed-SDK substrate
(framework absent on this machine + adhoc-signed helper cannot
carry `com.apple.developer.endpoint-security.client`).

**What was proven:**

    A_cleanup_time_ancestry = REFUTED
    B_spawn_then_attach     = RACE_REFUTED
    C_on_this_substrate    = UNAVAILABLE

**What was NOT proven (and was retracted by Factory reviewer
`HALT_CONTAINMENT_CONCLUSION_EXCEEDS_DISCRIMINATOR`, 2026-09-19):**

    NO_SAFE_GENERAL_DESCENDANT_CONTAINMENT_AVAILABLE

That statement exceeded the discriminator evidence. The honest
narrow statement is:

    NO_SAFE_POST_SPAWN_CONTAINMENT
    AVAILABLE_IN_CURRENT_ARCHITECTURE

The primitive's attach-then-spawn direction was never falsified by
this ACT. The same evidence that proves B is RACE_REFUTED for
spawn-then-attach already proves B's primitive mechanism is sound
when the race is avoided by external sequencing. Apple still
documents Endpoint Security as a macOS framework/API family
(https://developer.apple.com/documentation/EndpointSecurity); C
is unavailable on this **substrate** specifically, not as a
general macOS fact.

## Production consequence

Per spec §25 (preserved):

  PGID_ONLY                 = production invariant (preserved)
  ESCAPED_DESCENDANTS       = known unsupported boundary in the
                              current spawn-then-attach sequence
                              (documented, not silently fixed)

A separate successor ACT must falsify (or confirm) the next
causal discriminator before any policy/remediation decision is
authorized. This ACT does NOT make that decision.

## Halt conditions triggered

  - HALT_CONTAINMENT_CONCLUSION_EXCEEDS_DISCRIMINATOR  (applied by
    Factory reviewer 2026-09-19; corrected in this same closure;
    produces the narrowed verdict above and authorizes the
    successor ACT below).
  - `HALT_NO_SAFE_CONTAINMENT_PRIMITIVE_IN_CURRENT_SPAWN_ARCHITECTURE`
    (the discriminated result, narrowed from the original
    over-broad `HALT_NO_SAFE_CONTAINMENT_PRIMITIVE`).

## Halt conditions NOT triggered (verifying non-halt)

  - HALT_UNEXPECTED_TRACKED_DIRT         (working tree clean)
  - HALT_UNRELATED_PROCESS_TARGETED      (negative control passed)
  - HALT_CLIENT_ISOLATION_BROKEN         (no protocol change)
  - HALT_STALE_PID_CAN_BE_KILLED         (helper pid+start_us
                                           binding unaffected)
  - HALT_TERMINATION_WINDOW_ESCAPE       (out of scope for
                                           discriminator; helper
                                           signal authority
                                           unchanged)
  - HALT_MECHANISM_B_RACE                (does not halt the ACT;
                                           it halts B as a candidate
                                           in the spawn-then-attach
                                           sequence)

## Substrate

  macOS 14.7.4 (23H420), Darwin 23.6.0, arm64.
  Helper build_id (live): c5f3ea0322ae92a6ea5378577e39fef95696057b8ad6fba63a1fce57f80b74b9
  Helper pid (live): 9582
  Helper socket (live): /Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock
  EndpointSecurity framework on this substrate: NO (absent from
    /System/Library/Frameworks, /System/Library/PrivateFrameworks,
    and Cryptex root; dlopen fails).
  Helper codesign state: adhoc, no team.

## Successor ACT (NOT a policy/remediation decision)

ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01 — falsify
(or confirm) the next causal discriminator implied by this ACT's
evidence but never run: does kqueue+reconciliation retain complete
ownership through every escape class when the watch is installed
BEFORE the user command's first fork?

ONLY if that ACT reports REFUTED should
ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01 be authorized
to choose between the policy-layer options (a)/(b)/(c). This ACT
does NOT pre-fill the answer.

## Correction history

  - 2026-09-19: corrected closure (this version). Retracts
    `NO_SAFE_GENERAL_DESCENDANT_CONTAINMENT_AVAILABLE` as the
    selection label; narrows the halt label to
    `HALT_NO_SAFE_CONTAINMENT_PRIMITIVE_IN_CURRENT_SPAWN_ARCHITECTURE`;
    authorizes
    `ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01`
    as the next ACT instead of routing directly to
    `ACT-CLINEMM-ESCAPED-DESCENDANT-REMEDIATION-DECISION01`.
