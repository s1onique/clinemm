ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01 — Conflict resolution log
==================================================================

All 17 conflicts resolved in frozen risk order. See merge commit
f4f4f6e83 for the cumulative patch; this file documents the per-file
semantic decisions.

| # | File | Class | Resolution |
|---|------|-------|------------|
| 1 | apps/vscode/proto/cline/state.proto | SECURITY_CRITICAL | Kept ClineMM's `auto_approve_all_toggled = 174` block; dropped upstream's deletion (F17) |
| 2 | apps/vscode/src/sdk/sdk-tool-policies.ts | SECURITY_CRITICAL | Dropped upstream's `isToolAutoApproved` + `isMcpToolName` (ClineMM has superior 4-arg version at line 944 with per-tool MCP flow + session override; F16) |
| 3 | apps/vscode/src/sdk/sdk-tool-policies.test.ts | MECHANICAL | Kept all ClineMM HEAD tests (30-637: A/B/C/D/E/F/G1/G2/PRODUCTION REGRESSION matrix); dropped upstream's 2 `useMcp`-only tests (encoded a regression F16 prohibits) |
| 4 | apps/vscode/src/sdk/SdkController.ts | SECURITY_CRITICAL | All 8 conflict regions: kept ClineMM HEAD's explicit `VscodeSessionHost.create({ mcpHub, safeYoloCapabilitySource })` (F27). Upstream's `createRemoteConfigAwareSessionHost()` removed `safeYoloCapabilitySource` -- dead after merge. |
| 5 | apps/vscode/src/sdk/vscode-session-host.ts | SEMANTIC (F27 target) | 4 conflict regions: merged constructor to take BOTH `commandJobManager` + `prepareStartSessionInput?`; modified named `prepareStartSessionInput` lambda to thread `commandJobManager` to `createVscodeExtraTools` (preserves F27 source binding); kept ClineMM HEAD `commandJobManager` field + upstream's `prepareStartSessionInput` field |
| 6 | sdk/packages/core/src/extensions/tools/executors/bash.ts | SECURITY_CRITICAL | Kept BOTH imports: ClineMM `EnvironmentSemantics` from sandbox/types + upstream `ProcessStartTokenProbeResult, probeProcessStartTokenAsync` from process-start-token. Both used. |
| 7 | sdk/packages/core/src/extensions/tools/definitions.ts | SEMANTIC | Stacked: ClineMM's `perCommandContext` (per-command authority binding) wraps upstream's `commandContext` (commandIndex+query on emitUpdate, PR #13547). Both preserved. |
| 8 | sdk/packages/core/src/runtime/orchestration/runtime-builder.ts | SEMANTIC | All 4 conflict regions: kept BOTH ClineMM's `enableSubmitAndExit` (F23) AND upstream's `runCommandExecutionController`. Function signature preserves both params. |
| 9 | apps/vscode/src/sdk/model-catalog/catalog.ts | MECHANICAL (doc) | Kept ClineMM's verbose `readUsageCostDisplay` doc comment |
| 10 | apps/vscode/src/sdk/model-catalog/contracts.ts | MECHANICAL (doc) | Kept ClineMM's verbose `UsageCostDisplay` doc comment |
| 11 | sdk/packages/shared/src/agent.ts | SEMANTIC | Kept BOTH imports: ClineMM `AgentRuntimeRecoverySnapshot, ToolRuntimeOutcome` from recovery/types + upstream `GeneratedMedia` from llms/media |
| 12 | apps/vscode/src/sdk/sdk-task-control-coordinator.test.ts | MECHANICAL | Kept BOTH fields: ClineMM's `taskOperationFence` + upstream's `clearTaskSettings` |
| 13 | apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.ts | SEMANTIC | Kept ClineMM's conservative-when-unknown contract. Upstream's `UsageCostDisplay | "unknown"` would have allowed flashing spend claims during loading. |
| 14 | apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.test.ts | MECHANICAL | All ClineMM HEAD tests kept (forward-compat: "credits-included", "quota", "enterprise-flat-rate" all assert "hide"). Upstream's tests dropped. |
| 15 | apps/vscode/package.json | MECHANICAL | name=ClineMM, displayName=ClineMM (F2); version 4.1.10 -> 4.1.16 (fork hygiene, matches upstream) |
| 16 | sdk/packages/llms/src/providers/billing.test.ts | MECHANICAL | Kept BOTH: ClineMM's "hides usage cost for ClinePass" + upstream's "hides usage cost for Claude Code" |
| 17 | bun.lock | MECHANICAL | name=clinemm (F2), version 4.1.16 (sync with package.json). Will be regenerated via `bun install` in deferred-gate execution. |

## SECURITY_CRITICAL notes

The 4 SECURITY_CRITICAL files were never resolved via wholesale
`--ours` or `--theirs`:

  - state.proto:  manual merge preserving field 174 (ClineMM's
                  restoration). Conflict was just 10 lines (block
                  of 1 field + comment block).

  - sdk-tool-policies.ts:
                  dropped 2 upstream functions (isToolAutoApproved
                  2-arg + isMcpToolName); kept ClineMM HEAD's
                  superior 4-arg version. NOT wholesale -- this is
                  the load-bearing per-tool MCP approval seam
                  (F16 + ACT-CLINEMM-SESSION-AUTONOMY01-CORRECTION03).

  - SdkController.ts: 8 conflict regions, all kept ClineMM HEAD's
                  explicit `safeYoloCapabilitySource` threading.
                  Upstream's `createRemoteConfigAwareSessionHost()`
                  removed the source -- would have broken F27.

  - bash.ts:     kept both imports (no semantic conflict, just
                  import ordering). Both types referenced.

## F27 critical preservation

The merge's hardest semantic decision was in `vscode-session-host.ts`.
Upstream's constructor was `(inner, prepareStartSessionInput?)` and
upstream's `applyToStartSessionInput` did NOT thread `commandJobManager`
to `createVscodeExtraTools`. ClineMM HEAD's constructor was
`(inner, commandJobManager)` and DID thread `commandJobManager`.

Without intervention, this merge would have silently dropped the
`safeYoloCapabilitySource` binding between `VscodeSessionHost.create`
and the runtime `CommandJobManager` -- exactly the F27 invariant
violation the recon ACT predicted.

Resolution:
  1. Constructor now `(inner, commandJobManager, prepareStartSessionInput?)`
     -- both fields persisted on the host instance.
  2. Named `prepareStartSessionInput` lambda (line 247) modified to
     thread `commandJobManager` to `createVscodeExtraTools`.
  3. `prepare.applyToStartSessionInput = prepareStartSessionInput`
     (use the upstream cleaner reference, but with F27 fix).

The integration ACT body at `.factory/acts/ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01.md`
plus this log plus the post-merge-gates.md evidence file together
document the F27 preservation for any future live-specimen ACT.