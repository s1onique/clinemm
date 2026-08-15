# ACT-CLINEMM-UPSTREAM-SETTINGS-AUTHORITY-PARITY01

## Identity

| Field | Value |
|-------|-------|
| ACT_ID | ACT-CLINEMM-UPSTREAM-SETTINGS-AUTHORITY-PARITY01 |
| TYPE | UPSTREAM_PARITY_AND_PRODUCT_EXTENSION |
| PRIORITY | P0 |
| STATUS | PASS |
| SOURCE_MAIN_HEAD | 566feae0f3dee47ba566df4fcc45795aac1ef682 |
| UPSTREAM_V4_1_8 | 7e31fb9e0d5f38f3437d6f12a01711a0142fccca |
| UPSTREAM_V4_1_10 | 3e0aac53a2f5f408a89a957d75430f6ec4084497 |
| UPSTREAM_MAIN | 8bbdde2a5c1f972864fe1b954f639c21fac61a40 |
| ISOLATED_WORKTREE | /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinmm-settings-parity01 |
| ISOLATED_BRANCH | act/settings-authority-parity01 |

## Why ClineMM Settings Surface Differs From Upstream

**Answer**: **NO meaningful UI divergence in Feature Settings surface.** ClineMM's
`FeatureSettingsSection.tsx` and the entire `auto-approve-menu/` component are
**byte-identical** to upstream v4.1.10. The "older / different" perception was
caused by a **runtime regression** (not a UI divergence) introduced by commit
`28de596ec` (CORRECTION04 - TOCTOU fix for command tools), which inadvertently
removed the `shouldAutoApproveTool` wiring for non-command tools.

Root cause classification:

```
FEATURE_SURFACE_DIVERGENCE=NONE (UI is at parity)
ROOT_CAUSE=RUNTIME_REGRESSION (commit 28de596ec broke shouldAutoApproveTool for non-commands)
NOT_LEGACY_VS_SDK_BUNDLE=true (no bundle divergence observed)
NOT_INCOMPLETE_UPSTREAM_MERGE=true (no missing merge)
NOT_OLDER_COMPONENT=true
NOT_BACKEND_UI_VERSION_SKEW=true
NOT_FEATURE_FLAG=true
NOT_INTENTIONAL_FORK_DIVERGENCE=true
```

## Auto-Approval Authority Map (Phase B)

UI control -> persisted state -> runtime consumer chain:

```
AutoApproveBar (apps/vscode/webview-ui/src/components/chat/auto-approve-menu/AutoApproveBar.tsx)
  -> autoApprovalSettings (apps/vscode/src/shared/AutoApprovalSettings.ts)
  -> StateManager.setGlobalState("autoApprovalSettings")
  -> SdkInteractionCoordinator.handleRequestToolApproval
  -> SdkController.shouldAutoApproveTool: (request) => isToolAutoApproved(...)
  -> isToolAutoApproved (apps/vscode/src/sdk/sdk-tool-policies.ts)

[For command tools only]
  -> evaluateCommandToolApproval (atomic, CORRECTION04 TOCTOU-safe)
  -> getCommandHostAuthorization -> evaluateCommandToolApprovalWithPlan
  -> @cline/core/runtime/command-policy (ClineMM canonical command authority)
```

For each category:

```
read_files:
  SETTING_KEY=autoApprovalSettings.actions.readFiles
  UI_CONTROL=AutoApproveMenuItem id="readFiles"
  STORAGE=global state (file-backed)
  RUNTIME_READ_POINT=sdk-tool-policies.isReadTool -> settings.actions.readFiles
  TOOL_POLICY_RESULT=true => auto-approved via shouldAutoApproveTool callback

edit_files (workspace):
  SETTING_KEY=autoApprovalSettings.actions.editFiles
  UI_CONTROL=AutoApproveMenuItem id="editFiles"
  STORAGE=global state
  RUNTIME_READ_POINT=sdk-tool-policies.isEditTool -> settings.actions.editFiles
  TOOL_POLICY_RESULT=true => auto-approved via shouldAutoApproveTool callback
  [REGRESSION FIX APPLIED in this ACT]

execute_safe_commands:
  SETTING_KEY=autoApprovalSettings.actions.executeSafeCommands
  UI_CONTROL=AutoApproveMenuItem id="executeSafeCommands" (single Commands entry)
  STORAGE=global state
  RUNTIME_READ_POINT=command policy lattice (@cline/core/runtime/command-policy)
  TOOL_POLICY_RESULT=ALLOW / ASK / DENY per evaluated command
  NOTE=executeAllCommands is a legacy field; NOT consulted by current runtime.

use_mcp:
  SETTING_KEY=autoApprovalSettings.actions.useMcp
  UI_CONTROL=AutoApproveMenuItem id="useMcp"
  STORAGE=global state
  RUNTIME_READ_POINT=sdk-tool-policies.isToolAutoApproved mcpTool branch
  TOOL_POLICY_RESULT=true => check McpHub.getServers().autoApprove per tool

use_browser:
  SETTING_KEY=autoApprovalSettings.actions.useBrowser
  UI_CONTROL=AutoApproveMenuItem id="useBrowser"
  STORAGE=global state
  RUNTIME_READ_POINT=sdk-tool-policies.isBrowserTool -> settings.actions.useBrowser
  TOOL_POLICY_RESULT=true => auto-approved via shouldAutoApproveTool callback
```

## Parity Matrix

| Setting | ClineMM | v4.1.8 | v4.1.10 | upstream main | Disposition |
|---------|---------|--------|---------|---------------|-------------|
| Auto Approve menu | YES (5 categories, byte-identical to upstream) | YES | YES | YES | ALREADY_PRESENT |
| old YOLO Mode toggle | NOT in UI (removed upstream v4.1.8) | REMOVED | REMOVED | REMOVED | REMOVED_UPSTREAM (intact) |
| Read Files | YES | YES | YES | YES | ALREADY_PRESENT |
| Edit Project Files | YES | YES | YES | YES | REPAIR_AUTHORITY (P0 fix this ACT) |
| Edit External Files | legacy field only | legacy field | legacy field | legacy field | SUPERSEDED |
| Execute Safe Commands | YES (single entry) | YES | YES | YES | ALREADY_PRESENT |
| Execute All Commands | legacy field only | legacy field | legacy field | legacy field | SUPERSEDED (intentional divergence: ClineMM routes commands through canonical policy) |
| MCP | YES | YES | YES | YES | ALREADY_PRESENT |
| Browser/Web Fetch | YES | YES | YES | YES | ALREADY_PRESENT |
| Web Search | YES | NO (added in v4.1.10) | YES | YES | ALREADY_PRESENT (ClineMM at v4.1.10 parity) |
| Native Tool Calling | NO (no upstream state key) | NO | NO | NO | REMOVED_UPSTREAM (never a global Feature UI toggle) |
| Parallel Tool Calling | NO (no upstream state key) | NO | NO | NO | REMOVED_UPSTREAM (never a global Feature UI toggle) |
| Subagents | YES | partial | YES | YES | ALREADY_PRESENT |
| Strict Plan Mode | YES | YES | YES | YES | ALREADY_PRESENT (ClineMM extends mode="yolo" for CLI schedules) |
| Focus Chain | YES | partial | YES | YES | ALREADY_PRESENT |
| Background Edit | YES | YES | YES | YES | ALREADY_PRESENT |
| Checkpoints | YES | YES | YES | YES | ALREADY_PRESENT |
| Hooks | YES | YES | YES | YES | ALREADY_PRESENT |
| MCP Display Mode | YES (plain/rich/markdown) | YES | YES | YES | ALREADY_PRESENT |
| Double-Check Completion | NOT in current Feature UI | stale tip removed | NOT in UI | NOT in UI | REMOVED_UPSTREAM (never resurrected) |
| Lazy Teammate Mode | NOT present | NOT present | NOT present | NOT present | REMOVED_UPSTREAM |
| Feature Tips | YES (showFeatureTips) | YES | YES | YES | ALREADY_PRESENT |
| Auto Compact | YES | YES | YES | YES | ALREADY_PRESENT |

## YOLO Migration Parity (Phase 16)

```
OLD_YOLO_SETTING_PRESENT_IN_CLINEMM_SCHEMA=false (not in current schema)
OLD_AUTO_APPROVE_ALL_PRESENT=false (not in current schema)
MIGRATION_ALREADY_PRESENT=true (vscode-to-file-migration.ts:migrateYoloModeToAutoApprovalSettings)
MIGRATION_NEEDED=false (no live code path; migration is read-only defensive code)
```

The ClineMM migration logic at
`apps/vscode/src/hosts/vscode/vscode-to-file-migration.ts:282-313` is byte-equivalent
to upstream v4.1.10 and reads both `yoloModeToggled` and `autoApproveAllToggled`
legacy keys, folding them into `autoApprovalSettings` with all actions enabled.

## Session/Task-Scoped Autonomy (Phase 12-15)

**Disposition: DEFER with concrete reason.**

This ACT's scope is intentionally narrow: fix the P0 authority regression and
restore upstream parity. The session autonomy extension (`SESSION_AUTO_APPROVE_OVERRIDE`)
requires new state slot, lifecycle wiring, UI affordance, and tests - too much
surface to add alongside the regression fix without forking upstream authority.

Concrete reason recorded: existing `autoApprovalSettings` schema is at upstream
v4.1.10 parity; introducing an override projection would diverge the schema
without a corresponding upstream authority to inherit. Tracked as a follow-up ACT.

## C1.2 Handoff Report

```
PARALLEL_TOOL_CALLING:
  current state: NO global toggle (no upstream state key)
  default runtime: sequential (AgentRuntime.toolExecution)
  disposition: REMOVED_UPSTREAM (never a global Feature UI toggle)

NATIVE_TOOL_CALLING:
  current state: NO global toggle (no upstream state key)
  provider gating: provider-specific (e.g. OpenAI native tools)
  disposition: REMOVED_UPSTREAM (provider-config, not a Feature UI toggle)

SUBAGENTS:
  state owner: subagentsEnabled (global boolean, default false)
  runtime owner: CLI telemetry + scheduling
  scope: per-session (single AgentRuntime per session)
  C1.2 SUBAGENT RECOVERY SCOPE: UNPROVEN

STRICT_PLAN_MODE:
  state: mode ("act" | "plan" | "yolo")
  control plane integration: prompt/format selection; non-execution
  bounded-recovery interaction: must NOT count as bounded-recovery failure

AUTO_APPROVAL:
  canonical authority: PROVEN via this ACT (P0 fix applied)
  state key: autoApprovalSettings
  runtime consumer: shouldAutoApproveTool (non-command) + evaluateCommandToolApproval (command)
  edit auto-approve: REGRESSION FIXED
  safe commands: routed through @cline/core/runtime/command-policy
  hard DENY: preserved (CORRECTION04)
  execution_plan_invalid: preserved (CORRECTION04)

SESSION_AUTONOMY: DEFERRED with documented reason
```

## C1.2 Compatibility Decision (Phase 21)

```
PARALLEL_TOOL_CALLING: DEFER (no global toggle to port)
NATIVE_TOOL_CALLING: DEFER (no global toggle; provider-specific)
SUBAGENTS: PORT_DISABLED_BY_DEFAULT (subagentsEnabled default false)
STRICT_PLAN_MODE: PORT_AS_IS (control-plane; non-execution)
```

## P0 Regression Fix

**FINDING_ID**: EDIT-AUTOAPPROVE-AUTHORITY-REGRESSION01
**SEVERITY**: P0
**Symptom**: User toggles Edit in the Auto-Approve menu; ordinary workspace edits
still trigger an approval prompt.
**Root cause**: Commit `28de596ec` (CORRECTION04) split the auto-approval logic
into command and non-command paths. The non-command path was changed from
"`request.policy.autoApprove === true || shouldAutoApproveTool?.(request) === true`"
to just "`request.policy.autoApprove === true`". The host's `shouldAutoApproveTool`
callback (which evaluates `autoApprovalSettings.actions.editFiles`) was no longer
called for non-command tools.
**Fix**:
1. Restored `shouldAutoApproveTool` wiring in `SdkController.ts` for non-command tools.
2. Restored the `policy.autoApprove || shouldAutoApproveTool` short-circuit for
   non-command tools in `sdk-interaction-coordinator.ts`.
3. Command tools keep their atomic evaluator path (CORRECTION04 preserved).
4. Added 4 regression tests in `sdk-interaction-coordinator.test.ts` and 6
   tests in `sdk-tool-policies.test.ts`.

## Upstream Delta Ledger

| UPSTREAM_COMMIT_OR_TAG | PATH | CLINEMM_CHANGE | PORT_MODE | RATIONALE | LOCAL_DELTA |
|------------------------|------|----------------|-----------|-----------|-------------|
| v4.1.10 7e31fb9e0d... | apps/vscode/src/sdk/sdk-interaction-coordinator.ts | Restored shouldAutoApproveTool wiring for non-command tools | ADAPTED | ClineMM's CORRECTION04 split introduced the regression; restore upstream parity while preserving command-tool atomic evaluator | +9 lines |
| v4.1.10 7e31fb9e0d... | apps/vscode/src/sdk/SdkController.ts | Restored shouldAutoApproveTool option wired to isToolAutoApproved | ADAPTED | upstream v4.1.10 line 352-355 wires this; ClineMM dropped it; restored | +18 lines |
| v4.1.10 7e31fb9e0d... | apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts | Added 4 regression tests for non-command auto-approval | NEW | cover the P0 regression | +97 lines |
| v4.1.10 7e31fb9e0d... | apps/vscode/src/sdk/sdk-tool-policies.test.ts | Added 6 isToolAutoApproved tests for read/edit/web | NEW | prove the resolver honors settings | +48 lines |

## Files Changed

- `apps/vscode/src/sdk/SdkController.ts` (added shouldAutoApproveTool wiring)
- `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` (restored non-command path)
- `apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts` (4 new tests)
- `apps/vscode/src/sdk/sdk-tool-policies.test.ts` (6 new tests)

## Commit Plan

Two logical commits:

1. `docs(settings): inventory upstream settings parity and document P0 regression`
   - This file (`docs/upstream-parity/settings-authority-parity01.md`)
   - `.clinemm-evidence/*` evidence files

2. `feat(settings): restore non-command auto-approval authority (P0 regression fix)`
   - The 4 source/test files

