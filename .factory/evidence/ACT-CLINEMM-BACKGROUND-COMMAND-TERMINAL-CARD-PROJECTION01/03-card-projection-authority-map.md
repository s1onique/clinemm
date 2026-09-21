# 03 — Card Projection Authority Map

```text
                       REAL_PRODUCTION_SEAM
run_commands tool result
  ↓ (structured envelope { status: "running", jobId: "cmd_..." })
message-translator (apps/vscode/src/sdk/message-translator.ts:1747-1804)
  ↓ (content_end event, says stream emits say:"command" once with partial:false)
  ↓   commandCompleted = !isBackgroundedEnvelope
  ↓   commandExecutionDisposition = "backgrounded"
  ↓   text = `${command}\n<<<COMMAND OUTPUT>>>\n${envelope-json}`
clineMessages[i] (immutable historical fact)
  ↓ (React selector, ChatRow.tsx:236)
isCommandBackgrounded = isCommandMessage && commandExecutionDisposition === "backgrounded"
  ↓
CommandOutputRow (apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx:188-274)
  showCancelButton = (isCommandExecuting || isCommandPending || isCommandBackgrounded) && isBackgroundExec
  status pill text = getCommandStatusText(...) → "Backgrounded"
  pill dot = bg-success opacity-75 (non-pulsing, success family)

LIVE
---
CommandJobManager (apps/vscode/src/sdk/command-job-manager.ts)
  ↓ (lifecycle sink → shared host)
  ↓ terminal transitions fire onBackgroundStateChange(false, undefined)
  ↓                   vscode-run-commands-tool.ts:697-698
SdkController.updateBackgroundCommandState (line 4376)
  ↓ backgroundCommandRunning = false, backgroundCommandTaskId = undefined
  ↓ postStateToWebview()
getStateToPostToWebview (line 4665)
  ↓ backgroundCommandRunning = false
  ↓ activeCommandJobs = manager.activeCount
  ↓ taskTelemetry.activeCommandJobs = N
  ↓  (NOTE: NO per-job projection of WHICH job terminalized)
webview ExtensionStateContext (apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:428-430)
  ↓ backgroundCommandRunning scalar + backgroundCommandTaskId scalar
  ↓  (no per-row identity)
ExtensionStateContext consumers
  ↓
  TaskHeaderTelemetry (gauge renders ⎇ N)
  ActionButtons.secondaryAction (composer gating)
  BUT: CommandOutputRow receives neither backgroundCommandRunning
       NOR backgroundCommandTaskId NOR any per-job projection
  → row NEVER knows the job is gone

INFERRED / UNAVAILABLE
---
The chat-row consumes only its own message text. The CommandJobManager
state machine is not in the webview's row-level vocabulary at all.
The webview's only knowledge of background-command liveness is the
scalar backgroundCommandRunning (TaskHeader gauge + cancel-gating
elsewhere) — which is too coarse to identify WHICH row to update.
```

## Edge labels

| Edge | Label |
|------|-------|
| run_commands → envelope | REAL_PRODUCTION_SEAM |
| envelope → message-translator | REAL_PRODUCTION_SEAM |
| message-translator → clineMessages | REAL_PRODUCTION_SEAM (immutable stamp) |
| clineMessages → ChatRow.isCommandBackgrounded | REAL_PRODUCTION_SEAM |
| CommandOutputRow rendering from isCommandBackgrounded | REAL_PRODUCTION_SEAM |
| CommandJobManager → onBackgroundStateChange | REAL_PRODUCTION_SEAM |
| onBackgroundStateChange → SdkController.updateBackgroundCommandState | REAL_PRODUCTION_SEAM |
| updateBackgroundCommandState → getStateToPostToWebview | REAL_PRODUCTION_SEAM |
| getStateToPostToWebview → webview state | REAL_PRODUCTION_SEAM |
| webview state → CommandOutputRow (per-row identity) | **UNAVAILABLE** (no per-row wiring exists) |
| TaskHeader gauge from webview state | REAL_PRODUCTION_SEAM |

## Consequence

The current webview state carries ONLY a scalar projection
(`backgroundCommandRunning: boolean`, `backgroundCommandTaskId?: string`).
Even if the row consulted it, the row's `message.ts` cannot be
matched to `backgroundCommandTaskId` because:
- `message.ts` is the streaming-content timestamp (column), not the
  CommandJob jobId.
- `backgroundCommandTaskId` is the LAST active jobId; not all
  jobIds in the chat row history.
- Even if both matched, this single-scalar projection cannot
  handle the multi-job case (CPJ-CTL-03 / §15).
