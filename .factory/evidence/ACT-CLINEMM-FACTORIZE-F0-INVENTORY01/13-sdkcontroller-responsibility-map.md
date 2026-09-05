# 13 — `SdkController` Responsibility Map

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** parse `apps/vscode/src/sdk/SdkController.ts` for fields, methods, and imports.
**Evidence label:** STRUCTURAL + MANUAL_INSPECTION

---

## Headline metrics

| Metric | Value |
|---|---:|
| Total LOC | **4,679** |
| Class declarations | 1 (`class SdkController`) |
| Private fields | **93** |
| Async methods | **39** |
| Imports from local SDK modules | ~80 (every coordinator + bridge + capture) |
| Fork commits touching this file | **160** |
| Upstream commits on this file | 71 |

The fork has roughly **doubled** the file size (2,388 → 4,679 LOC).

## Typed field classification (the 26 typed coordinator/bridge fields)

| Field | Type | Responsibility area |
|---|---|---|
| `messageTranslatorState` | `MessageTranslatorState` | SESSION |
| `turnStateTracker` | `TurnStateTracker` | SESSION (legacy turnState field) |
| `messages` | `SdkMessageCoordinator` | MESSAGING / SESSION |
| `sessions` | `SdkSessionLifecycle` | SESSION |
| `sessionRebuilds` | `SdkSessionRebuildScheduler` | SESSION |
| `interactions` | `SdkInteractionCoordinator` | APPROVAL |
| `diffEdits` | `SdkDiffEditCoordinator` | TOOLS / PATH-AUTHORITY |
| `sessionConfigBuilder` | `SdkSessionConfigBuilder` | SESSION / STORAGE |
| `taskHistory` | `SdkTaskHistory` | STORAGE |
| `taskOperationFence` | `TaskOperationFence` | SESSION (lifecycle fence) |
| `mode` | `SdkModeCoordinator` | SETTINGS / MODE |
| `mcpTools` | `SdkMcpCoordinator` | TOOLS / MCP |
| `terminalExecutionMode` | `SdkTerminalExecutionModeCoordinator` | TOOLS / PROCESS |
| `sessionAutoApprovalRebuild` | `SdkSessionAutoApprovalCoordinator` | APPROVAL / SESSION |
| `taskStateShadowWiring` | `TaskShadowHostWiringWithSink` | STATE_PROJECTION |
| `providerChanges` | `SdkProviderChangeCoordinator` | SETTINGS / PROVIDER |
| `followups` | `SdkFollowupCoordinator` | APPROVAL / MESSAGING |
| `taskControl` | `SdkTaskControlCoordinator` | SESSION / UI |
| `taskStart` | `SdkTaskStartCoordinator` | SESSION |
| `compaction` | `SdkCompactionCoordinator` | COMPACTION |
| `taskTelemetry` | `TaskTelemetryTracker` | DIAGNOSTICS |
| `taskTelemetryPhaseUnsub`, `taskTelemetryRecoveryUnsub` | (functions) | DIAGNOSTICS |
| `taskStateRuntimeEventsSubscription` | `CanonicalRuntimeShadowSubscription` | STATE_PROJECTION |
| `workingContextHostCapture` | `WorkingContextHostCapture` | CACHE (working-context) |
| `sessionAutoApproval` | `SessionAutoApprovalStore` | APPROVAL (transient override) |
| `sessionEvents` | `SdkSessionEventCoordinator` | SESSION |
| `sessionHistory` | `SdkSessionHistoryLoader` | STORAGE |
| `providerConfigStore` | `ProviderConfigStore` | SETTINGS / PROVIDER |
| `providerCatalog` | `ProviderCatalog` | SETTINGS / PROVIDER |
| `statePostDebouncer` | `StatePostDebouncer` | WEBVIEW |
| `grpcBridge` | `WebviewGrpcBridge` | WEBVIEW |
| `remoteConfigRefreshCoordinator` | `RemoteConfigRefreshCoordinator` | SETTINGS / REMOTE-CONFIG |

## Responsibility classification (per ACT §18 taxonomy)

```
SESSION       — task lifecycle, session events, mode, telemetry
RUNTIME       — runtime event subscription, shadow, working-context capture
APPROVAL      — auto-approval, tool-approval, follow-ups, mode toggle
SETTINGS      — provider config, remote config, session config
WEBVIEW       — state posting, gRPC bridge
TOOLS         — diff edit, MCP, terminal execution, command job
PROVIDER      — provider catalog, effective config
COMPACTION    — compaction coordinator + W carrier
STORAGE       — task history, session history, provider migration
DIAGNOSTICS   — task telemetry, post-terminal-authority diagnostic
```

### Count of responsibilities owned directly vs delegated

| Responsibility | Owned directly in SdkController | Delegated to a coordinator/bridge |
|---|---:|---:|
| SESSION | ~5 (lifecycle glue) | 8 (`sessions`, `sessionRebuilds`, `messages`, `sessionEvents`, `sessionHistory`, `taskStart`, `taskControl`, `compaction`) |
| RUNTIME | ~3 (`attachCanonicalRuntimeEventSubscription`, `subscribeTaskStateRuntimeEvents`) | 1 (working-context-host-capture) |
| APPROVAL | ~2 | 3 (`interactions`, `followups`, `sessionAutoApprovalRebuild`) |
| SETTINGS | ~4 (provider config store glue) | 4 (`mode`, `providerChanges`, `sessionConfigBuilder`, `remoteConfigRefreshCoordinator`) |
| WEBVIEW | ~6 (state posting, debouncer, gRPC bridge) | 2 (`grpcBridge`, `statePostDebouncer`) |
| TOOLS | ~1 | 3 (`diffEdits`, `mcpTools`, `terminalExecutionMode`) |
| PROVIDER | ~3 | 2 (`providerCatalog`, `providerConfigStore`) |
| COMPACTION | ~1 | 1 (`compaction`) |
| STORAGE | ~1 | 2 (`taskHistory`, `sessionHistory`) |
| DIAGNOSTICS | ~5 | 1 (post-terminal-authority diagnostic) |
| **TOTAL** | **~31** | **27** |

`SdkController` owns roughly **31 direct responsibilities** in its own method bodies and delegates **27** to coordinator/bridge objects. The class is therefore a **composition root + service locator**, not a true controller.

## What this means

`SdkController` is the central bottleneck for the entire host adapter layer. It is:
- The composition root for ~30 collaborators
- The state-post debouncer owner
- The remote-config refresh owner
- The post-terminal-authority diagnostic owner
- The telemetry attachment owner
- The canonical runtime-event subscription owner
- The provider config store owner
- The legacy provider migration driver

Splitting `SdkController` is a non-trivial refactor: every coordinator's `*Options` factory consumes a function from `SdkController` (e.g. `resolveSessionAutoApprovalOverride: (sessionId) => this.sessionAutoApproval.getOverride(sessionId)`). The dependencies are too tight to split without:
1. **Pulling the override-resolution into a separate accessor class** that coordinators receive directly, OR
2. **Bundling `SdkController`'s session-glue fields into a `SessionContext` object** passed to coordinators, OR
3. **Converting `SdkController`'s public methods into extension methods on the SessionContext** (the "introduce parameter object" refactor)

## Residual authority candidates

The fields/methods that survived as direct in-class state, not delegated:

| Candidate | Why it could be extracted |
|---|---|
| `workingContextHostCapture` + `attachCanonicalRuntimeEventSubscription` | The W capture is a self-contained subsystem that could own its own subscription wiring. Today `SdkController` still wires the subscription. |
| `sessionAutoApproval` (line 730) + `resolveSessionAutoApprovalOverride` (3 callback sites) | The override plumbing is split between SdkController and SessionAutoApprovalStore. A builder pattern would consolidate. |
| `post-terminal-authority-diagnostic-runtime` wiring | Diagnostic-only; could be a plugin-style attachment that doesn't require SdkController knowledge. |
| `providerConfigStore` + `providerCatalog` ownership | Already lives in `provider-config-store.ts`, but the wiring (subscription, debouncer trigger) is in `SdkController`. |
| `taskTelemetry` + the `attachRecoveryTelemetrySubscription` machinery | 5 private fields; could be its own diagnostics module. |

## Net assessment

`SdkController` is **composition root + service locator**, not a semantic owner. Its direct responsibilities (state posting, subscription wiring, override plumbing, telemetry attachment) are stable glue; its delegated responsibilities (15+ coordinators + bridges + stores) carry the actual semantics.

The factorization question is not "split SdkController" — that would create 5 new god-objects with the same coupling. The right question is "what's the smallest extraction that simplifies the composition root while preserving behavior?" That is the §17 question.

