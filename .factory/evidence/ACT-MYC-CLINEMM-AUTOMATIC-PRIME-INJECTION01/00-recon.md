# ACT-MYC-CLINEMM-AUTOMATIC-PRIME-INJECTION01 — Recon

## Entry trust

```text
ENTRY_HEAD=89249175c71fcbc059d26d54f5c50f7f6dbd3373
git log -1 --oneline: 89249175c fix(mcp): bound per-session post-connect discovery
git status --short at entry: clean (no tracked dirt; only exempt untracked operator evidence)
```

## Production seam inventory (REAL, from source on HEAD)

| Seam | Location | Notes |
|------|----------|-------|
| SESSION_START_SEAM | `apps/vscode/src/sdk/sdk-task-start-coordinator.ts:246-249` | `taskSessionId = config.sessionId?.trim() \|\| createSessionId()`; `configWithSessionId.sessionId = taskSessionId` |
| AUTOMATIC_PRIME_TRIGGER | `apps/vscode/src/sdk/sdk-session-lifecycle.ts:479-485` | `await this.options.onMycPrimeRequested?.({sessionId: startResult.sessionId, cwd})` |
| AUTOMATIC_PRIME_EXECUTOR | `apps/vscode/src/sdk/SdkController.ts:1680-1686` | wires `onMycPrimeRequested` to `runMycPrimeOnSessionStart({sessionId, cwd, mcpHub: this.mcpHub})` |
| AUTOMATIC_PRIME_RESULT_SEAM | `apps/vscode/src/sdk/myc-prime-automation.ts:140-200` | calls `recordMycPrimeResult({sessionId, status, text, error, ts})` |
| PRIME_RECORDER_WRITE | `lastResultBySessionId: Map<string, MycPrimeResult>` (module-level) | `apps/vscode/src/sdk/myc-prime-automation.ts:83-86` |
| PRIME_RECORDER_KEY | `result.sessionId = startResult.sessionId` | |
| AGENT_SNAPSHOT_SESSION_ID_SOURCE | `sdk/packages/agents/src/agent-runtime.ts:1033-1044` | `sessionId: this.config.sessionId?.trim() \|\| undefined` |
| AGENT_RUNTIME_CONFIG_SESSION_ID | `sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts:104` | `sessionId: input.sessionId ?? agentConfig.sessionId` |
| BEFOREMODEL_HOOK_CREATE | `apps/vscode/src/sdk/hooks-adapter.ts:192` | `buildAgentHooks.beforeModel` |
| BEFOREMODEL_HOOK_EXECUTE | `sdk/packages/agents/src/agent-runtime.ts:1936-1952` | `for (const hook of this.hooks.beforeModel) { ... if (result?.messages) request = { ...request, messages: cloneMessages(result.messages) } }` |
| PRIME_RECORDER_LOOKUP | `apps/vscode/src/sdk/hooks-adapter.ts:231,259,284` | `const sessionId = ctx.snapshot.sessionId ?? ctx.snapshot.conversationId; const recorded = getMycPrimeResult(sessionId)` |
| PRIME_PACKET_BUILDER | `apps/vscode/src/sdk/hooks-adapter.ts:317-320` | `<prime_packet source="myc" session="${sessionId}" ts="${recorded.ts}">\n${recorded.text}\n</prime_packet>` |
| PRIME_PACKET_REQUEST_MUTATION | `apps/vscode/src/sdk/hooks-adapter.ts:336` | `messages: [...ctx.request.messages, primeMessage]` |
| PROVIDER_METADATA_CAPTURE_ID_CREATE | `apps/vscode/src/sdk/hooks-adapter.ts:347` | `const captureId = `mycprime-${sessionId}-${recorded.ts}`` |

## Actual chronology (production seam, READ step-by-step)

```text
T1  session identity exists                   — sdk-task-start-coordinator.ts:246
T2  automatic prime starts                    — sdk-session-lifecycle.ts:479
T3  automatic prime completes                 — sdk-session-lifecycle.ts:485 (awaited)
T4  recorder write occurs                     — myc-prime-automation.ts
T6  beforeModel iteration=1 executes          — agent-runtime.ts:1936
T7  recorder lookup occurs                    — hooks-adapter.ts:259
T8  provider request is emitted               — agent-runtime.ts:1978
```

```text
T1 < T2 < T3 < T4 < T6 < T7 < T8   — no race window in production seam
```

The prime is awaited (`await this.options.onMycPrimeRequested?.(...)`) BEFORE
`startNewSession` returns `started`. The lifecycle cannot return `started`
until the prime round-trip completes. The user prompt is dispatched only after
`startNewSession` returns; thus T4 (recorder write) precedes T6 (beforeModel
iteration 1).

## Frozen hypotheses (per ACT §7)

### H1 — automatic prime never requested
**REJECTED.** `await this.options.onMycPrimeRequested?.(...)` is wired in
`SdkSessionLifecycle.startNewSession` at line 479, awaiting the result before
returning `started`. CORRECTION01 fix (added by ACT-MYC-CLINEMM02-C-CORRECTION01)
also ensures the returned promise is propagated (not discarded via `void`).

### H2 — automatic prime requested but fails
**NOT IMPLICATED.** Production prime fires on the same MCP server as the
successful manual call. The recorder records `status="ok"` when callTool
returns text content; the LIVE05 evidence shows the manual MCP `myc_prime`
call succeeded with the witness.

### H3 — prime succeeds but recorder uses wrong session identity
**NOT IMPLICATED.** `runMycPrimeOnSessionStart` keys `lastResultBySessionId`
by the `sessionId` argument that lifecycle passes = `startResult.sessionId`
= `input.config.sessionId` = `taskSessionId`.

### H4 — recorder correct but first beforeModel races ahead
**NOT IMPLICATED.** The await in `sdk-session-lifecycle.ts:479-485` makes
T4 (recorder write) strictly precede the lifecycle returning `started`.
The user prompt can only be dispatched after `started` is returned.
Therefore T6 (beforeModel) is strictly after T4 (recorder write).

### H5 — lookup uses wrong session identity
**NOT IMPLICATED.** Lookup key is `ctx.snapshot.sessionId ?? ctx.snapshot.conversationId`.
- Production `snapshot.sessionId` comes from `AgentRuntimeConfig.sessionId`
- `AgentRuntimeConfig.sessionId = input.sessionId ?? agentConfig.sessionId`
  (`agent-runtime-config-builder.ts:104`)
- `agentConfig.sessionId = sessionId` (line 850 of `local-runtime-host.ts`)
- `sessionId = requestedSessionId || createSessionId()` (line 528 of
  `local-runtime-host.ts`), where `requestedSessionId = input.config.sessionId?.trim()`
  (line 526)

So `snapshot.sessionId = input.config.sessionId = taskSessionId = startResult.sessionId`,
which equals the recorder key. CORRECTION02 (added by ACT-MYC-CLINEMM02-C-CORRECTION02)
changed `conversationId` first to `sessionId` first in the lookup fallback.

### H6 — lookup HIT but injection guard refuses packet
**NOT IMPLICATED.** Guards are:
- `iteration > 1` (skipped on iteration 1)
- `no_session_id` (production `snapshot.sessionId` is always populated)
- `already_injected` (per-session dedupe; first iteration has empty tracker)
- `no_recorded_prime` (HIT)
- `prime_empty` (HIT with text)

### H7 — packet is built but request mutation is lost
**NOT IMPLICATED.** `beforeModel` returns `{messages: [...ctx.request.messages, primeMessage]}`;
the agent-runtime loop does
`request = { ...request, messages: cloneMessages(result.messages) }`
then `openTaskLifecycleStream(request, ...)` — mutation is structurally threaded.

## Critical gap identified (per ACT §6)

The existing tests (R1/R2/R4 in `myc-prime-automation.model-visible.c24-c-bridge.test.ts`,
R5/R6 in `myc-prime-automation.identity-join.red.c24-c-bridge.test.ts`) all **manually
invoke `runMycPrimeOnSessionStart` from the test body**, then construct an `AgentRuntime`
directly. The reviewer-flagged gap in ACT-MYC-CLINEMM02-C-CORRECTION02 is:
> "R1/R2 prove: IF host sessionId == AgentRuntime conversationId THEN injection works.
> They do **not** prove the production invariant: real host sessionId → prime recorder
> key → real runtime request → matching lookup key."

This ACT's contribution: a production-shape test that drives the REAL lifecycle seam
without any test-body shortcut.

## New RED fixture

`apps/vscode/src/services/mcp/__fixtures__/myc-prime-auto/server.mjs` — deterministic
prime echo containing `MYC-AUTO-PRIME-WITNESS-AUTO01` (independent of local myc queue).

## New test file

`apps/vscode/src/sdk/__tests__/myc-prime-auto-injection01.api01-red.c24-c-bridge.test.ts`
— 4 production-shape tests driving the real `SdkSessionLifecycle.startNewSession`
+ `runMycPrimeOnSessionStart` + `getMycPrimeResult` + `buildAgentHooks.beforeModel`
+ `AgentRuntime` chain end-to-end (no test-body shortcuts).
