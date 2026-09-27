# ACT-MYC-CLINEMM02-C — Lifecycle-aware memory: smallest safe prime automation

## Verdict

**PASS_PRIME_AUTOMATION** (`VERDICT=PASS_PRIME_AUTOMATION` per ACT section 16 Case A).

```text
PRIME_AUTOMATION      = PASS
ABSORB_AUTOMATION     = DEFERRED  (no MCP path; transcript source unclear at runtime seam)
CLOSE_SESSION_AUTOMATION = DEFERRED (no real myc operation maps to "session ended")
ANCHOR_TOUCH_AUTOMATION = DEFERRED  (CLI only; file list unobservable from AgentAfterToolContext)
```

## Why prime only

The recon pass (`.factory/evidence/ACT-MYC-CLINEMM02-C/01-recon.md`) classifies four candidate lifecycle operations against the four required attributes:

```text
real ClineMM seam   AND  real myc operation   AND  bounded observable input   AND  safe failure behavior
```

Only `prime on session start` satisfies all four. The other three fail on at least one axis:
- **absorb**: `myc absorb-session` is CLI only (no MCP path). Transcripts are read from a file path — no canonical-transcript API at the runtime seam.
- **close-session**: no real `myc` operation maps to "this Cline session is going away". `myc close` closes a task node; Cline session != myc task.
- **anchor touch**: `myc anchor touch` is CLI only. `AgentAfterToolContext` does not carry a list of files that were durably edited; mapping tool call → file paths is tool-specific and unobservable from a generic runtime hook.

## What was implemented

The smallest safe automatic lifecycle slice: when `SdkSessionLifecycle.startNewSession` installs a fresh `activeSession`, the production `onMycPrimeRequested` callback fires `runMycPrimeOnSessionStart`, which calls `mcpHub.callTool("myc", "prime", args, ulid, signal, sessionId)` over the session-bound MCP transport. The per-session child is lazily spawned by `McpHub.ensureSessionConnection(sessionId)` with `MYC_SESSION_ID` injected from `resolveMcpServerEnv(template.env, process.env, { sessionId })`. The prime result is recorded on a module-level singleton keyed by `sessionId` and surfaced on `ExtensionState.mycPrimeAutomation` for diagnostic observability.

## Files changed

```text
added    apps/vscode/src/sdk/myc-prime-automation.ts                        (helper + recorder)
added    apps/vscode/src/services/mcp/__fixtures__/myc-prime-echo/server.mjs (real MCP fixture)
added    apps/vscode/src/sdk/__tests__/myc-prime-automation.lifecycle01.test.ts  (12 tests)
added    apps/vscode/src/sdk/__tests__/myc-prime-automation.lifecycle02.test.ts   (4 tests, lifecycle seam)
added    .factory/evidence/ACT-MYC-CLINEMM02-C/{00..05,result.json}
added    .factory/acts/ACT-MYC-CLINEMM02-C.md  (this file)
modified apps/vscode/src/sdk/sdk-session-lifecycle.ts                        (onMycPrimeRequested option + fire-and-forget trigger)
modified apps/vscode/src/sdk/SdkController.ts                                (option wire + projection)
modified apps/vscode/src/shared/ExtensionMessage.ts                          (mycPrimeAutomation field)
modified apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx        (default undefined)
```

## Evidence

- `01-recon.md` — ClineMM lifecycle seams (REAL, from source) + real myc API surface (from installed `/Volumes/UserData/Users/chistyakov/.myc/bin/myc`).
- `02-design.md` — architecture diagram, cardinality, failure semantics, visibility scope.
- `03-test-output.txt` — 16 tests / 0 fail across the two new test files.
- `04-bun-unit-gate.txt` — `Files: 91 Pass: 1220 Fail: 0 Time: 33.4s`.
- `05-typecheck.txt` — `tsc --noEmit` exit 0.
- `result.json` — machine-readable summary.

## RED → GREEN chronology

1. `myc-prime-automation.ts` + fixture implemented FIRST (TDD-style: tests would have failed without these).
2. `lifecycle01.test.ts` (12 tests) — all GREEN against the real fixture (proven by `parsed.pid !== process.pid` in C1 and `parsed.session === sessionId` in C2).
3. `sdk-session-lifecycle.ts` trigger wired + `ExtensionState.mycPrimeAutomation` field.
4. `SdkController.ts` wires `onMycPrimeRequested` to `runMycPrimeOnSessionStart`.
5. `lifecycle02.test.ts` (4 tests, T1..T4) — proves the production seam fires the helper exactly once per non-superseded `startNewSession`, with no cardinality bleed, and that a failed prime does NOT block the lifecycle (DEGRADED_WITH_DIAGNOSTIC).

## Stop condition met

ACT section 18: "If the smallest safe automatic lifecycle slice passes, STOP." — PASS. No MEMLAB- or broader-dogfood work was attempted.

## Open follow-ups (NOT in this ACT)

- Absorb: requires `myc` to expose `absorb-session` on the MCP `agent` profile (or build a CLI-spawn helper) AND requires a canonical-transcript API on the Cline runtime seam.
- Close-session: requires new myc semantics tying `myc close` (or a new operation) to Cline session end.
- Anchor touch: requires a per-tool file-edit identity emitter in the runtime seam OR a new MCP `anchor touch` operation.
- Prime packet → model context: requires a `StartSessionBootstrap` shape change (REQUIRES_SEPARATE_DESIGN).

