# Approval Correlation Seam Map — ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01

> Causal question: can approval/rejection state from request X
> incorrectly authorize or suppress approval for request Y in
> ClineMM's VSCode host adapter?

---

## Q1-Q12 Recon (ACT §2)

### Q1. What object identifies an approval request?

**Identity primitives** on `ToolApprovalRequest`
(apps/vscode/src/sdk/sdk-interaction-coordinator.ts:52-60):

```ts
export interface ToolApprovalRequest {
    agentId: string
    conversationId: string
    iteration: number
    toolCallId: string
    toolName: string
    input: unknown
    policy: { enabled?: boolean; autoApprove?: boolean }
}
```

The ASK-side handle (created in `runRequestToolApproval` at lines
674-683) is a **single in-flight slot**:

```ts
return new Promise<...>((resolve) => {
    this.pendingToolApprovalResolve = resolve
    this.pendingToolApprovalMessage = {
        toolCallId: request.toolCallId,
        messageTs:  toolAskMessage.ts,
        toolName:   request.toolName,
        decision:   commandEval?.decision,
        executionPlan: commandEval?.executionPlan,
    }
})
```

`pendingToolApprovalResolve` is a **single Promise resolver
property**, NOT a `Map<toolCallId, …>`. There is no per-toolCallId
fanout. At most ONE approval can be pending at any moment.

### Q2. Which fields are load-bearing when matching a response to a pending request?

NONE beyond "is there ANY pending approval at all."

`resolvePendingToolApproval(prompt, responseType, images?, files?)`
(lines 711-739) keys only on `this.pendingToolApprovalResolve`
existence:

```ts
if (!this.pendingToolApprovalResolve) {
    return false   // no pending → response is dropped
}
```

It does NOT match a response-toolCallId against
`pendingToolApprovalMessage.toolCallId`. The pending message is
consumed after the response arrives — correct for the single-slot
model but means:

  - If no pending request, the response is dropped (717-719).
### Q3. Where is rejection represented?

In the webview → extension flow:

  - User clicks Reject → webview posts `askResponse` with
    `responseType === "noButtonClicked"` (or
    `"messageResponse"` for queued feedback, lines 724-733).
  - `resolvePendingToolApproval` reads `responseType ===
    "yesButtonClicked"` to compute `approved` (line 738).
  - On reject, the resolver is called with
    `{ approved: false, reason: buildToolApprovalDenialReason(...) }`
    (line 750; buildToolApprovalDenialReason constructs
    "operation did NOT happen" framing).
  - For session cancellation / task switch:
    `clearPending(reason)` calls
    `recordDeniedToolApproval(toolCallId, toolName, reason)` and
    resolves with `{ approved: false, reason }`
    (lines 872-908).

There is no separate "rejection state" object. Rejection is a
destructive resolve of the pending promise, after which the slot
is cleared (lines 735-736:
`this.pendingToolApprovalResolve = undefined;
this.pendingToolApprovalMessage = undefined`).

### Q4. After rejection, is pending approval state deleted atomically?

YES. Lines 735-736 execute together:

```ts
this.pendingToolApprovalResolve = undefined
this.pendingToolApprovalMessage = undefined
```

Atomic relative to subsequent `handleRequestToolApproval` calls,
because the in-flight Promise is captured in local `resolve`
(line 721) BEFORE the slot is cleared (line 735), so the resolver
itself remains valid even after the slot is gone. Subsequent
`handleRequestToolApproval` calls cannot find a pending slot and
therefore build a brand-new ASK (different toolCallId, different
messageTs, different pendingToolApprovalMessage).

### Q5. Can any "already approved", "auto-approved", or "handled" bit survive rejection?

NO — at the SdkInteractionCoordinator level.

  - `pendingToolApprovalMessage.decision` and
    `pendingToolApprovalMessage.executionPlan` are local to the
    pending slot, cleared on resolve (lines 735-736).
  - `recordApprovedToolMessage(toolCallId, messageTs)` is called
    ONLY on the approve path (line 741). On reject it is NOT
    called; instead `recordDeniedToolApproval` is called from
    `clearPending` (line 898).
  - `messageTranslatorState.recordApprovedToolMessageTs` (via
    the SdkController callback at line 947-948) maps
    `toolCallId → messageTs` for **UI rendering only** —
    see apps/vscode/src/sdk/message-translator.ts:144-147.

There is no `autoApproveCache`, no `approvedCommandsSet`, no
`deniedToolCallIds` skip-list (verified — no occurrences).

### Q6. If the same textual command is emitted again, is it considered: same / equivalent / new?

NEW REQUEST. The model's tool_use blocks carry a fresh
`toolCallId` (and a fresh `iteration`) on every emission. The
command text alone is not identity.

### Q7. Can approval state be keyed only by command text/tool name?

NO. There is no command-text-keyed cache or tool-name-keyed
cache anywhere in the production seam. `isToolAutoApproved`
(apps/vscode/src/sdk/sdk-tool-policies.ts) is a **stateless
predicate over `request.toolName` + `autoApprovalSettings`**, not
a cache. It runs every call.
  - If a pending request exists, the response is applied to IT
    (720-751) regardless of whether the response semantically
    "belongs to" it.

The second property is the load-bearing one. In a single-slot
### Q8. Does task/epoch identity participate in approval correlation?

The SdkInteractionCoordinator doesn't track epoch. It tracks:

  - `agentId`
  - `conversationId`
  - `iteration`
  - `toolCallId`

These are recorded on `pendingToolApprovalMessage` (676-682) but
the response correlation is single-slot, not key-lookup.
Conversation identity therefore CANNOT leak across
`{agentId, conversationId, iteration, toolCallId}` — the
single-slot is the guard.

### Q9. Can a new task inherit pending or resolved approval state?

NO. `pendingToolApprovalResolve` lives on the
SdkInteractionCoordinator instance. The task-control teardown
choke-point calls `interactions.clearPending(reason)` which
destroys the slot.

`SessionAutoApprovalStore.clearActiveOverride()`
(session-auto-approval.ts:493-502) destroys the session-override
slot at the same choke-point. The two are independent state
planes; neither leaks across tasks.

### Q10. Can background/foreground promotion alter approval identity?

The current code paths route `requestToolApproval` through the
same `handleRequestToolApproval` for both background and
foreground tools. The identity primitives are
`{agentId, conversationId, iteration, toolCallId, toolName,
input}`. The single-slot model treats them uniformly.

Background handoff (background-command-handoff paths) doesn't
appear to bypass the approval gate. (Out of scope for this ACT;
mentioned only to confirm no implicit bypass.)

### Q11. Can a rejected operation be retried without re-entering the approval gate?

This is the load-bearing question. Candidates:

  a. **Model retry with new toolCallId**: A fresh
     `handleRequestToolApproval` call. Verdict on this ACT's
     R1 below.

  b. **Engine retry with same toolCallId**: Not possible in
     the current code path — `toolCallId` is minted per step
     by the model stream adapter, not by the engine.

  c. **Session continuation across tasks**: NOT possible
     because clearPending destroys the slot at task teardown.

  d. **Provider retry of an HTTP request**: would re-emit the
     same model output, which would re-emit the same tool_use
     block. The next model-side step would have the same
     `toolCallId` — but no production path I've traced
     surfaces this case.

R1 below directly tests (a), which is the most-likely upstream
#10783 reproduction path.

### Q12. What existing tests cover reject / retry / duplicate / new request / task change?

  - apps/vscode/src/sdk/sdk-interaction-coordinator.session-
    autonomy.test.ts (existing): tests approve/reject paths,
    pre-arm, clearActiveOverride, session-scoped override. None
    test "reject A → same command B with new toolCallId MUST
    re-prompt". This is the gap.

  - apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts
    (existing): tests approve path message bookkeeping, basic
    request/resolve cycle. Does not test reject-then-retry.
---

## Production seam (the single correlation slot)

```
   model emits tool_use (toolCallId=X, toolName=run_commands, input=...)
        │
        ▼
   AgentRuntime.executePreparedTool(...)
        │
        ▼
   sdkHost.requestToolApproval({ agentId, conversationId, iteration,
                                 toolCallId, toolName, input, policy })
        │
        ▼
   SdkController → interactions.handleRequestToolApproval(request)
        │
        │  ─── runs evaluateCommandToolApproval(...) ──
        │      if DENY: return { approved: false, reason } (no UI)
        │      if ALLOW: return { approved: true } (no UI)
        │      else:     ▼
        │
        ▼
   SdkInteractionCoordinator.runRequestToolApproval (lines 375-684)
        │
        │  - build ClineMessage (toolAskMessage) at line 617
        │  - append + emit to webview (lines 619-622)
        │  - setTurnPhase("awaiting_approval", ...)
        │  - postStateToWebview()
        │
        ▼
   this.pendingToolApprovalResolve = resolve   (line 675)
   this.pendingToolApprovalMessage = { toolCallId, messageTs,
       toolName, decision, executionPlan }    (lines 676-682)
        │
        ▼
   ┌──────────────────────────────────────────────────────────┐
   │   single in-flight slot — at most ONE approval pending   │
   └──────────────────────────────────────────────────────────┘
        │
        ▼
   user clicks Approve/Reject in webview
        │
        ▼
   webview → askResponse(prompt, responseType, images, files)
        │
        ▼
   SdkController.askResponse → interactions.resolvePendingToolApproval(
### Critical observations

  1. **Single-slot is the correlation mechanism.** Because at
     most one approval can be pending, there is no possibility
     of "which one was this response for?" race. The moment a
     second approval is requested, the first slot must have
     been resolved (otherwise a deadlock). Therefore the
     single-slot + reject-clears-slot pair prevents A's
     rejection from being confused with B's prompt.

  2. **Atomic slot destruction (Q4)** ensures reject on A
     genuinely resets the state for B.

  3. **No global cache or auto-approve by command text (Q5,
     Q7)** ensures rejection doesn't carry forward.

  4. **No re-entrancy without fresh `handleRequestToolApproval`
     call (Q11a)** is the load-bearing case — tested in R1
     below.

---

## Production callsites verified

  - apps/vscode/src/sdk/sdk-interaction-coordinator.ts:52-60
    `ToolApprovalRequest` interface
  - apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326-373
    `handleRequestToolApproval` (entry)
  - apps/vscode/src/sdk/sdk-interaction-coordinator.ts:375-684
    `runRequestToolApproval` (body)
  - apps/vscode/src/sdk/sdk-interaction-coordinator.ts:674-683
    single-slot pendingPromise
  - apps/vscode/src/sdk/sdk-interaction-coordinator.ts:711-751
    `resolvePendingToolApproval` (response handler)
  - apps/vscode/src/sdk/sdk-interaction-coordinator.ts:872-908
    `clearPending` (lifecycle cancellation)
  - apps/vscode/src/sdk/sdk-tool-policies.ts:546-579
    `evaluateCommandToolApproval` (pure, stateless)
  - apps/vscode/src/sdk/session-auto-approval.ts:493-502
    `clearActiveOverride` (lifecycle cancellation of session
    override)
                                    prompt, responseType, images, files)
        │
        │  if no pending → return false (line 717-719)
        │  if "messageResponse" → return false (leave open) line 724-733
        │  else:
        │     pendingToolApprovalResolve = undefined
        │     pendingToolApprovalMessage = undefined
        │     approved = (responseType === "yesButtonClicked")
        │     on approve: recordApprovedToolMessage(toolCallId, msgTs)
        │     on reject:  resolver called with
        │                 { approved: false, reason }
        │     setTurnPhase("streaming", ...)
        │
        ▼
   handleRequestToolApproval Promise resolves → AgentRuntime
   receives approved/denied → tool executes (or error result
   delivered to model)
```

  - apps/vscode/src/sdk/sdk-task-control-coordinator.test.ts:179
    has one test that calls `clearPending("Task switched")` →
    `expect(approvalPromise).resolves.toEqual({ approved: false,
    reason: "Task switched" })`. This proves cancellation
    resolves with reject. It does NOT prove a subsequent
    request gets a fresh ASK — that's the gap.

**Gap confirmed**: there is no existing test that rejects a
request, then re-issues the same command with a new toolCallId
and asserts a fresh ASK. This ACT closes that gap.
universe there is no race: only one approval is in flight at a
time, so there is no other pending request the response could
be intended for. The single-slot property IS the correlation
mechanism.
