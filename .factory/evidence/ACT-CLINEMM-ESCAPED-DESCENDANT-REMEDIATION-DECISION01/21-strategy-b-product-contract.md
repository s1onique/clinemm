21-strategy-b-product-contract.md
==================================

# Product contract for the PGID-only containment boundary

This is the contract ClineMM adopts when Strategy B is selected.
No production code is changed in this ACT; this document is the
specification that the next ACT (ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01)
will implement.

## §1. Contained

The following ARE within the ClineMM containment guarantee:

  (a) The leader process of a CommandJob (rootPid).
  (b) All processes sharing the leader's primary PGID at the time
      of cancellation or completion.
  (c) All descendants of (a) that have not performed a session-escape
      operation (setsid, detached:true with setsid, start_new_session,
      double-fork-and-exit, nohup-and-disown).

These are terminated together when the user cancels or the CommandJob
completes, via the host-helper's owned-PGID signal authority
(ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01).

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
  3. Surface a containment-boundary diagnostic when an escape is
     OBSERVED or strongly INDICATED (e.g. a watchdog process notices
     the leader exited but a known-child pid is still alive, OR
     `process.kill(-pgid, 0)` returns ESRCH during cleanup).
  4. Document detached/sessionized background work as unsupported.
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

  - Strategy A is not enforceable (see 10-/11-/12-strategy-a-*.txt).
  - Strategy C requires the Endpoint Security entitlement (not
    available on this adhoc-signed helper) AND requires macOS 15+
    for the descendants-client API (not available on this Sonoma
    host). It is a future research track, not a current contract.
  - Strategy B is what already works and what already matches
    upstream behavior; making it explicit only adds clarity.

## §7. What the next ACT must do (NOT in this ACT)

  - Surface the containment-boundary diagnostic (§3.3) when a
    CommandJob finishes or is cancelled but the host-helper
    reports known-child-escaped (e.g. via the existing watchdog
    primitive in ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01).
  - Update product documentation to reflect the boundary (§3.4).
  - Update the chat/task UI to show the diagnostic.
  - DO NOT add same-UID sweeping machinery (§3.5).
  - DO NOT add command-text heuristics (§§7, 22 of the ACT spec).

## §8. What ClineMM does NOT promise

ClineMM does not promise:
  - Universal descendant containment.
  - Cleanup of session-detached processes on cancellation.
  - That ⎇ counts the actual number of owned processes on the system
    (⎇ counts active CommandJobs; some of those may have leaked
    descendants that are no longer tracked).
