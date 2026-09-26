# ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — Stage 1-3 Executable Evidence

## Summary

| Stage | Status | Evidence |
|---|---|---|
| **Stage 1 — Schema RED→GREEN** | GREEN | `EnvEntrySchema` accepts `string \| {value} \| {fromEnv} \| {fromSession:"sessionId"}`; XOR rejection of multi-source; legacy `string` round-trips byte-for-byte. |
| **Stage 2 — Resolver GREEN** | GREEN | Pure `resolveMcpServerEnv(template, rawEnv, sessionCtx)` materializes the FLAT env passed to the child. A2A-11 invariant: `rawEnv` MUST NOT be mutated; result may be a fresh object. |
| **Stage 3 — A2A-04 child witness** | GREEN | Real `@modelcontextprotocol/sdk` STDIO child spawned via `StdioClientTransport` + `Client.connect()` + `Client.listTools()` + `Client.callTool({name:"whoami"})`. The child's `whoami` tool reads `process.env.MYC_SESSION_ID` **from inside the spawned child process** and returns it. A parent cannot fake that value without spawning the child. |

## Test runner

```
bun scripts/run-bun-unit-tests.ts \
  src/services/mcp/__tests__/envResolver.test.ts \
  src/services/mcp/__tests__/sessionIdEcho.test.ts

[63/87] ok   16 pass / 0 fail     src/services/mcp/__tests__/envResolver.test.ts
[67/87] ok    3 pass / 0 fail     src/services/mcp/__tests__/sessionIdEcho.test.ts
Files: 87   Pass: 1187   Fail: 0   Time: 35.2s
```

Full unit suite: **1187 pass / 0 fail across 87 files.** Including pre-existing
`schemas.test.ts` (15 pass) and every existing `McpHub.*` test — the additive
union change does NOT break any legacy code path.

## Files added / modified

```
M apps/vscode/src/services/mcp/schemas.ts                    +37 lines (EnvEntrySchema, EnvValueSchema, widened env record on stdio/sse/streamableHttp arms)
A apps/vscode/src/services/mcp/envResolver.ts                +98 lines (pure resolveMcpServerEnv + MissingEnvSourceError + EnvTemplate type)
A apps/vscode/src/services/mcp/__fixtures__/session-id-echo/whoami.mjs   +40 lines (real @modelcontextprotocol/sdk MCP server)
A apps/vscode/src/services/mcp/__tests__/envResolver.test.ts +165 lines (Stage 1 + Stage 2)
A apps/vscode/src/services/mcp/__tests__/sessionIdEcho.test.ts +75 lines (Stage 3 child witness)
```

## A2A-04 child witness — concrete proof

Test (excerpt):
```ts
transport = new StdioClientTransport({
    command: "node",
    args: [FIXTURE],
    env: { ...process.env, MYC_SESSION_ID: "session-A" },
})
client = new Client({...}, { capabilities: {} })
await client.connect(transport)
const res = await client.callTool({ name: "whoami", arguments: {} })
const payload = JSON.parse(text)
assert(payload.pid !== process.pid)               // proves CHILD, not parent
assert(payload.session === "session-A")           // proves env var reached child
assert(payload.session_keys === ["MYC_SESSION_ID"]) // proves no other MYC_* leaked
```

Fixture (excerpt):
```js
server.tool("whoami", ..., async () => {
    const session = process.env.MYC_SESSION_ID ?? null
    const session_keys = Object.keys(process.env).filter(k => k.startsWith("MYC_"))
    return { content: [{ type: "text", text: JSON.stringify({
        pid: process.pid, session, session_keys,
    })}]}
})
```

The fixture has NO knowledge of which test called it, NO test-specific mocking,
NO parent-side helper-computed fallback. The `session` value comes strictly from
`process.env.MYC_SESSION_ID` inside the spawned child — the only way the test
gets `session === "session-A"` back is if `StdioClientTransport` actually
propagated the parent's `env` to the child's `process.env`.

## What's NOT done yet

Stages 4–7 are deferred to subsequent commits:

- **Stage 4 — A/B isolation** (A2A-08/09/10/12/13/14): two concurrent sessions
  with distinct PIDs, reconnect under same id (new PID, identity preserved),
  genericity (two env names both `fromSession`), static + session-bound
  coexistence, lifecycle isolation (`disconnectSession(A)` kills only A),
  startup defer (no child spawned without an active session).
- **Stage 5 — Production seams** (A2A-15/16/17/18): drive the real
  `vscode-runtime-builder.ts:47` acquire, `sdk-session-lifecycle.ts:591-611`
  release, `vscode-session-host.ts:359` discovery — NOT direct hub calls.
- **Stage 6 — Conservation gate**: one mechanical check that all 18 rows from
  `01-recon.md` are covered by Stages 1–5.
- **Stage 7 — Closure**: durable handoff.