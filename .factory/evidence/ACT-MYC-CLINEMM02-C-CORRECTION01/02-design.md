# ACT-MYC-CLINEMM02-C-CORRECTION01 — Design

## Purpose

Close the reviewer-flagged gap in `ACT-MYC-CLINEMM02-C`:
the original ACT exposed the prime result only as a diagnostic singleton
(`ExtensionState.mycPrimeAutomation`) and documented that the prime text was
NOT injected into the model's context. The reviewer halted the closure
with `HALT_PRIME_NOT_CONSUMED` — the model literally never saw the
prime packet.

This correction adds the load-bearing injection seam so the prime
text is causally present in the FIRST model request for every session
that has a recorded prime result.

## Architecture decision: which runtime hook to use

Two candidates were evaluated against the ClineMM source:

| Hook | Source location | Verdict |
|------|-----------------|---------|
| `beforeRun` | `agent-runtime.ts:1796` | Not appropriate — fires once per RUN, not per model request. We need per-iteration gating. |
| `beforeModel` | `agent-runtime.ts:1930-1949` | CHOSEN — fires before EVERY model request, has access to `request.messages`, can MUTATE them by returning `{messages: [...]}` (lines 1937-1939). |

The real seam is `agent-runtime.ts:1937-1939`:

```ts
for (const hook of this.hooks.beforeModel) {
    const result = (await hook({ snapshot: this.snapshot(), request })) as ...
    this.throwIfAborted()
    this.applyStopControl(result)
    if (result?.messages) {
        request = { ...request, messages: cloneMessages(result.messages) };
    }
    ...
}
```

Returning `{messages: [...]}` REPLACES the request messages used by the
provider. The runtime clones them defensively, so the hook's return
value cannot mutate state.

## Production diff (3 files)

### 1. `apps/vscode/src/sdk/sdk-session-lifecycle.ts`

- Changed `onMycPrimeRequested` callback signature from
  `(...) => void | Promise<void>` to `(...) => void | Promise<unknown>`
  so the callback can return the actual `Promise<MycPrimeResult>` from
  `runMycPrimeOnSessionStart`.
- Changed `void this.options.onMycPrimeRequested?.({...})` to
  `await this.options.onMycPrimeRequested?.({...})`. The lifecycle now
  waits for the prime round-trip BEFORE returning `started`. This closes
  the race the reviewer flagged: the first model request cannot fire
  until the singleton is populated.

### 2. `apps/vscode/src/sdk/SdkController.ts`

- Changed `onMycPrimeRequested: ({sessionId, cwd}) => { void runMycPrimeOnSessionStart(...) }`
  to `onMycPrimeRequested: ({sessionId, cwd}) => runMycPrimeOnSessionStart(...)`.
  The callback now RETURNS the promise so the lifecycle's `await` actually
  waits for it.

### 3. `apps/vscode/src/sdk/hooks-adapter.ts`

- New `beforeModel` hook added to `buildAgentHooks(...)` (the same function
  `SdkController` wires into `CoreSessionConfig.hooks` via
  `cline-session-factory.ts:1217`).
- The hook reads the canonical conversation id from
  `ctx.snapshot.conversationId`, looks up the singleton via
  `getMycPrimeResult(sessionId)`, and on `iteration === 1` returns
  `{messages: [...original, <prime_packet user message>]}`.
- Per-session dedupe via a module-level `Set<string>` (`primeInjectedSessionIds`)
  keyed by sessionId. The hook is a no-op for any sessionId already
  injected (defensive against duplicate iteration-1 fires).
- Iteration gate: `if (ctx.snapshot.iteration > 1) return undefined` — only
  inject on the first model request of the run. Later iterations would
  duplicate the prime (the runtime has already seen the text on iteration 1
  and the prime is now part of the conversation history).
- Failure modes (all DEGRADED_WITH_DIAGNOSTIC, never throws):
  - No myc server configured (singleton has `status: "skipped"`) → no
    injection; session is added to `primeInjectedSessionIds` to short-circuit
    subsequent iterations.
  - `runMycPrimeOnSessionStart` recorded `status: "failed"` (MCP error,
    spawn failure, etc.) → no injection.
  - `recordMycPrimeResult` was never called for this sessionId → no injection.
- Prime text wrapping: `<prime_packet source="myc" session="<id>" ts="<ts>">\n{prime_text}\n</prime_packet>`.
  This lets the model distinguish a prime packet from system context
  prose and gives future parsing (e.g. compaction) an unambiguous marker.

## Test seam (`apps/vscode/src/sdk/__tests__/myc-prime-automation.model-visible.c24-c-bridge.test.ts`)

4 witnesses, all run via the c24-c-bridge vitest config (which has
the `@cline/agents` alias for the real `AgentRuntime`):

- **R1** — first model request contains the prime text. Drives the REAL
  `AgentRuntime` with a scripted `AgentModel` that captures every
  `AgentModelRequest.messages`. Asserts the prime JSON is in the
  concatenated text of those messages.
- **R2** — prime text appears exactly ONCE across two iterations
  (iteration 1 = tool call, iteration 2 = finish). Filters captured
  requests by `textOf(messages).includes(primeText)` and asserts the
  count is 1. Proves the per-session dedupe works.
- **R3** — when no myc server is configured, the model request is
  unchanged (no synthetic injection, no `myc-prime-marker` sentinel).
  Proves DEGRADED_WITH_DIAGNOSTIC still holds.
- **R4** — first model request fires AFTER the prime singleton is
  populated (race closed). Drives the test exactly as the production
  flow would: `await runMycPrimeOnSessionStart(...)` BEFORE
  `runtime.run(...)`. Asserts the singleton has a recorded result when
  the model request fires.

## RED → GREEN

- RED captured: `00-red-witness.txt` shows R1 failing with
  "expected 'hello' to contain '{\"pid\":...,\"session\":\"red-session-001\",...}'"
  and R2 failing with "expected +0 to be 1". The prime text never
  reached the model request because `buildAgentHooks` had no
  `beforeModel` and `onMycPrimeRequested` was fire-and-forget.
- GREEN captured: `01-green-witness.txt` shows all 4 tests passing.
  The captured request `messages` text now contains the prime JSON
  inside `<prime_packet>...</prime_packet>` tags.

## Conservation

- bun unit gate: `Files: 91 / Pass: 1220 / Fail: 0` (baseline 1204 +
  16 prior ACT tests, unchanged). The new 4 model-visible tests run
  under vitest (c24-c-bridge), not bun:test, so they do not affect
  this count.
- typecheck (apps/vscode): `bun run check-types` exit 0.
- typecheck (c24-c-bridge): `bun scripts/check-types-bridge-with-baseline.ts`
  exit 0, 0 diagnostics vs. frozen baseline.
- pre-existing 8 failures (3 in SdkController.test.ts, 5 in
  sessionIdEcho.productionShape.test.ts) still pre-existing — not
  touched by this correction. Verified via the prior ACT's
  `git stash` baseline.
- pre-existing 11/11 `sessionIdEcho.mcpHub.test.ts` A2A-08..18 still GREEN.
