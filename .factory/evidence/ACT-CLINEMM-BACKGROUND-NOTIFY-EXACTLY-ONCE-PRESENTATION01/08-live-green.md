# LIVE GREEN — Post-Repair Reproduction

## Test output (post-fix)

```
$ bunx vitest run --config vitest.config.ts \
    background-notify-exactly-once-presentation01.bcnex01

 ✓ src/sdk/__tests__/background-notify-exactly-once-presentation01.bcnex01.test.ts (3 tests) 3ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

All 3 BCNEX tests pass.

## Production code change

`apps/vscode/src/sdk/sdk-user-message-mapping.ts:64-87`:

```diff
 export function isSyntheticUserPrompt(text: string): boolean {
   const normalized = stripModeNotices(normalizeUserInput(text))
   return (
     normalized.startsWith("[TASK RESUMPTION]") ||
     normalized === ACT_MODE_CONTINUATION_PROMPT ||
     normalized.startsWith("<hook_context") ||
+    // ACT-CLINEMM-BACKGROUND-NOTIFY-EXACTLY-ONCE-PRESENTATION01:
+    // background-notify terminal wake. Fingerprint is the
+    // bounded-output delimiters — both `<bounded-output>` and
+    // `</bounded-output>` are guaranteed present by the
+    // formatter contract (the prompt truncates ONLY the
+    // payload between them, never the delimiters).
+    normalized.includes("<bounded-output>") ||
+    normalized.includes("</bounded-output>")
   )
 }
```

4 added lines (the synthetic-prompt predicate extension + the
rationale comment).

## Live-equivalent behavior

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
- BCNEX01 (this ACT): 3/3 PASS
- bun unit suite: 1141/1141 PASS

Pre-existing failures (NOT caused by this ACT):
- LHOWA01-GREEN (synthetic-real) — pre-existing
- OWN01-RED (sdk-session-event-coordinator) — pre-existing
