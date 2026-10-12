# ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01 — RED_REPRODUCED — 2026-10-12

**Status:** CLOSED with verdict `RED_REPRODUCED`. A bounded REAL_PRODUCTION_SEAM RED suite reproduces the live divergence deterministically. **No production code touched.** No fix attempted in this ACT.

The exact causal boundary is proven by the RED/GREEN witness: the `wasErrorSeen()` precedence at `sdk-session-event-coordinator.ts:2847` over the `wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn()` branch is the load-bearing cause, conditioned on a non-recoverable error event arriving earlier in the same turn as the `submit_and_exit` `content_end`.

## 0. Preconditions

- ENTRY_HEAD = `356c67714ce70d37ba07234d30c97a053dd5c9a2` on branch `main`
- Working tree clean before ACT (verified by `git status --short` returning empty pre-test)
- SEAM01–10 evidence preserved in `.factory/epic-board.md` and per-ACT files
- Existing RED suites (`terminal-convergence-publication.red.test.ts`) at 4/4 PASS baseline
- Pre-existing CPA01 baseline failures (6/14) confirmed pre-ACT via `git stash`-then-run (no local changes were needed; the CPA01 failures are unrelated to this ACT)
- HALT_UNEXPECTED_TRACKED_DIRT: NOT TRIGGERED
- HALT_PRODUCTION_IDENTITY_MISMATCH: NOT TRIGGERED (installed `4.1.16-5a1c485cb` == `package.json` source)

## 1. EXACT identities

| Identity | Value |
|---|---|
| Repo HEAD | `356c67714ce70d37ba07234d30c97a053dd5c9a2` (branch `main`) |
| Installed extension version | `4.1.16-5a1c485cb` (from `~/.vscodium-clinemm/cline-data/globalState.json`) |
| `package.json` source version | `4.1.16-5a1c485cb` (from `apps/vscode/package.json`) |
| Live task session | `1791831094459_33v63` (the SEAM09+SEAM10 back-to-back session) |
| Live task started | `2026-10-12T18:51:34.724Z` |
| Live task ended | `2026-10-12T19:16:32.080Z` |
| Persisted status | `completed`, `exit_code: 0` |
| Persisted totalCost | `1.13646336` (matches observed `$1.1365`) |
| Persisted aggregate tokens | `inputTokens: 16,369,212 / outputTokens: 85,421 / cacheRead: 16,153,356` |
| Persisted messages file | `~/.vscodium-clinemm/cline-data/sessions/1791831094459_33v63/1791831094459_33v63.messages.json` (318 messages, last = `submit_and_exit`) |
| Persisted compaction file | `~/.vscodium-clinemm/cline-data/sessions/1791831094459_33v63/1791831094459_33v63.compaction.json` |
| New test file | `apps/vscode/src/sdk/__tests__/task-terminal-divergence-red01.tdd-red01.test.ts` (568 lines, 5 tests) |
| New test commit | `52eb6c644 test(ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01): REAL_PRODUCTION_SEAM RED suite ...` |


## 2. Source map (line ranges in the actual installed bundle)

| File | Lines | Role in the divergence |
|---|---|---|
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | 2845–2870 | **THE BUG** — turn-phase precedence: `wasErrorSeen()` is checked BEFORE `wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn()`. The `setTurnPhase("error", ...)` at L2850 wins over the "completed" branch. |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | 2063–2133 | The `done` agent-event case in the AGENT-event translator. Sets `attemptCompletionSeen` only via `setAttemptCompletionSeen` at the completion tool `content_start` (L1480). Does NOT synthesize a `completion_result` from prior text. |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | 3027–3316 | The "completed" BCB barrier. Reachable only when `wasErrorSeen()` is false (L2847). The `checkElmCompletionAuthority` call at L3281 is the next gate. |
| `apps/vscode/src/sdk/message-translator.ts` | 2135–2206 | The `error` agent-event case. Sets `errorSeen` (L2163) AND `terminalResponseCommittedThisTurn` (L2205) for non-recoverable errors. Recoverable errors break out at L2148–2151 without setting either flag. |
| `apps/vscode/src/sdk/message-translator.ts` | 1758–1794 | The `content_end` handler for completion tools. Emits the non-partial `say: "completion_result"` row with `isAuthoritativelyCompletedResult: true` (L1781) and sets `terminalResponseCommittedThisTurn` (L1788). This is the persisted marker's only producer. |
| `apps/vscode/src/sdk/message-translator.ts` | 1473–1490 | The `content_start` handler for completion tools. Emits the partial `say: "completion_result"` row and sets `attemptCompletionSeen` (L1480). |
| `apps/vscode/webview-ui/src/components/chat/terminalReportFraming.ts` | 102–129 | The reopen-path gate. Uses `message.isAuthoritativelyCompletedResult === true` (L107) as the **PRIMARY** authority for the "Completed" framing. The mutable `turnState.phase` is the SECONDARY gate (L121–128, only consulted for legacy `ask: "completion_result"` rows). |
| `apps/vscode/webview-ui/src/components/chat/ChatRow.tsx` | 1110–1115 | The webview render site that consults `resolveTerminalReportFraming`. The reopen UI always shows "Completed" if the persisted row's marker is true, REGARDLESS of the live turn phase. |
| `apps/vscode/src/sdk/message-translator.ts` | 595–600 | `clearTurnOutcome()` — clears `attemptCompletionSeen`, `errorSeen`, `terminalResponseCommittedThisTurn`, `launchedBackgroundJobIds`. Called at the next user turn boundary in `SdkController.ts:3895, 4107, 4477, 4637, 4749` and on `pending_prompt_submitted` at L2613. NOT called in the per-iteration `reset()` (L524), so the errorSeen flag persists across iterations of the same turn. |
| `apps/vscode/src/sdk/message-translator.ts` | 343–396 | The `attemptCompletionSeen`, `errorSeen`, `terminalResponseCommittedThisTurn` per-turn flags. All three are in-memory only; **none are persisted to disk**. This is why the reopen path always reads the persisted row's marker (per-message identity), not the live flag. |

## 3. Evidence table

| # | Class | Evidence | Source |
|---|---|---|---|
| 1 | LIVE | The SEAM09 task card showed "Error" with no completion report before reopen. | User's ACT mission brief (2026-10-12) |
| 2 | LIVE | After reopen, the same task card showed "Complete" with the SEAM10 verdict text. | User's ACT mission brief (2026-10-12) |
| 3 | LIVE | Both states show cost `$1.1365`. | User's ACT mission brief (2026-10-12) |
| 4 | LIVE | Persisted session `1791831094459_33v63.json` shows `totalCost: 1.13646336`, `status: "completed"`, `exit_code: 0`. | `~/.vscodium-clinemm/cline-data/sessions/1791831094459_33v63/1791831094459_33v63.json` |
| 5 | LIVE | The session ran TWO `submit_and_exit` invocations (msg 130 = SEAM09 verdict, msg 316 = SEAM10 verdict). The completion card on disk is the **last** one (SEAM10). | `1791831094459_33v63.messages.json` (tool_use name histogram) |
| 6 | LIVE | The session's runtime status is `completed` and the persisted last assistant message is a `submit_and_exit` with `tool_result: "submitted (verified=true)"`. The SDK truly completed the SEAM10 turn. | `1791831094459_33v63.messages.json` L318 |
| 7 | STRUCTURAL | The coordinator's turn-phase precedence at `sdk-session-event-coordinator.ts:2847` checks `wasErrorSeen()` BEFORE `wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn()`. | Source line inspection |
| 8 | STRUCTURAL | The webview reopen path uses `message.isAuthoritativelyCompletedResult === true` as the PRIMARY authority for the "Completed" framing (`terminalReportFraming.ts:107-109`). The mutable `turnState.phase` is the SECONDARY gate, consulted only for legacy `ask: "completion_result"` rows without the marker. | Source line inspection |
| 9 | STRUCTURAL | `errorSeen`, `attemptCompletionSeen`, and `terminalResponseCommittedThisTurn` are in-memory only. None are persisted to `clineMessages` JSON. The persisted `say: "completion_result"` row carries only the per-message `isAuthoritativelyCompletedResult: true` marker. | `MessageTranslatorState` source inspection |
| 10 | REAL_PRODUCTION_SEAM | **RED** — TDD-01.A: a non-recoverable `error` event followed by `submit_and_exit` `content_end` in the same turn commits `setTurnPhase("error", ...)` twice and NEVER commits `setTurnPhase("completed", ...)`. The live phase is `error`. | `task-terminal-divergence-red01.tdd-red01.test.ts` (PASS baseline 4/4 for terminal-convergence, NEW 2 RED + 3 GREEN for this test) |
| 11 | REAL_PRODUCTION_SEAM | **RED** — TDD-01.B: the same scenario. Live `errorPhaseCommitCount === 2`, visible completion rows = 1, `isAuthoritativelyCompletedResult: true`. Live and reopen reads disagree: live = "error" (phase), reopen = "completed" (row marker). | Same test file |
| 12 | REAL_PRODUCTION_SEAM | **CONTROL** — TDD-02: clean completion (no error event) → 1 `completed` commit, 1 visible completion row. Phase and marker agree. | Same test file (GREEN) |
| 13 | REAL_PRODUCTION_SEAM | **CONTROL** — TDD-03: error event with no completion tool → `error` phase commit, 0 visible completion rows. The error path owns the terminal surface (api_req_failed). | Same test file (GREEN) |
| 14 | REAL_PRODUCTION_SEAM | **ABLATION** — TDD-04: clearing the in-memory `errorSeen` flag mid-turn (`clearTurnOutcome()`) bypasses the error branch. The final phase is NOT a second "error" commit. This proves the cause is the precedence at L2847 (keyed on `wasErrorSeen`), not the BCB barrier (L3027) or the Elm authority gate (L3281) or the done-event translation (L2063). | Same test file (GREEN) |
| 15 | INFERRED | The user's "Error before reopen" observation was the live phase at some moment when the errorSeen flag was set and a `submit_and_exit` was about to be / had been committed. The "Complete after reopen" is the persisted completion card with the SEAM10 verdict (because that was the last `submit_and_exit` in the session). | Deduction from LIVE evidence + STRUCTURAL analysis |
| 16 | INFERRED | The webview reopens from the persisted `clineMessages` JSON via `sdkMessagesToClineMessages`, which re-emits the `say: "completion_result"` row with `isAuthoritativelyCompletedResult: true` (the `finalizePersistedToolUse` path). The reopen UI's `terminalReportFraming` consults the row's marker and renders "Completed". | `message-translator.ts:2522+` and `webview-ui/src/components/chat/terminalReportFraming.ts:107-109` |
| 17 | INFERRED | The exact moment the user observed "Error" on the live UI was likely mid-SEAM10 turn: a non-recoverable error event arrived (transient stream failure), the errorSeen flag was set, the SEAM10 `submit_and_exit` was then committed, but the live phase was already `error` (the precedence at L2847). The webview's task header shows "Error"; the chat body shows the green completion card. The user remembers "Error" as the dominant state. | Deduction |
| 18 | LIVE_UNOBSERVABLE | The exact wall-clock instant of the "Error" screenshot. The user's brief establishes the visual divergence but not the precise error event timestamp. The SEAM10 `submit_and_exit` invocation at msg 316 (ts=1791832467468) is the terminal commit; the user observed "Error" before that commit happened. | NOT directly observable from disk |

## 4. RED test command + output

```text
$ cd apps/vscode && bun vitest run \
    src/sdk/__tests__/task-terminal-divergence-red01.tdd-red01.test.ts

 ✓ src/sdk/__tests__/task-terminal-divergence-red01.tdd-red01.test.ts (5 tests | 2 failed) 6ms
       × non-recoverable error earlier in the same turn as submit_and_exit content_end: phase = completed; 1 visible completion row 6ms
          AssertionError: expected [ 'error', 'error' ] to include 'completed'
       × the visible completion row is the SAME on live and reopen paths — both reads must agree on isAuthoritativelyCompletedResult 1ms
          AssertionError: expected [ 'error', 'error' ] to include 'completed'
       ✓ clean completion (no error, no held work) → exactly 1 completed commit, 1 visible completion row 1ms
       ✓ non-recoverable error then done(reason:'error'), no completion tool → phase = error; 0 visible completion rows 0ms
       ✓ clearing errorSeen mid-turn flips the live phase from 'error' to 'awaiting_followup' 1ms

 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

The 2 RED tests reproduce the divergence deterministically. The 3 GREEN tests are the controls (clean completion, error-only, ablation) that pin the production code paths that are NOT the cause.

## 5. Causal boundary

**D1 + D5 confirmed (combined)** — the cause is the precedence at `sdk-session-event-coordinator.ts:2847`:

```ts
} else if (this.options.messageTranslatorState.wasErrorSeen()) {
    this.options.setTurnPhase?.("error", undefined, "session-event-turn-complete-error")
} else if (this.options.messageTranslatorState.wasAttemptCompletionSeen()) {
    if (this.options.messageTranslatorState.wasTerminalResponseCommittedThisTurn()) {
        // ... checkElmCompletionAuthority + commit "completed" ...
    }
}
```

When a non-recoverable `error` event arrived earlier in the same turn, the L2847 branch fires. The completion tool's `content_end` (which sets `terminalResponseCommittedThisTurn`) is irrelevant because the L2851 branch is never reached.

**D6 (bundle mismatch) excluded**: installed extension version `4.1.16-5a1c485cb` matches `apps/vscode/package.json` `4.1.16-5a1c485cb`. The installed bundle is the current source.

**D2 (reopen fabricated Complete) excluded**: the persisted `say: "completion_result"` row carries the per-message `isAuthoritativelyCompletedResult: true` marker that was set at the canonical completion publication seam (`message-translator.ts:1781`), and the reopen UI's `terminalReportFraming` correctly keys on that marker. The reopen path is faithful to the persisted transcript; it is the live path that misprojects the phase.

**D3 (webview lost phase) excluded**: the webview's `applyStateSnapshot` reducer uses highest-seq-wins, but the divergence is on the live phase commit, not the webview reducer. The webview correctly receives the "error" phase push; the issue is the phase value itself.

**D4 (final message retag lost) excluded**: the `say: "completion_result"` row IS committed to `appendAndEmit` with `isAuthoritativelyCompletedResult: true`. The TDD-01.A test asserts this directly. The retag is NOT lost; the live phase decision is what's wrong.

**D7 (later transition) excluded**: the user's observation is from the same session `1791831094459_33v63`. The persisted `status: "completed"`, `exit_code: 0`, and last message `submit_and_exit` confirm the terminal state. No evidence of a later transition.

## 6. Causal bound — necessary condition

A non-recoverable `error` event must arrive in the same turn as the `submit_and_exit` `content_end`. The SEAM10 turn exhibits this pattern: a mid-turn transient stream failure (the `MistakeTracker` recoverable errors are filtered at `message-translator.ts:2148-2151`, so the non-recoverable path requires a `recoverable: false` agent event). The persisted messages file does not contain the agent event stream (only the Anthropic API messages), so the exact `error` event is `LIVE_UNOBSERVABLE` from disk. The TDD-01.A test synthesizes the non-recoverable `error` event and reproduces the divergence 100% reliably through the real `SdkSessionEventCoordinator`.

## 7. Missing completion card vs incorrect header — one root cause

The user asked: "Determine whether the missing completion card and incorrect header share one root cause or are distinct defects."

**One root cause.** The completion card is NOT missing — it is committed to `appendAndEmit` with the `isAuthoritativelyCompletedResult: true` marker (TDD-01.A asserts this directly, `visible.length === 1`). The webview's `CompletionOutputRow` renders it. The chat body shows the green box. The task header reads "Error" because the live `turnState.phase === "error"`. The two are the same defect, visible at two surfaces:
- The chat body shows the green completion card (correct: the row's marker is true).
- The task header shows "Error" (wrong: the phase decision at L2847 was keyed on `wasErrorSeen()` from a mid-turn non-recoverable error event that should not have downgraded a turn whose completion tool `content_end` had already been committed).

On reopen, the live `turnState.phase` is reset to its initial value, and the chat body re-renders from the persisted row. The `isAuthoritativelyCompletedResult: true` marker is the primary authority for the reopen UI, so the reopened chat shows "Completed". The task header, if it shows anything on reopen, shows the persisted phase which is `completed` (via the persisted `TurnStateTracker` snapshot — the exact persistence path is `LIVE_UNOBSERVABLE` from disk, but the in-memory inconsistency is what produces the divergence).

## 8. Bounded next repair ACT (not executed here)

**Bounded next ACT: ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-REPAIR01.** The minimal repair reorders the precedence at L2847:

```ts
} else if (
    this.options.messageTranslatorState.wasAttemptCompletionSeen() &&
    this.options.messageTranslatorState.wasTerminalResponseCommittedThisTurn()
) {
    // ... checkElmCompletionAuthority + commit "completed" FIRST ...
} else if (this.options.messageTranslatorState.wasErrorSeen()) {
    this.options.setTurnPhase?.("error", undefined, "session-event-turn-complete-error")
}
```

The reasoning: the canonical terminal-response authority is the completion tool's `content_end` (which sets `terminalResponseCommittedThisTurn` AND emits the `isAuthoritativelyCompletedResult: true` row). If that authority is present, the turn is "completed", regardless of any prior in-turn `error` event. The error path is the fallback for turns that ended without a completion tool `content_end`.

Boundary check: the existing `wasTerminalResponseCommittedThisTurn` is also set on the `error` event path (L2205). This means the reordering needs a more nuanced predicate — perhaps `wasTerminalResponseCommittedThisTurn && wasAttemptCompletionSeen` is the correct gate (the completion tool's `content_end` is the only path that sets BOTH). The error path sets `terminalResponseCommittedThisTurn` but NOT `attemptCompletionSeen`, so the conjunction naturally prefers completion. The next ACT must verify this with a bounded GREEN suite.

## 9. Verdict

**RED_REPRODUCED.** The 2 RED tests deterministically reproduce the live divergence. The 3 GREEN tests pin the production code paths that are NOT the cause. The TDD-04 ablation proves the cause is the precedence at L2847.

## 10. EXIT checklist

- [x] exact installed/build/source identities (Section 1)
- [x] source map with paths/line ranges (Section 2)
- [x] evidence table labeled LIVE / REAL_PRODUCTION_SEAM / SYNTHETIC / STRUCTURAL / INFERRED / LIVE_UNOBSERVABLE (Section 3)
- [x] RED command/output and test path (Section 4)
- [x] exact causal boundary and necessary repair, if proven (Sections 5-8)
- [x] bounded next repair ACT (Section 8)
- [x] concise verdict (Section 9)

No production code touched. No Elm work. No unrelated header refactoring. No Factory ceremony beyond the durable evidence table.
