# 02-estimate-authority-inventory.md

## W writers (agent-runtime-side, post-fifteenth-pass TRANSPORT-REPAIR01)

```
W-AGENT.PREPARE_TURN_PRODUCER
  createCompactionStateAwarePrepareTurn / publishWorkingContextEstimate*
  sdk/packages/core/src/extensions/context/compaction.ts:824..838
  cadence: every successful prepareTurn (producer-cadence GREEN;
            tenth-pass)

W-CARRIER.OBSERVE
  WorkingContextHostCapture.observe(event)
  apps/vscode/src/sdk/working-context-host-capture.ts:174..199
  triggered by: working-context-state-changed events from
                AgentRuntime.emit (sdk/packages/agents/src/agent-runtime.ts:1270)

W-PUBLISH.SYNTHETIC  (NEW for this ACT)
  WorkingContextHostCapture.observe(synthetic-event)
  proposed in apps/vscode/src/sdk/sdk-compaction-coordinator.ts new path
  triggered by: successful manual compaction completion (single emit per
                call to compactTask)
```

## W writers (manual-compaction specific, currently broken)

```
W-MANUAL.COMPACT_SESSION_MESSAGES_DROP  (DEFECT)
  compactSessionMessages returns only { compacted, messages, compactionState }
  apps/vscode/src/sdk/sdk-compaction.ts:147..156
  The result.currentWorkingContextEstimate from compact({...}) is dropped.
  Verified by source reading; not asserted in tests because the function
  has no test that asserts W publication (the pre-CORRECTION01 RED
  acknowledged this gap; see above c25 follow-up comment).
```

## W readers

```
W-READ.GET_STATE_TO_POST_TO_WEBVIEW
  apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:167
  projectWorkingContextStateFromCarrier(...) reads carrier verbatim

W-READ.CONTEXT_WINDOW_NUMERATOR
  apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.tsx:202..220
  precedence: W (number) > P (lastApiReqContextInputTokens) > UNAVAILABLE

W-READ.TEST_SEAMS
  apps/vscode/src/sdk/__tests__/working-context-webview-state-projection.test.ts
  apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.test.tsx
```

## P writers / readers (out-of-scope for W publication)

```
P = lastApiReqContextInputTokens from the last provider request
   (apps/vscode/src/shared/getApiMetrics.ts, ChatView TaskSection prop chain)
   stays as the fallback when W is null/undefined.
```

## Other UI elements (NOT touched by this ACT)

```
compaction divider
  apps/vscode/webview-ui/src/components/chat/CompactionRow.tsx:45..47
  reads info.tokensBefore/tokensAfter from the CompactionInfo divider row
  emitted by sdk-compaction-coordinator.ts:554..564

CLINE message count badge
  reads clineMessages.length
  updates with new task messages
```

## Writer classification

Of the writer paths inventoried, ONLY:

```
W-AGENT.PREPARE_TURN_PRODUCER  --> W-CARRIER.OBSERVE  --> UI
```

is wired. Manual compaction's W is published by the same producer
(createContextCompactionPrepareTurn at compaction.ts), but the
host-side caller (`compactSessionMessages`) skips the observe step.

This is CLASS A: NO_POST_COMPACTION_PUBLICATION (the W is computed
but never reaches the host-side carrier).
