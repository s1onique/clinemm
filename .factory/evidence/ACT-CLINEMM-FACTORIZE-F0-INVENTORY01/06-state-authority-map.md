# 06 — State Authority Map

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** semantic search for each candidate state value, classify per ACT §10 taxonomy (`CANONICAL | PROJECTION | CACHE | SHADOW | BRIDGE`)
**Evidence label:** STRUCTURAL + MANUAL_INSPECTION

---

## Critical classification rubric (from ACT §10)

```
CANONICAL    — owns semantic truth
PROJECTION   — deterministically derived, no independent mutation authority
CACHE        — performance copy with explicit invalidation contract
SHADOW       — mutable second representation that can disagree semantically
BRIDGE       — transports truth without owning it
```

## Headline counts

| Class | Count |
|---|---:|
| Canonical authorities | 6 |
| Projections | 4 |
| Caches | 4 |
| **Shadows** | **3** |
| Bridges | 6 |

The three **shadows** are the most concerning and form the center of the F0 analysis.

---

## 1. Working-context estimate (W)

| Field | Value |
|---|---|
| SEMANTIC_VALUE | the most-recent canonical working-context token estimate |
| CANONICAL_AUTHORITY | `AgentRuntimeStateSnapshot.currentWorkingContextEstimate` (`@cline/agents`) |
| PRODUCED_BY | `AgentRuntime.prepareTurn(...)` (the agents runtime) |
| PUBLISHED_VIA | `working-context-state-changed` runtime event (canonical transport) |
| IN_MEMORY_COPIES | `WorkingContextHostCapture._latest` (host side), `currentWorkingContextEstimate` field on `ExtensionState` payload |
| PROJECTIONS | `currentWorkingContextEstimate` on `ExtensionState` (read by `getStateToPostToWebview`) |
| CACHES | **`WorkingContextHostCapture`** (host side carrier; explicitly self-described as "carrier" in its own header comment) |
| EVENTS | `working-context-state-changed` |
| UI_REPRESENTATIONS | TaskHeader / ContextWindow in webview |
| WRITERS | (a) `WorkingContextHostCapture.observe(event)` — canonical path; (b) `WorkingContextHostCapture.setLatest(estimate)` — added by `ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01` as a "transport-only publication" from `sdk-compaction.ts` |
| READERS | `getStateToPostToWebview()` |
| CLASSIFICATION | **SHADOW** (mutable cache with **two independent writers**, manual bypass introduced as a temporary measure) |
| DELETION_PREDICATE | When `sdk-compaction.ts` can publish via the canonical runtime-event subscription path (no transport bypass). |

**Critical evidence:** `WorkingContextHostCapture.ts:131–230` documents itself as a "carrier/cache". The header explicitly says the runtime's fail-closed W lifetime is propagated via unconditional assignment. The `setLatest` method added in `POST-COMPACTION-W-BAR-REFRESH-RECON01` is annotated as a "transport-only publication" — i.e. a workaround for the fact that manual compaction does not produce a canonical runtime-event.

This is a textbook **SHADOW with dual writers**.

## 2. Session auto-approval override

| Field | Value |
|---|---|
| SEMANTIC_VALUE | a per-session override on top of the global auto-approval settings (YOLO / all) |
| CANONICAL_AUTHORITY | (none — this is a fork-only concept with no canonical upstream analogue) |
| PERSISTED_AT | not persisted (transient, session-scoped) |
| IN_MEMORY_COPIES | `SdkController.sessionAutoApproval: SessionAutoApprovalStore` (private field at line 730) |
| PROJECTIONS | `resolveSessionAutoApprovalOverride(sessionId)` exposed to SDK consumers (3 call sites in SdkController) |
| CACHES | none — the store is the canonical in-memory authority |
| EVENTS | none |
| UI_REPRESENTATIONS | none directly — derived into host mode resolution |
| WRITERS | `SdkController.setSessionAutoApprovalOverride()` (line 3180); `SessionAutoApprovalStore.setOverride()` (line 459) |
| READERS | `SessionAutoApprovalStore.getOverride(sessionId)`; `SessionAutoApprovalStore.peekArmed()` |
| CLASSIFICATION | **CANONICAL** (for this scope) |
| DELETION_PREDICATE | None — explicit fork-introduced semantic. |

The **pre-arm vs bound override split** (per the file comment at `session-auto-approval.ts:26-35`) is intricate: a pre-arm survives `clearTask/cancelTask`; the bound override is destroyed. This is *one* state machine with two slots and two clean-up paths. Not a duplication.

## 3. Auto-approval settings (global)

| Field | Value |
|---|---|
| SEMANTIC_VALUE | the user's stored "which tools can run without asking" configuration |
| CANONICAL_AUTHORITY | host-side `AutoApprovalSettings` in `apps/vscode/src/shared/AutoApprovalSettings.ts`; persisted via `state-keys.ts` |
| PERSISTED_AT | file-backed `~/.cline/data/globalState.json` (via `StateManager`) |
| IN_MEMORY_COPIES | the `ExtensionState.autoApprovalSettings` field (webview payload) |
| PROJECTIONS | the `AutoApprovalSettings` payload sent to webview; consumed by `SdkInteractionCoordinator.handleRequestToolApproval` |
| CACHES | none in `apps/vscode/src/sdk/` — the host owns it |
| EVENTS | `autoApprovalSettings` field on state updates |
| UI_REPRESENTATIONS | webview settings panel (auto-approve toggles) |
| WRITERS | settings UI; `StateManager.setGlobalState` via webview update path |
| READERS | `SdkController`, `SdkInteractionCoordinator`, MCP / tool policy evaluators |
| CLASSIFICATION | **CANONICAL** (host-owned) |

`editFilesExternally` (line 18 of `AutoApprovalSettings.ts`) is a *legacy* field kept for backward compatibility — see §7.

## 4. Provider / model configuration (the Model Profiles epic precondition)

| Field | Value |
|---|---|
| SEMANTIC_VALUE | which LLM provider + model + reasoning config is active for Plan or Act mode |
| CANONICAL_AUTHORITY | `apps/vscode/src/shared/storage/state-keys.ts` (host side) — **88** keys: `planMode*` (44) + `actMode*` (44) + per-provider fields |
| PERSISTED_AT | file-backed `~/.cline/data/globalState.json` |
| IN_MEMORY_COPIES | `SdkController` keeps private fields `providerConfigStatePostScheduled = false` and others |
| PROJECTIONS | `getStateToPostToWebview()` exposes a subset (provider name + model id) to webview |
| CACHES | none |
| EVENTS | none specific |
| UI_REPRESENTATIONS | provider/model selectors in webview |
| WRITERS | webview settings UI; `StateManager.setGlobalState` |
| READERS | `SdkController`, `@cline/llms` via host composition |
| CLASSIFICATION | **CANONICAL** (host-owned); but the canonical **shape** is upstream's concern (provider schemas live in `@cline/llms` per upstream ARCHITECTURE.md). |
| FORK-SPECIFIC RISK | None at the storage layer. The risk is that the host keeps 88 keys that mirror what `@cline/llms` already exposes via its provider catalog — Model Profiles will need to know whether to keep the mirror or migrate to a structured provider-config owned by `@cline/core`. |

**This is the Model Profiles precondition.** Per ACT §25, F0 records: provider/model state is **already owned by the host**, not by `@cline/llms`. A Model Profiles epic that wants to add profile-level overlays would have to coordinate with the host's storage layer. Whether that is a "prerequisite factorization seam" is discussed in §28.

## 5. Workspace identity

| Field | Value |
|---|---|
| SEMANTIC_VALUE | which workspace the current task runs in |
| CANONICAL_AUTHORITY | `SdkController.getWorkspaceRoot()` (per constructor wiring; per `createWorkspaceFileReadExecutor(() => SdkController.getWorkspaceRoot())`) |
| PERSISTED_AT | not persisted — derived from VS Code API at runtime |
| IN_MEMORY_COPIES | none |
| PROJECTIONS | `WorkspacePathAuthorityEvidence` data shape (diagnostic) |
| CACHES | none |
| EVENTS | workspace change events from VS Code host |
| UI_REPRESENTATIONS | none |
| WRITERS | VS Code API |
| READERS | `SdkDiffEditCoordinator`, `SdkCompactionCoordinator`, `working-context-host-capture` |
| CLASSIFICATION | **CANONICAL** |

## 6. Command policy / path authority

| Field | Value |
|---|---|
| SEMANTIC_VALUE | can a given command or path be allowed, denied, or required to ask |
| CANONICAL_AUTHORITY | `sdk/packages/core/src/runtime/command-policy/command-policy.ts` + `path-authority.ts` |
| PERSISTED_AT | not persisted — derived per command |
| IN_MEMORY_COPIES | `apps/vscode/src/sdk/sdk-tool-policies.ts` (host-side wrapper around core) |
| PROJECTIONS | `ToolPolicy` interface; `ToolPolicyPresetName` (data only) |
| CACHES | none |
| EVENTS | none |
| UI_REPRESENTATIONS | approval modal |
| WRITERS | core `command-policy` (fork-invented) |
| READERS | `SdkInteractionCoordinator.handleRequestToolApproval`, `CommandJobManager` (for sandbox integration) |
| CLASSIFICATION | **CANONICAL** (in `@cline/core`) |
| FORK-SPECIFIC NOTE | The whole `command-policy/` subsystem is fork-only (see §03). The host wrapper `sdk-tool-policies.ts` is also fork-only. Both are tested through their respective boundaries. |

## 7. TaskState (the runtime model)

| Field | Value |
|---|---|
| SEMANTIC_VALUE | the canonical task state (transcript, status, phase) |
| CANONICAL_AUTHORITY | `@cline/agents` `TaskState` model (in `sdk/packages/agents/src/runtime/state/task-state/`) |
| PERSISTED_AT | persisted to `~/.cline/data/tasks/<id>/` |
| IN_MEMORY_COPIES | the runtime's in-memory `TaskState` |
| PROJECTIONS | **`TaskStateShadow`** (`sdk/packages/agents/src/runtime/state/task-state/shadow-adapter.ts`) — host-side parallel structure; `TaskHeaderPresentationProjection` (`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts`) |
| CACHES | none |
| EVENTS | `AgentRuntimeEvent`s published via `LocalRuntimeHost.subscribeRuntimeEvents` |
| UI_REPRESENTATIONS | task header, chat transcript, webview task panel |
| WRITERS | `AgentRuntime` (canonical) |
| READERS | host (via `TaskShadowCoordinator` observing the runtime event subscription) |
| CLASSIFICATION | canonical is **CANONICAL**; the shadow is **SHADOW** with explicit differential-record machinery (`TaskShadowComparator` produces `TaskShadowDivergence` records) |

This is the *biggest* architectural surface. The whole `task-state-shadow-*` cluster (20 files) exists because the fork needed a host-side parallel model to detect *divergences* between the runtime's canonical task state and the host's projected task state. The shadow is structurally a SHADOW by design — its job is to detect drift. That makes it the **one shadow that is intentional**.

## 8. Session identity

| Field | Value |
|---|---|
| SEMANTIC_VALUE | the active session id |
| CANONICAL_AUTHORITY | `SdkSessionHost` (an SDK-side session host interface) |
| PERSISTED_AT | not directly persisted |
| IN_MEMORY_COPIES | `sessionId` passed through coordinator calls |
| PROJECTIONS | none |
| CACHES | none |
| EVENTS | runtime session-start / session-end |
| UI_REPRESENTATIONS | none |
| WRITERS | `SdkTaskStartCoordinator.initTask` |
| READERS | every coordinator (passes `sessionId` through call args) |
| CLASSIFICATION | **BRIDGE** (passed by-value; not stored) |

## 9. Sandbox backend / process supervision

| Field | Value |
|---|---|
| SEMANTIC_VALUE | which sandbox backend (seatbelt / off / ssh-agent) is used for command execution |
| CANONICAL_AUTHORITY | `CommandJobManager` (host side, fork-only) |
| PERSISTED_AT | not persisted |
| IN_MEMORY_COPIES | `SandboxBackendResolver` (private field of `CommandJobManager`) |
| PROJECTIONS | none |
| CACHES | none |
| EVENTS | none |
| UI_REPRESENTATIONS | none |
| WRITERS | `CommandJobManager` constructor (sets the resolver) |
| READERS | `CommandJobManager.runCommand(...)` |
| CLASSIFICATION | **CANONICAL** (host-owned lifecycle) |

`CommandJobManager` is the **only true LIFECYCLE_OWNER** in the host adapter layer. Per §4 cluster E and §23, it owns subprocesses.

## 10. Provider-change task ledger

| Field | Value |
|---|---|
| SEMANTIC_VALUE | "we just changed providers, the current task must restart" |
| CANONICAL_AUTHORITY | `SdkProviderChangeCoordinator` (host side) |
| PERSISTED_AT | not persisted |
| IN_MEMORY_COPIES | none — single-method coordinator |
| PROJECTIONS | none |
| CACHES | none |
| EVENTS | provider-changed handler in SdkController |
| UI_REPRESENTATIONS | none |
| WRITERS | `SdkController` invokes `restartActiveSessionForProviderChange()` |
| READERS | `SdkProviderChangeCoordinator` |
| CLASSIFICATION | **BRIDGE** (one-shot trigger) |

## 11. Recent fork-added seams — explicit revisit (per ACT §11)

| Seam | Classification | Canonical? | Bridge? | Has deletion predicate? |
|---|---|:-:|:-:|:-:|
| `WorkingContextHostCapture` | SHADOW (with dual writers) | No | Yes (canonical↔host) | Yes — see §1 |
| `SdkCompactionCoordinator` | BRIDGE | No | Yes | Implicit (always present, but its job is done by core if the runtime subscription transports W reliably) |
| `SdkDiffEditCoordinator` | LIFECYCLE_OWNER (preview sessions map) + POLICY (path authority pre-check) | No | Mixed | No deletion predicate — fork-introduced security primitive |
| `SdkInteractionCoordinator` | TRANSPORT_ADAPTER | No | Yes | No — replaces what would otherwise be a host-side handler |
| Session auto-approval override (`SessionAutoApprovalStore`) | CANONICAL (for its scope) | Yes (transient) | No | No — fork-introduced semantic |
| Temporary external-path authority fresh-read | CANONICAL (transient) | Yes | No | Yes — has explicit lifetime (fresh-read bound to request) |
| Editor effective-destination classifier/policy | POLICY | No (fork-only) | No | No — fork-introduced security primitive |
| `CommandJobManager` | LIFECYCLE_OWNER | Yes (host-owned) | No | No — fork-introduced lifecycle primitive |
| Compaction state projection (via `SdkCompactionCoordinator`) | PROJECTION | No | Yes | Implicit (see `WorkingContextHostCapture` predicate) |
| Runtime/host state projections (via `TaskShadowCoordinator`) | SHADOW (intentional) | No | Yes | No — design intent is to detect drift, so deletion is not the goal |

