# ACT-CLINEMM-ELMIZE-P0-TASK-HEADER-TERMINAL-CONVERGENCE01

## LIVE_FAILURE

- completion visible = true (user sees the completion_result row, partial=false)
- last published legacy = streaming / 5426 (pre-terminal snapshot)
- terminal commit = completed / 5517 (writer `session-event-turn-complete-completed`)
- post-terminal publication = absent (no ExtensionState push carrying the post-C10 TurnState seq arrives at the webview)

## CLASSIFICATION

**Type B (missing terminal publication) on the DEFERRED-BARRIER REEVALUATION path.**

Recon:

1. The main `done` handler at `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1855-1890` can DEFER the C10 commit when the Elm authority returns HOLD or a conservation predicate holds (e.g. an outstanding background job, a queued prompt, an active notify marker). The deferred-completion-barrier marker is registered (lines 1871-1876) and the function returns at line 1877.

2. The C10 commit later fires via `reevaluateDeferredCompletionBarrier` at line 1060 (the deferred path), triggered by `notifyAgentTurnDone` from the runtime's `agent_turn_done` capture.

3. **The deferred path's C10 commit at line 1060 is NOT followed by any `postStateToWebview()` call.** The function returns at line 1088 immediately after the `captureContinuationCardinalityAuthorityRecord` call. No publication is fired.

4. The webview therefore keeps the stale `streaming / 5426` snapshot (the highest-seq `TurnState` seen so far) even though the runtime reached the terminal phase and committed `completed / 5517`. The TaskHeader stays on "Working".

The main `done` handler's C10 path (line 1879) DOES fire `postStateToWebview()` from the bottom of `handleSessionEvent` (lines 2186-2194, gated by `result.turnComplete || result.sessionEnded || result.messages.length > 0 || event.type === "pending_prompt_submitted"`). The deferred path was missing the equivalent publication.

## RED

```
src/sdk/__tests__/terminal-convergence-publication.red.test.ts
  TERMINAL-PUB-01-A: Elm AUTHORIZE — at least one postStateToWebview fires after the C10 commit, and its snapshot seq is >= the C10 commit seq
  TERMINAL-PUB-02: Elm HOLD — no C10 commit, no completed-phase publication is required
  TERMINAL-PUB-03: after the 50ms debounce flush, the published snapshot carries the post-C10 seq (REAL debouncer path)
  TERMINAL-PUB-04: when the C10 commit happens via the deferred-barrier reevaluation path (line ~1060), a publication MUST follow
```

TERMINAL-PUB-04 is the LIVE-FAILURE-FROZEN RED. It drives the deferred path:
1. Hand a `done` event with attempt-completion conditions to the main handler with Elm HOLD. The C10 commit is deferred; a deferred-completion-barrier marker is registered.
2. Call `notifyAgentTurnDone` with Elm AUTHORIZE. The deferred reevaluation runs the conservation checks (all-zero) and consults Elm (AUTHORIZE), committing `completed` on the deferred path.
3. Assert: a publication primitive fires AFTER the deferred-path C10 commit, and the snapshot carries a seq >= the commit seq.

Pre-repair observation (current code):
- `setTurnPhase:completed:2` fires on the deferred path (line 1060)
- `postStateToWebview` is NEVER called — `postTerminalCallCount = 0`
- The webview never receives a snapshot carrying the post-C10 seq

This is the LIVE defect.

## ROOT_CAUSE

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1060-1088` (the deferred-barrier reevaluation path inside `reevaluateDeferredCompletionBarrier`) commits `completed` and writes the CCARD record, but the function returns without firing a `postStateToWebview()`. The webview's `applyTurnState` highest-seq gate therefore never receives a snapshot with the post-C10 seq, and the TaskHeader stays on the stale pre-terminal phase.

The main `done` handler's C10 path (line 1879 → 2186-2194) DOES fire a publication, but the deferred path was the only path that could fail closed without a publication.

## REPAIR

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1088-1104` — add a single fire-and-forget `postStateToWebview()` call after the deferred-path C10 commit. The pattern matches the Site-B publication gate (lines 2186-2194) — same fire-and-forget with error logging via `Logger.error`.

```ts
this.options.postStateToWebview?.().catch((err) => {
  Logger.error("[SdkController] Failed to post state after deferred C10 commit:", err)
})
```

Bounded delta: 17 lines added, one file changed.

## ELM_SOURCE_DELTA

NONE. The Elm TaskHeader projection (`apps/vscode/elm/task-header-orchestration/`) is unchanged. The Elm selector was correct — it received stale `legacySeq=5426` because no publication carried the post-C10 `5517`. The bug was at the host-side publication seam, not the Elm projection.

## TS_AUTHORITY_REINTRODUCED

NO. The repair is a single `postStateToWebview` call after the existing C10 commit. It does not re-introduce the TS presentation authority; the Elm TaskHeader projection is still the sole semantic authority for the visible TaskHeader label.

## focused tests

4/4 (TERMINAL-PUB-01-A, TERMINAL-PUB-02, TERMINAL-PUB-03, TERMINAL-PUB-04)

Plus 3/3 CCARD tests (`ccard-commit-stage-boundary-misbound01.test.ts`) — the C10 capture ordering is preserved.

Plus 178/178 TaskHeader tests (unchanged).

## typecheck

PASS (`bunx tsc --noEmit` exits 0)

## lint

PASS (`biome lint --diagnostic-level=error` reports "No fixes applied" for the changed files)

## git diff --check

PASS

## VSIX

NOT_EXECUTED (per ACT §C18)

## post-fix LIVE

NOT_EXECUTED (per ACT §C18)
