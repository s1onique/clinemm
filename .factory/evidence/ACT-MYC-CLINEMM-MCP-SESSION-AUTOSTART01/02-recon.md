# ACT-MYC-CLINEMM-MCP-SESSION-AUTOSTART01 — Recon

ENTRY_HEAD=5cb95e88e50e8c5b5659cb6dc8fc3283d5dfaa26

## Production seam map (HEAD)

| Seam | File:line | Behavior |
|------|-----------|----------|
| MCP_SETTINGS_LOAD_SEAM | McpHub.updateServerConnections (apps/vscode/src/services/mcp/McpHub.ts:1503) | Calls `initializeMcpServers` on construction (line 185/391). For session-bound templates (`hasSessionBoundTemplate(name, config)` at line 1539), pushes `pendingConn` with `status: "pending-session"`, `transport: null`, `client: null`. NEVER calls `connectToServer` for session-bound templates. |
| SESSION_BOUND_TEMPLATE_DEFER_GATE | McpHub.hasSessionBoundTemplate (McpHub.ts:420) | True iff `cfg.type === "stdio"` and at least one `env` entry is `{ fromSession: ... }`. Reads stored config or `cfgHint` if provided. |
| SESSION_START_SEAM | sdk-session-lifecycle.startNewSession (apps/vscode/src/sdk/sdk-session-lifecycle.ts:327). Then SdkController.startNewSession via prepareStartSessionInput in vscode-session-host.ts:359. |
| SESSION_MCP_ACTIVATION_SEAM | vscode-session-host.prepareStartSessionInput (vscode-session-host.ts:382-413) | Reads `inputWithRemoteConfig.config.sessionId`, passes into `createVscodeExtraTools(options.mcpHub, { ..., sessionId: sessionIdForMcp })`. |
| TOOL_PROVIDER_CREATION_SEAM | createVscodeExtraTools (vscode-runtime-builder.ts:189) | Constructs `new McpHubToolProvider(mcpHub, options?.sessionId)`, then for every `mcpHub.getServers()` server calls `createMcpTools({ provider, serverName, ... })` EAGERLY. |
| ENSURE_SESSION_CONNECTION_SEAM | McpHub.ensureSessionConnection (McpHub.ts:467) | Called from McpHubToolProvider.listTools (vscode-runtime-builder.ts:39). For session-bound + no sessionId → `undefined` (A2A-14 DEFER). For session-bound + sessionId → spawn `StdioClientTransport`, store in `sessionConnections.get(sessionId)`. |
| STDIO_SPAWN_SEAM | McpHub.ensureSessionConnection transport block (McpHub.ts:509-518) | Real `new StdioClientTransport({ command, args, cwd, env: { ...getDefaultEnvironment(), ...resolvedEnvString } })` followed by `client.connect(transport, { timeout })`. |
| MANUAL_RESTART_SEAM | McpHub.restartConnection / RPC restart path. (TODO exact line) — expected: restartConnection → deleteConnection + connectToServer (static, no sessionId). |

## Critical recon question (ACT §6) — ANSWER

| Trigger | Connects MCP? |
|---------|---------------|
| Settings load, no session | **NO** (deferred — A2A-14) |
| Session start (createVscodeExtraTools → createMcpTools → provider.listTools) | **YES** (provider.listTools invokes `ensureSessionConnection(name, { sessionId })` which spawns StdioClientTransport when sessionId is set; vscode-runtime-builder.ts:38-58) |
| First tool call (provider.callTool) | **YES** (also routes through ensureSessionConnection; vscode-runtime-builder.ts:84-100) |
| Manual Restart Server | YES (restartConnection → deleteConnection + connectToServer; but McpHub restart does NOT take a sessionId so it does NOT trigger a per-session child for session-bound templates — relies on next listTools/callTool) |

This is the load-bearing discriminator.

SESSION_START_CONNECTS_MCP=true
LIST_TOOLS_CONNECTS_MCP=true (called eagerly during session-start)
FIRST_TOOL_CALL_CONNECTS_MCP=true
MANUAL_RESTART_CONNECTS_MCP=true (but only re-creates the static entry; per-session child comes from the next listTools/callTool)
## Path comparison (ACT §7)

### Automatic first-session path
```
startNewSession(S)
  → endActiveSession (cleanup)
  → ClineCore.startSession({ config: { ..., sessionId: S } })
    → prepareStartSessionInput (vscode-session-host.ts:359)
      → createVscodeExtraTools(mcpHub, { sessionId: S, ... })
        → for each mcpHub.getServers() entry:
          createMcpTools({ serverName, provider, ... })
            → provider.listTools(serverName)
              → mcpHub.ensureSessionConnection(serverName, { sessionId: S })
                → hasSessionBoundTemplate(name) === true
                → spawn StdioClientTransport
                → store in sessionConnections.get(S)
```

### Manual restart path
```
Operator clicks Restart Server
  → McpHub.restartConnection (RPC)
    → deleteConnection + connectToServer (static path; NO sessionId)
      → registers a DISCONNECTED / pending template entry, NOT a per-session child
```

### First divergence

The automatic path EAGERLY builds `McpHubToolProvider` and calls `provider.listTools` per server, which triggers `ensureSessionConnection`. Manual restart does NOT have a `sessionId`, so even though it touches the server it cannot materialize a per-session child — the child only materializes on next listTools/callTool.

AUTO_PATH=startNewSession → prepareStartSessionInput → createVscodeExtraTools → createMcpTools → provider.listTools → ensureSessionConnection → StdioClientTransport
MANUAL_RESTART_PATH=McpHub.restartConnection → deleteConnection → connectToServer (no sessionId)
FIRST_DIVERGENCE=AUTO carries sessionId through the chain; MANUAL_RESTART does not.

## Frozen hypotheses

| ID | Hypothesis | Verdict after recon |
|----|------------|---------------------|
| H1 | Session start never requests a connection for deferred templates. | LIKELY FALSE — `createMcpTools` eagerly invokes `provider.listTools` which calls `ensureSessionConnection(name, { sessionId })`. Production chain reaches the seam. |
| H2 | Session start requests it, but server remains classified as "already handled/deferred". | PARTIAL — pending-session entry's `server.tools` is undefined. createMcpTools expects `descriptors` from listTools. After ensureSessionConnection returns the per-session conn, listTools calls `conn.client?.listTools?.()`. If that fails, McpHubToolProvider falls back to `mcpHub.getServers()` cached `server.tools` (line 59-72). For pending-session entry, `tools` is undefined → fallthrough returns `[]`. |
| H3 | Tool discovery uses stale provider created before S existed. | UNLIKELY — `createVscodeExtraTools` is called per-session with the sessionId. Fresh provider. |
| H4 | ensureSessionConnection receives S but does not materialize the deferred template. | UNLIKELY — code path matches. |
| H5 | child actually starts, but UI/server state remains stale. | PLAUSIBLE — `pendingConn` status only flips to `"connected"` for the per-session conn (inside `ensureSessionConnection` line 538), but the static `pendingConn` in `this.connections` stays `status: "pending-session"`. The webview reads `getServers()` → `this.connections.filter(!disabled)` → sees the stale "pending-session" entry. That is the "red/orange" state the operator sees. |
| H6 | child startup fails at MCP initialize and manual restart happens to retry successfully. | UNLIKELY — initialize happens lazily on first listTools/callTool, not eagerly. The retry of manual restart just re-creates the static (no sessionId) path. |

## Most likely root cause: H5 (UI stale) + possible H1 chain failure

The defer path puts a `pending-session` entry in `connections`. The webview's MCP panel reads `hub.getServers()` (which is `connections.filter(!disabled)`) and shows `status: "pending-session"`. When the per-session child spawns successfully, the `pendingConn` in `connections` is NOT updated — only `sessionConnections.get(S).get(name)` becomes connected. Therefore the UI continues to show "pending-session" indefinitely.

The visible "red/orange" state is **the deferred status being preserved past the moment of successful per-session connect**. The runtime autostart probably works — the UI just doesn't know about it.

This is a UI/state-projection regression, not a runtime startup regression. The runtime fix may already be in place; the operator defect lives in the projection layer.
