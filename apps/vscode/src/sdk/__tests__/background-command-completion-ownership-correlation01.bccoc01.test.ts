/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01 / BCCOC01
 *
 * Focused test suite for the ownership-aware C10 completion-result
 * filter at `sdk-session-event-coordinator.ts:514-622`. The load-bearing
 * RED/GREEN pair lives in `bctpa01.test.ts` (the predecessor
 * ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-PRESENTATION-ARBITRATION01's
 * BCTPA-INV-01 + BCTPA-P7b pair). This file adds the discriminator tests
 * required by the BCCOC01 ACT.
 *
 *   - BCCOC-OWN-01: explicit_user turn T launched background J, marker
 *     alive, T emits attempt_completion -> SUPPRESS.
 *   - BCCOC-OWN-02: wake_drain turn for J, marker consumed -> VISIBLE.
 *   - BCCOC-MULTI-01: cross-job isolation (no over-suppression across jobs).
 */

import type { CoreSessionEvent, SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
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

interface Harness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	notifyCoordinator: BackgroundNotifyCoordinator
	activeSessionId: string
	activeTaskId: string
	jobIds: string[]
	appendAndEmit: ReturnType<typeof vi.fn>
}

function fakeSupervisor(): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: 1,
		pgid: 1,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "OK\n", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
}

interface MakeHarnessOptions {
	jobIds?: string[]
	noPreRecordedOwnership?: boolean
}

function makeHarness(options: MakeHarnessOptions = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-bccoc01"
	const activeTaskId = "task-bccoc01"
	const jobIds = options.jobIds ?? ["cmd_bccoc_1"]
	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: () => fakeSupervisor(),
	})
	let now = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => {},
		now: () => ++now,
	})
	for (const jid of jobIds) {
		notifyCoordinator.registerMarker({ jobId: jid, sessionId: activeSessionId, taskId: activeTaskId })
		if (!options.noPreRecordedOwnership) {
			translatorState.recordLaunchedBackgroundJob(jid)
		}
	}
	const appendAndEmit = vi.fn()
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
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
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveNotifyCount: () => notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId),
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
	} as never)
	return {
		coordinator,
		tracker,
		translatorState,
		manager,
		notifyCoordinator,
		activeSessionId,
		activeTaskId,
		jobIds,
		appendAndEmit,
	}
}

function visibleCompletionRows(harness: Harness): { say: string; text: string }[] {
	const rows: { say: string; text: string }[] = []
	for (const call of harness.appendAndEmit.mock.calls) {
		const messages = call[0] as Array<{ say?: string; partial?: boolean; text?: string }>
		for (const m of messages) {
			if (m.say === "completion_result" && m.partial === false) {
				rows.push({ say: m.say, text: m.text ?? "" })
			}
		}
	}
	return rows
}

async function driveAttemptCompletion(
	harness: Harness,
	params: {
		turnId: string
		resultText: string
		simulateTurnBoundary?: boolean
	},
): Promise<void> {
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
}

describe("ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01 / BCCOC01", () => {
	describe("BCCOC-OWN-01 / BCCOC-OWN-02: single-job ownership", () => {
		it("BCCOC-OWN-01: explicit_user turn that owns J with marker alive -> completion SUPPRESSED", async () => {
			const harness = makeHarness({ jobIds: ["cmd_bccoc_own1"] })
			expect(harness.notifyCoordinator.hasActiveNotify("cmd_bccoc_own1")).toBe(true)
			await driveAttemptCompletion(harness, {
				turnId: "explicit_user",
				resultText: "Started the command.",
				simulateTurnBoundary: false,
			})
			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(0)
		})

		it("BCCOC-OWN-02: wake_drain turn after consumeTerminal -> completion VISIBLE", async () => {
			const harness = makeHarness({
				jobIds: ["cmd_bccoc_own2"],
				noPreRecordedOwnership: true,
			})
			harness.notifyCoordinator.consumeTerminal({
				jobId: "cmd_bccoc_own2",
				terminalState: "exited",
				exitCode: 0,
				reason: "natural",
				isContainmentFailed: false,
				outputTail: "OK\n",
			})
			expect(harness.notifyCoordinator.hasActiveNotify("cmd_bccoc_own2")).toBe(false)
			await driveAttemptCompletion(harness, {
				turnId: "wake_drain",
				resultText: "The command completed. Output: OK",
				simulateTurnBoundary: true,
			})
			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(1)
			expect(visible[0]?.text).toContain("The command completed. Output: OK")
		})
	})

	describe("BCCOC-MULTI-01: cross-job TURN-scoped state (the production-reachable shape)", () => {
		// ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01 / CORRECTION01:
		// the per-completion cross-job invariant (`suppress(C) iff
		// owner(C) == J AND outstanding(J)` for a SPECIFIC
		// completion_result about a SPECIFIC job) is NOT reachable
		// from the current production wire: completion_result
		// messages carry no `jobId` / `toolCallId` linking them to
		// the specific run_commands invocation that "owns" them.
		// The carrier `launchedBackgroundJobIds` is turn-scoped
		// ("all jobs launched by THIS turn"), not completion-scoped
		// ("the job that THIS completion is about"). In production,
		// the realistic multi-job shape is:
		//
		//   turn T launches J1, J2 in parallel via two run_commands
		//   calls (both register markers because both are
		//   notify=true).
		//   turn T then emits attempt_completion with intermediate
		//   text.
		//
		// In that shape, BOTH J1 and J2 are still alive when the
		// completion is emitted (a notify=true run_commands only
		// returns RUNNING — the model cannot know it has "finished"
		// one inline). So both jobs are owned by the turn, both
		// have outstanding markers, and the attempt_completion is
		// premature for BOTH. Suppressing the completion is the
		// semantically correct answer. The wake_drain turn for
		// whichever job finishes first will present the terminal
		// completion.
		//
		// The previously-asserted "J1 consumed, J2 outstanding,
		// completion meant for J1 should be visible" case is
		// NOT reachable from production with the current wire
		// shape. The test is REMOVED in CORRECTION01 (the
		// cross-job conservation R4 is downgraded from "isolated"
		// to "out-of-scope" — see 04-focused-gates.txt and the
		// recon addendum in 01-recon.md).
		//
		// The two tests that remain are the production-reachable
		// multi-job shapes:

		it("both J1 and J2 outstanding (production-reachable: parallel run_commands in same turn) -> completion SUPPRESSED", async () => {
			const harness = makeHarness({ jobIds: ["cmd_bccoc_J1", "cmd_bccoc_J2"] })
			expect(harness.notifyCoordinator.hasActiveNotify("cmd_bccoc_J1")).toBe(true)
			expect(harness.notifyCoordinator.hasActiveNotify("cmd_bccoc_J2")).toBe(true)
			await driveAttemptCompletion(harness, {
				turnId: "explicit_user_multi",
				resultText: "Started two background commands.",
				simulateTurnBoundary: false,
			})
			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(0)
		})

		it("J1 outstanding, J2 consumed -> completion SUPPRESSED (only J1 ownership matters)", async () => {
			// Production-reachable when J1 was launched in turn T1
			// (Set carried over to T2 via the turn-boundary reset)
			// and J2 was launched in turn T1 too but its marker was
			// consumed before T2 started (because T2 started after
			// the wake_drain for J2 fired). In T2's ownedJobIds
			// (cleared by clearTurnOutcome at turn boundary), J2 is
			// NOT present — but the test simulates the
			// turn-scoped state where BOTH are in the same turn.
			// The completion belongs to whichever job the model
			// addresses, and the carrier conservatively suppresses
			// when ANY owned job is alive.
			const harness = makeHarness({ jobIds: ["cmd_bccoc_J1a", "cmd_bccoc_J2a"] })
			harness.notifyCoordinator.consumeTerminal({
				jobId: "cmd_bccoc_J2a",
				terminalState: "exited",
				exitCode: 0,
				reason: "natural",
				isContainmentFailed: false,
				outputTail: "J2 done\n",
			})
			expect(harness.notifyCoordinator.hasActiveNotify("cmd_bccoc_J1a")).toBe(true)
			expect(harness.notifyCoordinator.hasActiveNotify("cmd_bccoc_J2a")).toBe(false)
			await driveAttemptCompletion(harness, {
				turnId: "explicit_user_j1_only",
				resultText: "Two started, but only J1 matters now.",
				simulateTurnBoundary: false,
			})
			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(0)
		})
	})

	describe("BCCOC01-P7b REPLAY: inherited RED (now GREEN) preserved", () => {
		it("BCCOC01-P7b: unrelated completion K while active notify for J -> K IS visible", async () => {
			const harness = makeHarness({ jobIds: ["cmd_bccoc_p7b"] })
			expect(harness.notifyCoordinator.hasActiveNotify("cmd_bccoc_p7b")).toBe(true)
			await driveAttemptCompletion(harness, {
				turnId: "unrelated_K",
				resultText: "Here's the answer to your unrelated question.",
				simulateTurnBoundary: true,
			})
			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(1)
			expect(visible[0]?.text).toContain("Here's the answer to your unrelated question.")
		})
	})

	describe("Conservation: production seam shape", () => {
		it("BCCOC-NO-OP: empty ownership hint + no marker -> completion flows through", async () => {
			const harness = makeHarness({ jobIds: [], noPreRecordedOwnership: true })
			expect(harness.notifyCoordinator.diagnosticMarkerCount()).toBe(0)
			await driveAttemptCompletion(harness, {
				turnId: "no_op",
				resultText: "Normal completion.",
				simulateTurnBoundary: true,
			})
			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(1)
			expect(visible[0]?.text).toContain("Normal completion.")
		})

		it("BCCOC-CONSUME-OWNED: owned job has marker consumed -> completion flows through", async () => {
			const harness = makeHarness({ jobIds: ["cmd_bccoc_consumed"] })
			harness.notifyCoordinator.consumeTerminal({
				jobId: "cmd_bccoc_consumed",
				terminalState: "exited",
				exitCode: 0,
				reason: "natural",
				isContainmentFailed: false,
				outputTail: "OK\n",
			})
			await driveAttemptCompletion(harness, {
				turnId: "wake_drain_reduced",
				resultText: "J done — output: OK",
				simulateTurnBoundary: false,
			})
			const visible = visibleCompletionRows(harness)
			expect(visible.length).toBe(1)
			expect(visible[0]?.text).toContain("J done — output: OK")
		})
	})
})
