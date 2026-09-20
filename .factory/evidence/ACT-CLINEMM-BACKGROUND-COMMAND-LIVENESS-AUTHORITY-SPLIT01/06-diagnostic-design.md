# BJLA Diagnostic Design — Background Job Liveness Authority

> Diagnostic design for `ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01`.
> Internal short name: **BJLA**. Public-facing title:
> **Cline Debug: Dump Background Job Liveness Authority**.

---

## 0. Purpose

Reconcile the LIVE contradiction:

```text
UI / model-visible command:
  jobId = cmd_mu9qjxmwxl5hasi8
  status = running, card = Backgrounded, Cancel visible

Q5 guard (BOCOR snapshot):
  activeJobs = [], guardResult = false
```

by recording which **managerInstance** and which **hostInstance**
owned each load-bearing lifecycle event, so a single dump can
mechanically classify the LIVE occurrence as:

  - LA1 (premature finalization)
  - LA2 (manager-instance split)
  - LA3 (stale projection)
  - LA4 (status authority split)
  - LA5 (manager replacement strands active job)
  - LA6 (other proven cause)

---

## 1. Enablement

```text
dogfood = ON
public  = OFF
```

Driven exclusively by the central dogfood profile resolver
(`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`). NO new env
var. NO workspace toggle. NO webview surface.

Activation helper:

```text
applyBackgroundJobLivenessAuthorityDiagnosticProfile(isDogfood)
  → setBackgroundJobLivenessAuthorityCaptureEnabled(isDogfood)
```

Activation seam: `apps/vscode/src/extension.ts` (sibling to the
existing `applyBackgroundOwnerCorrelationDiagnosticProfile` call
at line 162). Runs BEFORE any `SdkController` construction so the
ring is armed BEFORE the first lifecycle event.

---

## 2. Architecture

```text
bounded in-memory ring (FIFO, default 64 records)
      ↓
dogfood-only capture helper (no-op when seam OFF)
      ↓
explicit Command Palette dump
      ↓
<globalStorageUri>/background-job-liveness-authority.jsonl
```

Mirrors the BOCOR pattern (`background-owner-correlation.ts`) for
structural symmetry. Independent ring module to avoid coupling BOCOR
to the new capture surface.

---

## 3. Diagnostic instance identities

Diagnostic-only object identities — NEVER projected to wire / proto /
webview state. Assigned only when the capture seam is ON.

```ts
const managerIds = new WeakMap<object, number>()
const hostIds = new WeakMap<object, number>()
```

Assignment algorithm:

```text
if captureEnabled:
  if manager not in managerIds:
    managerIds.set(manager, nextManagerId++)
  if host not in hostIds:
    hostIds.set(host, nextHostId++)
  return "M<n>" / "H<n>"
else:
  no allocation, no map mutation
```

The strings are returned synchronously from helpers
`getDiagnosticManagerId(manager)` and `getDiagnosticHostId(host)`,
so capture sites can attach them to records at the seam without
holding a back-reference.

---

## 4. Required event vocabulary

| Event | Fires at | Discriminator for | Notes |
|-------|----------|--------------------|-------|
| `manager_constructed` | `new CommandJobManager({...})` inside `VscodeSessionHost.create` | LA2, LA5 | Captures the manager-identity binding to a host-identity |
| `manager_dispose_begin` | `manager.dispose()` entry | LA5 | Captures `activeJobIdsBeforeDispose` |
| `manager_dispose_end` | `manager.dispose()` end (after `active.clear()`) | LA5 | Captures post-dispose `activeJobIds` (always `[]`) |
| `job_active_inserted` | immediately after `this.active.set(id, job)` at `command-job-manager.ts:1864` | LA2, LA5 | Captures `jobId`, `state="running"`, `ownerSessionId`, `pid`, `pgid` (when resolvable) |
| `job_active_removed` | immediately after `this.active.delete(job.id)` at `command-job-manager.ts:2462` | LA1, LA2, LA5 | Captures `terminalState`, `reason` |
| `process_terminality_record` | inside `emitCommandJobLifecycle` at `command-job-manager.ts:1272` (gated to terminality-adjacent eventNames only) | **LA1** (kernel-terminality discriminator) | Captures `eventName`, `postcondition` (only present on `command_job_primary_group_cleanup`), `jobState`, `pgid` |
| `job_status_lookup` | `manager.status()` entry, AFTER the `lookup` call | LA4 | Captures `returnedState` and the source bucket (`active` / `terminal` / `miss`) |
| `job_cancel_lookup` | `manager.cancel()` entry, AFTER the `lookup` call | LA2, LA5 | Captures `found`, `state` |
| `background_state_change_published` | `vscode-run-commands-tool.ts` (the `notifyBackgroundStateChange` calls) | LA3 | Captures `running`, `jobId` |
| `job_lifecycle_event_published` | `manager.emitCommandJobLifecycle` after the terminality capture | LA2, LA5 | Captures `eventName`, `jobId` |
| `guard_snapshot` (reuses BOCOR record) | at the Q5 boundary, alongside the BOCOR capture | LA2, LA5 | Adds `managerInstance` / `hostInstance` to the BOCOR record (no behavior change to capture path itself) |

Polling ticks, stdout chunks, and per-line tool output are NOT
captured.

### 4a. LA1 discriminator vocabulary (`process_terminality_record`)

The LA1 discriminator is the bounded `process_terminality_record`,
which is captured ONLY when the underlying lifecycle event is one of
the production terminality-adjacent events:

| Production event | Field set on the record | Mechanical role |
|------------------|---------------------------|-----------------|
| `command_job_termination_started` | `eventName`, `pgid` | LA1 timestamp for "termination began" |
| `command_job_primary_group_probe` | `eventName`, `pgid` (NO `postcondition` — the field is on the next event) | Diagnostic for transient probe state |
| `command_job_primary_group_cleanup` | `eventName`, **`postcondition` ∈ {`"gone"` \| `"alive"` \| `"eperm"` \| `"unknown"`}**, `jobState`, `pgid` | **Primary LA1 discriminator**: the postcondition is the kernel-verified terminality verdict |
| `command_job_terminal_committed` | `eventName`, `jobState` (NO `postcondition`) | LA1 "clean terminal" emitted only when `postcondition === "gone"` per `finalize()` correction06 |
| `command_job_residual_detected` | `eventName`, `pgid`, `jobState` (NO `postcondition`) | LA1 "still residual on OS" signal |
| `command_job_containment_failed` | `eventName`, `pgid`, `jobState` (NO `postcondition`) | LA1 post-delete containment failure signal |

Mechanical classification (LA1):

```text
LA1 POSITIVE  iff process_terminality_record observed with
                  eventName === "command_job_primary_group_cleanup"
                  AND postcondition !== "gone"
                  (the cleanup ran, but the kernel verdict was not
                  a clean terminality — this is the bounded invariant
                  violation pattern)

LA1 NEGATIVE  iff no process_terminality_record observed for the
                  jobId during the dump window AND job_active_removed
                  also not observed (job was never terminated during
                  the window) — OR every observed
                  command_job_primary_group_cleanup record has
                  postcondition === "gone" (clean terminality proven)
```

NOTE — earlier drafts of this document referenced a `job_finalize_begin`
and `job_terminal_inserted` event. These were REMOVED from the design
because no production wiring emits them as separate records. The
bounded terminality discriminator is captured entirely through the
`process_terminality_record` (LA1) + `job_active_removed` (LA1/LA5) +
`job_lifecycle_event_published` (LA2/LA5) trio — they collectively
cover the lifecycle authority surface without inventing new event
names that do not appear in the dump.

---

## 5. Required record schema (per event)

The diagnostic captures typed records, each with `event` discriminator,
`capturedAt`, and the relevant fields. Detailed schemas live in the
module source (`background-job-liveness-authority.ts`). The minimal
field shape for each event is:

- `manager_constructed` / `manager_dispose_*`: `managerInstance`,
  `hostInstance` (constructed only), `activeJobIdsBeforeDispose`
  (dispose only), `reason` (dispose only).
- `job_active_inserted`: `managerInstance`, `hostInstance`, `taskId`,
  `jobId`, `ownerSessionId`, `state="running"`, `pid?`, `pgid?`.
- `job_active_removed`: `managerInstance`, `jobId`, `previousState`,
  `terminalState`, `reason` (production reason or `null`),
  `pid?`, `pgid?`.
- **`process_terminality_record` (LA1 discriminator)**:
  `managerInstance`, `hostInstance`, `jobId`, `eventName` (one of
  the six terminality-adjacent event names above),
  `postcondition: "gone" | "alive" | "eperm" | "unknown" | null`,
  `jobState`, `pgid`. The `postcondition` is the production value
  verbatim from `command_job_primary_group_cleanup`; for the other
  five eventNames, `postcondition` is `null` (the production event
  payload does not carry that field).
- `job_status_lookup`: `managerInstance`, `hostInstance`, `jobId`,
  `source` (`active` / `terminal` / `miss`), `returnedState`.
- `job_cancel_lookup`: `managerInstance`, `hostInstance`, `jobId`,
  `found`, `state`.
- `background_state_change_published`: `managerInstance`, `running`,
  `jobId`.
- `job_lifecycle_event_published`: `managerInstance`, `eventName`,
  `jobId`.
- `guard_snapshot` (reuses BOCOR record): adds `managerInstance` and
  `hostInstance`; the existing BOCOR schema remains valid for
  downstream consumers that ignore the new fields.

When the production code does not expose a value (e.g. no PID
resolvable, no termination reason supplied), the diagnostic records
`null` — NEVER invents a value.

---

## 6. Disabled-path invariant

```text
capture OFF:
  - no allocation (managerIds / hostIds never written)
  - no map mutation (no `.set` on the identity maps)
  - no semantic delta (call sites still execute identically)
  - no JSON serialization (records never reach the ring)

Verified by: `bclas-05-diagnostic-zero-delta.test.ts` (asserts
identical job-start/job-status/job-cancel/manager-dispose semantics
across capture ON vs OFF for the same jobId, in the same manager,
on the same host).
```

---

## 7. Production wiring surface (additive)

The diagnostic touches the following production files:

| File | Change |
|------|--------|
| `apps/vscode/src/sdk/background-job-liveness-authority.ts` | NEW ring module (no `vscode` import) |
| `apps/vscode/src/sdk/background-job-liveness-authority-runtime.ts` | NEW host-side dump adapter |
| `apps/vscode/src/sdk/command-job-manager.ts` | ADDS capture calls (insert/remove/status/cancel/dispose) — `this` is the manager; `getDiagnosticManagerId(this)` returns the identity |
| `apps/vscode/src/sdk/vscode-session-host.ts` | ADDS capture calls (manager construction / dispose) — the host captures its own identity binding |
| `apps/vscode/src/sdk/vscode-run-commands-tool.ts` | ADDS `background_state_change_published` capture |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | ADDS `managerInstance` / `hostInstance` to the BOCOR record (no behavior change to the capture path itself) |
| `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` | ADDS `applyBackgroundJobLivenessAuthorityDiagnosticProfile` helper (mirrors BOCOR) |
| `apps/vscode/src/extension.ts` | ADDS activation seam (line ~163, sibling to BOCOR activation) + dump command (line ~787, sibling to BOCOR dump command) |
| `apps/vscode/src/registry.ts` | ADDS `ClineCommands.DumpBackgroundJobLivenessAuthority` entry |
| `apps/vscode/package.json` | ADDS `cline.debug.dumpBackgroundJobLivenessAuthority` command declaration |
| `apps/vscode/src/sdk/__tests__/background-job-liveness-authority.bclas*.test.ts` | NEW BCLAS-01..05 tests |

NO changes to:

  - Q5 guard logic
  - TaskHeader projection
  - submit_and_exit
  - terminal rows
  - TurnState / phase
  - run_commands tool result shape
  - Any wire / proto / webview state
  - Any production semantics

---

## 8. Mechanical classification (post-capture)

The dump is post-processed by the next ACT (live-qualification). The
BCLAS test family asserts the same classification mechanically:

  BCLAS-01: same manager start → snapshot sees job (LA2 NEGATIVE)
  BCLAS-02: legitimate finalize → snapshot loses job exactly once (LA1 NEGATIVE)
  BCLAS-03: status lookup identifies source authority (LA4 discriminator)
  BCLAS-04: manager diagnostic identity distinguishes two managers (LA2 POSITIVE)
  BCLAS-05: diagnostic enabled vs disabled = identical semantics

---

## 9. Removal trigger

Per ACT sec 30, the diagnostic is removed once:

  - root cause is isolated AND
  - successor evidence supersedes BOCOR + BJLA together

OR:

  - the next ACT classifies the LIVE occurrence AND qualifies the
    bounded repair.

Then remove BJLA + BOCOR together unless separately promoted as
permanent dogfood observability.
