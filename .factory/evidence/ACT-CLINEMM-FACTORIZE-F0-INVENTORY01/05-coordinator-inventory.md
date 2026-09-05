# 05 — Coordinator Inventory

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Scope:** all `*coordinator.ts` files in `apps/vscode/src/sdk/`
**Evidence label:** STRUCTURAL (file scan + header inspection) + STRUCTURAL/MANUAL_INSPECTION (classifications)

---

## Inventory

16 files. Total production LOC: **5,977**. All are fork-only — none exist in upstream.

| Coordinator | LOC | Private fields | Public methods | Test LOC | Public API |
|---|---:|---:|---|---:|---|
| `SdkCompactionCoordinator` | 649 | 0 | 1 (`compactTask`) | 605 | compaction publication bridge |
| `SdkDiffEditCoordinator` | 466 | 5 | 5 (`openForApproval`, `executeEditorTool`, `executeApplyPatchTool`, `discardPreview`, `discardAllPreviews`) | 678 | editor / apply_patch host-side authority |
| `SdkFollowupCoordinator` | 389 | 0 | 1 (`askResponse`) | 719 | followup question answer |
| `SdkForegroundCommandCoordinator` | 80 | 1 | 0 | 74 | (likely used as a state object) |
| `SdkInteractionCoordinator` | 1,125 | 0 | 3 (`handleConsecutiveMistakeLimitReached`, `handleRequestToolApproval`, `handleAskQuestion`) | 1,471 | tool-approval + ask-question + mistake limit |
| `SdkMcpCoordinator` | 113 | 0 | 1 (`restartSessionForMcpTools`) | 176 | MCP-driven session restart |
| `SdkMessageCoordinator` | 139 | 1 | 0 | 124 | (state object) |
| `SdkModeCoordinator` | 448 | 0 | 3 (`waitForPendingRebuild`, `togglePlanActMode`, `rebuildSessionForMode`) | 923 | Plan/Act mode switching + session rebuild |
| `SdkProviderChangeCoordinator` | 131 | 0 | 1 (`restartActiveSessionForProviderChange`) | 234 | provider change → session rebuild |
| `SdkSessionAutoApprovalCoordinator` | 338 | 0 | 0 | 0 | (state machine; no tests at the unit level) |
| `SdkSessionEventCoordinator` | 482 | 1 | 1 (`handleSessionEvent`) | 1,185 | session event projection |
| `SdkTaskControlCoordinator` | 350 | 0 | 5 (`cancelClineTaskOnSignOut`, `cancelTask`, `clearTask`, `clearTaskForOperation`, `showTaskWithId`) | 564 | task-control UI events |
| `SdkTaskStartCoordinator` | 471 | 0 | 2 (`initTask`, `reinitExistingTaskFromId`) | 767 | task-start / re-init |
| `SdkTerminalExecutionModeCoordinator` | 155 | 0 | 1 (`restartSessionForTerminalExecutionMode`) | 219 | terminal mode switch |
| `TaskShadowCoordinator` (file `task-state-shadow-coordinator.ts`) | 608 | 0 | 0 (factory + interface only) | 0 (covered in `__tests__/`) | observation coordinator interface |
| `RemoteConfigRefreshCoordinator` | 33 | 0 | 0 | 98 | remote-config refresh |

(`TaskShadowCoordinator` exports a factory `createTaskShadowObservationCoordinator(deps)` returning the `TaskShadowCoordinator` interface — it is a closure-based coordinator, not a class.)

## Classification

Per ACT §9 (A–F taxonomy).

| Coordinator | Class | Reasoning |
|---|---|---|
| `SdkCompactionCoordinator` | C TRANSPORT_ADAPTER / D STATE_PROJECTION | Bridges core compaction output → webview. The recent `ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01` PASS_WITH_BOUNDED_P1 ACT established it is a *projection bridge*, not a lifecycle owner. Has own private compaction-in-flight flag → minimal mutable state. |
| `SdkDiffEditCoordinator` | C TRANSPORT_ADAPTER | Hosts the editor / apply_patch executors with path-authority pre-checks. Reads `WorkspacePathAuthorityEvidence`, `TempAuthorityEvidence`, calls `executeEditorTool`/`executeApplyPatchTool`. Holds 5 private fields (sessions Map, fallback executors, timeouts). |
| `SdkFollowupCoordinator` | C TRANSPORT_ADAPTER | One method (`askResponse`); pure transport of the user's answer to a followup ask. |
| `SdkForegroundCommandCoordinator` | D STATE_PROJECTION | Small state object. |
| `SdkInteractionCoordinator` | C TRANSPORT_ADAPTER | Largest coordinator (1,125 LOC, 1,471 test LOC). Three methods, three distinct domains (mistake-limit / tool-approval / ask-question). This is **the** host-side interaction bridge. Could itself be split. |
| `SdkMcpCoordinator` | C TRANSPORT_ADAPTER | One method; bridges MCP server changes to session restart. |
| `SdkMessageCoordinator` | D STATE_PROJECTION | (state object) |
| `SdkModeCoordinator` | B POLICY_COMPOSER + C TRANSPORT_ADAPTER | Plan/Act mode switching + session rebuild. The "policy composer" aspect: determines when to rebuild vs toggle. The "transport" aspect: actually invokes the rebuild. |
| `SdkProviderChangeCoordinator` | C TRANSPORT_ADAPTER | Provider change → session rebuild. |
| `SdkSessionAutoApprovalCoordinator` | B POLICY_COMPOSER | Session-level auto-approval override (see §6 — `SessionAutoApprovalOverride`). No public methods; built around `SessionAutoApprovalOverride`. |
| `SdkSessionEventCoordinator` | C TRANSPORT_ADAPTER | Translates core session events to webview. |
| `SdkTaskControlCoordinator` | C TRANSPORT_ADAPTER | Five task-control UI methods. Mostly thin transport. |
| `SdkTaskStartCoordinator` | C TRANSPORT_ADAPTER | `initTask`, `reinitExistingTaskFromId`. |
| `SdkTerminalExecutionModeCoordinator` | C TRANSPORT_ADAPTER | Terminal execution mode switch. |
| `TaskShadowCoordinator` | D STATE_PROJECTION + B POLICY_COMPOSER | Authoritative observation funnel for the TaskState shadow. The `ObservationAuthority` policy lives here. |
| `RemoteConfigRefreshCoordinator` | C TRANSPORT_ADAPTER | Tiny (33 LOC). |

### Counts by class

| Class | Count |
|---|---:|
| A LIFECYCLE_OWNER | 0 |
| B POLICY_COMPOSER | 2 (`SdkModeCoordinator`, `SdkSessionAutoApprovalCoordinator`, plus the shadow's `ObservationAuthority` policy) |
| C TRANSPORT_ADAPTER | 11 |
| D STATE_PROJECTION | 3 (`SdkForegroundCommandCoordinator`, `SdkMessageCoordinator`, `TaskShadowCoordinator`) |
| E COMPATIBILITY_BRIDGE | 0 |
| F UNKNOWN | 0 |

**Note:** zero coordinators are LIFECYCLE_OWNERs. The only true lifecycle owner in the host adapter layer is `CommandJobManager` (1,482 LOC, profiled in §4 cluster E and §23).

**Note:** zero coordinators are COMPATIBILITY_BRIDGEs. None of them exist *to bridge upstream to Cline--*; they are first-class host-side responsibilities that did not exist upstream.

## Construction sites

All 15 class-based coordinators are constructed in `SdkController.ts`. The shadow-coordinator factory is called from `SdkController.ts` via `createTaskShadowObservationCoordinator(...)`. Each coordinator takes a `*Options` object (constructor injection). There is no DI container — every wiring is explicit in `SdkController`'s initializer.

## Public-method density

The majority of coordinators expose **one** public method. The exceptions:
- `SdkDiffEditCoordinator`: 5 (editor + apply_patch + 2 preview-discard).
- `SdkInteractionCoordinator`: 3 (mistake-limit / tool-approval / ask-question).
- `SdkModeCoordinator`: 3 (rebuild-wait / toggle / rebuild).
- `SdkTaskControlCoordinator`: 5 (cancel-on-sign-out / cancel / clear / clear-for-op / show-by-id).
- `SdkTaskStartCoordinator`: 2 (init / reinit).
- `TaskShadowCoordinator`: 0 (interface only).
- `RemoteConfigRefreshCoordinator`: 0 (33 LOC, single-purpose).

**Single-method coordinators are policy/transport bundles.** They could plausibly be expressed as plain functions. They are class-bound mainly to enable internal state (e.g. in-flight flag, sessions map). This is a FACTORY-class candidate signal.

## Net assessment

- **Most coordinators are 1-method transport adapters** wrapping a single domain operation. They exist because the host `SdkController` needs to coordinate several *async* operations across the SDK boundary in a testable, lifecycle-aware way.
- **None are true lifecycle owners.** The single real lifecycle owner in the host layer is `CommandJobManager`.
- **Three carry policy weight** (mode, session auto-approval, shadow authority). These are the candidates for "B POLICY_COMPOSER" — the others are pure transport.
- **One coordinator cluster is already a state-projection system** (TaskShadowCoordinator + its 7 sibling files). It is the most architecturally loaded.
