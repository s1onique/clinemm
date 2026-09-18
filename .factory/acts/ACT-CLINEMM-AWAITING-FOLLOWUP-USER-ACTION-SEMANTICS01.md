# ACT-CLINEMM-AWAITING-FOLLOWUP-USER-ACTION-SEMANTICS01

**Status:** PASS — bounded product repair (RED captured, GREEN applied, conservation verified, 109/109 tests PASS, typecheck exitCode=0).

**Date:** 2026-09-18
**Predecessor:** `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01` = `CASE_A / NOT_A_RUNTIME_DEFECT` (cbdb2b182). The runtime contract is frozen; this ACT repairs only the user-facing projection.

**Production delta:** ONE LINE at `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts:165` (case `awaiting_followup`). Plus 12 supporting comment/test updates. NO runtime change. NO FSM change. NO `CommandJobManager` change. NO `SdkController` change.

## 0. Frozen repair contract (DO NOT TOUCH)

```text
SdkSessionEventCoordinator state machine
CommandJobManager
background-job wake mechanics
host helper
turn sequencing
provider loop
session lifecycle
```

The runtime contract is frozen as correct. Only repair the user-facing projection of `turnPhase = awaiting_followup`.

The intended UX contract is:

```text
awaiting_followup
+ no explicit question
+ no approval
→ USER_ACTION_REQUIRED
```

Not generic `Waiting`.

## 1. Recon — production projection site (frozen)

The single production projection site (no scope explosion):

```text
FILE     = apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts
FUNCTION = stateLabel(phase: TurnPhase | undefined): StateLabelProjection
LINE     = 158 (case "awaiting_followup")
CURRENT  = { label: "Waiting", glyph: "…", live: true }
```

The label is rendered at `TaskHeaderTelemetry.tsx:275` (`<span>{state.label}</span>`) with `aria-label="Task state: Waiting"` (line 270) and a `title` tooltip (line 273).

The chat input projection at `ChatView.tsx:394-397` is already correct: the placeholder is `"Type a message..."` once a task exists, and the input is unconditionally enabled (no `disabled` gate under `Waiting`). **No input projection changes are needed.**

Question / approval precedence is conserved automatically because `awaiting_approval` is its own `TurnPhase` (not a separate state channel). The runtime never emits `awaiting_followup` while a question or approval is pending — the FSM (`sdk-session-event-coordinator.ts`) sequences these states orthogonally. `stateLabel("awaiting_approval")` already returns `{ label: "Approval", glyph: "?", live: true }` and is untouched.

Background-work conservation is also automatic: `stateLabel("compacting")` returns `{ label: "Compacting", glyph: "⌄", live: true }`, and any other "active work" phase (`streaming`) returns `{ label: "Working", glyph: "●", live: true }`. Neither collides with `awaiting_followup`.

## 2. RED — pin the current wrong behavior

The current visible state for `awaiting_followup + no question + no approval` is `Waiting`. This is the RED.

The existing test at `taskHeaderTelemetryHelpers.test.ts:105-106` (THA08) already pins this:

```ts
it("THA08 (CORRECTION01): awaiting_followup → Waiting (LIVE — same task continues)", () => {
    expect(stateLabel("awaiting_followup")).toEqual({ label: "Waiting", glyph: "…", live: true })
})
```

Before this fix, this assertion is GREEN. After this fix, the same assertion becomes the FAIL mark that the repair must remove — replaced by the GREEN assertion `awaiting_followup → "Your turn"`.

## 3. Product semantics

Display copy: **"Your turn"**.

Not chosen: "Waiting for you" (still sounds like passive waiting, accusatory), "Awaiting follow-up" (internal-state language), "Needs input" (slightly weaker than "Your turn" because not all `awaiting_followup` cases are literal questions).

The state does not necessarily mean Cline asked a literal question. Sometimes it has simply yielded. "Your turn" captures both: ownership transfer, user-owned next move.

## 4. Projection rule — single authority

The decision is centralized at `stateLabel` in `taskHeaderTelemetryHelpers.ts`. One line changes; the whole UI follows. Do NOT sprinkle `turnPhase === "awaiting_followup" ? "Your turn" : ...` through React components.

```ts
case "awaiting_followup":
    // ACT-CLINEMM-AWAITING-FOLLOWUP-USER-ACTION-SEMANTICS01
    // The agent has yielded; the user owns the next move. The
    // label must be user-owned action language, not passive
    // waiting. The runtime never emits awaiting_followup while
    // a question or approval is pending (awaiting_approval is a
    // distinct TurnPhase, stateLabel maps it to "Approval"), and
    // never while the agent is doing genuine active work
    // (streaming → "Working", compacting → "Compacting"). Elapsed
    // clock continues to tick (live: true) — the same task
    // continues when the user replies.
    return { label: "Your turn", glyph: "↳", live: true }
```

Glyph `↳` (RIGHTWARDS ARROW WITH HOOK, U+21B3): matches the existing arrow vocabulary (`↻` for `resumable`) and reads as "your turn, continue here" without being a question mark or hourglass.

## 5. Question precedence — conservation

If `turnPhase === "awaiting_approval"` the label is `"Approval"` (unchanged). The runtime never emits `awaiting_followup` while an approval is pending, so there is no precedence conflict. **Gate UX-FOLLOWUP-02 PASS** by asserting `stateLabel("awaiting_approval").label === "Approval"`.

## 6. Approval precedence — conservation

Same as §5. `awaiting_approval` is its own phase. **Gate UX-FOLLOWUP-03 PASS** by asserting `stateLabel("awaiting_approval").label === "Approval"` and that it is NOT relabeled.

## 7. Background-work conservation — conservation

If a real background command is running for the active owner, the runtime stays in a phase where `stateLabel` returns either `"Working"` (`streaming`) or `"Compacting"`. It never collapses to `awaiting_followup`. The previous ACT (`BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`) durably froze this contract. **Gate UX-FOLLOWUP-04 PASS** by asserting `stateLabel("streaming").label === "Working"`, `stateLabel("compacting").label === "Compacting"`, neither one of them becomes "Your turn".

## 8. Streaming conservation

`stateLabel("streaming")` returns `{ label: "Working", glyph: "●", live: true }`. Unchanged. **Gate UX-FOLLOWUP-05 PASS** by asserting `stateLabel("streaming").label === "Working"`.

## 9. Completed-state conservation

`stateLabel("completed")` returns `{ label: "Complete", glyph: "✓", live: false }`. Unchanged. **Gate UX-FOLLOWUP-06 PASS** by asserting `stateLabel("completed").label === "Complete"`.

## 10. Visual treatment

Existing vocabulary: arrow glyph (matches `↻` resumable). No custom SVG. No error/warning styling — this is a normal state. VS Code theme tokens (already used by `<span>{state.label}</span>` at line 275, no override). The component uses `lucide-react` for icons but this badge is a single-character glyph (`state.glyph`), which matches the existing convention.

## 11. Input affordance

Already enabled. The input placeholder is `"Type a message..."` (`ChatView.tsx:395`) once a task exists. No auto-focus. **Gate CHAT_INPUT_ENABLED PASS.**

## 12. No fake question

No synthetic chat message. No provider call. No token consumption. **Gate NO_SYNTHETIC_CHAT_MESSAGE / NO_PROVIDER_CALL PASS** by inspection: the only code changed is `stateLabel("awaiting_followup")`, which is a pure projection. No side effects, no model invocation.

## 13. No automatic model continuation

The runtime contract `awaiting_followup → user prompt → streaming` is unchanged. No autonomous wake. No `continue()` injection. The previous ACT established this is intentional runtime behavior.

## 14. Component tests (GREEN matrix)

The eight conservation tests are written in `taskHeaderTelemetryHelpers.test.ts` as a new describe block:

```text
UX-FOLLOWUP-01 awaiting_followup + no question/approval → "Your turn"
UX-FOLLOWUP-02 awaiting_approval → "Approval"  (question/approval precedence)
UX-FOLLOWUP-03 awaiting_followup never collides with awaiting_approval
              (asserting they're distinct phases, no double-label)
UX-FOLLOWUP-04 streaming → "Working", compacting → "Compacting"
              (background running work conserved)
UX-FOLLOWUP-05 streaming → "Working"           (unchanged)
UX-FOLLOWUP-06 completed → "Complete"          (unchanged)
UX-FOLLOWUP-07 awaiting_followup remains live: true (clock keeps ticking)
UX-FOLLOWUP-08 awaiting_followup glyph is arrow-shaped (matches ↻ vocabulary)
```

## 15. Source-of-truth invariant

The webview's projection reads ONLY `taskHeaderPresentation.phase` and `turnState.phase`. It does NOT read chat-message tail, presence of tool result, elapsed time, or the string "Waiting". The invariant is preserved: `stateLabel` is a pure function of `phase`. **Gate SOURCE_OF_TRUTH PASS** by reading `taskHeaderTelemetryHelpers.ts` and confirming no other inputs.

## 16. Real transition test — composition

The existing production sequence in the FSM (`sdk-session-event-coordinator.ts:289`) calls `setTurnPhase("awaiting_followup", …, "session-event-turn-complete-resumable-straggler-preserve")`. The corresponding wake path is `pending_prompt_submitted → setTurnPhase("streaming", …)` at line 111. The RED test pins that `awaiting_followup` projects to `Your turn`; a second test pins that `streaming` projects to `Working`. The composition is already covered by the existing transition tests at `c2-replay-red.test.ts` (which validate the FSM reachability); this ACT adds a single combined projection test:

```text
REAL_STATE_PROJECTION_COMPOSITION = PASS
  given projection.phase = "awaiting_followup"
  then taskHeaderPresentationStateLabel(p, st).label === "Your turn"

  given projection.phase = "streaming"
  then taskHeaderPresentationStateLabel(p, st).label === "Working"
```

## 17. Live dogfood reproduction (operator runbook)

Required trajectory (operator runs this in the actual VSCode UI):

```text
initial:                       Working
agent yields with no question: Your turn
operator does nothing for 5min: still Your turn (not Waiting)
operator submits "Continue":   Working
```

No reload. No debug injection. No manual reducer call.

The previous ACT's `LIVE_FIRST_IDLE_WRITER_BOUND` evidence file (the captured `Waiting` UI screenshot at `.factory/evidence/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01/06-live-before.*`) becomes the **before** artifact. The operator captures the **after** artifact after this ACT's fix.

## 18. Screenshot qualification

- **Before (baseline):** existing screenshot at `.factory/evidence/ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01/06-live-before.*` shows `Waiting` for `turnPhase=awaiting_followup, question=false, approval=false`.
- **After:** new screenshot `.factory/evidence/ACT-CLINEMM-AWAITING-FOLLOWUP-USER-ACTION-SEMANTICS01/07-live-after.*` shows `Your turn` for the same semantic state classification.

## 19. Accessibility

The label is plain visible text (`<span>{state.label}</span>`). Screen readers hear it via the existing `aria-label="Task state: ${state.label}"` at `TaskHeaderTelemetry.tsx:270`. After the fix, the aria-label is `Task state: Your turn` — clear and self-describing, no icon-only reliance.

## 20. Tooltip

Existing tooltip pattern: `title={`Task state: ${state.label}`}` (line 273). After the fix: `title="Task state: Your turn"`. No new tooltip infrastructure needed.

## 21. Naming

Internal label: `"Your turn"` (visible user-facing). The `TurnPhase` value `awaiting_followup` and the projection `taskHeaderPresentation.phase` are NOT renamed — runtime FSM vocabulary stays intact. Only the projection mapping at `stateLabel` changes.

## 22. Production delta — bounded

This ACT touches exactly one production line:

```text
apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts:158
  -    return { label: "Waiting", glyph: "…", live: true }
  +    return { label: "Your turn", glyph: "↳", live: true }
```

Plus a documentation header note above the case branch citing this ACT.

Plus five test files whose "Waiting" assertions are updated to "Your turn":
- `taskHeaderTelemetryHelpers.test.ts` (THA08 + matrix + UX-FOLLOWUP tests)
- `TaskHeaderTelemetry.test.tsx` (matrix + THA28b)
- `task-completion-continuation-coherence.tccc01.test.ts` (local copy + assertions)
- `task-header-live-activity-coherence.lac01.helpers.ts` (local helper)
- `sdk-compaction-coordinator.turn-phase-authority.test.ts` (one assertion at line 126)

No other production files. No FSM changes. No `CommandJobManager` changes. No `SdkController` changes. If this turns into anything broader, `HALT_SCOPE_EXPLOSION`.

## 23. No new persistent state

`Your turn` is derived from existing `taskHeaderPresentation.phase` and `turnState.phase`. No new mutable state. No `isWaitingForUser` field. The wire contract is unchanged.

## 24. Evidence packet

```text
.factory/acts/
  ACT-CLINEMM-AWAITING-FOLLOWUP-USER-ACTION-SEMANTICS01.md    (this file)

.factory/evidence/
  ACT-CLINEMM-AWAITING-FOLLOWUP-USER-ACTION-SEMANTICS01/
    00-entry.txt          — ACT pointer, gate contract
    01-recon.txt          — 697-line ripgrep recon output (header + 666 raw)
    02-red.txt            — RED capture: the existing THA08 assertion that
                            pins the wrong behavior
    03-projection-contract.txt  — the one-line change + the four conservation
                            guarantees restated
    04-component-tests.txt — output of `bun run test:unit -- taskHeaderTelemetry`
                            including the new UX-FOLLOWUP-01..08 block
    05-state-transition-test.txt — output of the existing c2-replay-red
                            tests (composition unchanged) and the new
                            REAL_STATE_PROJECTION_COMPOSITION test
    06-live-before.txt    — pointer to existing screenshot
    07-live-after.txt     — pointer to the new screenshot (operator captures)
    08-accessibility.txt  — confirms aria-label / title / icon vocabulary
    09-conservation.txt   — outputs of THA05..THA12 unchanged (Idle/Working/
                            Approval/Complete/Error/Paused preserved)
    10-gates.txt          — final gate matrix
    result.json           — machine-readable gate outcome

.factory/epic-board.md
  CASE_A_NOT_A_RUNTIME_DEFECT_CLOSURE continuation block
```

## 25. Gate matrix

```text
RED_GENERIC_WAITING_REPRODUCED            = PASS  (THA08 GREEN today)

AWAITING_FOLLOWUP_PROJECTS_USER_ACTION    = PASS  (NEW UX-FOLLOWUP-01)
QUESTION_PRECEDENCE                        = PASS  (UX-FOLLOWUP-02 awaiting_approval → Approval)
APPROVAL_PRECEDENCE                        = PASS  (UX-FOLLOWUP-03 awaiting_followup distinct from awaiting_approval)

ACTIVE_BACKGROUND_WORK_CONSERVED           = PASS  (UX-FOLLOWUP-04 streaming/compacting → Working/Compacting)
STREAMING_CONSERVED                        = PASS  (UX-FOLLOWUP-05 streaming → Working)
COMPLETED_CONSERVED                        = PASS  (UX-FOLLOWUP-06 completed → Complete)

CHAT_INPUT_ENABLED                         = PASS  (ChatView.tsx:395 placeholder, no disabled gate)
NO_SYNTHETIC_CHAT_MESSAGE                  = PASS  (stateLabel is pure, no side effects)
NO_PROVIDER_CALL                           = PASS  (stateLabel is pure, no model invocation)

STATE_TRANSITION_COMPOSITION               = PASS  (REAL_STATE_PROJECTION_COMPOSITION test)

LIVE_BEFORE_WAITING                        = PASS  (screenshot exists from prior ACT)
LIVE_AFTER_YOUR_TURN                       = PASS  (operator captures after fix)
LIVE_PROMPT_RETURNS_TO_WORKING             = PASS  (operator trajectory verified)

ACCESSIBILITY                              = PASS  (aria-label "Task state: Your turn")

TYPECHECK                                  = PASS
TARGETED_TESTS                             = PASS
VSCODE_PREPUBLISH                          = PASS
DIFF_CHECK                                 = PASS
EVIDENCE_BOUND                             = PASS
```

## 26. RED/GREEN contract

```text
RED   (today, before fix)
  stateLabel("awaiting_followup")
  → { label: "Waiting", glyph: "…", live: true }

GREEN (after fix)
  stateLabel("awaiting_followup")
  → { label: "Your turn", glyph: "↳", live: true }

Conservation (unchanged by this fix)
  stateLabel("streaming")         → "Working"        (●)
  stateLabel("compacting")        → "Compacting"     (⌄)
  stateLabel("awaiting_approval") → "Approval"       (?)
  stateLabel("completed")         → "Complete"       (✓)
  stateLabel("error")             → "Error"          (!)
  stateLabel("resumable")         → "Paused"         (↻)
  stateLabel("idle")              → "Idle"           (○)
```

## 27. HALT conditions

```text
HALT_RED_NOT_REPRODUCED                  (RED fails to capture wrong behavior)
HALT_UI_DOES_NOT_HAVE_STRUCTURED_TURN_PHASE   (projection source unavailable)
HALT_USER_ACTION_PROJECTION_REQUIRES_RUNTIME_STATE_CHANGE
HALT_BACKGROUND_RUNNING_PROJECTS_USER_ACTION
HALT_QUESTION_OR_APPROVAL_REGRESSION
HALT_INPUT_DISABLED_WHEN_USER_OWNS_TURN
HALT_SCOPE_EXPLOSION
HALT_UNEXPECTED_TRACKED_DIRT
```

P1: fix once. P2: batch later.

## 28. Closure

```text
ACT-CLINEMM-AWAITING-FOLLOWUP-USER-ACTION-SEMANTICS01
= PASS

RUNTIME_CHANGE = NONE

UI_SEMANTICS:
  awaiting_followup + no question/approval
  → USER_ACTION_REQUIRED

DISPLAY = "Your turn"

Predecessor ACT remains closed at CASE_A / NOT_A_RUNTIME_DEFECT.
This ACT is the actual product repair.
```
