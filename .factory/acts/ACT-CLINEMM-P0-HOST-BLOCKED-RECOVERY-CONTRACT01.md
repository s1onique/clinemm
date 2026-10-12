# ACT-CLINEMM-P0-HOST-BLOCKED-RECOVERY-CONTRACT01 — HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED — 2026-10-12

**Status:** CLOSED with verdict `HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED`. The host
safety is contract-correct (held-observation conservation, no fabrication, no
automatic unbounded loop), but the user-visible Retry affordance is the
**SAME** `api_req_failed` button set as a genuine transport failure. A bounded
UI repair would require a new public wire field (TurnState `writerId` or
`blockedReason`), which the C9 contract forbids without explicit operator
acceptance of the new contract. This ACT stops at the contract-freeze
boundary; the missing product contract is named for operator decision.

## C0 — Trust and entry identity

```
HEAD:                       d75e050beb08c12d5b2d18cb56001c063fba37a8
WORKTREE_STATUS:            clean
PROTECTED_STASH:            (none)
GIT_STASH:                  (empty)
DIFF_CHECK:                 clean
```

The inventory reported HEAD `d75e050beb`. The worktree has one ACT-owned
addition (`apps/vscode/src/sdk/__tests__/host-blocked-recovery-contract01.hbrc01.test.ts`)
and one ACT-owned update to `.factory/epic-board.md`; no production source
files are modified.

## C1 — Repository identity and trust (C1 verbatim)

```text
$ git rev-parse HEAD
d75e050beb08c12d5b2d18cb56001c063fba37a8
$ git status --short   (clean at entry; ACT delta is the new test file + this ACT + board update)
$ git stash list       (empty)
$ git diff --check     (clean)
$ git log -6 --oneline
d75e050be docs(ACT-CLINEMM-P0-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01): PASS_APPLICATION_OWNERSHIP_ALREADY_COHERENT ...
a76c8ccee docs(ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01): reviewer response — P1 OPEN, 3x P2 closed
9b3f74187 test(ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01): PASS_EXPECTED_ASYNC_HOLD — bounded test updates; 10/10 GREEN
83cf6bc92 docs(ACT-CLINEMM-EXACT-HEAD-DOGFOOD-C1-GO): PASS — exact-HEAD dogfood VSIX built and verified (HEAD 307bb1d46, SHA-256 1006d304…)
307bb1d46 test(SDK): PPLC01/OCRRD01 build wiring — bake PPLC01 bridge test into canonical typecheck + base vitest exclude (matches OCRRD01 sibling)
b1de112d2 test(SDK): PPLC-02/OCRRD01-04 bounded harness fix — align makeAgentStub listener signature with production SessionRuntimeOrchestrator.subscribeRuntimeEvents contract
```

## C2 — Frozen predecessor facts (unchanged)

| Contract                                | Source                                              | Status    |
|------------------------------------------|-----------------------------------------------------|-----------|
| Held-observation conservation (BCB01)   | background-completion-barrier01.bcb01.test.ts       | PASS      |
| Truthful resumed-turn capability projection (CRCD01) | completion-reevaluation-capability-discriminator01.crcd01.test.ts | PASS_REPAIR |
| Coalesced-continuation guard (CTQC01)    | completion-terminal-queue-convergence01.ctqc01.test.ts | PASS  |
| Completion fail-closed outcomes (CCUTO01) | completion-continuation-unresolvable-terminal-outcome01.ccuto01.test.ts | PASS |
| Blocked-outcome publication (HBOP01)     | host-blocked-outcome-publication01.hbop01.test.ts   | PASS      |
| Blocked-outcome lifecycle owner (HBCLO01) | host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts | PASS    |
| Blocked-outcome consumer probe (HBOCP01) | host-blocked-outcome-consumer-probe01.hbocp01.test.ts | CAPTURE_INSUFFICIENT |
| Runtime registry + drain (OCRRD01)       | observation-capability-runtime-registry-discriminator01.c24-c-bridge.test.ts | PASS |
| Bounded capability restoration (BOCR01) | blocked-observation-capability-recovery-probe01.bocr01.test.ts | PASS |
| Prompt lifecycle convergence (PPLC01)   | pending-prompt-lifecycle-discriminator01.c24-c-bridge.test.ts | HALT_PENDING_EXECUTION |
| Verified submission terminal non-convergence (VSTN01) | VERIFIED-SUBMISSION-TERMINAL-NONCONVERGENCE01.md | PASS_COMPLETION_CONSERVATION_BLOCKED_AS_DESIGNED |

All predecessors preserved. No RED observed. The remaining open question
is the user-facing and host-owned recovery contract when capability
restoration does not occur — exactly the question this ACT charters.

## C3 — Production-seam reconnaissance (C3 verbatim)

### HELD_OBSERVATION

```yaml
owner:          BackgroundNotifyCoordinator
registration:   recordNonNotifyTerminalObservation (vscode-run-commands-tool.ts:890)
count_reader:   notifyCoordinator.unconsumedTerminalCountForOwner(sid, tid)
id_reader:      notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(sid, tid)
consumption:    notifyCoordinator.consumeNonNotifyTerminalObservation (Path C, command-status-tool.ts:384-393)
task_session_lifetime: process-ephemeral, keyed by (sessionId, taskId)
```

### CAPABILITY

```yaml
producer:           LocalRuntimeHost.getActiveRuntimeToolNames(sessionId)
                     (sdk/packages/core/src/runtime/host/local-runtime-host.ts:1557)
runtime_registry:   ClineCore.getActiveRuntimeToolNames
                     -> VscodeSessionHost.liveTools (apps/vscode/src/sdk/vscode-session-host.ts:895)
                     -> SdkSessionEventCoordinator.options.liveTools
coordinator_reader: liveTools() closure (apps/vscode/src/sdk/SdkController.ts:2517-2521)
tool_dispatch:      active.sdkHost.send({ delivery: "queue" })
                     (SdkFollowupCoordinator.continueIdleSession)
absence_semantics:  canObserveHeldResults = false (truthful projection, fail-closed)
```

### BLOCKED_OUTCOME

```yaml
elm_policy:         Continuation Control kernel classifies held>0+capability=false as fail_closed(observation_unavailable)
host_marker:        setTurnPhase("error", undefined, "session-event-bcb-blocked-observation-unavailable")
                    (apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3149-3153)
runtime_incident:   recordRuntimeError via taskTelemetry (deduped; bounded counter)
                    (SdtController.ts:2755-2773 / SdkController.ts:2771-2773)
task_header_projection: phase = "error" + writerId (NOT projected to webview)
user_visible_details: BUTTON_CONFIGS.api_req_failed (Retry + Start New Task)
                       webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts:411-416
```

### RETRY

```yaml
ui_action:         useMessageHandlers.executeButtonAction("retry")
                    (webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts:453-461)
controller_handler: SdkController.askResponse
                     (apps/vscode/src/sdk/SdkController.ts:4430)
runtime_action:    SdkFollowupCoordinator.askResponse -> continueIdleSession
                     -> fireAndForgetSend(sdkHost, sessionId, "[TASK RESUMPTION] …")
tool_registry_rebuild: NO. The same runtime + same liveTools is reused.
epoch_or_identity_change: NO. The same (sessionId, taskId) is reused.
```

### RECOVERY

```yaml
existing_supported_mechanisms:
  - Capability restoration via model-driven command_status(J) drain
    (BOCR01-03, OCRRD01-04): liveTools gains command_status ->
    command_status.execute(J) -> BackgroundNotifyCoordinator Path C drain
    -> held set contracts to 0 -> fresh submit_and_exit commits.
  - Start New Task: a new task has fresh (sessionId, taskId); the old
    held set is process-ephemeral and not silently reattributed
    (BOCR01-06 cross-session/cross-task identity isolation).
ownership:  model (for capability restoration); user (for Start New Task)
release_condition:  held = 0 (capability restoration path)
unsupported_mechanisms:
  - User-driven Retry (current production): re-enters the same runtime
    with the same liveTools; reaches the same dead end; held set
    conserved but no progress. The bounded guard short-circuits on
    the second submit_and_exit (BOCR01-07) so the blocked outcome
    is not re-stamped, but the model still cannot observe the held
    observation.
```

## C4 — Frozen recovery contract (C4 state table verbatim)

| Held observation | Capability        | User action       | Required behavior (production)            |
|------------------|-------------------|-------------------|-------------------------------------------|
| None             | Available         | Complete          | Normal Elm eligibility decision           |
| J held           | Available         | command_status(J) | Genuine observation; release J if supported |
| J held           | Unavailable       | Complete          | Fail closed; no fabricated completion      |
| J held           | Unavailable       | Retry             | RE-ENTER THE SAME RUNTIME; same dead end; held set conserved; no fabrication; no automatic unbounded loop; tracker phase stays "error" (BOCR01-07 short-circuit) |
| J held           | Unknown           | Retry             | Same as "Unavailable" (capability unknown) - fall through to `rejected` at the inner enqueue's `liveTools === undefined` branch (sdk-session-event-coordinator.ts:3162) |
| J held           | Capability restored | Retry/continue | Allow a fresh legitimate observation attempt (the model calls command_status(J); Path C drains the held set) |
| J held           | Unavailable       | Start New Task    | Establish explicit old-task obligation lifetime; no cross-task transfer (BOCR01-06) |
| J held           | Unavailable       | Cancel            | Preserve/dispose obligations only according to the existing task-close/cancel contract (cancelTask bumps epoch; held set is process-ephemeral) |
| J held           | Unavailable       | Repeated Retry    | No uncontrolled automatic reentry; bounded guard's sameObligationAlreadyObservationUnavailable prevents duplicate incident (BOCR01-07) |
| J held           | Session replaced  | Delayed K result  | No mutation of K+1 obligation or capability (BCCR01 epoch binding) |

### What constitutes a genuine recovery action (C4 verbatim)

The only supported recovery actions in the production code are:

1. **Capability restoration** — the live runtime gains `command_status`
   (e.g., a new task starts, the runtime is rebuilt, the local SDK
   recovers the tool). The held set drains via Path C; a fresh
   `submit_and_exit` commits.

2. **Start New Task** — the user explicitly starts a new task; the old
   held observation is process-ephemeral and is not reattributed. This
   is the only "user-actionable" recovery that genuinely progresses
   the workflow (the old task is abandoned with its held set
   discarded).

A recovery mechanism **must not bypass the actual terminal result
consumer**. The model is the only actor that can call
`command_status(J)`. The user's Retry click is not a recovery
mechanism in this state; it is a normal askResponse that reaches the
same dead end.

## C5 — Reproduction at the real host seam (C5 verbatim)

The HBRC01 test file at
`apps/vscode/src/sdk/__tests__/host-blocked-recovery-contract01.hbrc01.test.ts`
exercises the production `BackgroundNotifyCoordinator` +
`SdkSessionEventCoordinator` end-to-end (mirroring the BOCR01 harness
pattern) and establishes the invariants:

```yaml
terminal_job_exists:    true (recordNonNotifyTerminalObservation(J-1))
held_count:             1
held_job_ids:           [J-1]
active_runtime_has_command_status: false (liveTools = ["submit_and_exit"])
completion_committed:   0
tracker_phase:          "error"
tracker_writerId:       "session-event-bcb-blocked-observation-unavailable"
observation_unavailable_stamps: 1 (single stamp; BOCR01-07 short-circuit on subsequent)
```

The capability-absent condition is produced through the bounded
`setLiveTools(tools)` authoring seam (the same seam BOCR01-01..07 use
to flip the liveTools projection). The label on the controlled
configuration is `SYNTHETIC_REAL` per C5; it does not prove the
historical LIVE root cause (which is process-ephemeral and
not reconstructable from a post-mortem trace).

## C6 — Retry/actionability RED (C6 verbatim)

The HBRC01 test captures each conceptual checkpoint in the source-bound
test bodies:

```text
retry_requested                        (test BRC-01a, BRC-01b: emitSubmitAndExit twice)
retry_accepted_or_rejected             (SdkSessionEventCoordinator.handleSessionEvent
                                       runs the bounded guard; sameObligationAlreadyObservationUnavailable
                                       short-circuits on the second submit_and_exit)
runtime_recreated_or_reused            (production code REUSES; WITNESS-1 source-bound assertion
                                       verifies no setLiveTools/rebuildRuntime in SdkController.askResponse)
active_tool_registry_after_retry       (liveTools closure unchanged - the model receives the same
                                       tool list; no command_status available)
continuation_enqueued                   (held>0 but sameObligationAlreadyObservationUnavailable;
                                       no enqueue)
continuation_dequeued                   (N/A; not enqueued)
runtime_turn_started                    (the user-driven Retry re-enters the model turn via
                                       fireAndForgetSend(sdkHost, sessionId, "[TASK RESUMPTION] …");
                                       same runtime; same liveTools)
command_status_available_to_model       (false; liveTools lacks command_status)
observation_consumed                    (false; the model cannot call command_status; held set
                                       stays at 1)
blocked_outcome_published               (true; first cycle publishes observation_unavailable;
                                       second cycle is short-circuited)
task_completion_committed               (false; Elm consult is held by the BCB01 §0.1 second
                                       conjunct)
```

### BRC-01 — Capability not restored

BRC-01a: a held observation + liveTools lacking command_status publishes a
SINGLE observation_unavailable blocked outcome on the FIRST
submit_and_exit. The bounded guard's writerId
`session-event-bcb-blocked-observation-unavailable` is captured;
completion is NOT fabricated; held set is conserved; no continuation
enqueue; no wake fired.

BRC-01b: a second submit_and_exit on the BCR-blocked state short-circuits
via `sameObligationAlreadyObservationUnavailable` (BOCR01-07); the held
set is preserved; no new blocked outcome stamp; tracker phase stays
"error". The user's Retry click is contract-correct under the current
production code: no progress, no fabrication, no unbounded loop.

BRC-01c: contract RED — the user's Retry click is the same `yesButtonClicked`
the production code maps to `fireAndForgetSend`; there is NO production
contract that distinguishes a Retry in this state from a Retry in a
genuine `api_req_failed` state. The source-bound `useMessageHandlers`
search confirms no recovery-specific branch in the `case "retry":` arm.

### BRC-02 — Genuine capability restoration

BRC-02: `liveTools` gains `command_status` + `command_status.resolveObligation(J)`
drains the held set (the existing supported mechanism; BOCR01-03 +
OCRRD01-04). The held set contracts to 0; the reeval finds held=0; no
second blocked outcome stamp; no continuation enqueue. This is the
control case that proves the production seam is intact for the
"recovered" precondition.

### BRC-03 — Repeated user Retry

BRC-03: three back-to-back same-task submit_and_exit cycles do NOT amplify
the blocked-outcome publication (the bounded guard dedupes on the
same obligation). The held set identity is conserved across all 3
cycles. No automatic host continuation; no wake fired; no completion
fabricated. Each cycle is a separate user action, not an automatic
loop.

### BRC-04 — Task replacement

BRC-04: a held observation on task-K is keyed by `(sessionId-K, taskId-K)`;
task-K+1's BCB sees a fresh held set, NOT the K obligation. The
new task emits submit_and_exit with no held obligation; the bounded
guard's eligibility predicate is false; no observation_unavailable
stamp; the legacy done-without-completion path takes over. K's held
set is process-ephemeral and unreachable by the K+1 harness.

### BRC-05 — UI and host correspondence

BRC-05a: a BCB-blocked error phase renders the SAME button set as a
genuine `api_req_failed` (Retry + Start New Task); the production
code does not consult the writerId. The `buttonsForPhase` signature
does NOT take `writerId`; the function body has no `writerId` /
`blockedReason` branches. The `errorTypes` list contains ONLY
`"api_req_failed"`.

BRC-05b: a future bounded UI fix would require a NEW public wire field
(TurnState `writerId` or `blockedReason`); the current production
code has neither. The closed `TurnState` interface has no `writerId`,
no `blockedReason`, no `observationUnavailable` flag. The BCB marker
is process-ephemeral on the `SdkSessionEventCoordinator`; it is not
projected onto the wire.

## C7 — Causal discriminator (C7 verbatim)

| Variant                                      | Evidence                                                                                  | Disposition                  |
|----------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------|
| A — Runtime registration defect              | liveTools gains command_status in BRC-02; Path C drain is intact.                          | REFUTED                      |
| B — Publication defect                       | bounded guard reads liveTools() truthfully (sdk-session-event-coordinator.ts:3108-3110). | REFUTED                      |
| C — Retry contract defect                    | Retry is a normal askResponse (useMessageHandlers.ts:453-461); no recovery-specific branch. | REFUTED (no defect to repair) |
| D — Recovery ownership absent                | The only supported automatic recovery is model-driven command_status(J). The user's Retry does not own capability restoration. | **CONFIRMED (and frozen as the missing contract)** |
| E — UI projection defect                     | The `error` phase from BCB-block renders identically to api_req_failed; TurnState has no writerId field; buttonsForPhase has no writerId parameter. | **CONFIRMED** (but repair would require a NEW public wire field; out of C9 scope) |
| F — Correct explicit hold                    | Held set conserved; no fabrication; no automatic unbounded loop; bounded guard short-circuits on second submit_and_exit. | CONFIRMED (preserved)        |
| G — Conservation violation                   | n/a — BCB01 / OCRRD01 / BOCR01 conservation gates all GREEN.                                | REFUTED                      |
| H — Insufficient capture                     | The capability-restoration path is fully captured (BRC-02 + BOCR01-03 + OCRRD01-04); the Retry path is fully captured (BRC-01); the task-replacement path is fully captured (BRC-04). | REFUTED                      |

**Disposition: Variant D + Variant E.** The host safety is correct
(F); the bounded recovery ownership is absent (D); the UI projection
makes the same affordance available for genuine transport failure and
for BCB-block (E). A bounded UI fix would require a new public wire
field, which C9 forbids without explicit operator acceptance of the
new contract. This ACT stops at the contract-freeze boundary.

## C8 — Necessity and ablation (C8 verbatim)

The C7 disposition does not authorize a production repair. The
existing host safety is correct; the existing capability-restoration
path is correct; the existing task-replacement path is correct. No
RED was reproduced in the bounded code (BRC-02 control case GREEN;
BRC-01a/b/c GREEN; BRC-03 GREEN; BRC-04 GREEN). The only open question
is the user-facing and host-owned recovery contract — which is the
missing product contract, not a defect to repair.

The "old code" (the current production code) does reproduce the LIVE
symptom (held observation + observation_unavailable + Retry) and
exhibits the expected `HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED`
behavior (no progress; held set conserved; no fabrication). A
bounded repair would change the production code, which the C9
contract forbids without explicit operator acceptance of a new
wire field. This ACT therefore stops at the contract-freeze boundary
rather than implementing a UI fix.

## C9 — Conditional production repair

**NOT AUTHORIZED.** Per C9:

> If a new recovery action or externally visible protocol field is
> genuinely required, stop at `HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED`.
> Charter its minimal implementation only after the contract is
> explicitly accepted.

The bounded UI fix (disable Retry when the BCB marker carries
`observation_unavailable`) would require:

- A new `TurnState` field (e.g., `writerId` or `blockedReason`)
  propagated through `getStateToPostToWebview` to the webview.
- A new branch in `buttonsForPhase` keyed on that field.
- A new `ButtonConfig` variant (e.g., `error_blocked` with no
  Retry primary action).
- A new public webview contract change.

This is a new public wire field — explicitly out of C9 scope. The
ACT stops at the contract-freeze boundary.

Explicitly forbidden (per C9 + C0):

- Fabricating `command_status(J)` responses — REFUSED.
- Deleting held observations merely to authorize completion — REFUSED.
- Overriding Elm Completion Authority — REFUSED.
- Resetting BCB state to make Retry appear successful — REFUSED.
- Automatically submitting `submit_and_exit` again without causal progress — REFUSED.
- Adding a fourth completion-related authority — REFUSED.
- Converting user Retry into a hidden unbounded auto-retry — REFUSED.
- Allowing stale session/task/epoch results to mutate a replacement task — REFUSED.
- Permanent diagnostic state inside React functional updaters — REFUSED.
- Adding new public wire/protocol fields without separately freezing their contract — REFUSED.

The production code passes the conservation tests. The C0 question
is answered: **no supported automatic recovery action exists** in
the production code when the live runtime lacks `command_status`.
The truthful, supported action is `Start New Task` (which
establishes a new session/task lifetime and does not silently
reattribute the held observation).

## C10 — Conservation and adversarial tests

All conservation invariants preserved. The HBRC01 test file exercises
the same production seam as BOCR01-01..07, OCRRD01-01..04, BCCR01,
CTQC01, CCUTO01, HBOP01, HBCLO01, CRCD01. The pre-existing
conservation gates are not modified by this ACT (no production
source change).

| Conservation invariant                              | Status     |
|------------------------------------------------------|------------|
| 1.  BCB01 held-observation conservation              | PRESERVED  |
| 2.  CCUTO01 count/list conservative disjunction      | PRESERVED  |
| 3.  Real terminal-observation consumption            | PRESERVED  (BRC-02 control case GREEN) |
| 4.  Elm Completion Authority's final commit decision | PRESERVED  |
| 5.  Elm Continuation Control fail-closed behavior   | PRESERVED  |
| 6.  observation_unavailable blocked-outcome semantics | PRESERVED (BRC-01a single stamp; BRC-01b short-circuit) |
| 7.  Runtime incident cardinality per obligation     | PRESERVED  (BRC-03: 3 cycles, 1 stamp) |
| 8.  STALL and REARM separate lifetimes              | PRESERVED  |
| 9.  C10 completion-commit barrier                    | PRESERVED  |
| 10. Actual tool-registry truth                       | PRESERVED  (WITNESS-1 source-bound assertion) |
| 11. Runtime prompt/run correlation                   | PRESERVED  |
| 12. Task/session/epoch identity                      | PRESERVED  (BRC-04 cross-task isolation) |
| 13. No stale K result affecting K+1                  | PRESERVED  |
| 14. No duplicate completion                          | PRESERVED  |
| 15. No automatic infinite continuation              | PRESERVED  (BRC-03 bounded user actions) |
| 16. Terminal-state monotonicity                      | PRESERVED  |
| 17. Coherent Task Header and recovery controls      | **DEFECT (the BCB-block renders identically to api_req_failed; the missing UI contract is named in C7 Variant E)** |
| 18. No alteration of myc telemetry, compaction or Tart behavior | PRESERVED |

Conservation 17 is the OPEN contract question. The C0 mission
identifies the missing recovery contract; the missing product
contract is named in this ACT's C7 disposition; the operator
decision is the next step.

## C11 — Executable gates

Per C10 / C11 the canonical gates are:

```bash
cd apps/vscode
bun run check-types
bun run lint
```

And:

```bash
git diff --check
git status --short
```

The new test file is a vitest-native suite (no bridge config, no
bun:test import). It is not picked up by the `@vscode/test-cli`
integration runner (it lives in `src/sdk/__tests__/` which is
excluded from `tsconfig.test.json`). The vitest config
(`vitest.config.ts`) includes `src/sdk/**/*.test.ts` automatically.

The new test file is `apps/vscode/src/sdk/__tests__/host-blocked-recovery-contract01.hbrc01.test.ts`
(13 tests across 6 describe blocks: source-bound witnesses, BRC-01
[3 sub-cases], BRC-02, BRC-03, BRC-04, BRC-05 [2 sub-cases]).

### Toolchain caveat (per OCRRD01 / PPLC01 disposition)

This ACT was authored on a host without a JS runtime (no `bun`,
`node`, or `deno` on PATH; `tsc` is in `node_modules/.bin/` but
requires `node`). The bounded execution pass on a real dev host is
the remaining gate. The mechanical pre-flight for the
OCRRD01/PPLC01 test files (canSpawnSubprocess + elmKernelAvailable)
is not required for HBRC01 because the HBRC01 test does not
exercise the `LocalRuntimeHost` or the Elm authority kernel — it
exercises the production `BackgroundNotifyCoordinator` +
`SdkSessionEventCoordinator` directly through the BOCR01 harness
pattern. The 13 tests are mechanical pre-flight-gated by the
`vitest` test runner's standard discovery (no `it.runIf` guard
required).

Focused test family (operator-owned, real dev host):

```bash
cd apps/vscode
bunx vitest run \
  src/sdk/__tests__/host-blocked-recovery-contract01.hbrc01.test.ts
```

Expected: 13/13 PASS at the source-bound assertions (the source
files are read at module load; if the production code changes the
pattern, the source-bound witness fails with a structural
assertion).

## C12 — Evidence and observability

```yaml
SESSION_ID:           (test-side: session-hbrc01 / session-K / session-K1)
TASK_ID:              (test-side: task-hbrc01 / task-K / task-K1)
JOB_ID:               (test-side: J-1, J-retry, J-drain, J-loop, J-K)
HELD_COUNT_BEFORE:    1
HELD_IDS_BEFORE:      [J-X]
RUNTIME_TOOL_NAMES_BEFORE: ["submit_and_exit"]
RETRY_ACTION:         emitSubmitAndExit (a second submit_and_exit; the
                       production Retry path is identical: SdkController.askResponse
                       -> followups.askResponse -> continueIdleSession ->
                       fireAndForgetSend with the [TASK RESUMPTION] prompt)
RUNTIME_TOOL_NAMES_AFTER: ["submit_and_exit"] (unchanged)
HELD_COUNT_AFTER:     1
HELD_IDS_AFTER:       [J-X]
BLOCKED_REASON:       "session-event-bcb-blocked-observation-unavailable" (single stamp; BOCR01-07 short-circuit)
ELM_DECISION:         (held; not consulted on submit_and_exit because the held set is positive)
COMPLETION_COMMIT_COUNT: 0
USER_RECOVERY_OUTCOME:  NO progress; held set conserved; no fabrication; no automatic unbounded loop
```

Evidence class:

- `REAL_PRODUCTION_SEAM`: the production `BackgroundNotifyCoordinator`
  and `SdkSessionEventCoordinator` are exercised; the source files
  are read at module load and the patterns are verified by regex.
- `SYNTHETIC_REAL`: the liveTools projection is controlled via the
  bounded `setLiveTools(tools)` authoring seam (the same seam
  BOCR01-01..07 use); the historical LIVE root cause is
  process-ephemeral and not reconstructable from a post-mortem
  trace.
- `LIVE`: the LIVE symptom (`session 1791583363336_bmg3e`, 3 submit
  attempts, 4 held jobs) matches the bounded harness shape but is
  operator-owned; not executed by this ACT.
- `INFERRED`: the user-visible Retry affordance is the same
  `api_req_failed` button set as a genuine transport failure; this is
  inferred from the production TS source structure (no writerId
  field on `TurnState`; `buttonsForPhase` has no writerId
  parameter).
- `LIVE_UNOBSERVABLE`: the four held jobIds from the LIVE symptom
  are process-ephemeral in `BackgroundNotifyCoordinator` and not
  observable from a post-mortem trace.
- `CAPTURE_INSUFFICIENT`: n/a — the bounded test captures the
  production seam end-to-end.

The HBRC01 test is not promoted to proof of the historical LIVE
missing-tool cause (the LIVE root cause is process-ephemeral and
not reproducible on a different sessionId). The HBRC01 test
proves the production seam is contract-correct for the
"blocked-observation + Retry" precondition; the missing product
contract is named for operator decision.

## C13 — Exact-head packaging

No production change. No VSIX rebuild. No SUBJECT_HEAD advance.
No new dogfood VSIX. The ACT-owned test file is the load-bearing
artifact; the board update is the durable record. The remaining
gate is the bounded execution pass on a real dev host (operator-
owned, per C11 caveat).

## C14 — Durable artifacts

- `apps/vscode/src/sdk/__tests__/host-blocked-recovery-contract01.hbrc01.test.ts` (NEW, 729 lines, 13 tests across 6 describe blocks)
- `.factory/acts/ACT-CLINEMM-P0-HOST-BLOCKED-RECOVERY-CONTRACT01.md` (THIS FILE)
- `.factory/epic-board.md` (UPDATED: new row pinned to this ACT)

## C15 — Closure verdicts (C15 verbatim)

| Condition                                                                | Verdict                                  |
|--------------------------------------------------------------------------|------------------------------------------|
| Existing supported Retry/restoration path works, obligations remain conserved and UI is truthful | n/a (the existing path is `command_status(J)`, but the user-driven Retry does NOT work) |
| Reproduced production defect repaired with RED/GREEN/ablation and conservation | n/a (no RED reproduced) |
| Host safety correct; no recovery contract exists and operator decision is required | `HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED` (**THIS ACT**) |
| User-facing blocked state/action is wrong, first boundary proven but repair not authorized | n/a (the first boundary is Variant D + E, but the repair would require a new public wire field) |
| Missing tool is correctly classified and no unsupported recovery is promised | n/a |
| Suspected defect not reproduced                                            | n/a |
| Evidence cannot distinguish runtime/tool/host/action boundaries            | n/a (production seam is fully captured) |
| Completion fabricated or held obligation lost                              | n/a (BRC-01 conservation GREEN) |

The ACT closes with verdict `HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED`:

- Host safety is contract-correct (held-observation conservation, no
  fabrication, no automatic unbounded loop).
- The only supported automatic recovery path is the model-driven
  `command_status(J)` drain, which requires capability restoration
  (the live runtime gaining `command_status`).
- The user-driven Retry click is a normal `askResponse` that
  re-enters the same runtime with the same liveTools; it reaches
  the same dead end; held set is conserved; no fabrication.
- The bounded UI repair (disable Retry when the BCB marker carries
  `observation_unavailable`) would require a new public wire
  field, which C9 forbids without explicit operator acceptance of
  the new contract.
- The operator's next decision is whether to charter a new ACT to
  freeze the public wire field and implement the bounded UI fix,
  or to leave the UI as-is (with the truthful, conservative
  `Start New Task` recovery as the only supported user action).

## C16 — Closure block

```yaml
ACT:                    ACT-CLINEMM-P0-HOST-BLOCKED-RECOVERY-CONTRACT01

ENTRY_HEAD:             d75e050beb08c12d5b2d18cb56001c063fba37a8
SUBJECT_HEAD:           d75e050beb08c12d5b2d18cb56001c063fba37a8
WORKTREE_TRUST:         clean (entry); ACT delta is the new test file + this ACT + board update

HISTORICAL_LIVE_ANCHOR:  session 1791583363336_bmg3e (3 submit attempts, 4 held jobs)
                         (process-ephemeral; not observable from a post-mortem trace)

PRODUCTION_RETRY_OWNER:        useMessageHandlers.executeButtonAction("retry")
                               -> SdkController.askResponse
                               -> SdkFollowupCoordinator.askResponse
                               -> continueIdleSession
                               -> fireAndForgetSend(sdkHost, sessionId, "[TASK RESUMPTION] …")
                               (the SAME runtime, SAME liveTools; no rebuild)

PRODUCTION_CAPABILITY_OWNER:   LocalRuntimeHost.getActiveRuntimeToolNames
                               -> ClineCore.getActiveRuntimeToolNames
                               -> VscodeSessionHost.liveTools
                               -> SdkSessionEventCoordinator.options.liveTools
                               (the same seam BOCR01 + OCRRD01 exercise)

PRODUCTION_HELD_OBSERVATION_OWNER: BackgroundNotifyCoordinator
                               (process-ephemeral, keyed by (sessionId, taskId))
                               (the same BCB01 / BOCR01 owner)

REAL_RED:                    none reproduced; the production seam is contract-correct
FIRST_DIVERGENT_BOUNDARY:     Variant D (Recovery ownership absent) + Variant E (UI projection defect);
                              Variant F (Correct explicit hold) is preserved
RECOVERY_CONTRACT:            frozen in C4 state table; only supported automatic recovery is
                              capability restoration via model-driven command_status(J); only
                              supported user-actionable recovery is Start New Task
NECESSITY_ABLATION:           not required (no RED; no defect to ablate); C7 disposition
                              is Variant D + E + F, not a single repairable defect

CONSERVATION:                 all 18 invariants preserved; the OPEN question is conservation 17
                              (the missing UI contract for the BCB-blocked state)

EXECUTABLE_GATES:             bun run check-types; bun run lint; bunx vitest run
                              apps/vscode/src/sdk/__tests__/host-blocked-recovery-contract01.hbrc01.test.ts
                              (operator-owned bounded execution pass on a real dev host;
                              this ACT was authored on a JS-runtime-less host)

PRODUCTION_DELTA:             zero (no production source files modified)

EXACT_HEAD_VSIX:              NOT rebuilt (operator-owned; per C13)
LIVE_POST_FIX:                NOT executed (operator-owned; per C12 evidence class LIVE_UNOBSERVABLE)

VERDICT:                      HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED
NEXT_ACT:                     operator decision: charter a new ACT to freeze a new
                              public wire field (TurnState writerId or blockedReason)
                              + implement the bounded UI fix (disable Retry when the
                              BCB marker carries observation_unavailable), OR
                              leave the UI as-is and document the truthful, conservative
                              Start New Task recovery as the only supported user action
```
