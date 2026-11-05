# AICE01 — Production Seam Map

Every seam below is a REAL production site. The capture reads the SAME
facts the production decision already computed; it never re-probes a
process, never signals, and never adds a second source of truth.

## 1. Capture seams (the authoritative boundaries)

| Boundary | File | Stage recorded |
|---|---|---|
| C10 hold (completion deferred) | `src/sdk/sdk-session-event-coordinator.ts` | `completion_held` |
| Held phase publication | `src/sdk/sdk-session-event-coordinator.ts` | `held_phase_published` |
| Stalled, no progress | `src/sdk/sdk-session-event-coordinator.ts` | `stalled_no_progress` |
| Containment failure published | `src/sdk/sdk-session-event-coordinator.ts` | `containment_failure_published` |
| Reconciliation observed | `src/sdk/reconciliation-diagnostic-capture.ts` -> `joinReconciliationRecordsToIncidents` | `reconciliation_observed` |
| Controller reconciliation published | `src/sdk/SdkController.ts` | `controller_reconciliation_published` |
| C10 re-evaluation | `src/sdk/sdk-session-event-coordinator.ts` | `c10_reevaluated` |
| Completion committed | `src/sdk/sdk-session-event-coordinator.ts` | `completion_committed` |

The diagnostic sink is SEPARATE from the terminal lifecycle events. It
swallows its own failures and introduces NO process probe and NO signal.

## 2. Reconciliation diagnostic seams

`src/sdk/reconciliation-diagnostic-capture.ts` records, for the transient-
containment reconciliation (TCRR01):

- the REGISTRATION of a reconciliation,
- each ATTEMPT and its verdict,
- the RESOLVED terminal outcome (the fresh `gone` and the restored
  terminal class),
- the EXHAUSTION of the observation horizon,
- the CANCELLATION (manager disposal).

The diagnostic is a separate bounded ring. It does not change the
reconciliation's state semantics; the TCRR01 suites pass unchanged.

## 3. Persistence seams

| Concern | Implementation |
|---|---|
| Incident-scoped directory | `<globalStorageUri>/completion-incidents/<incidentId>/` |
| Durable index | `<globalStorageUri>/completion-incidents/index.json` |
| Atomic write | write to `.tmp-<pid>-<ts>-<rand>` then `rename` (write-then-rename) |
| Per-incident serialization | a per-incident promise chain (`writeTails`) |
| Monotonic revision guard | the persisted revision is read BEFORE the write; an older snapshot is refused |
| Retention bound | the retained set is bounded; the oldest is evicted first |
| Immediate persistence | the capture helper persists AT THE AUTHORITATIVE BOUNDARY (`persistIncident` option on `SdkSessionEventCoordinatorOptions`), and the controller's publication site persists too |
| Failure discipline | persistence NEVER throws into the production path; every failure is reported and counted |

The file set inside an incident directory is exactly:

```
build-identity.json
coverage.json
evidence.json
incident.json
```

## 4. Build/runtime identity seams

`src/sdk/automatic-incident-build-identity.ts` records:

- the runtime instance id (`extension-host-<pid>-<ts>`),
- the extension version,
- the host platform and architecture,
- the on-disk bundle's sha256,
- the provenance verification state: `VERIFIED` | `MISMATCH` | `UNOBSERVED`.

An ABSENT provenance artifact is `UNOBSERVED` — it is NEVER promoted to
`VERIFIED`.

## 5. Export seams

| Concern | Implementation |
|---|---|
| Authority | the extension host resolves the ACTIVE task's incident; the webview supplies nothing |
| Preview | a concise, privacy-safe summary of what is INCLUDED and EXCLUDED |
| Destination | the NATIVE Save dialog, via the HOST BRIDGE (`HostProvider.hostBridge.windowClient.showSaveDialog`) |
| Write | `archiver` (an EXISTING dependency), a single ZIP |
| Integrity | a per-member sha256 manifest with an explicit integrity contract |
| Transmission | NONE — there is no `fetch`, no `axios` and no URL literal in the export module |

The export flow is shared by the Command Palette command and the webview
request, via `runAutomaticIncidentExport` with host-abstracted dialogs.
This keeps `vscode.commands.executeCommand` out of the controller layer
(the repository's lint rules forbid it outside the VS Code entry point)
and keeps the standalone core free of a `vscode` module dependency.

## 6. User-facing seams

| Surface | Where |
|---|---|
| Task-header button | `webview-ui/src/components/chat/task-header/buttons/ReportTaskProblemButton.tsx` |
| Task-header integration | `webview-ui/src/components/chat/task-header/TaskHeader.tsx` |
| gRPC route | `UiService.reportTaskProblem(EmptyRequest) returns (Empty)` |
| Host handler | `src/core/controller/ui/reportTaskProblem.ts` |
| Command contribution | `apps/vscode/package.json` -> `contributes.commands` |
| Command registry | `src/registry.ts` -> `ExtensionRegistryInfo.commands` |
| Command handlers | `src/extension.ts` -> `vscode.commands.registerCommand` |

### Commands

| Command | Purpose |
|---|---|
| `cline.reportTaskProblem` | one-click local diagnostic ZIP export |
| `cline.toggleDetailedLocalDiagnostics` | the user's EXPLICIT opt-in to the DETAILED capture depth |
| `cline.deleteRetainedIncidents` | delete every retained incident from memory AND disk |

### Consent model

- The MINIMAL capture is ALWAYS armed (the public build must preserve a
  minimal local incident summary automatically).
- The DETAILED depth is opt-in: the central dogfood profile OR the user's
  explicit `cline.toggleDetailedLocalDiagnostics` action.
- The opt-in persists in the file-backed global state under
  `clineDetailedLocalDiagnosticsEnabled` and DEFAULTS TO FALSE.

## 7. What this ACT did NOT change

- Completion semantics.
- Containment semantics.
- The C10 barrier semantics.
- The Elm production kernel semantics.
- The TCRR01 reconciliation's state semantics.
- The CIFR per-capsule bounds.
- The BJLA liveness-authority semantics.
- The existing developer dump commands' output contracts
  (`cline.debug.dumpCompletionIncidentBundle` and
  `cline.debug.dumpBackgroundJobLivenessAuthority` remain operational).
