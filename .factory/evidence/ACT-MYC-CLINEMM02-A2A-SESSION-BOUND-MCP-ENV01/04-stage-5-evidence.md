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
| Stage 5 — Production seams (seam-level) | ✅ GREEN (commit 12ff01021) |
| Stage 5 — HALT 1 (production-shape discovery/release wiring) | ✅ GREEN (commit 88e557414) |
| Stage 5 — HALT 2 (settings-load STARTUP DEFER contract) | ✅ GREEN (commit 7647d0413) |
| Stage 6 — Conservation gate | ⏳ pending |
| Stage 7 — Closure | ⏳ pending |

## HALT correction 1: discovery/release production-shape (commit 88e557414)

Resolves `HALT_SESSION_ID_NOT_WIRED_INTO_PRODUCTION_DISCOVERY`. The
Stage 5 commit (12ff01021) wired the seam-level plumbing
(`McpHub.ensureSessionConnection`, `McpHub.disconnectSession`,
`McpHubToolProvider(sessionId?)`, `createVscodeExtraTools({sessionId})`,
`sdk-session-lifecycle.trackSessionStop`) and proved each leg with
direct construction. The halt correctly observed that
`vscode-session-host.ts` was NOT modified, so the production caller
never reached the seams.

The HALT 1 correction lands:

1. `vscode-session-host.ts:382` (NEW) — captures
   `inputWithRemoteConfig.config.sessionId?.trim()` from the canonical
   `ClineCoreStartInput.config` upstream.
2. `vscode-session-host.ts:413` (NEW) — forwards
   `sessionId: sessionIdForMcp` into `createVscodeExtraTools(...)`.
3. `apps/vscode/src/services/mcp/__tests__/sessionIdEcho.productionShape.test.ts`
   (NEW, 8 cases) — drives the production call chains:
   - **A2A-14 settings-load path** (initial form): real `McpHub.updateServerConnections(...)`
     with a session-bound template; `ensureSessionConnection(name, {})`
     returns `undefined` AND `sessionConnections.size === 0`.
     (NOTE: this initial form was later superseded by HALT 2 below —
     it accidentally installed a sinon.stub that exercised the legacy
     path; the HALT 2 rewrite replaces it with a `sinon.spy()` and
     asserts `connectToServer.callCount === 0`.)
   - **A2A-16 lifecycle caller**: real `SdkSessionLifecycle.startNewSession`
     → `endActiveSession` (the narrowest externally callable entry that
     reaches `trackSessionStop`); asserts BOTH `mcpHub.disconnectSession("session-A")`
     AND `sdkHost.stop("session-A")` fire on the production `Promise.all`
     pair; coexisting B child survives; re-acquire of A spawns a new PID.
   - **A2A-17/18 production-shape host discovery**: real
     `VscodeSessionHost.create` → `bootstrap.applyToStartSessionInput({config: {sessionId}})`
     → produced MCP tool's `execute()` reaches the spawned per-session
     child with `payload.session === sessionId` and `payload.pid !== process.pid`;
     two distinct sessionIds produce two distinct PIDs.

## HALT correction 2: STARTUP DEFER contract (commit 7647d0413)

Resolves `HALT_SESSION_BOUND_STARTUP_DEFER_NOT_PROVEN`. HALT 1's
A2A-14 had a false-green: the test stub replaced `connectToServer`
with `sinon.stub().callsFake(...)` that pushed a fake connected
entry into `hub.connections` and asserted
`connectToServer.callCount === 1`. The test accidentally proved
the legacy global-connect path was being EXERCISED for a
session-bound template, not deferred. The HALT correctly
observed this and demanded a bounded production fix.

The HALT 2 correction lands:

1. `McpHub.updateServerConnections` new-server branch:
   - BEFORE calling `connectToServer(name, config, "internal")`,
     call `hasSessionBoundTemplate(name, config)` on the raw
     incoming config.
   - When the template contains a `{fromSession: ...}` env entry,
     push a configured-but-pending entry into `this.connections`
     (`status: "pending-session"`, `transport: null`,
     `client: null`) and skip the spawn entirely.
     `StdioClientTransport` is never constructed.
   - When the template has only flat string env entries,
     fall through to the legacy `connectToServer` path
     unchanged. The static control is preserved.
2. `McpHub.hasSessionBoundTemplate(name, cfgHint?)` — accepts an
   optional raw incoming config (so the new-server branch can
   check the template before any entry exists in `connections`).
   The legacy call site (`ensureSessionConnection`) keeps
   working without the hint.
3. `shared/mcp.ts`: `McpServer.status` literal extends to include
   `"pending-session"` (apps/vscode internal sentinel).
4. `shared/proto-conversions/mcp/mcp-server-conversion.ts`:
   `convertMcpStatusToProto("pending-session")` →
   `MCP_SERVER_STATUS_DISCONNECTED` on the wire (preserves the
   legacy wire enum).
5. `sessionIdEcho.productionShape.test.ts` A2A-14 rewritten:
   - `connectToServer` is now a `sinon.spy()` (records
     invocations without doing real work; cannot be mistaken
     for the real method).
   - `createHub(env, { connectToServer: "fakeConnected" })`
     opts in to a `sinon.stub().callsFake(...)` for the
     legacy-control case only.
   - The session-bound assertion is now load-bearing:
     `connectToServer.callCount === 0` AND the pending entry's
     status/transport shape AND `ensureSessionConnection(name, {})`
     returns `undefined` AND `sessionConnections.size === 0`.
   - The legacy-control case asserts `connectToServer.callCount === 1`,
     `status === "connected"`, `transport !== null` — pins the
     unchanged behavior on the flat-env path.

Full unit suite: 89 files, 1204 pass / 0 fail. Zero regressions in
pre-existing McpHub.* suites. New vitest suite: 8/8 pass.
tsc clean. Biome clean.

