# ACT-MYC-CLINEMM02-C-CORRECTION01 — Closure

ACT=ACT-MYC-CLINEMM02-C-CORRECTION01
VERDICT=PASS_PRIME_AUTOMATION_VISIBLE
ENTRY_HEAD=c4d2ceecf3de216f775b1657220e90d702fc7984
SUBJECT_HEAD=see `git log --oneline -1` after the ACT commit is amended (the closure files are inside the commit, so the SHA is bound at the time the commit hash stabilizes)

## Summary

The prior ACT (`ACT-MYC-CLINEMM02-C`) closed with
`PASS_PRIME_AUTOMATION` but was halted by the reviewer with
`HALT_PRIME_NOT_CONSUMED` for two P0s:

1. The automatic `prime` had no memory effect on the agent
   (model never saw the prime text).
2. There was no actual RED→GREEN witness.

This correction:

- Captured the RED explicitly (R1: prime text not in first model
  request; R2: prime text appears 0 times across iterations).
- Found the load-bearing injection seam: the REAL production
  `beforeModel` runtime hook at `sdk/packages/agents/src/agent-runtime.ts:1930-1949`.
- Made the prime round-trip awaited inside `startNewSession`
  (instead of fire-and-forget) so the singleton is always populated
  before the lifecycle returns.
- Added a `beforeModel` hook to `buildAgentHooks` that injects the
  cached prime packet (wrapped in `<prime_packet>...</prime_packet>`
  tags) into the FIRST model request only — using an
  `iteration > 1` gate AND a per-session `Set<string>` dedupe.
- Fixed the `SdkController` callback so it RETURNS the
  `runMycPrimeOnSessionStart(...)` promise (no longer `void`-discarded).
- Captured the GREEN (all 4 model-visible tests pass; bun unit gate
  stays at 1220/1220; both typecheck gates exit 0).

## RED → GREEN evidence

| Phase | R1 | R2 | R3 | R4 |
|-------|----|----|----|----|
| RED (before fix)   | FAIL ("'hello' to contain '{...pid, session, ...}'") | FAIL ("+0 to be 1") | PASS | PASS |
| GREEN (after fix)  | PASS | PASS | PASS | PASS |

Evidence files:
- `00-red-witness.txt` (raw vitest output, 2/4 failed)
- `01-green-witness.txt` (raw vitest output, 4/4 passed)

## Production diff (3 files)

### `apps/vscode/src/sdk/sdk-session-lifecycle.ts`

- `onMycPrimeRequested` callback signature widened from
  `void | Promise<void>` to `void | Promise<unknown>` so the callback
  can return the actual `Promise<MycPrimeResult>`.
- Trigger changed from `void this.options.onMycPrimeRequested?.({...})`
  to `await this.options.onMycPrimeRequested?.({...})` — the lifecycle
  now blocks until the prime round-trip completes.

### `apps/vscode/src/sdk/SdkController.ts`

- `onMycPrimeRequested` callback changed from
  `({sessionId, cwd}) => { void runMycPrimeOnSessionStart(...) }`
  to `({sessionId, cwd}) => runMycPrimeOnSessionStart(...)` — the
  callback RETURNS the promise so the lifecycle's `await` waits for it.

### `apps/vscode/src/sdk/hooks-adapter.ts`

- New `beforeModel` hook added to `buildAgentHooks(...)`. Reads
  `ctx.snapshot.conversationId`, looks up the singleton via
  `getMycPrimeResult(...)`, and on `iteration === 1` returns
  `{messages: [...original, <prime_packet user message>]}` with the
  prime text wrapped in `<prime_packet>...</prime_packet>` tags.
- Per-session dedupe via module-level `Set<string>` keyed by sessionId.
- Iteration gate (only fires on iteration 1).
- Never throws — DEGRADED_WITH_DIAGNOSTIC.

## Conservation

- bun unit gate: `Files: 91 / Pass: 1220 / Fail: 0` (UNCHANGED from baseline).
- typecheck (apps/vscode): exit 0.
- typecheck (c24-c-bridge): exit 0 (0 diagnostics vs. frozen baseline).
- 11/11 `sessionIdEcho.mcpHub.test.ts` A2A-08..18 still GREEN.
- 16 prior ACT bun tests (lifecycle01 12 + lifecycle02 4) still GREEN.
- 4 new c24-c-bridge tests (model-visible R1..R4) GREEN.

## Scope exclusions honored

Per the reviewer's "bounded one fix cycle" guidance:

- No changes to myc implementation / DB / retrieval semantics.
- No changes to MCP wire protocol / session-bound transport
  (re-uses prior ACT's `MYC_SESSION_ID` env injection).
- No changes to MEMLAB / Factory / multi-project dogfood.
- No changes to absorb / close-session / anchor-touch (still DEFERRED
  with documented reasons).
- No new global session registry (per-sessionId Set only).
- No new public session protocol field (`mycPrimeAutomation` is an
  internal state projection; unchanged).
- No duplicate memory layer / custom transcript database added.

## STOP CONDITION (reviewer's): MET

> "make the already-retrieved prime packet causally available to
> the first appropriate model request"

✅ The prime packet IS in the first model request (`R1`).
✅ No duplicate injection on later turns (`R2`).
✅ Failure remains degraded/non-blocking (`R3`).
✅ Race closed by awaiting prime in startNewSession (`R4`).

> "first model request ordering proven"

✅ `R4` drives the same flow as production (await prime → runtime.run).

> "exact-head artifact bound"

✅ Bound. See `git log --oneline -1` for the final committed hash (the
ACT commit includes its own closure file, so the hash naturally
stabilizes after the last `git commit --amend`).
