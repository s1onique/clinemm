# 00-recon — frozen live RED + topology diff

## Frozen live RED (per ACT §0)

```text
LIVE_SESSION_ID=1790660487765_vfylt

READY_WITNESS_VISIBLE=true

AUTO_PRIME_STATUS=failed
AUTO_PRIME_PHASE=tool_call
AUTO_PRIME_FAILURE_CLASS=client_request_failed
AUTO_PRIME_SESSION_CONNECTION_STATUS=unavailable
```

```text
FIRST_DIVERGENCE=MYC_PRIME_TOOL_CALL_FAILED
BOUNDARY=MCP_TOOL_CALL
```

## Live RED causal chain (frozen)

```text
tool call fails
→ no prime recorded
→ beforeModel lookup misses
→ injection=prime_empty
→ ai_sdk_prompt receives no <prime_packet>
```

## Recon (live HEAD `766f47ff6`)

| Symbol | File:line |
|---|---|
| `AUTO_PRIME_ENTRY` | `SdkSessionLifecycle.onMycPrimeRequested` (sdk-session-lifecycle.ts:113) → `runMycPrimeOnSessionStart` (myc-prime-automation.ts:121) |
| `AUTO_PRIME_SERVER_LOOKUP` | `resolveMycServerName` (myc-prime-automation.ts:87) — `mcpHub.getServers()` filter for `myc`/`myc-mcp` |
| `AUTO_PRIME_SESSION_CONNECTION_LOOKUP` | `McpHub.callTool(..., sessionId)` (McpHub.ts:2138) → `ensureSessionConnection(serverName, { sessionId })` (McpHub.ts:467) |
| `AUTO_PRIME_TOOL_RESOLUTION` | none — the helper hard-codes `toolName = "prime"` |
| `AUTO_PRIME_TOOL_CALL` | `connection.client.request({ method: "tools/call", params: { name, arguments } }, CallToolResultSchema, { timeout, signal })` (McpHub.ts:2178-2191) |
| `AUTO_PRIME_RESULT_PARSE` | `response.content[0].text` extraction (myc-prime-automation.ts:166-243) |
| `AUTO_PRIME_FAILURE_CATCH` | helper catch-block at myc-prime-automation.ts:299-344 — discriminator on error-message prefix |
| `MANUAL_TOOL_PROVIDER_ENTRY` | `McpHubToolProvider.callTool({serverName, toolName, arguments, context})` (vscode-runtime-builder.ts:76) |
| `MANUAL_TOOL_SERVER_LOOKUP` | server name supplied by the model via the tool definition's `serverName` argument |
| `MANUAL_TOOL_SESSION_CONNECTION_LOOKUP` | `McpHub.callTool(..., sessionId)` (McpHub.ts:2138) → `ensureSessionConnection` — IDENTICAL to auto-prime path |
| `MANUAL_TOOL_CALL` | `McpHub.callTool` (McpHub.ts:2118) → IDENTICAL `connection.client.request(...)` |

## Automatic / manual topology diff

| Property | Automatic `myc_prime` | Manual `myc_prime` |
|---|---|---|
| Registration source | `resolveMycServerName` (literal `myc`/`myc-mcp`) | full `mcpHub.getServers()` enumeration (any server name) |
| sessionId source | `SdkSessionLifecycle` callback (`config.sessionId`) | `McpHubToolProvider.sessionId` captured at construction (set via `prepareStartSessionInput` → `createMcpTools({sessionId})`) |
| `ensureSessionConnection` called | YES — via `McpHub.callTool(..., sessionId)` | YES — via `McpHubToolProvider.callTool` → `McpHub.callTool(..., sessionId)` |
| Connection map | `sessionConnections.get(sessionId)` | `sessionConnections.get(sessionId)` |
| Client instance | `connection.client` returned from `ensureSessionConnection` | `connection.client` returned from `ensureSessionConnection` |
| Connection status checked | NOT explicitly checked | NOT explicitly checked |
| Tool list source | (not consulted — tool name hard-coded) | (not consulted — tool name supplied by model) |
| Call helper | `connection.client.request({method:"tools/call",...}, CallToolResultSchema, {timeout, signal})` | IDENTICAL helper |
| Request options / timeout | `{ timeout: resolveMcpServerTimeoutMs(connection.server.config), signal }` | IDENTICAL options |
| Error mapping | `augmentMcpTimeoutError(error, serverName, timeout)` then `throw`; helper catches and tags `phase=tool_call, failureClass=client_request_failed` | `augmentMcpTimeoutError` then `throw`; surfaced to SDK tool executor |

**Topology verdict:** Both paths route through the SAME `McpHub.callTool` and the SAME `connection.client.request` with the SAME `sessionId`. The call-boundary surface is identical.

## Frozen hypotheses (discriminator tree)

```text
H1 = AUTOMATIC_PATH_USES_WRONG_CLIENT_INSTANCE                  → RULED OUT (same call path)
H2 = AUTOMATIC_PATH_CALLS_BEFORE_CLIENT_INITIALIZED             → STILL CANDIDATE
H3 = AUTOMATIC_PATH_SKIPS_ENSURE_SESSION_CONNECTION             → RULED OUT (same call path)
H4 = AUTOMATIC_PATH_SEES_STALE_OR_PENDING_CONNECTION            → STILL CANDIDATE
H5 = TOOL_LOOKUP_SUCCEEDS_BUT_CALL_TARGET_IS_NOT_CONNECTED      → RULED OUT (same call path)
H6 = CALL_REQUEST_REJECTS_WITH_TYPED_TRANSPORT/PROTOCOL_ERROR   → STILL CANDIDATE
H7 = AUTOMATIC_PATH_USES_DIFFERENT_TIMEOUT/REQUEST_OPTIONS      → RULED OUT (same call path)
H8 = MCP_TOOL_RESULT_IS_ERROR_BUT_MAPPED_AS_REQUEST_FAILURE     → RULED OUT (helper never inspects response.isError)
```

## Baseline test status (live HEAD `766f47ff6`)

```text
myc-prime-automation.acquisition-failure01.red.test.ts        10/10 PASS
myc-prime-live-diag.test.ts                                    28/28 PASS
myc-prime-live-diag-readout.test.ts                            21/21 PASS
myc-prime-automation.lifecycle01.test.ts                       12/12 PASS
myc-prime-automation.lifecycle02.test.ts                        4/4 PASS
TOTAL                                                          75/75 PASS
```

(runner: `bun test`; requires `/opt/homebrew/bin/node` in PATH for stdio fixture spawn)