# 02-production-callgraph.md

## Dogfood production route

The exact production call graph for a single MCP tool invocation
under the VS Code dogfood host when MCP auto-approval is **OFF**:

```
[Model emits MCP tool call]
  ↓
AgentRuntime.handleModelStreamEvent (sdk/packages/agents/src/agent-runtime.ts)
  ↓
AgentRuntime.requestToolApproval(toolCall, input, policy)
  sdk/packages/agents/src/agent-runtime.ts:3084
  ↓ [await]
this.config.requestToolApproval(request)
  // === THIS IS THE HOST CALLBACK, NOT THE SDK ===
  // The host wires it in SdkController.ts (line 1150-1160, runtime builder)
  ↓
SdkInteractionCoordinator.handleRequestToolApproval(request)
  apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326
  ↓
runRequestToolApproval (apps/vscode/src/sdk/sdk-interaction-coordinator.ts:375)
  ↓
[branch on isCommand]   ← isCommandTool(request.toolName)
  ↓
[non-command branch]
  ↓
short-circuit check:
  if (request.policy.autoApprove === true
      || this.options.shouldAutoApproveTool?.(request) === true)
      → return { approved: true }            // line 521
  ↓ [if short-circuit does not fire]
[publish ask message; await resolvePendingToolApproval]
  ↓
resolvePendingToolApproval(response, responseType)
  // user clicks Approve → { approved: true }
  // user clicks Reject  → { approved: false }
  ↓
return { approved }
  ↓ [back up the call chain]
AgentRuntime.requestToolApproval returns ToolApprovalResult
  ↓
AgentRuntime.executePreparedTool(prepared)
  sdk/packages/agents/src/agent-runtime.ts:3146 (function); C1.2 body at 3278
  ↓
[C1.2 boundary gate]
  if (approval.approved === true && all other gates pass):
      toolExecutionInvoked = true   ← set IMMEDIATELY before tool.execute
      await tool.execute(input, context)
  else:
      toolExecutionInvoked = false
      result.output.error = skipReason
      content_end.error = skipReason
  ↓
[content_end emitted to host session event stream]
  ↓
MessageTranslator (apps/vscode/src/sdk/message-translator.ts) converts
  agent_event.content_end → say="use_mcp_server" + say="mcp_server_response"
  (only when approval was approved AND tool actually executed)
```

## The non-command short-circuit — the production decision boundary

The single line that determines whether the MCP tool auto-approves
in the production route when MCP is OFF is at
**`apps/vscode/src/sdk/sdk-interaction-coordinator.ts:521`**:

```ts
if (request.policy.autoApprove === true || this.options.shouldAutoApproveTool?.(request) === true) {
    return { approved: true }
}
```

`request.policy.autoApprove` is set by the SDK `toolPolicies` registry
that the host builds in `buildToolPolicies` (line 73-80 of
`sdk-tool-policies.ts`). For every MCP tool (`serverName__toolName`)
the policy is **explicitly set to `{ autoApprove: false }`** — so the
SDK short-circuit is OFF by construction for all MCP tools.

The host's `shouldAutoApproveTool` callback (SdkController.ts:995)
is what evaluates the **live** `autoApprovalSettings` (read from
StateManager on every call, not snapshotted at session creation).

## The classification function

`shouldAutoApproveTool(request)` in SdkController.ts:

```ts
shouldAutoApproveTool: (request) => {
    if (isCommandTool(request.toolName)) {
        return false   // command tools bypass this hook
    }
    const autoApprovalSettings = this.stateManager.getGlobalSettingsKey("autoApprovalSettings")
    const persisted = autoApprovalSettings ?? DEFAULT_AUTO_APPROVAL_SETTINGS
    const sessionId = this.sessions.getActiveSession()?.sessionId
    const override = this.sessionAutoApproval.getOverride(sessionId)
    const effective = resolveEffectiveAutoApproval(persisted, override)
    return isToolAutoApproved(request.toolName, effective, this.mcpHub, override)
}
```

`isToolAutoApproved` MCP branch (line 1076-1099):

```ts
const mcpTool = parseMcpToolName(toolName)
if (mcpTool) {
    if (!mcpHub) return false
    const server = mcpHub.getServers().find((e) => e.name === mcpTool.serverName)
    const tool = server?.tools?.find((e) => e.name === mcpTool.toolName)
    if (override === "all") return !!tool
    if (!settings.actions.useMcp) return false
    return !!tool?.autoApprove
}
```

## Why the boundary is real (not bypassable)

The execution gate is downstream of the approval callback:

```
approved: false  →  AgentRuntime sets toolExecutionInvoked = false
                  →  executePreparedTool writes result.output.error = skipReason
                  →  no tool.execute(...) call
```

`toolExecutionInvoked` is set TRUE **only** immediately before
`tool.execute(...)` is called (AgentRuntime.ts:3166-3182), never
inferred from approval result. Verified by
`sdk/packages/agents/src/agent-runtime.outcome-integration.test.ts`.

So the safety invariant "MCP must NOT execute before approval" is
enforced by both:

1. **Synchronous gate**: the coordinator's `request.policy.autoApprove
   || shouldAutoApproveTool` short-circuit — if it returns false, no
   return path produces `{ approved: true }`.

2. **Asynchronous gate**: even if the synchronous gate is bypassed,
   the executor's `toolExecutionInvoked` is FALSE for any non-approved
   request; `tool.execute(...)` is never reached.

These two gates are **AND'd** at the call graph, providing defense in
depth.
