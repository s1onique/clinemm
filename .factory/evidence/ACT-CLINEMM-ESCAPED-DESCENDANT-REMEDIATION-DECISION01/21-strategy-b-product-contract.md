21-strategy-b-product-contract.md
==================================

# Product contract for the PGID-only containment boundary (CORRECTION02 + CORRECTION03)

CORRECTION03 (per `ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01`,
see `.factory/evidence/ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01/02-contract-correction.txt`)
narrows the original §3.3 wording in TWO ways:

  1. `process.kill(-pgid, 0)` returning `ESRCH` is NOT evidence that
     a descendant escaped; it is the kernel's "no process exists in
     that PGID" signal and proves the PRIMARY obligation succeeded.
     The `alive` / `eperm` / `unknown` / `pgid_unset` postconditions
     from `terminalPostconditionProbe` are the only eligible
     containment-failure diagnostics.
  2. The unsupported boundary is broadened from `setsid()` and its
     equivalents to "any process that leaves the CommandJob's primary
     owned PGID", including `setpgid()` / `setpgrp()` and other
     PGID-move mechanisms. Do NOT define the boundary in terms of
     executable names or shell syntax.

The original §3.3 wording is RETRACTED. The corrected doctrine is
captured in §1 / §2 / §3 of
`ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01`. The selection
`B_WITH_C_FUTURE_TRACK` is preserved; CORRECTION03 is a P0
completeness fix to the implementation contract, not a strategy change.

CORRECTION02 narrows a remaining stale claim
(`21-strategy-b-product-contract.md` §6 line stating Strategy C
"requires macOS 15+"). The corrected claim is: Strategy C requires
the current beta API generation (per Apple documentation
`es_new_descendants_client(_:_:)` is Beta; per external
implementation work it is macOS 27-era, absent even from macOS 26.x
SDK/runtime). Strategy C is unavailable on the current Sonoma
substrate. The selection B_WITH_C_FUTURE_TRACK is preserved;
CORRECTION02 is a P0 completeness fix, not a strategy change.

This is the contract ClineMM adopts when Strategy B is selected.
No production code is changed in this ACT; this document is the
specification that the next ACT (ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01)
will implement.

## §1. Contained

What ClineMM **owns and attempts** to clean up when a CommandJob
completes or is cancelled: the CommandJob's primary owned PGID.

What ClineMM **proves** — exactly the sufficient-condition invariant
the implementation establishes:

  CLEAN_TERMINAL CommandJob  ⇒  PRIMARY OWNED PGID GONE

Concretely, the contained set includes:

  (a) The leader process of a CommandJob (rootPid).
  (b) All processes sharing the leader's primary PGID at the time
      of cancellation or completion.
  (c) All descendants of (a) that have not left the primary PGID
      via setsid, setpgid/setpgrp, Node detached:true (with setsid),
      Python start_new_session=True, double-fork-and-exit, or
      nohup-and-disown.

These are terminated together when the user cancels or the CommandJob
completes, via the host-helper's owned-PGID signal authority
(ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01).

The contract is honest about what it does **not** universalize:
when the primary-PGID postcondition cannot be established (`alive`,
`eperm`, `unknown`, `pgid_unset`), the job terminates as
`containment_failed` and a runtime incident is surfaced. The
sufficient-condition invariant is preserved by construction — every
cleanly terminal job has its primary PGID proven gone; only jobs
whose cleanup cannot be proven reach `containment_failed`.

## §2. Not contained

The following are explicitly OUTSIDE the containment guarantee:

  (d) Any process that has called setsid() (or its Node detached:true /
      Python start_new_session=True equivalent) since being spawned
      by a CommandJob. Such processes are in their own session and
      process group; they cannot be reached by signaling the
      CommandJob's leader PGID.
  (e) Any process whose parent has exited (orphaned) and which has
      been reparented to launchd (ppid=1). Such processes are also
      outside the CommandJob's PGID.
  (f) Same-UID processes that happen to exist on the system but are
      not descendants of any CommandJob. ClineMM MUST NOT attempt
      to enumerate, signal, or terminate these (no same-UID sweep).

## §3. Surface conditions

ClineMM agrees to:

  1. Never claim "zero descendants" of a CommandJob that has finished
     or been cancelled.
  2. Keep the ⎇ indicator as the active CommandJob count (already
     correct after ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01).
  3. CORRECTION03 (per ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01):
     Surface a runtime containment diagnostic only when the OWNED
     primary-PGID postcondition itself fails or is indeterminate
     (the `alive` / `eperm` / `unknown` / `pgid_unset` classifications
     emitted by `command_job_primary_group_cleanup` /
     `command_job_containment_failed`). The original §3.3 wording
     ("Surface a containment-boundary diagnostic when an escape is
     OBSERVED or strongly INDICATED ... OR `process.kill(-pgid, 0)`
     returns ESRCH during cleanup") is RETRACTED — `ESRCH` is the
     kernel's "no process exists in that PGID" signal and proves the
     PRIMARY obligation succeeded; it says nothing about descendants
     that previously moved into another PGID. See
     `.factory/evidence/ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01/02-contract-correction.txt`.
  4. Document detached/sessionized background work as unsupported.
     CORRECTION03: broadened from `setsid()` / `Node detached:true` /
     `Python start_new_session=True` to "any process that leaves the
     CommandJob's primary owned PGID", including `setpgid()` /
     `setpgrp()` and other PGID-move mechanisms. Do NOT define the
     boundary in terms of executable names or shell syntax.
  5. Never sweep same-UID processes attempting to compensate.

## §4. Failure modes the contract acknowledges

The following are KNOWN FAILURE MODES that the contract accepts:

  - Cancellation that leaves a session-detached descendant running
    until natural completion.
  - A user-supplied `nohup long-running-job &` that survives a
    CommandJob cancel.
  - A user-supplied Node script that does
    `spawn("daemon", [], {detached:true}).unref()` and continues
    running past the CommandJob's end.
  - A user-supplied shell that double-forks a long-lived worker.

These are NOT bugs of ClineMM; they are consequences of the
fundamental macOS process model in which any process may detach
its descendants from any session it does not own.

## §5. Why this contract is acceptable for ClineMM

  - It matches the production behavior of all four primary
    ClineMM subsystems that intentionally use detached:true
    (connector supervisor, hub daemon, browser automation,
    supervised-bash executor's own PGID leadership).
  - It matches upstream Cline's existing process model.
  - It does not introduce new failure modes; the failure modes it
    acknowledges already existed (they were just unstated).
  - It is testable: the absence of a containment guarantee is
    verifiable by the existing substrate-halt documentation
    (ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01,
    ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01).
  - It is honest: the user is told the boundary rather than being
    promised a guarantee the substrate cannot provide.

## §6. Why this contract is preferable to Strategy A or C on this
substrate

  - Strategy A is not enforceable in this execution context
    (UNAVAILABLE_FROM_CURRENT_EXECUTION_CONTEXT) and is NOT_PROVEN
    on Sonoma generally (see 10-/11-/12-strategy-a-*.txt).
  - Strategy C requires (a) the Endpoint Security entitlement
    (not available on this adhoc-signed helper), (b) Developer ID
    signing, (c) the current beta API generation — per Apple
    documentation `es_new_descendants_client(_:_:)` is **Beta**
    and per external implementation work it is a **macOS 27-era**
    API absent even from the macOS 26.x SDK/runtime. Do NOT infer
    "macOS 15 floor" merely because SDK 14 lacks the symbol. The
    current Sonoma substrate is UNAVAILABLE for Strategy C.
    Strategy C is a future research track, not a current contract.
  - Strategy B is what already works and what already matches
    upstream behavior; making it explicit only adds clarity.

## §7. What the next ACT must do (NOT in this ACT)

  - CORRECTION03: the diagnostic surface is now the OWNED primary-PGID
    postcondition failure (see §3.3 corrected wording), NOT a
    watchdog observation of escaped descendants. Wire the
    `command_job_containment_failed` lifecycle event into the
    existing `runtimeErrorCount` telemetry path so ⚠ N reflects the
    observed containment failure. Use a single incident per
    CommandJob terminal verdict (the `command_job_containment_failed`
    event is the user-visible authority; earlier diagnostic events
    are observed but MUST NOT increment the user counter).
  - Update product documentation to reflect the boundary (§3.4).
  - Update the chat/task UI to show the diagnostic (the ⎇ tooltip
    MUST disclose the primary-PGID cleanup scope).
  - DO NOT add same-UID sweeping machinery (§3.5).
  - DO NOT add command-text heuristics (§§7, 22 of the ACT spec).
  - DO NOT add any anti-overclaim language that promises
    "zero descendants", "all spawned processes terminated", or any
    similar claim about escaped descendants — those are LIVE
    UNOBSERVABLE from the current production seam.

## §8. What ClineMM does NOT promise

ClineMM does not promise:
  - Universal descendant containment.
  - Cleanup of session-detached processes on cancellation.
    CORRECTION03: broadened to "cleanup of any process that has
    left the CommandJob's primary owned PGID, regardless of the
    mechanism that moved it (setsid, setpgid/setpgrp, Node
    detached:true, Python start_new_session=True, double-fork
    daemonization, nohup/disown patterns, etc.)".
  - That ⎇ counts the actual number of owned processes on the system
    (⎇ counts active CommandJobs; some of those may have leaked
    descendants that are no longer tracked).
