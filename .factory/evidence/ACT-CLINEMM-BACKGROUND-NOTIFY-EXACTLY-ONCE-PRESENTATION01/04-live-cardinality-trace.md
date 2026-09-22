# Live Cardinality Trace — One Background Job

## One jobId, one terminal event, one wake — end-to-end counts

| Stage | Count | Evidence |
|---|---|---|
| C1 terminal lifecycle commits | **1** | `command-job-manager.ts:2419` — `if (job.finalized) return` guard |
| C2 coordinator consumeTerminal calls | **1** | `vscode-run-commands-tool.ts:775` — single `.then()` attachment to `start.terminalPromise` for the wake consumer |
| C3 notification-marker consumptions | **1** | `background-notify-coordinator.ts:315` — `notificationMarkers.delete(jobId)` (destructive read) |
| C4 generated terminal wake prompts | **1** | `background-notify-coordinator.ts:381-390` — single enqueue call site |
| C5 PendingPrompts enqueue operations | **1** | `SdkController.ts:729` — `active.sdkHost.send({...})` callback fires once |
| C6 pending_prompts queue entries | **1** | `pending-prompt-service.ts:256` — `service.enqueue(session, entry)` push |
| C7 pending prompt submissions / drains | **1** | `pending-prompt-service.ts:319` — `drainingPendingPrompts` flag prevents reentrant |
| C8 autonomous runTurn invocations | **1** | `pending-prompt-service.ts:322` — single `deps.send(...)` |
| C9 resulting model turns | **1** | `LocalRuntimeHost.runTurn` — one prompt → one `agent.run()` |
| **C10 visible completion messages (pre-fix)** | **2** | **(wake echo as user_feedback) + (agent's assistant response)** |
| **C10 visible completion messages (post-fix)** | **1** | **(agent's assistant response only)** |

## First duplicated seam: presentation (C10)

Stages C1..C9 are all EXACTLY-ONCE per jobId. The cardinality invariant
holds end-to-end through the production chain.

The duplication is at the PRESENTATION seam:

- The wake prompt reaches the message translator via the
  `pending_prompt_submitted` event. The translator pushes a
  `say: "user_feedback"` row (apps/vscode/src/sdk/message-translator.ts:2303-2332).
- The agent's assistant response is rendered separately.

Both rows are visible to the user (rendered by `<UserMessage>` for
user_feedback and `<ChatRow>` for assistant text).

## Root cause

`isSyntheticUserPrompt(text)` at apps/vscode/src/sdk/sdk-user-message-mapping.ts:50-66
does NOT match the wake prompt format produced by `formatTerminalWakePrompt`
at apps/vscode/src/sdk/background-notify-coordinator.ts:107-148.

The wake prompt text starts with "A background command you asked to be
notified about has reached a terminal state." and contains
`<bounded-output>...</bounded-output>` delimiters (always present per
the formatter contract). None of the three existing synthetic predicates
match: `[TASK RESUMPTION]`, `ACT_MODE_CONTINUATION_PROMPT`, or `<hook_context`.

The synthetic-prompt allowlist was inherited from upstream precedent
(where task resumption and mode-switch synthetic continuations are
filtered), but the new terminal-wake synthetic continuation was never
added to the allowlist.

## Repair

Add the bounded-output delimiters (always present per the formatter
contract) as a fourth synthetic predicate. This causes the wake prompt
to be filtered exactly the same way as TASK_RESUMPTION — zero rows
emitted from `pending_prompt_submitted`, the agent's assistant
response becomes the single user-visible completion message.

The repair is the SMALLEST POSSIBLE DIFF (4 added lines in
sdk-user-message-mapping.ts). It does NOT touch:
- CommandJobManager
- BackgroundNotifyCoordinator
- PendingPromptsController
- runTurn / AgentRuntime
- Hub ordering machinery
- The wake prompt format (the bounded-output delimiters are
  unchanged; the formatter is unchanged)
- Tool schema (PROTO_DELTA = NO, PUBLIC_TOOL_SCHEMA_DELTA = NO)
