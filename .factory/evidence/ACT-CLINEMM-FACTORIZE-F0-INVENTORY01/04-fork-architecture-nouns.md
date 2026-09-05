# 04 — Fork-Only Architectural Nouns

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** ripgrep for concept-bearing declarations across production code, then `git grep` on `upstream/main` to label each as `INTRODUCED_BY_FORK` vs `INHERITED_FROM_UPSTREAM`.
**Evidence label:** STRUCTURAL + HISTORICAL_GIT

---

## Inventory summary

Concept patterns searched: `Coordinator | Capture | Authority | Projection | Bridge | Adapter | Shadow | Compatibility | Legacy | Override | Facade | StateManager | Resolver | Classifier | Policy | Arbiter | Mapper | Wiring | RuntimeHost | JobManager`.

**Fork-only concept cluster:** 49 distinct `export class|interface|type|const|enum|function` declarations in Cline-- production code whose name contains a concept marker **and** does not appear in `upstream/main`.

The structurally significant subset:

## A. Task-state shadow family (largest fork-only cluster)

Largest fork-only concept cluster by file count. Implements a "shadow" of canonical task state that runs in the host alongside the agents runtime, recording divergences and projecting them back to the host/UI.

Key members: `TaskStateShadow`, `TaskShadowCoordinator`, `TaskShadowComparator`, `TaskShadowRecorder`, `TaskShadowObservation`, `TaskShadowHostWiring`, `TaskShadowHostMsgSink`, `TaskShadowReverseTranslator`, `CanonicalRuntimeShadowSubscription`, `ObservationAuthority`, plus their `*Deps` / `*Input` / `*Output` types. Total ~20 declarations across 7 files.

**Tentative reading:** *bridge + recorder*, not lifecycle owner. The canonical task state lives in `@cline/agents` (the `TaskState` model). The shadow is a *projection* that detects drift and feeds the host webview. See §6 for the formal classification.

## B. SdkCoordinator family (16 host-side coordinators)

All fork-only. (Full list in §9 — coordinator inventory.)

| Domain | Coordinator |
|---|---|
| Compaction state publication | `SdkCompactionCoordinator` |
| Editor diff / external-edit policy | `SdkDiffEditCoordinator` |
| Post-message followups | `SdkFollowupCoordinator` |
| Foreground vs background command binding | `SdkForegroundCommandCoordinator` |
| Tool interaction (parse/format/UI) | `SdkInteractionCoordinator` |
| MCP server host bridge | `SdkMcpCoordinator` |
| Message rendering policy | `SdkMessageCoordinator` |
| Plan/Act mode switching | `SdkModeCoordinator` |
| Provider-change re-entry | `SdkProviderChangeCoordinator` |
| Session-level auto-approval override | `SdkSessionAutoApprovalCoordinator` |
| Session event projection | `SdkSessionEventCoordinator` |
| Task-control UI events | `SdkTaskControlCoordinator` |
| Task-start wiring | `SdkTaskStartCoordinator` |
| Terminal mode (background/foreground) | `SdkTerminalExecutionModeCoordinator` |
| Shadow coordination (cluster A) | `TaskShadowCoordinator` |
| Remote-config refresh | `RemoteConfigRefreshCoordinator` |

## C. Host-capture / authority family

| Name | Path | ROLE |
|---|---|---|
| `WorkingContextHostCapture` | `apps/vscode/src/sdk/working-context-host-capture.ts` | CACHE/PROJECTION (host-side working-context snapshot) |
| `SessionAutoApprovalOverride` | `apps/vscode/src/sdk/SdkController.ts` | SHADOW (session-level auto-approval override) |
| `PostTerminalAuthorityDiagnosticContext` | `apps/vscode/src/sdk/post-terminal-authority-diagnostic-runtime.ts` | DIAGNOSTICS |

`WorkingContextHostCapture` is the centerpiece: a host-side cache of the core-produced working-context estimate, updated via a coordinator bridge. Per ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01 it was just diagnosed as the carrier of a stale W value. F0 classifies it explicitly in §6.

`SessionAutoApprovalOverride` is a small data shape living on `SdkController`. Worth closer look in §6 (state-authority-map).

## D. Path-authority family (mostly upstream-aligned)

| Name | Path | ROLE |
|---|---|---|
| `PathAuthorityContext` | `sdk/packages/core/src/runtime/command-policy/index.ts` | DATA |
| `TemporaryExternalPathAuthority` | `sdk/packages/core/src/__compile-witness__/public-barrel-export-witness.ts` | DATA |

Fork-invented data shapes, not lifecycle owners.

## E. Process supervision family

| Name | Path | ROLE |
|---|---|---|
| `CommandJobManager` | `apps/vscode/src/sdk/command-job-manager.ts` | LIFECYCLE_OWNER (1,482 LOC) |
| `CommandJobManagerOptions` | same | DATA |
| `SandboxBackendResolver` | same | RESOLVER |

`CommandJobManager` is **the** host-side lifecycle owner of subprocess supervision. The largest fork-only production file in the host. It coordinates command-job ownership (background vs foreground), integrates with `SandboxBackendResolver`, and ties together YOLO approval, sandbox, and command-policy modules. See §23 for detailed analysis.

## F. Recovery / projection family (agents-side)

`RecoveryPolicy`, `RecoveryPolicyConfig`, `RuntimeRecoveryProjectionInput`, `TaskRecoveryMsgProjection`, `TaskRecoveryProjection`, `TaskControlsProjection`, `TaskTelemetryProjection`.

Fork-only recovery/projection cluster inside `@cline/agents`. The state lives in `task-state/`; the recovery machinery lives in `recovery/`. The boundary between them is not obvious without reading the code — see §13 (SdkController decomposition).

## G. Hub / SSH authority family

| Name | Path | ROLE |
|---|---|---|
| `SshAuthenticationAuthority` | `sdk/packages/core/src/runtime/sandbox/types.ts` | DATA (declaration only) |

Minor; covered by the seatbelt-SSH-agent ACT.

## Patterns the search did NOT find

The following noun classes appear *upstream* but **not as fork-only** — i.e. Cline-- inherits and adapts them:

- `AgentEventBridge` (upstream core)
- `HubRuntimeHost` (upstream core)
- `LocalRuntimeHost` (upstream core)
- `ITelemetryAdapter` (upstream shared/core)
- `BudgetPolicyIntent`, `BudgetProjectionOptions` (upstream core)
- `HubConnectionAuthority` (upstream core)

## Net assessment

Three concept clusters define the fork's identity:

1. **Task-state shadow** — A/20 files. Largest cluster. Probable STATE_PROJECTION (per §6).
2. **SdkCoordinator family** — B/16 host coordinators. Profiled in §9.
3. **Process supervision + path authority** — CommandJobManager + the command-policy package. Largest fork-only LOC concentration.

The most architecturally loaded noun is `WorkingContextHostCapture`: a small class, fork-only, and the subject of a recent PASS_WITH_BOUNDED_P1 ACT that closed a real bug through this exact object.

---

## Correction addendum (C1 closure 2026-09-05)

**Downclass `clinemm → @cline/agents` BOUNDARY_VIOLATION_CANDIDATE**.

Upstream `sdk/packages/README.md` (commit `a523f9471`, HEAD of fork) lists
`@cline/agents` "Typical consumers" as `@cline/core, apps`. Apps consuming
`@cline/agents` directly is a **valid upstream pattern**, not a violation.

Revised classification:

```
clinemm -> @cline/agents

  OLD: BOUNDARY_VIOLATION_CANDIDATE
  NEW: DIRECT_LOWER_LAYER_DEPENDENCY
       VALID_UPSTREAM_PATTERN
       REVIEW_ONLY_IF_IT_CREATES_COUPLING
```

No action required. The dep graph itself remains mechanically accurate;
only the *interpretation* of one edge is corrected.
