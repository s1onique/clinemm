# Local Settings Seam Map — ClineMM

> Recon snapshot of the ClineMM webview Settings surface and its
> state/proto/persistence wiring, captured 2026-08-29 against
> `main` HEAD `f6b6697e5`. Recon-only: no production code modified.
> Evidence labels: **REAL_PRODUCTION_SEAM** (verified open + grep
> + read), **STRUCTURAL** (visible in code but not exercised by
> this recon), **INFERRED** (derived from existing patterns).

## 1. Settings root / tab registry

| File | Symbol | Role |
|---|---|---|
| `apps/vscode/webview-ui/src/components/settings/SettingsView.tsx` | `SETTINGS_TABS` (lines 47–101) | Tab registry / sidebar nav. |
| `apps/vscode/webview-ui/src/components/settings/SettingsView.tsx` | `TAB_CONTENT_MAP` (referenced at line 232) | Maps tab id → section component. |
| `apps/vscode/webview-ui/src/components/settings/SettingsView.tsx` | `type SettingsTabID = "api-config" \| "features" \| "terminal" \| "general" \| "about" \| "debug" \| "remote-config"` (line 37) | Closed tab id union. |

Tab IDs that exist today:

```text
api-config      → ApiConfigurationSection.tsx
features        → FeatureSettingsSection.tsx
terminal        → TerminalSettingsSection.tsx
general         → GeneralSettingsSection.tsx
remote-config   → RemoteConfigSection.tsx   ; hidden unless org admin/owner
about           → AboutSection.tsx
debug           → DebugSection.tsx          ; hidden unless IS_DEV or internal tester
```

**REAL_PRODUCTION_SEAM**. No "Sandbox", "Security", "Capabilities",
"Diagnostics", or "Advanced" tab currently exists. "Advanced" in
this fork is a *sub-group inside Features* (lines 305–337 of
`FeatureSettingsSection.tsx`), not a top-level tab. **STRUCTURAL**:
the tab registry is a simple array, so adding a new tab is
mechanically one entry + one section file.

## 2. API Configuration page

| File | Symbol | Role |
|---|---|---|
| `apps/vscode/webview-ui/src/components/settings/sections/ApiConfigurationSection.tsx` (93 lines) | `ApiConfigurationSection` | Hosts provider pickers + model pickers. |
| `apps/vscode/webview-ui/src/components/settings/SettingsView.tsx` | `props.initialModelTab` (line 245) | API tab accepts an initial model-tab prop. |

**REAL_PRODUCTION_SEAM**. No sandbox / YOLO / network / SSH-agent
controls. STRUCTURAL: only provider/model fields.

## 3. Features page (current local surface)

`apps/vscode/webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`
(342 lines).

Three sub-groups inside Features:

```text
Agent       → agentFeatures[]        = [ Auto Compact ]
Editor      → editorFeatures[]       = [ Feature Tips, Background Edit,
                                          Checkpoints, Worktrees ]
Advanced    → advancedFeatures[]     = [ Hooks ]
```

Plus two explicitly-not-in-array controls:

```text
Auto Compact Strategy   (Select)   ; settingKey = "compactionStrategy"
Context ceiling         (text)     ; settingKey = "userContextCeiling"
Web Search              (Switch)   ; settingKey = "webSearchEnabled"
MCP Display Mode        (Select)   ; settingKey = "mcpDisplayMode"
```

**REAL_PRODUCTION_SEAM**. Sandbox / YOLO / network / SSH-agent
controls are ABSENT. The Advanced sub-group has exactly one row
("Hooks") today. STRUCTURAL: the `advancedFeatures[]` array is the
natural seam for adding `Disable Seatbelt`, `Allow network`, and
`Allow SSH agent` toggles.

## 4. Terminal page

`apps/vscode/webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`
(201 lines). **REAL_PRODUCTION_SEAM**: terminal-specific
(`shellIntegrationTimeout`, `terminalReuseEnabled`,
`defaultTerminalProfile`, `vscodeTerminalExecutionMode`). No
sandbox controls.

## 5. General page

`apps/vscode/webview-ui/src/components/settings/sections/GeneralSettingsSection.tsx`
(68 lines). **REAL_PRODUCTION_SEAM**: telemetry toggle + preferred
language only.

## 6. About / Debug / Remote-config pages

- `AboutSection.tsx` (68 lines): version info.
- `DebugSection.tsx` (42 lines): dev/internal-only diagnostic
  tools (reset state etc.).
- `RemoteConfigSection.tsx` (318 lines): organisation-pushed
  remote config fields.

## 7. State / context ownership

| File | Symbol | Role |
|---|---|---|
| `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx` | `useExtensionState()` | Webview state hook. |
| `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts` | `getStateToPostToWebview(controller)` | Single canonical projection function (line 21–23 docstring). |
| `apps/vscode/src/core/controller/index.ts` | `controller.getStateToPostToWebview()` | Controller method delegating to the helper. |

The webview reads through `useExtensionState()`; the controller
projects through `getStateToPostToWebview()`. **REAL_PRODUCTION_SEAM**.

`getStateToPostToWebview.ts` already projects a flat
`autoApprovalSettings`, `enableCheckpointsSetting`, `hooksEnabled`,
`mcpDisplayMode`, `useAutoCondense`, `compactionStrategy`,
`userContextCeiling`, `webSearchEnabled`, `subagentsEnabled`,
`worktreesEnabled`, `backgroundEditEnabled`, `showFeatureTips`,
`telemetrySetting`, `preferredLanguage`, etc. Adding a new field
to `UpdateSettingsRequest` is *not* sufficient — the field must
also be added to the projection in this file. **REAL_PRODUCTION_SEAM**
caveat (per the upstream `.clinerules/general.md` warning captured
in this ACT's §RADAR): missing one side of the round-trip is the
classic stuck-toggle bug.

## 8. Persistence ownership

| File | Symbol | Role |
|---|---|---|
| `apps/vscode/src/shared/storage/state-keys.ts` | `GlobalState`, `Settings`, `SecretKeys` | Type definitions and key list. |
| `apps/vscode/src/core/storage/StateManager.ts` | `setGlobalState`, `getGlobalStateKey` | Cache + debounced file-backed write. |
| `apps/vscode/src/shared/storage/ClineFileStorage.ts` | `get`, `set`, `setBatch` | Atomic write-then-rename JSON store. |

**REAL_PRODUCTION_SEAM** (Storage doctrine in `.clinerules/storage.md`).
Do NOT use `context.globalState`; use `StateManager.get().setGlobalState(...)`.

## 9. Protobuf / state RPC definitions

| File | Symbol | Role |
|---|---|---|
| `apps/vscode/proto/cline/state.proto` | `service StateService { rpc updateSettings(UpdateSettingsRequest) returns (Empty); rpc updateSettingsCli(UpdateSettingsRequestCli) returns (Empty); ... }` (lines 22–23) | Settings RPC. |
| `apps/vscode/proto/cline/state.proto` | `message UpdateSettingsRequest` (line 414) | Field bag. |
| `apps/vscode/proto/cline/state.proto` | `message UpdateSettingsRequestCli` (line 400) | CLI variant. |
| `apps/vscode/proto/cline/state.proto` | `message AutoApprovalSettings` (line 60) | YOLO surface (per upstream migration). |
| `apps/vscode/proto/cline/state.proto` | `Settings` (line 118+) | Server-side canonical state. |

Reserved slots (load-bearing — they encode upstream removals):

```text
reserved 15; // was openai_reasoning_effort (moved to mode-scoped)
reserved 23; // was dictation_settings (dictation removed)
reserved 32, 34, 35, 41;
reserved 38; // was skills_enabled (removed - now always enabled)
reserved 43; // was lazy_teammate_mode_enabled (removed)
reserved 12; // was terminal_output_line_limit (removed)
reserved 19; // was custom_prompt (removed)
reserved 22; // was yolo_mode_toggled (migrated into auto_approval_settings)
reserved 28; // was max_consecutive_mistakes
reserved "native_tool_call_enabled", "cline_web_tools_enabled",
           "enable_parallel_tool_calling", "double_check_completion_enabled",
           "custom_prompt";
```

**REAL_PRODUCTION_SEAM**: this list is the upstream-side history
of deletions; re-introducing `yolo_mode_toggled` would collide with
upstream. ClineMM should keep the `auto_approval_settings` shape.

## 10. Controller-side handlers

| File | Symbol | Role |
|---|---|---|
| `apps/vscode/src/core/controller/state/updateSettings.ts` | `updateSettings(controller, request)` | Webview update path. |
| `apps/vscode/src/core/controller/state/updateSettingsCli.ts` | `updateSettingsCli(controller, request)` | CLI / ACP update path. |
| `apps/vscode/src/core/controller/state/updateAutoApprovalSettings.ts` | `updateAutoApprovalSettings(controller, request)` | YOLO/AutoApproval handler. |
| `apps/vscode/src/core/controller/state/getLatestState.ts` | `getLatestState` | Reads from projection. |
| `apps/vscode/src/core/controller/state/subscribeToState.ts` | `subscribeToState` | State stream subscription. |

Per the `.clinerules/general.md` warning: a setting must wire
through both `updateSettings.ts` (webview) AND `updateSettingsCli.ts`
(CLI / ACP). Missing one causes the toggle to appear to work in
one surface and revert in another. **REAL_PRODUCTION_SEAM**.

## 11. Seatbelt / YOLO / SSH integration point

| File | Symbol | Role |
|---|---|---|
| `apps/vscode/src/sdk/sandbox-policy.ts` | `resolveExperimentalSandboxMode()` (line 128) | Reads `CLINEMM_EXPERIMENTAL_SANDBOX`. |
| `apps/vscode/src/sdk/sandbox-policy.ts` | `resolveSafeYoloNetworkOptIn()` (line ~197) | Reads `CLINEMM_SAFE_YOLO_NETWORK`. |
| `apps/vscode/src/sdk/sandbox-policy.ts` | `resolveSafeYoloSshAgentOptIn()` (line ~240) | Reads `CLINEMM_SAFE_YOLO_SSH_AGENT`. |
| `apps/vscode/src/sdk/sandbox-policy.ts` | `buildExperimentalReconCapability()` (line ~673) | Composes the capability from env vars. |
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts` | `buildSshAgentSocketRules` | Emits path-literal AF_UNIX rules. |
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts` | `sshAuthenticationAuthority` wiring (lines 306–379) | Validates the canonical AF_UNIX socket. |
| `sdk/packages/core/src/runtime/sandbox/types.ts` | `CommandCapability.sshAuthenticationAuthority` (line 194) | Capability field. |
| `sdk/packages/core/src/runtime/sandbox/environment.ts` | `SECRET_BLOCKLIST` (line 89), `SSH_AUTH_SOCK` (line 105), `materializeEnvironment` step 3 vs 4 | The env allow-list/reintroduce logic. |

**REAL_PRODUCTION_SEAM**. The runtime contract is frozen at the
REC01/IMPL01 pair and is NOT to be redesigned by the
implementation ACT. The settings surface only changes *how a value
reaches `buildExperimentalReconCapability`*, not what the function
does with it.

## 12. Settings update path (util)

`apps/vscode/webview-ui/src/components/settings/utils/settingsHandlers.ts` —
exported `updateSetting(key, value)` helper that the settings UI
calls to push a value through `StateServiceClient.updateSettings`.
**REAL_PRODUCTION_SEAM** (the helper exists; grep hits for
`updateSetting(` confirm).

## 13. CLINEMM-specific surface (today's delta vs pre-fork)

Today, **zero** user-facing settings exist for:

```text
- Seatbelt on/off          (substrate default; env break-glass only)
- Network allow            (env-only opt-in)
- SSH agent authority      (env-only opt-in)
- PTAD / diagnostics       (dev-only, behind `IS_DEV` or internal tester)
- YOLO                     (no UI; autoApprovalSettings exists but
                             no public toggle in this fork)
```

The ClineMM-delta is therefore:

| Surface | Pre-fork | ClineMM today | Notes |
|---|---|---|---|
| YOLO | Settings toggle | No UI; operator-controlled via env + auto_approval_settings plumbing | upstream removed `yolo_mode_toggled`; replaced with `auto_approval_settings`. |
| Network allow | Settings toggle | Env-only | upstream has a "Allow outbound network" toggle candidate. |
| SSH agent | n/a (new) | Env-only | ClineMM-specific surface, no upstream equivalent. |
| Seatbelt on/off | n/a (Darwin-only) | Substrate default ON, env break-glass | ClineMM-specific, no upstream equivalent. |

**INFERRED**: based on the recon pattern (per `.clinerules/general.md`
Settings round-trip warning, captured in this ACT's §RADAR). The
inventory itself is **REAL_PRODUCTION_SEAM**.
