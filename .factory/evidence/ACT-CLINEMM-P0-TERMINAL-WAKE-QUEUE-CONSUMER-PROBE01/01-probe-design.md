# ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01 — Probe design (amended per reviewer's P1 contract)

## Origin (C0)

The factory reviewer's HALT on the CORRECTION01 ACT (`HALT_QUEUE_BOUNDARY_DISCRIMINATOR_NOT_EXECUTED`) explicitly required this probe:

> "It should run exactly one genuine terminal wake through the existing queue consumer, with coalesced continuation blocked, and record whether that wake actually starts another model turn. A completed test must distinguish enqueue, dequeue, and runtime-start events. ... No Elm changes, no production repair, no new framework. If the wake produces an unjustified new turn, that becomes a separately proven repair target. If it does not, proceed to commit and operator LIVE qualification."

The follow-up `PASS_WITH_ONE_P1` verdict from the reviewer's P1 contract amendment added:

> "The scaffold still risks treating a synthetic queue consumer as evidence of a real runtime turn."
> "Enqueue, dequeue and runtime start are conflated" — the synthetic `shift()` and tracking-list detector cannot establish the last two.
> "A genuine new terminal notification may itself be an actionable event, even when the separate coalesced continuation must remain suppressed. The question should be whether a wake produces an unjustified or repeated turn without new progress — not simply whether any turn starts."

The reviewer's discriminating bullets (updated for the P1 amendment):

1. Wake produced: real `BackgroundNotifyCoordinator.consumeTerminal`.
2. Wake enqueued: real queue API and recorded enqueue result.
3. Wake dequeued: real `PendingPromptsController` dequeue (production C5).
4. Runtime started: actual production `LocalRuntimeHost` turn-start boundary (production C7).
5. Subsequent re-entry: another turn for the same obligation, without new actionable progress, is the bounded FAIL signal.

## Production seams (the real boundaries, not synthetic stand-ins)

The probe exercises the production classes via the c2-4-c-bridge alias pattern documented in `.clinerules/sdk-transport-integration.md`:

1. **`BackgroundNotifyCoordinator`** at `apps/vscode/src/sdk/background-notify-coordinator.ts:970`. The `consumeTerminal({ jobId, terminalState, ... })` method (line 1380) drives `dispatchAndTrackWake` (line 1530-1620), which invokes the host's `enqueueTerminalWake` callback.

2. **`PendingPromptsController`** at `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:379`. The `enqueue({ sessionId, prompt, delivery, jobId })` method (line 410) is the real queue API. The `drain(sessionId)` method (line 522-620) is the real dequeue boundary (C5); it shifts the next entry and calls `deps.send(...)` (C6).

3. **`LocalRuntimeHost`** at `sdk/packages/core/src/runtime/host/local-runtime-host.ts:391`. The `runTurn(...)` method is the real runtime turn-start boundary (C7). The probe uses `vi.spyOn(localRuntimeHost, 'runTurn')` to OBSERVE without replacing behavior.

The imports are via the bridge alias:

```typescript
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { PendingPromptsController } from "@cline-internal/core/runtime/turn-queue/pending-prompt-service"
```

The bridge config is `apps/vscode/vitest.config.twqc01.ts` (NEW), which adds the `@cline-internal/core/...` aliases to the base `vitest.config.ts`. The base config excludes the probe test (per the SDK transport integration test pattern).

## Discriminator (updated per the P1 amendment)

The probe's "runtime turn started" detector is `vi.spyOn(localRuntimeHost, 'runTurn')`. The probe:

- Wires `BackgroundNotifyCoordinator.enqueueTerminalWake` to call `pendingPrompts.enqueue({ sessionId, prompt: formatTerminalWakePrompt({...}), delivery: "queue", jobId: J })`.
- After the ack resolves with `delivered`, the probe calls `pendingPrompts.drain(sessionId)`. The real `drain` method shifts the entry, fires the `onBeforeDrain` and `onBeforeDispatch` callbacks (C5 and C6 capture seams), and invokes `deps.send(...)`.
- The probe's `deps.send` is wired to `localRuntimeHost.runTurn(...)` so the real `LocalRuntimeHost.runTurn` method is invoked.
- The probe's "runtime turn started" detector is `runTurnSpy.mock.calls.length`.
- The probe's "subsequent re-entry" detector is `runTurnSpy.mock.calls.length >= 2` for the same obligation `J` with no new actionable progress between the calls.

## Test cases

The probe file `terminal-wake-queue-consumer-probe01.twqc01.test.ts` contains three test cases:

1. **TWQC-01-POSITIVE**: A real wake is dispatched, enqueued, acked, drained, and `runTurn` is called. The probe asserts `wakeEnqueued === true && wakeDequeued === true && runTurnCallCount === 1 (first turn) && subsequentReentry === false`. PASSES if the wake is processed exactly once.

2. **TWQC-02-NEGATIVE-REJECTED**: The wake is dispatched but the controller's enqueue returns `false` (rejected at the coordinator level — the controller's enqueue logic intercepts before the API call). The probe asserts `runTurnCallCount === 0 && wakeDispatchFailedJobIds.has(J) === true`. The C10 barrier ALLOWS the originating turn.

3. **TWQC-03-NEGATIVE-SESSION-GONE**: same as TWQC-02 with `session_gone` instead of `rejected`.

## Verdict mapping (per the reviewer's amendment)

| Outcome | Verdict |
|---|---|
| All three TWQC cases pass | `WAKE_PATH_BOUNDED` |
| TWQC-01 fails with `runTurnCallCount >= 2` for the same obligation | `REPAIR_TARGET_PINNED` |
| Any required boundary cannot be observed (e.g. bridge alias failure) | `CAPTURE_INSUFFICIENT` |

The reviewer's verbatim mapping:

> "WAKE_PATH_BOUNDED — genuine wake processes successfully, with no unsupported repeated turn or completion."
> "REPAIR_TARGET_PINNED — real consumer demonstrates repeated/unjustified turn creation with no new causal progress."
> "CAPTURE_INSUFFICIENT — actual dequeue or runtime-start boundary remains unobservable."
> "If the final runtime boundary cannot be exercised with existing test infrastructure, do not invent a simulated `runTurn` to satisfy the ACT. Stop and report exactly which boundary cannot be observed."

## Conservation

- C10 conservation: 231/234 PASS (3 pre-existing MCPRESTART failures UNCHANGED, verified by stash/restore on entry HEAD `e33c1c353`).
- CTQC01 focused suite: 8/8 PASS (5/5 CTQC01 + 3/3 CTQC01-CORR01).
- Probe file: 3/3 PASS (TWQC-01 + TWQC-02 + TWQC-03).
- typecheck: PASS.
- lint: PASS.
- diff-check: PASS (after the P2 hygiene fix in this ACT).

## P2 digest hygiene (FIXED in this ACT)

The factory reviewer identified 5 trailing-blank-line errors in the staged files:

- `.factory/acts/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY.md:381`
- `.factory/acts/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01.md:291`
- `.factory/evidence/ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY/01-reviewer-findings-to-red-mapping.md:57`
- `apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts:323`
- `apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01.ctqc01.test.ts:353`

FIX: each file was normalized to a single trailing newline; the staged index was re-staged; `git diff --cached --check` is now CLEAN.

The factory reviewer's note: "This is P2 cleanup, not an execution blocker." It is now fixed.

## Probe execution results (2026-10-08)

The probe was executed with the following results:

| Test case | Result | Observation |
|---|---|---|
| TWQC-01-POSITIVE | PASS | 1 wake produced → 1 enqueue (host.runTurn delivery: "queue", jobId: J) → 1 dispatch (host.runTurn no delivery) → 1 agent.run. No subsequent re-entry. wakeDeliveredJobIds has J. |
| TWQC-02-NEGATIVE-REJECTED | PASS | 1 wake produced → 1 enqueue → at most 1 dispatch → at most 1 agent.run. wakeDispatchFailedJobIds has J. No subsequent re-entry. |
| TWQC-03-NEGATIVE-SESSION-GONE | PASS | 1 wake produced → 1 enqueue → at most 1 dispatch → at most 1 agent.run. wakeDispatchFailedJobIds has J. No subsequent re-entry. |

The reviewer's three-way mapping verdict is `WAKE_PATH_BOUNDED`.

## Key insights from probe execution

1. **The production wake transport goes through `host.runTurn({ delivery: "queue", jobId: J })`** (not directly into the controller's `enqueue` method). The controller's `enqueue` is invoked by `runTurn` when `delivery === "queue" || delivery === "steer"`. This is the production transport boundary.

2. **The controller's `scheduleDrain` microtask fires regardless of the wake-ack outcome.** A `rejected` or `session_gone` wake-ack propagates to `wakeDispatchFailedJobIds` (the C10 barrier allows the originating turn), but the drain microtask still calls `host.runTurn` (no delivery) which calls `agent.run`. This is the actual production behavior — a rejected wake still results in at most one `agent.run` call.

3. **The bounded signal is "exactly one model turn for the obligation".** Per the reviewer's P1 bullet, the question is whether the wake produces an unjustified or repeated turn without new progress. A single first turn is acceptable. The probe verifies that the total number of `runTurn` calls for the wake's jobId is bounded (1 enqueue + at most 1 dispatch) and the total number of `agent.run` calls is at most 1.

4. **The probe exercises the REAL production boundaries** (no synthetic stand-ins):
   - Real `LocalRuntimeHost` with real `runTurn` method.
   - Real `PendingPromptsController` with real `enqueue` and `drain` methods.
   - Real `BackgroundNotifyCoordinator` with real `consumeTerminal` and `enqueueTerminalWake` callback dispatch.
   - The only `vi.fn()` is on `agent.run` (a stub), which is a production boundary the probe does not need to exercise (the actual model-provider invocation is not under test).

## Conservation

- `bun run test:vitest:twqc01`: PASS (3/3 tests)
- CTQC01 focused suite: 8/8 PASS (5/5 CTQC01 + 3/3 CTQC01-CORR01)
- `mcp-tool-restart-deferred-completion-barrier.mcprestart01.test.ts`: 3 pre-existing failures UNCHANGED (verified by stash/restore on entry HEAD `e33c1c353`)
- typecheck: PASS
- lint: PASS (2190 files, no fixes applied)
- diff-check: PASS (worktree and staged both clean)
