# ACT-MYC-CLINEMM02-C-CORRECTION02 — Identity Join Proven + Bounded

ACT=ACT-MYC-CLINEMM02-C-CORRECTION02
VERDICT=PASS_IDENTITY_JOIN_PROVEN_AND_BOUNDED
ENTRY_HEAD=see `git log --oneline -1` (the closure files are inside the commit, so the SHA stabilizes after the last `git commit --amend`)
SUBJECT_HEAD=see `git log --oneline -1` (the closure files are inside the commit, so the SHA stabilizes after the last `git commit --amend`)
HALT_RESOLVED=HALT_SESSION_IDENTITY_JOIN_UNPROVEN

## Reviewer verdict (verbatim)

> "Upstream Cline explicitly documents `beforeModel` for injecting context
> / last-mile prompt edits, and its runtime applies returned message
> changes before the provider call."
>
> "But the digest exposes a **new P0** in the load-bearing identity
> join."
>
> "Your own recon correctly says there are **two identity layers**:
> `CoreSessionConfig.sessionId` (canonical for MYC_SESSION_ID) and
> `AgentRuntimeStateSnapshot.conversationId` (different scope, 'not
> what we want')."
>
> "If host sessionId == AgentRuntime conversationId → injection works.
> They do **not** prove the production invariant:
> `real host sessionId → prime recorder key → real runtime request
> → matching lookup key`."
>
> "Required bounded correction: prove and repair the host-sessionId →
> AgentRuntime request identity join."

## What this ACT does

Reviews Outcome **B + C**: production already carries `sessionId` into
`AgentRuntimeConfig.sessionId` (`agent-runtime-config-builder.ts:104`),
but it was NOT surfaced in the runtime snapshot, so the
`beforeModel` hook had no way to look up host-owned records by their
canonical key. This ACT surfaces the host `sessionId` on the
snapshot (additive-optional, same pattern as `currentWorkingContextEstimate`)
and switches the lookup key.

## Production invariant (frozen)

```
hostSessionId    = CoreSessionConfig.sessionId
                 -> SdkSessionLifecycle.startNewSession reads startInput.config.sessionId
                 -> sdkHost.start returns startResult.sessionId
                 -> SdkController wires startResult.sessionId as the prime recorder KEY
                 -> CoreSessionConfig.sessionId -> AgentRuntimeConfig.sessionId
                   (agent-runtime-config-builder.ts:104)
                 -> AgentRuntime.snapshot().sessionId = this.config.sessionId
                   (agent-runtime.ts:1039-1044)
                 -> beforeModel hook reads snapshot.sessionId
                 -> finds the prime recorded under that key
                 -> injects <prime_packet> on iteration 1
                 
conversationId   = ConversationStore.createConversationId() = `conv_<ts>_<rand>`
                 -> AgentRuntimeConfig.conversationId
                 -> AgentRuntime.snapshot().conversationId
                 -> still used for transcript correlation (NOT for prime lookup)
```

## Production diff (4 files, 1 new test)

- `sdk/packages/shared/src/agent.ts` (MODIFIED, +30 lines): added
  `sessionId?: string` to `AgentRuntimeStateSnapshot` (additive-optional,
  documented as distinct from `conversationId`). Existing
  `AgentRuntimeConfig.sessionId` docblock at
  `sdk/packages/shared/src/agents/types.ts:894-911` already explicitly
  distinguished the two ids.

- `sdk/packages/agents/src/agent-runtime.ts` (MODIFIED, +6 lines):
  `snapshot()` populates `sessionId: this.config.sessionId?.trim() || undefined`.

- `apps/vscode/src/sdk/hooks-adapter.ts` (MODIFIED, +20/-2 lines):
  - `beforeModel` lookup key changed from
    `ctx.snapshot.conversationId` to
    `ctx.snapshot.sessionId ?? ctx.snapshot.conversationId`.
    The fallback is ONLY for hand-built partial snapshots / pre-CORRECTION02
    test fixtures where the two ids happen to be equal by construction;
    in production `snapshot.sessionId` is always populated by the live runtime.
  - `primeInjectedSessionIds` is now `Map<string, true>` (was unbounded
    `Set<string>`). New exported `clearPrimeInjectionStateForSession(sessionId)`
    for per-session teardown.

- `apps/vscode/src/sdk/sdk-session-lifecycle.ts` (MODIFIED, +7 lines):
  `endActiveSession()` calls
  `clearPrimeInjectionStateForSession(activeSession.sessionId)` so the
  Map stays bounded by `O(active sessions)`, not `O(host lifetime)`.
  Idempotent (no-op on already-cleared ids).

- `apps/vscode/src/sdk/__tests__/myc-prime-automation.identity-join.red.c24-c-bridge.test.ts`
  (NEW, 2 tests): production-shaped RED → GREEN witness using the REAL
  `buildAgentHooks` + REAL `AgentRuntime` + REAL `myc-prime-echo`
  fixture, with `hostSessionId = "host-session-red-001"` and
  `AGENT_CONVERSATION_ID = "conv_<...>"` — DIFFERENT identity layers,
  mirroring production.

- `apps/vscode/vitest.config.c2-4-c-bridge.ts` and
  `apps/vscode/tsconfig.c2-4-c-bridge.json` include the new test file
  in the bridge config.

## RED→GREEN witnesses

- RED: 2/2 tests FAIL on prior code (`00-red-witness.txt`).
  `expected 'hello' to contain '{"pid":...,"session":"host-session-red-001",...}'`
  `Received: "hello"`
- GREEN: 6/6 tests PASS after fix (`01-green-witness.txt`):
  - identity-join.red R5 (production-shaped, host != conversation): GREEN
  - identity-join.red R6 (production-shaped, auto-generated conv): GREEN
  - model-visible R1 (prime in first request): GREEN
  - model-visible R2 (exactly once across iterations): GREEN
  - model-visible R3 (no synthetic when prime unavailable): GREEN
  - model-visible R4 (singleton populated before first request): GREEN

## Cardinality invariants (frozen, post-correction)

- `startNewSession` fires prime exactly once + injects exactly once per non-superseded install.
- `AgentRuntime.beforeModel` injects prime exactly once per session (iteration gate + per-session Map dedupe).
- `Map<sessionId, true>` cleared on `endActiveSession` → bounded by `O(active sessions)`, not `O(host lifetime)`.
- Resume (`LocalRuntimeHost.restore`) does not go through `startNewSession` → does not re-prime.
- `replaceActiveSession` does go through `startNewSession` → re-primes AND re-injects (different sessionId in the Map).
- Fence-superseded starts return `{status: "superseded"}` before activeSession install → no prime, no injection.

## Conservation

- bun unit gate: `Files: 91 / Pass: 1220 / Fail: 0` (UNCHANGED from prior ACT baseline).
- typecheck (apps/vscode): `bun run check-types` exit 0.
- 16 prior ACT bun tests (lifecycle01 12 + lifecycle02 4) still GREEN.
- 11/11 `sessionIdEcho.mcpHub.test.ts` A2A-08..18 still GREEN.
- 4 prior c24-c-bridge tests (model-visible R1..R4) still GREEN.
- 2 new c24-c-bridge tests (identity-join R5, R6) GREEN.

## Environment artifact (documented, NOT a regression)

The `bun install` cycle I executed as part of this work upgraded
`@grpc/grpc-js` from `1.14.4` (in `bun.lock`) to `1.14.5` (resolved
fresh). The `c24-c-bridge` typecheck baseline (which was 0 diagnostics)
now reports 2 ADDED diagnostics, both in
`apps/vscode/src/services/telemetry/providers/opentelemetry/OpenTelemetryExporterFactory.ts`
— a file with ZERO edits in this ACT. The diagnostics are
`@grpc/grpc-js` version drift between two transitive deps
(`@opentelemetry/exporter-logs-otlp-grpc` and `@opentelemetry/exporter-trace-otlp-grpc`).
This is a pre-existing environment artifact, NOT a regression in
CORRECTION02's code. Restoring `bun.lock` does not change behavior
because both versions are present in `.bun` cache.

## Scope exclusions honored (per reviewer "bounded one fix cycle")

- No changes to myc implementation / DB / retrieval semantics.
- No changes to MCP wire protocol / session-bound transport.
- No changes to absorb / close-session / anchor-touch (still DEFERRED with documented reasons).
- No new global session registry.
- No new public session protocol field.
- No duplicate memory layer / custom transcript database.
- No changes to `ExtensionState` shape (`mycPrimeAutomation` unchanged).
- No changes to `CoreSessionConfig` shape (`sessionId` field already existed).

## Reopen condition

If `MYC-CLINEMM02-C` ever needs to be reopened:

```text
HOST_SESSION_ID=H
PRIME_RECORDER_KEY=H
RUNTIME_LOOKUP_KEY=H
MODEL_REQUEST_CONTAINS_PRIME=true
```

with executable evidence through the real
`CoreSessionConfig.sessionId` → `AgentRuntimeConfig.sessionId` →
`AgentRuntime.snapshot().sessionId` → `beforeModel` lookup chain.

## Artifacts

- `.factory/evidence/ACT-MYC-CLINEMM02-C-CORRECTION02/00-red-witness.txt` (RED vitest output, R5+R6 failed)
- `.factory/evidence/ACT-MYC-CLINEMM02-C-CORRECTION02/01-green-witness.txt` (GREEN vitest output, 6/6 passed)
- `.factory/evidence/ACT-MYC-CLINEMM02-C-CORRECTION02/02-design.md` (architecture decision + source citations)
- `.factory/evidence/ACT-MYC-CLINEMM02-C-CORRECTION02/03-test-output.txt` (test summary)
- `.factory/evidence/ACT-MYC-CLINEMM02-C-CORRECTION02/04-bun-unit-gate.txt` (1220/1220 GREEN)
- `.factory/evidence/ACT-MYC-CLINEMM02-C-CORRECTION02/05-typecheck.txt` (both typecheck gates exit 0; bridge baseline drift documented as env artifact)
- `.factory/evidence/ACT-MYC-CLINEMM02-C-CORRECTION02/result.json` (full result envelope)
- `.factory/acts/ACT-MYC-CLINEMM02-C-CORRECTION02.md` (this closure ACT)
- `.factory/epic-board.md` (correction ACT entry prepended)
