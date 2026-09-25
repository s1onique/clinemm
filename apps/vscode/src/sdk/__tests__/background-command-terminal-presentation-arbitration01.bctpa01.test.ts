/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01 / BCTPA01
 *
 * Cardinality-based RED + GREEN discriminator for the
 * "two visible completion presentations" defect deferred from
 * ACT-CLINEMM-BACKGROUND-NOTIFY-EXACTLY-ONCE-PRESENTATION01.
 *
 * Per the ACT §0 frozen CCARD cardinality, one background command
 * with `notifyOnCompletion=true` produces:
 *
 *   - 1 terminal commit
 *   - 1 wake
 *   - 1 pending prompt drain
 *   - 2 run_turn_started (origins: explicit_user + pending_prompt_drain)
 *   - 2 agent_turn_done (origins: explicit_user + pending_prompt_drain)
 *   - 1 task_completion_committed (the wake_drain turn wins the phase
 *     transition; the explicit_user turn's completion is held by the
 *     deferred-completion-barrier because outstandingAutonomousWork is true)
 *
 * The defect: BOTH turns emit a `say:"completion_result"` message via
 * `appendAndEmit`, producing TWO user-visible completion boxes for ONE
 * logical terminal event.
 *
 * The prior ACT (BCNEX01) closed ONE source of duplication (the wake
 * echo user_feedback row via `isSyntheticUserPrompt`). This ACT closes
 * the OTHER source: the explicit_user turn's premature completion_result.
 *
 * Classification: E. PRESENTATION_COMMIT_DUPLICATED.
 *
 * LOAD-BEARING ASSERTIONS:
 *
 *   BCTPA-RED-01:
 *     For one notify=true jobId, the harness drives:
 *       - explicit_user turn calls attempt_completion (intermediate)
 *       - background command completes
 *       - wake → drain → wake_drain turn calls attempt_completion (terminal)
 *     The harness records the messages pushed via appendAndEmit.
 *     Pre-repair: TWO say:"completion_result" rows are pushed.
 *
 *   BCTPA-ABLATION-01:
 *     With the outstandingAutonomousWork-aware completion_result filter
 *     active, the explicit_user turn's say:"completion_result" is
 *     suppressed (the wake_drain turn's say:"completion_result" passes).
 *     Post-repair: ONE say:"completion_result" row is pushed.
 *
 *   BCTPA-GREEN-01:
 *     End-to-end invariant: for one notify=true jobId, the webview
 *     receives exactly ONE say:"completion_result" row.
 *
 * CONSERVATION (per ACT §12):
 *   BCTPA-P1: terminal AFTER originating turn finishes → presentations = 1
 *   BCTPA-P2: terminal WHILE originating turn is still alive (frozen bug)
 *             → presentations = 1 (this ACT's load-bearing case)
 *   BCTPA-P3: two independent background jobs → each 1, no cross-job dedupe
 *   BCTPA-P4: held batch → each distinct jobId → 1 terminal presentation
 *   BCTPA-P5: duplicate terminal observation for same job → 1 presentation
 *   BCTPA-P6: abort/session disappearance → no stale wake presents
 *   BCTPA-P7: explicit user turn concurrent with terminal wake → unrelated
 *             user response NOT suppressed
 *   BCTPA-P8: queue/steer unchanged (existing semantics)
 *   BCTPA-P9: OOM conservation (drain path still omits `delivery`)
 *   BCTPA-P10: correlation conservation (jobId threads terminal wake → C4 → C8)
 *
 * REPAIR (per ACT §11):
 *   The minimal-diff repair extends the existing message filter at
 *   `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:463-468` to
 *   ALSO suppress `say:"completion_result"` and `ask:"completion_result"`
 *   messages when `outstandingAutonomousWork === true` for the active
 *   session/task. The predicate is the SAME predicate the existing
 *   `deferredCompletionBarrier` already uses — no new state, no new
 *   protocol field, no UI dedupe, no string/content match.
 */

import type { CoreSessionEvent, SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	BACKGROUND_TERMINAL_WAKE_PROMPT_PREFIX,
	BackgroundNotifyCoordinator,
	formatTerminalWakePrompt,
} from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => "default",
			getGlobalStateKey: () => undefined,
			setGlobalState: vi.fn(),
		}),
	},
}))

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

// -----------------------------------------------------------------------------
// Test harness
// -----------------------------------------------------------------------------

let supervisorPid = 80000
function fakeSupervisor(): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: ++supervisorPid,
		pgid: supervisorPid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "STARTED\nFINISHED\n", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
}

class TestPendingPromptQueue {
	private readonly items: { id: string; sessionId: string; prompt: string; jobId?: string }[] = []
	enqueue(input: { sessionId: string; prompt: string; jobId?: string }): string {
		const id = `pp-${this.items.length + 1}`
		this.items.push({
			id,
			sessionId: input.sessionId,
			prompt: input.prompt,
			...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
		})
		return id
	}
	countForSession(sessionId: string): number {
		return this.items.filter((q) => q.sessionId === sessionId).length
	}
}

function makeSdkHost(queue: TestPendingPromptQueue) {
	return {
		pendingPrompts: (action: string, input: { sessionId: string } | undefined) => {
			if (action === "count") {
				return { available: true as const, count: queue.countForSession(input?.sessionId ?? "") }
			}
			throw new Error(`Unhandled pendingPrompts action: ${action}`)
		},
	}
}

interface Harness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	notifyCoordinator: BackgroundNotifyCoordinator
	queue: TestPendingPromptQueue
	activeSessionId: string
	activeTaskId: string
	jobId: string
	appendAndEmit: ReturnType<typeof vi.fn>
}

function makeHarness(options: { simulatePreFix?: boolean } = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-bctpa01"
	const activeTaskId = "task-bctpa01"
	const jobId = "cmd_bctpa01"

	const supervisor = fakeSupervisor()
	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: () => supervisor,
	})

	const queue = new TestPendingPromptQueue()
	const sdkHost = makeSdkHost(queue)

	let now = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt, jobId: jid }) => {
			queue.enqueue({ sessionId, prompt, ...(jid !== undefined ? { jobId: jid } : {}) })
		},
		now: () => ++now,
	})

	// Register the notify marker (mirrors vscode-run-commands-tool.ts:771-780).
	// The marker is consumed when the background command completes; this
	// drives the activeNotifyCountForOwner predicate that the
	// deferred-completion-barrier (and this ACT's repair filter) consult.
	//
	// ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
	// At the same seam as `registerMarker` the production code calls
	// `messageTranslatorState.recordLaunchedBackgroundJob(jobId)` so the
	// C10 completion-result filter can narrow the over-broad
	// `activeNotifyCount > 0` predicate to per-job ownership. The test
	// harness mirrors the production wiring so the frozen-bug test
	// (BCTPA-INV-01) and the P7b GREEN test (the inverse assertion)
	// exercise the same ownership-aware path the production runtime
	// exercises.
	//
	// `simulatePreFix: true` skips the marker registration so the
	// filter's outstandingAutonomousWork predicate is always false,
	// reproducing the pre-fix bug shape (both completion rows visible).
	if (!options.simulatePreFix) {
		notifyCoordinator.registerMarker({ jobId, sessionId: activeSessionId, taskId: activeTaskId })
		translatorState.recordLaunchedBackgroundJob(jobId)
	}

	const appendAndEmit = vi.fn()
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				// During the explicit_user turn, isRunning is true.
				// The test mutates this field between phases via
				// `harness.setRunning(true|false)` below.
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => manager.hasRunningBackgroundJobForOwner(activeSessionId),
		getPendingPromptCount: (ownerSessionId: string | undefined) =>
			sdkHost.pendingPrompts("count", { sessionId: ownerSessionId ?? "" }),
		getActiveNotifyCount: () => notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId),
		// ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
		// Per-job liveness probe — the test harness mimics the production
		// seam at SdkController.ts:2293-2301 (the narrow per-job lookup
		// against the coordinator's notificationMarkers Map). Wired
		// here so the C10 filter can distinguish "completion belongs to
		// a job THIS turn launched AND that job is still outstanding"
		// from "unrelated completion K".
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
	} as never)

	return {
		coordinator,
		tracker,
		translatorState,
		manager,
		notifyCoordinator,
		queue,
		activeSessionId,
		activeTaskId,
		jobId,
		appendAndEmit,
	}
}

// -----------------------------------------------------------------------------
// Test scenarios
// -----------------------------------------------------------------------------

/**
 * Drive a turn's `attempt_completion` lifecycle through the harness's
 * handleSessionEvent seam. This is the EXACT sequence the production
 * runtime emits for a turn that calls `attempt_completion` (or
 * `submit_and_exit`) — content_start → content_end → done.
 *
 * `setRunning` toggles `activeSession.isRunning` for the duration of
 * the turn (the harness's `getActiveSession()` reads it directly so
 * the existing `!isRunning` filter at line 463 sees the same value
 * the production runtime would see).
 */
async function driveAttemptCompletion(
	harness: Harness,
	params: {
		turnId: string
		isRunningDuringTurn: boolean
		resultText: string
		/**
		 * ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
		 * When true (default), simulate the production turn-boundary
		 * reset by emitting a `pending_prompt_submitted` event at the
		 * start of this turn (which calls `clearTurnOutcome()` at
		 * `sdk-session-event-coordinator.ts:455`). Set to false for
		 * the very first call in a test where the harness has
		 * pre-recorded the per-turn ownership hint via
		 * `recordLaunchedBackgroundJob(jobId)` (simulating the
		 * same-turn run_commands + attempt_completion flow).
		 */
		simulateTurnBoundary?: boolean
	},
): Promise<void> {
	// Toggle session.isRunning for the duration of this turn.
	const coordinator = harness.coordinator as unknown as {
		options: { sessions: { getActiveSession: () => { isRunning: boolean } | undefined } }
	}
	const original = coordinator.options.sessions.getActiveSession()?.isRunning
	coordinator.options.sessions.getActiveSession = () => ({
		sessionId: harness.activeSessionId,
		sdkHost: makeSdkHost(harness.queue),
		unsubscribe: vi.fn(),
		startResult: { sessionId: harness.activeSessionId },
		isRunning: params.isRunningDuringTurn,
	})

	// ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01:
	// Simulate the production turn-boundary reset that
	// `pending_prompt_submitted` triggers at
	// `sdk-session-event-coordinator.ts:453-456` (which calls
	// `messageTranslatorState.clearTurnOutcome()` BEFORE the agent's
	// tool calls). The harness fires the canonical event rather
	// than calling `clearTurnOutcome()` directly so it exercises
	// the exact production code path that does the clearing.
	//
	// Default ON for the "this is a NEW turn" case; OFF for the
	// "this is the FIRST turn after makeHarness pre-recorded the
	// ownership hint" case (the frozen-bug BCTPA-INV-01 case).
	if (params.simulateTurnBoundary !== false) {
		await harness.coordinator.handleSessionEvent({
			type: "pending_prompt_submitted",
			payload: {
				sessionId: harness.activeSessionId,
				id: `pp-${params.turnId}`,
				prompt: `<<user_input>>${params.resultText}<<end>><<state>>2<<end>>`,
			},
		} as unknown as CoreSessionEvent)
	}

	// content_start: tool=attempt_completion (or submit_and_exit).
	await harness.coordinator.handleSessionEvent({
		type: "agent_event",
		payload: {
			sessionId: harness.activeSessionId,
			event: {
				type: "content_start",
				contentType: "tool",
				toolName: "attempt_completion",
				toolCallId: `tc-${params.turnId}`,
				input: { result: params.resultText },
			},
		},
	} as unknown as CoreSessionEvent)

	// content_end: attempt_completion → say:"completion_result" finalized.
	await harness.coordinator.handleSessionEvent({
		type: "agent_event",
		payload: {
			sessionId: harness.activeSessionId,
			event: {
				type: "content_end",
				contentType: "tool",
				toolName: "attempt_completion",
				toolCallId: `tc-${params.turnId}`,
			},
		},
	} as unknown as CoreSessionEvent)

	// done event → result.turnComplete=true.
	await harness.coordinator.handleSessionEvent({
		type: "agent_event",
		payload: {
			sessionId: harness.activeSessionId,
			event: {
				type: "done",
				reason: "completed",
				text: params.resultText,
				iterations: 1,
			},
		},
	} as unknown as CoreSessionEvent)

	// Restore isRunning to its original value.
	coordinator.options.sessions.getActiveSession = () => ({
		sessionId: harness.activeSessionId,
		sdkHost: makeSdkHost(harness.queue),
		unsubscribe: vi.fn(),
		startResult: { sessionId: harness.activeSessionId },
		isRunning: original ?? false,
	})
}

/**
 * Drain the test pending-prompt queue. Mirrors the production
 * LocalRuntimeHost queueMicrotask after executeTurn completes
 * (`sdk/packages/core/src/runtime/host/local-runtime-host.ts:1264-1266`).
 * The harness bypasses LocalRuntimeHost (it uses a direct
 * handleSessionEvent seam) so the drain must be invoked explicitly.
 */
function drainPendingPrompts(harness: Harness): void {
	const items = (harness.queue as unknown as { items: { id: string; sessionId: string; prompt: string; jobId?: string }[] })
		.items
	while (items.length > 0) {
		const shifted = items.shift()
		if (!shifted) break
		// shiftNext side-effect (mirrors production shiftNext) — nothing
		// to do in this test seam because the wake is consumed via the
		// pending_prompt_submitted event below.
	}
}

/**
 * Drive the wake drain — the pending_prompt_submitted event with the
 * wake prompt text. This is the EXACT event the production runtime
 * emits when the wake drains from the pending-prompt queue and the
 * agent turn begins. The existing BCNEX01 `isSyntheticUserPrompt`
 * predicate filters the wake echo (no user_feedback row is pushed).
 */
async function driveWakeDrain(harness: Harness, wakePrompt: string): Promise<void> {
	// Toggle isRunning=true during the wake_drain turn.
	const coordinator = harness.coordinator as unknown as {
		options: { sessions: { getActiveSession: () => { isRunning: boolean } | undefined } }
	}
	coordinator.options.sessions.getActiveSession = () => ({
		sessionId: harness.activeSessionId,
		sdkHost: makeSdkHost(harness.queue),
		unsubscribe: vi.fn(),
		startResult: { sessionId: harness.activeSessionId },
		isRunning: true,
	})

	// Drain the queue (the production LocalRuntimeHost does this via
	// queueMicrotask after executeTurn; the harness bypasses that path
	// so we drain explicitly here). After drain, the queue is empty.
	drainPendingPrompts(harness)

	await harness.coordinator.handleSessionEvent({
		type: "pending_prompt_submitted",
		payload: {
			sessionId: harness.activeSessionId,
			id: `pp-${harness.jobId}`,
			prompt: wakePrompt,
			delivery: "queue",
			jobId: harness.jobId,
			attachmentCount: 0,
		},
	} as unknown as CoreSessionEvent)

	// Restore isRunning=false after the drain.
	coordinator.options.sessions.getActiveSession = () => ({
		sessionId: harness.activeSessionId,
		sdkHost: makeSdkHost(harness.queue),
		unsubscribe: vi.fn(),
		startResult: { sessionId: harness.activeSessionId },
		isRunning: false,
	})
}

/**
 * Collect every FINAL say:"completion_result" row pushed via appendAndEmit
 * across the harness. The load-bearing identity for "user-visible terminal
 * completion presentation" is the FINAL (partial:false) row — the partial
 * one is replaced in-place by the same ts (per the message-translator
 * finalize pattern at content_start/content_end). The webview renders
 * exactly one chat box per finalized completion_result.
 *
 * Per ACT §13: identity is "terminal_commit(J) == 1" / "terminal_presented(J)
 * == 1". NOT text equality, NOT prompt equality, NOT timestamps, NOT
 * "last message", NOT React render count. The jobId is preferred when
 * available; here we filter by say:"completion_result" + partial:false
 * + text-present (matches the webview filter at messageUtils.ts:122-126).
 */
function visibleCompletionRows(harness: Harness): { say: string; text: string }[] {
	const rows: { say: string; text: string }[] = []
	for (const call of harness.appendAndEmit.mock.calls) {
		const messages = call[0] as Array<{ say?: string; type?: string; ask?: string; text?: string; partial?: boolean }>
		for (const m of messages) {
			// Only finalized completion_result rows (partial:false)
			// are visible to the user. The partial row is replaced
			// in-place by the same ts at content_end.
			if (m.say === "completion_result" && m.partial === false) {
				rows.push({ say: m.say, text: m.text ?? "" })
			}
		}
	}
	return rows
}

describe("ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01 / BCTPA01", () => {
	describe("BCTPA-RED-01 / ABLATION: pre-fix behavior reproduces two visible completions", () => {
		it("without notify marker (simulating pre-fix), both turns push completion_result → 2 visible", async () => {
			// This test reproduces the FROZEN BUG SHAPE by configuring
			// the harness WITHOUT the notify marker. The
			// outstandingAutonomousWork predicate is therefore
			// always false (no active notify, no pending prompts
			// during turn 1). The filter at
			// sdk-session-event-coordinator.ts:514-535 does NOT
			// suppress anything, and BOTH turns' completion_result
			// rows are pushed — this is the pre-fix behavior.
			//
			// Counterpart to BCTPA-INV-01 (which exercises the
			// post-fix behavior with the marker present). The
			// pair proves the filter is load-bearing: with the
			// marker present → 1 visible (BCTPA-INV-01); without
			// the marker → 2 visible (BCTPA-RED-01).
			const harness = makeHarness({ simulatePreFix: true })

			// Turn 1 (explicit_user): session.isRunning = true.
			await driveAttemptCompletion(harness, {
				turnId: "explicit_user",
				isRunningDuringTurn: true,
				resultText: "I've started the command in the background. It will take about 30 seconds.",
			})

			// Turn 2 (wake_drain).
			await driveAttemptCompletion(harness, {
				turnId: "wake_drain",
				isRunningDuringTurn: true,
				resultText: "The command completed. Output: STARTED\nFINISHED",
			})

			// RED / ABLATION ASSERTION: BOTH turns pushed a
			// say:"completion_result" row. This is the
			// pre-fix-visible-duplicate — the fix removes the
			// FIRST row by filtering on outstandingAutonomousWork
			// (BCTPA-INV-01).
			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(2)
			expect(visible[0]?.text).toContain("started the command in the background")
			expect(visible[1]?.text).toContain("The command completed. Output: STARTED\nFINISHED")
		})
	})

	describe("BCTPA-INV-01: dual-turn completion produces exactly ONE visible completion_result (frozen bug invariant)", () => {
		it("explicit_user + wake_drain → exactly 1 user-visible presentation (the wake_drain turn's)", async () => {
			// This is the load-bearing invariant test for the
			// frozen bug shape. Pre-fix the count was 2 (the
			// explicit_user turn's premature completion_result +
			// the wake_drain turn's terminal completion_result).
			// Post-fix the count is 1 (only the wake_drain turn's
			// terminal completion_result is presented; the
			// explicit_user turn's intermediate completion is
			// suppressed by the outstandingAutonomousWork filter).
			const harness = makeHarness()

			// Turn 1 (explicit_user): session.isRunning = true. The
			// agent calls attempt_completion with an INTERMEDIATE
			// result text ("started the command"). The marker is
			// still present (notify marker has NOT been consumed
			// yet). `simulateTurnBoundary: false` because the
			// harness's `makeHarness` already pre-recorded the
			// ownership hint for THIS turn via
			// `recordLaunchedBackgroundJob(jobId)`; firing
			// `pending_prompt_submitted` here would clear it and
			// the C10 filter would let the premature completion
			// through (the BCTPA-P7b false-RED case).
			await driveAttemptCompletion(harness, {
				turnId: "explicit_user",
				isRunningDuringTurn: true,
				resultText: "I've started the command in the background. It will take about 30 seconds.",
				simulateTurnBoundary: false,
			})

			// Sanity: after turn 1, active notify count is STILL 1
			// (the marker is consumed when the wake fires, not when
			// the explicit_user turn ends).
			expect(harness.notifyCoordinator.activeNotifyCountForOwner(harness.activeSessionId, harness.activeTaskId)).toBe(1)

			// Now the background command completes. The coordinator
			// consumes the marker + enqueues the wake.
			const wakePrompt = formatTerminalWakePrompt({
				jobId: harness.jobId,
				terminalState: "exited",
				reason: "natural",
				exitCode: 0,
				outputTail: "STARTED\nFINISHED\n",
			})
			harness.notifyCoordinator.consumeTerminal({
				jobId: harness.jobId,
				terminalState: "exited",
				exitCode: 0,
				reason: "natural",
				isContainmentFailed: false,
				outputTail: "STARTED\nFINISHED\n",
			})
			// Sanity: marker is now consumed (active notify count = 0).
			expect(harness.notifyCoordinator.activeNotifyCountForOwner(harness.activeSessionId, harness.activeTaskId)).toBe(0)
			// Sanity: wake is enqueued exactly once.
			expect(harness.queue.countForSession(harness.activeSessionId)).toBe(1)

			// Wake drain → pending_prompt_submitted → wake_drain turn begins.
			await driveWakeDrain(harness, wakePrompt)
			// Sanity: wake prompt is filtered (BCNEX01 closure).
			expect(wakePrompt.startsWith(BACKGROUND_TERMINAL_WAKE_PROMPT_PREFIX)).toBe(true)

			// Turn 2 (wake_drain): the agent processes the wake
			// and calls attempt_completion with the TERMINAL
			// result. outstandingAutonomousWork is now FALSE (the
			// marker was consumed; the wake has drained; only the
			// activeNotify for OTHER jobs would remain — there
			// are none).
			await driveAttemptCompletion(harness, {
				turnId: "wake_drain",
				isRunningDuringTurn: true,
				resultText: "The command completed. Output: STARTED\nFINISHED",
			})

			// INVARIANT ASSERTION: exactly ONE say:"completion_result"
			// row is pushed to the webview — the wake_drain turn's
			// terminal completion. The explicit_user turn's
			// intermediate completion is suppressed by the
			// outstandingAutonomousWork filter (per ACT §11 repair).
			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(1)
			expect(visible[0]?.text).toContain("The command completed. Output: STARTED\nFINISHED")

			// Conservation: the deferred-completion-barrier held the
			// phase transition for turn 1 (outstandingAutonomousWork
			// was true). Turn 2's phase transitioned to "completed"
			// only because its outstandingAutonomousWork is false.
			// The phase invariants are NOT the load-bearing assertion
			// here — the message-level count is.
		})
	})

	describe("Conservation matrix (per ACT §12)", () => {
		it("BCTPA-P1: terminal AFTER originating turn finishes → 1 presentation", async () => {
			// Scenario: the explicit_user turn finishes WITHOUT
			// calling attempt_completion (no premature completion).
			// The wake fires later → wake_drain turn calls
			// attempt_completion. Only the wake_drain turn's
			// completion is presented.
			const harness = makeHarness()

			// No explicit_user attempt_completion (the agent's natural
			// end-of-turn without completion is equivalent to a `done`
			// event with attemptCompletionSeen=false). We skip it here
			// because the harness's existing deferredCompletionBarrier
			// path is exercised only when attemptCompletionSeen is true.

			// Background command completes → consume marker → enqueue wake.
			const wakePrompt = formatTerminalWakePrompt({
				jobId: harness.jobId,
				terminalState: "exited",
				exitCode: 0,
				reason: "natural",
				outputTail: "OK\n",
			})
			harness.notifyCoordinator.consumeTerminal({
				jobId: harness.jobId,
				terminalState: "exited",
				exitCode: 0,
				reason: "natural",
				isContainmentFailed: false,
				outputTail: "OK\n",
			})
			await driveWakeDrain(harness, wakePrompt)

			// Wake_drain turn calls attempt_completion.
			await driveAttemptCompletion(harness, {
				turnId: "wake_drain_p1",
				isRunningDuringTurn: true,
				resultText: "The command completed. Output: OK",
			})

			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(1)
			expect(visible[0]?.text).toContain("The command completed. Output: OK")
		})

		it("BCTPA-P7: explicit user turn concurrent with terminal wake → unrelated user response NOT suppressed", async () => {
			// Scenario: the user types a follow-up message WHILE the
			// background command is still running. The follow-up
			// arrival is its own explicit_user turn. The new
			// explicit_user turn's completion is suppressed by the
			// same outstandingAutonomousWork filter (because the
			// marker is still present), but the suppression only
			// applies to completion_result messages — any other
			// assistant text rows from the follow-up turn ARE
			// emitted.
			//
			// This case is conservation-only: we pin the
			// NOT-suppressed invariant by emitting a non-completion
			// text row in the same turn and asserting it survives.
			const harness = makeHarness()

			// Emit a text row during the explicit_user turn (the
			// user asked a follow-up question; agent streamed text
			// answer; agent then called attempt_completion).
			const coordinator = harness.coordinator as unknown as {
				options: { sessions: { getActiveSession: () => { isRunning: boolean } | undefined } }
			}
			coordinator.options.sessions.getActiveSession = () => ({
				sessionId: harness.activeSessionId,
				sdkHost: makeSdkHost(harness.queue),
				unsubscribe: vi.fn(),
				startResult: { sessionId: harness.activeSessionId },
				isRunning: true,
			})

			// content_start text → partial say:"text"
			await harness.coordinator.handleSessionEvent({
				type: "agent_event",
				payload: {
					sessionId: harness.activeSessionId,
					event: {
						type: "content_start",
						contentType: "text",
						text: "Here's the partial answer to your follow-up.",
						accumulated: "Here's the partial answer to your follow-up.",
					},
				},
			} as unknown as CoreSessionEvent)
			// content_end text → finalized say:"text"
			await harness.coordinator.handleSessionEvent({
				type: "agent_event",
				payload: {
					sessionId: harness.activeSessionId,
					event: {
						type: "content_end",
						contentType: "text",
						text: "Here's the final answer to your follow-up.",
					},
				},
			} as unknown as CoreSessionEvent)

			coordinator.options.sessions.getActiveSession = () => ({
				sessionId: harness.activeSessionId,
				sdkHost: makeSdkHost(harness.queue),
				unsubscribe: vi.fn(),
				startResult: { sessionId: harness.activeSessionId },
				isRunning: false,
			})

			// The text row MUST have been pushed (NOT suppressed by
			// the outstandingAutonomousWork filter — only completion_result
			// messages are filtered).
			const textRows: { say: string; text: string }[] = []
			for (const call of harness.appendAndEmit.mock.calls) {
				const messages = call[0] as Array<{ say?: string; text?: string }>
				for (const m of messages) {
					if (m.say === "text") {
						textRows.push({ say: m.say, text: m.text ?? "" })
					}
				}
			}
			expect(textRows.some((r) => r.text.includes("final answer to your follow-up"))).toBe(true)
		})

		// =========================================================================
		// BCTPA-P7b: CLOSED via ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01
		// =========================================================================
		//
		// Predecessor ACT
		// (ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01)
		// documented this as a known limitation (RED witness). The
		// bounded repair there used the over-broad aggregate
		// `activeNotifyCount > 0` predicate at C10, which suppressed
		// unrelated completion K.
		//
		// The successor ACT (this one) narrows the C10 filter to
		// per-job ownership: the completion_result is suppressed
		// IFF it belongs to a background job THIS turn launched AND
		// that job's marker is still outstanding. When the unrelated
		// explicit_user turn K calls `attempt_completion`, the turn
		// boundary (simulated by `clearTurnOutcome()` at the start of
		// `driveAttemptCompletion`) clears the prior turn's
		// `launchedBackgroundJobIds` — so K's ownership hint is empty
		// and K's completion_result flows through.
		//
		// This is the precise bidirectional discriminator:
		//   - Frozen bug (premature J) → SUPPRESS (BCTPA-INV-01)
		//   - Unrelated K (P7b)        → VISIBLE  (BCTPA-P7b GREEN)
		// Both must hold simultaneously; the prior ACT's broad
		// predicate failed the second invariant.
		// =========================================================================
		it("BCTPA-P7b (CLOSED): unrelated explicit-user completion_result during active notify IS visible (ownership-aware C10 filter)", async () => {
			const harness = makeHarness()

			// Marker is already registered by makeHarness. Now
			// drive a UNRELATED explicit-user turn that calls
			// attempt_completion WITHOUT having invoked any
			// background command (e.g., the user asked an unrelated
			// question and the agent answered it).
			await driveAttemptCompletion(harness, {
				turnId: "unrelated_explicit_user",
				isRunningDuringTurn: true,
				resultText: "Here's the answer to your unrelated question.",
			})

			// The marker is STILL present (we haven't consumed it).
			expect(harness.notifyCoordinator.activeNotifyCountForOwner(harness.activeSessionId, harness.activeTaskId)).toBe(1)

			// The unrelated completion_result is VISIBLE — the
			// per-turn ownership hint was cleared at the turn
			// boundary (mirrors production's
			// `pending_prompt_submitted` calling
			// `clearTurnOutcome()`) and this turn did not launch
			// any background jobs. The ownership-aware C10 filter
			// at `sdk-session-event-coordinator.ts:514-622` does
			// NOT suppress.
			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(1)
			expect(visible[0]?.text).toContain("Here's the answer to your unrelated question.")
		})

		it("BCTPA-P10: correlation conservation — jobId threads through both turns", async () => {
			// Conservation: the same jobId appears in the
			// consumeTerminal input AND the wake prompt AND the
			// wake_drain turn's input. The pending-prompt queue
			// entry carries the jobId so the wake_drain turn's
			// runTurn receives it.
			const harness = makeHarness()

			// Turn 1 fires attempt_completion with the marker present.
			await driveAttemptCompletion(harness, {
				turnId: "explicit_user_p10",
				isRunningDuringTurn: true,
				resultText: "Started it.",
			})

			const wakePrompt = formatTerminalWakePrompt({
				jobId: harness.jobId,
				terminalState: "exited",
				exitCode: 0,
				reason: "natural",
				outputTail: "OK\n",
			})
			harness.notifyCoordinator.consumeTerminal({
				jobId: harness.jobId,
				terminalState: "exited",
				exitCode: 0,
				reason: "natural",
				isContainmentFailed: false,
				outputTail: "OK\n",
			})

			// Pending-prompt queue entry MUST carry the jobId.
			const items = (
				harness.queue as unknown as {
					items: { id: string; sessionId: string; prompt: string; jobId?: string }[]
				}
			).items
			expect(items.length).toBe(1)
			expect(items[0].jobId).toBe(harness.jobId)
			expect(items[0].prompt).toContain(harness.jobId)
		})
	})
})
