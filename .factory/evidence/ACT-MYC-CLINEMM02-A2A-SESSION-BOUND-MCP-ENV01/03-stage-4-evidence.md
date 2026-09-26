# ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01 — Stage 4 Evidence (A/B isolation rows)

## Status: GREEN

| Row | Status | Proof |
|---|---|---|
| **A2A-08** A+B concurrent | GREEN | Two `StdioClientTransport + Client` pairs, one per session id. `whoami` returns distinct `pid` for A and B; both pids ≠ parent `pid`; `session` echoes match the supplied env. |
| **A2A-09** reconnect A | GREEN | Tear down A's child, rebuild under same id `session-A`. New `pid`; `session === "session-A"`; B's `pid` and `session` unchanged. |
| **A2A-10** genericity | GREEN | `resolveMcpServerEnv({MYC_SESSION_ID, CLINE_SESSION_ID}, rawEnv, {sessionId:"session-A"})` produces both keys set to `"session-A"`. |
| **A2A-12** static + session-bound | GREEN | `resolveMcpServerEnv({API_KEY:"abc", MYC_SESSION_ID:{fromSession}}, ...)` returns `{API_KEY:"abc", MYC_SESSION_ID:"session-A"}` — legacy round-trips byte-for-byte alongside the projected session key. |
| **A2A-13** lifecycle isolation | GREEN | Closing A's client leaves B's `pid` unchanged; B's `whoami` still returns the same pid and session. |
| **A2A-14** startup defer | GREEN | With `sessionCtx === undefined`, the resolver returns only the legacy keys and SKIPS the `fromSession` key — the production seam will treat an empty per-session result as "deferred, do not spawn". |

## Test runner output

```
[68/88] ok   6 pass / 0 fail      src/services/mcp/__tests__/sessionIdEcho.isolation.test.ts
─────────────────────────────────────────────────────────────────────────────
Files: 88   Pass: 1193   Fail: 0   Time: 65.6s
All unit test files passed.
```

## File

```
A apps/vscode/src/services/mcp/__tests__/sessionIdEcho.isolation.test.ts   150 lines
```

## What's NOT in Stage 4

- **Production seams** (A2A-15..18) are Stage 5. They drive the real
  `vscode-runtime-builder.ts:47`, `sdk-session-lifecycle.ts:591-611`,
  `vscode-session-host.ts:359` call sites — not direct hub calls. Stage 4
  proves the **per-session child isolation contract** that Stage 5's
  wiring will rely on.
- **McpHub production wiring** (per-session `McpConnection` map,
  `McpHub.callTool(name, tool, args, ulid, signal, sessionId?)` overload,
  `McpHub.disconnectSession(sessionId)`, `McpHubToolProvider.sessionId`
  plumbing): deferred to Stage 5.

## Cumulative status

| Stage | Status |
|---|---|
| Stage 1 — Schema RED→GREEN | ✅ GREEN (commit 3ee2f0bc3) |
| Stage 2 — Resolver GREEN   | ✅ GREEN (commit 3ee2f0bc3) |
| Stage 3 — A2A-04 child witness | ✅ GREEN (commit 3ee2f0bc3) |
| Stage 4 — A/B isolation rows | ✅ GREEN (commit ceb4c801f) |
| Stage 5 — Production seams | ⏳ pending |
| Stage 6 — Conservation gate | ⏳ pending (after 5) |
| Stage 7 — Closure | ⏳ pending (after 6) |.factory/evidence/ACT-MYC-CLINEMM02-A2A-SESSION-BOUND-MCP-ENV01/03-stage-4-evidence.md
