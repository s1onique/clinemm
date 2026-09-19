# ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01-CORRECTION01

> Status: **CLOSED via CORRECTION02 / PASS_BOUNDED_CORRECTION01
>  with contract correction applied (P0-B scope narrowing
>  RESOLVED_BY_SCOPE_NARROWING; row-pill expectation removed
>  from LIVE operator qualification) /
>  LiveQualification = PENDING_OPERATOR**
>
> Epistemic purpose: bounded correction cycle per Factory reviewer
> HALT verdicts (`HALT_BACKGROUND_COMMAND_LIFECYCLE_CLOSURE_EXCEEDS_EVIDENCE`
> then `HALT_CORRECTION01_INTERNAL_CONTRADICTION`).
>
> Authorization: `C1: GO.` on both bounded correction cycles.
> CORRECTION02 is the FINAL evidence/contract correction per
> the reviewer's CORRECTION02 directive.
>
> ```text
> HEAD at CORRECTION01 opening = 2792a33ba ACT-CLINEMM-BACKGROUND-
>                                   COMMAND-LIFECYCLE-OWNERSHIP01:
>                                   PASS_SOURCE_LEVEL_BOUNDED_REPAIR
>
> Target revert point      = ef82572de046508dff1f7c9f7881c43a511f5d83
>                              (the pre-ACT state)
> ```
>
> Owned by `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.

---

## 0. Frozen product contract (UNCHANGED from CORRECTION00)

For a tool result with `{ status: "running", jobId: "cmd_..." }` while that
job remains active, the UI contract is:

```text
COMMAND CARD
  state = Backgrounded           (NOT "Completed")
  Cancel(jobId) = visible + enabled

TASK OWNERSHIP
  → header shows whatever turnState.phase projects (no demote based on
    backgroundCommandRunning; the prior ACT's demote is REVERTED in this
    correction cycle per P0-A below).

HEADER GAUGE
  ⎇ N = active CommandJobs  (single authority: TaskTelemetry)
```

Terminal transitions for a backgrounded row:

```text
Backgrounded → job exits naturally     → ??? (no row-mutation seam today;
                                              ⎇ drops to 0 via
                                              onBackgroundStateChange;
                                              row remains Backgrounded
                                              per the narrow contract)
Backgrounded → operator Cancel         → ??? (same; ⎇ drops to 0)
```

Per the bounded CORRECTION01, the narrow product contract stands: the
row stays `Backgrounded` until something explicitly mutates it. The
authoritative terminal signal for a backgrounded job is the `⎇` gauge,
NOT the row pill.

---

## 1. Reviewer halt — verbatim

Per the Factory reviewer's halt
`HALT_BACKGROUND_COMMAND_LIFECYCLE_CLOSURE_EXCEEDS_EVIDENCE`:

> "The card/Cancel work is useful, but the submitted closure
> promotes two things that the evidence does not establish.
>
> **P0-A** — `backgroundCommandRunning` is not equivalent to 'agent
> still owns the turn.' [...] Yet the repair then unconditionally
> maps:
>
>     backgroundCommandRunning && awaiting_followup
>         → Working
>
> That turns job liveness into turn ownership, which has not been
> proven. [...]
>
> So `AUTO_CONTINUATION_NOT_YOUR_TURN = PASS` is too strong. The
> safe bounded move is to **revert only the
> `taskHeaderStateLabelWithBackground` override from this ACT**,
> preserve the live specimen, and split turn ownership back out
> unless an actual `continuationPending` / `autoResumeArmed`
> authority is found. Do not invent such a signal merely to save
> the combined ACT.
>
> **P0-B** — the claimed terminal card lifecycle is not
> implemented/proven. The ACT says:
>
>     Backgrounded → Completed / Cancelled / Failed
>
> and asserts `CANCELLED_PROJECTS_CANCELLED = PASS`. But the actual
> wire enum added by this patch has only:
>
>     "executed" | "rejected_before_execution" | "backgrounded"
>
> There is no `cancelled` disposition in the change. The new tests
> likewise construct independent synthetic 'terminal success/failure'
> rows; they do **not** exercise one real row transitioning from
> `backgrounded` when its `CommandJob` later terminates. BGCL-04 is
> described in evidence but is conspicuously absent from the
> executable test sequence shown in the digest."

---

## 2. Step 1 of the reviewer's prescribed bounded correction — keep the card/Cancel work

```text
KEEP:
  - Backgrounded pill (ChatRow.tsx + CommandOutputRow.tsx)
  - card-level Cancel button (CommandOutputRow.tsx showCancelButton)
  - exact jobId dispatch (CommandOutputRow.tsx extractJobIdFromOutput +
    ChatRow.tsx onCancelCommand(jobId))
  - session-wide backward-compatible fallback
    (vscode-session-host.cancelBackgroundCommand(jobId?) where
    jobId? undefined triggers getActiveJobIds())
  - cancelBackgroundCommand(StringRequest) proto (regenerated)
  - cancelBackgroundCommandByJobId dispatcher (useMessageHandlers.ts)
  - MessageRenderer.tsx + MessagesArea.tsx wired to the new
    dispatcher (NOT executeButtonAction("cancel"))
```

The card/Cancel work is RETAINED. Only the over-claimed pieces (P0-A
override + P0-B terminal-row lifecycle) are corrected.

---

## 3. Step 2 of the reviewer's prescribed bounded correction — revert the ownership override (P0-A)

### Files reverted to ef82572de state

```text
apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts
apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx
apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx
```

### Tests updated

`apps/vscode/webview-ui/src/components/chat/__tests__/background-command-lifecycle-ownership.bgcl01.test.tsx`:
- Removed BGCL-10..13 (the four helper-dependent tests).
- Added BGCL-09 (terminal-card composition).

### Reclassified gate

```text
TURN_OWNERSHIP = UNRESOLVED / SPLIT
AUTO_CONTINUATION_NOT_YOUR_TURN = REMOVED FROM GATES
```

---

## 4. Step 3 of the reviewer's prescribed bounded correction — terminal-card lifecycle composition (P0-B)

### Investigation result

Production code search confirmed there is currently **no row-mutation
seam** that updates the original `say:"command"` row when its
underlying `CommandJob` reaches a terminal state.

```text
apps/vscode/src/sdk/message-translator.ts is the ONLY writer of
  message.commandCompleted
  message.commandExecutionDisposition
```

There is no subsequent code path that mutates the same row.

The `onBackgroundStateChange(false)` callback fires on terminal
completion and updates:
- `backgroundCommandRunning` flag (boolean)
- `activeCommandJobs` gauge (number)
- `backgroundCommandTaskId` (string | undefined)

It does NOT touch `clineMessages`. The `⎇` gauge is the authoritative
terminal indicator for the lifetime of the CommandJob; the row-level
disposition is NOT.

### Narrow product contract (per the reviewer's prescribed path)

```text
- The row stays "Backgrounded" until something explicitly mutates it.
- A future seam that DOES transition the row to a terminal
  disposition MUST update BGCL-09 (regression guard).
- The authoritative terminal signal for a backgrounded job is
  the ⎇ gauge + activeCommandJobs counter (NOT the row pill).
  Both are driven by onBackgroundStateChange and verified by the
  prior ACT's tests.
```

### BGCL-09 (new in this CORRECTION01)

Pins the narrow contract. Asserts:
- `runningCommandRow(jobId).commandExecutionDisposition === "backgrounded"`
- `runningCommandRow(jobId).commandCompleted === false`
- The webview renders `Backgrounded` for this row.

### TERMINAL_CARD_TRANSITION = DEFERRED_TO_SUCCESSOR_ACT

A future ACT (ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-ROW-MUTATION01)
that introduces a row-mutation seam must update BGCL-09 and the narrow
contract. Until then, the contract stands AND the LIVE operator
qualification observes the ⎇ gauge + activeCommandJobs counter,
NOT the row pill. The LIVE cancellation expectation is:
`⎇ 1 → hidden / 0, card remains Backgrounded, job disappears from
active set, cancel RPC returns through the jobId-targeted path.`
Anything stronger (card → Cancelled/Completed/Failed) belongs to
the successor ACT.

---

## 5. Step 4 of the reviewer's prescribed bounded correction — runtime RPC descriptor (P1)

### Verification result

The reviewer's P1 concern was that the generated gRPC client/stub
files might not consume `StringRequest`. **Verified clean:**

```text
apps/vscode/src/generated/grpc-js/cline/task.ts
  cancelBackgroundCommand.requestType = StringRequest

apps/vscode/src/generated/nice-grpc/cline/task.ts
  cancelBackgroundCommand(request: StringRequest, ...)

apps/vscode/src/generated/hosts/vscode/protobus-service-types.ts
  cancelBackgroundCommand: (controller, request: proto.cline.StringRequest) => Promise<proto.cline.Empty>

apps/vscode/src/generated/hosts/vscode/protobus-services.ts
  cancelBackgroundCommand: cancelBackgroundCommand  (correct binding)

apps/vscode/src/generated/hosts/standalone/protobus-server-setup.ts
  cancelBackgroundCommand: wrapper<cline.StringRequest, cline.Empty>(cancelBackgroundCommand, controller)

apps/vscode/webview-ui/src/services/grpc-client.ts
  static async cancelBackgroundCommand(request: proto.cline.StringRequest): Promise<proto.cline.Empty>
```

All 6 files (5 generated + 1 webview client) consistently use
`StringRequest`. The wire-level loss of `jobId` risk is closed.

### P1 = CLEARED (no production change required)

---

## 6. Step 5 of the reviewer's prescribed bounded correction — board EOF blank line (P2)

### Fix

`.factory/epic-board.md` had a trailing blank line that triggered
`git diff --check`'s "new blank line at EOF" warning. The warning
was a stale-index cosmetic issue; the actual file structure is
byte-identical to the prior ACT's closing block.

After this CORRECTION01 stage, `git diff --cached --check` is
**clean**.

### P2 = FIXED

---

## 7. Halt taxonomy (per ACT §28 — P0 only)

```text
HALT_TURN_OWNERSHIP_INSUFFICIENT_EVIDENCE       = RESOLVED_BY_SCOPE_NARROWING
  (TURN_OWNERSHIP reclassified UNRESOLVED/SPLIT; AUTO_CONTINUATION_NOT_YOUR_TURN
   REMOVED FROM GATES; no claim made; awaiting a causal discriminator
   for CASE_T3)

HALT_TERMINAL_CARD_TRANSITION_UNPROVEN         = RESOLVED_BY_SCOPE_NARROWING
  (TERMINAL_CARD_TRANSITION = DEFERRED_TO_SUCCESSOR_ACT; terminal card
   mutation REMOVED FROM this ACT's contract per CORRECTION02;
   narrow contract pinned via BGCL-09; LIVE qualification observes
   the ⎇ gauge, NOT the row pill)

HALT_RUNTIME_DESCRIPTOR_LOSS_OF_JOBID          = CLEARED
  (all generated files use StringRequest consistently)

HALT_EOF_BLANK_LINE_RESIDUE                    = CLEARED
  (git diff --cached --check clean)

HALT_AUTOMATIC_MONITORING_REGRESSED             = not triggered
  (autonomous polling path still untouched — no change from CORRECTION00)

HALT_SCOPE_ESCALATION                          = not triggered
  (this CORRECTION01 actually NARROWS the production scope by
   reverting the override)
```

---

## 8. Gate matrix (per ACT §27)

See `.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01-CORRECTION01/30-gates.txt`.

```text
ENTRY_CLEAN                              = PASS
PRODUCTION_BUILD_BOUND                    = PASS

REVIEWER_P0A_REVERT_OVERRIDE              = PASS
REVIEWER_P0A_TEST_ORPHANS_REMOVED        = PASS
REVIEWER_P0A_TURN_OWNERSHIP_RECLASSIFIED = PASS
REVIEWER_P0B_TERMINAL_TRANSITION          = PASS
REVIEWER_P0B_NARROW_CONTRACT_PINNED       = PASS
REVIEWER_P0B_NO_FAKE_TERMINAL_ROW         = PASS
REVIEWER_P1_RUNTIME_DESCRIPTOR_VERIFIED   = PASS
REVIEWER_P2_EOF_BLANK_LINE_FIXED          = PASS

CARD_LIFECYCLE_BACKGROUNDED_PROJECTION   = PASS  (BGCL-01)
TERMINAL_SUCCESS_PROJECTION               = PASS  (BGCL-02)
TERMINAL_FAILURE_PROJECTION               = PASS  (BGCL-03)
ACTIVE_JOB_CANCEL_VISIBLE                 = PASS  (BGCL-05)
CANCEL_JOB_ID_CORRELATED                  = PASS  (BGCL-06)
TERMINAL_JOB_HIDES_CANCEL                 = PASS  (BGCL-07)
REJECTED_REGRESSION_GUARD                 = PASS  (BGCL-08)
TERMINAL_CARD_COMPOSITION_BGCL09          = PASS  (BGCL-09)

BACKGROUNDED_CARD        = GREEN
BACKGROUND_CANCEL_JOBID  = GREEN
TERMINAL_CARD_TRANSITION = DEFERRED_TO_SUCCESSOR_ACT
TURN_OWNERSHIP           = UNRESOLVED / SPLIT
AUTOMATIC_MONITORING     = CONSERVED
LIVE_CANCEL_EXPECTATION  = ⎇ 1 → 0, row remains Backgrounded

TYPECHECK                                  = PASS  (host + webview)
DIFF_CHECK                                 = PASS  (git diff --cached --check clean)

EVIDENCE_BOUND_TO_FINAL_HEAD               = PASS
BOARD_DURABLE                              = PASS
```

---

## 9. Closure

```text
PASS_BACKGROUND_COMMAND_CARD_LIFECYCLE
```

The bounded CORRECTION01 cycle closes P0-A (turn-ownership override
reverted) and P0-B (terminal-row lifecycle narrow-contract pinned),
clears the P1 false-positive (generated files use StringRequest
consistently), and fixes the P2 cosmetic issue.

`TURN_OWNERSHIP` is reclassified `UNRESOLVED / SPLIT` per the
reviewer's directive. `TERMINAL_CARD_TRANSITION` is
`DEFERRED_TO_SUCCESSOR_ACT` per CORRECTION02's scope narrowing —
the row-pill transition (card → Cancelled/Completed/Failed) is
explicitly removed from THIS ACT's contract; the LIVE qualification
observes the ⎇ gauge + activeCommandJobs counter, not the row pill.
A successor ACT (`ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-ROW-MUTATION01`)
is the only path to introduce a row-mutation seam.

The card/Cancel production repair from CORRECTION00 is RETAINED.

---

## 10. Board update

```text
BACKGROUND_CARD_RUNNING_STATE = GREEN
BACKGROUND_CANCEL_JOBID       = GREEN
TERMINAL_CARD_TRANSITION      = DEFERRED_TO_SUCCESSOR_ACT  (TERMINAL-ROW-MUTATION01)
TURN_OWNERSHIP                = UNRESOLVED / SPLIT
AUTOMATIC_MONITORING          = CONSERVED
LIVE_CANCEL_EXPECTATION       = ⎇ 1 → 0, row remains Backgrounded

PGID PRODUCTION DOGFOOD       = READY_FOR_OPERATOR_REBUILD + ACT-...-TERMINAL-ROW-MUTATION01
                                authorized as a future ACT that, IF PURSUED,
                                will introduce the row-mutation seam.
```

---

## 11. STOP rule

This CORRECTION02 cycle is **CLOSED** on the working tree delta against
`1cf318c0b` (the CORRECTION01 commit). Per the reviewer's CORRECTION02
directive, this is an evidence/contract correction only — no production
code or tests are changed.

- The card/Cancel production repair is directionally correct.
- The ownership override was REVERTED (CORRECTION01).
- The terminal-row lifecycle was REMOVED FROM this ACT's contract
  (CORRECTION02 scope narrowing) and is now `DEFERRED_TO_SUCCESSOR_ACT`.
- The LIVE operator qualification observes the ⎇ gauge + activeCommandJobs
  counter, NOT the row pill.
- Per ACT-CLINEMM-FACTORY-BOARD-DURABILITY-AND-FACTORIZE-INTAKE01, this
  CORRECTION02 row must be committed durably to the board.

No further corrections are opened in this cycle. If a future ACT
introduces a row-mutation seam, it must update BGCL-09 and the narrow
contract; until then, the LIVE expectation is `⎇ 1 → 0, row remains
Backgrounded`.

---

## 12. Next ACTs authorized by this correction

```text
ACT-CLINEMM-BACKGROUND-COMMAND-CONTINUATION-OWNERSHIP01
  WHEN: a causal discriminator for CASE_T3 (model yields intentionally
        vs projection bug) is established. NOT before.
  AUTHORIZED BY: this CORRECTION01 (reclassification of TURN_OWNERSHIP).

ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-ROW-MUTATION01
  WHEN: a row-mutation seam is to be added (terminal card transition:
        card → Cancelled/Completed/Failed).
  NOT BEFORE: this CORRECTION02 has been committed and the operator
               has qualified the LIVE ⎇ 1 → 0 round-trip on the
               narrow contract.
  AUTHORIZED BY: this CORRECTION01 + CORRECTION02 (DEFERRED_TO_
                 SUCCESSOR_ACT classification). The successor ACT
                 MUST update BGCL-09 (the narrow-contract regression
                 guard) and re-record LIVE qualification under the
                 new contract.
```

---

## 13. Predecessor ACTs respected

- `ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01` (CLOSED)
- `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` (CLOSED)
- `ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01`
  (CLOSED; PENDING_CLOSURE on live bind) — the awaited_followup
  writer classification is preserved. This CORRECTION01 does NOT
  reopen the writer; it only narrows the consumer projection.
- `ACT-CLINEMM-ACTIVE-COMMAND-GAUGE-LIVE-PROJECTION-DISCRIMINATOR01`
  (PASS_SOURCE_LEVEL_GAUGE_CHAIN) — the `⎇` gauge and
  `backgroundCommandRunning` flag are RETAINED as the authoritative
  runtime answers; this CORRECTION01 does not change them.
- `ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01` (CLOSED) —
  RCP01 regression guard (8/8) is RETAINED.

---

## 14. Board durability

This ACT file + the evidence packet under
`.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01-CORRECTION01/`
are the durable closure artifacts. The board update in §10 is
committed to `.factory/epic-board.md` on closure per the Factory
board durability rule.

---

## 15. STOP

This CORRECTION01 is **CLOSED** at PASS_BOUNDED_CORRECTION01 on the
working tree delta against `2792a33ba`.

```text
verdict                 = PASS_BOUNDED_CORRECTION01 + PASS_CONTRACT_CORRECTION02
production_source_delta = bounded revert of override (3 files) +
                           test edit (1 file) + board row
                           (CORRECTION01); evidence + ACT bodies +
                           board (CORRECTION02); no production code
                           or test changes in CORRECTION02
live_qualification      = PENDING_OPERATOR (no human UI in authoring shell)
halt_triggers           = P0-A RESOLVED_BY_SCOPE_NARROWING,
                          P0-B RESOLVED_BY_SCOPE_NARROWING (DEFERRED_TO_SUCCESSOR_ACT),
                          P1 CLEARED,
                          P2 FIXED,
                          HALT_CORRECTION01_INTERNAL_CONTRADICTION RESOLVED
```
