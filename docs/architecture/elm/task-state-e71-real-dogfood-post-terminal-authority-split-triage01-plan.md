# E7.1 Real-Dogfood — Post-Terminal Authority-Split Triage 01 — PLAN

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01**

This is a **diagnostic-only** ACT. The closure-correction commit (`81f82f471`)
admitted that the real installed-VSIX path was not proven and that T15 was not
executed. The reviewer ran that path. The result is RED with a NEW failure mode
that did not exist in the prior LIVE02 walk:

```text
OLD failure (LIVE02, pre-E7.1):
  animated "Thinking..." shimmer stayed after the assistant final report
  → shimmer_kill_migration moved the kill onto the canonical turnState flip,
    the live walk proves the shimmer no longer animates post-terminal.

NEW failure (LIVE-E71-R1, post-E7.1):
  the animated shimmer is gone (good), but a STATIC "Thinking" row is still
  rendered after the assistant final report, while the TaskHeader reads
  "Idle / 00:00 / 0" and the composer refuses the next prompt.
```

The NEW failure is a **post-terminal authority split**: three subsystems
(TaskHeader, ChatRow reasoning row, composer) read three different states for
the same logical instant of "task is finished." The E7.1 cutover migrated only
the Thinking-renderer consumers; the TaskHeader, composer, and follow-up
routing were deliberately left behind (see
`task-state-e71-webview-shadow-projection-consumer-inventory.md` §6:

> "Other consumer rows (button set, composer lockout, follow-up routing, etc.)
> are explicitly NOT touched."

The real walk proved that "NOT touched" is not a safe boundary for this bug
state. The split happens *through* the cut, not around it.

This ACT refrains from any repair. It captures the authority surface at the
failing instant, correlates what the extension produced with what the webview
received, and identifies the first boundary where the views diverge.

---

## 1. Mission

```text
MISSION =
At the first stable post-terminal state after a LOCAL task completes,
capture and correlate the extension-produced state, the webview-received
state, the webview replica state, and every selector controlling:

  - Thinking presentation
  - TaskHeader telemetry
  - composer sendability
  - follow-up routing

Identify the FIRST authority boundary where those outputs diverge.

NO repair is authorized in this ACT.
```

## 2. Frozen entry state

```text
E7.1_IMPLEMENTATION                     = PARTIAL_QUALIFIED

## 3. Authority surface (for the diagnostic)

The post-terminal state is read by four consumers. The diagnostic MUST capture
all four authorities plus the shadow / runtime witnesses in the SAME push.

| # | Consumer                            | Authority field(s)                       | Source                    |
|---|-------------------------------------|------------------------------------------|---------------------------|
| 1 | TaskHeader state label              | `turnState.phase`                        | `taskHeaderStateLabel`    |
| 2 | TaskHeader elapsed                  | `taskTelemetry.startedAt` / `.endedAt`   | `resolveElapsedDisplayMs` |
| 3 | TaskHeader tool count               | `taskTelemetry.toolCalls`                | host-cumulative           |
| 4 | ChatRow reasoning row (static)      | `thinkingPresentation.modelStreaming`    | `selectThinkingPresentation` |
| 5 | Composer text-area enterable        | `turnState.phase` (no gate, always enterable) | `InputSection.tsx`        |
| 6 | Composer sendable (submit button)   | `sendingDisabled` (chat reducer) AND `turnState.phase in {streaming, awaiting_approval}` via `allowsQueuedSubmit` | `InputSection.tsx:62` |
| 7 | Follow-up send-to-active-session    | `turnAllowsFollowup(turnState)`          | `useMessageHandlers.ts:277` |
| 8 | Button set (currently rendered)     | `buttonsForPhase(turnState, anchored)`   | `buttonConfig.ts:394`     |

The shadow / runtime / seq checkpoints:

| # | Source                                  | Why it matters                                     |
|---|-----------------------------------------|----------------------------------------------------|
| A | `turnStateTracker.currentPhase`         | legacy phase source for consumers 1, 5, 6, 7, 8    |
| B | `turnStateTracker.get().seq`            | webview replica seq-gating                         |
| C | `selectThinkingPresentation` inputs     | consumer 4                                         |
| D | `getLocalShadowProjection()` (ArbiterSnapshot) | shadow witness for the post-terminal flip    |
| E | Runtime snapshot (`AgentRuntime.snapshot().status`) | truth source upstream of the tracker       |
| F | Last observed canonical event sequence   | evidence for the seq-gating claim                  |

### Why the webview-side `sendingDisabled` is also in scope

`useChatState.ts:18` declares `sendingDisabled` as a `useState(false)`. The
production callers of `setSendingDisabled(false)` are:

1. `ActionButtons.tsx:64` — `setSendingDisabled(buttonConfig.sendingDisabled)`
   (normal unlock via `buttonConfig`).
2. `useMessageHandlers.ts:483` — local rollback path inside a single
   `handleSendMessage` callback.

The production callers of `setSendingDisabled(true)` are:

1. `useMessageHandlers.ts:96` — `clearSentMessageState()` inside the
   post-submit optimistic path.
2. `useMessageHandlers.ts:471` — pre-flight set when a previous request is
   pending.

If `buttonConfig.sendingDisabled` is also `true` post-terminal, the bug is in
`buttonConfig` (Case A: control selector). If `buttonConfig.sendingDisabled`
is `false` but `sendingDisabled` is still `true`, the bug is in
`ActionButtons.tsx` either missing the unlock or re-rendering with stale
`buttonConfig`. The diagnostic must distinguish these.

## 4. Diagnostic record (one record per push, immutable)

```ts
type PostTerminalAuthoritySnapshot = {
  pushId: number
  capturedAt: number

  identity: {
    sessionId?: string
    taskId?: string
    runId?: string
  }

  runtime: {
    status?: string
    modelStreaming?: boolean
    awaitingApproval?: boolean
    pendingToolCount?: number
  }

  shadow: {
    lifecycle?: string
    modelStreaming?: boolean
    awaitingApproval?: boolean
    pendingToolCount?: number
    phase?: string
  }

  legacy: {
    phase?: string
    seq?: number
    anchorTs?: number
  }

  thinkingPresentation?: {
    modelStreaming: boolean
    source: "shadow" | "legacy"
    seq: number
  }

  telemetry: {
    phase?: string
    elapsedMs?: number
    startedAt?: number
    endedAt?: number
    toolCount?: number
    recoveryBudgetFailures?: number
  }

  composer: {
    disabled: boolean
    reasons: readonly string[]
    // reasons: "task-running" | "streaming" | "awaiting-approval" |
    //         "pending-tool" | "followup-not-allowed" | "request-pending" |
    //         "submit-disabled-by-button-config" | "submit-disabled-stuck-after-prior-submit"
  }

  followup: {
    canSubmit?: boolean
    route?: string
  }

  buttonConfig: {
    sendingDisabled?: boolean

## 5. Classification matrix (mechanically decidable)

```text
A CONTROL_SELECTOR_DEFECT
  runtime/snapshot terminal
  shadow terminal
  received webview state terminal
  turnState.phase terminal
  composer disabled  AND  buttonConfig.sendingDisabled === true
  → buttonsForPhase / sendingDisabled projection is wrong

B TELEMETRY_PROJECTION_DEFECT
  runtime/shadow active and confirmed
  telemetry says Idle / 00:00
  → taskTelemetry lost its start, or endedAt is wrong, or the
    state label is computed from a stale source

C PRESENTATION_SELECTOR_DEFECT
  runtime/shadow terminal
  thinkingPresentation.modelStreaming === false
  received webview state === false
  static "Thinking" still visible
  → render site ignored the projection (ChatRow or MessagesArea) or
    a memoization bug

D UPSTREAM_LIFECYCLE_DEFECT
  assistant final visible
  runtime/shadow still active
  → AgentRuntime never published the terminal event the tracker consumes

E TRANSPORT_OR_REPLICA_DEFECT
  extension push is correct (terminal everywhere)
  webview received/applied state differs or is overwritten by stale push
  → ExtensionStateContext reducer seq-gating failed

F IDENTITY_SKEW
  runtime/shadow refer task A
  telemetry/composer refer task B (or cleared task identity)

## 7. Instrumentation constraints

```text
PRODUCTION_SEMANTIC_DELTA = 0

Allowed:
  bounded diagnostic capture (one record per push, immutable)
  debug-only/read-only observation
  test-visible snapshot accessor if strictly required to make the
  capture observable from the webview side

Forbidden:
  selector changes
  projection changes
  lifecycle changes
  timer changes
  composer enablement changes
  TaskHeader migration to thinkingPresentation
  any "fix" to buttonConfig or useChatState
```

Preferred capture channel: an existing test-visible accessor on the
SdkController or a debug-only attachment. If a log is added, it must NOT
include prompt content or model output. Capture state only.

The diagnostic capture must be **same-push / same-logical-instant**. No
correlating adjacent log lines after the fact.

## 8. Halt rules

```text
H1 unexpected dirty tracked state
H2 protected stash mutation
H3 diagnostic itself changes task behavior (timing, ordering, allocation)
H4 no push correlation possible (pushId plumbing missing)
H5 any required authority field cannot be observed (censor unreadable)
H6 reproduction disappears before diagnostic capture
H7 fixing code becomes necessary to continue
H8 the diagnostic adds more than a bounded capture (it became a refactor)
```

If H6 occurs:

```text
VERDICT = NONDETERMINIC_REPRODUCTION
```

Do not declare PASS.

## 9. Commit structure (max three)

```text
C0  docs(elm): freeze E7.1 post-terminal-authority-split triage
    (this plan + LIVE-E71-R1 RED witness + board update)

C1  test/chore(elm): add bounded same-push authority diagnostic
    (one SdkController accessor + one webview-side accessor + one
     Vitest test that pins the same-push shape)

C2  docs(elm): record real-dogfood authority snapshot + classification
    (the captured M2/M3/M5/M6 records + the classification verdict)
```

If C1 requires substantive production behavior change, **HALT instead of C1**.

## 10. Acceptance gate

```text
TRIAGE_T0_IDENTITY                         = PASS
TRIAGE_T1_RED_WITNESS_FROZEN               = PASS
TRIAGE_T2_EXTENSION_PUSH_CAPTURE            = PASS
TRIAGE_T3_WEBVIEW_RECEIVE_CAPTURE           = PASS
TRIAGE_T4_PUSH_CORRELATION                  = PASS
TRIAGE_T5_SEQ_ORDERING                      = PASS | FAIL_KNOWN
TRIAGE_T6_RUNTIME_SHADOW_CAPTURE            = PASS
TRIAGE_T7_TELEMETRY_CAPTURE                 = PASS
TRIAGE_T8_COMPOSER_REASON_CAPTURE           = PASS
TRIAGE_T9_FOLLOWUP_ROUTE_CAPTURE            = PASS
TRIAGE_T10_IDENTITY_ALIGNMENT               = PASS | FAIL_KNOWN
TRIAGE_T11_ROOT_CAUSE_CLASSIFIED            = PASS
TRIAGE_T12_NO_SEMANTIC_PRODUCTION_CHANGE    = PASS
```

Successful terminal verdict:

```text
PASS_POST_TERMINAL_AUTHORITY_SPLIT_TRIAGE

ROOT_CAUSE_CLASS           = A|B|C|D|E|F|G|HYBRID|I
FIRST_DIVERGENCE_BOUNDARY  = <source:line / transition>
```

## 11. Board after authorization

```text
E7.1 Thinking implementation                 🟡 QUALIFIED_PARTIAL
E7.1 real dogfood                            🔴 FAIL

E7.1 POST_TERMINAL_AUTHORITY_SPLIT_TRIAGE    🟢 NEXT

TaskHeader migration                         ⛔ HOLD
Composer migration/fix                       ⛔ HOLD
E8 writer retirement                         ⛔ HOLD
E9 effect execution                          ⛔ HOLD
```

## 12. Why this is the smallest correct next move

The E7.1 closure correction a prior turn admitted that the real
connected extension→webview path was not proven. The reviewer ran that
path. The result exposes a disagreement the prior tests could not have
seen because they did not cover the same push from the same installed
build.

E7.1-2 (TaskHeader migration) would erase the TaskHeader as a witness
without telling us why the composer is locked. E8 (writer retirement)
would erase the legacy `turnStateTracker` writers that may be the
OFFENDING authority. E9 (effect execution) presumes the legacy
authorities are wrong and the shadow is right — which is one of the
things the diagnostic must establish, not assume.

The smallest correct move is to **observe once**: capture the
same-push authority snapshot, correlate it with the webview replica,
and read the divergence. Then repair.

  → 00:00 / Idle / 0 is the ZEROED task identity bleeding through
```

### Hybrid: terminal-event vs follow-up transition gap

```text
G TERMINAL_EVENT_VS_FOLLOWUP_TRANSITION_GAP
  runtime/snapshot already terminal
  turnState.phase === "completed"  (or "idle")
  composer disabled  AND  buttonConfig.sendingDisabled === false
  → the chat-reducer lockout is sticky because the unlock event
    (e.g. "completion_result" message-flush) is not flowing correctly
    → sub-case G1: a previously-submitted prompt left
      sendingDisabled=true and never resolved
    → sub-case G2: a rollback path ran but did not commit the unlock
    → sub-case G3: ActionButtons effect missed (stale closure)
```

### New candidate: webview-local reducer stuck state

This is a strong candidate for the composer lockout specifically. It is
distinct from any cluster above because none of the wire-authorities are wrong.

```text
I WEBVIEW_LOCAL_REDUCER_STUCK
  terminal everywhere on the wire (turnState, taskTelemetry, etc.)
  buttonConfig.sendingDisabled === false
  chatReducer.sendingDisabled === true   (sticky)
  → ONE OF:
      I1: a previous submit called setSendingDisabled(true) and never
          reached the matching setSendingDisabled(false) (rollback path
          did not run, or the unlock was guarded by a condition that
          became false)
      I2: ActionButtons effect did not re-fire (stale dependency / stale
          closure) so setSendingDisabled(buttonConfig.sendingDisabled)
          is never called with the new (false) value
      I3: a sibling state such as pendingResponse / pendingUserMessage
          is still set, and the unlock is gated behind it
```

Hybrids are allowed. The classification §6 covers the most likely composites.

## 6. Capture moments (freezable, sequential)

For each run, label the following moments and capture the diagnostic record
at each:

```text
M0 pre-run                              (no task active)
M1 streaming                            (first modelStreaming=true push)
M2 last modelStreaming=true push        (just before terminal)
M3 first modelStreaming=false push     (terminal flip)
M4 terminal runtime event              (locally logged)
M5 first stable post-terminal webview state  (the freeze frame)
M6 attempted follow-up submit          (the user's submit-one-more-prompt)
```

The most informative transitions are **M2 → M3 → M5** and **M5 → M6**. They
expose whether the terminal event (M3) propagates synchronously to the
webview (E if not), and whether the user-initiated follow-up (M6) leaves
the composer in a recoverable state (A or I if not).


    enableButtons?: boolean
    primaryText?: string
    secondaryText?: string
    primaryAction?: string
    secondaryAction?: string
  }
}
```

### Required correlated webview record

```text
pushId                            (matches EXTENSION pushId)
receivedAt                        (Date.now in the webview reducer)
replica.turnState.phase
replica.turnState.seq
replica.thinkingPresentation.*
replica.taskTelemetry.*
chatReducer.sendingDisabled       (local useState, NOT on the wire)
chatReducer.enableButtons
ActionButtons.buttonConfig.*      (the consumer's input + computed output)
```

### Core correlation gates

```text
PUSH_CORRELATION_COVERAGE                  = 100%
UNMATCHED_EXTENSION_PUSHES                 = 0
UNMATCHED_WEBVIEW_PUSHES                   = 0

TURNSTATE_SEQ_MONOTONIC                    = PASS | FAIL
THINKING_SEQ_MATCHES_ASSOCIATED_TURNSTATE  = PASS | FAIL

POST_TERMINAL_PUSH_OBSERVED                = true
POST_TERMINAL_WEBVIEW_APPLY_OBSERVED       = true
```




E71_T14_INSTALL_BINDING                 = PASS   (4.1.10-6a4cfe564 visible)
E71_T15_REAL_DOGFOOD                    = FAIL

LIVE_DOGFOOD_OBSERVATION (multi-instant screenshot walk):
  installed_version                     = 4.1.10-6a4cfe564
  assistant_final_visible               = true
  task_header_phase                     = Idle
  task_header_elapsed                   = 00:00
  task_header_tool_count                = 0
  static_thinking_visible               = true
  next_prompt_text_enterable            = true
  next_prompt_sendable                  = false

OLD_THINKING_ELLIPSIS_STALE = NOT_OBSERVED_IN_THIS_SMOKE
  (the original animated-shimmer symptom is not present in this walk.
  One live walk is not sufficient to declare it FIXED under all paths;
  the honest wording is "not observed in this smoke.")

E8                                      = HOLD
E9                                      = HOLD
TASKHEADER_MIGRATION                    = HOLD
COMPOSER_FIX                            = HOLD
```

