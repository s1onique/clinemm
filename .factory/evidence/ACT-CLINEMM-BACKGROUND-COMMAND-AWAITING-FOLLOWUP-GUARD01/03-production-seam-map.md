# ACT-CLINEMM-BACKGROUND-COMMAND-AWAITING-FOLLOWUP-GUARD01
# Production Seam Map

The exact chain (LIVE writer = `session-event-turn-complete-resumable-straggler-preserve`):

```
agent/session turnComplete event
  ↓                                [REAL_PRODUCTION_SEAM]
SdkSessionEventCoordinator.handleSessionEvent
  ↓                                [REAL_PRODUCTION_SEAM]  apps/vscode/src/sdk/sdk-session-event-coordinator.ts:80
completion-vs-no-completion branch
  ↓                                [REAL_PRODUCTION_SEAM]  line 145-291 (resumable / error / attemptCompletion / else)
candidate awaiting_followup transition
  ↓                                [REAL_PRODUCTION_SEAM]  line 200-291 (the `else` else-of-else)
active session lookup
  ↓                                [REAL_PRODUCTION_SEAM]  this.options.sessions.getActiveSession() at line 83
hasRunningBackgroundJobForOwner(sessionId)
  ↓                                [REAL_PRODUCTION_SEAM]  line 275: options.hasRunningBackgroundJobForOwner?.(activeSession.sessionId)
VscodeSessionHost
  ↓                                [REAL_PRODUCTION_SEAM]  apps/vscode/src/sdk/vscode-session-host.ts:529
CommandJobManager ownership/liveness lookup
  ↓                                [REAL_PRODUCTION_SEAM]  apps/vscode/src/sdk/command-job-manager.ts:2701-2711
guard result
  ↓                                [INFERRED at runtime]   live diagnostic only (production has no per-call telemetry hook)
setTurnPhase(
    "awaiting_followup",
    ...,
    "session-event-turn-complete-resumable-straggler-preserve"
  )                              [REAL_PRODUCTION_SEAM]  line 286-290
  ↓
webview Your turn
```

## Identity correlation across the chain

| Hop | Identity field | Source |
|-----|----------------|--------|
| 1 | `activeSession.sessionId` | `SdkSessionLifecycle.activeSession.sessionId` (sdk-session-lifecycle.ts:155+) |
| 2 | `CommandJob.ownerSessionId` | `CommandJobManager.start(options, context) → ownerSessionId = context?.sessionId` (command-job-manager.ts:1776) |
| 3 | `context.sessionId` | `AgentToolContext.sessionId` from `tool.execute(input, context)` (sdk/packages/shared/src/agent.ts:825-845) |
| 4 | UI webview header | Pure projection of canonical turn phase (TaskHeader.tsx) |

The LIVE outcome commits ONLY if the guard EITHER:
- returns `false` (G1 — false negative, lookup wrong) OR
- is bypassed / not consulted (G3) OR
- returns `true` but its result is ignored (G4).

The writerId `session-event-turn-complete-resumable-straggler-preserve` is the
unique string at line 289 — it only fires in the `else` branch of
`if (ownerStillRunning)`. So the guard DID execute, AND it returned
`false` (or was undefined and skipped via `?.()` returning undefined which
is falsy). This places the LIVE failure on G1 or G3.

## Hypothesis ranking for LIVE failure

Most likely: G1 — false-negative liveness.
- The owner identity is `activeSession.sessionId` from the lifecycle.
- The job's `ownerSessionId` is `context?.sessionId` at start() time.
- If these ever diverge (e.g., on mode switch, MCP rebuild, follow-up resume),
  the guard returns false and the writer commits.

Second: G3 — guard bypass.
- The only way the guard is bypassed is if
  `options.hasRunningBackgroundJobForOwner` is undefined (the optional chain).
- SdkController.ts:1882-1894 ALWAYS wires it. So G3 requires either:
  a) SdkController wiring is broken (e.g., activeSession is undefined at
     constructor time, so `getActiveSession()` returns undefined, fallback `false`).
  b) The host omits the method (Hub/Remote — `typeof !== "function"` fallback
     returns `false`).

## Edge labels

| Edge | Label |
|------|-------|
| agent → coordinator event | REAL_PRODUCTION_SEAM |
| coordinator → guard query | REAL_PRODUCTION_SEAM |
| SdkController → host method | REAL_PRODUCTION_SEAM (duck-typed cast) |
| host → manager lookup | REAL_PRODUCTION_SEAM |
| manager → job.ownerSessionId | REAL_PRODUCTION_SEAM |
| guard result telemetry | LIVE_UNOBSERVABLE (no per-call hook) |
| writer commit → TSWPD | REAL_PRODUCTION_SEAM |
| TSWPD → webview phase | REAL_PRODUCTION_SEAM |
