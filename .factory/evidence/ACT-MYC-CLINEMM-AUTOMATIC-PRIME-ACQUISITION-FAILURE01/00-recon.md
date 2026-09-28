# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-ACQUISITION-FAILURE01 — Recon

## Frozen file map of the automatic-prime acquisition path

```
PRIME_ENTRY              = runMycPrimeOnSessionStart
                            apps/vscode/src/sdk/myc-prime-automation.ts:99-238
SERVER_DISCOVERY         = resolveMycServerName
                            apps/vscode/src/sdk/myc-prime-automation.ts:81-95
                            (reads mcpHub.getServers())
SESSION_CONNECTION_ENSURE = mcpHub.callTool
                            apps/vscode/src/services/mcp/McpHub.ts:2118-2200
                            -> ensureSessionConnection McpHub.ts:467-720
                            (lazy stdio child spawn via StdioClientTransport +
                             new Client + capability-aware listTools/listResources/
                             listResourceTemplates/listPrompts probes)
TOOL_LOOKUP              = N/A in current code
                            (McpHub.callTool issues tools/call directly by name)
TOOL_CALL                = connection.client.request(
                              {method:"tools/call", params:{name:"prime", arguments:args}},
                              CallToolResultSchema,
                              { timeout, signal })
                            McpHub.ts:2178-2191
RESULT_PARSE             = first text-block text extraction
                            myc-prime-automation.ts:166-170
FAILURE_CATCH            = try/catch around callTool
                            myc-prime-automation.ts:163 / 215-237
RECORDER_WRITE           = recordMycPrimeResult
                            myc-prime-automation.ts:248-258
                          + recordMycPrimeLiveAcquisition
                            myc-prime-live-diag.ts:620-660
```

## Production call chain (from RUN03 timestamp evidence)

```
22:11:51.276  acquisition  status=failed
22:11:51.387  enter        iteration=1
22:11:51.387  lookup       lookupKey=S, recordedPrimeFound=false
22:11:51.387  injection    injected=false, reason=prime_empty
22:11:51.516  ai_sdk_prompt iteration=1, prime_packet=0
```

Time gap `276ms -> 387ms` = ~111ms between `acquisition=failed` and
`enter`. The acquisition attempted BEFORE the runtime entered
beforeModel for iteration 1. So the lifecycle ordering (acquisition
awaited before model iteration) is correct; the failure is inside the
acquisition itself.

The synthetic-real GREEN path (`lifecycle02` T1) reproduces this
ordering against the same `SdkSessionLifecycle.startNewSession` seam
and reaches `status=ok`. The difference between GREEN and the live
RED must therefore be IN the call chain below `runMycPrimeOnSessionStart`,
not in the lifecycle ordering.

## What the GREEN synthetic-real path pre-establishes that the RED does not

The GREEN `createMycHub()` factory used by `lifecycle01`/`lifecycle02`:
- injects a SINGLE static connection in `hub.connections`
- with `server.name === "myc"`, `server.config = JSON.stringify(config)`,
  `server.status === "connected"`, `server.disabled === false`
- `config` is `stdio` with `env.MYC_SESSION_ID = { fromSession: "sessionId" }`
- the static `connection.client = {}` is a STUB — it is never used by
  the callTool path because `ensureSessionConnection` spawns a real
  child via `new StdioClientTransport({...}) + new Client({...})` and
  REPLACES the per-session connection stored in `sessionConnections[S][myc]`
- this means the GREEN path exercises the REAL fixture spawn path
  AND the REAL `client.request({method:"tools/call", ...}, CallToolResultSchema, {timeout})`
  path AND the REAL result-parser path

So the synthetic-real fixture is NOT a stub of the callTool internals —
it stubs only the McpHub constructor's filesystem side-effects
(chokidar watcher, settings file IO, OAuth manager). The full
acquisition path runs against the real fixture.

## Why the live RED fails where the GREEN synthetic-real passes

Three discriminators (need bounded diagnostic to confirm which is live):

1. **MCP settings path is different.**
   - GREEN: test injects `hub.connections = [connection]` directly, with
     a fixed `connection.server.config` JSON string.
   - LIVE: `McpHub` constructor calls `initializeMcpServers()` which
     reads `cline_mcp_settings.json`. If the user's installed
     settings differ from the test fixture (e.g. a different `env`
     template, a different `command` path, a different
     `MYC_SESSION_ID` template key, the `myc` server disabled,
     `type: "sse"` instead of `"stdio"`), the runtime `ensureSessionConnection`
     may return undefined or throw.

2. **The `getServers()` filter.**
   - GREEN: static connection is non-disabled.
   - LIVE: the user's settings might have `myc` registered but
     `disabled: true`, or it might be `myc-mcp` (not `myc`) — the
     convention-matching loop in `resolveMycServerName` walks
     `["myc", "myc-mcp"]` in order; if neither is found, returns
     undefined.

3. **Stdio child spawn may fail or time out.**
   - GREEN: `node <FIXTURE_PATH>` runs against a controlled test
     fixture that always responds to `tools/list` and `tools/call`.
   - LIVE: `node <USER_MYC_BIN>` may be missing on PATH, may crash
     on startup, may hang on `initialize`, may reject `tools/call`,
     or may return non-text / empty content.

The diagnostic expansion in this ACT exists to discriminate these
three categories (plus the registration lookup path that the
green-path bypasses by injecting the static connection directly).

## Files in the call chain (read-only summary, not modified in recon)

| File | Lines | Role |
|------|-------|------|
| `apps/vscode/src/sdk/myc-prime-automation.ts` | 273 | PRIME_ENTRY + SERVER_DISCOVERY + TOOL_CALL wrapper + RESULT_PARSE + FAILURE_CATCH + RECORDER_WRITE |
| `apps/vscode/src/services/mcp/McpHub.ts` | 2118-2200 | `callTool` (TOOL_CALL gate) |
| `apps/vscode/src/services/mcp/McpHub.ts` | 467-720 | `ensureSessionConnection` (SESSION_CONNECTION_ENSURE) |
| `apps/vscode/src/sdk/myc-prime-live-diag.ts` | 620-660 | `recordMycPrimeLiveAcquisition` (DIAGNOSTIC) |
| `apps/vscode/src/sdk/sdk-session-lifecycle.ts` | 165-180 | `onMycPrimeRequested` callback wiring site |
| `apps/vscode/src/sdk/SdkController.ts` | 1680-1685 | `runMycPrimeOnSessionStart` registration with `this.mcpHub` |

## Confirmed: production semantics NOT modified by this ACT

This ACT ONLY adds bounded enum fields to `recordMycPrimeLiveAcquisition`.
The helper's try/catch body is preserved verbatim. The
`recordMycPrimeResult` call inside each branch is preserved verbatim.
Only the `recordMycPrimeLiveAcquisition(...)` invocation is enriched
with the phase / failureClass / sessionConnectionStatus / toolFound
fields.
