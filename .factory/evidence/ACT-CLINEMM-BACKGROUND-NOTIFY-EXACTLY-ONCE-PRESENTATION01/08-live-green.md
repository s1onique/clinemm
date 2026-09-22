# LIVE GREEN — Post-Repair Reproduction (EXECUTABLE / PRODUCTION-SHAPED)

**STATUS:** EXECUTABLE / PRODUCTION-SHAPED. The post-fix LIVE operator
dogfood specimen is **PENDING** — the cloud agent context lacks the
`vsce:prepublish` + sideload infrastructure required to install a
fresh dogfood VSIX and drive a real chat session. When available,
record a 30-second natural-exit specimen here to close the
POST-FIX_LIVE = PENDING line. Until then, the EXECUTABLE GREEN run
below pins the production-shaped reproduction.

```text
PRE-FIX_DUPLICATE = LIVE_OBSERVED from predecessor dogfood (RED run)
POST-FIX_GREEN    = EXECUTABLE / PRODUCTION-SHAPED (BCNEX01 GREEN run)
POST-FIX_LIVE     = PENDING (deferred until dogfood infra is available)
```

## Test output (post-fix, post-P1-correction)

```
$ bunx vitest run --config vitest.config.ts \
    background-notify-exactly-once-presentation01.bcnex01 \
    sdk-user-message-mapping

 ✓ src/sdk/sdk-user-message-mapping.test.ts (17 tests) 4ms
 ✓ src/sdk/__tests__/background-notify-exactly-once-presentation01.bcnex01.test.ts (7 tests) 4ms

 Test Files  2 passed (2)
      Tests  24 passed (24)
```

7 BCNEX tests pass:
- BCNEX-RED-01: wake prompt MUST be transcript-hidden (2 subtests)
- BCNEX-ABLATION-01: synthetic-prompt predicate eliminates the wake row
- BCNEX-P1-01: actual `formatTerminalWakePrompt(...)` IS filtered (formatter identity preserved)
- BCNEX-P1-02: ordinary user prompt containing BOTH delimiters MUST remain visible
- BCNEX-P1-03: ordinary user prompt containing ONLY ONE delimiter MUST remain visible
- BCNEX-CTL-12: registerMarker + consumeTerminal produces exactly one queued wake

## Production code change (P1 correction)

`apps/vscode/src/sdk/background-notify-coordinator.ts:52-67`:

```diff
+/**
+ * Single-source-of-truth prefix for the terminal-wake prompt produced
+ * by `formatTerminalWakePrompt`. Exported so the synthetic-prompt
+ * predicate in `sdk-user-message-mapping.ts` can match the wake with a
+ * conjunctive fingerprint (this prefix AND both bounded-output
+ * delimiters) rather than scattering the literal across modules.
+ */
+export const BACKGROUND_TERMINAL_WAKE_PROMPT_PREFIX =
+    "A background command you asked to be notified about has reached a terminal state."
```

`apps/vscode/src/sdk/background-notify-coordinator.ts:136`:

```diff
   const head = [
-      "A background command you asked to be notified about has reached a terminal state.",
+      BACKGROUND_TERMINAL_WAKE_PROMPT_PREFIX,
       "",
       ...
```

`apps/vscode/src/sdk/sdk-user-message-mapping.ts:64-108`:

```diff
 export function isSyntheticUserPrompt(text: string): boolean {
     const normalized = stripModeNotices(normalizeUserInput(text))
-    return (
-        normalized.startsWith("[TASK RESUMPTION]") ||
-        normalized === ACT_MODE_CONTINUATION_PROMPT ||
-        normalized.startsWith("<hook_context") ||
-        normalized.includes("<bounded-output>") ||
-        normalized.includes("</bounded-output>")
-    )
+    if (normalized.startsWith("[TASK RESUMPTION]")) return true
+    if (normalized === ACT_MODE_CONTINUATION_PROMPT) return true
+    if (normalized.startsWith("<hook_context")) return true
+    if (
+        normalized.startsWith(BACKGROUND_TERMINAL_WAKE_PROMPT_PREFIX) &&
+        normalized.includes("<bounded-output>") &&
+        normalized.includes("</bounded-output>")
+    ) {
+        return true
+    }
+    return false
 }
```

**Net diff:** the synthetic-prompt predicate is now conjunctive
(prefix AND both delimiters), the prefix is single-sourced from
the formatter, and the format string in `formatTerminalWakePrompt`
references the same constant. The predicate cannot match any user
prompt that does not start with the formatter-owned prefix.

## Live-equivalent behavior (production-shaped)

For ONE background command with `notifyOnCompletion: true` reaching
terminal state:

```text
ONE logical terminal event
  → ONE autonomous wake (BackgroundNotifyCoordinator)
  → ONE continuation turn (PendingPromptsController.drain → runTurn)
  → ONE assistant response (AgentRuntime)
  → pending_prompt_submitted event carries the wake prompt
    → translateSessionEvent: ZERO rows (synthetic-prompt filter active)
  → ZERO user_feedback rows for the wake
  → ONE visible completion message (the agent's own assistant response)
```

The user's chat shows ONE distinguishable completion message per
jobId. Two distinct jobIds produce TWO distinguishable completion
messages (BCNEX-CTL-06 / multi-job control).

## Conservation

- BCNEX01 (this ACT, post-P1): **7/7 PASS** (3 original + 3 P1 + 1 CTL-12)
- BCNT01 (notify-on-terminal): 27/27 PASS
- LHOWA01-WIRE (long-horizon authority): 2/2 PASS
- PPAT01 (transport-neutral authority): 10/10 PASS
- BTCONT01 (deferred continuation): 10/10 PASS
- BCTCP01-RUNNER-SEAM (terminal card projection): 5/5 PASS
- BCAFG01 (awaiting-followup guard): 5/5 PASS
- AGCONT01 (agent continuation): 7/7 PASS
- PWAOR01 (proceed-while-running abort ownership): 1/1 PASS
- sdk-user-message-mapping: 17/17 PASS
- message-translator: 170/170 PASS
- sdk-mode-coordinator: 34/34 PASS
- sdk-followup-coordinator: 23/23 PASS
- bun unit suite: 744 passed + 4 skipped (no failures introduced)

Pre-existing failures (NOT caused by this ACT, verified via git
stash round-trip):
- LHOWA01-GREEN (synthetic-real) — pre-existing at entry HEAD 9b7391a82
- OWN01-RED (sdk-session-event-coordinator) — pre-existing at entry HEAD 9b7391a82

## Diagnostic trace

Three trace entries (operator-readable) prove the post-fix flow:
1. `BackgroundNotifyCoordinator.consumeTerminal(...)` returns
   `{ kind: "drained", jobId: "J-ctl12", drainedCount: 1, enqueuedNow: true }`
2. `TestPendingPromptQueue.countForSession(activeSessionId) === 1`
3. `translateSessionEvent(pending_prompt_submitted with wake)` →
   `result.messages === []`
