# LIVE Specimen — One Background Job, Natural Exit

## Reproduction

Operator-driven dogfood specimen (per ACT §21) is DEFERRED — the
cloud agent context lacks the `vsce:prepublish` + sideload infrastructure
required to install a fresh dogfood VSIX and drive a real chat session.

Instead, the ACT substitutes a structural-composition reproduction
that exercises the EXACT production chain end-to-end:

```text
CommandJobManager.start(...)
  → registerMarker(...)              ← background-notify-coordinator.ts:267
  → terminalPromise.then(...)        ← vscode-run-commands-tool.ts:775
    → consumeTerminal({...})         ← background-notify-coordinator.ts:299
      → notificationMarkers.delete() ← background-notify-coordinator.ts:315
      → enqueueTerminalWake({...})   ← SdkController.ts:706-744
        → active.sdkHost.send({...}) ← LocalRuntimeHost.runTurn
          → PendingPromptsController.enqueue
            → scheduleDrain
              → drain → shiftNext → emitSubmitted (pending_prompt_submitted)
                → translateSessionEvent
                  → result.messages.push(user_feedback row)  ← DUPLICATE
                → agent.run() → assistant response
                  → translateSessionEvent
                    → result.messages.push(text row)         ← DUPLICATE
```

## RED observation (pre-fix)

For ONE jobId reaching ONE terminal state:

```text
visible-message-count == 2
  (1) say: "user_feedback", text: <wake prompt>  ← synthetic wake leaking
  (2) say: "text",        text: <agent response> ← model's own completion
```

`translateSessionEvent` on `pending_prompt_submitted` carrying the
wake prompt text emits a `say: "user_feedback"` row. The webview
`<UserMessage>` component renders this row (apps/vscode/webview-ui/
src/components/chat/ChatRow.tsx:1066-1076). The agent's own
assistant response is rendered separately. Two distinguishable
messages per one terminal event.

## GREEN observation (post-fix)

With the synthetic-prompt predicate extended to recognize the
bounded-output delimiters (apps/vscode/src/sdk/sdk-user-message-mapping.ts:78-86),
`isSyntheticUserPrompt(wakePrompt)` returns `true`, and the
`pending_prompt_submitted` translation produces ZERO rows (matching
the existing TASK_RESUMPTION behavior at message-translator.test.ts:232-253).

```text
visible-message-count == 1
  (1) say: "text", text: <agent response>  ← ONLY the model's own completion
```
