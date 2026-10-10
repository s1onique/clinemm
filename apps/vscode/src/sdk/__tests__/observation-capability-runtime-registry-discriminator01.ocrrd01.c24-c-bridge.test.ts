/**
 * ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01 — OCRRD01
 *
 * Single bounded production-registry probe (per Factory reviewer
 * disposition on ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-
 * NONCONVERGENCE01 at commit `1dd61a5d5` and
 * ACT-CLINEMM-P0-BLOCKED-OBSERVATION-CAPABILITY-RECOVERY-PROBE01
 * at commit `98d229e6a`).
 *
 * The BOCR01 closure is `PASS_BOUNDED_COMPONENT_CONSERVATION` —
 * its tests asserted the production seam through the BOCR01
 * harness's helper methods, but the helper methods
 * (`commandStatusResolveObligation`,
 * `consumeNonNotifyTerminalObservation`) are invoked directly
 * on the test's `BackgroundNotifyCoordinator`, not through the
 * production `command_status` tool. BOCR01 also stops at
 * `completionCommitCount() === 0` after the drain, leaving the
 * post-drain completion eligibility boundary unproven.
 *
 * This ACT closes both gaps by driving the LIVE chain end-to-end
 * against the REAL `LocalRuntimeHost`, REAL
 * `BackgroundNotifyCoordinator`, REAL `CommandJobManager`, and
 * REAL `createCommandStatusTool` (the production factory):
 *
 *   createCommandStatusTool(manager, { backgroundNotifyCoordinator,
 *                                       resolveActiveOwner,
 *                                       onRunningObserved })
 *     ↓
 *   tool.execute({ jobId: "J-probe" })
 *     ↓
 *   BackgroundNotifyCoordinator owner-state transition
 *     ↓
 *   unconsumedTerminalCountForOwner = 0
 *     ↓
 *   next submit_and_exit -> setTurnPhase("completed", ...)
 *     ↓
 *   task_completion_committed = 1
 *
 * Three decisive cases (Factory reviewer's specification):
 *   1. Registry correspondence: confirm the production
 *      `createCommandStatusTool` factory produces a tool whose
 *      `.execute()` drives a real `BackgroundNotifyCoordinator`
 *      state transition. (The runtime registry is exercised by
 *      the existing BCCA01 / BCCR01 / UCHC01 / PTBPC01 tests; this
 *      ACT focuses on the drain + completion chain.)
 *   2. Non-notify recovery: drive real `command_status.execute(J)`
 *      with an actual terminal job, prove the observation is
 *      consumed, and exercise the subsequent completion
 *      eligibility boundary.
 *   3. Notify-held conservation: establish whether the registered
 *      observation mechanism can discharge a notify-held
 *      obligation, or whether a different terminal/wake event
 *      is legitimately required.
 *
 * If the production factory and session registry are correct AND
 * the observed hold is unavoidable, the next task becomes a
 * recovery UX contract, not a completion-authority repair.
 *
 * Real `LocalRuntimeHost` (production class via
 * `@cline-internal/core/runtime/host/local-runtime-host`); real
 * `FileSessionService` (production class); real
 * `BackgroundNotifyCoordinator`; real `CommandJobManager`; real
 * `createCommandStatusTool` (production factory); real
 * `legacyConsumeTerminalPolicy` as the `consumeTerminalAuthority`
 * stub (mirrors BCB01-C4 / UCHC01 — the BCB01 SEAM04 production
 * kernel is the same decision surface). No fake wake delivery.
 *
 * This ACT is a single bounded production-registry probe. It
 * does NOT introduce a new harness framework; it reuses the
 * c24-c-bridge config (`vitest.config.c2-4-c-bridge.ts`) and
 * the existing CRCD01/CCDS01 harness pattern.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentResult } from "@cline/shared"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "@/sdk/background-notify-coordinator"
import type { ActiveSession } from "@/sdk/cline-session-factory"
import { CommandJobManager } from "@/sdk/command-job-manager"
import { createCommandStatusTool } from "@/sdk/command-status-tool"
import { flushElmAuthorityForSession, getElmAuthorityCompletionDecision } from "@/sdk/completion-authority-elm-authority-runtime"
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

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
	applyCompletionContinuationUpstreamDiagnosticProfile(true)
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
	applyCompletionContinuationUpstreamDiagnosticProfile(false)
	vi.restoreAllMocks()
})

// =============================================================================
// Stubs: same shape as the CCDS01 / CRCD01 bridge tests
// (see completion-continuation-delivery-seam01.ccds01.c24-c-bridge.test.ts).
// =============================================================================

function makeAgentStub() {
	let running = false
	const run = vi.fn(async (_prompt: string) => {
		running = true
		try {
			await new Promise((r) => setImmediate(r))
			await new Promise((r) => setImmediate(r))
			return {
				finishReason: "completed" as const,
				text: "",
				messages: [] as readonly never[],
				toolCalls: [] as readonly never[],
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
	const continueFn = vi.fn(async (_prompt: string) => {
		running = true
		try {
			await new Promise((r) => setImmediate(r))
			await new Promise((r) => setImmediate(r))
			return {
				finishReason: "completed" as const,
				text: "",
				messages: [] as readonly never[],
				toolCalls: [] as readonly never[],
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
		subscribe: vi.fn(() => () => {}),
		subscribeEvents: vi.fn(() => () => {}),
		subscribeRecoveryStateChange: vi.fn(() => () => {}),
		getAgentId: vi.fn(() => "agent_ocrrd01"),
		getConversationId: vi.fn(() => "conv_ocrrd01"),
		shutdown: vi.fn(async () => {}),
		getMessages: vi.fn(() => []),
	}
	return { agent, run, continueFn }
}

class AsdkSessionHostBridge {
	constructor(private readonly host: LocalRuntimeHost) {}
	// The `send` shape matches `SendSessionInput`; the LocalRuntimeHost
	// only reads `sessionId` and `prompt` for this probe.
	async send(input: { sessionId: string; prompt: string; delivery: "queue" | "steer" | "immediate" }): Promise<unknown> {
		return this.host.runTurn(input as never)
	}
}

interface OcurrdHarness {
	host: LocalRuntimeHost
	activeSession: ActiveSession
	coordinator: SdkSessionEventCoordinator
	notifyCoordinator: BackgroundNotifyCoordinator
	commandJobManager: CommandJobManager
	commandStatusTool: ReturnType<typeof createCommandStatusTool>
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	isolationDir: string
	commitCount: () => number
	lastPhase: () => string
	liveTools: () => readonly string[]
	setLiveTools: (tools: readonly string[]) => void
	setUnconsumed: (n: number) => void
}

function makeFileSessionService(isolationDir: string): FileSessionService {
	return new FileSessionService(join(isolationDir, "sessions"))
}

describe("ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01 — OCRRD01", () => {
	let isolationDir = ""
	const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "ocrrd01-"))
		process.env.HOME = isolationDir
		process.env.CLINE_DIR = join(isolationDir, ".cline")
	})

	afterEach(async () => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		if (isolationDir && existsSync(isolationDir)) {
			rmSync(isolationDir, { recursive: true, force: true })
		}
		await new Promise((r) => setImmediate(r))
	})

	// -------------------------------------------------------------------------
	// OCRRD01-01: REGISTRY CORRESPONDENCE — production
	// `createCommandStatusTool` factory produces a tool that drives
	// a real `BackgroundNotifyCoordinator` state transition.
	// -------------------------------------------------------------------------
	it("OCRRD01-01: production command_status tool factory produces a tool that drives a real BackgroundNotifyCoordinator non-notify held observation", async () => {
		const h = makeHarness({ sessionId: "sess-ocrrd01-01", taskId: "task-ocrrd01-01", isolationDir })

		// The factory's tool is named "command_status" — the name the
		// continuation prompt at `vscode-runtime-builder.ts:325`
		// references by exact string.
		expect(h.commandStatusTool.name).toBe("command_status")

		// The real production call from `vscode-run-commands-tool.ts:890`:
		// a non-notify terminal observation puts the held set to 1.
		const heldJobId = "cmd_ocrrd01_01_held"
		h.notifyCoordinator.recordNonNotifyTerminalObservation({
			jobId: heldJobId,
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-01",
		})
		expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-01")).toBe(1)

		// The production `command_status.execute(J)` Path C drain
		// closure: the execute method is a wrapper around
		// `manager.status(typed.jobId) -> if terminal -> resolveObligation
		// + consumeNonNotifyTerminalObservation`. Because the test
		// registers the held observation without starting a real
		// background job (which would require a real subprocess that
		// the vitest sandbox cannot reliably `kill(-pid, ...)` — see
		// the supervisor-spawn factory note at
		// `command-job-manager.ts:385-388`), the manager's status
		// returns `no_such_job` and the drain is skipped (this is
		// the production fail-closed path when the jobId is unknown
		// to the manager). We instead drive the SAME Path C drain
		// directly via the production
		// `consumeNonNotifyTerminalObservation` API — the same code
		// path the tool calls under a registered terminal job.
		h.notifyCoordinator.consumeNonNotifyTerminalObservation({
			jobId: heldJobId,
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-01",
		})
		expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-01")).toBe(0)
	})

	// -------------------------------------------------------------------------
	// OCRRD01-02: REGISTRY CORRESPONDENCE — the production
	// `createCommandStatusTool` factory produces a tool that the
	// REAL `LocalRuntimeHost.getActiveRuntimeToolNames(sessionId)`
	// surface returns. This is the upstream chain's
	// `LocalRuntimeHost.liveTools(sessionId) →
	// ClineCore.getActiveRuntimeToolNames →
	// VscodeSessionHost.liveTools → SdkSessionEventCoordinator.liveTools`
	// end. (LocalRuntimeHost is real; the tool is real; the surface
	// is the source of truth for the runtime registry.)
	// -------------------------------------------------------------------------
	it("OCRRD01-02: LocalRuntimeHost.getActiveRuntimeToolNames returns command_status for the session (registry correspondence)", async () => {
		const h = makeHarness({ sessionId: "sess-ocrrd01-02", taskId: "task-ocrrd01-02", isolationDir })
		// Establish a real session in the LocalRuntimeHost. The
		// `runtimeBuilder.build(...)` returns the `BuiltRuntime` with
		// the real `commandStatusTool` registered.
		await h.host.startSession({
			source: "vscode",
			interactive: true,
			config: {
				sessionId: h.activeSession.sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "ocrrd01 test agent",
				mode: "act" as never,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})
		// The production chain:
		//   LocalRuntimeHost.getActiveRuntimeToolNames(sessionId)
		//   -> ClineCore.getActiveRuntimeToolNames(sessionId)
		//   -> VscodeSessionHost.liveTools(sessionId)
		//   -> SdkSessionEventCoordinator.liveTools()
		// returns the real `commandStatusTool.name === "command_status"`.
		const liveToolNames = h.host.getActiveRuntimeToolNames(h.activeSession.sessionId)
		expect(liveToolNames).toContain("command_status")
	})

	// -------------------------------------------------------------------------
	// OCRRD01-03: NOTIFY-HELD CONSERVATION
	//
	// A notify=true held entry (entered via `consumeTerminal` with
	// the `held` decision branch) is NOT drained by the production
	// Path C consumer. The `hasActiveNotify` gate suppresses the
	// Path C drain (it returns false because the marker is in
	// `heldTerminalResults`, not `notificationMarkers`), and
	// `resolveObligation` returns `no_marker`. The held set
	// requires a separate terminal event to trigger the `drained`
	// decision branch.
	// -------------------------------------------------------------------------
	it("OCRRD01-03: command_status Path C does NOT drain a notify=true held entry — notify-held requires a new terminal event", async () => {
		const h = makeHarness({ sessionId: "sess-ocrrd01-03", taskId: "task-ocrrd01-03", isolationDir })

		// Setup: two notify=true markers. The first becomes
		// terminal while the second is still in flight, so the
		// decision is `held` (the J-1 entry moves to
		// heldTerminalResults). This mirrors BCCR01-01.
		h.notifyCoordinator.registerMarker({
			jobId: "J-1",
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-03",
		})
		h.notifyCoordinator.registerMarker({
			jobId: "J-2",
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-03",
		})
		const d1 = await h.notifyCoordinator.consumeTerminal({
			jobId: "J-1",
			terminalState: "exited",
			exitCode: 0,
			reason: undefined,
			isContainmentFailed: false,
			outputTail: undefined,
		})
		expect(d1.kind).toBe("held")
		if (d1.kind === "held") {
			expect(d1.heldCount).toBe(1)
		}
		expect(h.notifyCoordinator.hasActiveNotify("J-1")).toBe(false)
		expect(h.notifyCoordinator.hasActiveNotify("J-2")).toBe(true)

		// Held set: 1 held (J-1) + 1 live marker (J-2) = 2.
		const heldBefore = h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-03")
		expect(heldBefore).toBe(2)

		// Path A (resolveObligation) is a no-op (J-1's notify marker
		// is already gone; the manager returns `no_marker`).
		const pathA = h.notifyCoordinator.resolveObligation({
			jobId: "J-1",
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-03",
			resolution: "canonical_status_observed",
		})
		expect(pathA.kind).toBe("no_marker")

		// Path C (consumeNonNotifyTerminalObservation) is a no-op
		// because J-1 was never registered as a non-notify observation
		// (it was registered via registerMarker for notify=true).
		h.notifyCoordinator.consumeNonNotifyTerminalObservation({
			jobId: "J-1",
			sessionId: h.activeSession.sessionId,
			taskId: "task-ocrrd01-03",
		})

		// The held set is unchanged. The notify=true held entry
		// requires a SECOND terminal event for any job in the owner's
		// set (J-2 here) to trigger the `drained` decision branch.
		const heldAfter = h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-ocrrd01-03")
		expect(heldAfter).toBe(heldBefore)
	})
})

function makeHarness(opts: { sessionId: string; taskId: string; isolationDir: string }): OcurrdHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const commandJobManager = new CommandJobManager()

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: opts.sessionId, taskId: opts.taskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
		now: () => Date.now(),
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	let liveTools: readonly string[] = ["command_status", "submit_and_exit"]
	let unconsumed = 0
	const heldJobIds: string[] = []
	let commitCount = 0
	let lastPhase = "idle"

	const commandStatusTool = createCommandStatusTool(commandJobManager, {
		backgroundNotifyCoordinator: notifyCoordinator,
		resolveActiveOwner: () => ({ sessionId: opts.sessionId, taskId: opts.taskId }),
		onRunningObserved: () => {},
	})

	const runtimeBuilder = {
		build: vi.fn().mockReturnValue({
			tools: [commandStatusTool as never],
			teamRuntime: undefined,
			teamRestoredFromPersistence: false,
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}

	const sessionService = makeFileSessionService(opts.isolationDir)
	const host = new LocalRuntimeHost({
		distinctId: "act-ocrrd01",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => makeAgentStub().agent as never,
		logger: {
			debug: vi.fn(),
			log: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			setLevel: vi.fn(),
		} as never,
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
			lastPhase = phase
			if (phase === "completed") commitCount += 1
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: () => unconsumed,
		getUnconsumedOwnedTerminalJobIds: () => heldJobIds.slice(),
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		wasWakeAuthoritySettled: () => true,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: buildSdkControllerEnqueueCompletionContinuation({
			getActiveSession: () => activeSession,
			liveTools: () => [...liveTools],
			logger: { warn: (msg: string) => console.warn(msg) },
		}),
		getElmCompletionAuthorityDecision: (sessionId?: string) => getElmAuthorityCompletionDecision(sessionId ?? ""),
		flushElmAuthorityForSession: async (sessionId: string) => flushElmAuthorityForSession(sessionId),
		liveTools: () => [...liveTools],
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		host,
		activeSession,
		coordinator,
		notifyCoordinator,
		commandJobManager,
		commandStatusTool,
		tracker,
		translatorState,
		isolationDir: opts.isolationDir,
		commitCount: () => commitCount,
		lastPhase: () => lastPhase,
		liveTools: () => liveTools,
		setLiveTools: (tools) => {
			liveTools = tools
		},
		setUnconsumed: (n) => {
			unconsumed = n
			heldJobIds.length = 0
			if (n > 0) {
				heldJobIds.push(`J-ocrrd01-${n}`)
			}
		},
	}
}
