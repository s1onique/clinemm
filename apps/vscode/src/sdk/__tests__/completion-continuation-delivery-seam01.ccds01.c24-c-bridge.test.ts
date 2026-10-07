/**
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01 / CCDS01
 *
 * Production-shaped real-host chain probe for the independently-reproduced
 * LIVE failure where the deferred completion continuation callback IS
 * reached at the coordinator boundary (proved by predecessor ACT PCRL01)
 * but the downstream delivery seam is broken (`pending_prompt_enqueued = 0`
 * and `continuation_started = 0` in two independent LIVE specimens).
 *
 * This test exercises the REAL production chain:
 *
 *   coordinator.enqueueCompletionContinuationIfHeld
 *     -> REAL buildSdkControllerEnqueueCompletionContinuation factory
 *       -> REAL active.sdkHost.send({ delivery: "queue" })
 *         -> REAL LocalRuntimeHost.runTurn(input)
 *           -> REAL PendingPromptsController.enqueue (D5: C4 fires)
 *             -> REAL scheduleDrain (D8: queueMicrotask)
 *               -> REAL deps.send (D9: C5/C6 fired, second runTurn)
 *                 -> REAL executeAgentTurn
 *                   -> REAL synthetic agent.run (D10: model observes)
 *                     -> REAL agent_turn_done capture (C8)
 *
 * Each boundary asserts an observable witness (counter, list length,
 * capture record). The FIRST failing assertion pinpoints the FIRST
 * broken transition.
 *
 * Runs only under `apps/vscode/vitest.config.c2-4-c-bridge.ts` because
 * the bridge aliases resolve `@cline-internal/core/...` to the REAL
 * `LocalRuntimeHost` source rather than the `@cline/core` bundle or
 * the base-config stub.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CoreSessionEvent, SendSessionInput } from "@cline/core"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "@/sdk/background-notify-coordinator"
import type { ActiveSession } from "@/sdk/cline-session-factory"
import {
	enqueueElmAuthorityRecord,
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	resetElmAuthorityForTests,
	setElmAuthorityProvider,
} from "@/sdk/completion-authority-elm-authority-runtime"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority"
import { createProductionPendingPromptCapture } from "@/sdk/continuation-cardinality-authority.session-host-capture"
import { MessageIdMinter } from "@/sdk/message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "@/sdk/message-translator"
import { buildSdkControllerEnqueueCompletionContinuation } from "@/sdk/SdkController"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "@/sdk/sdk-session-event-coordinator"
import { TurnStateTracker } from "@/sdk/turn-state-tracker"

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

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

// Elm is owned by SDK; this baseline string mirrors what every other
// bridge test pins at the same path.
const HERE = fileURLToPath(import.meta.url)
const REAL_KERNEL_PATH = join(HERE, "..", "..", "..", "..", "elm", "completion-authority", "vendor", "completion-authority.js")

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	resetElmAuthorityForTests()
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	resetElmAuthorityForTests()
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
})

// ---------------------------------------------------------------------------
// Minimal session-service + runtime-builder stubs (mirrors CCCL01-E2E-01 /
// PCRS02C01). The LocalRuntimeHost constructor only invokes the methods
// below; we do not exercise persistence/messaging.
function makeSessionServiceStub() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions-ccds01"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/sessions-ccds01/manifest.json",
			messagesPath: "/tmp/sessions-ccds01/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-ccds01",
				source: "vscode",
				pid: process.pid,
				started_at: "2026-01-01T00:00:00.000Z",
				status: "running",
				interactive: true,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project-ccds01",
				workspace_root: "/tmp/project-ccds01",
				enable_tools: true,
				enable_spawn: true,
				enable_teams: true,
				prompt: "ccds01 initial prompt",
				messages_path: "/tmp/sessions-ccds01/messages.json",
			},
		}),
		persistSessionMessages: vi.fn().mockResolvedValue(undefined),
		updateSessionStatus: vi.fn().mockResolvedValue({ updated: true, endedAt: "2026-01-01T00:00:05.000Z" }),
		writeSessionManifest: vi.fn().mockResolvedValue(undefined),
		listSessions: vi.fn().mockResolvedValue([]),
		deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
	}
}

function makeRuntimeBuilderStub() {
	return {
		build: vi.fn().mockReturnValue({
			tools: [],
			teamRuntime: undefined,
			teamRestoredFromPersistence: false,
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}
}

function makeLoggerStub() {
	return {
		debug: vi.fn(),
		log: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		setLevel: vi.fn(),
	}
}

interface AgentHandle {
	agent: {
		run: ReturnType<typeof vi.fn>
		continue: ReturnType<typeof vi.fn>
		canStartRun: ReturnType<typeof vi.fn>
		abort: ReturnType<typeof vi.fn>
		subscribeEvents: ReturnType<typeof vi.fn>
		subscribeRecoveryStateChange: ReturnType<typeof vi.fn>
		getAgentId: ReturnType<typeof vi.fn>
		getConversationId: ReturnType<typeof vi.fn>
		shutdown: ReturnType<typeof vi.fn>
		getMessages: ReturnType<typeof vi.fn>
	}
	run: ReturnType<typeof vi.fn>
	continueFn: ReturnType<typeof vi.fn>
}

function makeCompletedAgent(): AgentHandle {
	let running = false
	const run = vi.fn(async (_prompt: string, _userImages?: string[], _userFiles?: string[]) => {
		running = true
		try {
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			return {
				finishReason: "completed",
				text: "",
				messages: [],
				toolCalls: [],
				durationMs: 1,
				iterations: 1,
				usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
				model: { id: "mock-model", provider: "mock-provider" },
				startedAt: new Date("2026-01-01T00:00:00.000Z"),
				endedAt: new Date("2026-01-01T00:00:01.000Z"),
			}
		} finally {
			running = false
		}
	})
	const continueFn = vi.fn(async (_prompt: string, _userImages?: string[], _userFiles?: string[]) => {
		running = true
		try {
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			return {
				finishReason: "completed",
				text: "",
				messages: [],
				toolCalls: [],
				durationMs: 1,
				iterations: 1,
				usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
				model: { id: "mock-model", provider: "mock-provider" },
				startedAt: new Date("2026-01-01T00:00:00.000Z"),
				endedAt: new Date("2026-01-01T00:00:01.000Z"),
			}
		} finally {
			running = false
		}
	})
	const agent = {
		run,
		continue: continueFn,
		canStartRun: vi.fn(() => !running),
		abort: vi.fn(() => {
			running = false
		}),
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		subscribeRecoveryStateChange: vi.fn().mockReturnValue(() => {}),
		getAgentId: vi.fn().mockReturnValue("agent-ccds01"),
		getConversationId: vi.fn().mockReturnValue("conv-ccds01"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	return { agent, run, continueFn }
}

// ---------------------------------------------------------------------------
// SdkSessionHost bridge: exposes LocalRuntimeHost.runTurn as the
// SdkSessionHost.send(input) shape. This is the EXACT shape that the
// production VscodeSessionHost takes at sdk-session-host.ts L499 (the
// wrapper calls this.inner.send(input), where this.inner is ClineCore
// whose `send` is `(...args) => this.host.runTurn(...args)`).
class AsdkSessionHostBridge {
	constructor(private readonly host: LocalRuntimeHost) {}
	async send(input: SendSessionInput): Promise<unknown> {
		return this.host.runTurn(input)
	}
}

// ---------------------------------------------------------------------------
// Harness: stitches the REAL production chain together.
interface DeliveryHarness {
	host: LocalRuntimeHost
	sdkHostBridge: AsdkSessionHostBridge
	activeSession: ActiveSession
	coordinator: SdkSessionEventCoordinator
	notifyCoordinator: BackgroundNotifyCoordinator
	translatorState: MessageTranslatorState
	setUnconsumed: (n: number) => void
	setHeldJobIds: (ids: string[]) => void
	commitCount: () => number
	lastPhase: () => string
	logger: ReturnType<typeof makeLoggerStub>
	agent: AgentHandle["agent"]
	isolationDir: string
}

interface DeliveryHarnessState {
	commitCount: number
	lastPhase: string
	unconsumed: number
	heldJobIds: string[]
}

function makeDeliveryHarness(opts: {
	sessionId: string
	taskId: string
	agent: AgentHandle
	isolationDir: string
}): DeliveryHarness {
	const logger = makeLoggerStub()
	const sessionService = makeSessionServiceStub()
	const runtimeBuilder = makeRuntimeBuilderStub()

	const host = new LocalRuntimeHost({
		distinctId: "act-ccds01",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => opts.agent.agent as never,
		logger,
		// CRITICAL: pass the REAL production capture hooks. The
		// LocalRuntimeHost forwards them to PendingPromptsController
		// for C4 (onEnqueue) + C5/C6 (drain hooks).
		pendingPromptCapture: createProductionPendingPromptCapture(),
	})

	const sdkHostBridge = new AsdkSessionHostBridge(host)

	const activeSession: ActiveSession = {
		sessionId: opts.sessionId,
		startConfig: { providerId: "mock-provider", modelId: "mock-model" },
		sdkHost: sdkHostBridge as unknown as ActiveSession["sdkHost"],
		unsubscribe: () => undefined,
		startResult: undefined,
		isRunning: false,
	}

	const state: DeliveryHarnessState = {
		commitCount: 0,
		lastPhase: "idle",
		unconsumed: 1,
		heldJobIds: ["cmd_muuew7yq3gbi7raf"],
	}

	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: opts.sessionId, taskId: opts.taskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
		now: () => Date.now(),
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => activeSession,
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: ((_msgs: unknown[]) => {}) as never as never,
		},
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => ({ taskId: opts.taskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			state.lastPhase = phase
			if (phase === "completed") state.commitCount += 1
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		// LIVE-shaped: at submit_and_exit_seen time the BCB barrier
		// clears; only AFTER submit does the terminal result enter the
		// unconsumed counter. This mirrors the LIVE B chronology.
		getUnconsumedOwnedTerminalResultCount: () => state.unconsumed,
		getUnconsumedOwnedTerminalJobIds: () => (state.unconsumed > 0 ? state.heldJobIds : []),
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		wasWakeAuthoritySettled: () => true,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		// *** THE PRODUCTION CALLBACK ****
		// Real buildSdkControllerEnqueueCompletionContinuation. This
		// is the SAME factory the production SdkController wires at
		// SdkController.ts:2508. No re-implementation.
		enqueueCompletionContinuation: buildSdkControllerEnqueueCompletionContinuation({
			getActiveSession: () => activeSession,
			// ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06-CAPABILITY-FAIL-CLOSED-P1:
			// Test fixture supplies the historical default tool list
			// so the production seam's capability projection has an
			// honest input. Bridge configuration mirrors the production
			// liveTools accessor chain (LocalRuntimeHost-backed).
			liveTools: () => ["command_status", "submit_and_exit"],
			logger: { warn: (msg: string) => logger.warn(msg) },
		}),
		getElmCompletionAuthorityDecision: (sessionId?: string) => getElmAuthorityCompletionDecision(sessionId ?? ""),
		flushElmAuthorityForSession: async (sessionId: string) => flushElmAuthorityForSession(sessionId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		host,
		sdkHostBridge,
		activeSession,
		coordinator,
		notifyCoordinator,
		translatorState,
		setUnconsumed: (n: number) => {
			state.unconsumed = n
		},
		setHeldJobIds: (ids: string[]) => {
			state.heldJobIds = ids
		},
		commitCount: () => state.commitCount,
		lastPhase: () => state.lastPhase,
		logger,
		agent: opts.agent.agent,
		isolationDir: opts.isolationDir,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: { sessionId, event: event as never },
	}) as CoreSessionEvent

async function emitCompletionTurn(
	coordinator: SdkSessionEventCoordinator,
	sessionId: string,
	translatorState: MessageTranslatorState,
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
}

async function emitAgentTurnDone(coordinator: SdkSessionEventCoordinator, sessionId: string, runId: string): Promise<void> {
	await enqueueElmAuthorityRecord({ stage: "agent_turn_done", sessionId, runId })
	await coordinator.notifyAgentTurnDone(sessionId)
}

async function waitFor(predicate: () => boolean, description: string, deadlineMs = 8_000): Promise<void> {
	const start = Date.now()
	while (!predicate()) {
		if (Date.now() - start > deadlineMs) {
			throw new Error(`waitFor: ${description} did not become true within ${deadlineMs}ms`)
		}
		await new Promise((resolve) => setImmediate(resolve))
	}
}

describe("ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01 / CCDS01", () => {
	let isolationDir = ""
	const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "ccds01-bridge-"))
		process.env.HOME = isolationDir
		process.env.CLINE_DIR = join(isolationDir, ".cline")
	})

	afterEach(async () => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		if (isolationDir && existsSync(isolationDir)) {
			rmSync(isolationDir, { recursive: true, force: true })
		}
		vi.restoreAllMocks()
	})

	// -----------------------------------------------------------------
	// CCDS01-01: PRODUCTION CHAIN PROBE
	//
	// Drive the LIVE-shaped chronology with the REAL production
	// callback wired through a REAL LocalRuntimeHost bridge. The
	// assertion at every boundary pinpoints the FIRST divergence if the
	// seam is broken.
	//
	// Pre-fix the test REDs at one of: D3 (callback fails to invoke
	// sdkHost.send), D5 (queue insert absent), D7
	// (pending_prompt_enqueued capture absent), D9 (drain absent),
	// D10 (model not actually invoked).
	//
	// Post-fix the test GREENs with pending_prompt_enqueued >= 1 and
	// continuation_scheduled >= 1 and the agent.run mock invoked
	// with the COALESCED continuation prompt.
	// -----------------------------------------------------------------
	it("CCDS01-01: real production chain drives PendingPromptsController.enqueue with the coalesced prompt; pending_prompt_enqueued and continuation_scheduled both fire", async () => {
		setElmAuthorityProvider(REAL_KERNEL_PATH)
		const sessionId = "sess-ccds01-01"
		const taskId = "task-ccds01-01"

		const heldJobIds = ["cmd_muuew7yq3gbi7raf"]
		const { agent: _agent, run: a2Run } = makeCompletedAgent()
		void _agent

		const harness = makeDeliveryHarness({
			sessionId,
			taskId,
			agent: { agent: _agent, run: a2Run, continueFn: a2Run },
			isolationDir,
		})
		harness.setHeldJobIds(heldJobIds)

		await harness.host.startSession({
			source: "vscode",
			interactive: true,
			config: {
				sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "ccds01 test agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		// Seed Elm with the LIVE-shaped chronology:
		//   task_started -> run_turn_started -> ...
		await enqueueElmAuthorityRecord({ stage: "task_started", sessionId, taskId })
		await enqueueElmAuthorityRecord({
			stage: "run_turn_started",
			sessionId,
			runId: "run-ccds01-01",
			origin: "explicit_user",
		})

		// 1. LIVE B shape: terminal_committed fires BEFORE submit_and_exit_seen,
		//    so unconsumed is ALREADY > 0 at submit time. The BCB
		//    barrier HOLDS at the initial-dispatch site (line 1616)
		//    AND fires the bounded continuation enqueue (dedupe set
		//    to current epoch). The post-run reeval at agent_turn_done
		//    then sees dedupe already consumed (`already_sent`)
		//    and does NOT re-fire.
		harness.setUnconsumed(1)
		harness.setHeldJobIds(heldJobIds)
		await emitCompletionTurn(harness.coordinator, sessionId, harness.translatorState)
		expect(harness.commitCount()).toBe(0)
		// In LIVE B shape, the BCB barrier holds at the initial-dispatch
		// site so the Elm consult does NOT fire at submit time (it
		// would only fire at agent_turn_done via checkElmCompletionAuthority).
		// The continuation enqueue IS fired at initial-dispatch.

		// 2. notifyAgentTurnDone -> reevaluateDeferredCompletionBarrier ->
		//    the dedupe marker is ALREADY set from the initial-dispatch
		//    path above, so this reeval returns `already_sent` and does
		//    NOT re-fire the continuation.
		await emitAgentTurnDone(harness.coordinator, sessionId, "run-ccds01-01")

		// ---- BOUNDARY D7: pending_prompt_enqueued capture fired.
		const ccardRecords = getContinuationCardinalityAuthorityCaptureRecords()
		const enqueued = ccardRecords.filter((r) => r.stage === "pending_prompt_enqueued")
		expect(enqueued.length).toBeGreaterThanOrEqual(1)

		// The enqueue should carry the LIVE-shaped sessionId.
		expect(enqueued[0]?.sessionId).toBe(sessionId)

		// ---- BOUNDARY D5/D9/D10: queue insert, drain, and model
		//     observation all happen. Wait for the agent.run to be
		//     INVOKED (queue has drained and the second runTurn is in
		//     flight). Allow time for the in-flight agent.run to
		//     settle (the mock awaits 2 setImmediates).
		await waitFor(() => a2Run.mock.calls.length >= 1, "agent.run to be invoked at least once (drain dispatched)")

		// Allow microtasks to settle so the runTurn's markTurnIdle
		// side effect has a chance to land before we observe the
		// queue + capture ring.
		for (let i = 0; i < 5; i++) {
			await new Promise((resolve) => setImmediate(resolve))
		}

		// ---- BOUNDARY D9: continuation_scheduled capture fired
		//     (onBeforeDispatch hook in the real
		//     continuation-cardinality-authority.session-host-capture).
		const scheduled = ccardRecords.filter((r) => r.stage === "continuation_scheduled")
		expect(scheduled.length).toBeGreaterThanOrEqual(1)

		// ---- BOUNDARY D10: model (synthetic) observed the
		//     COALESCED continuation prompt. The
		//     formatCompletionContinuationPrompt prefix is the
		//     deterministic marker.
		const drainCallArgs = a2Run.mock.calls[0]?.[0] ?? ""
		expect(typeof drainCallArgs).toBe("string")
		expect(drainCallArgs).toContain("deferred completion is requesting observation")

		// ---- Final queue state: drained.
		const finalQueue = await harness.host.pendingPrompts.list({ sessionId })
		expect(finalQueue).toEqual([])

		// NOTE: We do NOT assert session status === "idle" here. The
		// post-run reeval driven by the second agent_turn_done can
		// briefly flip status as it processes Elm consults in
		// background; the load-bearing assertions are D5/D7/D9/D10
		// above (queue insert, pending_prompt_enqueued capture,
		// continuation_scheduled capture, model observed the
		// coalesced prompt). The session eventually settles to idle
		// once Elm consults settle.

		await harness.host.dispose()
	}, 30_000)
})
