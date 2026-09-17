# 03-precedence.md

## Effective MCP approval algorithm (current production semantics)

Pseudocode derived verbatim from source
(`apps/vscode/src/sdk/sdk-tool-policies.ts:1055-1103`,
`apps/vscode/src/sdk/SdkController.ts:995-1014`,
`sdk/packages/agents/src/agent-runtime.ts:3084`).

```
effectiveMcpApproval(request, runtime) =
  # request.toolName is "<server>__<tool>"
  # runtime is the AgentRuntime with this.config.requestToolApproval wired

  # === SDK policy registry (built once per session) ===
  policy = toolPolicies[request.toolName]   # from buildToolPolicies
  # buildToolPolicies line 73-80 ALWAYS sets policies[mcpName] = { autoApprove: false }
  # for every MCP server×tool pair the McpHub has surfaced.
  # Therefore: policy.autoApprove === false  (const, by construction)

  # === Host callback (called by SDK per request) ===
  host_approved = this.config.requestToolApproval(request)
                  # routes to:
                  # SdkInteractionCoordinator.handleRequestToolApproval(request)
                  #   ↓
                  # runRequestToolApproval(request)
                  #   ↓
                  # [non-command branch] if request.policy.autoApprove || shouldAutoApproveTool
                  #   ↓
                  # shouldAutoApproveTool(request):
                  #   persisted = stateManager.getGlobalSettingsKey("autoApprovalSettings")
                  #              ?? DEFAULT_AUTO_APPROVAL_SETTINGS
                  #   override  = sessionAutoApproval.getOverride(activeSessionId) ?? "none"
                  #   effective = resolveEffectiveAutoApproval(persisted, override)
                  #   return isToolAutoApproved(request.toolName, effective, this.mcpHub, override)

  # === isToolAutoApproved (line 1055) for MCP branch (line 1076-1099) ===
  # for non-MCP tools, the early branches for read/edit/browser/command apply first
  mcpTool = parseMcpToolName(request.toolName)
  if mcpTool is None:
    return false                              # unknown tool → ASK
  if not this.mcpHub:
    return false                              # no McpHub → ASK (fail-closed)
  server = this.mcpHub.getServers().find(s => s.name == mcpTool.serverName)
  tool   = server?.tools?.find(t => t.name == mcpTool.toolName)
  if tool is None:
    return false                              # unknown server/tool pair → ASK
  if override == "all":
    return true                               # "ALL — this task" lifts both gates
  if not effective.actions.useMcp:
    return false                              # GLOBAL MCP OFF → ASK  ← load-bearing line
  return !!tool?.autoApprove                  # per-tool flag → ASK or ALLOW

  # === Coordinator short-circuit ===
  if host_approved.approved == true:
    return ALLOW                              # skip publish-and-await
  else:
    publish(ask: "use_mcp_server")            # or "use_mcp_server" + say message
    response = await resolvePendingToolApproval()
    if response.approved:
      return ALLOW
    else:
      return DENY

  # === Executor gate (AgentRuntime.executePreparedTool, function 3146; C1.2 body 3278) ===
  if approval.approved and toolExists and !inputParseError and !skipReason:
    toolExecutionInvoked = true               # set IMMEDIATELY before tool.execute
    tool.execute(input, context)              # ← actual MCP tool invocation
  else:
    toolExecutionInvoked = false
    emit content_end with skipReason          # MCP tool NOT invoked
```

## Precedence summary (answers §7 numbered questions)

1. **Does a global MCP auto-approve OFF setting force every MCP
   tool through approval?**

   YES, when `override === "none"`. The line
   `if (!settings.actions.useMcp) return false` (line 1096)
   short-circuits BEFORE the per-tool flag is consulted. So a tool
   whose `tool.autoApprove === true` STILL returns false when
   `useMcp === false` and `override === "none"`. (Verified by test
   A in `sdk-tool-policies.test.ts:131-133` and the integration test
   `figma-desktop/get_metadata + override=none + persisted MCP=false => ASK`
   in `sdk-interaction-coordinator.session-autonomy.test.ts:562-583`.)

2. **Can a per-server/per-tool `autoApprove` entry override that OFF state?**

   NO. Per-tool `autoApprove === true` is only consulted AFTER the
   global `useMcp === true` gate passes (line 1096-1099). Per-tool
   approval is the *second* gate, not an *override* of the global
   gate.

3. **Can a generic global/tool auto-approval setting override MCP-specific state?**

   NO for the global OFF case: line 1096 explicitly returns false
   before any other branch. The MCP branch is the most-restrictive
   branch in `isToolAutoApproved`.

4. **Does the webview merely control presentation, or does it write durable authority?**

   The webview writes durable authority. `AutoApproveMenuItem id="useMcp"`
   calls `updateAutoApprovalSettings` (gRPC) which persists to
   `~/.cline/data/globalState.json` via StateManager. The webview is
   the only UI writer; CLI/ACP have analogous writers through
   `updateSettingsCli`.

5. **Does persisted state get normalized or migrated before use?**

   YES on first read after VS Code upgrade (legacy migration in
   `apps/vscode/src/hosts/vscode/vscode-to-file-migration.ts`).
   After migration, the state is read as-is. There is NO runtime
   normalization of the `useMcp` boolean.

6. **Is the approval state snapshotted at task creation or read live for every invocation?**

   READ LIVE. `SdkController.shouldAutoApproveTool` calls
   `this.stateManager.getGlobalSettingsKey("autoApprovalSettings")` on
   EVERY tool-approval request (line 1002). No snapshot is taken at
   task creation for the MCP auto-approval decision. This matches
   the comment at `sdk-tool-policies.ts:113-117`: "Used both when
   building initial SDK policies and as a live guard in the
   approval callback, so changes from the AutoApproveBar are
   respected even if an SDK session was created before the toggle
   changed."

7. **Can there be stale task/controller state after a settings change?**

   NO for the MCP auto-approval decision. StateManager's cache is
   updated synchronously on every `setGlobalState` call; the
   next `getGlobalStateKey` reads the new value. For the
   ephemeral session override, the bound override is per-session and
   cleared on task end via `SessionAutoApprovalStore.clearActiveOverride`
   (verified by test "task ends ⇒ persisted MCP behavior restored ⇒
   Figma MCP back to ASK" in `sdk-interaction-coordinator.session-autonomy.test.ts:615-638`).

8. **Is there more than one copy of the relevant settings object?**

   NO. `autoApprovalSettings` has a single file-backed representation
   in `~/.cline/data/globalState.json`. The legacy VS Code
   `ExtensionContext.globalState` is a one-time migration source
   (`vscode-to-file-migration.ts`); after migration it is not
   consulted. There is no in-memory shadow copy for the
   auto-approval decision: `getGlobalSettingsKey` reads through to
   the file on cache miss.

9. **Does the MCP execution site itself verify approval, or does it trust an upstream classifier?**

   The MCP executor trusts the upstream approval result. `tool.execute(...)`
   in `AgentRuntime.executePreparedTool` (function 3146; C1.2 body 3278) is invoked
   only if the upstream `requestToolApproval` callback returned
   `approved: true`. The C1.2 invariant
   (`toolExecutionInvoked === true` ⇒ `tool.execute(...)` was
   called) provides a fail-closed gate: any future regression that
   bypasses the approval callback would result in
   `toolExecutionInvoked === false` and a `skipReason` content_end.

10. **Is absence of an explicit policy interpreted as:**

    * ask → **YES** for MCP. `parseMcpToolName` returning undefined
      returns false (line 1102); an MCP-shaped tool name with no
      matching server/tool pair returns false (line 1080-1082 +
      tests G1/G2 in `sdk-tool-policies.test.ts:204-213`).
    * allow → **NO** for MCP.
    * deny → **NO** (no explicit "deny" in this surface — false
      propagates to ASK, not DENY; tools that are explicitly DENY'd
      come from the `McpServer.disabled` field, which is a connection
      gate, not an approval gate).
    * inherit → **NO**. There is no implicit inheritance; the
      function returns false unless the explicit MCP branches match.
