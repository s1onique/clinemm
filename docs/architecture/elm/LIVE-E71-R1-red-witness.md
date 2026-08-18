# LIVE-E71-R1 RED Witness — Post-Terminal Authority Split

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01**

This is the frozen RED witness artifact for the actual installed-VSIX dogfood
walk that exposed the post-terminal authority split. The reviewer captured
three screenshots against the installed build `4.1.10-6a4cfe564` (the
SUBJECT_HEAD feat-binding). The screenshots are taken sequentially; they
are *not* literally the same instant. They are framed as:

```text
LIVE_E71-R1 = SAME_TASK / SAME_POST_TERMINAL_STABLE_STATE
```

The actual same-push / same-logical-instant evidence is what the next ACT
(POST_TERMINAL_AUTHORITY_SPLIT_TRIAGE01) will produce.

---

## 1. Identity (binding-confirmed)

```text
SUBJECT_HEAD         = 6a4cfe564b1f685212528a0d9d77ddf400732abd
                       feat(elm): E7.1 cut Local Thinking consumers to shadow projection
INSTALLED_VERSION    = 4.1.10-6a4cfe564   (matches SUBJECT_HEAD)
VSIX                 = dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix
VSIX_SHA256          = 266b5aa4b4d65aa3c116f8166244bae8b53850c1f8d83f1666b72add5772a5a1
VSIX_SIZE            = 8,879,762 bytes
VSIX_MTIME           = Aug 18 23:43
```

The VSIX encodes the SUBJECT_HEAD SHA. The T14 install-binding is confirmed
PASS. The T15 real-dogfood check is FAIL.

## 2. Frozen screenshot observations

```text
INSTALL_BINDING      = PASS      (4.1.10-6a4cfe564 visible in the installed extension panel)

SESSION              = one LOCAL task, streamed to completion, followed by a single follow-up user prompt.

ASSISTANT_FINAL_VISIBLE = true   (the assistant final report is the last clineMessage in the chat list)

TASK_HEADER          = Idle / 00:00 / 0
  task_header_phase     = Idle
  task_header_elapsed   = 00:00
  task_header_tool_count = 0

CHAT_PRESENTATION    = static "Thinking" reason row STILL RENDERED
  static_thinking_visible  = true
  static_thinking_animated = false        (NEW failure mode; the OLD animated "Thinking..." shimmer is no longer present)
  animated_shimmer_for_LIVE02 = NOT_OBSERVED_IN_THIS_SMOKE

COMPOSER             = text enterable, submit not sendable
  next_prompt_text_enterable = true
  next_prompt_sendable       = false

FOLLOWUP_TRACE       = (must be captured at the same instant by the diagnostic — the screenshots do not show the chain of attempted submits)
```

## 3. Honest old-symptom classification

```text
OLD_THINKING_ELLIPSIS_STALE = NOT_OBSERVED_IN_THIS_SMOKE
```

This is the honest wording. The original animated-shimmer failure is not
visible in the reviewer's screenshots. But one live walk is not sufficient
to declare the original failure FIXED under all paths. The honest qualifier
"not observed in this smoke" is what the diagnostic must pin.

The NEW failure mode is the static "Thinking" disclosure that survives
after the assistant final report. This is a different render site than the
animated shimmer (separate component, different state affordance), and it
is **not** the symptom the original E7.1 cutover was designed to kill.

## 4. Tightenings

### 4.1 Not predeclaring the OLD symptom fixed

One walk is enough to prove the NEW failure exists. It is not enough to
prove the OLD one is gone under all paths. The honest wording is
`NOT_OBSERVED_IN_THIS_SMOKE`, not `PASS`.

### 4.2 Extension-vs-webview correlation

The screenshots are evidence of disagreement but not of *where* the
disagreement originates. The diagnostic must capture both sides of the
boundary with the same `pushId` to distinguish origin categories:

```text
producer defect              = UNRESOLVED
transport/order defect       = UNRESOLVED
replica reducer defect       = UNRESOLVED
consumer selector defect     = UNRESOLVED
```

### 4.3 Composer reason capture (not just `disabled = true`)

The composer disablement is a *conjunction* of three signals. The diagnostic
must capture the exact production expression and the binding contributor:

```text
Raw local state:
  sendingDisabled
  source: useChatState.ts:18 (useState(false))
  writers:
    ActionButtons.tsx:64  setSendingDisabled(buttonConfig.sendingDisabled)
    useMessageHandlers.ts:483  setSendingDisabled(false)  (rollback path)

Derived config:
  buttonConfig.sendingDisabled
  source: buttonConfig.ts
  consumer: buttonsForPhase(turnState, anchored) returns BUTTON_CONFIGS[phase]

Phase gate:
  allowsQueuedSubmit(turnState)
  source: turnStateSelectors.ts:80-85
  returns: turnState.phase === "streaming" || turnState.phase === "awaiting_approval"

RENDERABLE composer-disabled predicate (the EXACT production expression):
  InputSection.tsx:62
    const submitDisabled = sendingDisabled && !allowQueuedSubmit
  InputSection.tsx:94
    <ChatTextArea sendingDisabled={submitDisabled} ... />
```

The post-terminal walk shows phase `idle`. Then `allowQueuedSubmit` is
`false`. The bind reduces to `submitDisabled = sendingDisabled`. The
diagnostic must capture `sendingDisabled` plus `buttonConfig.sendingDisabled`
plus the `pendingResponse` flag to distinguish Case A (buttonConfig wrong)
from Case I (chat reducer stuck).

### 4.4 Multi-instant framing

The screenshots are taken sequentially. They are SAME_TASK /
SAME_POST_TERMINAL_STABLE_STATE but not literally a single instant. The
diagnostic produces the literal single-instant evidence.

## 5. Failure-mode taxonomy and reviewer's prior

The reader-visible failure is a **post-terminal authority split**: three
subsystems (TaskHeader, ChatRow reasoning row, composer) reading three
different states for one logical instant.

The reviewer's prior against the screenshots (noted as a non-authoritative
prior, to be falsified by the diagnostic):

```text
WORKING_PRIOR = A + C OR I
  A  composer selector defect
  C  reasoning-row presentation semantics defect
  I  webview-local reducer stuck state (sendingDisabled=true after a prior submit, never unlocked)
```

The diagnostic must produce evidence for one (or a hybrid) before any
repair is authorized.

## 6. Follow-up trace unknowns

The screenshots do not show the chain of attempted submits. The diagnostic
must capture, at the same instant as the screenshot freeze-frame:

```text
followup.canSubmit       (final output of the submit path)
followup.route           (which branch ran: clineAsk / turnAllowsFollowup / new task)
pendingResponse          (useChatState present? cleared?)
pendingUserMessage       (useChatState present? cleared?)
```

## 7. Out of scope for this ACT

```text
- Migrating TaskHeader to the thinkingPresentation projection.
  (TaskHeader is currently a witness; migrating it would erase the diagnostic state.)

- Modifying the composer selector to bypass turnState.
  (Composer is a witness; bypassing it would erase the diagnostic state.)

- Modifying selectThinkingPresentation.
  (The projector may not be the cause; speculation has cost.)

- Modifying buttonConfig.
  (The button set may not be the cause.)

- Modifying useChatState / sendingDisabled.
  (The chat reducer may not be the cause.)

- ANY writer-side change to turnStateTracker.
  (Legacy writers may not be the cause.)

- Author-side changes to the canonical event subscription.
  (E2F-F1 is closed; re-opening it would be a regression.)
```

## 8. Trust binding

This witness is bound to the SUBJECT_HEAD VSIX subject. It does NOT
re-open the closure-correction commit (`81f82f471`). The closure
correction is still QUALIFIED_PARTIAL; this witness opens a NEW ACT
adjacent to it.

The two protected stashes (`FORENSIC` 141372c52 and `CONTEXT-ACCOUNTING`
371752f71) are intact and untouched by this witness.
