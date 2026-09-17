# 03-estimator-semantics.md

## Divider (29.6k)

Source: apps/vscode/src/sdk/sdk-compaction.ts:498..503
        apps/vscode/src/sdk/message-translator.ts:1212..1248 (parseCompactionNoticeMetadata)
        sdk/packages/core/src/extensions/context/compaction.ts:622..632

Estimator: SDK status-notice callback
Scope: post-compaction token estimate (system prompt + compacted messages
       + tools). NOT the same code path as the W publication.
Field: divide-value "X.Xk tokens"

Inferred value: 29.6k ≈ 29_600 tokens

## Top bar (412.7k)

Source: apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.tsx:289
        apps/vscode/src/components/chat/task-header/ContextWindow.tsx:202..220 (precedence)

Estimator: WorkingContextHostCapture.observe -> ExtensionState.currentWorkingContextEstimate
           FALLBACK to lastApiReqContextInputTokens when W is null/undefined

Field: ExtensionState.currentWorkingContextEstimate

Inferred value: 412.7k ≈ 412_700 tokens

## Are they the same semantic quantity?

POTENTIALLY yes (both claim to be "current working-context estimate").
Likely scope mismatch:

  divider tokensAfter = requestOverheadTokens + afterMessageTokens
    = systemPrompt + tools (overhead) + compacted-messages sum
  bar W (precedence winner here) = estimateRequestInputTokens(
       systemPrompt + compactedMessages + tools)
    ALMOST IDENTICAL scope — both use the same
    CANONICAL_W_ESTIMATOR (estimateRequestInputTokens in shared/llms/tokens)
    ALIKE DIFFERENT INPUTS.

The two SHOULD converge.

## Why they don't converge

W from prepareTurn is published on every successful prepareTurn.
Manual compaction does NOT trigger another prepareTurn after
completion (the next turn arrives at user-message send time). So:

  - The carrier stays at the value last published by AgentRuntime
    prepareTurn for that session.
  - If the LAST prepareTurn for that session was the huge one
    (pre-compaction), the carrier holds ~412.7k.
  - The divider computes its own tokens via a different seam and
    shows 29.6k.

## Conclusion

CLASS A: NO_POST_COMPACTION_PUBLICATION at the manual-compaction
producer seam.

The fix: ship the W from the producer (createContextCompaction-
PrepareTurn/compact) to the host-side carrier, OR synthesize a
post-compaction working-context-state-changed event so the carrier
observes the new W.

The two architectures are equivalent in effect (both update the
carrier and trigger a new ExtensionState publication). The bounded
repair uses the SYNTHETIC event approach because it threads the
carrier's own observe() path (zero new receiver logic) and keeps
the W capture a pure transport step.
