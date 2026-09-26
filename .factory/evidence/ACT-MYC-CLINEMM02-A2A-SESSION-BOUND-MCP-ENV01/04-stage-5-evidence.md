# ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — Stage 5 Evidence

## Status: GREEN

Production seams A2A-14..A2A-18 are wired and exercised end-to-end against
the **real `McpHub`** (not raw `StdioClientTransport + Client` pairs).

| Row | Status | Proof |
|---|---|---|
| **A2A-08** hub-owned A+B | GREEN | `hub.sessionConnections.size === 2`, two distinct `McpConnection` instances each owning a real `Client` + `Transport`; payload PIDs differ; payload sessions match `session-A` / `session-B`. |
| **A2A-09** hub reconnect A | GREEN | After tearing down A's connection and re-acquiring under the same id, payload PID differs from the original A; B's payload PID is unchanged. |
| **A2A-12** static + session-bound coexist | GREEN | `hub.connections.length === 1` (the static placeholder is untouched); `hub.sessionConnections.size === 2` (per-session children live in their own map). |
| **A2A-13** `disconnectSession(A)` | GREEN | After `hub.disconnectSession("session-A")`, A's per-session map entry is undefined; B's per-session map entry remains and a fresh `whoami` returns the same payload PID as before. |
| **A2A-14** STARTUP DEFER | GREEN | `hub.ensureSessionConnection("session-id-echo", {})` returns `undefined` AND `hub.sessionConnections.size === 0`. With legacy (non-fromSession) config, the same call returns the static connection without spawning anything. |
| **A2A-15** PRODUCTION ACQUISITION | GREEN | `McpHubToolProvider(hub, "session-prod-A").callTool(...)` reaches the spawned per-session child; payload `pid !== process.pid`; payload `session === "session-prod-A"`. The hub's per-session map holds the acquired child. |
| **A2A-16** PRODUCTION TEARDOWN | GREEN | After `hub.disconnectSession("session-prod-A")` (driven through the production shape `Promise.all([sdkHost.stop, mcpHub.disconnectSession])` from `sdk-session-lifecycle.trackSessionStop`), A's map entry is gone, B still answers, A's fresh acquire spawns a new PID. |
| **A2A-17** PRODUCTION DISCOVERY | GREEN | `McpHubToolProvider(hub, "session-prod-A").listTools("session-id-echo")` returns the per-session child's tool set (includes `whoami`). |
| **A2A-18** PRODUCTION DISCOVERY ISOLATION | GREEN | Two `McpHubToolProvider` instances with different sessionIds each spawn their own child; payload PIDs differ; payload sessions match. |

## Test runner output

```
[67/89] ok   3 pass / 0 fail      src/services/mcp/__tests__/sessionIdEcho.test.ts
[68/89] ok   6 pass / 0 fail      src/services/mcp/__tests__/sessionIdEcho.isolation.test.ts
[76/89] ok   11 pass / 0 fail     src/services/mcp/__tests__/sessionIdEcho.mcpHub.test.ts
─────────────────────────────────────────────────────────────────────────────
Files: 89   Pass: 1204   Fail: 0   Time: 39.6s
All unit test files passed.
```

Stage 5 adds 11 tests (the `sessionIdEcho.mcpHub.test.ts` file). Total
suite grows from 1193 to 1204 (+11). **Zero regressions** in pre-existing
`McpHub.*` tests:

```
[58/89] ok   24 pass / 0 fail     src/services/mcp/__tests__/McpHub.callTool.test.ts
[59/89] ok   2 pass / 0 fail      src/services/mcp/__tests__/McpHub.connectFailure.test.ts
[60/89] ok   5 pass / 0 fail      src/services/mcp/__tests__/McpHub.deleteServerRPC.test.ts
[61/89] ok   21 pass / 0 fail     src/services/mcp/__tests__/McpHub.listChangedRefresh.test.ts
[64/89] ok   19 pass / 0 fail     src/services/mcp/__tests__/McpHub.toolListChange.test.ts
[65/89] ok   2 pass / 0 fail      src/services/mcp/__tests__/McpHub.timeoutReconnect.test.ts
```

## Production tree changes

```
apps/vscode/src/services/mcp/McpHub.ts             | 222 ++++++++++++++++++++-
apps/vscode/src/sdk/vscode-runtime-builder.ts      |  71 ++++++-
apps/vscode/src/sdk/sdk-session-lifecycle.ts       |  15 +-
apps/vscode/src/services/mcp/__tests__/sessionIdEcho.isolation.test.ts | 10 +-
apps/vscode/src/services/mcp/__tests__/sessionIdEcho.mcpHub.test.ts    | 391 ++++++++++ (new)
```

### McpHub.ts

- New field `sessionConnections: Map<sessionId, Map<serverName, McpConnection>>`.
- New method `private hasSessionBoundTemplate(name): boolean` — true iff the server's stored config contains any `{fromSession: ...}` entry.
- New method `async ensureSessionConnection(serverName, opts: { sessionId? }): Promise<McpConnection | undefined>` — the **discover seam**. Returns `undefined` for A2A-14 STARTUP DEFER. Lazily spawns a per-session `StdioClientTransport` + `Client` pair via `resolveMcpServerEnv(template.env, process.env, { sessionId })` when a `sessionId` is supplied and the server is session-bound.
- New method `async disconnectSession(sessionId): Promise<void>` — the **release seam**. Tears down every per-session child for `sessionId`; the static `connections` array is untouched. Idempotent.
- `callTool(serverName, toolName, args, ulid, signal?, sessionId?)` — added optional 6th arg. When supplied, routes through `ensureSessionConnection`; otherwise unchanged legacy path.

### vscode-runtime-builder.ts

- `McpHubToolProvider` constructor now takes `(mcpHub, sessionId?)` so every `listTools` / `callTool` routed through the same provider reaches the per-session child.
- `McpHubToolProvider.callTool` passes the captured `sessionId` through to `mcpHub.callTool`.
- `McpHubToolProvider.listTools` routes through `ensureSessionConnection` when `sessionId` is set, then calls `client.listTools()` on the spawned child.
- `VscodeExtraToolsOptions.sessionId?: string` — new optional field. `createVscodeExtraTools(mcpHub, {sessionId})` forwards it into the provider.

### sdk-session-lifecycle.ts

- `trackSessionStop` wraps `sdkHost.stop(sessionId)` AND `mcpHub.disconnectSession(sessionId)` in `Promise.all`, with a `.catch` on the MCP teardown so a failure there cannot wedge `pendingStops`. This is the **production release seam**: every session stop tears down the per-session MCP child alongside the SDK host stop.

### sessionIdEcho.mcpHub.test.ts (NEW)

11 cases driving the real `McpHub` lifecycle end-to-end via the fixture:
A2A-08, A2A-09, A2A-12, A2A-13, A2A-14 (two cases), A2A-15, A2A-16,
A2A-17, A2A-18, plus a `timeoutMsFor` sanity case.

The test bypasses the constructor's filesystem side-effects via
`Object.create(McpHub.prototype)` (matching the existing pattern in
`McpHub.callTool.test.ts`), injects only the state the new methods
actually touch (`connections`, `clientVersion`, `telemetryService`,
`sessionConnections`), and asserts the child-side `pid !== process.pid`
+ `session === "<sessionId>"` invariant in every spawn path.

## Cumulative status

| Stage | Status |
|---|---|
| Stage 1 — Schema RED→GREEN | ✅ GREEN (commit 3ee2f0bc3) |
| Stage 2 — Resolver GREEN   | ✅ GREEN (commit 3ee2f0bc3) |
| Stage 3 — A2A-04 child witness | ✅ GREEN (commit 3ee2f0bc3) |
| Stage 4 — A/B isolation rows | ✅ GREEN (commit ceb4c801f) |
| Stage 5 — Production seams | ✅ GREEN (this commit) |
| Stage 6 — Conservation gate | ⏳ pending |
| Stage 7 — Closure | ⏳ pending |

