# ACT-MYC-CLINEMM02-C-CORRECTION02 — Design

## Reviewer's P0 verdict

> `HALT_SESSION_IDENTITY_JOIN_UNPROVEN` — producer and consumer use different IDs.
> The fix must prove the canonical host sessionId → runtime request identity join.

## Production identity layers (REAL, from source)

The prior ACT's hook used `ctx.snapshot.conversationId` to look up the prime.
The prime recorder keys by `startResult.sessionId` (== `CoreSessionConfig.sessionId`).
These are **two different identity layers**:

| Layer               | Source                                          | Scope / lifetime                                   | Example                                       |
|---------------------|-------------------------------------------------|----------------------------------------------------|-----------------------------------------------|
| Host `sessionId`    | `CoreSessionConfig.sessionId`                   | Host-owned lifecycle id; stable across mode/MCP rebuilds and follow-up resumes; routed for hub subscriptions, persistence, abort/stop, approval | `"host-session-X"` (assigned by host)         |
| Agent `conversationId` | `AgentRuntimeConfig.conversationId` ← `ConversationStore.createConversationId()` | Auto-generated transcript id; tracks the current conversation store | `"conv_<ts>_<rand>"`                          |

Source citations:
- `sdk/packages/core/src/types/config.ts:246-311` — `CoreSessionConfig.sessionId?` (host-owned, distinct from agent conversation id).
- `sdk/packages/shared/src/agents/types.ts:894-911` — `AgentRuntimeConfig.sessionId?` and `AgentRuntimeConfig.conversationId?` (explicitly documented as different ids).
- `sdk/packages/core/src/runtime/config/agent-runtime-config-builder.ts:104` — `sessionId: input.sessionId ?? agentConfig.sessionId` (host sessionId is threaded into the runtime).
- `sdk/packages/core/src/session/stores/conversation-store.ts:14-17` — `createConversationId()` generates `conv_<Date.now()>_<random>`.
- `sdk/packages/shared/src/session/hook-context.ts:1-45` — canonical `HookSessionContext { rootSessionId }` and `resolveRootSessionContext()` helper.
- `apps/vscode/src/sdk/sdk-session-lifecycle.ts:470-475` — `startResult.sessionId` (= host sessionId) is the key passed to `runMycPrimeOnSessionStart`.
- `apps/vscode/src/sdk/myc-prime-automation.ts:77-216` — `lastResultBySessionId: Map<string, MycPrimeResult>` keyed by host sessionId.

## Reviewer's three acceptable outcomes

> A. Production guarantees H == C → prove that equivalence at the real construction seam.
> B. Production carries H into runtime state/config separately → consume that canonical H in beforeModel.
> C. No such mapping exists → explicitly thread canonical host sessionId into the runtime/hook context.

## Chosen path: B + C (canonical host sessionId, threaded through the snapshot)

`AgentRuntimeConfig.sessionId` already carries the host sessionId from the
real production construction chain (`agent-runtime-config-builder.ts:104`).
What was missing was the surface of that id in the snapshot — every existing
hook only sees `snapshot.conversationId` (the agent transcript id).

The minimal canonical fix:

1. **Surface `sessionId?` on `AgentRuntimeStateSnapshot`** (additive-optional
   field, populated from `this.config.sessionId` in `AgentRuntime.snapshot()`
   at `sdk/packages/agents/src/agent-runtime.ts:1039-1044`).
   The same additive-optional pattern is used for `currentWorkingContextEstimate`
   (`agent.ts:362`), `execution` (`agent.ts:323`), and `recovery` (`agent.ts:309`).

2. **Update `beforeModel` lookup key** in
   `apps/vscode/src/sdk/hooks-adapter.ts:202` from
   `ctx.snapshot.conversationId` to `ctx.snapshot.sessionId ?? ctx.snapshot.conversationId`.
   The `?? conversationId` fallback is ONLY for hand-built partial
   snapshots / pre-CORRECTION02 test fixtures where the two ids
   happen to be equal by construction. In production,
   `snapshot.sessionId` is always populated by the live runtime
   (it carries the host sessionId from `CoreSessionConfig.sessionId`).

3. **Bound the per-session injection state** (reviewer's P1, addressed
   in the same bounded cycle because it is trivial): replace the
   unbounded `Set<string>` with a `Map<string, true>` and clear the
   entry per session via `clearPrimeInjectionStateForSession(sessionId)`
   on `SdkSessionLifecycle.endActiveSession`.

## Production invariant (frozen)

```
hostSessionId       = CoreSessionConfig.sessionId
                      → SdkSessionLifecycle.startNewSession reads startInput.config.sessionId
                      → sdkHost.start returns startResult.sessionId (== startInput.config.sessionId)
                      → SdkController wires startResult.sessionId as the prime recorder KEY
                      → CoreSessionConfig.sessionId → AgentRuntimeConfig.sessionId
                        (agent-runtime-config-builder.ts:104)
                      → AgentRuntime.snapshot().sessionId = this.config.sessionId
                        (agent-runtime.ts:1039-1044)
                      → beforeModel hook reads snapshot.sessionId
                      → finds the prime recorded under that key
                      → injects <prime_packet> on iteration 1

conversationId      = ConversationStore.createConversationId()
                      → AgentRuntimeConfig.conversationId
                      → AgentRuntime.snapshot().conversationId
                      → still used for transcript correlation (NOT for prime lookup)
```

## Cardinality invariants (frozen, post-correction)

- `startNewSession` fires prime exactly once + injects exactly once per non-superseded install.
- `AgentRuntime.beforeModel` injects prime exactly once per session (iteration gate + per-session Map dedupe).
- `Map<sessionId, true>` cleared on `endActiveSession` → bounded by `O(active sessions)`, not `O(host lifetime)`.
- Resume (`LocalRuntimeHost.restore`) does not go through `startNewSession` → does not re-prime.
- `replaceActiveSession` does go through `startNewSession` → re-primes AND re-injects (different sessionId).
- Fence-superseded starts return `{status: "superseded"}` before activeSession install → no prime, no injection.

## Failure semantics

DEGRADED_WITH_DIAGNOSTIC. `beforeModel` never throws (try/catch wrapping);
records no-op when singleton has no usable text; logs `Logger.warn` on any
error. `await runMycPrimeOnSessionStart` in `startNewSession` is fail-safe
(the helper itself never throws — `myc-prime-automation.ts:148-187`).

## Scope exclusions honored

- No changes to myc implementation / DB / retrieval semantics.
- No changes to MCP wire protocol / session-bound transport.
- No changes to absorb / close-session / anchor-touch (still DEFERRED with documented reasons).
- No new global session registry.
- No new public session protocol field.
- No duplicate memory layer / custom transcript database.
