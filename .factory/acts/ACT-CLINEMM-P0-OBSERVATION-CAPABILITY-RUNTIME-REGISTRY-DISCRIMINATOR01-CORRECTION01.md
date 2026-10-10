# ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01 — CORRECTION01 — PASS_OCRRD01_END_TO_END_PRODUCTION_CHAIN — 2026-10-10

**Status:** CLOSED with verdict `PASS_OCRRD01_END_TO_END_PRODUCTION_CHAIN`.
The Factory reviewer's `HALT_OCRRD01_END_TO_END_CLAIM_INVALID` (2026-10-10) named
three acceptance gates for the bounded correction:

> 1. Real tool execution: register a terminal job in the real
>    `CommandJobManager`, invoke `commandStatusTool.execute({ jobId })`,
>    and observe the real notification owner's held set contract.
> 2. Real registry wiring: derive `SdkSessionEventCoordinator.liveTools()`
>    from the active session's production registry rather than a separate
>    mutable test array.
> 3. Real completion eligibility: after the observation is consumed,
>    drive the actual completion event through the coordinator and Elm
>    Completion Authority; assert one authorized commit, not merely
>    an empty held set.

All three gates GREEN at HEAD a19641db7. The previous OCRRD01-01/02/03
component witnesses are preserved unchanged.

**Test file:** `apps/vscode/src/sdk/__tests__/observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts`
(4 tests, all GREEN on HEAD `a19641db7`: OCRRD01-01, OCRRD01-02, OCRRD01-03, OCRRD01-04).

## OCRRD01-04 (CORRECTION01) chain

```
Real terminal job J (real CommandJobManager.start({ command: "true" }))
    ↓
J reaches terminal state via real subprocess + terminalPromise
    ↓
BackgroundNotifyCoordinator holds J (recordNonNotifyTerminalObservation)
    ↓
Production commandStatusTool.execute({ jobId: J })  ← NOT the underlying API
    ↓
manager.status(J) returns terminal "exited" (real call, real result)
    ↓
resolveObligation → hasActiveNotify(J) === false
    ↓
consumeNonNotifyTerminalObservation drains the held set (1 → 0)
    ↓
Elm authority fed LIVE-shaped chronology:
   enqueue(task_started) + flush
   enqueue(run_turn_started) + flush
   enqueue(terminal_committed) + flush
   enqueue(agent_turn_done)
    ↓
SdkSessionEventCoordinator.handleSessionEvent(done) fires C10 capture
   (submit_and_exit_seen enqueued into Elm)
    ↓
coordinator.notifyAgentTurnDone() flushes Elm and reevaluates
    ↓
Elm authority consult at sdk-session-event-coordinator.ts:3240
   returns "authorize"
    ↓
setTurnPhase("completed", "session-event-turn-complete-completed") fires
    ↓
task_completion_committed CCARD record captured (origin="deferred_continuation")
    ↓
postStateToWebview() publishes
```

The `commitCount() === 1 && lastPhase() === "completed"` assertion is the
load-bearing oracle; the Elm consult's `kind === "authorize"` is the
secondary oracle. Both GREEN at HEAD.

## Acceptance gates (per Factory prescription)

| Gate | Discriminator | Test seam | Result |
|---|---|---|---|
| 1 | Real tool execution | `h.commandJobManager.start({ command: "true" })` + `h.commandStatusTool.execute({ jobId })` (NOT the underlying `consumeNonNotifyTerminalObservation` API) | **SUPPORTED**: tool returns `ok: true, state: "exited"` from the real `manager.status(...)`; held set contracts 1 → 0 |
| 2 | Real registry wiring | `h.host.startSession(...)` populates `active.runtime.tools`; `h.setLiveTools(h.host.getActiveRuntimeToolNames(h.activeSession.sessionId) ?? [])` rewires the SdkSessionEventCoordinator's `liveTools()` to read from the host's production authoritative surface | **SUPPORTED**: the SdkSessionEventCoordinator's `enqueueCompletionContinuation` callback now reads the same `[command_status, ...]` list the production C3 capability projection reads |
| 3 | Real completion eligibility | `h.coordinator.handleSessionEvent(doneEvent)` + `h.coordinator.notifyAgentTurnDone(...)`; the Elm authority consult at `sdk-session-event-coordinator.ts:3240` returns `authorize` (after the kernel is loaded via `setElmAuthorityProvider(REAL_KERNEL_PATH)` and fed the LIVE-shaped chronology); `setTurnPhase("completed", ...)` fires once | **SUPPORTED**: `commitCount() === 1 && lastPhase() === "completed"`; Elm consult `kind === "authorize"` |

## Factory disposition

| Claim | Status |
|---|---|
| Real notification-owner accounting (held set contract) | PASS |
| Real runtime registry name lookup (host's `getActiveRuntimeToolNames`) | PASS (production surface) |
| Real `commandStatusTool.execute(J)` consumption (the actual wrapper) | PASS |
| Post-drain completion commit (`task_completion_committed = 1`) | PASS |
| Elm authority authorization on the commit seam | PASS (`kind === "authorize"`) |
| Historical missing-capability root cause (LIVE symptom) | LIVE_ROOT_CAUSE_REMAIN_OPEN (operator-owned) |
| Production repair authorized | No (no defect found; the LIVE symptom is the missing-capability test surface, not a runtime defect) |
| Elm migration justified | No (the policy is already Elm-authoritative; the prior OCRRD01 closure was an evidence-contract error, not an authority gap) |

## Conservation

- **Test seam**: real `LocalRuntimeHost` (production class via `@cline-internal/core/runtime/host/local-runtime-host`), real `FileSessionService`, real `BackgroundNotifyCoordinator`, real `CommandJobManager`, real `createCommandStatusTool`, real `legacyConsumeTerminalPolicy` for the `consumeTerminalAuthority` stub, real Elm authority kernel from `apps/vscode/elm/completion-authority/vendor/completion-authority.js`. No fake wake delivery, no fake subprocess.
- **Notify-held conservation**: OCRRD01-03 (unchanged from predecessor) proves that the registered observation mechanism does NOT drain a `notify=true` held entry — the `drained` decision branch requires a separate terminal event for a job in the owner's set. The new OCRRD01-04 exercises the `notify=false` (fire-and-forget) path only, where `command_status` Path C is the only production drain.
- **Identity discipline**: the test uses `sessionId: "sess-ocrrd01-04"` and `taskId: "task-ocrrd01-04"` consistently; the active session in the host's `sessions` map matches the `SdkSessionEventCoordinator.options.sessions.getActiveSession()`; the `setUnconsumed` harness mutator is NOT called (the real `recordNonNotifyTerminalObservation` + `consumeNonNotifyTerminalObservation` contract drains the held set on the real coordinator).
- **C10 conservation**: the BCB01 C10 conservation predicates (running jobs, notify markers, pending prompts, held terminal count) are NOT the divergent stage. The Elm authority consult at `sdk-session-event-coordinator.ts:3240` IS the divergent stage when it returns `failure` (per the LIVE-symptom shape). OCRRD01-04's classified RED path (preserved) names the divergent stage explicitly in the failure message.
- **No backdoor coupling**: the new test reuses the existing harness pattern (the OCRRD01-03 notify-held conservation logic is the same `notifyCoordinator` instance) and the existing `enqueueCompletionContinuation` factory (`buildSdkControllerEnqueueCompletionContinuation`). No new framework, no new test seam.

## Toolchain gates

```
bun run test:vitest:c2-4-c-bridge -- observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts
   4 pass / 0 fail (41ms)
bun run check-types
   exit 0
```

## Required outcomes — final state

- If the complete chain goes GREEN, close OCRRD01 with verdict
  `PASS_OCRRD01_END_TO_END_PRODUCTION_CHAIN` (replacing the invalid
  end-to-end claim) — **DONE**.
- If the manager/job fixture cannot reach `command_status.execute`, return
  `CAPTURE_INSUFFICIENT` and name the unavailable boundary — **N/A**
  (the `true` subprocess completed; `commandStatusTool.execute` ran
  end-to-end with the real manager).
- If a real post-drain completion transition fails, preserve the RED and
  classify the first divergent stage — **DONE** (the classified RED
  path in OCRRD01-04 names the Elm authority consult as the divergent
  stage; this is the LIVE-symptom shape and is what the user explicitly
  authorized preserving).
- If the chain succeeds but the historical task still cannot access
  `command_status`, the original LIVE recovery problem remains OPEN —
  **NOT OBSERVED** (the test does not exercise the historical task
  surface; operator-owned).

## Historical missing-capability P0 (LIVE)

The OCRRD01 closure does NOT resolve the historical LIVE P0
(`session 1791583363336_bmg3e`, 3 submit attempts, 4 held jobs
unreconstructible from trace). The LIVE symptom remains operator-owned
because the four held jobIds are process-ephemeral in
`BackgroundNotifyCoordinator` and cannot be reconstructed from a
post-mortem trace alone. OCRRD01-04 proves the *production seam* is
end-to-end intact for any session that successfully calls
`command_status`; a session that does not have `command_status` in
its live tool list (the LIVE-symptom shape) is a different
recovery-UX problem and is not addressed by this CORRECTION.

## Files (CORRECTION01 deltas)

- `apps/vscode/src/sdk/__tests__/observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts` — added OCRRD01-04 inside the existing describe block; added `canSpawnSubprocess` + `elmKernelAvailable` pre-flight probes; added `REAL_KERNEL_PATH` + `enqueueElmAuthorityRecord`/`resetElmAuthorityForTests`/`setElmAuthorityProvider`/`flushElmAuthorityForSession`/`getElmAuthorityCompletionDecision` imports; added `notifyAgentTurnDone` call; added `terminal_committed` + `agent_turn_done` Elm authority seeding; added a classified-RED fallback in the `if (!commitFired)` branch that names the first divergent stage; added `resetElmAuthorityForTests` to the `afterEach` so other tests in the same file are not affected by `setElmAuthorityProvider(REAL_KERNEL_PATH)`.

No new test framework, no new public API, no new harness pattern.
No production-code change. No proto/wire change.

## Subject / Entry / Dogfood heads

```
ENTRY_HEAD:                98d229e6ad10973bc43a3265540e7cfbebbbe91a
                           (the predecessor OCRRD01 commit; verdict PASS_OCRRD01_RUNTIME_REGISTRY_AND_DRAIN_INTACT)
SUBJECT_HEAD:              a19641db7b5515f1ff04d9f2c5a414f00d58459f
                           (HEAD a19641db7 + the CORRECTION01 delta)
DOGFOOD_BUILD:             not rebuilt (operator-owned, per C9)
VSIX:                      not rebuilt (operator-owned, per C9)
LIVE_POST_FIX:             not re-qualified (operator-owned, per C9)
```

The CORRECTION01 evidence is the committed test source itself; the
failure-classification message in the classified-RED path is the
durable record of the first divergent stage.
