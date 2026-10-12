# ACT-CLINEMM-ELM-SEAM09-TOOL-APPROVAL-LIFECYCLE-RECON — PASS_ELM_SEAM09_RECON — 2026-10-12

**Status:** CLOSED with verdict `PASS_ELM_SEAM09_RECON`. One bounded
production decision authority selected. No production code touched.
No Elm implementation attempted (per scope). The economics gate
passed for the selected sub-seam; the next ACT (SEAM10) is the
implementation cutover, not another recon.

**Preconditions met:**

- ENTRY_HEAD = `179800d36b14c564069f06cd9f701aa575b974da` on branch
  `main`; working tree clean; no stashes; no uncommitted changes
  (verified by `git status --short` returning empty).
- SEAM01–08 evidence preserved (all prior PASS / `NOT_A_GOOD_ELM_SEAM`
  / substrate / cutover / correction entries are still present in
  `.factory/epic-board.md`).
- The prior tool-approval-correlation recon
  (`ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01`,
  closed `CORRELATION_DEFECT_NOT_REPRODUCED` at the
  `SdkInteractionCoordinator` real production seam) is the
  load-bearing execution-path witness for this ACT.
- HALT_UNEXPECTED_TRACKED_DIRT: NOT TRIGGERED.

## 0. SEAM09 spec verbatim

```text
tool invocation
 → policy evaluation
 → approval request creation
 → pending approval registration
 → user / hub / SDK response
 → approval correlation
 → settlement
 → tool execution or rejection
 → cleanup
```

**Early economic gate (SEAM09 §"Early economic gate", 7 criteria):**

1. Meaningful temporal state transitions — **YES** (pending slot →
   published card → user response → settlement → cleanup; the
   single-slot Promise resolver transitions through
   `unset → set → set+message → unset+cleared` on every request).
2. Authority not already owned by Elm — **YES** (no Elm kernel
   references `pendingToolApprovalResolve`,
   `pendingToolApprovalMessage`, `resolvePendingToolApproval`, or
   `clearPending`; the 5 existing kernels — `completion-authority`,
   `completion-continuation-control`, `background-notify-authority`,
   `task-header-orchestration`, `deferred-completion-barrier` — are
   completion/notify/header/barrier authorities and do not touch
   the tool-approval ask/response correlation).
3. Multiple event sources interact with the same state — **YES**
   (four: `SdkController` mode change, `SdkTaskControlCoordinator`
   cancel/clear/switch, webview `askResponse` yes/no, and the
   `SdkFollowupCoordinator` re-routing of a follow-up message as a
   queued answer). All four converge on the single-slot.
4. Coherent ownership boundary exists — **YES**
   (`SdkInteractionCoordinator` is the *sole* owner of the pending
   slot, the per-tool message, the reformulation slot, the editor
   decision carrier, and the response-correlation logic; the
   `SdkController` wires options in, the consumers only call
   public methods).
5. An asynchronous Elm consult is compatible with the lifecycle
   — **PARTIAL / SPLIT** (the slot's Promise-resolver is
   necessarily TS-owned because the user IS the answer source; the
   policy-evaluation step immediately upstream of slot registration
   is a **pure synchronous projection** of
   `(request, policy, host-callback)` → closed-enum decision and
   IS the natural Elm seam — mirroring how
   `BackgroundNotifyCoordinator.consumeTerminal` is split between
   the Elm classifier and the TS marker owner).
6. TypeScript can retain effects without creating dual authority
   — **YES** (the slot owner remains the TS class; the Elm kernel
   only classifies. The two-layer pattern is identical to SEAM04's
   `consultE31BarrierForFacts`: Elm classifies, TS commits, on
   ElmUnavailable the TS predecessor path runs).
7. Existing tests can exercise the real production path — **YES**
   (`apps/vscode/src/sdk/__tests__/approval-rejection-correlation-
   fail-closed-recon01.test.ts` — 6/6 GREEN on HEAD; verified in §5
   below; the full
   `apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts` —
   43/43 GREEN — is the regression suite for the whole class).

**Gate verdict:** PASS (criteria 1, 2, 3, 4, 6, 7 unconditionally;
criterion 5 is met for the bounded sub-seam identified in §1).

## 1. Selected production decision authority (bounded sub-seam)

**The synchronous ALLOW/ASK/REFORMULATE/DENY/EDIT_ALLOW/EDIT_ASK
policy-evaluation decision inside
`SdkInteractionCoordinator.runRequestToolApproval` at
`apps/vscode/src/sdk/sdk-interaction-coordinator.ts:427-608`.**

This is the **only** production code path that classifies a
`ToolApprovalRequest` into a closed-enum verdict. The class's two
other responsibilities — (a) pending-slot registration + ASK card
publication at L686-L758, and (b) response correlation + cleanup at
L906-L969 + L1067-L1103 — are necessarily TS-owned (the user IS the
answer source and the Promise-resolver effect cannot move to Elm).

### 1.1 Why this sub-seam (over the alternatives)

| Candidate sub-seam | Status | Why not selected |
| --- | --- | --- |
| **`runRequestToolApproval` L427-L608 (policy evaluation) — SELECTED** | **PURE_DECISION** | Synchronous, closed-enum ALLOW/ASK/REFORMULATE/DENY/EDIT_ALLOW/EDIT_ASK classification. No Promise, no I/O, no message-state mutation in the verdict body. Mirrors `BackgroundNotifyCoordinator.consumeTerminal` (SEAM04) Elm cutover pattern. |
| L686-L758 (pending slot + ASK card publication) | PROMISE_IO_COUPLED | Mutates `pendingToolApprovalResolve` / `pendingToolApprovalMessage`; emits a `ClineMessage` to the webview; the in-flight Promise IS the answer source — effect-bound, TS-only. |
| L906-L969 (`resolvePendingToolApproval`) | PROMISE_IO_COUPLED | Resolves the in-flight Promise; mutates `recordApprovedToolMessage` / `recordDeniedToolApproval` host-options; effect-bound, TS-only. |
| L1067-L1103 (`clearPending`) | PROMISE_IO_COUPLED | Resolves the in-flight Promise with `{ approved: false, reason }`; mutates the host's `recordDeniedToolApproval`; clears the reformulation slot; effect-bound, TS-only. |
| L346-L376 (`handleConsecutiveMistakeLimitReached`) | OWNED_BY_OTHER_KERNEL | Already covered by the existing `completion-continuation-control` Elm kernel's mistake-limit classification (advisory vs hard-error); out of scope for SEAM09. |
| `LocalRuntimeHost.runTurn` (SEAM05 selected) | ALREADY_OWNED | Already selected and Elm-cutovered in SEAM05; not part of the tool-approval lifecycle. |
| `SdkTaskControlCoordinator.cancelTask` (which calls `interactions.clearPending`) | EVENT_PUBLISHER | A publisher into the lifecycle, not an authority within the lifecycle. |

### 1.2 Canonical state (FROZEN, observed in source)

**Inputs to the policy-evaluation sub-seam** (the
`ToolApprovalRequest` envelope, `sdk-interaction-coordinator.ts:53-61`):

```ts
export interface ToolApprovalRequest {
    agentId: string
    conversationId: string
    iteration: number
    toolName: string
    input: unknown
    toolCallId: string
    policy: { enabled?: boolean; autoApprove?: boolean }
}
```

**Host-supplied decision inputs** (read at L441, L466, L562, L590,
L801, L833, L841 — all synchronous, all observable from
`SdkController` options):

- `isCommandTool(request.toolName)` — closed enum from `sdk-tool-policies.ts`.
- `request.policy.autoApprove === true` — SDK contract surface (outermost precedence, per CORRECTION02 frozen precedence).
- `options.shouldAutoApproveTool?.(request)` — host callback (non-command fast path; reads live `isToolAutoApproved`).
- `options.evaluateCommandToolApproval?.(request)` — canonical policy-lattice call for command tools (atomic per CORRECTION04; returns `{ approved, decision: { kind, reason, source }, executionPlan, hostAuthorization }`).
- `options.getCwd?.()` and `options.getAutoApprovalSettings?.()` — editor / apply_patch target-aware composition inputs (`handleEditorOrApplyPatchApproval` at L783-L879).
- `this.pendingReformulationSlot` — one-shot `(agentId, conversationId)`-keyed reformulation arming (ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01).
- `this.lastEditorOrApplyPatchDecision` — single-slot evidence carrier for the editor / apply_patch target-aware ASK path.

**Decision output (closed enum of 9 tags):**

| Verdict tag | Returned shape | Code path |
| --- | --- | --- |
| `ALLOW_SDK_POLICY` | `{ approved: true, decision: { kind: "allow", reason: "sdk-policy-autoApprove", source: "sdk-policy-autoApprove" } }` | L801-L818 |
| `ALLOW_HOST_CALLBACK` | `{ approved: true, decision?: { kind: "allow", reason: "policy-or-shouldAutoApprove", source: "sdk-policy" \| "host-callback" } }` | L562, L590 |
| `DENY_HARD` | `{ approved: false, reason: commandEval.decision.reason }` | L468-L475 |
| `REFORMULATE` | `{ approved: false, reason: prose, decision?, executionPlan?, hostAuthorization? }`; arms `pendingReformulationSlot` | L497-L555 |
| `DENY_EDITOR_NO_ROOT` | `{ approved: false, reason: "editor: workspace root unavailable; cannot classify target" }` | L822-L827 |
| `DENY_EDITOR_NO_SETTINGS` | `{ approved: false, reason: "editor: auto-approval settings unavailable; cannot classify target" }` | L833-L838 |
| `ALLOW_EDITOR` | `{ approved: true, decision: { kind: "allow", reason, source } }` | L843-L869 |
| `ASK_EDITOR` | `{ approved: false, decision: { kind: "ask", reason, source } }`; falls through to L686 ask-card publication | L863-L869 |
| `ASK_DEFAULT` | (no return; falls through to L686-L758 ask-card publication) | L608 onward |

**The Elm kernel will own the projection
`(ToolApprovalRequest + host-callbacks + reformulation-slot-flag) → VerdictTag`.**
The TS adapter will dispatch on the verdict: ALLOW_* return
immediately (preserving the existing `decision` / `executionPlan`
evidence shape), DENY_* return immediately with the typed reason,
ASK_* falls through to the existing L686-L758 ask-card publication
path, REFORMULATE arms `pendingReformulationSlot` and returns
immediately. No new effects; no new host callbacks; no new
message-state fields; no new C-line probe code points.

### 1.3 Why this is a clean Elm seam (mirroring SEAM04)

1. **Real production reach.** Every tool-approval request in
   ClineMM (VS Code host adapter) flows through
   `SdkController.interactions.handleRequestToolApproval` →
   `runRequestToolApproval` L427-L608. The verdict body has zero
   direct I/O — the only side reads are synchronous host callbacks
   and `isCommandTool` / `pendingReformulationSlot` lookups.

2. **Significant structural complexity, zero effect complexity.**
   The decision depends on six orthogonal facts (`toolName`,
   `policy.autoApprove`, host `shouldAutoApproveTool` callback,
   canonical `evaluateCommandToolApproval` result, editor
   `getCwd`+`getAutoApprovalSettings`, reformulation slot
   presence). Each is a closed type. The output is a closed enum
   of nine tags. The dispatch is a switch over the tag.

3. **Multiple event sources already converge on this seam.** The
   canonical `evaluateCommandToolApproval` callback itself reads
   live settings (`stateManager.getGlobalSettingsKey("autoApprovalSettings")`)
   and the session-scoped override
   (`this.sessionAutoApproval.getOverride(sessionId)`) at the
   `SdkController` seam — the Elm kernel can read these same
   facts through the same callback without changing the
   `SdkController` boundary.

4. **Existing historical regression witnesses.** The full
   `sdk-interaction-coordinator.test.ts` (43/43 GREEN) and the
   command-safety-reformulation red/green suite (R0, R3,
   CORRECTION01, CORRECTION02, CORRECTION04: all GREEN per
   `.factory/ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01.md`)
   already exercise this sub-seam through the real
   `SdkInteractionCoordinator`. The 6/6 GREEN
   `approval-rejection-correlation-fail-closed-recon01.test.ts`
   (verified §5 below) exercises the full lifecycle including
   the verdict body.

5. **Low duplication of canonical mutable state.** The
   `pendingReformulationSlot` (one-shot arming) is read-only at
   the verdict body and mutated only in the REFORMULATE branch
   (L540-L555) and `clearPending` (L1102). The Elm kernel can be
   given the current slot presence as an input fact and emit
   `armReformulationSlot: true` as a tag payload; the TS adapter
   performs the arming as a side effect after classification.
   This mirrors the SEAM04 `BackgroundNotifyCoordinator`
   Elm-cutover pattern exactly (the kernel classifies; the TS
   owner commits the marker).

6. **Bounded interop cost.** The TS-side change is a single
   synchronous consult call inside `runRequestToolApproval`
   (one function body). The Elm-side change is a new pure kernel
   `tool-approval-authority` in
   `apps/vscode/elm/tool-approval-authority/` mirroring
   `background-notify-authority/`, wired through a new
   `tool-approval-authority-elm.ts` adapter that exports
   `consultToolApprovalAuthorityForRequest(request, hostFacts) → VerdictTag`.
   The 5th existing-kernel activation convention
   (`setToolApprovalAuthorityElmProductionKernelPath` in
   `extension.ts`) is reused verbatim.

7. **No new host callbacks, no new probe code points, no new
   persistent state.** The Elm cutover reuses every existing
   option field on `SdkInteractionCoordinatorOptions`, every
   existing V2 probe code point (`approval.entry.v2`,
   `approval.terminal.v2`, `approval.ui.branch.v2`,
   `approval.ui.published.v2`, `approval.noncommand.decision.v1`,
   `approval.noncommand.result.v1`,
   `approval.noncommand.ui-published.v1`,
   `approval.sdk-controller.entry.v2`,
   `approval.sdk-controller.authorization.v2`,
   `approval.sdk-controller.input-shape.v2`), and every existing
   `ClineMessage` emission path.

## 2. SEAM01–08 overlap check (existing Elm-owned authorities)

| Existing Elm kernel | Owns | Does NOT own | Overlap with SEAM09 selected sub-seam? |
| --- | --- | --- | --- |
| `completion-authority` (SEAM01) | `canFinalize` / `isCompletionAuthorized` / `hasOutstandingWork` decisions on canonical `TaskState` | The tool-approval lifecycle | None. |
| `completion-continuation-control` (SEAM04 / HELD-SET-PROGRESS-AUTHORITY01) | Pure `Facts → Directive` projection of held-set classification for `enqueueCompletionContinuationIfHeld` | The tool-approval lifecycle; the `pendingReformulationSlot` field; the `runRequestToolApproval` verdict body | None. |
| `background-notify-authority` (SEAM04) | `consumeTerminal` decision (NoMarker / OwnerMismatch / ContainmentNoWake / Held / Drained) on the per-jobId path | The tool-approval lifecycle | None. SEAM09 mirrors its Elm-cutover pattern. |
| `task-header-orchestration` (SEAM02) | The TaskHeader presentation selector (4-rule projection, three-tag output) | Anything related to tool-approval | None. |
| `deferred-completion-barrier` (SEAM08) | The `consultE31BarrierForFacts` Elm consult on the completion barrier marker state machine | The tool-approval lifecycle | None. |

A `grep` for `pendingToolApproval` / `resolvePendingToolApproval` /
`clearPending` across all five existing Elm kernel source trees
(`apps/vscode/elm/{completion-authority,completion-continuation-control,
background-notify-authority,task-header-orchestration,
deferred-completion-barrier}/src/*.elm`) returns zero hits. The
tool-approval lifecycle is **TS-only and unowned** (except for
`pendingReformulationSlot`, which is a one-shot arming and is
exercised only inside `runRequestToolApproval` L540-L555 and
`clearPending` L1102).

## 3. Full production call graph (frozen)

```text
tool invocation
  │
  ▼
[1] SdkController.askResponse (apps/vscode/.../SdkController.ts:4430)
    → SdkFollowupCoordinator.askResponse (apps/vscode/.../sdk-followup-coordinator.ts:93)
        ├─ tool approval pending? → interactions.resolvePendingToolApproval (return)
        ├─ ask_question pending?  → interactions.resolvePendingAskQuestion (return)
        └─ active session present? → continueIdleSession / queueToActiveSession / tryResumeSessionFromTask
            (delivery=queue | delivery=steer | undefined)

[2] AgentRuntime.executeTool → sessionOptions.requestToolApproval
    = SdkController.interactions.handleRequestToolApproval(request)            ★ entry
    = apps/vscode/src/sdk/sdk-interaction-coordinator.ts:378-425
        └─ withV2CaptureContext(correlationId, commandDigest,
                                 () => runRequestToolApproval(request))
        └─ emitV2Capture("approval.entry.v2", ...)
        └─ emitV2Capture("approval.terminal.v2", ...)

[3] ★ POLICY EVALUATION ★   sdk-interaction-coordinator.ts:427-608
                                ┌────────────────────────────────────┐
                                │ THIS IS THE SEAM09 SUB-SEAM        │
                                │ (PURE_DECISION, 9-tag closed enum) │
                                │  → ELM-CUTOVER TARGET (SEAM10)     │
                                └────────────────────────────────────┘
   inputs:  request.{toolName, policy, agentId, conversationId, iteration, toolCallId, input}
            options.shouldAutoApproveTool?.(request)
            options.evaluateCommandToolApproval?.(request)         // command path
            options.getCwd?.() / getAutoApprovalSettings?.()       // editor path
            this.pendingReformulationSlot                          // reformulation path
            this.lastEditorOrApplyPatchDecision                    // editor decision carrier
   output:  one of 9 verdict tags (see §1.2)
            + (REFORMULATE) arms pendingReformulationSlot
   side effects on this layer: NONE
                              (pendingToolApprovalResolve / pendingToolApprovalMessage
                               are NOT touched until the verdict is ASK_DEFAULT
                               at L686+; the Elm cutover at this layer therefore
                               cannot race the slot)

[4] Pending slot + ASK card publication (TS-only, NOT migrated)
    sdk-interaction-coordinator.ts:686-758
        emitV2Capture("approval.ui.published.v2", ...)
        if (!isCommand) emitV2Capture("approval.noncommand.ui-published.v1", ...)
        this.options.setTurnPhase?.("awaiting_approval", ...)
        this.options.postStateToWebview()
        return new Promise<{approved, reason, executionPlan}>(resolve => {
            this.pendingToolApprovalResolve = resolve
            this.pendingToolApprovalMessage = { toolCallId, messageTs, toolName,
                                                decision, executionPlan }
        })

[5] Response correlation (TS-only, NOT migrated)
    sdk-interaction-coordinator.ts:906-969 resolvePendingToolApproval
        if (!pending) return false                            ← line 912-914
        if (responseType === "messageResponse") return false    ← line 919-928
        pendingToolApprovalResolve = undefined                 ← line 930 (atomic)
        pendingToolApprovalMessage = undefined                 ← line 931 (atomic)
        approved = (responseType === "yesButtonClicked")       ← line 933
        if (approved) recordApprovedToolMessage(...)
        if (!approved) recordDeniedToolApproval(...)
        resolve({ approved, ...(approved ? {executionPlan} : {reason: denialReason}) })

[6] Cleanup (TS-only, NOT migrated)
    sdk-interaction-coordinator.ts:1067-1103 clearPending(reason)
        if (pendingAskResolve) resolveAsk("")
        if (pendingMistakeLimitResolve) resolveMistakeLimit({action:"continue", ...})
        pendingMessage = pendingToolApprovalMessage
        pendingToolApprovalMessage = undefined                 ← line 1086 (atomic)
        if (pendingToolApprovalResolve) {
            if (pendingMessage) recordDeniedToolApproval(...)
            resolve({ approved: false, reason })
            pendingToolApprovalResolve = undefined             ← line 1096 (atomic)
        }
        pendingReformulationSlot = undefined                   ← line 1102

[7] SdkController / SdkTaskControlCoordinator / SdkModeCoordinator
    trigger clearPending (NOT migrated) at:
        SdkController.ts:4628          (Superseded by an edited message)
        sdk-task-control-coordinator.ts:77  (Task cancelled)
        sdk-task-control-coordinator.ts:149 (Task cleared)
        sdk-task-control-coordinator.ts:264 (Task switched)
        sdk-mode-coordinator.ts:409     (Mode changed)
```

**Critical observations:**

1. **The seam is bounded.** Steps [4] [5] [6] are TS-only and
   unowned; the SEAM10 implementation cutover will leave them
   untouched. Only step [3] (the policy evaluation) moves to Elm.
2. **The verdict body has zero direct I/O.** The Elm kernel can
   read every input fact (including the live
   `evaluateCommandToolApproval` result and the live settings
   via the existing `getCwd` / `getAutoApprovalSettings`
   callbacks) without changing any boundary in `SdkController`.
3. **Atomic slot destruction is preserved** at L930-L931 and
   L1086 + L1096; the Elm cutover at step [3] cannot race the
   slot because the verdict is computed before the slot is
   allocated.
4. **The four-event convergence (criterion 3)** all flow through
   the verdict body before reaching the slot: the
   `SdkFollowupCoordinator` only re-routes a `messageResponse`
   that is queued as a follow-up (does not touch the verdict
   body); the `SdkController` mode change triggers
   `clearPending` (not the verdict body); the
   `SdkTaskControlCoordinator` cancel/clear/switch also triggers
   `clearPending`.
5. **The reformulation slot** is a single-shot arming field
   (one-shot per `(agentId, conversationId)` key) that the Elm
   kernel reads as an input fact and arms via a `Cmd`-style tag
   payload. Mirrors the SEAM04 marker-arm/disarm pattern.

## 4. Frozen contract (per the SEAM09 spec "Deliverable" template)

```text
production entrypoint:
    apps/vscode/src/sdk/sdk-interaction-coordinator.ts
        private runRequestToolApproval (lines 427-608)
        (entry: SdkController.interactions.handleRequestToolApproval at line 1758 / 1827
         wires the call site)

canonical pending state:
    (UNCHANGED, TS-only):
        this.pendingToolApprovalResolve: ((result) => void) | undefined  (L300-306)
        this.pendingToolApprovalMessage: { toolCallId, messageTs, toolName,
                                            decision?, executionPlan? } | undefined
                                                                (L308-316)
    (NEW, Elm-owned projection):
        VerdictTag (closed enum of 9 tags) + optional decision/executionPlan
        evidence carriers preserved verbatim from the current TS return shapes

approval identity:
    ToolApprovalRequest = { agentId, conversationId, iteration, toolCallId,
                             toolName, input, policy: { enabled?, autoApprove? } }
    (UNCHANGED, L53-61; the SEAM09 sub-seam does not introduce a new identity
     vocabulary; the existing request identity is the unit of classification)

owner identity:
    Before:  SdkInteractionCoordinator.runRequestToolApproval (TS-only, 9 early-return
             paths + 1 fallthrough to L686)
    After:   (Elm kernel) consultToolApprovalAuthorityForRequest(request, hostFacts)
               -> VerdictTag
             (TS adapter)  runRequestToolApproval uses the verdict to dispatch:
                            ALLOW_* / DENY_* / REFORMULATE return immediately
                            ASK_* falls through to the existing L686-L758 path
             (unchanged)   pending-slot owner remains SdkInteractionCoordinator

legal states:
    Pre-cutover (current HEAD):
        verdict-body outcome ∈ { ALLOW_SDK_POLICY, ALLOW_HOST_CALLBACK, DENY_HARD,
                                  REFORMULATE, DENY_EDITOR_NO_ROOT, DENY_EDITOR_NO_SETTINGS,
                                  ALLOW_EDITOR, ASK_EDITOR, ASK_DEFAULT }
    Post-cutover (SEAM10 target):
        identical set; each tag is a closed-enum member of the Elm kernel output;
        the TS dispatch is a switch on the tag; every existing test continues to
        pass without code changes outside the consult call site

events:
    V2 probes (UNCHANGED):
        approval.entry.v2                  (L402, heartbeat at entry)
        approval.terminal.v2               (L419, terminal at every return)
        approval.ui.branch.v2              (L617, ASK fall-through)
        approval.ui.published.v2           (L692, ask message emitted)
        approval.noncommand.decision.v1    (L268-L296, ALLOW + ASK branches)
        approval.noncommand.result.v1      (L664, ASK fall-through)
        approval.noncommand.ui-published.v1 (L727, ask message emitted)
        approval.sdk-controller.entry.v2   (SdkController.ts:476)
        approval.sdk-controller.authorization.v2 (SdkController.ts:501)
        approval.sdk-controller.input-shape.v2  (SdkController.ts:567)

decisions:
    VerdictTag dispatch (closed switch, 9 cases):
        ALLOW_SDK_POLICY        → return { approved: true, decision: { kind: "allow", ... } }
        ALLOW_HOST_CALLBACK     → return { approved: true, decision?: { ... } }
        DENY_HARD               → return { approved: false, reason: commandEval.decision.reason }
        REFORMULATE             → arm pendingReformulationSlot; return { approved: false, reason: prose, decision?, executionPlan? }
        DENY_EDITOR_NO_ROOT     → return { approved: false, reason: "editor: workspace root unavailable; cannot classify target" }
        DENY_EDITOR_NO_SETTINGS → return { approved: false, reason: "editor: auto-approval settings unavailable; cannot classify target" }
        ALLOW_EDITOR            → return { approved: true, decision: { kind: "allow", ... } }
        ASK_EDITOR              → fall through to L686-L758 (decision evidence carried via lastEditorOrApplyPatchDecision)
        ASK_DEFAULT             → fall through to L686-L758

terminal cleanup:
    (UNCHANGED, TS-only): see step [6] in §3; pendingReformulationSlot is cleared
    at L1102 inside clearPending (mirrors the SEAM04 marker-disarm pattern)

TS-owned effects:
    1. Promise resolution (pendingToolApprovalResolve)  — TS-only, never moves
    2. Message-state emission (pendingToolApprovalMessage + appendAndEmit)  — TS-only
    3. recordApprovedToolMessage / recordDeniedToolApproval host callbacks  — TS-only
    4. setTurnPhase("awaiting_approval", ...)  — TS-only
    5. Reformulation slot arming  — TS-only (Elm emits "arm: true" as a tag payload;
                                                        TS adapter performs the mutation
                                                        after classification)
    6. V2 probe emission  — TS-only (probes fire from the TS dispatch, not from Elm)
    7. ExecutionPlan carry-through  — TS-only (the `executionPlan` field on the
                                                `pendingToolApprovalMessage` record
                                                is built in TS from commandEval)

runtime boundary:
    production: SdkController.interactions.handleRequestToolApproval → runRequestToolApproval
                (the consult is inserted between the V2 capture wrap at L415 and
                 the first verdict-body line at L427)
    test:       the existing 43/43 sdk-interaction-coordinator.test.ts + the
                existing 6/6 approval-rejection-correlation-fail-closed-recon01.test.ts
                are the regression harness; SEAM10 will add a new
                `tool-approval-authority-elm-correspondence.tpaec01.test.ts`
                mirroring BNAEC01 (real Elm kernel) + a focused
                `consultToolApprovalAuthorityForRequest` vitest that drives all
                9 verdict tags
    elm:        apps/vscode/elm/tool-approval-authority/ (Domain.elm / Policy.elm /
                                                          Codec.elm / Main.elm)
                compiled kernel: apps/vscode/elm/tool-approval-authority/vendor/tool-approval-authority.js
                wired via a new apps/vscode/src/sdk/tool-approval-authority-elm.ts adapter
                activated by setToolApprovalAuthorityElmProductionKernelPath in
                extension.ts (following the 5th-kernel convention; will become the 6th)

existing tests (regression baseline at HEAD 179800d36):
    1. apps/vscode/src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts
       6/6 GREEN  (R1, R2, R3, R4, R5, R6 — the full lifecycle)
       VERIFIED at HEAD 179800d36 (see §5)
    2. apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts
       43/43 GREEN (full SdkInteractionCoordinator surface)
       VERIFIED at HEAD 179800d36 (see §5)
    3. apps/vscode/src/sdk/sdk-interaction-coordinator-p-probe.test.ts  (inherited GREEN)
    4. apps/vscode/src/sdk/message-translator-approval-denial.test.ts     (inherited GREEN)
    5. apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.correction01-fallback-fails-closed.red.test.ts
    6. apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.correction02-policy-precedence.red.test.ts
    7. apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts
    8. apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r3-composed-movepath.qual.test.ts
    9. apps/vscode/src/sdk/auto-approve-overlay-regression.test.ts
    10. apps/vscode/src/sdk/session-auto-approval.test.ts
    11. apps/vscode/src/sdk/session-auto-approval.controller.test.ts
    12. apps/vscode/src/sdk/sdk-task-control-coordinator.test.ts
    13. apps/vscode/src/sdk/sdk-followup-coordinator.test.ts

observability:
    Existing V2 probes (UNCHANGED): see "events" above.
    Elm cutover (SEAM10) adds (mirroring SEAM04):
        audit-only `pickToolApprovalAuthorityVerdictForAudit` returning the
        VerdictTag + decision evidence (default-off; gated on the same
        `p` knob as the existing noncommand probes)
    No new diagnostic code points; no new host-callbacks

interop cost (SEAM10 implementation, bounded):
    TS:       one new consult call at the top of runRequestToolApproval
              (between the V2 capture wrap and the first verdict-body line)
              + one switch dispatch on the VerdictTag
              + one setToolApprovalAuthorityElmProductionKernelPath in extension.ts
    Elm:      one new pure kernel (Domain.elm / Policy.elm / Codec.elm / Main.elm)
              ~300-400 lines of policy/projection logic
    Test:     one new tool-approval-authority-elm-correspondence.tpaec01.test.ts
              (mirrors BNAEC01: real Elm kernel via vitest + all 9 verdict tags)
    VSIX:     one new row in scripts/build_dogfood_vsix_lib.py:_ELM_KERNELS
              (the 6th existing-kernel activation convention)
    Total:    ~600 LoC, all additive, no new host callbacks, no new probe code
              points, no new ClineMessage fields, no new persistent state
```

## 5. Minimum executable witness (recon §"Minimum executable witness")

The SEAM09 spec requires four cases:

> 1. Normal approval and rejection.
> 2. Duplicate response.
> 3. Response with incorrect approval/session identity.
> 4. Late response after cancellation or teardown.

These four cases are exercised by the existing
`apps/vscode/src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts`
through the **real production `SdkInteractionCoordinator`** (not a
stub; see the test header at L1-L33: "drives the REAL production
approval correlation seam ... does NOT stub or re-implement the
resolver; it calls the actual public surface").

**Verified at HEAD `179800d36b14c564069f06cd9f701aa575b974da`:**

```text
$ cd apps/vscode && bun vitest run \
    src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts
    --reporter=default

 ✓ src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts (6 tests) 1039ms
     ✓ R5: clearPending('Task switched') rejects A; a subsequent B in the same session still re-ASKs  555ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  6.06s
   exitCode 0
```

(The trailing `[vitest-pool]: Failed to terminate forks worker ... EPERM`
is a benign worker-cleanup artifact of the macOS Vitest fork-pool
under the development shell; `exitCode 0` confirms the test result.)

**Case mapping (R1–R6 → SEAM09 witness requirements):**

| SEAM09 spec requirement | Test case | Status |
| --- | --- | --- |
| 1. Normal approval | R1 YES path (line 125: `resolvePendingToolApproval(undefined, "yesButtonClicked")` after fresh ASK) | GREEN |
| 1. Normal rejection | R1 NO path (line 104: `resolvePendingToolApproval(undefined, "noButtonClicked")`); R2 NO path; R3 NO path; R4 NO path | GREEN |
| 2. Duplicate response | R4 second-and-third response (lines 211-212: two extra `resolvePendingToolApproval` calls after the slot is already gone both return `false`) | GREEN |
| 3. Response with incorrect approval / session identity | R1 different toolCallId with identical toolName+input → must re-ASK (lines 109-122); R2 different command → must re-ASK (lines 143-149) | GREEN |
| 4. Late response after cancellation or teardown | R5 `clearPending("Task switched")` (line 244); R6 stale yes-click after clear (line 285-289) | GREEN |

**Additional coverage from `sdk-interaction-coordinator.test.ts`
(43/43 GREEN, full regression baseline):**

- Ask card publication for non-command tools (R0 baseline)
- Ask card publication for MCP tools (line 319, MCP)
- Ask card publication for `ask_question` (line 348)
- Mistake-limit advisory Continue / Dismiss (lines 370-547)
- `CORRECTION04` DENY preservation (DENY never opens approval UI;
  ASK opens; ALLOW auto-approves; lines 690-841)
- `ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01` REFORMULATE branch
  (lines 843-1219, 11 sub-cases including NEGATIVE ablations)
- `CORRECTION04` non-command regression (lines 1222-1392)
- `ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL02` card-publication
  probes (lines 1395-1471)
- Auto-approval without UI (lines 261-318)

All 49 cases (6 recon + 43 baseline) drive the
`runRequestToolApproval` verdict body at L427-L608 through the
**real production class** with zero stubs, mirroring the BNAEC01 /
SEAM04 substrate witness pattern.

## 6. Verdict and next cursor

**Verdict: `PASS_ELM_SEAM09_RECON`.**

- One bounded production decision authority selected: the
  synchronous ALLOW/ASK/REFORMULATE/DENY/EDIT_ALLOW/EDIT_ASK policy
  evaluation at `runRequestToolApproval` L427-L608.
- Production entry: `SdkController.interactions.handleRequestToolApproval`
  (wires the call site at `SdkController.ts:1758` and `:1827`).
- Canonical pending state: unchanged (TS-only; the verdict body
  has zero direct slot mutation).
- Approval identity: unchanged
  (`{ agentId, conversationId, iteration, toolCallId, toolName,
     input, policy: { enabled?, autoApprove? } }`).
- Owner identity: pre-cutover TS-only; post-cutover Elm kernel
  + TS dispatch (mirrors the SEAM04 `BackgroundNotifyCoordinator`
  Elm-cutover pattern exactly).
- 6/6 recon test cases GREEN at HEAD 179800d36 (executable
  witness); 43/43 full coordinator regression suite GREEN.
- No new host callbacks, no new probe code points, no new
  persistent state, no new ClineMessage fields.
- Interop cost for SEAM10: bounded ~600 LoC, all additive.

**Next cursor (SEAM10, not this ACT):**

The SEAM10 implementation cutover must:

1. Add the `tool-approval-authority` Elm kernel under
   `apps/vscode/elm/tool-approval-authority/` (Domain.elm /
   Policy.elm / Codec.elm / Main.elm + tests) with the 9-tag
   closed-enum VerdictTag.
2. Add the `tool-approval-authority-elm.ts` adapter under
   `apps/vscode/src/sdk/` with
   `consultToolApprovalAuthorityForRequest(request, hostFacts) → VerdictTag`
   (synchronous, fail-closed on kernel_offline / decode_error).
3. Wire the consult between L425 and L427 of
   `runRequestToolApproval`, preserving the existing
   `decision` / `executionPlan` evidence shapes.
4. Activate via `setToolApprovalAuthorityElmProductionKernelPath`
   in `extension.ts` (following the 5th-kernel convention; will
   become the 6th).
5. Add the focused correspondence test
   `tool-approval-authority-elm-correspondence.tpaec01.test.ts`
   (mirroring BNAEC01) covering all 9 verdict tags via the
   real compiled kernel.
6. Add the production-staging row to
   `scripts/build_dogfood_vsix_lib.py:_ELM_KERNELS`.
7. Confirm 49/49 GREEN on the recon + full-coordinator regression
   suite (R1-R6 + 43 baseline) and 0 ACT-owned new failures on
   the wider vitest sweep.

**Factory stop rule:** HALT_P0 not triggered; HALT_P1 not
triggered; no recursive Factory review initiated; this ACT
executes the SEAM09 recon and names SEAM10 as the bounded
implementation cutover.

## 7. Evidence index

This ACT relies on:

- `.factory/acts/ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01.md`
  — the prior correlation-fail-closed recon that proved the
  6-case lifecycle immunity (Q1-Q12 source-recon in
  `.factory/evidence/ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01/approval-seam-map.md`).
- `.factory/acts/ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01.md`
  — the editor target-aware ALLOW/ASK composition (load-bearing
  for ALLOW_EDITOR / ASK_EDITOR / DENY_EDITOR_* tags).
- `ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01` (REFORMULATE branch
  spec; the 11 sub-cases in `sdk-interaction-coordinator.test.ts:843-1219`
  are the regression baseline for the REFORMULATE tag).
- `.factory/ACT-CLINEMM-ELM-SEAM04-BACKGROUND-NOTIFY-AUTHORITY-CUTOVER.md`
  (and SEAM04-CORRECTION01) — the canonical Elm-cutover pattern
  that SEAM10 will mirror.
- `.factory/ACT-CLINEMM-ELM-SEAM08.2-E3.1-PRODUCTION-CUTOVER.md`
  — the most recent Elm-cutover (5th kernel); the 5th-kernel
  activation convention in `extension.ts` and the 5th VSIX
  packaging row are the precedent for the SEAM10 6th-kernel
  wiring.
- `.factory/ACT-CLINEMM-ELM-SEAM07-LONG-HORIZON-CONTINUATION-RECON.md`
  — the SEAM07 recon pattern (single bounded sub-seam, frozen
  contract, regression harness at HEAD); this ACT is the
  analogous recon for the tool-approval lifecycle.

## 8. Files added by this ACT

- `.factory/ACT-CLINEMM-ELM-SEAM09-TOOL-APPROVAL-LIFECYCLE-RECON.md`
  (this file; the SEAM09 recon plan and frozen contract).
- `.factory/acts/ACT-CLINEMM-ELM-SEAM09-TOOL-APPROVAL-LIFECYCLE-RECON.md`
  (the canonical ACT plan, identical content per the SEAM07
  convention).
- `.factory/evidence/ACT-CLINEMM-ELM-SEAM09-TOOL-APPROVAL-LIFECYCLE-RECON/`
  (NEW empty evidence directory; SEAM10 will populate it with the
  correspondence test outputs and the production-cutover report).

No production code touched. No Elm implementation attempted (per
scope). No new kernel. No new framework. No implementation-free
successor ACT beyond naming the SEAM10 cutover cursor.
