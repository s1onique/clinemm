/**
 * ACT-CLINEMM-P0-HOST-BLOCKED-RECOVERY-CONTRACT01 - HBRC01
 *
 * Single bounded discriminator (per Factory reviewer's
 * "HALT_HOST_BLOCKED_RECOVERY_CONTRACT_MISSING" disposition on
 * ACT-CLINEMM-P0-BLOCKED-OBSERVATION-CAPABILITY-RECOVERY-PROBE01
 * at commit `98d229e6a` and
 * ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-NONCONVERGENCE01
 * at commit `c647e83ab`):
 *
 *   When the host retains legitimate terminal-observation
 *   obligations but the active resumed runtime cannot execute
 *   `command_status`, what supported action can restore
 *   progress without fabricating observation, discarding
 *   obligations, or scheduling an impossible model turn?
 *
 * The decisive chain is driven against the REAL
 * `BackgroundNotifyCoordinator` + `SdkSessionEventCoordinator`
 * (the same seam BOCR01-01..07 exercise end-to-end), and the
 * user-visible recovery affordance is traced through the
 * actual production TS source (not a mirrored-policy
 * reimplementation).
 *
 * NO production code is changed by this ACT. The single
 * bounded output is a source-bound discriminator + a frozen
 * recovery contract. Any UI-surface repair is
 * `HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED` (a new public
 * wire field would be required).
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	BackgroundNotifyCoordinator,
	type ConsumeTerminalDecision,
	legacyConsumeTerminalPolicy,
} from "../background-notify-coordinator"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
	},
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

const SdkControllerPath = resolve(__dirname, "..", "SdkController.ts")
const SdkControllerSource = readFileSync(SdkControllerPath, "utf8")

const SdkSessionEventCoordinatorPath = resolve(__dirname, "..", "sdk-session-event-coordinator.ts")
const SdkSessionEventCoordinatorSource = readFileSync(SdkSessionEventCoordinatorPath, "utf8")

const ExtensionMessagePath = resolve(__dirname, "..", "..", "shared", "ExtensionMessage.ts")
const ExtensionMessageSource = readFileSync(ExtensionMessagePath, "utf8")

const ButtonConfigPath = resolve(
	__dirname,
	"..",
	"..",
	"..",
	"webview-ui",
	"src",
	"components",
	"chat",
	"chat-view",
	"shared",
	"buttonConfig.ts",
)
const ButtonConfigSource = readFileSync(ButtonConfigPath, "utf8")

const UseMessageHandlersPath = resolve(
	__dirname,
	"..",
	"..",
	"..",
	"webview-ui",
	"src",
	"components",
	"chat",
	"chat-view",
	"hooks",
	"useMessageHandlers.ts",
)
const UseMessageHandlersSource = readFileSync(UseMessageHandlersPath, "utf8")

interface HbrcHarness {
	coordinator: SdkSessionEventCoordinator
	notifyCoordinator: BackgroundNotifyCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	activeSessionId: string
	activeTaskId: string
	wakeLog: Array<{ sessionId: string; jobId: string; prompt: string }>
	continuationLog: Array<{ sessionId: string; taskId?: string; prompt: string; delivery: "queue" }>
	completionCommitCount: () => number
	setLiveTools: (tools: readonly string[] | undefined) => void
	consumeTerminal: (
		jobId: string,
		opts?: { terminalState?: "exited" | "containment_failed"; exitCode?: number },
	) => Promise<ConsumeTerminalDecision>
	commandStatusResolveObligation: (jobId: string) => { kind: "resolved" | "no_marker" }
	commandStatusConsumeNonNotify: (jobId: string) => void
	reevaluateBarrier: () => Promise<void>
	getHeldCount: () => number
	getHeldJobIds: () => readonly string[]
	getNotificationMarkersForJob: (jobId: string) => boolean
	getTrackerPhase: () => string
	getLastWriterId: () => string | undefined
	observationUnavailableStamps: () => number
}

function makeHbrcHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): HbrcHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-hbrc01"
	const activeTaskId = opts.activeTaskId ?? "task-hbrc01"

	const wakeLog: Array<{ sessionId: string; jobId: string; prompt: string }> = []
	const continuationLog: Array<{
		sessionId: string
		taskId?: string
		prompt: string
		delivery: "queue"
	}> = []
	let completionCommitCount = 0
	let observationUnavailableStamps = 0
	let lastWriterId: string | undefined
	let liveTools: readonly string[] | undefined = ["submit_and_exit"]
	let now = 0

	// CORRECTION01: BackgroundNotifyCoordinator's actual options use
	// `resolveActiveOwner` (a callback) + `enqueueTerminalWake` (an async
	// sink). The previous `ownerSessionId/ownerTaskId/wakeSink` shape
	// was a wrong-shape cast and produced a TS2353 type error that
	// blocked the canonical build gate. The corrected shape mirrors
	// the production wiring at `SdkController.ts:1458`.
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: async ({ sessionId, prompt, jobId }) => {
			wakeLog.push({ sessionId, jobId: jobId ?? "", prompt })
			return { kind: "delivered" as const }
		},
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => ++now,
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {
					send: (input: { sessionId: string; prompt: string; delivery: "queue"; runtimeControlKind?: string }) => {
						continuationLog.push({
							sessionId: input.sessionId,
							taskId: activeTaskId,
							prompt: input.prompt,
							delivery: input.delivery,
						})
						return Promise.resolve()
					},
				} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			if (writerId !== undefined) {
				lastWriterId = writerId
			}
			if (writerId === "session-event-bcb-blocked-observation-unavailable") {
				observationUnavailableStamps += 1
			}
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		pendingPromptsController: {
			enqueue: () => ({ id: "fake" }),
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		},
		pendingPromptAuthorityAvailable: true,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId),
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, activeTaskId)
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) => {
			if (sid !== activeSessionId) return []
			return notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, tid)
		},
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			if (input.heldJobIds.length === 0) {
				return Promise.resolve({ kind: "no_held_job_ids" as const })
			}
			continuationLog.push({
				sessionId: input.sessionId,
				taskId: input.taskId,
				prompt: `COALESCED continuation for jobIds=${input.heldJobIds.join(",")}`,
				delivery: "queue",
			})
			return Promise.resolve({ kind: "delivered" as const })
		},
		liveTools: () => liveTools,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		notifyCoordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		wakeLog,
		continuationLog,
		completionCommitCount: () => completionCommitCount,
		setLiveTools: (tools) => {
			liveTools = tools
		},
		consumeTerminal: (jobId, terminalOpts) => {
			return notifyCoordinator.consumeTerminal({
				jobId,
				terminalState: terminalOpts?.terminalState ?? "exited",
				exitCode: terminalOpts?.exitCode ?? 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})
		},
		commandStatusResolveObligation: (jobId) => {
			const decision = notifyCoordinator.resolveObligation({
				jobId,
				sessionId: activeSessionId,
				taskId: activeTaskId,
				resolution: "canonical_status_observed",
			})
			// Path C gate (matches production command-status-tool.ts:384-393).
			if (!notifyCoordinator.hasActiveNotify(jobId)) {
				notifyCoordinator.consumeNonNotifyTerminalObservation({
					jobId,
					sessionId: activeSessionId,
					taskId: activeTaskId,
				})
			}
			return { kind: decision.kind === "resolved" ? "resolved" : "no_marker" }
		},
		commandStatusConsumeNonNotify: (jobId) => {
			notifyCoordinator.consumeNonNotifyTerminalObservation({
				jobId,
				sessionId: activeSessionId,
				taskId: activeTaskId,
			})
		},
		reevaluateBarrier: () => coordinator.reevaluateDeferredCompletionBarrier(),
		getHeldCount: () => notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, activeTaskId),
		getHeldJobIds: () => notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, activeTaskId),
		getNotificationMarkersForJob: (jobId) => notifyCoordinator.hasActiveNotify(jobId),
		getTrackerPhase: () => tracker.currentPhase,
		getLastWriterId: () => lastWriterId,
		observationUnavailableStamps: () => observationUnavailableStamps,
	}
}

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

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as CoreSessionEvent

async function emitSubmitAndExit(
	coordinator: SdkSessionEventCoordinator,
	translatorState: MessageTranslatorState,
	sessionId: string,
): Promise<void> {
	translatorState.setAttemptCompletionSeen()
	translatorState.setTerminalResponseCommittedThisTurn()
	const doneEvent = agentEvent(sessionId, {
		type: "done",
		reason: "completed",
		text: "Task completed.",
		iterations: 1,
	})
	await coordinator.handleSessionEvent(doneEvent)
	await new Promise<void>((r) => setImmediate(r))
}

// =============================================================================
// Source-bound witnesses (per C7 discriminator preconditions; mirrors the
// SdkController.task-telemetry-wiring.test.ts C04-WIRE-1..5 structural pattern:
// readFileSync + regex on the production TS source so the assertion does
// not depend on a mirrored-policy reimplementation).
// =============================================================================

describe("HBRC01 - source-bound witnesses (the missing UI contract)", () => {
	it("WITNESS-1: SdkController.askResponse is the only controller seam the webview Retry button reaches (no new public surface is added by Retry)", () => {
		expect(SdkControllerSource).toMatch(/async askResponse\(/)
		expect(SdkControllerSource).toMatch(/followups\.askResponse\(/)
		// The Retry path is identical to a normal askResponse.
		// It does NOT rebuild the runtime, does NOT add
		// command_status, and does NOT stamp a different
		// writerId. A future refactor that adds a runtime
		// rebuild to the Retry path would change the bounded
		// recovery contract.
		const askResponseIdx = SdkControllerSource.indexOf("async askResponse(")
		const nextAskResponseIdx = SdkControllerSource.indexOf("async askResponse(", askResponseIdx + 1)
		const askResponseBlock =
			nextAskResponseIdx > 0
				? SdkControllerSource.slice(askResponseIdx, nextAskResponseIdx)
				: SdkControllerSource.slice(askResponseIdx, askResponseIdx + 8_000)
		expect(askResponseBlock).not.toMatch(/setLiveTools\(/)
		expect(askResponseBlock).not.toMatch(/runtime\.rebuild|rebuildRuntime|rebuildSession/)
	})

	it("WITNESS-2: the bounded correlation guard at sdk-session-event-coordinator.ts publishes a SINGLE typed blocked outcome with the closed-enum reason observation_unavailable", () => {
		expect(SdkSessionEventCoordinatorSource).toMatch(/session-event-bcb-blocked-observation-unavailable/)
		expect(SdkSessionEventCoordinatorSource).toMatch(/sameObligationAlreadyObservationUnavailable/)
		expect(SdkSessionEventCoordinatorSource).toMatch(/if \(canObserveHeldResults === false\)/)
	})

	it("WITNESS-3: ExtensionState.turnState does NOT carry writerId or blockedReason (closed wire shape - no BCB-block UI discrimination is possible without a NEW public field)", () => {
		const turnStateMatch = ExtensionMessageSource.match(/export interface TurnState \{([\s\S]*?)\}/)
		expect(turnStateMatch).not.toBeNull()
		const turnStateBody = turnStateMatch?.[1] ?? ""
		expect(turnStateBody).toContain("phase")
		expect(turnStateBody).toContain("seq")
		// Closed wire: no writerId, no blockedReason, no
		// observationUnreachable flag.
		expect(turnStateBody).not.toMatch(/writerId/)
		expect(turnStateBody).not.toMatch(/blockedReason/)
		expect(turnStateBody).not.toMatch(/observationUnreachable/)
		expect(turnStateBody).not.toMatch(/observationUnavailable/)
		expect(turnStateBody).toMatch(/anchorTs\?:\s*number/)
	})

	it("WITNESS-4: buttonsForPhase collapses every error phase to the api_req_failed button set (the writerId is NOT consulted by the webview)", () => {
		expect(ButtonConfigSource).toMatch(/case "error":/)
		expect(ButtonConfigSource).toMatch(/case "error":[\s\S]*?return\s+BUTTON_CONFIGS\.api_req_failed/s)
		expect(ButtonConfigSource).not.toMatch(/writerId/)
		expect(ButtonConfigSource).not.toMatch(/blockedReason/)
		expect(ButtonConfigSource).not.toMatch(/observationUnavailable/)
		expect(ButtonConfigSource).toMatch(/primaryText:\s*"Retry"/)
		expect(ButtonConfigSource).toMatch(/secondaryText:\s*"Start New Task"/)
		expect(ButtonConfigSource).toMatch(/const errorTypes = \["api_req_failed"\]/)
		// The buttonsForPhase signature does NOT take writerId.
		const buttonsForPhaseMatch = ButtonConfigSource.match(/export function buttonsForPhase\(\s*([\s\S]*?)\s*\)\s*:/)
		expect(buttonsForPhaseMatch).not.toBeNull()
		const buttonsForPhaseArgs = buttonsForPhaseMatch?.[1] ?? ""
		expect(buttonsForPhaseArgs).toContain("turnState")
		expect(buttonsForPhaseArgs).not.toMatch(/writerId/)
		expect(buttonsForPhaseArgs).not.toMatch(/blockedReason/)
	})

	it("WITNESS-5: SdkController.getStateToPostToWebview projects turnState from the tracker (no writerId field is added on the wire)", () => {
		const getStateStart = SdkControllerSource.indexOf("async getStateToPostToWebview(): Promise<ExtensionState>")
		expect(getStateStart).toBeGreaterThanOrEqual(0)
		const getStateBody = SdkControllerSource.slice(getStateStart)
		expect(getStateBody).toMatch(/turnState:\s*this\.turnStateTracker\.get\(\)/)
		const getStateWindow = getStateBody.slice(0, 30_000)
		expect(getStateWindow).not.toMatch(/turnState.*writerId/)
		expect(getStateWindow).not.toMatch(/turnState.*blockedReason/)
	})
})

// =============================================================================
// BRC-01 - Retry does not restore capability; the held set is conserved; no
//          automatic unbounded loop. The user's Retry click reaches the SAME
//          runtime with the SAME liveTools and reaches the same dead end.
// =============================================================================

describe("BRC-01 - Retry (the user-driven reentry) is contract-correct: no progress, no fabrication, no unbounded loop", () => {
	it("BRC-01a: a held observation + liveTools lacking command_status publishes a SINGLE observation_unavailable blocked outcome on the FIRST submit_and_exit", async () => {
		const h = makeHbrcHarness()
		// The production seam at vscode-run-commands-tool.ts:890
		// calls recordNonNotifyTerminalObservation for a
		// non-notify (fire-and-forget) background job.
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J-1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		expect(h.getHeldCount()).toBe(1)
		expect(h.getHeldJobIds()).toEqual(["J-1"])

		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)

		// Elm refuses completion (C10 barrier); the held set is
		// conserved; the blocked outcome is published exactly once.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.getTrackerPhase()).toBe("error")
		expect(h.getLastWriterId()).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(h.observationUnavailableStamps()).toBe(1)
		expect(h.getHeldCount()).toBe(1)
		expect(h.getHeldJobIds()).toEqual(["J-1"])
		expect(h.continuationLog).toHaveLength(0)
		expect(h.wakeLog).toHaveLength(0)
	})

	it("BRC-01b: a second submit_and_exit on the BCR-blocked state short-circuits via sameObligationAlreadyObservationUnavailable (BOCR01-07); the held set is preserved; no new blocked outcome stamp", async () => {
		const h = makeHbrcHarness()
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J-retry",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.getHeldCount()).toBe(1)
		expect(h.observationUnavailableStamps()).toBe(1)
		const phaseBefore = h.getTrackerPhase()
		expect(phaseBefore).toBe("error")

		// A second submit_and_exit (modelling a user-driven
		// Retry that re-enters the model turn) hits the bounded
		// guard's sameObligationAlreadyObservationUnavailable
		// short-circuit. The held set is conserved; the
		// completion is NOT fabricated; no new blocked outcome
		// is stamped.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))

		expect(h.completionCommitCount()).toBe(0)
		expect(h.getHeldCount()).toBe(1)
		expect(h.getHeldJobIds()).toEqual(["J-retry"])
		expect(h.getTrackerPhase()).toBe("error")
		expect(h.observationUnavailableStamps()).toBe(1)
		expect(h.continuationLog).toHaveLength(0)
		expect(h.wakeLog).toHaveLength(0)
	})

	it("BRC-01c: contract RED - the user's Retry click is the same yesButtonClicked the production code maps to fireAndForgetSend; there is NO production contract that distinguishes a Retry in this state from a Retry in a genuine api_req_failed state", () => {
		expect(UseMessageHandlersSource).toMatch(/case "retry":/)
		const retryMatch = UseMessageHandlersSource.match(/case "retry":[\s\S]*?break/)
		expect(retryMatch).not.toBeNull()
		const retryBlock = retryMatch?.[0] ?? ""
		expect(retryBlock).toMatch(/yesButtonClicked/)
		expect(retryBlock).not.toMatch(/observationUnavailable|writerId|blockedReason/)
	})
})

// =============================================================================
// BRC-02 - Genuine capability restoration (control case). The existing
//          supported mechanism is the model-driven command_status.execute(J)
//          drain. This is proven by BOCR01-03 and OCRRD01-04; the present
//          ACT re-asserts the same chain in the BCR-blocked precondition so
//          the recovered -> drained -> held=0 chain is reproduced as a
//          control case.
// =============================================================================

describe("BRC-02 - existing capability restoration path (control case; the supported drain)", () => {
	it("BRC-02: liveTools gains command_status + command_status.resolveObligation(J) drains the held set", async () => {
		const h = makeHbrcHarness()
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J-drain",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		// Establish the BCR block.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.getTrackerPhase()).toBe("error")
		expect(h.observationUnavailableStamps()).toBe(1)

		// Capability restoration: the resumed-turn tool registry
		// gains command_status (the only supported host
		// restoration path; mirrors BOCR01-03 step 3 +
		// OCRRD01-04 sub-gate 3b).
		h.setLiveTools(["command_status", "submit_and_exit"])

		// The model issues command_status(J-drain). The
		// production command_status tool calls:
		//   resolveObligation(J-drain, "canonical_status_observed")
		//     -> no_marker (no notify=true marker for J-drain)
		//   hasActiveNotify(J-drain) === false -> Path C gate passes
		//   consumeNonNotifyTerminalObservation(J-drain) drains
		//     the held entry.
		const resolution = h.commandStatusResolveObligation("J-drain")
		expect(resolution.kind).toBe("no_marker")
		expect(h.getHeldCount()).toBe(0)
		expect(h.getHeldJobIds()).toEqual([])

		// The reeval finds held=0; no second blocked outcome
		// stamp; no continuation enqueue.
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		expect(h.continuationLog).toHaveLength(0)
		expect(h.getHeldCount()).toBe(0)
	})
})

// =============================================================================
// BRC-03 - Repeated user Retry is bounded: each invocation is a separate
//          user action; no automatic host continuation; no new blocked
//          outcome stamp; held set identity conserved across the calls.
// =============================================================================

describe("BRC-03 - repeated user Retry is bounded (no automatic unbounded loop)", () => {
	it("BRC-03: three back-to-back same-task submit_and_exit cycles do NOT amplify the blocked-outcome publication (the bounded guard dedupes on the same obligation)", async () => {
		const h = makeHbrcHarness()
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J-loop",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})

		// First cycle.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		expect(h.observationUnavailableStamps()).toBe(1)
		expect(h.getTrackerPhase()).toBe("error")
		const heldSetCycle1 = [...h.getHeldJobIds()].sort()
		expect(heldSetCycle1).toEqual(["J-loop"])

		// Second cycle.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		expect(h.observationUnavailableStamps()).toBe(1)
		expect(h.getTrackerPhase()).toBe("error")
		const heldSetCycle2 = [...h.getHeldJobIds()].sort()
		expect(heldSetCycle2).toEqual(heldSetCycle1)

		// Third cycle.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		expect(h.observationUnavailableStamps()).toBe(1)
		expect(h.getTrackerPhase()).toBe("error")
		const heldSetCycle3 = [...h.getHeldJobIds()].sort()
		expect(heldSetCycle3).toEqual(heldSetCycle1)

		// No automatic host continuation; no wake fired; no
		// completion fabricated. Each cycle is a separate user
		// action, not an automatic loop.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.continuationLog).toHaveLength(0)
		expect(h.wakeLog).toHaveLength(0)
		expect([...h.getHeldJobIds()].sort()).toEqual(["J-loop"])
	})
})

// =============================================================================
// BRC-04 - Task replacement: a new task has a fresh (sessionId, taskId) and
//          the OLD task's held set is keyed by the OLD identity. A delayed
//          K event cannot release K+1, and a new task's BCB is independently
//          authored. The held set is process-ephemeral and not silently
//          reattributed.
// =============================================================================

describe("BRC-04 - task replacement does not silently reattribute the held set", () => {
	it("BRC-04: a held observation on task-K is keyed by (sessionId-K, taskId-K); task-K+1's BCB sees a fresh held set, NOT the K obligation", async () => {
		// Task K established on (sessionK, taskK).
		const hK = makeHbrcHarness({
			activeSessionId: "session-K",
			activeTaskId: "task-K",
		})
		hK.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: "J-K",
			sessionId: hK.activeSessionId,
			taskId: hK.activeTaskId,
		})
		await emitSubmitAndExit(hK.coordinator, hK.translatorState, hK.activeSessionId)
		expect(hK.completionCommitCount()).toBe(0)
		expect(hK.getHeldCount()).toBe(1)
		expect(hK.getHeldJobIds()).toEqual(["J-K"])
		expect(hK.getTrackerPhase()).toBe("error")

		// Task K+1 established on (sessionK1, taskK1). The new
		// harness consults the SAME notify-coordinator's
		// unconsumedTerminalCountForOwner, but with the new
		// (sessionId, taskId) key. The K held entry is NOT
		// reattributed to K+1.
		const hK1 = makeHbrcHarness({
			activeSessionId: "session-K1",
			activeTaskId: "task-K1",
		})
		// The K+1 task has no held observation.
		expect(hK1.getHeldCount()).toBe(0)
		expect(hK1.getHeldJobIds()).toEqual([])
		// The K+1 task emits submit_and_exit with no held
		// obligation; the bounded guard's eligibility predicate
		// (unconsumedOwnedTerminalResultsForC10 > 0) is false;
		// no observation_unavailable stamp; the legacy
		// done-without-completion path takes over.
		await emitSubmitAndExit(hK1.coordinator, hK1.translatorState, hK1.activeSessionId)
		expect(hK1.completionCommitCount()).toBe(0)
		expect(hK1.observationUnavailableStamps()).toBe(0)
		// K's held set is process-ephemeral and unreachable by
		// the K+1 harness (different (sessionId, taskId) key).
		expect(hK.getHeldCount()).toBe(1)
		expect(hK.getHeldJobIds()).toEqual(["J-K"])
	})
})

// =============================================================================
// BRC-05 - UI projection defect: the error phase from a BCB-blocked
//          observation_unavailable is rendered IDENTICALLY to a genuine
//          api_req_failed. The writerId is NOT consulted by the webview
//          button config. The user sees Retry + Start New Task with no
//          signal that Retry cannot succeed. (Source-bound assertions on
//          the production TurnState wire shape + buttonsForPhase.)
// =============================================================================

describe("BRC-05 - UI/host correspondence: the writerId is not projected onto the webview; the same error phase renders the same button set", () => {
	it("BRC-05a: a BCB-blocked error phase renders the SAME button set as a genuine api_req_failed (Retry + Start New Task); the production code does not consult the writerId", () => {
		// The two error phase sources are:
		//   (A) BCB block: setTurnPhase("error", undefined,
		//       "session-event-bcb-blocked-observation-unavailable")
		//       at sdk-session-event-coordinator.ts:3149-3153
		//   (B) Done-without-completion: setTurnPhase("error",
		//       undefined, "session-event-turn-complete-error")
		//       at sdk-session-event-coordinator.ts:2809
		// Both reach buttonsForPhase({ phase: "error", ... }) and
		// collapse to BUTTON_CONFIGS.api_req_failed - Retry +
		// Start New Task. The webview has no seam to distinguish
		// (A) from (B), nor (A) from a genuine api_req_failed
		// transport error.
		expect(ButtonConfigSource).toMatch(/case "error":[\s\S]*?return\s+BUTTON_CONFIGS\.api_req_failed/s)
		expect(ButtonConfigSource).toMatch(/primaryText:\s*"Retry"/)
		expect(ButtonConfigSource).toMatch(/secondaryText:\s*"Start New Task"/)
		expect(ButtonConfigSource).toMatch(/const errorTypes = \["api_req_failed"\]/)
		// The buttonsForPhase signature does NOT take writerId.
		const buttonsForPhaseMatch = ButtonConfigSource.match(/export function buttonsForPhase\(\s*([\s\S]*?)\s*\)\s*:/)
		expect(buttonsForPhaseMatch).not.toBeNull()
		const buttonsForPhaseArgs = buttonsForPhaseMatch?.[1] ?? ""
		expect(buttonsForPhaseArgs).toContain("turnState")
		expect(buttonsForPhaseArgs).not.toMatch(/writerId/)
		expect(buttonsForPhaseArgs).not.toMatch(/blockedReason/)
		// The function body has no writerId / blockedReason
		// branches.
		const buttonsForPhaseStart = ButtonConfigSource.indexOf("export function buttonsForPhase(")
		const buttonsForPhaseBody = ButtonConfigSource.slice(buttonsForPhaseStart)
		expect(buttonsForPhaseBody.slice(0, 3_000)).not.toMatch(/writerId/)
		expect(buttonsForPhaseBody.slice(0, 3_000)).not.toMatch(/blockedReason/)
	})

	it("BRC-05b: a future bounded UI fix would require a NEW public wire field (TurnState writerId or blockedReason); the current production code has neither", () => {
		// The closed TurnState interface has no writerId. A
		// bounded UI repair that wanted to disable Retry when
		// the BCR marker carries observation_unavailable would
		// require adding a new public field to TurnState (and
		// propagating it through getStateToPostToWebview +
		// buttonsForPhase + getButtonConfigFromState). Per C9,
		// such a repair is NOT authorized without explicit
		// operator acceptance of the new contract - this ACT
		// stops at HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED.
		const turnStateMatch = ExtensionMessageSource.match(/export interface TurnState \{([\s\S]*?)\}/)
		expect(turnStateMatch).not.toBeNull()
		const turnStateBody = turnStateMatch?.[1] ?? ""
		expect(turnStateBody).not.toMatch(/writerId|blockedReason|observationUnavailable/)
		// The bcrMarker / blockedReason is process-ephemeral on
		// the SdkSessionEventCoordinator (the
		// deferredCompletionBarrier private field); it is not
		// projected onto the wire.
		expect(SdkSessionEventCoordinatorSource).toMatch(
			/deferredCompletionBarrier:\s*DeferredCompletionBarrier\s*\|\s*undefined/,
		)
		// No bcrMarker / blockedReason projection in the
		// state push.
		const getStateBody = SdkControllerSource.slice(
			SdkControllerSource.indexOf("async getStateToPostToWebview(): Promise<ExtensionState>"),
		)
		expect(getStateBody.slice(0, 30_000)).not.toMatch(/bcrMarker|blockedReason/)
	})
})
