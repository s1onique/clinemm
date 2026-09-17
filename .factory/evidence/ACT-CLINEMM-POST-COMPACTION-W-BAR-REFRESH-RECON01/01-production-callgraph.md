# 01-production-callgraph.md

Full production chain for the persistent top working-context bar
(via the AgentRuntime-side `currentWorkingContextEstimate` authority).

## B1..B7 chain

```
B1  compaction prepareTurn computes W
    sdk/packages/core/src/extensions/context/compaction.ts:747
    sdk/packages/core/src/extensions/context/compaction.ts:750
    sdk/packages/core/src/extensions/context/compaction.ts:761
    -> returns { messages, systemPrompt?, currentWorkingContextEstimate }

B2  wrapper inside createCompactionStateAwarePrepareTurn
    sdk/packages/core/src/extensions/context/compaction.ts:706..761
    -> returns { messages?, systemPrompt?, currentWorkingContextEstimate? }
       (the lower-level ContextPipelinePrepareTurnResult)

B3  AgentRuntime.prepareTurnForModelRequest consumer
    sdk/packages/agents/src/agent-runtime.ts:2303..2325
    -> reads result.currentWorkingContextEstimate, exposes via snapshot

B4  AgentRuntime snapshot publisher
    sdk/packages/agents/src/agent-runtime.ts:1270 (working-context-state-changed emit)
    -> emits AgentRuntimeEvent { type: "working-context-state-changed",
                                  snapshot.currentWorkingContextEstimate }

B5  VscodeSessionHost.subscribeRuntimeEvents bridge
    sdk/packages/core/src/runtime/host/vscode-session-host.ts (subscription wiring,
    apps/vscode/src/sdk/__tests__/vscode-session-host.subscribe-runtime-events
    .e2f-f1.test.ts)

B6  WorkingContextHostCapture.observe(event)
    apps/vscode/src/sdk/working-context-host-capture.ts:174..199
    -> unconditional assignment of carrier._latest

B7  projectWorkingContextStateFromCarrier(...) -> getStateToPostToWebview
    apps/vscode/src/core/controller/state/working-context-state-projection.ts:78..84
    apps/vscode/src/core/controller/state/getStateToPostToWebview.ts:167..183
    -> ExtensionState.currentWorkingContextEstimate is number | null | undefined

B8  webview ExtensionStateContext reducer emits
    apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
    -> ExtensionState received via postMessage

B9  TaskHeader / ContextWindow consumer
    apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.tsx:200..220
    -> precedence: W (number) > P (lastApiReqContextInputTokens) > UNAVAILABLE

B10 ContextWindow numerical formatter -> top bar
    apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.tsx:289
    -> renders "{formatLargeNumber(tokenData.used)}" as the top bar value
```

## Manual-compaction path (the OBSERVED path that produces 29.6k divider + 412.7k bar)

```
M1  user clicks CompactTaskButton (or /compact slash command)
    apps/vscode/webview-ui/src/components/chat/task-header/buttons/CompactTaskButton.tsx
    apps/vscode/src/core/controller/slash/condense.ts:13..16
    -> POSTs /compact RPC

M2  SDK controller dispatches
    apps/vscode/src/sdk/SdkController.ts compactTask handler
    -> SdkCompactionCoordinator.compactTask
       apps/vscode/src/sdk/sdk-compaction-coordinator.ts:154

M3  SdkCompactionCoordinator.runCompaction
    apps/vscode/src/sdk/sdk-compaction-coordinator.ts:306
    -> reads messages, builds config, calls runCompactionInPhase

M4  SdkCompactionCoordinator.runCompactionInPhase
    apps/vscode/src/sdk/sdk-compaction-coordinator.ts:471
    -> compactSessionMessages(...)
       apps/vscode/src/sdk/sdk-compaction.ts:56

M5  compactSessionMessages
    apps/vscode/src/sdk/sdk-compaction.ts:97..113
    -> creates compact = createContextCompactionPrepareTurn(config, { mode: "manual" })
    -> AWAITS compact({...}) which produces a full
       { messages, systemPrompt?, currentWorkingContextEstimate }
    (the return from createContextCompactionPrepareTurn,
     see sdk/packages/core/src/extensions/context/compaction.ts:761 / :798)

M6  compactSessionMessages RETURNS
    apps/vscode/src/sdk/sdk-compaction.ts:147..156
    return {
        compacted: true,
        messages: result.messages,
        compactionState: createSessionCompactionState({...}),
    }
    *** currentWorkingContextEstimate is DROP THROUGH HERE ***

    The 29.6k visible in the divider does NOT come from W.
    It comes from the SDK emitStatusNotice callback at
    apps/vscode/src/sdk/sdk-compaction-coordinator.ts:498..503
    which captures sdk-internal compaction counters (compaction.ts:622..632
    tokensBefore/tokensAfter) and parses them via
    apps/vscode/src/sdk/message-translator.ts:1212..1248
    into noticeInfo (tokensAfter 29.6k). The emitCompactionRow at
    coordinator.ts:554..564 writes the divider using noticeInfo.

M7  SdkCompactionCoordinator.runCompactionInPhase posts via
    this.options.postStateToWebview()  (coordinator.ts:535)
    -> ExtensionState recompiled; currentWorkingContextEstimate READ
       from the carrier (apps/vscode/src/sdk/working-context-host-capture.ts:131..136)

M8  Carrier observation
    The carrier ONLY observes `working-context-state-changed` events
    (apps/vscode/src/sdk/working-context-host-capture.ts:175). Manual
    compaction flows through compactSessionMessages without ever
    emitting that event. The carrier._latest stays whatever the last
    AgentRuntime.prepareTurn for the session published.

M9  Result
    If the last prepareTurn for the session happened BEFORE the
    compaction (a high-W turn), the carrier holds that high W
    (≈412.7k in this instance). If the carrier was never observed
    (pre-warm), it is null.

M10 UI precedence
    ContextWindow numerator precedence is W (number) > P > UNAVAILABLE
    (ContextWindow.tsx:202..220). On the bar, with W=412700k stale,
    the bar renders W. With W=null (cleared) it would fall back to P
    = lastApiReqContextInputTokens (which is also high pre-compaction).
    Either way: top bar shows ≈412.7k.

    Divider shows 29.6k (from noticeInfo). Top bar shows 412.7k.
    Delta ≈383.1k.
```

## Defect location (CLASS = A)

The producer seam at compaction.ts:747..761, :798 correctly produces
W. But `apps/vscode/src/sdk/sdk-compaction.ts:97..156` calls the bare
ContextPipelinePrepareTurn (`createContextCompactionPrepareTurn`
without the `createCompactionStateAwarePrepareTurn` wrapper) and
discards W in its return.

The runtime-event bridge (apps/vscode/src/sdk/working-context-host-
capture.ts:174..199) is fine; no event arrives for manual compaction.

FIRST_BAD_BOUNDARY = M6: post-compaction W publication to host.
