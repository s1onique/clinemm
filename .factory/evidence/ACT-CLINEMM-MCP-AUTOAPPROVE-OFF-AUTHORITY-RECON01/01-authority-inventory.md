# 01-authority-inventory.md

Every MCP-approval representation that participates in the production
host's decision boundary.

## 1. Settings storage representations

### 1.1 `autoApprovalSettings.actions.useMcp` (global MCP toggle)

| Field | Value |
|-------|-------|
| Type | `boolean` |
| File | `apps/vscode/src/shared/AutoApprovalSettings.ts` (DEFAULT_AUTO_APPROVAL_SETTINGS) |
| Default | `true` (legacy field; not consulted by current runtime) |
| Persistence | global state (`autoApprovalSettings` key), file-backed via `StateManager` |
| Writer (UI) | `AutoApproveMenuItem id="useMcp"` in webview (`webview-ui/src/components/chat/auto-approve-menu/constants.ts`) |
| Writer (gRPC) | `src/core/controller/state/updateAutoApprovalSettings.ts` (`updateAutoApprovalSettings` handler); CLI/ACP also writes via `updateSettingsCli` |
| Reader (host) | `stateManager.getGlobalSettingsKey("autoApprovalSettings")` in `SdkController.shouldAutoApproveTool` (line 1002) |
| Transformation | passes through `resolveEffectiveAutoApproval(persisted, override)` (session-autonomy.ts) |
| Consumer | `sdk-tool-policies.isToolAutoApproved` (line 1096) |
| Evidence label | STRUCTURAL |

### 1.2 `McpServer.tool[].autoApprove` (per-tool flag)

| Field | Value |
|-------|-------|
| Type | `boolean` per `McpTool` (`apps/vscode/src/shared/mcp.ts`) |
| Default | `false` per tool |
| Persistence | `cline_mcp_settings.json` on disk (hydrated by `McpHub`) |
| Writer (UI) | webview `McpToolRow.tsx` checkbox → `toggleToolAutoApprove` RPC (`apps/vscode/src/core/controller/mcp/toggleToolAutoApprove.ts`) |
| Reader (host) | `McpHub.getServers()` then `.find((server) => server.name === mcpTool.serverName).tools.find((tool) => tool.name === mcpTool.toolName).autoApprove` |
| Consumer | `sdk-tool-policies.isToolAutoApproved` (line 1099, `!!tool?.autoApprove`) |
| Evidence label | STRUCTURAL |

### 1.3 `McpServer.disabled` (per-server disabled)

| Field | Value |
|-------|-------|
| Type | `boolean` per `McpServer` |
| Reader (host) | `McpHub.getServers()` |
| Consumer | NOT consumed by `isToolAutoApproved`; consumed by McpHub for connection skipping |
| Evidence label | STRUCTURAL |

### 1.4 `SessionAutoApprovalOverride = "none" | "all"` (task-scoped ephemeral)

| Field | Value |
|-------|-------|
| Type | union |
| File | `apps/vscode/src/sdk/session-auto-approval.ts` |
| Default | `"none"` |
| Persistence | in-memory only (per-session), consumed by `SdkSessionLifecycle` |
| Writer | `SessionAutoApprovalStore.setOverride(sessionId, "all")` triggered by UI "ALL — this task" |
| Reader (host) | `sessionAutoApproval.getOverride(sessionId)` (SdkController line 1005) |
| Consumer | passed through to `isToolAutoApproved` 4th arg (line 1013) AND to `resolveEffectiveAutoApproval` |
| Effect | `override === "all"` lifts the global `useMcp` and per-tool `autoApprove` gates; unknown server/tool pairs STILL fail closed |
| Evidence label | STRUCTURAL + REAL_PRODUCTION_SEAM (covered by `sdk-interaction-coordinator.session-autonomy.test.ts`) |

## 2. Decision boundary symbols

### 2.1 `parseMcpToolName(toolName)`

| Symbol | Value |
|--------|-------|
| Path | `apps/vscode/src/sdk/sdk-tool-policies.ts:104` |
| Input | `string` (e.g. `"figma-desktop__get_metadata"`) |
| Output | `{ serverName, toolName } \| undefined` |
| Behavior | splits on `"__"`; returns undefined if separator is at position 0/1 |
| Evidence label | STRUCTURAL |

### 2.2 `isToolAutoApproved(toolName, settings, mcpHub, override)`

| Symbol | Value |
|--------|-------|
| Path | `apps/vscode/src/sdk/sdk-tool-policies.ts:1055` |
| Input | `AutoApprovalSettings`, optional `McpHub`, `SessionAutoApprovalOverride` |
| Output | `boolean` |
| MCP branch (line 1076-1099) | `if (mcpTool) { if (!mcpHub) return false; const server = mcpHub.getServers().find(...); const tool = server?.tools?.find(...); if (override === "all") return !!tool; if (!settings.actions.useMcp) return false; return !!tool?.autoApprove; }` |
| Evidence label | STRUCTURAL + REAL_PRODUCTION_SEAM |

### 2.3 `SdkController.shouldAutoApproveTool`

| Symbol | Value |
|--------|-------|
| Path | `apps/vscode/src/sdk/SdkController.ts:995-1014` |
| Input | `ToolApprovalRequest` |
| Output | `boolean` |
| Behavior | reads live `autoApprovalSettings` from StateManager, reads ephemeral session override, builds `effective`, calls `isToolAutoApproved(request.toolName, effective, this.mcpHub, override)`; command tools return false here (they go through atomic `evaluateCommandToolApproval`) |
| Evidence label | STRUCTURAL + REAL_PRODUCTION_SEAM |

### 2.4 `SdkInteractionCoordinator.handleRequestToolApproval` (decision entry)

| Symbol | Value |
|--------|-------|
| Path | `apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326` |
| Input | `ToolApprovalRequest` |
| Output | `{ approved: boolean; reason?; decision?; executionPlan?; mandatorySeatbeltExecution? }` |
| Behavior | command tools → atomic evaluator + reformulation gate; non-command → `request.policy.autoApprove === true \|\| this.options.shouldAutoApproveTool?.(request) === true` short-circuit; fall-through → publish an `ask` message and await `resolvePendingToolApproval` |
| Evidence label | STRUCTURAL + REAL_PRODUCTION_SEAM |

### 2.5 `AgentRuntime.requestToolApproval` (SDK consumer of host callback)

| Symbol | Value |
|--------|-------|
| Path | `sdk/packages/agents/src/agent-runtime.ts:3084` |
| Input | `AgentToolCallPart`, `unknown input`, `ToolPolicy` |
| Output | `ToolApprovalResult` |
| Behavior | sets `state.executionAwaitingApproval = true`, calls `this.config.requestToolApproval(...)`, returns the host's result; if no callback is configured, returns `{ approved: false, reason: ... }`; throw from callback returns `{ approved: false }` (fail-closed) |
| Evidence label | STRUCTURAL |

### 2.6 `AgentRuntime.executePreparedTool` (executor gate)

| Symbol | Value |
|--------|-------|
| Path | `sdk/packages/agents/src/agent-runtime.ts:3146` (function); C1.2 invariant body at 3278-3282 |
| Behavior | C1.2 boundary gate: `toolExecutionInvoked` is set TRUE IMMEDIATELY before `tool.execute(...)` and is NEVER inferred from approval result. The closure-plan truth table is: `!toolExists` ⇒ false; `inputParseError` ⇒ false; `skipReason` ⇒ false; `approval !approved` ⇒ false; `tool.execute(...) called` ⇒ true |
| Evidence label | STRUCTURAL (load-bearing for the safety invariant; verified by `sdk/packages/agents/src/agent-runtime.outcome-integration.test.ts`) |

## 3. Boundary table (per ACT §5 schema)

| Boundary | Symbol | File | Input | Output | Evidence |
|----------|--------|------|-------|--------|----------|
| Persistence → runtime | `stateManager.getGlobalSettingsKey("autoApprovalSettings")` | apps/vscode/src/core/storage/StateManager.ts | (file-backed JSON) | `AutoApprovalSettings \| undefined` | STRUCTURAL |
| Runtime → override merge | `resolveEffectiveAutoApproval` | apps/vscode/src/sdk/session-auto-approval.ts | (persisted, override) | (effective) | STRUCTURAL + unit tests |
| Override merge → classifier | `shouldAutoApproveTool(request)` | apps/vscode/src/sdk/SdkController.ts:995 | (request, live persisted, override) | `boolean` | STRUCTURAL + REAL_PRODUCTION_SEAM |
| Classifier | `isToolAutoApproved(toolName, settings, mcpHub, override)` | apps/vscode/src/sdk/sdk-tool-policies.ts:1055 | (toolName, settings, mcpHub, override) | `boolean` | STRUCTURAL + unit tests + REAL_PRODUCTION_SEAM |
| Coordinator decision | `runRequestToolApproval` short-circuit (line 510, 521) | apps/vscode/src/sdk/sdk-interaction-coordinator.ts:375 | (request) | `{ approved: true }` | STRUCTURAL + integration tests |
| SDK consumer | `requestToolApproval` (AgentRuntime) | sdk/packages/agents/src/agent-runtime.ts:3084 | (toolCall, input, policy) | `ToolApprovalResult` | STRUCTURAL |
| Execution gate | `executePreparedTool` C1.2 invariant | sdk/packages/agents/src/agent-runtime.ts:3146/3278 | (prepared) | `AgentMessage` | STRUCTURAL + integration tests |
