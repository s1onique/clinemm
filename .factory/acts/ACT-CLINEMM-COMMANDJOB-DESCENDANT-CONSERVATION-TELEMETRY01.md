# ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01

## Goal

Broaden the CommandJob cleanup invariant from Node-specific
leakage to **all ClineMM-owned descendant processes**
(executable-name-agnostic). Deliver bounded production fixes:

  1. Postcondition probe (`probeOwnedGroups`) so the host can
     verify "primary owned PGID gone" at any point — fail-closed
     classification { gone, alive, eperm, unknown }.
  2. Lifecycle telemetry (`onCommandJobLifecycle` sink + the
     `CommandJobLifecycleEvent` union) so the host observes every
     ownership delta AND every terminal-transition postcondition.
  3. A live gauge (`⎇ N`) so the user sees at a glance whether
     anything is still in `active`.
  4. Broaden `⚠ N` to runtime incidents so future escape-class
     incidents have a place to land.

## Inputs (recon)

  - `.factory/evidence/.../00-entry.txt`
  - `.factory/evidence/.../02-ownership-recon.txt`
  - `.factory/evidence/.../03-current-pgid-contract.md`
  - `.factory/evidence/.../{shell-A,node-B,python-C,mixed-D,node-escape,python-escape}.json`

## Outputs (production fixes)

  - `apps/vscode/src/sdk/command-job-manager.ts`
      * `getActiveCommandJobs(): ReadonlyArray<...>` snapshot
        (renamed from `getActiveOwnedCommandJobs`).
      * `probeOwnedGroups(): ReadonlyArray<{ jobId, pgid, state: 'gone' | 'alive' | 'eperm' | 'unknown' }>`
        fail-closed probe (no silent coerce to gone).
      * `onCommandJobLifecycle?: (event: CommandJobLifecycleEvent) => void`
        + `CommandJobLifecycleEvent` union (8 event kinds).
      * `command_job_primary_group_cleanup` event now carries
        `postcondition` (replacing `helperFallbackUsed`) and is
        emitted in `finalize()` BEFORE `active.delete(job.id)` —
        this is the load-bearing seam for the bounded invariant.
      * Lifecycle emits wired into start / terminate / cancel /
        runTerminationSequence / finalize / dispose.
  - `apps/vscode/src/sdk/task-telemetry-tracker.ts`
      * `recordActiveCommandJobs(n)` (renamed).
      * `currentActiveCommandJobs` getter.
      * `activeCommandJobs` field in `get()` projection.
  - `apps/vscode/src/shared/ExtensionMessage.ts`
      * `TaskHeaderTelemetryStrip.activeCommandJobs?: number`
        (renamed; wire field name change).
  - `apps/vscode/src/sdk/vscode-session-host.ts`
      * threads `onCommandJobLifecycle` through
        `VscodeSessionHostOptions`.
  - `apps/vscode/src/sdk/SdkController.ts`
      * `handleCommandJobLifecycle` closure +
        `scheduleGaugePost` + wires all 6 production
        `VscodeSessionHost.create` call sites.
  - `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`
      * renders `⎇ N` glyph.
  - `apps/vscode/src/sdk/__tests__/command-job-manager-descendant-conservation.dcct01.test.ts`
      * new file, 11 tests (DCCT-01..11), all green.
  - `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.gauge.test.tsx`
      * new file, 10 tests (G-01..G-10), all green.

## Conservation invariant — BOUNDED (correction06)

    CLEAN_TERMINAL CommandJob ⇒ PRIMARY OWNED PGID GONE

operationally: the helper-mediated terminal transition runs
`kill(-savedPgid, 0)` BEFORE discarding the job's identity,
classifies the result in the fail-closed set
{ gone, alive, eperm, unknown }, and emits
`command_job_primary_group_cleanup` with `postcondition`. Only
ESRCH qualifies as evidence the primary PGID is gone; rc=0 is
explicit evidence the bounded invariant has been violated;
EPERM is the sandbox substrate; unknown errnos are reported as
such and never silently coerced to gone.

**correction06 — bounded invariant is held by the state
machine, not just by the event claim.**

A CommandJob is `CLEAN_TERMINAL` iff its `CommandJobState`
is one of `{ exited, deadline_exceeded, cancelled, spawn_failed }`
(NOT `containment_failed`) AND its postcondition probe returned
`gone`. The state assignment is DEFERRED in `finalize()`:
when postcondition ≠ `gone`, the caller's clean terminal
class (e.g. `cancelled`) is OVERWRITTEN with
`containment_failed` BEFORE the job leaves `active`. Together
with the `terminal_committed`-gating from correction05, the
invariant `CLEAN_TERMINAL ⇒ PRIMARY OWNED PGID GONE` holds by
construction.

correction06 also closes the gauge-conservation bug
correction05 introduced: on the failure path, a NEW lifecycle
event `command_job_containment_failed` fires AFTER
`this.active.delete(job.id)`, carrying the live ownership
gauge post-delete so the tracker decrements from N to N-1.
Without this event the `⎇ N` gauge would stay stuck at N even
though the manager had thrown the job out of `active`.

## Invariants pinned

  DCCT-01..05  `getActiveCommandJobs()` shape + cardinality.
  DCCT-04      probe classification is fail-closed; `unknown`
               is a valid state (not silently `gone`).
  DCCT-06..09  lifecycle sink semantics (events, no command
               text in payload, no-op default, throw-safe).
  DCCT-10      process-name agnosticism (no executable-name
               string matching in cleanup path).
  DCCT-11      LOAD-BEARING (correction06): postcondition
               `gone` → `state` is the caller's clean terminal
               class (NOT `containment_failed`);
               `containmentFailed: undefined`;
               `command_job_terminal_committed` fires;
               `command_job_containment_failed` does NOT fire.
               The bounded invariant is satisfied by
               construction.
  DCCT-12      correction06 — postcondition `alive` →
               `state := "containment_failed"` (overwriting
               the caller's `"cancelled"`),
               `containmentFailed := "substrate_alive"`,
               `command_job_terminal_committed` DOES NOT fire,
               `command_job_residual_detected` fires (pre-delete
               obs), `command_job_containment_failed` fires
               AFTER `active.delete` with `activeCommandJobs = 0`
               (gauge decrements N→N-1).
  DCCT-13      correction06 — postcondition `eperm` → same
               shape with `containmentFailed := "substrate_eperm"`.
  DCCT-14      correction06 — postcondition `unknown` → same
               shape with `containmentFailed := "substrate_unknown"`.
  DCCT-15      correction05 — type-level witness for the new
               `command_job_helper_cleanup_attempted` event
               (helperOutcome: `success` | `denied` | `failed`).
               Disambiguates "helper attempt" from "authoritative
               kernel probe" so consumers no longer rely on
               chronology.

  G-01..G-10   webview seam tests for the `⎇ N` glyph.

## What this ACT does NOT prove

  - It does NOT prove "TERMINAL CommandJob ⇒ ZERO LIVE
    ClineMM-OWNED DESCENDANTS." That headline is REFUTED by
    escape fixtures E-F (Node `detached:true` and Python
    `start_new_session=True`) — see Appendix A of
    `03-current-pgid-contract.md` and the row `descendants_zero
    = FALSE` for those rows in the result matrix.
  - It does NOT clean up descendants that have moved out of
    the inherited PGID. That requires a helper-supervised spawn
    primitive (the successor ACT).

## Successor ACT

`ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01` —
**re-scoped per Factory reviewer P1 (2026-09-18)** as
`CONTAINMENT_PRIMITIVE_DISCRIMINATOR`, not a frozen-mechanism
ACT. The earlier draft assumed a cleanup-time PPID walk which
is not established on macOS after reparenting (Apple
distinguishes `ppid` from `original_ppid`). The re-scoped ACT
discriminates three candidate authority primitives against the
reproduced E/F escapes before freezing a mechanism. See the
ACT file for the discriminator decision procedure.

## Gates

  - `bunx tsc --noEmit` clean.
  - `bun vitest run src/sdk/__tests__/command-job-manager-descendant-conservation.dcct01.test.ts` 15/15 GREEN (correction05: DCCT-11 strengthened + DCCT-12..15 composition matrix).
  - `bun vitest run src/sdk/__tests__/task-header-runtime-error-counter-rec01.test.ts` 13/13 GREEN.
  - `bun vitest run src/components/chat/task-header/TaskHeaderTelemetry.test.tsx` 46/46 GREEN.
  - `bun vitest run src/components/chat/task-header/TaskHeaderTelemetry.gauge.test.tsx` 10/10 GREEN.

Total: 84/84 tests, 6/6 gates PASS.

## Verdict (correction06 / post-third-reviewer)

  PRIMARY_PGID_POSTCONDITION_OBSERVED    = PROVEN (probe runs synchronously inside finalize())
  PRIMARY_PGID_CONSERVATION               = PROVEN — re-stated as
                                              `CLEAN_TERMINAL ⇒ PRIMARY OWNED PGID GONE`
                                              (was: `TERMINAL ⇒ ...`).
                                              State machine holds by
                                              construction (correction06):
                                              non-gone postconditions
                                              overwrite the caller's
                                              clean terminal class with
                                              `containment_failed`.
  PRIMARY_PGID_POSTCONDITION_FAIL_CLOSED  = PROVEN (no silent coerce; alive/eperm/unknown distinct)
  HELPER_EVENT_DISAMBIGUATION             = PROVEN (helper_cleanup_attempted vs primary_group_cleanup)
  CONTAINMENT_FAILED_TERMINAL_CLASS       = PROVEN (CommandJobState member; populated via deferred state assignment)
  GAUGE_CONSERVATION_ON_FAILURE_PATH      = PROVEN (command_job_containment_failed fires AFTER active.delete with post-delete gauge — closes the stale-⎇N bug)
  ACTIVE_JOB_GAUGE                        = GREEN (`⎇ N` works, 84 tests pass)
  ZERO-DESCENDANT_GAUGE                   = NOT IMPLEMENTED (renamed honest label)
  DESCENDANT_CONSERVATION                 = REFUTED by escape fixtures
  CASE_B                                  = REPRODUCED

## Halt sequence

  1. `HALT_DESCENDANT_CONSERVATION_NOT_PROVEN` (correction04 bounded fix cycle applied)
  2. `HALT_PRIMARY_PGID_CONSERVATION_NOT_ENFORCED` (correction05 bounded fix cycle applied — terminal_committed gated on gone)
  3. `HALT_PRIMARY_PGID_CONSERVATION_STILL_NOT_ENFORCED` (correction06 bounded fix cycle applied — explicit containment_failed terminal class + post-delete gauge-conservation event)
  4. **No further HALT expected for the bounded invariant.** The state machine and the event semantics are both honest: a `CLEAN_TERMINAL` job is exactly one whose bounded invariant was proven. The escape case remains REFUTED for the bounded invariant and OUT-OF-SCOPE for the helper-supervised boundary until the successor ACT's discriminator completes.

## C1 GO directive (per Factory reviewer)

  After correction06 closes, **GO directly to the
  containment-primitive discriminator**
  (ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01,
  re-scoped as `CONTAINMENT_PRIMITIVE_DISCRIMINATOR`). No
  further review of the gauge or PGID telemetry unless a new
  P0 appears.

## Closure

See `.factory/epic-board.md` for the closure entry.
