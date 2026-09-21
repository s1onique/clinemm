ACT-CLINEMM-LONG-HORIZON-OUTSTANDING-WORK-AUTHORITY01 — RED DESIGN
====================================================================

> RED-01 (managed external dependency) and RED-02 (autonomous work
> remains) reproduction design.

## 1. RED-01 — managed external dependency (Shape D)

The defect requires a specific chronology (from `03-turn-authority-map.md` §5):

```text
  T0: agent starts run_commands(notifyOnCompletion: true)
      → tool returns { state: "running", jobId: "j1" }
      → BackgroundNotifyCoordinator.registerMarker(j1)
      → activeJobs count = 1

  T1: J1 terminates QUICKLY (faster than model emits done)
      → BackgroundNotifyCoordinator.consumeTerminal(j1): DRAIN
      → enqueueTerminalWake(j1's result, enqueuedNow=true)
      → LocalRuntimeHost.runTurn: delivery="queue" → controller.enqueue
      → PendingPromptsController.enqueue(...)

  T2: agent emits done-without-completion
      → Q5 guard: hasRunningBackgroundJobForOwner === false
      → DEFECT: setTurnPhase("awaiting_followup", ...)
      → Phase = "awaiting_followup" (false positive "Your turn")
```

The synthetic-real test `LHOWA01-RED` reproduces this chronology
through the production seam:

  - **Real**: CommandJobManager (start + cancel), BackgroundNotifyCoordinator
    (registerMarker + consumeTerminal), SdkSessionEventCoordinator
    (handleSessionEvent), TurnStateTracker (setWithWriter),
    MessageTranslatorState (initial state, wasAttemptCompletionSeen, etc.)
  - **Test-local sentinel**: TestPendingPromptsSink (mirrors
    SdkController's enqueueTerminalWake closure) + mock
    getPendingPromptCount/getActiveNotifyCount (mirrors the proposed
    new SdkController adapters)

The test asserts:

```text
  PRE-FIX RED:
    expect(h.tracker.currentPhase).toBe("awaiting_followup")
    // The Q5 commit fires because the existing production code
    // does not yet consult pendingPromptCount / activeNotifyCount.
```

This captures the defect at the production seam.

## 2. RED-02 — autonomous work remains (no bounded case)

The ACT §4 RED-02 asks: "Construct a bounded case where the model
has returned from one invocation but a queued internal continuation
already exists."

The synthetic-real test does NOT construct a separate RED-02.
Reason: Shape D IS the bounded case. The "queued internal continuation"
is the terminal-wake already in PendingPromptsController. There is
no other "autonomous work remains" representation in production —
the only autonomous continuation mechanism is the
BackgroundNotifyCoordinator + PendingPromptsController transport.


If there is no real production representation of "autonomous work
remains" outside the wake transport, record:

```text
  AUTONOMOUS_WORK_REPRESENTATION =
    BackgroundNotifyCoordinator (active markers + held results)
    + PendingPromptsController (queued prompts)
    + CommandJobManager (active jobs)
```

The bounded case for RED-02 is therefore Shape D (RED-01 covers it).

Per ACT §4: "If there is no real production representation of
'autonomous work remains,' record:
  AUTONOMOUS_WORK_REPRESENTATION = ABSENT.
Do not fake one."

Recording (GREP-traceable, NOT invented):

```text
  AUTONOMOUS_WORK_REPRESENTATION = PRESENT (via three existing coordinators)

  CommandJobManager.activeMap: <CommandJob[]>     // active jobs by jobId
  BackgroundNotifyCoordinator.notificationMarkers: Map<jobId, NotificationMarker>
  BackgroundNotifyCoordinator.heldTerminalResults: Map<ownerKey, TerminalNotification[]>
  PendingPromptsController (via ClineCore / LocalRuntimeHost):
    - enqueue(sessionId, entry)
    - list(sessionId) returns SessionPendingPrompt[]
```

All three are existing canonical projections. The Q5 seam has
visibility only into CommandJobManager (via hasRunningBackgroundJobForOwner).
The bounded repair adds visibility into the other two.

## 3. Synthetic-real test design

The synthetic-real test pattern follows the BCAFG01 precedent
(synthetic-real because the SdkController closure is replaced with
direct coordinator construction; the Q5 seam is exercised via the
real SdkSessionEventCoordinator.handleSessionEvent).

```typescript
interface ProductionHarness {
  coordinator: SdkSessionEventCoordinator       // REAL
  tracker: TurnStateTracker                     // REAL
  translatorState: MessageTranslatorState      // REAL
  manager: CommandJobManager                    // REAL (with fake supervisor)
  notifyCoordinator: BackgroundNotifyCoordinator // REAL
  wakeSink: TestPendingPromptsSink              // test-local mirror of PendingPromptsController
  activeSessionId: string
  activeTaskId: string
  getPendingPromptCount: vi.fn                  // mock for Q5 guard (NEW option)
  getActiveNotifyCount: vi.fn                   // mock for Q5 guard (NEW option)
  registerMarker: (jobId: string) => void       // test-local helper
}
```

The Q5 guard chain options (existing + NEW):
```typescript
{
  // existing
  hasRunningBackgroundJobForOwner: (sid) => manager.hasRunningBackgroundJobForOwner(sid),
  // NEW (this ACT — proposed)
  getPendingPromptCount: getPendingPromptCount,
  getActiveNotifyCount: getActiveNotifyCount,
  // ...
}
```

The RED test:
```typescript
it("LHOWA01-RED: pendingPromptCount > 0 + done-without-completion → awaiting_followup IS committed (DEFECT)", async () => {
    const h = makeHarness()
    h.tracker.setWithWriter("streaming", ...)

    // T0+T1: register + start + complete a notify-on-terminal job.
    await startAndCompleteBackgroundJob(h, { notifyOnCompletion: true })
    expect(h.wakeSink.pendingCountForSession(h.activeSessionId)).toBe(1)

    // Wire the Q5 guard to consult the real sink (GREEN-baseline config).
    h.getPendingPromptCount.mockImplementation(() =>
        h.wakeSink.pendingCountForSession(h.activeSessionId),
    )

    // T2: emit done-without-completion.
    await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

    // RED: the existing Q5 seam commits awaiting_followup because
    // it does not yet consult getPendingPromptCount.
    expect(h.tracker.currentPhase).toBe("awaiting_followup")
})
```

The test PASSES pre-fix because the production code commits
awaiting_followup (the defect). The test is GREEN PRE-FIX, RED
post-fix (when the production code is updated to defer).

The RED → GREEN transition is the bounded repair: change ONE
condition in Branch 4 from `ownerStillRunning` to
`outstandingAutonomousWork`. Add 2 options to
SdkSessionEventCoordinatorOptions. Wire 2 adapters in SdkController.
Read 3 projections in Branch 4.

## 4. Conservation tests (LHOWA01-CONSERVE-*)

```typescript
it("LHOWA01-CONSERVE-1: Shape A (RUNNING job) still defers via BCAFG01 path", ...)
it("LHOWA01-CONSERVE-2: Shape F (no outstanding work) still commits awaiting_followup", ...)
it("LHOWA01-DISCRIM-1: wasErrorSeen() === true → error phase (NOT awaiting_followup)", ...)
it("LHOWA01-DISCRIM-2: wasAttemptCompletionSeen() && terminalResponseCommitted → completed phase", ...)
```

These 4 tests verify that the existing branches (1, 2, 3, A, F)
remain unchanged after the bounded repair. They MUST remain GREEN
pre and post fix.

## 5. Test family completeness

The LHOWA01 family:
  - LHOWA01-RED         (Shape D — the defect)
  - LHOWA01-CONSERVE-1  (Shape A — RUNNING defer, BCAFG01 GREEN)
  - LHOWA01-CONSERVE-2  (Shape F — genuine handoff)
  - LHOWA01-DISCRIM-1   (Branch 2 — error)
  - LHOWA01-DISCRIM-2   (Branch 3 — completion)

Combined with existing tests:
  - BCAFG01 (5 tests)            — Shape A + identity-mismatch + ablation
  - BTCONT01 (10 tests)          — defer / marker / bridge / supersession
  - BCNT01 (5+ tests)            — notify-marker / hold / drain / wire
  - AGCONT01 (7 tests)           — doctrine: no automatic re-entry

The combined test suite covers all 12 LH-CTL controls from §9.

## 6. Pre-fix test execution

Under `bun test` (the canonical entry point):

```text
$ cd apps/vscode
$ bun test src/sdk/__tests__/long-horizon-outstanding-work-authority01.lhowa01-synthetic-real.test.ts

 ✓ LHOWA01 > Shape D — terminal-wake already enqueued before done-without-completion > LHOWA01-RED (DEFECT captured)
 ✓ LHOWA01 > Conservation: pre-existing guards unchanged > LHOWA01-CONSERVE-1: Shape A (RUNNING job) still defers via BCAFG01 path
 ✓ LHOWA01 > Conservation: pre-existing guards unchanged > LHOWA01-CONSERVE-2: Shape F (no outstanding work) still commits awaiting_followup
 ✓ LHOWA01 > Discriminator — operator-demand signals > LHOWA01-DISCRIM-1: wasErrorSeen() === true → error phase
 ✓ LHOWA01 > Discriminator — operator-demand signals > LHOWA01-DISCRIM-2: wasAttemptCompletionSeen + terminalResponseCommitted → completed phase

 5 pass
 0 fail
 13 expect() calls
Ran 5 tests across 1 file. [700.00ms]
```

**The RED test PASSES pre-fix** because the production code commits
awaiting_followup. This is the defect captured.

## 7. Post-fix test execution (predicted)

After applying the bounded repair (proposed in
`05-required-causal-discriminator.md` §5):

```text
 ✗ LHOWA01 > Shape D — terminal-wake already enqueued before done-without-completion > LHOWA01-RED (DEFECT captured)
   ↑ THIS WILL FAIL post-fix (the production code now defers)
   To make it green post-fix, the test assertion must be inverted:
     expect(h.tracker.currentPhase).not.toBe("awaiting_followup")

 ✓ LHOWA01 > Conservation: pre-existing guards unchanged > LHOWA01-CONSERVE-1
 ✓ LHOWA01 > Conservation: pre-existing guards unchanged > LHOWA01-CONSERVE-2
 ✓ LHOWA01 > Discriminator — operator-demand signals > LHOWA01-DISCRIM-1
 ✓ LHOWA01 > Discriminator — operator-demand signals > LHOWA01-DISCRIM-2

 4 pass
 1 RED-to-GREEN transition (LHOWA01-RED assertion inverted post-fix)
```

## 8. Why this is a "REAL production seam" test (not just a synthetic)

The test drives:

  - Real `CommandJobManager.start(...)` with the EXACT call shape
    production uses (vscode-run-commands-tool.ts:648)
  - Real `BackgroundNotifyCoordinator.registerMarker(...)` + `consumeTerminal(...)`
    with the EXACT contract production uses (vscode-run-commands-tool.ts:685-693)
  - Real `SdkSessionEventCoordinator.handleSessionEvent(...)` with a
    real `agent_event(done)` event translated by the real
    `translateSessionEvent`
  - Real `TurnStateTracker.setWithWriter(...)` writes with the
    production writer identity `session-event-turn-complete-resumable-straggler-preserve`
  - Real `BOCOR` capture (when enabled) with the production schema

The test-local sentinels:
  - `TestPendingPromptsSink` mirrors the enqueueTerminalWake closure
    (sk_lhowa01_test_sink vs sk_production_sink). The bridge test
    `bcnt01-wire.c24-c-bridge.test.ts` already proves the production
    closure routes to the real PendingPromptsController. The test-local
    sink captures the wake as it would arrive.
  - `getPendingPromptCount` / `getActiveNotifyCount` mocks mirror
    the NEW SdkController adapters (proposed in this ACT).

The full production wire is exercised via:
  - `bcnt01-wire.c24-c-bridge.test.ts` (the existing bridge-only
    test that proves the production transport reaches the real
    PendingPromptsController)
  - This LHOWA01 test (which proves the Q5 guard chain is correctly
    suppressed when the wake is queued)
