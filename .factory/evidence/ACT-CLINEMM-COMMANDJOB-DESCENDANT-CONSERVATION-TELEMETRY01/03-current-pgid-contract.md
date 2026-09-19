# 03-current-pgid-contract.md
#
# Empirical summary of the current CommandJobManager ownership
# contract. Source: live helper-driven discriminator runs against
# the production helper LaunchAgent (io.clinemm.host-helper,
# build_id captured in 00-entry.txt). The full per-fixture JSON
# dumps are in:
#
#   shell-A.json   (sh -c, bash+sleep children, grandchild)
#   node-B.json    (node + sleep child)
#   python-C.json  (python + sleep child)
#   mixed-D.json   (zsh -> python -> node -> sleep)
#   node-escape.json    (Node detached:true, new session)
#   python-escape.json  (Python start_new_session=True, setsid)
#
# Substrate note: this run was driven from the same sandboxed IDE
# shell that ACT-CLINEMM-REAL-LAUNCHAGENT-SIGNAL-DISCRIMINATOR02
# reproduced the EPERM on. Direct `kill(-pgid, ...)` is denied by
# the seatbelt; the helper LaunchAgent is the only way to deliver
# the signal. This means:
#
#   1. The discriminator exercises the production recovery path
#      exactly (helper.terminate -> SIGTERM -> grace -> SIGKILL
#      escalation, all from inside the trusted helper).
#   2. Every fixture's `directTerm.probeBeforeTerm.rc = 1` is the
#      substrate EPERM — not a contract defect, just the substrate.
#
# Honest seam labels (per ACT factory convention):
#   TARGET_SPAWN         = REAL | LIVE | PRODUCTION_FUNCTION
#   DIRECT_CANCEL_RED    = SYNTHETIC_REAL | HELPER_TERMINATION_PRIMITIVE
#   REAL_COMMANDJOBMANAGER_SEAM = NOT_EXECUTED
#   (The discriminator drives the production helper wire protocol
#    byte-identical to HostHelperPgidProvider, but does not
#    instantiate CommandJobManager / no FSM / no telemetry hooks.)

# ----------------------------------------------------------------------------
# Result matrix (canonical)
# ----------------------------------------------------------------------------

| Fixture | Comm    | beforeMemberCount | afterMemberCount | afterDescendantCount | PGID_gone | members_gone | descendants_zero |
|---------|---------|-------------------|------------------|----------------------|-----------|--------------|------------------|
| shell-A | sh      | 5                 | 0                | 0                    | (rc=1)    | true         | TRUE             |
| node-B  | node    | 2                 | 0                | 0                    | (rc=1)    | true         | TRUE             |
| python-C| python  | 2                 | 0                | 0                    | (rc=1)    | true         | TRUE             |
| mixed-D | zsh+py+ | 3                 | 0                | 0                    | (rc=1)    | true         | TRUE             |
| node-escape   | node detached:true   | 2 | 0 | 1 | (rc=1) | true | **FALSE** |
| python-escape | python start_new_sess| 2 | 0 | 1 | (rc=1) | true | **FALSE** |

# ----------------------------------------------------------------------------
# Architectural conclusion (CASE B REPRODUCED)
# ----------------------------------------------------------------------------

The current PGID-only contract holds for the bounded trees
(fixtures A-D) but FAILS for explicit PGID/session escape
(fixtures E-F):

  - `shell-A`        -> all 5 members of original PGID gone
  - `node-B`         -> all 2 members gone
  - `python-C`       -> all 2 members gone
  - `mixed-D`        -> all 3 members gone
  - `node-escape`    -> 1 descendant survived (sleep, reparented to PID 1)
  - `python-escape`  -> 1 descendant survived (sleep, reparented to PID 1)

This is **CASE B: descendant changed PGID/session** — the
documented Node.js `detached:true` and Python `start_new_session=True`
behaviors. The current architecture (host-helper-owned PGID) does
NOT extend to descendants that deliberately leave the inherited
group, because the helper's authority is rooted in the original
PGID — once a descendant calls `setsid()` or uses `detached:true`,
its process group becomes its own PID, and the helper has no
authority over the new group.

Implication for THIS closure:
  - The current contract is **conservative-correct for the bounded
    case** but is documented as OUT OF SCOPE for the escape case.
  - The architectural fix for the escape case requires a successor
    ACT that moves the ownership boundary lower than user-space PGID
    bookkeeping (likely: a LaunchAgent helper that supervises the
    spawned command itself, not just its PGID).
  - The bounded production fix in THIS ACT:
      * makes the postcondition probe explicit ("primary PGID gone"),
      * adds a CommandJob-level activeOwnedGroups gauge so the user
        can see at a glance whether something is still owned,
      * broadens the ⚠ N counter taxonomy so future escape incidents
        have a place to land.

# ----------------------------------------------------------------------------
# What this evidence does NOT show
# ----------------------------------------------------------------------------

  - It does NOT claim the helper can clean up escaped descendants.
    It documents the substrate and proves the bounded case.
  - It does NOT change production code (this is a recon+design ACT).
  - It does NOT exercise the full CommandJobManager FSM (no
    CommandJobManager instance, no telemetry hooks, no
    deadline timers). The discriminant that closes that gap is
    a follow-on ACT.

# ----------------------------------------------------------------------------
# Discriminator outputs
# ----------------------------------------------------------------------------

Per-fixture JSON dumps live next to this file as `*.json`. The
consolidated re-run output is in `02-ownership-recon.txt`.

# ----------------------------------------------------------------------------
# Appendix A — Production fix delivered
# ----------------------------------------------------------------------------

Three new public surfaces land alongside this evidence document:

1. `CommandJobManager.getActiveCommandJobs(): CommandJobHandle[]`
   in `apps/vscode/src/sdk/command-job-manager.ts`. Returns a
   snapshot of every CommandJob whose terminal state has not yet
   been committed (i.e. the "still in `active`" set). The
   snapshot is immutable; callers can read it without
   coordinating against the manager. (Renamed from
   `getActiveOwnedCommandJobs` in the bounded fix cycle.)

2. `CommandJobManager.probeOwnedGroups(): ReadonlyArray<{
   jobId, pgid, state: 'gone' | 'alive' | 'eperm' | 'unknown' }>`.
   The postcondition probe — walks every registered primary PGID
   and classifies each by `kill(-pgid, 0)`. Synchronous (no
   `await`). Fail-closed: ESRCH -> gone, rc=0 -> alive
   (explicit evidence the bounded invariant is violated),
   EPERM -> sandbox substrate, anything else -> unknown
   (never silently coerced to gone). `eperm` and `unknown` are
   reported as distinct statuses (not collapsed into `gone`)
   so the host can route them through `⚠` if they surface in
   the future.

3. `CommandJobManager.onCommandJobLifecycle: (event:
   CommandJobLifecycleEvent) => void` plus the
   `CommandJobLifecycleEvent` union (8 event kinds:
   `process_started`, `primary_group_registered`,
   `termination_started`, `primary_group_probe`,
   `primary_group_cleanup`, `terminal_requested`,
   `terminal_committed`, `residual_detected`). Every event
   carries `activeCommandJobs: number` — the size of the
   active-owned map AT THE TIME of the event, AFTER the delta.
   (The field was renamed from `activeOwnedCommandJobs` in the
   bounded fix cycle — the gauge measures jobs still in
   `active`, not live descendants. See Appendix A above.)

Conservation invariant — BOUNDED (pinned by DCCT-01..11 in
`apps/vscode/src/sdk/__tests__/command-job-manager-descendant-conservation.dcct01.test.ts`):

   TERMINAL CommandJob ⇒ PRIMARY OWNED PGID GONE

operationally: the helper-mediated terminal transition runs
`kill(-savedPgid, 0)` BEFORE discarding the job's identity,
classifies the result in the fail-closed set
{ gone, alive, eperm, unknown }, and emits
`command_job_primary_group_cleanup` with `postcondition`. Only
ESRCH qualifies as evidence the primary PGID is gone; rc=0 is
explicit evidence the bounded invariant has been violated;
EPERM is the sandbox substrate; unknown errnos are reported as
such and never silently coerced to gone.

This is **strictly weaker** than the headline statement the
ACT initially claimed:

   TERMINAL CommandJob ⇒ ZERO LIVE ClineMM-OWNED DESCENDANTS

That headline is REFUTED by the escape fixtures (E-F above):
Node `detached:true` and Python `start_new_session=True`
documentedly create a new process group / session, so the
helper's authority over the inherited PGID does not extend to
descendants that have moved. The bounded invariant above is
what the implementation actually delivers and what DCCT-11
asserts at the kernel boundary.

The escape case is the load-bearing result of this ACT and is
the entry condition for the successor ACT
`ACT-CLINEMM-HELPER-SUPERVISED-COMMAND-CONTAINMENT01` — a
helper-supervised spawn primitive whose authority boundary is
lower than user-space PGID bookkeeping.

# ----------------------------------------------------------------------------
# Appendix B — Webview telemetry delivered
# ----------------------------------------------------------------------------

The ownership gauge is rendered in the task-header telemetry strip
as `⎇ N` (Unicode U+238F). New file:

  `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.gauge.test.tsx`

covers the webview seam (10/10 GREEN: G-01..G-10):

  G-01  hidden when the wire field is absent
  G-02  hidden when the wire field is exactly 0
  G-03  rendered when > 0
  G-04  independent of `runtimeErrorCount` (the `⚠` glyph)
  G-05  independent of cumulative `>_` count
  G-06  process-name agnostic (no executable-name string matching)
  G-07  count text exactly matches the wire value
  G-08  absent field == zero (Hub/Remote equivalence)
  G-09  rendered testid is `task-header-active-owned-command-jobs`
  G-10  aria-label carries the count

The `⚠ N` glyph was broadened to "runtime incidents" in scope —
its existing `RuntimeErrorIncident` payload type is unchanged, so
no consumer of `taskTelemetry.runtimeErrorCount` regresses.

# ----------------------------------------------------------------------------
# Appendix C — Host wiring
# ----------------------------------------------------------------------------

`SdkController.handleCommandJobLifecycle` in
`apps/vscode/src/sdk/SdkController.ts` is the single
host-side consumer. It forwards every event to the canonical
`TaskTelemetryTracker.recordActiveOwnedCommandJobs(n)` method
(no counter, no reducer, no React-state updater on the host
side) and schedules a coalesced `postStateToWebview` on the
next tick. Errors thrown by the tracker are caught + logged so
a tracker bug can never poison the manager's runtime path.

`VscodeSessionHost.create({ onCommandJobLifecycle })` threads
the sink through; all 6 production call sites in
`SdkController.ts` wire the closure.

