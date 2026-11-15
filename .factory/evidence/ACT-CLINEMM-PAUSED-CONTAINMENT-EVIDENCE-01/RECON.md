# ACT-CLINEMM-PAUSED-CONTAINMENT-EVIDENCE-01 — Production seam map (C1)

**Subject**: incident `incident-mwh1jzpl-8-d3g1w5`, task/session `1794697115819_0ftrq`, epoch 21.
**ENTRY_HEAD**: `043a0606f5f43b0d742f8fa0b6a05c7014bf2fce` (branch `act/clinemm-paused-containment-evidence-01`).
**Nature of this ACT**: evidence acquisition + causal discrimination only. No repair, no behavioral change.

All paths below are relative to the repository root
`<REPO>`.

---

## 1. Background process spawn, PID/PGID ownership, process-birth identity

| Stage | Producer | Location |
|---|---|---|
| Spawn (`detached: true` -> own process group) | `CommandJobManager.start` | `apps/vscode/src/sdk/command-job-manager.ts:2624` (event emit), spawn shape at `:3930` |
| Root PID capture | `readRootPidFromSupervisor` | `apps/vscode/src/sdk/command-job-manager.ts:4285` |
| PGID capture | `readPgidFromSupervisor` | `apps/vscode/src/sdk/command-job-manager.ts` (helper near `:4285`) |
| Process-birth identity published | `command_job_process_started` (`rootPid`, `pgid`, `detached: true`) | `apps/vscode/src/sdk/command-job-manager.ts:2619-2627` |
| Group registration | `command_job_primary_group_registered` | `apps/vscode/src/sdk/command-job-manager.ts:2637-2646` |
| Terminal class derivation (`exited` / `cancelled` / `deadline_exceeded`) | exit transition closure | `apps/vscode/src/sdk/command-job-manager.ts:2650-2660` |

**Classification: OBSERVABLE_NOW (production seam) / UNAVAILABLE_FROM_TRACE (incident).**
The `command_job_process_started` event carries `rootPid` + `pgid`, but the incident
runtime's **background-job-liveness-authority.jsonl** was last written `2026-11-05`
and the runtime-diag traces contain no command-job lifecycle events. The incident
therefore has **no recorded process-birth identity**; the archive's `pid`/`pgid`
values come from the *containment-failure* record (post-hoc), not from the birth
event. The recorded `pid == pgid` (9667/9667, 13450/13450) is consistent with a
`detached` POSIX spawn whose root PID equals its PGID.

---

## 2. Cancellation / termination requests and actual signal attempts

| Stage | Producer | Location |
|---|---|---|
| Stop request -> supervisor `terminateTree` | `CommandJobManager` termination sequence | `apps/vscode/src/sdk/command-job-manager.ts:2938-2941` (`gracefulSignal: "SIGTERM"`, `TERM_GRACE_MS`) |
| Signal target | the **owned process group** (`-pgid`), never a bare PID | `apps/vscode/src/sdk/command-job-manager.ts:3887-3930` (detached-group helper) |
| EPERM authority | SDK primitive `terminateTree` -> `TerminateTreeResult.epermDetected` is the **single** canonical EPERM signal | `apps/vscode/src/sdk/command-job-manager.ts:2931-2937` |
| Post-terminate probe event | `command_job_primary_group_probe` | `apps/vscode/src/sdk/command-job-manager.ts:2951-2960` |
| Tree-escape latch | `job.treeEscapee = true` when the OS still reports the PG alive after grace + SIGKILL | `apps/vscode/src/sdk/command-job-manager.ts:3086-3094` |

**Classification: OBSERVABLE_NOW (seam) / UNAVAILABLE_FROM_TRACE (incident).**
The incident trace records **no** signal-attempt record: the archive has no
"signal attempt" field, and the live extension-host log contains zero
`command_job_primary_group_probe` / `command_job_termination_started` lines for
either job. The `terminal_execution` telemetry lines at `23:21:00.642Z` /
`23:21:56.256Z` carry only `success`/`exitCode`/`terminalExecutionMode`, **not** the
signal target, signal name, or OS result. This is the **first lossy boundary** for
the "actual signal attempt/result" field.

---

## 3. After-signal OS postcondition

| Stage | Producer | Location |
|---|---|---|
| Postcondition probe (default, fail-closed) | `defaultTerminalPostconditionProbe` -> `process.kill(-pgid, 0)` | `apps/vscode/src/sdk/command-job-manager.ts:4260-4274` |
| Verdict taxonomy | `gone` (ESRCH) / `alive` (rc=0) / `eperm` (EPERM) / `unknown` (other) | `apps/vscode/src/sdk/command-job-manager.ts:573`, `:584-595` |
| Synchronous probe at finalize | `CommandJobManager.finalize` | `apps/vscode/src/sdk/command-job-manager.ts:3176-3212` |
| Cleanup event with verdict | `command_job_primary_group_cleanup` | `apps/vscode/src/sdk/command-job-manager.ts:3197-3204` |
| Failure-class mapping | `substrate_alive` / `substrate_eperm` / `substrate_unknown` / `pgid_unset` | `apps/vscode/src/sdk/command-job-manager.ts:3228-3234` |

**Classification: OBSERVABLE_NOW.**
The archive's `containment-provenance.json` records `postcondition: "alive"` with
`osErrorCode: null` for **both** jobs. Under `defaultTerminalPostconditionProbe`
that pair is **only** producible by `process.kill(-pgid, 0)` returning **rc=0** --
i.e. the probe was **permitted** and the kernel reported the group as **existing**.
`alive` is never emitted for EPERM (that maps to `eperm`) nor for ESRCH (`gone`).
Therefore the historical containment failure was a **genuine survivor verdict at
probe time**, not a denied probe and not a stale projection.

---

## 4. The event that publishes `containment_failed`, and the retained terminal state

| Stage | Producer | Location |
|---|---|---|
| Terminal state overwrite | `terminalState = "containment_failed"` when `postcondition !== "gone"` | `apps/vscode/src/sdk/command-job-manager.ts:3220-3235` |
| Runtime-error latch (one warning per failure) | `reportRuntimeError({errorClass:"command_containment_failed", source:"command-job-manager", correlationId: job.id})` | `apps/vscode/src/sdk/command-job-manager.ts:3475-3482` |
| Lifecycle publication | `command_job_containment_failed` | `apps/vscode/src/sdk/command-job-manager.ts:3483-3490` |
| Terminal retention | `this.terminal.set(job.id, job)` + bounded `terminalOrder` eviction | `apps/vscode/src/sdk/command-job-manager.ts:3537-3549` |
| Controller projection write (`backgroundCommandJobStates[jobId] = "containment_failed"`) | `SdkController.updateBackgroundCommandState` | `apps/vscode/src/sdk/SdkController.ts:6217-6233` |
| Controller owner write | `backgroundCommandJobOwners[jobId] = ownerSessionId` | `apps/vscode/src/sdk/SdkController.ts:6239-6241` |
| Controller-side publication capture | `containment_terminal_state_published` | `apps/vscode/src/sdk/SdkController.ts:6253-6262` |

**Classification: OBSERVABLE_NOW.**
The archive's `containment-provenance.json` shows `publishedJobState:
"containment_failed"` and `terminalPublicationRetained: true` for both jobs --
the controller-side publication **did** happen and **did** persist.

---

## 5. Reconciliation registration, scheduler/attempt, outcome, terminal publication

| Stage | Producer | Location |
|---|---|---|
| Eligibility gate | PGID > 0 AND failure class != `pgid_unset` AND intended class in {`exited`,`cancelled`,`deadline_exceeded`} | `apps/vscode/src/sdk/command-job-manager.ts:3507-3515` |
| Registration + skip reasons (`disabled` / `pgid_unset` / `job_id_missing` / `capacity_exceeded`) | `registerPendingContainmentReconciliation` | `apps/vscode/src/sdk/command-job-manager.ts:1664-1763` |
| Bounded policy defaults (20 attempts x 250 ms, 5 000 ms horizon, 64 pending) | `DEFAULT_RECONCILIATION_*`, `MAX_PENDING_RECONCILIATIONS` | `apps/vscode/src/sdk/command-job-manager.ts:1157-1165`, applied `:1621-1626` |
| Scheduler | `scheduleContainmentReconciliationTick` (unref'd timer) | `apps/vscode/src/sdk/command-job-manager.ts:1791-1801` |
| Attempt (re-probe, consumes one attempt, no extra signal) | `runContainmentReconciliationTick` | `apps/vscode/src/sdk/command-job-manager.ts:1817-1885` |
| Exhaustion (budget / horizon) -> **obligation stays unresolved** | same | `apps/vscode/src/sdk/command-job-manager.ts:1821-1848` |
| Authoritative resolution | `applyContainmentReconciliation` -> `job.state = pending.reconciledState` + `command_job_containment_reconciled` | `apps/vscode/src/sdk/command-job-manager.ts:1911-1955` |
| Controller reception | `SdkController.publishContainmentReconciliation` -> `updateBackgroundCommandState(..., event.reconciledState, ...)` | `apps/vscode/src/sdk/SdkController.ts:6483-6485`, `:6517-6562` |
| Reconciliation-marker guard against stale overwrite | `reconciledBackgroundCommandJobs` | `apps/vscode/src/sdk/SdkController.ts:6519-6520`, `:6218-6227` |
| Disposal cancels pending reconciliations | `CommandJobManager.dispose` | `apps/vscode/src/sdk/command-job-manager.ts:4138-4165` |

### 5a. The diagnostic observation surface -- DEFAULT OFF

| Stage | Producer | Location |
|---|---|---|
| Reconciliation diagnostic sink | `reconciliation-diagnostic-capture.ts` (`captureReconciliationDiagnostic`) | `apps/vscode/src/sdk/reconciliation-diagnostic-capture.ts:213-248` |
| Arming resolver | `applyReconciliationDiagnosticCaptureProfile(isDogfood, userOptedIn)` | `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts:2213-2231` |
| Arming call site (extension host startup) | `applyReconciliationDiagnosticCaptureProfile(isDogfood, userDetailedDiagnosticsOptIn)` | `apps/vscode/src/extension.ts:544` |
| Arming input -- dogfood profile | `isDogfoodRuntime(process.env)` | `apps/vscode/src/extension.ts:525`, `apps/vscode/src/sdk/dogfood-runtime-profile.ts` |
| Arming input -- public opt-in | `clineDetailedLocalDiagnosticsEnabled` (default **false**) | `apps/vscode/src/shared/storage/state-keys.ts:123`, read via `apps/vscode/src/sdk/automatic-incident-consent.ts:45` |
| Join into the incident | `joinReconciliationRecordsToIncidents` (identity-checked on jobId + ownerSessionId) | `apps/vscode/src/sdk/automatic-incident-capture.ts:1095-1238` |

**Classification: MISSING_PRODUCER for the *installed* runtime (not a trace gap).**
The reconciliation sink is **default-off** and is armed only by the dogfood
runtime profile (`CLINEMM_RUNTIME_PROFILE=dogfood`) or by the user-visible
`clineDetailedLocalDiagnosticsEnabled` opt-in. The incident host was a **public**
VSCodium profile: the installed bundle's `build-identity.json` recorded
`provenanceVerification: "UNOBSERVED"` and the persisted incident snapshot has
`reconciliationTimeline: []` with **zero** reconciliation records.

**This is the decisive structural finding for the archive's 0-byte
`reconciliation-timeline.jsonl`: the producer was never armed, so the exporter
correctly emitted an empty file and the manifest correctly marked the source
`"unavailable"`.** The archive is therefore **honest about its own gap**; the gap
is a *default-off diagnostic* gap, not proof that reconciliation never ran.

### 5b. The `phase-writers.jsonl` export gap -- MISSING_PRODUCER (structural)

| Stage | Producer | Location |
|---|---|---|
| Phase-writer provenance producer | `recordTurnStateWriterProvenance` / `getTurnStateWriterProvenanceRecords` | `apps/vscode/src/shared/turn-state-writer-provenance.ts:424`, `:488` |
| Export input parameter | `buildAutomaticIncidentExportBundle({..., phaseWriters})` | `apps/vscode/src/sdk/automatic-incident-export.ts:396`, consumed `:409`, `:443-448` |
| **The ONLY production call site** | `prepareAutomaticIncidentExport` | `apps/vscode/src/sdk/automatic-incident-export-runtime.ts:170-174` |

`apps/vscode/src/sdk/automatic-incident-export-runtime.ts:170-174` calls
`buildAutomaticIncidentExportBundle` with **only** `incident`, `buildIdentity` and
`containmentProvenance`. It passes **neither** `phaseWriters` **nor**
`continuationSummary`. There is **no other production caller**
(`rg 'buildAutomaticIncidentExportBundle'` finds only the definition, this call
site, and two test files).

**Consequence (STRUCTURAL, proven by source):** `phase-writers.jsonl` is
**always empty** in a production export, and `continuation-summary.json` always
contains the literal `{status:"unavailable", reason:"no continuation summary was
captured for this incident"}` -- **regardless of what actually happened**. The
incident archive's `continuation-summary.json` is therefore **not evidence that
the continuation outcome is unknown**; it is a **constant**. The ACT brief's
"Continuation outcome is unavailable" is **true of the artifact and uninformative
about the runtime**.

---

## 6. C10 blocking-set update, completion reevaluation, suppression and release

| Stage | Producer | Location |
|---|---|---|
| C10 blocking-set classifier (owner-scoped, fail-closed) | `unresolvedContainmentFailuresForOwner` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1202-1263` |
| Deferred-C10 reevaluation | reevaluation block | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2733-2749` |
| C10 observation record (`c10_reevaluated`) | `captureAutomaticIncident` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2759-2774` |
| Hold decision (`unresolved_containment_failure`) | `if (unresolvedContainmentFailuresForDeferredC10.length > 0)` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2775-2831` |
| Hold record (`completion_held`) | `captureAutomaticIncident` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2788-2804` |
| Hold phase projection (`resumable`) | `setTurnPhase?.("resumable", undefined, "session-event-bcb-hold-resumable")` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:5202` (writer id enumerated at `apps/vscode/src/sdk/turn-phase-contract.ts:438`) |
| Commit-boundary revalidation | `unresolvedContainmentFailuresAtCommitBoundary` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1130-1133`, used `:2920-2923` |
| C10 completion-attempt boundary | `unresolvedContainmentFailuresForOwner` + hold-reason selection | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:4914-4943` |
| Release (all conservation checks pass) | marker cleared, completion committed | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2834-2850` |

**CRITICAL: the C10 reevaluation performs NO OS re-probe.** It reads only the
cached controller-level map `backgroundCommandJobStates` (`SdkController.ts:2916`
-> `getBackgroundCommandJobStates`), filtered by `backgroundCommandJobOwners`.
The blocking set can therefore **only** drain through the
`command_job_containment_reconciled` event chain (manager -> `SdkController` ->
`updateBackgroundCommandState`). If no reconciliation resolves, the hold is
**permanent by construction**, regardless of what the OS later does.

---


## 7. Native UI Paused / `resumable` and deferred-completion banner projection

| Stage | Producer | Location |
|---|---|---|
| Phase writer id `session-event-bcb-hold-resumable` | turn-phase contract enum | `apps/vscode/src/sdk/turn-phase-contract.ts:438` |
| Phase set on hold | `this.options.setTurnPhase?.("resumable", undefined, "session-event-bcb-hold-resumable")` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:5202` |
| Phase-writer provenance record | `recordTurnStateWriterProvenance` | `apps/vscode/src/shared/turn-state-writer-provenance.ts:424` |
| Deferred-completion / hold banner (webview) | `ChatRow.tsx` (`suppress_originating_completion`, `unresolved_containment_failure`) | `apps/vscode/webview-ui/src/components/chat/ChatRow.tsx` |
| Terminal-card projection | `CommandOutputRow.tsx` | `apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx` |

**Classification: OBSERVABLE_NOW (seam).**
The archive's `completion-timeline.jsonl` records `phaseWriter:
"session-event-bcb-hold-resumable"` on **both** `held_phase_published`
observations (23:33:02.217Z with `holdReason: suppress_originating_completion`, and
23:38:44.760Z with `holdReason: unresolved_containment_failure`). The FIRST
observation at 23:33:02 carries a **different** hold reason than the LAST. The
banner therefore **did** represent more than one boundary: an earlier
`suppress_originating_completion` hold and a later `unresolved_containment_failure`
hold. The "UI banner represented an earlier boundary" hypothesis is **partially
supported but not the terminal state** -- the final observed banner was the
containment hold.

---

## 8. Existing relevant tests, diagnostic emitters and incident-export joins

### Existing real-process test harness (reusable; NOT re-invented)

| Suite | Location | Purpose |
|---|---|---|
| TCRR01 GREEN (real process) | `apps/vscode/src/sdk/__tests__/transient-containment-reconciliation-repair01.tcrr01.test.ts` | G1 transient->reconciled, G2 persistent->never reconciled |
| TCRR01 RED-only witness | `apps/vscode/src/sdk/__tests__/transient-containment-reconciliation-repair01.red-only.tcrr01.test.ts` | executable RED against the pre-repair tree |
| TCRR01 controller | `apps/vscode/src/sdk/__tests__/transient-containment-reconciliation-repair01.controller.tcrr01.test.ts` | controller-side reconciliation publication |
| TCRR01 shared helpers | `apps/vscode/src/sdk/__tests__/transient-containment-reconciliation-repair01.helpers.tcrr01.ts` | drives the REAL manager + REAL supervisor + REAL default probe |
| NEPCR01 observation harness | `apps/vscode/src/sdk/__tests__/natural-exit-pgid-observation-harness.nepcr01.ts` | read-only group liveness / descendant identity |
| CFPR01 provenance retention | `apps/vscode/src/sdk/__tests__/containment-failure-provenance-retention01.cfpr01.test.ts` (+ `-correction01`) | protected provenance retention + loss accounting |
| CFC10A01 / CFC10AR01 C10 authority | `apps/vscode/src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts`, `...-repair01.cfc10ar01.test.ts` | C10 blocking-set authority |
| AICE01 capture/export | `apps/vscode/src/sdk/__tests__/automatic-incident-{capture,export,persistence,activation,correction}01.aice01.test.ts` | incident capture/export/persistence |
| BCLA06 background-job liveness | `apps/vscode/src/sdk/__tests__/background-job-liveness-authority.bclas06.test.ts` | BJLA diagnostic sink |
| PHCF01 premature handoff | `apps/vscode/src/sdk/__tests__/premature-handoff-containment-failure01.phcf01.test.ts` | owner-scoped containment failure |
| PCPC01 product contract | `apps/vscode/src/sdk/__tests__/pcpc-containment-product-contract.pcpc01.test.ts` | PGID containment product contract |

### Diagnostic emitters (all default-off, guarded sinks)

| Emitter | Location |
|---|---|
| Reconciliation diagnostic capture | `apps/vscode/src/sdk/reconciliation-diagnostic-capture.ts` |
| Background-job liveness authority (BJLA) | `apps/vscode/src/sdk/background-job-liveness-authority.ts` |
| Automatic incident capture | `apps/vscode/src/sdk/automatic-incident-capture.ts` |
| Automatic incident persistence | `apps/vscode/src/sdk/automatic-incident-persistence.ts` |
| Automatic incident export | `apps/vscode/src/sdk/automatic-incident-export.ts` |
| Turn-state writer provenance | `apps/vscode/src/shared/turn-state-writer-provenance.ts` |
| BCB causal flight recorder | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (`captureIncident`) |
| Completion incident flight recorder | `apps/vscode/src/shared/completion-incident-flight-recorder.ts` |
| Dogfood diagnostic profile (arming resolver) | `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` |

### Incident-export joins

| Join | Location | Identity rule |
|---|---|---|
| Reconciliation records -> incident | `joinReconciliationRecordsToIncidents` | `apps/vscode/src/sdk/automatic-incident-capture.ts:1095-1238`; joins only when `jobId` in `incident.blockingJobIds` **and** `ownerSessionId === incident.identity.sessionId` (`:1124-1137`) |
| Containment provenance -> blocking jobs | `readContainmentProvenanceForBlockingJobs` | `apps/vscode/src/sdk/automatic-incident-containment-provenance.ts:125-217`; joins on the incident's **exact** blocking job ids; absent => `UNAVAILABLE_FROM_TRACE` |
| Controller reconciliation publication -> incident | `captureControllerReconciliationPublication` | `apps/vscode/src/sdk/SdkController.ts:6587-6600`; resolved via `getAutomaticIncidentForOwnerJob({ownerSessionId, jobId})` -- **never** the active task |
| Persisted snapshot -> export | `readPersistedAutomaticIncident` | `apps/vscode/src/sdk/automatic-incident-export-runtime.ts:98-128`; a persisted revision **older** than the in-memory snapshot never replaces it |
| Export assembly | `buildAutomaticIncidentExportBundle` | `apps/vscode/src/sdk/automatic-incident-export.ts:392-460`; fixed archive path allowlist `:90-101` |

---

## First lossy boundary (per ACT requirement)

**The first lossy boundary is the DEFAULT-OFF RECONCILIATION DIAGNOSTIC SINK
(`apps/vscode/src/sdk/reconciliation-diagnostic-capture.ts:216-218`), armed only
by the dogfood profile or the `clineDetailedLocalDiagnosticsEnabled` opt-in
(`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts:2213-2231`,
`apps/vscode/src/extension.ts:544`).**

Everything **upstream** of it (spawn identity, signal attempt, OS postcondition,
`containment_failed` publication, controller retention) is observable in principle
and partially observable in the incident's persisted artifacts. Everything
**downstream** of it (reconciliation registration, attempt, result, controller
reception, blocking-set mutation, C10 reevaluation) depends on it for evidence.

This is **NOT** "a missing JSONL stream proves a missing runtime event": the
source proves the sink was disarmed, so the empty timeline is explained by the
producer's default-off posture, not by an absence of runtime behaviour.

---

## Preserved seams (explicitly untouched)

- The **two-operation read-only MCP registry** and its control seam
  (`apps/vscode/src/sdk/control-seam/*`) are **not modified** by this ACT.
- No signal, cleanup policy, blocking logic or completion-suppression logic was
  changed.
- No new permanent logging / API / protocol surface was introduced.
- The operator's live paused instance was **not** modified, restarted, signalled
  or re-instrumented. All live observations were strictly read-only.

## Unrelated MCP/UI seams

The MCP registry read path (`command-status-tool.ts`) and the native UI
(`ChatRow.tsx`, `CommandOutputRow.tsx`) were read for the seam map only; no
change was made to either.
