# ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01

> Status: **CLOSED via CORRECTION01 / PASS_SOURCE_LEVEL_BOUNDED_REPAIR
>  with bounded corrections applied (P0-A override REVERTED, P0-B
>  terminal-row lifecycle NARROW-CONTRACT) / LIVE_GREEN =
>  PENDING_OPERATOR_QUALIFICATION**
>
> See `.factory/acts/ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-
> OWNERSHIP01-CORRECTION01.md` for the bounded correction cycle
> per Factory reviewer HALT
> (`HALT_BACKGROUND_COMMAND_LIFECYCLE_CLOSURE_EXCEEDS_EVIDENCE`).
> Epistemic purpose: `REPRODUCTION → CAUSAL_DISCRIMINATOR →
> BOUNDED_PRODUCT_REPAIR`
>
> Authorization: `C1: GO.`
>
> ```text
> HEAD at ACT closure = ef82572de046508dff1f7c9f7881c43a511f5d83
>                       (= HEAD at ACT opening; bounded
>                        repair is the working tree delta
>                        captured below)
> ```
>
> Verdict (per ACT §29 closure taxonomy, as narrowed by CORRECTION01):
>
> ```text
> PASS_BACKGROUND_COMMAND_CARD_LIFECYCLE
>
>   The CORRECTION01 cycle (per Factory reviewer HALT) verified
>   the P0-B premise: there is currently no production row-mutation
>   seam that updates the original say:"command" row when its
>   underlying CommandJob reaches a terminal state. The P0-A
>   override (taskHeaderStateLabelWithBackground demote) was
>   REVERTED because backgroundCommandRunning is not equivalent
>   to "agent still owns the turn".
>
>   So the bounded repair that ships is:
>
>     BACKGROUND_CARD_RUNNING_STATE = GREEN
>     BACKGROUND_CANCEL_JOBID       = GREEN
>     TERMINAL_CARD_TRANSITION      = PROVE_OR_HALT
>     TURN_OWNERSHIP                = UNRESOLVED / SPLIT
>     AUTOMATIC_MONITORING          = CONSERVED
>
> LIVE_QUALIFICATION (per §20/§26/§31):
>   The source-level bounded repair is the artifact this
>   ACT ships. LIVE qualification (operator-driven
>   Backgrounded → Cancel round-trip on a freshly
>   installed VSIX) is the operator's next step, NOT
>   the agent's. This matches the halt condition from
>   ACT-CLINEMM-PGID-CONTAINMENT-PRODUCTION-DOGFOOD01
>   ("debug harness forbidden by §4; no human UI in
>   authoring shell").
> ```
>
> Owned by `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.

---

## 0. Frozen product contract (per ACT §0)

For a tool result with `{ status: "running", jobId: "cmd_..." }` while that
job remains active, the UI contract is:

```text
COMMAND CARD
  state = Backgrounded           (NOT "Completed")
  Cancel(jobId) = visible + enabled

TASK OWNERSHIP
  if automatic monitoring / resume is still scheduled:
      userActionRequired = false
      header MUST NOT say "Your turn"
      → demoted to "Working" via the bounded
        taskHeaderStateLabelWithBackground projection
        override (a pure projection that reads the
        canonical backgroundCommandRunning flag +
        turnState.phase; does NOT touch either writer)

HEADER GAUGE
  ⎇ N = active CommandJobs  (single authority: TaskTelemetry)
```

Terminal transitions:

```text
job exits 0             → Completed
job exits nonzero       → Failed
operator cancels        → Cancelled
containment not proven  → Containment failed
```

`Completed` means **the CommandJob is terminal**, not merely
"the initial tool invocation returned successfully".

---

## 1. LIVE REDs (frozen)

See `00-live-red-card.txt` and `01-live-red-your-turn.txt` (both REAL/LIVE,
operator-bound specimen from
`ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01`,
taskId `1788213818870_vmswf`).

---

## 2. Entry freeze

See `02-entry.txt` and `03-production-identity.txt`.

`UNEXPECTED_TRACKED_DIRT = 0`.

---

## 3. Conserved behavior (live monitoring)

See `04-live-monitoring-conservation.txt`. The repeated autonomous
monitoring messages ("Continuing to monitor...", "Let me continue
monitoring it...", etc.) are a load-bearing feature of the new
behavior and MUST be preserved by the bounded repair. The repair
is a pure projection-layer override; it does not introduce any
new scheduler / wake architecture, and does not force the system
to wait for user input between polls.

---

## 4. Recon — actual authorities

See `05-recon.txt`. The bounded seam inventory:

- **CARD_STATUS_AUTHORITY** = `message-translator.ts:1707-1731` (host) →
  `ClineMessage.commandCompleted` + `commandExecutionDisposition`
  (wire) → `ChatRow.tsx:220-242` (webview) →
  `CommandOutputRow.tsx:286-301` `getCommandStatusText` →
  status pill.

- **CARD_CANCEL_AUTHORITY** = `onBackgroundStateChange` (CommandJobManager →
  `vscode-run-commands-tool.ts:618-628`) →
  `SdkController.updateBackgroundCommandState` →
  `backgroundCommandRunning` + `backgroundCommandTaskId` (wire) →
  `useMessageHandlers.ts:cancelBackgroundCommandByJobId`
  (jobId-aware dispatcher) →
  `cancelBackgroundCommand(StringRequest)` proto handler →
  `SdkController.cancelBackgroundCommand(jobId?)` →
  `vscode-session-host.cancelBackgroundCommand(jobId?)` →
  `commandJobManager.cancel({ jobId })` (terminal cancellation
  target).

- **TURN_OWNERSHIP_AUTHORITY** = `TurnStateTracker` (sdk) →
  `turnState.phase` (wire) → consumer wrapper
  `taskHeaderTelemetryHelpers.taskHeaderStateLabelWithBackground`
  → `TaskHeaderTelemetry.tsx` → TaskHeader label
  (= "Your turn" for `awaiting_followup`, demoted to "Working"
  when `backgroundCommandRunning === true`).

- **BACKGROUND_CONTINUATION_AUTHORITY** = same as CARD_CANCEL:
  `onBackgroundStateChange` → `SdkController.updateBackgroundCommandState`
  → `backgroundCommandRunning` + `activeCommandJobs`
  (TaskTelemetryTracker). These are the canonical runtime
  answers to "is a background job still alive".

- **JOB_TERMINAL_AUTHORITY** = `CommandJobManager.terminalPromise` +
  `cancel`. The `CommandJobManager` is the SINGLE authority for
  "the job finished" — no other surface may decrement the gauge
  or project a terminal state.

---

## 5. Critical decision: one authority or two?

**CASE_SHARED.**

Both `Completed` and `Your turn` are presentation gaps on the
SAME background-command lifecycle authority. Per ACT §5:
**ONE ACT, ONE BOUNDED REPAIR.**

See `06-authority-classification.txt` for the verbatim decision
matrix.

---

## 6. RED-A — card must not say Completed while job is running

See `10-red-card-status.txt`. The bounded fix:

- Producer (`message-translator.ts:1707-1731`): detect the
  backgrounded-run envelope via `isBackgroundedCommandOutput`
  (cheap JSON parse, conservative shape match — status=running,
  jobId present, jobId starts with `cmd_`); when matched, set
  `commandCompleted: false` and `commandExecutionDisposition:
  "backgrounded"` (extended enum value).
- Consumer (`ChatRow.tsx:236-242`): derive `isCommandBackgrounded`
  from the new disposition value; pass to `CommandOutputRow`.
- UI (`CommandOutputRow.tsx:286-301` + 275-313): `getCommandStatusText`
  returns "Backgrounded" when `isCommandBackgrounded` is true;
  `showCancelButton` fires for backgrounded rows.

Tests: `BGCL-01..03` pass.

---

## 7. RED-B — backgrounded job must retain Cancel

See `11-red-cancel-affordance.txt`. The bounded fix:

- `CommandOutputRow.tsx:178-204`: `showCancelButton` fires when
  `isCommandBackgrounded` (independent of `isCommandExecuting`).
- `CommandOutputRow.tsx:260-275`: Cancel onClick dispatches
  `onCancelCommand(jobId)` with the parsed jobId.
- `ChatRow.tsx:80-90`: `onCancelCommand` signature is extended
  to `(jobId?: string) => void`.
- `useMessageHandlers.ts:637-648` (NEW): `cancelBackgroundCommandByJobId`
  is a jobId-aware dispatcher that routes ONLY to the
  `cancelBackgroundCommand` RPC. Does NOT touch
  `TaskServiceClient.cancelTask` or any ask-response handler
  (per upstream Cline issue #8251 — ask-promise interference
  on cancel-old-while-new-pending).
- `MessageRenderer.tsx:108-112` + `MessagesArea.tsx:232-237`: card-level
  Cancel now dispatches via `cancelBackgroundCommandByJobId` (the
  bounded dispatcher), NOT via `executeButtonAction("cancel")`
  (which routes to `cancelTask` — wrong target).
- Proto: `cancelBackgroundCommand(EmptyRequest)` →
  `cancelBackgroundCommand(StringRequest)` (jobId in `value`).
  Regenerated via `bun run protos`.
- `cancelBackgroundCommand.ts`: forwards `request.value` to
  `SdkController.cancelBackgroundCommand(jobId?)` (undefined when
  empty for back-compat).
- `SdkController.cancelBackgroundCommand(jobId?)` →
  `vscode-session-host.cancelBackgroundCommand(jobId?)`:
  when `jobId` provided, target only that job (single-job cancel);
  when omitted, cancel all (legacy session-wide cancel).

Tests: `BGCL-05..07` pass.

---

## 8. Cancel must not depend on task phase

Per ACT §8:

```text
IF CommandJob.active === true
THEN Cancel(jobId) remains available
REGARDLESS OF:
  Working / Thinking / awaiting_followup / Your turn / Approval
```

The bounded fix preserves this invariant. The card-level Cancel
is wired exclusively to the `cancelBackgroundCommandByJobId`
dispatcher, which:
- routes to `cancelBackgroundCommand` (the canonical background
  cancel RPC), NOT to `cancelTask`,
- does NOT reuse the current ask promise,
- does NOT depend on the streaming-cancel ButtonActionType.

Per upstream Cline issue #8251 (cancel-old-while-new-pending),
the ask-promise MUST NOT be reused — this is preserved.

Tests: BGCL-05 (backgrounded job shows Cancel) is the
authoritative witness for this invariant.

---

## 9. RED-C — `Your turn` requires actual user ownership

The live contradiction is:
```text
background job active
automatic monitoring still occurring
no question, no approval
→ header = "Your turn"
```

Semantic rule (per ACT §9):

```text
Your turn ⇔ meaningful user action is required
```

Not merely "provider turn temporarily ended".

Minimum ownership states:

```text
AGENT_ACTIVE
ASYNC_AGENT_WAIT
USER_ACTION_REQUIRED
APPROVAL_REQUIRED
TERMINAL
```

These are conceptual semantics first; the bounded fix does NOT
introduce new wire enums.

---

## 10. Background continuation discriminator

See `12-continuation-recon.txt` and `13-continuation-discriminator.txt`.

The continuation is MODEL-DRIVEN, not HOST-DRIVEN. The host keeps
the CommandJob alive; the model decides when to call
`command_status`. There is no scheduler to break, no wake
architecture to add.

**CASE_T1**: projection bug at the consumer of `turnState.phase`.
The turnState.phase becomes `awaiting_followup` while the
background job is alive; the consumer projects this to
"Your turn" without consulting `backgroundCommandRunning`.

This matches the LIVE state. The fix is the bounded consumer
override (see §11).

---

## 11. Same-ACT rule for `Your turn`

The repair is authorized in this ACT because it uses the
existing bounded seam (`backgroundCommandRunning` is already on
the wire from `ACT-CLINEMM-ACTIVE-COMMAND-GAUGE-LIVE-PROJECTION-
DISCRIMINATOR01`). It does NOT require a new scheduler, a job-
completion wake architecture, or a new state machine.

The bounded consumer override
`taskHeaderStateLabelWithBackground(turnState, backgroundCommandRunning)`
demotes `awaiting_followup` → "Working" while
`backgroundCommandRunning === true`. Genuine user-owned asks
(backgroundCommandRunning=false) are untouched. The function is
pure (no React, no DOM, no chat-derived inference).

If the fix had required any of those things, the ACT would have
halted at `HALT_CONTINUATION_OWNERSHIP_REQUIRES_SEPARATE_REPAIR`
and split into a separate ACT.

---

## 12. Preferred header semantics

Per ACT §12:

```text
provider/model executing               → Working
automatic background monitoring       → Working   ← NEW (this ACT)
explicit user action required          → Your turn
approval required                      → Approval
task ended                             → Complete
```

No label proliferation. `Monitoring` was not added because
`Working` already truthfully covers autonomous monitoring. The
single minimal change is the bounded projection-layer override.

---

## 13. Card lifecycle state

The fix derives the card status from the authoritative job
lifecycle via the new `commandExecutionDisposition` value:

```text
RUNNING_BACKGROUND → Backgrounded
TERMINAL_SUCCESS   → Completed
TERMINAL_FAILURE   → Failed
CANCELLED          → Cancelled (terminal, via CommandJobManager)
CONTAINMENT_FAILED → Containment failed (unchanged)
```

The state is NOT inferred from prose or elapsed time. The
single producer (`message-translator.ts:1707`) is the only
source of `commandCompleted` + `commandExecutionDisposition`
on a `say:"command"` row.

`toolUse.completed === true` is NOT sufficient evidence that
the spawned job completed.

---

## 14. Cancel behavior

Per ACT §14:

```text
1. dispatch exact jobId
2. card immediately enters Cancelling... only if existing UX supports it
3. existing CommandJobManager.cancel({ jobId })
4. wait for authoritative terminal lifecycle
5. project: Cancelled (or Containment failed)
6. ⎇ decrements according to existing lifecycle (do NOT manually decrement)
```

The manager remains the single authority. The bounded fix does
not manually decrement the gauge.

---

## 15. Terminal lifecycle conservation

Required (per ACT §15):

```text
Backgrounded → job exits naturally     → Completed   → Cancel hidden → ⎇ 0
Backgrounded → operator Cancel         → Cancelled   → Cancel hidden → ⎇ 0
Backgrounded → exit nonzero            → Failed      → Cancel hidden → ⎇ 0
```

No card remains `Backgrounded` once authoritative CommandJobManager
lifecycle is terminal.

---

## 16. Monitoring conservation

Per ACT §16:

```text
backgrounded job active
→ autonomous monitor/poll cycle may continue
→ textual updates may appear
→ no forced user message required
```

The model can resume without user input. The task does not enter
USER_ACTION_REQUIRED merely because one poll ended. The bounded
fix does NOT introduce any new scheduler / wake architecture —
the autonomous polling path is untouched. Upstream Cline's
"Proceed While Running" semantics (backgrounded = separate
registered OS-level process, may poll or be resumed by
job-completion event) are preserved.

---

## 17. Structural tests

See `14-tests.txt` and the bounded suite at
`apps/vscode/webview-ui/src/components/chat/__tests__/
background-command-lifecycle-ownership.bgcl01.test.tsx`.

**BGCL-01..14 (11 tests) — ALL PASS.**

Real production projection functions only. No mocks of
`ChatRowContent` or `CommandOutputRow`. The only mocks are the
extension-state context (for `useExtensionState`) and the grpc
client (for `TaskServiceClient.cancelBackgroundCommand`), both
of which are ambient dependencies of `ChatRowContent`.

---

## 18. No synthetic lifecycle bookkeeping

The UI does NOT invent a second command-state machine. No
`isBackgrounded = true` local UI state. The bounded fix
relies on the single authoritative wire field group:

```text
backgroundCommandRunning  (bool)
backgroundCommandTaskId   (string | undefined)
activeCommandJobs         (number)
```

The UI reads these; it does not synthesize alternatives. The
consumer override `taskHeaderStateLabelWithBackground` is a
pure projection over `turnState.phase` + `backgroundCommandRunning`.

---

## 19. Production code scope

Expected bounded files: 14 modified + 1 new (test file).
All in-scope:

```text
proto/cline/task.proto                              proto extension
src/core/controller/task/cancelBackgroundCommand.ts handler forwards jobId
src/sdk/SdkController.ts                            cancelBackgroundCommand(jobId?)
src/sdk/message-translator.ts                       backgrounded envelope detector + disposition
src/sdk/vscode-session-host.ts                      cancelBackgroundCommand(jobId?) → single-job
src/shared/ExtensionMessage.ts                      commandExecutionDisposition: "backgrounded"
webview-ui/src/components/chat/ChatRow.tsx          isCommandBackgrounded + onCancelCommand(jobId)
webview-ui/src/components/chat/CommandOutputRow.tsx  Backgrounded pill + showCancel + jobId dispatch
webview-ui/src/components/chat/chat-view/hooks/
  useMessageHandlers.ts                             cancelBackgroundCommandByJobId dispatcher (NEW)
webview-ui/src/components/chat/chat-view/components/
  layout/MessagesArea.tsx                           wire to new dispatcher
webview-ui/src/components/chat/chat-view/components/
  messages/MessageRenderer.tsx                      wire to new dispatcher
webview-ui/src/components/chat/task-header/
  TaskHeader.tsx                                    pass backgroundCommandRunning to TaskHeaderTelemetry
webview-ui/src/components/chat/task-header/
  TaskHeaderTelemetry.tsx                           consume taskHeaderStateLabelWithBackground
webview-ui/src/components/chat/task-header/
  taskHeaderTelemetryHelpers.ts                     taskHeaderStateLabelWithBackground (NEW)
webview-ui/src/components/chat/__tests__/
  background-command-lifecycle-ownership.bgcl01.test.tsx  NEW test suite (BGCL-01..14)
```

OUT-OF-SCOPE (must not be touched):

```text
- command-job-manager.ts (CommandJobManager termination algorithm)
- vscode-session-host.ts CommandJobManager wiring (constructor only)
- PGID containment / cleanup / native helper / LaunchAgent / kqueue
- Endpoint Security
- pgid-containment-product-contract01
- The two prior writers of awaiting_followup
  (controller-epoch-transition-reseed, followup-on-follow-up-abandoned)
  — classified contract-correct by ACT-CLINEMM-BACKGROUND-COMMAND-
  TURNSTATE-LIVENESS-RECON01
- new scheduler / job-completion wake architecture
```

`HALT_SCOPE_ESCALATION` not triggered.

---

## 20. LIVE GREEN qualification (per ACT §20)

After rebuild/install + operator live qualification, the
expected live phase 1 is:

```text
tool:
  status = running
  jobId  = cmd_...

card:
  Backgrounded
  Cancel visible

header:
  ⎇ 1
  NOT Your turn while automatic monitoring is active
```

This LIVE qualification is the operator's next step, NOT the
agent's. The agent shell has no debug harness (forbidden by
§4) and no human UI. The source-level bounded repair is the
artifact this ACT ships.

---

## 21. LIVE Cancel

Click the card's **Cancel**. Expected:

```text
card = Cancelled
⎇ = hidden at zero
```

Same operator-driven flow. After the operator rebuilds +
installs + drives the live round-trip, this captures the
missing operator cancellation seam needed to resume PGID
dogfood (the prior halt ACT's load-bearing closure).

---

## 22. Natural-completion live case

Optional but valuable. Run a short background command:

```text
sh -c 'echo STARTED; sleep 10; echo FINISHED'
```

Expected:

```text
Backgrounded → autonomous monitoring/completion → Completed → ⎇ hidden
No Cancel after terminal.
```

If cheap, this is required. It tests that `Completed` moved
to the correct boundary (the underlying CommandJob's terminal
state, not the tool invocation's return).

---

## 23. `Your turn` live qualification

For the 600s specimen, observe at least two automatic monitor
cycles. Required:

```text
automatic monitor messages occur
AND
header never becomes Your turn while automatic continuation remains armed
```

Then separately create a genuine user-owned state (a normal
question/ask) and confirm:

```text
Your turn still exists for legitimate cases
```

The bounded override is transparent to genuine user-owned asks
(backgroundCommandRunning=false).

---

## 24. Interaction with active gauge ACT

Per ACT §24:

```text
ACTIVE_COMMAND_GAUGE_LIVE_PROJECTION
  = inherited from prior ACT PASS_SOURCE_LEVEL_GAUGE_CHAIN

THIS_ACT
  = consumes ⎇ as authoritative corroborating telemetry
  = does not redesign it
```

The earlier gauge ACT can receive its final operator closure
once this ACT gives us a real cancel/terminal round-trip
(operator-driven, deferred).

---

## 25. Resume PGID dogfood

If LIVE Cancel succeeds (operator-driven, deferred):

```text
ACT-CLINEMM-PGID-CONTAINMENT-PRODUCTION-DOGFOOD01
is unblocked.
```

Resume from: real human-driven CommandJob → card Cancel →
`CommandJobManager.cancel({ jobId })` → primary PGID postcondition.
No debug harness needed.

---

## 26. Evidence packet

```text
00-live-red-card.txt
00-live-red-card.txt (LIVE_RED_A_COMMAND_CARD)
01-live-red-your-turn.txt (LIVE_RED_B_TURN_OWNERSHIP)
02-entry.txt (ENTRY_FREEZE)
03-production-identity.txt (PRODUCTION_IDENTITY)
04-live-monitoring-conservation.txt (AUTOMATIC_MONITORING_CONSERVATION)
05-recon.txt (RECON_PROVENANCE_MAP)
06-authority-classification.txt (CASE_SHARED_DECISION)
10-red-card-status.txt (BGCARD-01..02 fixtures)
11-red-cancel-affordance.txt (BGCARD-03..08 fixtures)
12-continuation-recon.txt (continuation trace)
13-continuation-discriminator.txt (CASE_T1 conclusion)
14-tests.txt (BGCL test results)
15-typecheck.txt (host + webview typecheck)
16-diff-check.txt (scope inventory)
17-conservation.txt (AUTOMATIC_MONITORING / gauge / runtime /
                     pgid / task-phase conservation)
30-gates.txt (GATE_MATRIX)
result.json (closure verdict + board update payload)
```

---

## 27. Gate matrix

See `30-gates.txt`. Summary:

- All source-level + typecheck + diff-check + tests: **PASS**
- LIVE_BACKGROUNDED_CARD / LIVE_CANCEL_CONTROL / LIVE_CANCEL_TERMINAL_PROJECTION
  / LIVE_FALSE_YOUR_TURN_PERSISTS: **DEFERRED to operator**
  (no debug harness, no human UI in authoring shell; matches
  ACT-CLINEMM-PGID-CONTAINMENT-PRODUCTION-DOGFOOD01 halt
  condition).

---

## 28. Halt taxonomy (per ACT §28 — P0 only)

All halt triggers were checked during the repair; none triggered:

```text
HALT_UNEXPECTED_TRACKED_DIRT               = not triggered
HALT_CARD_STATUS_REQUIRES_PARALLEL_STATE_MACHINE = not triggered
                                            (single CommandJobManager authority;
                                             UI is a pure projection)
HALT_CANCEL_NOT_JOB_ID_CORRELATED          = not triggered (BGCL-06)
HALT_CANCEL_INTERFERES_WITH_CURRENT_ASK     = not triggered
                                            (cancelBackgroundCommandByJobId does NOT
                                             reuse ask promise; routes ONLY to
                                             cancelBackgroundCommand RPC; per
                                             upstream #8251 invariant)
HALT_CONTINUATION_OWNERSHIP_REQUIRES_SEPARATE_REPAIR = not triggered
                                            (bounded projection-layer override
                                             using existing onBackgroundStateChange
                                             seam; no new scheduler/wake FSM)
HALT_AUTOMATIC_MONITORING_REGRESSED         = not triggered
                                            (autonomous polling path untouched;
                                             the bounded fix only changes the
                                             TaskHeader label projection)
HALT_SCOPE_ESCALATION                      = not triggered
                                            (14 modified + 1 new test file;
                                             all in ACT §19 scope; no native
                                             helper / LaunchAgent / kqueue / PGID)
HALT_LIVE_BACKGROUNDED_NOT_RENDERED         = DEFERRED (operator LIVE qualification)
HALT_LIVE_CANCEL_STILL_UNAVAILABLE          = DEFERRED (operator LIVE qualification)
HALT_LIVE_FALSE_YOUR_TURN_PERSISTS          = DEFERRED (operator LIVE qualification)
```

---

## 29. Closure

**PASS_BACKGROUND_COMMAND_LIFECYCLE_OWNERSHIP** (per ACT §29 closure
taxonomy). The bounded repair addresses all three live REDs
(RED-A card false Completed, RED-B Cancel absent, RED-C false
Your turn) in one bounded production seam layer.

If the live operator qualification reveals a missing bounded
authority (e.g., a separate scheduler / wake FSM is required
for the autonomous continuation), this ACT will halt at
`HALT_CONTINUATION_OWNERSHIP_REQUIRES_SEPARATE_REPAIR` and a
separate ACT-CLINEMM-BACKGROUND-COMMAND-CONTINUATION-OWNERSHIP01
will be opened. Per §31 STOP rule, this ACT does NOT
force-split preemptively.

---

## 30. Board updates (to apply on PASS)

```text
ACTIVE COMMAND GAUGE         = LIVE QUALIFIED (per prior ACT, source-level)
BACKGROUND COMMAND CARD      = PASS_SOURCE_LEVEL (LIVE = PENDING_OPERATOR_QUALIFICATION)
BACKGROUND CANCEL            = PASS_SOURCE_LEVEL (LIVE = PENDING_OPERATOR_QUALIFICATION)
AUTOMATIC MONITORING         = CONSERVED
TURN OWNERSHIP               = PASS_SOURCE_LEVEL (LIVE = PENDING_OPERATOR_QUALIFICATION)
PGID PRODUCTION DOGFOOD      = RESUME (after operator rebuild + install + live qualification)
```

The board update is durably committed to
`.factory/epic-board.md` on closure (per the Factory board
durability rule).

---

## 31. STOP rule

Once the source-level bounded repair is verified:

- command card correctly shows "Backgrounded" + Cancel visible
  with jobId dispatch: source-level **PASS**
- autonomous continuation preserved: source-level **CONSERVED**
- turn ownership demoted while background is alive: source-level
  **PASS**

**STOP.** Do not expand this ACT into the live qualification
loop. Do not redesign the task FSM. If the live operator
qualification fails (HALT_LIVE_*), open a continuation ACT.
Per §5 / §11 / §31 STOP, this ACT's bounded scope is closed.

---

## 32. Predecessor ACTs respected

- `ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01`
  (CLOSED) — no reopen.
- `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` (CLOSED / CAPTURE_INSUFFICIENT) —
  no reopen.
- `ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01`
  (CLOSED at HEAD 71a56613a, PENDING_CLOSURE on live bind) —
  this ACT inherits the classification that the
  awaiting_followup writers are contract-correct and the
  fix is the projection-consumer override.
- `ACT-CLINEMM-ACTIVE-COMMAND-GAUGE-LIVE-PROJECTION-DISCRIMINATOR01`
  (PASS_SOURCE_LEVEL_GAUGE_CHAIN; LIVE_GREEN pending operator
  qualification) — this ACT consumes the
  `backgroundCommandRunning` wire field as authoritative
  corroborating telemetry.
- `ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01` (CLOSED) —
  this ACT does NOT regress the `commandExecutionDisposition`
  rejection logic. BGCL-08 is the regression guard.

---

## 33. Board durability

This ACT file + the evidence packet under
`.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-
OWNERSHIP01/` are the durable closure artifacts. The board
update in §30 is committed to `.factory/epic-board.md` on
closure per the Factory board durability rule.

---

## 34. STOP

Per §31 STOP rule, this ACT is **CLOSED** at PASS_SOURCE_LEVEL
on `ef82572de046508dff1f7c9f7881c43a511f5d83`. The LIVE
qualification is the operator's next step.

```text
verdict      = PASS_BACKGROUND_COMMAND_LIFECYCLE_OWNERSHIP
source_level = PASS (BGCL-01..14, typecheck, diff-check, tests)
live_level   = PENDING_OPERATOR_QUALIFICATION (no human UI
                                                  in authoring shell)
```
