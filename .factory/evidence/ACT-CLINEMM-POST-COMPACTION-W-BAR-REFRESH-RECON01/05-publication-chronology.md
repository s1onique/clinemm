# 05-publication-chronology.md

T0  Last AgentRuntime.prepareTurn for the session happened pre-compaction.
    Carrier observed currentWorkingContextEstimate = 412_700 (≈412.7k).

T1  User clicks "Compact" button (or /compact slash command).
    Source: apps/vscode/webview-ui/src/components/chat/task-header/buttons/CompactTaskButton.tsx
    -> gRPC condense RPC -> condense.ts -> SdkController.compactTask()
    Carrier UNCHANGED: 412_700.

T2  SdkCompactionCoordinator.compactTask -> runCompaction ->
    runCompactionInPhase runs compactSessionMessages.

T3  compactSessionMessages calls the prepareTurn seam
    (createContextCompactionPrepareTurn). The producer computes W_post
    = 29_600 (≈29.6k) via publishWorkingContextEstimate(...).
    W_post is returned in the result shape (currentWorkingContextEstimate).
    Carrier UNCHANGED: 412_700.  <-- THIS IS THE DEFECT

T4  compactSessionMessages RETURNS only
    { compacted: true, messages, compactionState }.
    result.currentWorkingContextEstimate = 29_600 is dropped on the floor.

T5  Coordinator emits the divider via emitCompactionRow with
    noticeInfo.tokensAfter = 29_600.
    Divider visible: 382.3k → 29.6k.

T6  postStateToWebview -> getStateToPostToWebview reads the carrier.
    ExtensionState.currentWorkingContextEstimate = 412_700 (last observe).

T7  Webview receives ExtensionState. TaskHeader ContextWindow renders.
    Numerator precedence: W = 412_700.
    Bar visible: 412.7k.

T8  User sends the next message. Provider request is prepared normally.
    prepareTurn runs through createCompactionStateAwarePrepareTurn (per
    the runtime seam). The producer computes W_next = ~30k (because
    SessionRuntime reads the new compaction state and projects it).
    The AgentRuntime publishes working-context-state-changed { W = ~30k }.
    Carrier updated to ~30k. Bar visible: ~30k.   <-- BAR UPDATES ON NEXT TURN

Critical observation:

  BAR UPDATES ON THE NEXT PREPARE_TURN, not on compaction completion.

  This is the slow-recovery path. The user sees the divider change
  immediately (T5) but the bar stays stale until T8 (next message).

  The minimal repair: synthesize a working-context-state-changed event
  in the coordinator at T6 (replacing the post-compaction publication)
  so the bar updates at the same time as the divider.

GOTCHA: the runtime.prepareTurn seam is the AUTHORITY. Synthesizing
an event is a TRANSPORT-ONLY STEP. The synthesized value must match
the producer's value (29_600 / ~30k equivalent). The compactSession
Messages function already computes it; we only need to surface it.

CHRONOLOGY != CAUSAL IDENTITY: T0..T7 are explicitly the LIVE UI
sequence. T8 is the inferred next-step. We don't yet know T8 behavior
without actually triggering a follow-up turn; it remains an inference.
