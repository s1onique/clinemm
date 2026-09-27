# ACT-MYC-CLINEMM02-C — Design (smallest safe prime automation)

## Architecture (frozen)

```text
SdkSessionLifecycle.startNewSession(startInput, opToken)
  ┊
  ┊ (after this.activeSession = {...} is installed)
  ┊
  ▼
options.onMycPrimeRequested({ sessionId, cwd })              (fire-and-forget; void)
  ┊
  ▼
SdkController-bound closure:
  void runMycPrimeOnSessionStart({ sessionId, cwd, mcpHub })
  ┊
  ▼
resolveMycServerName(hub) — returns "myc" | "myc-mcp" | undefined
  ┊ when undefined → record status="skipped" + return
  ┊
  ▼
hub.callTool(serverName, "prime", args, ulid, signal, sessionId)
  ┊ ensureSessionConnection(sessionId) lazily spawns the
  ┊ per-session child with MYC_SESSION_ID env from
  ┊ resolveMcpServerEnv(template.env, process.env, { sessionId })
  ┊
  ▼
recordMycPrimeResult({ status, text?, error?, ts })           (singleton by sessionId)

getStateToPostToWebview
  ┊
  ▼
ExtensionState.mycPrimeAutomation = getMycPrimeResult(active.sessionId)
```

## Cardinality

- `startNewSession` is the canonical "new session installed" seam.
  Fires exactly once per non-superseded `startNewSession`. A fence-
  superseded start (returned as `{status: "superseded"}`) does NOT
  install `activeSession` and therefore does NOT fire the trigger.
- Resume (`LocalRuntimeHost.restore`) does NOT go through
  `startNewSession` → does NOT fire prime. **Resume does NOT re-prime.**
- `replaceActiveSession` DOES go through `startNewSession`
  (with `awaitStop: true`) → fires prime AGAIN. C9 characterization
  row in `myc-prime-automation.lifecycle01.test.ts` documents this.

## Failure semantics

Selected: **DEGRADED_WITH_DIAGNOSTIC** (per ACT section 7).

- `runMycPrimeOnSessionStart` NEVER throws. All errors are caught
  and recorded on the singleton as `{ status: "failed", error: ... }`.
  A `Logger.warn` is emitted with the underlying error.
- `onMycPrimeRequested` is fire-and-forget (`void`). A rejection in
  the returned promise does NOT propagate to the lifecycle's
  caller (initTask / reinit).
- Lifecycle returns `started` even when prime fails. The user's
  task is never blocked by myc availability.

## Visibility

The prime result is exposed on `ExtensionState.mycPrimeAutomation`
for diagnostic observability. It is NOT injected into the model's
initial context in this ACT (that requires a `StartSessionBootstrap`
shape change → REQUIRES_SEPARATE_DESIGN).

## What is NOT in this ACT

- absorb / close-session / anchor-touch automation — DEFERRED
  (see `.factory/evidence/ACT-MYC-CLINEMM02-C/01-recon.md`).
- prime-packet-into-model-context — REQUIRES_SEPARATE_DESIGN.
- global myc session registry — out of scope; the singleton is
  per-sessionId only.

## Vitest exclusion

The two new test files import `from "bun:test"`, which vitest's
transformer does not resolve. They are excluded from the base
`vitest.config.ts` (alongside the other bun:test-only SDK suites
like `real-local-to-shadow-bridge.c24-c-correction01.test.ts`)
so the vitest sweep is unaffected. The bun:test suite (`bun run
test:unit`) discovers them naturally via `run-bun-unit-tests.ts`.
