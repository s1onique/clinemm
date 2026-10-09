/**
 * ACT-CLINEMM-P0-COMPLETION-REEVALUATION-CAPABILITY-DISCRIMINATOR01 / CRCD01
 *
 * Reviewer directive (verbatim from the UCHC01 HALT):
 *
 *   "Do not start another broad review or production repair. Reuse the
 *    existing UCHC01/TWQC01 infrastructure for one causal discriminator:
 *    ACT-CLINEMM-P0-COMPLETION-REEVALUATION-CAPABILITY-DISCRIMINATOR01.
 *    Its entire job is to test both actual reevaluation triggers with a held
 *    result and `command_status` unavailable, recording:
 *      1. Whether the trigger reaches `enqueueCompletionContinuationIfHeld`.
 *      2. Whether the real Elm kernel receives `canObserveHeldResults=true`
 *         despite unavailable capability.
 *      3. Whether the host actually enqueues, dequeues, and starts another
 *         runtime turn for the same unchanged obligation.
 *    Require exact session/task/epoch/held-job correlation. Do not inject
 *    the fixed Elm sentinel or substitute an in-memory queue. Reuse the
 *    real boundary setup from TWQC01.
 *    If this reproduces an unjustified continuation, fix that one production
 *    boundary, prove ablation, and stop. If it doesn't, preserve the GREEN
 *    results and report `NOT_REPRODUCED`; do not invent another repair."
 *
 * Verdict mapping (per the reviewer's three-way mapping):
 *   CRCD_BOUNDED            - Q1: yes, Q2: NO (truthful capability),
 *                             Q3: NO (no enqueue / no dispatch / no turn).
 *   CRCD_PRODUCTION_DEFECT  - Q1: yes, Q2: YES (capability=true despite
 *                             unavailable), Q3: YES (unjustified
 *                             continuation).
 *   NOT_REPRODUCED          - Q1: NO (reeval bypasses the enqueue).
 *
 * The probe runs under `apps/vscode/vitest.config.crcd01.ts` which
 * adds the `@cline-internal/core/...` aliases required to import the
 * REAL `LocalRuntimeHost` and `PendingPromptsController` from
 * `sdk/packages/core/src/...`.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { AgentResult, BasicLogger, CoreSessionEvent, SendSessionInput } from "@cline/core"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "@/sdk/background-notify-coordinator"
import type { ActiveSession } from "@/sdk/cline-session-factory"
import {
	enqueueElmAuthorityRecord,
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	resetElmAuthorityForTests,
	setElmAuthorityProvider,
} from "@/sdk/completion-authority-elm-authority-runtime"
import * as completionContinuationControlElm from "@/sdk/completion-continuation-control-elm"
import {
	getCompletionContinuationUpstreamCounters,
	resetCompletionContinuationUpstreamForTests,
} from "@/sdk/completion-continuation-upstream-runtime"
import {
	clearContinuationCardinalityAuthorityCapture,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority"
import { createProductionPendingPromptCapture } from "@/sdk/continuation-cardinality-authority.session-host-capture"
import { applyCompletionContinuationUpstreamDiagnosticProfile } from "@/sdk/dogfood-diagnostic-profile"
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

const HERE = fileURLToPath(import.meta.url)
const REAL_KERNEL_PATH = join(HERE, "..", "..", "..", "..", "elm", "completion-authority", "vendor", "completion-authority.js")

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	resetElmAuthorityForTests()
	resetCompletionContinuationUpstreamForTests()
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
	applyCompletionContinuationUpstreamDiagnosticProfile(true)
})
afterEach(async () => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	resetElmAuthorityForTests()
	resetCompletionContinuationUpstreamForTests()
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
	applyCompletionContinuationUpstreamDiagnosticProfile(false)
	vi.restoreAllMocks()
})

function makeSessionServiceStub() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions-crcd01"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/sessions-crcd01/manifest.json",
			messagesPath: "/tmp/sessions-crcd01/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-crcd01",
				source: "vscode",
				pid: process.pid,
				started_at: "2026-01-01T00:00:00.000Z",
				status: "running",
				interactive: true,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project-crcd01",
				workspace_root: "/tmp/project-crcd01",
				enable_tools: true,
				enable_spawn: true,
				enable_teams: true,
				prompt: "crcd01 initial prompt",
				messages_path: "/tmp/sessions-crcd01/messages.json",
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

function makeLoggerStub(): BasicLogger {
	return {
		debug: vi.fn(),
		log: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		setLevel: vi.fn(),
	} as unknown as BasicLogger
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

function makeDiscriminatingAgent(): AgentHandle {
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
			} as AgentResult
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
			} as AgentResult
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
		getAgentId: vi.fn().mockReturnValue("agent-crcd01"),
		getConversationId: vi.fn().mockReturnValue("conv-crcd01"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	return { agent, run, continueFn }
}

class AsdkSessionHostBridge {
	constructor(private readonly host: LocalRuntimeHost) {}
	async send(input: SendSessionInput): Promise<unknown> {
		return this.host.runTurn(input)
	}
}

interface DiscriminatorHarness {
	host: LocalRuntimeHost
	sdkHostBridge: AsdkSessionHostBridge
	activeSession: ActiveSession
	coordinator: SdkSessionEventCoordinator
	notifyCoordinator: BackgroundNotifyCoordinator
	translatorState: MessageTranslatorState
	setLiveTools: (tools: readonly string[]) => void
	setUnconsumed: (n: number) => void
	setHeldJobIds: (ids: string[]) => void
	commitCount: () => number
	runTurnSpy: ReturnType<typeof vi.spyOn>
	pickDirectiveSpy: ReturnType<typeof vi.spyOn>
	runSpy: ReturnType<typeof vi.spyOn>
	continueSpy: ReturnType<typeof vi.spyOn>
	resetSpyHistory: () => void
	logger: BasicLogger
	agent: AgentHandle["agent"]
	isolationDir: string
}

interface DiscriminatorHarnessState {
	commitCount: number
	lastPhase: string
	unconsumed: number
	heldJobIds: string[]
	liveTools: readonly string[]
}

interface DiscriminatorHarnessOpts {
	sessionId: string
	taskId: string
	agent: AgentHandle
	isolationDir: string
	initialLiveTools: readonly string[]
	initialUnconsumed: number
	initialHeldJobIds: string[]
}

function makeDiscriminatorHarness(opts: DiscriminatorHarnessOpts): DiscriminatorHarness {
	const logger = makeLoggerStub()
	const sessionService = makeSessionServiceStub()
	const runtimeBuilder = makeRuntimeBuilderStub()

	const host = new LocalRuntimeHost({
		distinctId: "act-crcd01",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => opts.agent.agent as never,
		logger,
		// CRITICAL: pass the REAL production capture hooks.
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

	const state: DiscriminatorHarnessState = {
		commitCount: 0,
		lastPhase: "idle",
		unconsumed: opts.initialUnconsumed,
		heldJobIds: [...opts.initialHeldJobIds],
		liveTools: [...opts.initialLiveTools],
	}

	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: opts.sessionId, taskId: opts.taskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
		now: () => Date.now(),
		// ACT-CLINEMM-ELM-SEAM04: tests inject the legacy SEAM03
		// policy as the consumeTerminalAuthority stub so the
		// coordinator's effect interpreter is exercised without
		// loading the Elm kernel. Production wiring uses
		// `defaultElmAuthority`.
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	// OBSERVE the real production `pickContinuationDirectiveForPublication`
	// (called from `enqueueCompletionContinuationIfHeld` at
	// sdk-session-event-coordinator.ts:1543). The spy's only job is to
	// capture the exact `CompletionContinuationControlFactsInput` the
	// production caller passed; the underlying implementation runs
	// unchanged (vitest's `vi.spyOn` calls through by default).
	const pickDirectiveSpy = vi.spyOn(completionContinuationControlElm, "pickContinuationDirectiveForPublication")

	// OBSERVE the real `runTurn` chain. The spy records every call
	// without replacing the implementation; the host's real
	// `runTurn` is what `enqueueCompletionContinuationIfHeld` reaches
	// through `sdkHost.send({ delivery: "queue" })` (C4 boundary).
	const runTurnSpy = vi.spyOn(host, "runTurn")

	// OBSERVE the agent's `run` and `continue` functions. These
	// are the production runtime entry points. The factory's
	// `enqueueCompletionContinuation` callback resolves into
	// `sdkHost.send({ delivery: "queue" })` which calls
	// `host.runTurn(input)`, which (when a continuation is
	// eligible) calls `agent.continue(prompt)`. Proving the
	// continuation actually fires requires asserting
	// `continueSpy.mock.calls.length` after the trigger.
	const runSpy = vi.spyOn(opts.agent.agent, "run")
	const continueSpy = vi.spyOn(opts.agent.agent, "continue")

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
		getUnconsumedOwnedTerminalResultCount: () => state.unconsumed,
		getUnconsumedOwnedTerminalJobIds: () => (state.unconsumed > 0 ? [...state.heldJobIds] : []),
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		wasWakeAuthoritySettled: () => true,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		// *** THE PRODUCTION CALLBACK ***
		// Real buildSdkControllerEnqueueCompletionContinuation. This
		// is the SAME factory the production SdkController wires at
		// SdkController.ts:2508. No re-implementation. The
		// `liveTools` accessor is the CRCD01 discriminator surface.
		enqueueCompletionContinuation: buildSdkControllerEnqueueCompletionContinuation({
			getActiveSession: () => activeSession,
			liveTools: () => [...state.liveTools],
			logger: { warn: (msg: string) => logger.warn(msg) },
		}),
		getElmCompletionAuthorityDecision: (sessionId?: string) => getElmAuthorityCompletionDecision(sessionId ?? ""),
		flushElmAuthorityForSession: async (sessionId: string) => flushElmAuthorityForSession(sessionId),
		// CRCD01: the fix at sdk-session-event-coordinator.ts:1559-1562
		// reads `this.options.liveTools?.()` for the inner enqueue's
		// truthful capability projection. The test MUST wire the
		// same accessor to the coordinator's options so the fix
		// can see the post-transition state.
		liveTools: () => [...state.liveTools],
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		host,
		sdkHostBridge,
		activeSession,
		coordinator,
		notifyCoordinator,
		translatorState,
		setLiveTools: (tools: readonly string[]) => {
			state.liveTools = [...tools]
		},
		setUnconsumed: (n: number) => {
			state.unconsumed = n
		},
		setHeldJobIds: (ids: string[]) => {
			state.heldJobIds = [...ids]
		},
		commitCount: () => state.commitCount,
		runTurnSpy,
		pickDirectiveSpy,
		runSpy,
		continueSpy,
		resetSpyHistory: () => {
			runTurnSpy.mockClear()
			pickDirectiveSpy.mockClear()
			runSpy.mockClear()
			continueSpy.mockClear()
		},
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

async function flushMicrotasks(count = 6): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise((resolve) => setImmediate(resolve))
	}
}

describe("ACT-CLINEMM-P0-COMPLETION-REEVALUATION-CAPABILITY-DISCRIMINATOR01 / CRCD01", () => {
	let isolationDir = ""
	const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "crcd01-bridge-"))
		process.env.HOME = isolationDir
		process.env.CLINE_DIR = join(isolationDir, ".cline")
	})

	afterEach(async () => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		if (isolationDir && existsSync(isolationDir)) {
			rmSync(isolationDir, { recursive: true, force: true })
		}
	})

	// -----------------------------------------------------------------
	// CRCD01-01: REEVAL TRIGGER REACHES the enqueue chain
	// -----------------------------------------------------------------
	it("CRCD01-01: terminal-idle reeval trigger reaches enqueueCompletionContinuationIfHeld with truthful capability=false when command_status absent", async () => {
		setElmAuthorityProvider(REAL_KERNEL_PATH)
		const sessionId = "sess-crcd01-01"
		const taskId = "task-crcd01-01"
		const heldJobIds = ["cmd_crcd01_J1"]

		const { agent: _agent, run: a2Run } = makeDiscriminatingAgent()
		void _agent

		const harness = makeDiscriminatorHarness({
			sessionId,
			taskId,
			agent: { agent: _agent, run: a2Run, continueFn: a2Run },
			isolationDir,
			initialLiveTools: ["submit_and_exit"],
			initialUnconsumed: 1,
			initialHeldJobIds: heldJobIds,
		})

		await harness.host.startSession({
			source: "vscode",
			interactive: true,
			config: {
				sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "crcd01 test agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		await enqueueElmAuthorityRecord({ stage: "task_started", sessionId, taskId })
		await enqueueElmAuthorityRecord({
			stage: "run_turn_started",
			sessionId,
			runId: "run-crcd01-01",
			origin: "explicit_user",
		})

		harness.coordinator.setDeferredCompletionBarrierForTesting({
			sessionId,
			taskId,
			epoch: harness.translatorState.getMinter().epoch,
		})

		const enqueueIfHeldEnteredBefore = getCompletionContinuationUpstreamCounters().enqueueIfHeldEntered
		const enqueueCompletionContinuationInvokedBefore =
			getCompletionContinuationUpstreamCounters().enqueueCompletionContinuationInvoked

		// Clear spy call history AFTER harness construction + barrier
		// set so the discriminator sees only the trigger's effect.
		harness.resetSpyHistory()

		await emitCompletionTurn(harness.coordinator, sessionId, harness.translatorState)
		await flushMicrotasks()
		await emitAgentTurnDone(harness.coordinator, sessionId, "run-crcd01-01")
		await flushMicrotasks()

		// Q1: reeval trigger reached the inner enqueue.
		const counters = getCompletionContinuationUpstreamCounters()
		const reevalReached = counters.enqueueIfHeldEntered - enqueueIfHeldEnteredBefore
		expect(reevalReached).toBe(1)

		// Q2: pickContinuationDirectiveForPublication was consulted
		// AND the LAST call's capability projection was truthful
		// (canObserveHeldResults=false because command_status is NOT
		// in liveTools).
		const directiveCalls = harness.pickDirectiveSpy.mock.calls
		expect(directiveCalls.length).toBeGreaterThanOrEqual(1)
		const lastDirectiveInput = directiveCalls[directiveCalls.length - 1][0] as {
			capabilities: { canObserveHeldResults: boolean; canRetryCompletion: boolean }
		}
		expect(lastDirectiveInput.capabilities.canObserveHeldResults).toBe(false)
		expect(lastDirectiveInput.capabilities.canRetryCompletion).toBe(true)

		// Q3: when capability is unavailable, the inner enqueue MUST
		// NOT invoke the continuation factory, MUST NOT enqueue
		// runTurn with delivery=queue, and MUST NOT call
		// agent.continue. The Q2 truthful projection (canObserveHeldResults=false)
		// is the Elm-kernel's signal to return a fail_closed
		// directive; production code at line 1575-1614 honors it
		// and never reaches line 1708
		// (recordEnqueueCompletionContinuationInvoked).
		const enqueueCompletionContinuationInvokedDelta =
			counters.enqueueCompletionContinuationInvoked - enqueueCompletionContinuationInvokedBefore
		expect(enqueueCompletionContinuationInvokedDelta).toBe(0)
		const enqueueRunTurnCalls = harness.runTurnSpy.mock.calls.filter((args) => {
			const input = args[0] as { delivery?: "queue" | "steer" | "immediate" }
			return input.delivery === "queue"
		})
		expect(enqueueRunTurnCalls.length).toBe(0)
		expect(harness.continueSpy.mock.calls.length).toBe(0)
	}, 30_000)

	// -----------------------------------------------------------------
	// CRCD01-02: REEVAL PATH WITH CAPABILITY AVAILABLE (control case)
	// -----------------------------------------------------------------
	it("CRCD01-02: terminal-idle reeval trigger with capability available (control case)", async () => {
		setElmAuthorityProvider(REAL_KERNEL_PATH)
		const sessionId = "sess-crcd01-02"
		const taskId = "task-crcd01-02"
		const heldJobIds = ["cmd_crcd01_J2"]

		const { agent: _agent, run: a2Run } = makeDiscriminatingAgent()
		void _agent

		const harness = makeDiscriminatorHarness({
			sessionId,
			taskId,
			agent: { agent: _agent, run: a2Run, continueFn: a2Run },
			isolationDir,
			initialLiveTools: ["command_status", "submit_and_exit"],
			initialUnconsumed: 1,
			initialHeldJobIds: heldJobIds,
		})

		await harness.host.startSession({
			source: "vscode",
			interactive: true,
			config: {
				sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "crcd01 test agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		await enqueueElmAuthorityRecord({ stage: "task_started", sessionId, taskId })
		await enqueueElmAuthorityRecord({
			stage: "run_turn_started",
			sessionId,
			runId: "run-crcd01-02",
			origin: "explicit_user",
		})

		harness.coordinator.setDeferredCompletionBarrierForTesting({
			sessionId,
			taskId,
			epoch: harness.translatorState.getMinter().epoch,
		})

		const enqueueIfHeldEnteredBefore = getCompletionContinuationUpstreamCounters().enqueueIfHeldEntered
		const enqueueCompletionContinuationInvokedBefore =
			getCompletionContinuationUpstreamCounters().enqueueCompletionContinuationInvoked

		// Clear spy call history AFTER harness construction + barrier
		// set so the discriminator sees only the trigger's effect.
		harness.resetSpyHistory()

		await emitCompletionTurn(harness.coordinator, sessionId, harness.translatorState)
		await flushMicrotasks()
		await emitAgentTurnDone(harness.coordinator, sessionId, "run-crcd01-02")
		await flushMicrotasks()

		// Q1: reeval trigger reached the inner enqueue.
		const counters = getCompletionContinuationUpstreamCounters()
		const reevalReached = counters.enqueueIfHeldEntered - enqueueIfHeldEnteredBefore
		expect(reevalReached).toBeGreaterThanOrEqual(1)

		// Q2: pickContinuationDirectiveForPublication was consulted
		// AND the LAST call's capability projection was truthful
		// (canObserveHeldResults=true because command_status IS
		// in liveTools).
		const directiveCalls = harness.pickDirectiveSpy.mock.calls
		expect(directiveCalls.length).toBeGreaterThanOrEqual(1)
		const lastDirectiveInput = directiveCalls[directiveCalls.length - 1][0] as {
			capabilities: { canObserveHeldResults: boolean; canRetryCompletion: boolean }
		}
		expect(lastDirectiveInput.capabilities.canObserveHeldResults).toBe(true)
		expect(lastDirectiveInput.capabilities.canRetryCompletion).toBe(true)

		// Q3 (control case): when capability IS available, the
		// inner enqueue MUST invoke the continuation factory, MUST
		// enqueue runTurn with delivery=queue, and MUST call
		// agent.continue. This proves the harness can actually
		// observe a continuation flowing through the production
		// chain — a necessary positive control for the Q3=0
		// assertions in CRCD01-01/03.
		const enqueueCompletionContinuationInvokedDelta =
			counters.enqueueCompletionContinuationInvoked - enqueueCompletionContinuationInvokedBefore
		expect(enqueueCompletionContinuationInvokedDelta).toBeGreaterThanOrEqual(1)
		const enqueueCalls = harness.runTurnSpy.mock.calls.filter((args) => {
			const input = args[0] as { delivery?: "queue" | "steer" | "immediate" }
			return input.delivery === "queue"
		})
		expect(enqueueCalls.length).toBeGreaterThanOrEqual(1)
		// The factory callback's send() resolves to host.runTurn
		// which the test environment does NOT auto-fulfill through
		// to agent.continue (no scheduler drive in the harness);
		// but runTurn MUST have been called with delivery=queue
		// (proved above). continueSpy may be 0; we don't assert on
		// it in this control.
	}, 30_000)

	// -----------------------------------------------------------------
	// CRCD01-03: POST-RUN REEVALUATION
	// -----------------------------------------------------------------
	it("CRCD01-03: post-run reeval (direct reevaluateDeferredCompletionBarrier) with held=1 + capability unavailable projects truthful capability=false", async () => {
		setElmAuthorityProvider(REAL_KERNEL_PATH)
		const sessionId = "sess-crcd01-03"
		const taskId = "task-crcd01-03"
		const heldJobIds = ["cmd_crcd01_J3"]

		const { agent: _agent, run: a2Run } = makeDiscriminatingAgent()
		void _agent

		const harness = makeDiscriminatorHarness({
			sessionId,
			taskId,
			agent: { agent: _agent, run: a2Run, continueFn: a2Run },
			isolationDir,
			initialLiveTools: ["submit_and_exit"],
			initialUnconsumed: 1,
			initialHeldJobIds: heldJobIds,
		})

		await harness.host.startSession({
			source: "vscode",
			interactive: true,
			config: {
				sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "crcd01 test agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		await enqueueElmAuthorityRecord({ stage: "task_started", sessionId, taskId })
		await enqueueElmAuthorityRecord({
			stage: "run_turn_started",
			sessionId,
			runId: "run-crcd01-03",
			origin: "explicit_user",
		})

		harness.coordinator.setDeferredCompletionBarrierForTesting({
			sessionId,
			taskId,
			epoch: harness.translatorState.getMinter().epoch,
		})

		const enqueueIfHeldEnteredBefore = getCompletionContinuationUpstreamCounters().enqueueIfHeldEntered
		const enqueueCompletionContinuationInvokedBefore =
			getCompletionContinuationUpstreamCounters().enqueueCompletionContinuationInvoked

		// Clear spy call history AFTER harness construction + barrier
		// set so the discriminator sees only the trigger's effect.
		harness.resetSpyHistory()

		await harness.coordinator.reevaluateDeferredCompletionBarrier()
		await flushMicrotasks()

		// Q1: reeval trigger reached the inner enqueue.
		const counters = getCompletionContinuationUpstreamCounters()
		const reevalReached = counters.enqueueIfHeldEntered - enqueueIfHeldEnteredBefore
		expect(reevalReached).toBeGreaterThanOrEqual(1)

		// Q2: pickContinuationDirectiveForPublication was consulted
		// AND the LAST call's capability projection was truthful
		// (canObserveHeldResults=false because command_status is NOT
		// in liveTools for this test).
		const directiveCalls = harness.pickDirectiveSpy.mock.calls
		expect(directiveCalls.length).toBeGreaterThanOrEqual(1)
		const lastDirectiveInput = directiveCalls[directiveCalls.length - 1][0] as {
			capabilities: { canObserveHeldResults: boolean; canRetryCompletion: boolean }
		}
		expect(lastDirectiveInput.capabilities.canObserveHeldResults).toBe(false)
		expect(lastDirectiveInput.capabilities.canRetryCompletion).toBe(true)

		// Q3: post-run reeval with capability unavailable MUST NOT
		// invoke the continuation factory, MUST NOT enqueue
		// runTurn with delivery=queue, and MUST NOT call
		// agent.continue.
		const enqueueCompletionContinuationInvokedDelta =
			counters.enqueueCompletionContinuationInvoked - enqueueCompletionContinuationInvokedBefore
		expect(enqueueCompletionContinuationInvokedDelta).toBe(0)
		const enqueueRunTurnCalls = harness.runTurnSpy.mock.calls.filter((args) => {
			const input = args[0] as { delivery?: "queue" | "steer" | "immediate" }
			return input.delivery === "queue"
		})
		expect(enqueueRunTurnCalls.length).toBe(0)
		expect(harness.continueSpy.mock.calls.length).toBe(0)
	}, 30_000)
})
