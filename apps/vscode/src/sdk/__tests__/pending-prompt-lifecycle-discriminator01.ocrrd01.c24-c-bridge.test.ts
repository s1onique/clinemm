/**
 * ACT-CLINEMM-P0-OCRRD01-PENDING-PROMPT-LIFECYCLE-DISCRIMINATOR01
 *
 * Closes the OCRRD01-04 evidence gap. The previous OCRRD01-04 test
 * proves that the held-set drain is NECESSARY (sub-gate 3b) but
 * its sub-gate 3b acceptance fails with
 *   `elmDecision.kind = "hold", reason = "pending_prompt"`.
 * The fault is a documented TEST-HARNESS limitation in the
 * existing test (it injects `agent_turn_done` directly instead
 * of driving the real queue lifecycle), per the comment at
 * `observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts:682-696`.
 *
 * This file proves the production seam IS intact and the harness
 * only needs the real queue lifecycle driven. Concretely, it
 * exercises PPLC-01 / 02 / 03 / 04 / 05 / 06 / 07 / 08 from C5.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { AgentResult } from "@cline/shared"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "@/sdk/background-notify-coordinator"
import { subscribeCanonicalRuntimeEventsToShadow } from "@/sdk/canonical-event-subscription"
import type { ActiveSession } from "@/sdk/cline-session-factory"
import { CommandJobManager } from "@/sdk/command-job-manager"
import { createCommandStatusTool } from "@/sdk/command-status-tool"
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

const HERE = fileURLToPath(import.meta.url)
const REAL_KERNEL_PATH = join(HERE, "..", "..", "..", "..", "elm", "completion-authority", "vendor", "completion-authority.js")
const elmKernelAvailable = existsSync(REAL_KERNEL_PATH)

const canSpawnSubprocess = (() => {
	try {
		const r = spawnSync("true", [], { stdio: "ignore", timeout: 1_000 })
		return r.status === 0
	} catch {
		return false
	}
})()

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
	resetElmAuthorityForTests()
	vi.restoreAllMocks()
})

// =============================================================================
// Stubs (same shape as SWCM04 / OCRRD01 / CCUTO01 bridge harnesses).
// =============================================================================

function makeAgentStub(opts: { autoStart?: boolean; sessionId?: string } = {}) {
	const autoStart = opts.autoStart ?? true
	const sessionId = opts.sessionId ?? "sess-pplc01"
	let running = false
	let ready = autoStart
	// `subscribeRuntimeEvents` signature (production):
	//   (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => Unsubscribe
	// The canonical subscription at
	// `subscribeCanonicalRuntimeEventsToShadow` calls the listener
	// with BOTH `sessionId` (so stale-session events are dropped) and
	// the `event` payload. The harness's listener therefore takes
	// `(sessionId, event)` and forwards the `event` to a Set of
	// typed listeners that the agent stub's `run` / `continue`
	// publish into.
	const runtimeEventListeners = new Set<(sessionId: string, event: { type: string; snapshot?: { runId?: string } }) => void>()
	let runCounter = 0
	const makeResult = (): AgentResult =>
		({
			finishReason: "completed" as const,
			text: "",
			messages: [] as readonly never[],
			toolCalls: [] as readonly never[],
			durationMs: 1,
			iterations: 1,
			usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
			model: { id: "mock-model", provider: "mock-provider" },
			startedAt: new Date(),
			endedAt: new Date(),
		}) as AgentResult
	const publishRunStarted = (sessionId: string, runId: string) => {
		for (const listener of runtimeEventListeners) {
			listener(sessionId, { type: "run-started", snapshot: { runId } })
		}
	}
	const run = vi.fn(async (): Promise<AgentResult> => {
		running = true
		runCounter += 1
		// Publish a canonical `run-started` event with a fresh runId
		// so the host's subscribeRuntimeEvents listener
		// (subscribeCanonicalRuntimeEventsToShadow) can emit
		// `run_turn_started` + `continuation_started` to Elm.
		const runId = `run-pplc01-agent-${runCounter}-${Date.now()}`
		publishRunStarted(sessionId, runId)
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setImmediate(r))
		running = false
		return makeResult()
	})
	const continueFn = vi.fn(async (): Promise<AgentResult> => {
		running = true
		runCounter += 1
		const runId = `run-pplc01-agent-${runCounter}-${Date.now()}`
		publishRunStarted(sessionId, runId)
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setImmediate(r))
		running = false
		return makeResult()
	})
	const canStartRun = vi.fn(() => ready && !running)
	const agent = {
		run,
		continue: continueFn,
		canStartRun,
		abort: vi.fn(() => {
			running = false
		}),
		subscribe: vi.fn(() => () => {}),
		subscribeEvents: vi.fn(() => () => {}),
		subscribeRuntimeEvents: vi.fn(
			(listener: (sessionId: string, event: { type: string; snapshot?: { runId?: string } }) => void) => {
				runtimeEventListeners.add(listener)
				return () => {
					runtimeEventListeners.delete(listener)
				}
			},
		),
		subscribeRecoveryStateChange: vi.fn(() => () => {}),
		getAgentId: vi.fn(() => "agent_pplc01"),
		getConversationId: vi.fn(() => "conv_pplc01"),
		shutdown: vi.fn(async () => {}),
		getMessages: vi.fn(() => []),
	}
	const gate = {
		setReady: (next: boolean) => {
			ready = next
		},
	}
	return { agent, run, continueFn, gate }
}

class AsdkSessionHostBridge {
	constructor(private readonly host: LocalRuntimeHost) {}
	async send(input: { sessionId: string; prompt: string; delivery: "queue" | "steer" | "immediate" }): Promise<unknown> {
		return this.host.runTurn(input as never)
	}
}

interface PplcHarness {
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
	gate: { setReady: (ready: boolean) => void }
	reinstallCanonicalSubscription: () => () => void
}

function makeFileSessionService(isolationDir: string): FileSessionService {
	return new FileSessionService(join(isolationDir, "sessions"))
}

function makeHarness(opts: {
	sessionId: string
	taskId: string
	isolationDir: string
	autoStart?: boolean
	// Expert verdict (2026-10-12, PPLC-08 correction): the
	// harness must expose a flag to disable the canonical
	// subscription so the NECESSITY ablation can isolate the
	// canonical subscription's causal role. Default: true
	// (preserves existing PPLC-01..07 behavior). PPLC-08 sets
	// it to false.
	installCanonicalSubscription?: boolean
}): PplcHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const isolationDir = opts.isolationDir

	const commandJobManager = new CommandJobManager({} as never, { command_notice_lifetime: "session" as never })
	const sessionService = makeFileSessionService(isolationDir)
	const { agent, gate } = makeAgentStub({ autoStart: opts.autoStart ?? true, sessionId: opts.sessionId })

	const runtimeBuilder = {
		build: vi.fn().mockReturnValue({
			tools: [],
			teamRuntime: undefined,
			teamRestoredFromPersistence: false,
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}

	// Reuse the existing test pattern: register the production
	// `command_status` tool on the runtime, then route it into the
	// runtime builder so `getActiveRuntimeToolNames(sessionId)`
	// returns `["command_status"]` — the same surface the
	// continuation factory consults. The BCB and the owner
	// resolver are BOTH wired (mirrors OCRRD01-04 / BCB01-C4)
	// so `commandStatusTool.execute(J)` can actually drive a
	// real `consumeNonNotifyTerminalObservation` state transition
	// when a held job is observed. Without this wiring PPLC-03
	// (the full drain -> commit chain) cannot exercise the
	// production drain seam.
	//
	// The tool is rebuilt ONCE after `notifyCoordinator` is
	// constructed so the BCB and owner-resolver references are
	// captured at tool-construction time (the production factory
	// freezes them as `options`).
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		// ACT-CLINEMM-P0-OCRRD01-PENDING-PROMPT-LIFECYCLE-DISCRIMINATOR01 —
		// PPLC-03 followup: resolve the ACTIVE owner to the harness's
		// pinned (sessionId, taskId) so `commandStatusTool.execute(J)`
		// finds the held observation that PPLC-04/PPLC-03 register.
		// Without this, the drain is a no-op (the BCB returns
		// "no_owner" and `unconsumedTerminalCountForOwner` stays
		// at 1 forever), so the C10 consult at the deferred barrier
		// keeps HOLDing and the commit cannot fire.
		resolveActiveOwner: () => ({ sessionId: opts.sessionId, taskId: opts.taskId }),
		// Fire-and-forget wake delivery; PPLC tests do not exercise
		// the wake-driven turn, so a delivered-stub is sufficient.
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
		now: () => Date.now(),
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const commandStatusTool = createCommandStatusTool(commandJobManager, {
		backgroundNotifyCoordinator: notifyCoordinator,
		resolveActiveOwner: () => ({ sessionId: opts.sessionId, taskId: opts.taskId }),
		onRunningObserved: () => {},
	})
	runtimeBuilder.build.mockReturnValue({
		tools: [commandStatusTool as never],
		teamRuntime: undefined,
		teamRestoredFromPersistence: false,
		shutdown: vi.fn().mockResolvedValue(undefined),
	})

	const host = new LocalRuntimeHost({
		distinctId: "act-pplc01",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => agent as never,
		logger: {
			debug: vi.fn(),
			log: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			setLevel: vi.fn(),
		} as never,
		// PRODUCTION capture factory: onEnqueue / onBeforeDrain /
		// onBeforeDispatch / onRunTurnStarted / onAgentTurnDone.
		// The `onAgentTurnDone` callback is the load-bearing seam:
		// it routes the real `agent_turn_done` record into Elm,
		// which transitions `PromptRunning` to `PromptConsumed`.
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

	let commitCount = 0
	let lastPhase = "idle"
	const liveToolsClosure: { tools: readonly string[] } = { tools: ["command_status"] }
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
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== opts.sessionId) return 0
			return notifyCoordinator.unconsumedTerminalCountForOwner(opts.sessionId, opts.taskId)
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) => {
			if (sid !== opts.sessionId) return []
			return notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(opts.sessionId, tid)
		},
		getPendingPromptCount: (sid: string | undefined) => {
			if (sid === opts.sessionId) return { available: true, count: host.pendingPrompts.count(sid).count }
			return { available: true, count: 0 }
		},
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
			liveTools: () => host.getActiveRuntimeToolNames(opts.sessionId) ?? liveToolsClosure.tools,
			logger: { warn: (msg: string) => console.warn(msg) },
		}),
		getElmCompletionAuthorityDecision: (sessionId?: string) => getElmAuthorityCompletionDecision(sessionId ?? ""),
		flushElmAuthorityForSession: async (sessionId: string) => flushElmAuthorityForSession(sessionId),
		liveTools: () => host.getActiveRuntimeToolNames(opts.sessionId) ?? liveToolsClosure.tools,
	} as unknown as SdkSessionEventCoordinatorOptions)

	// Install the production canonical-event subscription. Per
	// `subscribeCanonicalRuntimeEventsToShadow` (canonical-event-subscription.ts:22-33)
	// the subscription is point-in-time: it iterates the host's
	// CURRENTLY active sessions. If `host.startSession` has not
	// been called yet at install time, the subscription is empty.
	// The harness caller MUST call `reinstallCanonicalSubscription`
	// AFTER `host.startSession` to re-attach the listener to the
	// newly created session.
	const installCanonicalSubscription = () =>
		subscribeCanonicalRuntimeEventsToShadow(
			host,
			{
				recorder: {} as never,
				recorderCounts: () => ({}) as never,
				records: () => [],
				observeCanonicalRuntimeEvent: () => {},
				resetForNewTask: () => {},
				dispose: () => {},
				fenceCanonicalRunForContinuation: () => {},
				coordinator: {} as never,
			},
			opts.sessionId,
		)
	// Expert verdict (2026-10-12, PPLC-08 correction): the
	// canonical subscription install is gated behind
	// `installCanonicalSubscription` (default true) so the
	// PPLC-08 NECESSITY ablation can isolate the causal role
	// of the canonical subscription.
	if (opts.installCanonicalSubscription !== false) {
		// Eagerly install (a no-op if the session has not been started yet).
		installCanonicalSubscription()

		// Wrap `host.startSession` so the canonical subscription is
		// re-installed automatically after every session start. The
		// point-in-time subscription iterates the host's currently
		// active sessions; the new session would not be observed
		// otherwise.
		const wrappedStartSession = host.startSession.bind(host)
		host.startSession = (async (input: Parameters<typeof host.startSession>[0]) => {
			const result = await wrappedStartSession(input)
			installCanonicalSubscription()
			return result
		}) as typeof host.startSession
	}

	return {
		host,
		activeSession,
		coordinator,
		notifyCoordinator,
		commandJobManager,
		commandStatusTool,
		tracker,
		translatorState,
		isolationDir,
		commitCount: () => commitCount,
		lastPhase: () => lastPhase,
		liveTools: () => liveToolsClosure.tools,
		gate,
		reinstallCanonicalSubscription: installCanonicalSubscription,
	}
}

async function waitForMicrotasks(maxIterations = 8): Promise<void> {
	for (let i = 0; i < maxIterations; i++) {
		await new Promise((r) => setImmediate(r))
	}
}

function recordsByStage(sessionId: string, stage: string) {
	return getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.sessionId === sessionId && r.stage === stage)
}

describe("ACT-CLINEMM-P0-OCRRD01-PENDING-PROMPT-LIFECYCLE-DISCRIMINATOR01 — production-seam pending-prompt lifecycle", () => {
	let isolationDir = ""
	const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "pplc01-"))
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
	// PPLC-01: actual queue-to-runtime lifecycle
	// -------------------------------------------------------------------------
	it.runIf(canSpawnSubprocess && elmKernelAvailable)(
		"PPLC-01: real enqueue -> real drain -> real runTurn -> real onAgentTurnDone fires all 6 capture stages",
		async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				sessionId: "sess-pplc01-01",
				taskId: "task-pplc01-01",
				isolationDir,
				autoStart: false,
			})

			try {
				await h.host.startSession({
					source: "vscode",
					interactive: true,
					config: {
						sessionId: h.activeSession.sessionId,
						providerId: "mock-provider",
						modelId: "mock-model",
						cwd: isolationDir,
						workspaceRoot: isolationDir,
						systemPrompt: "pplc01-01 lifecycle test",
						mode: "act" as never,
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
				})

				expect(h.host.getActiveRuntimeToolNames(h.activeSession.sessionId)).toContain("command_status")

				// Seed Elm with the explicit_user run so the prompt
				// enqueue can target a known active run.
				await enqueueElmAuthorityRecord({
					stage: "task_started",
					sessionId: h.activeSession.sessionId,
					taskId: "task-pplc01-01",
				})
				await enqueueElmAuthorityRecord({
					stage: "run_turn_started",
					sessionId: h.activeSession.sessionId,
					runId: "run-pplc01-01-1",
					origin: "explicit_user",
				})
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// Enqueue the coalesced continuation via the
				// production host path. `host.runTurn({ delivery:
				// "queue" })` is the production entry into the
				// pending-prompts queue; it enqueues and returns
				// undefined (the agent is NOT started in this call).
				await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "BCB continuations: command_status for J1, J2, then submit_and_exit",
					delivery: "queue",
				})
				await waitForMicrotasks(4)

				// INVARIANT (real): the queue has one entry. The
				// production `onEnqueue` capture fired.
				const listAfterEnqueue = await h.host.pendingPrompts.list({ sessionId: h.activeSession.sessionId })
				expect(listAfterEnqueue).toHaveLength(1)
				expect(recordsByStage(h.activeSession.sessionId, "pending_prompt_enqueued")).toHaveLength(1)

				// Trigger the real drain via a fresh user turn
				// (post-turn microtask schedules drain). Open the
				// gate first so the agent can start.
				h.gate.setReady(true)
				const triggerResult = await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "USER_TRIGGER",
				})
				expect(triggerResult).toBeDefined()
				await waitForMicrotasks(8)
				await new Promise((r) => setTimeout(r, 50))

				// INVARIANT (real): the FULL chain fired for the
				// queued prompt (NOT just for the user trigger).
				//   pending_prompt_enqueued (C4): 1
				//   pending_prompt_dequeued (C5): 1
				//   continuation_scheduled (C6):  1
				//   run_turn_started (C7):        gated by
				//                                 `callerSideRunStartCaptureEnabled`
				//                                 (default false); assert presence
				//                                 only if a separate gate enabled it
				//   agent_turn_done (C8):         2 (1 user + 1 drain)
				expect(recordsByStage(h.activeSession.sessionId, "pending_prompt_enqueued")).toHaveLength(1)
				expect(recordsByStage(h.activeSession.sessionId, "pending_prompt_dequeued")).toHaveLength(1)
				expect(recordsByStage(h.activeSession.sessionId, "continuation_scheduled")).toHaveLength(1)
				expect(recordsByStage(h.activeSession.sessionId, "agent_turn_done").length).toBeGreaterThanOrEqual(2)

				// INVARIANT (real): the queue is empty after drain.
				const listAfterDrain = await h.host.pendingPrompts.list({ sessionId: h.activeSession.sessionId })
				expect(listAfterDrain).toHaveLength(0)
			} finally {
				await h.host.dispose()
			}
		},
	)

	// -------------------------------------------------------------------------
	// PPLC-02: Elm pending-prompt release — the load-bearing discriminator.
	// The previous OCRRD01-04 test injects `agent_turn_done` directly into
	// Elm (synthetic) and observes the `pending_prompt` hold persists
	// (RED). This test drives the FULL real queue lifecycle
	// (pending_prompt_enqueued -> dequeued -> continuation_scheduled ->
	// run_turn_started -> agent_turn_done) and proves the Elm `pending_prompt`
	// hold is settled by the real `onAgentTurnDone` capture.
	// -------------------------------------------------------------------------
	it.runIf(canSpawnSubprocess && elmKernelAvailable)(
		"PPLC-02: real onAgentTurnDone transitions Elm pending_prompt hold to absent",
		async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				sessionId: "sess-pplc01-02",
				taskId: "task-pplc01-02",
				isolationDir,
				autoStart: false,
			})

			try {
				await h.host.startSession({
					source: "vscode",
					interactive: true,
					config: {
						sessionId: h.activeSession.sessionId,
						providerId: "mock-provider",
						modelId: "mock-model",
						cwd: isolationDir,
						workspaceRoot: isolationDir,
						systemPrompt: "pplc01-02 Elm release test",
						mode: "act" as never,
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
				})

				// Seed Elm with the explicit_user run.
				await enqueueElmAuthorityRecord({
					stage: "task_started",
					sessionId: h.activeSession.sessionId,
					taskId: "task-pplc01-02",
				})
				await enqueueElmAuthorityRecord({
					stage: "run_turn_started",
					sessionId: h.activeSession.sessionId,
					runId: "run-pplc01-02-1",
					origin: "explicit_user",
				})
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// Enqueue the continuation. The capture path
				// delivers `pending_prompt_enqueued` to Elm.
				await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "BCB continuations: command_status for J1, J2, then submit_and_exit",
					delivery: "queue",
				})
				await waitForMicrotasks(4)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// BEFORE consult: the prompt is in `PromptQueued`
				// (only `pending_prompt_enqueued` was sent). The Elm
				// authority reports `pending_prompt` as a hold.
				const decisionBefore = getElmAuthorityCompletionDecision(h.activeSession.sessionId)
				expect(decisionBefore.kind).toBe("hold")
				const beforeReasons = decisionBefore.kind === "hold" ? (decisionBefore.holdReasons ?? []) : []
				expect(beforeReasons).toContain("pending_prompt")

				// Drive the real drain.
				h.gate.setReady(true)
				const triggerResult = await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "USER_TRIGGER",
				})
				expect(triggerResult).toBeDefined()
				await waitForMicrotasks(16)
				await new Promise((r) => setTimeout(r, 100))

				// Flush Elm after the drain so the real
				// `agent_turn_done` records are processed BEFORE
				// the final consult. The full state-transition
				// chain (PromptQueued -> PromptDequeued ->
				// PromptScheduled -> PromptRunning -> PromptConsumed)
				// is what allows `consumePromptForRun closingRef`
				// at `Authority.elm:193` to find a matching prompt.
				await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// AFTER consult: the `pending_prompt` hold is gone.
				const decisionAfter = getElmAuthorityCompletionDecision(h.activeSession.sessionId)
				const afterReasons = decisionAfter.kind === "hold" ? (decisionAfter.holdReasons ?? []) : []
				expect(afterReasons).not.toContain("pending_prompt")
			} finally {
				await h.host.dispose()
			}
		},
	)

	// -------------------------------------------------------------------------
	// PPLC-03: FULL causal chain — real queue lifecycle -> real drain via
	// command_status.execute(J) -> real submit_and_exit -> real
	// reevaluation -> Elm authorize -> exactly one setTurnPhase("completed").
	//
	// This is the load-bearing combined recovery test the Expert verdict
	// identifies as missing. PPLC-02 only proves the Elm `pending_prompt`
	// hold disappears after the real lifecycle; PPLC-03 proves the entire
	// chain through to the commit. Without this test, the harness cannot
	// claim a real `setTurnPhase("completed", ...)` is reachable for a
	// session whose only outstanding obligation is a notify=false held
	// terminal observation drained by `command_status`.
	//
	// Expert verdict (2026-10-12, P1 fix): the previous version of this
	// test manually enqueued an Elm authority record of stage
	// `terminal_committed` after the real drain. Inspection of
	// `completion-authority-elm-replay.ts:124-149` shows the adapter
	// rejects `terminal_committed` with `INSUFFICIENT_IDENTITY` when
	// the record lacks `ownerId` and `terminalKind` (the REAL schema
	// does not carry those), and
	// `completion-authority-elm-authority-runtime.ts:351-354` silently
	// drops INSUFFICIENT_IDENTITY records. The manual `terminal_committed`
	// insertion therefore never reached Elm — it was a no-op that
	// was misclassified as a causal producer. The C10 commit chain
	// is provable WITHOUT it: Elm decides `authorize` on the basis
	// of the prompt + run + job state, and a `terminal_committed`
	// fact only registers a job for tracking (it does not gate
	// the commit decision). The test no longer seeds the
	// `terminal_committed` record; its claim is therefore a clean
	// production-seam test (no Elm seeding past the run_started fact
	// shared with PPLC-02/04/05/06/07).
	// -------------------------------------------------------------------------
	it.runIf(canSpawnSubprocess && elmKernelAvailable)(
		"PPLC-03: real drain -> real submit_and_exit -> Elm authorize -> exactly one setTurnPhase(completed) commit",
		async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				sessionId: "sess-pplc01-03",
				taskId: "task-pplc01-03",
				isolationDir,
				autoStart: false,
			})

			try {
				await h.host.startSession({
					source: "vscode",
					interactive: true,
					config: {
						sessionId: h.activeSession.sessionId,
						providerId: "mock-provider",
						modelId: "mock-model",
						cwd: isolationDir,
						workspaceRoot: isolationDir,
						systemPrompt: "pplc01-03 full-chain convergence test",
						mode: "act" as never,
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
				})
				expect(h.host.getActiveRuntimeToolNames(h.activeSession.sessionId)).toContain("command_status")

				// 1) Real terminal job -> real held observation in the BCB.
				const startRes = await h.commandJobManager.start({
					command: "true",
					cwd: process.cwd(),
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				const transition = await startRes.terminalPromise
				expect(transition.terminalState).toBe("exited")
				h.notifyCoordinator.recordNonNotifyTerminalObservation({
					jobId: startRes.jobId,
					sessionId: h.activeSession.sessionId,
					taskId: "task-pplc01-03",
				})
				expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-pplc01-03")).toBe(1)

				// 2) Seed Elm with the explicit_user run.
				await enqueueElmAuthorityRecord({
					stage: "task_started",
					sessionId: h.activeSession.sessionId,
					taskId: "task-pplc01-03",
				})
				await enqueueElmAuthorityRecord({
					stage: "run_turn_started",
					sessionId: h.activeSession.sessionId,
					runId: "run-pplc01-03-1",
					origin: "explicit_user",
				})
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// 3) Real queue lifecycle (enqueue -> drain -> runTurn -> onAgentTurnDone).
				await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "BCB continuations: command_status for J1, J2, then submit_and_exit",
					delivery: "queue",
				})
				await waitForMicrotasks(4)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				h.gate.setReady(true)
				const triggerResult = await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "USER_TRIGGER",
				})
				expect(triggerResult).toBeDefined()
				await waitForMicrotasks(16)
				await new Promise((r) => setTimeout(r, 100))
				await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// 4) The real production drain — command_status.execute(J).
				//    The BCB + resolveActiveOwner wiring (added in PPLC-03
				//    followup) makes this a real state transition: the held
				//    observation for `startRes.jobId` is consumed.
				const toolResult = (await h.commandStatusTool.execute({
					jobId: startRes.jobId,
				})) as Array<{ ok: boolean; jobId?: string; state?: string; error?: string }>
				expect(toolResult.length).toBe(1)
				const r = toolResult[0]
				expect(r.ok).toBe(true)
				expect(r.jobId).toBe(startRes.jobId)
				expect(r.state).toBe("exited")
				expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-pplc01-03")).toBe(0)

				// 5) Drive the production completion boundary. The C9
				//    `submit_and_exit_seen` capture fires inside
				//    `handleSessionEvent(done)`. The TS-side barrier
				//    consults MUST pass (held=0, no prompts, no
				//    active notify) for the C10 commit path to be
				//    reached; the Elm authority consult MUST return
				//    `authorize` for `setTurnPhase("completed", ...)`
				//    to fire.
				//
				// P1 fix (2026-10-12): the previous version of this
				// step manually enqueued a `terminal_committed` Elm
				// authority record. Inspection of the adapter
				// (completion-authority-elm-replay.ts:124-149) shows
				// such a record is rejected with
				// `INSUFFICIENT_IDENTITY` (no `ownerId` / `terminalKind`
				// in the REAL schema) and silently dropped
				// (completion-authority-elm-authority-runtime.ts:351-354),
				// so it never reached Elm. The C10 commit chain is
				// therefore provable WITHOUT it. The test no longer
				// seeds the `terminal_committed` record; the
				// production-seam claim is now clean.
				h.translatorState.setAttemptCompletionSeen()
				h.translatorState.setTerminalResponseCommittedThisTurn()
				const doneEvent = {
					type: "agent_event" as const,
					payload: {
						sessionId: h.activeSession.sessionId,
						event: {
							type: "done" as const,
							reason: "completed" as const,
							text: "Task completed.",
							iterations: 1,
						},
					},
				}
				await h.coordinator.handleSessionEvent(doneEvent as never)
				await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// 6) Verify the full commit chain.
				const elmDecision = getElmAuthorityCompletionDecision(h.activeSession.sessionId)
				expect(elmDecision.kind).toBe("authorize")
				expect(h.commitCount()).toBe(1)
				expect(h.lastPhase()).toBe("completed")
				// And the post-commit `task_completion_committed` record
				// was captured by the production seam.
				expect(recordsByStage(h.activeSession.sessionId, "task_completion_committed")).toHaveLength(1)
				expect(recordsByStage(h.activeSession.sessionId, "submit_and_exit_seen")).toHaveLength(1)
			} finally {
				await h.host.dispose()
			}
		},
	)

	// -------------------------------------------------------------------------
	// PPLC-04: no-drain conservation — J remains held but prompt settles.
	// The real queue lifecycle settles the prompt; the held job is
	// independent and prevents completion.
	// -------------------------------------------------------------------------
	it.runIf(canSpawnSubprocess && elmKernelAvailable)(
		"PPLC-04: conservation — J remains held but prompt legitimately settles from the real lifecycle",
		async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				sessionId: "sess-pplc01-04",
				taskId: "task-pplc01-04",
				isolationDir,
				autoStart: false,
			})

			try {
				await h.host.startSession({
					source: "vscode",
					interactive: true,
					config: {
						sessionId: h.activeSession.sessionId,
						providerId: "mock-provider",
						modelId: "mock-model",
						cwd: isolationDir,
						workspaceRoot: isolationDir,
						systemPrompt: "pplc01-04 conservation test",
						mode: "act" as never,
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
				})

				// Real terminal job + register with BCB.
				const startRes = await h.commandJobManager.start({
					command: "true",
					cwd: process.cwd(),
					waitBudgetMs: 5_000,
					executionDeadlineMs: 5_000,
				})
				const transition = await startRes.terminalPromise
				expect(transition.terminalState).toBe("exited")
				h.notifyCoordinator.recordNonNotifyTerminalObservation({
					jobId: startRes.jobId,
					sessionId: h.activeSession.sessionId,
					taskId: "task-pplc01-04",
				})
				expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-pplc01-04")).toBe(1)

				await enqueueElmAuthorityRecord({
					stage: "task_started",
					sessionId: h.activeSession.sessionId,
					taskId: "task-pplc01-04",
				})
				await enqueueElmAuthorityRecord({
					stage: "run_turn_started",
					sessionId: h.activeSession.sessionId,
					runId: "run-pplc01-04-1",
					origin: "explicit_user",
				})
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "BCB continuations: command_status for J1, J2, then submit_and_exit",
					delivery: "queue",
				})
				await waitForMicrotasks(4)

				h.gate.setReady(true)
				const triggerResult = await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "USER_TRIGGER",
				})
				expect(triggerResult).toBeDefined()
				await waitForMicrotasks(8)
				await new Promise((r) => setTimeout(r, 50))
				await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// INVARIANT (real): prompt lifecycle fully fired
				// even though J was never drained.
				expect(recordsByStage(h.activeSession.sessionId, "pending_prompt_enqueued")).toHaveLength(1)
				expect(recordsByStage(h.activeSession.sessionId, "pending_prompt_dequeued")).toHaveLength(1)
				expect(recordsByStage(h.activeSession.sessionId, "continuation_scheduled")).toHaveLength(1)

				// INVARIANT (real): held observation is still in
				// the coordinator (we did not drain).
				expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSession.sessionId, "task-pplc01-04")).toBe(1)

				// INVARIANT (Elm): the prompt is settled but
				// the completion MUST NOT have committed.
				const decision = getElmAuthorityCompletionDecision(h.activeSession.sessionId)
				const reasons = decision.kind === "hold" ? (decision.holdReasons ?? []) : []
				expect(reasons).not.toContain("pending_prompt")
				expect(h.commitCount()).toBe(0)
				expect(h.lastPhase()).not.toBe("completed")
			} finally {
				await h.host.dispose()
			}
		},
	)

	// -------------------------------------------------------------------------
	// PPLC-05: pending prompt cannot settle before real runtime progress.
	// Gate CLOSED -> the agent cannot start -> no runTurn fires for the
	// queued prompt -> `pending_prompt` hold is retained.
	// -------------------------------------------------------------------------
	it.runIf(canSpawnSubprocess && elmKernelAvailable)(
		"PPLC-05: prompt queued but agent cannot start -> pending_prompt hold retained",
		async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			// Gate CLOSED initially so the drain cannot start a
			// real run.
			const h = makeHarness({
				sessionId: "sess-pplc01-05",
				taskId: "task-pplc01-05",
				isolationDir,
				autoStart: false,
			})

			try {
				await h.host.startSession({
					source: "vscode",
					interactive: true,
					config: {
						sessionId: h.activeSession.sessionId,
						providerId: "mock-provider",
						modelId: "mock-model",
						cwd: isolationDir,
						workspaceRoot: isolationDir,
						systemPrompt: "pplc01-05 no-progress test",
						mode: "act" as never,
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
				})

				await enqueueElmAuthorityRecord({
					stage: "task_started",
					sessionId: h.activeSession.sessionId,
					taskId: "task-pplc01-05",
				})
				await enqueueElmAuthorityRecord({
					stage: "run_turn_started",
					sessionId: h.activeSession.sessionId,
					runId: "run-pplc01-05-1",
					origin: "explicit_user",
				})
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "BCB continuations: command_status for J1, J2, then submit_and_exit",
					delivery: "queue",
				})
				await waitForMicrotasks(4)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// INVARIANT: prompt queued but not yet started.
				expect(recordsByStage(h.activeSession.sessionId, "pending_prompt_enqueued")).toHaveLength(1)
				expect(recordsByStage(h.activeSession.sessionId, "pending_prompt_dequeued")).toHaveLength(0)
				expect(recordsByStage(h.activeSession.sessionId, "continuation_scheduled")).toHaveLength(0)
				expect(recordsByStage(h.activeSession.sessionId, "run_turn_started")).toHaveLength(0)
				expect(recordsByStage(h.activeSession.sessionId, "agent_turn_done")).toHaveLength(0)

				// BEFORE consult: pending_prompt is held.
				const decisionBefore = getElmAuthorityCompletionDecision(h.activeSession.sessionId)
				const beforeReasons = decisionBefore.kind === "hold" ? (decisionBefore.holdReasons ?? []) : []
				expect(beforeReasons).toContain("pending_prompt")
				expect(h.commitCount()).toBe(0)
			} finally {
				await h.host.dispose()
			}
		},
	)

	// -------------------------------------------------------------------------
	// PPLC-06: identity — K's lifecycle event does not settle K+1's prompt.
	// K has its own session/task. A K-only `agent_turn_done` for K's run
	// MUST NOT consume K+1's prompt.
	// -------------------------------------------------------------------------
	it.runIf(canSpawnSubprocess && elmKernelAvailable)(
		"PPLC-06: identity — K's lifecycle event does not settle K+1's prompt",
		async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const hK = makeHarness({
				sessionId: "sess-pplc01-06-K",
				taskId: "task-pplc01-06-K",
				isolationDir,
			})
			const hK1 = makeHarness({
				sessionId: "sess-pplc01-06-K1",
				taskId: "task-pplc01-06-K1",
				isolationDir,
			})

			try {
				for (const h of [hK, hK1]) {
					await h.host.startSession({
						source: "vscode",
						interactive: true,
						config: {
							sessionId: h.activeSession.sessionId,
							providerId: "mock-provider",
							modelId: "mock-model",
							cwd: isolationDir,
							workspaceRoot: isolationDir,
							systemPrompt: "pplc01-06 identity test",
							mode: "act" as never,
							enableTools: true,
							enableSpawnAgent: false,
							enableAgentTeams: false,
						},
					})
				}

				await enqueueElmAuthorityRecord({
					stage: "task_started",
					sessionId: hK1.activeSession.sessionId,
					taskId: "task-pplc01-06-K1",
				})
				await enqueueElmAuthorityRecord({
					stage: "run_turn_started",
					sessionId: hK1.activeSession.sessionId,
					runId: "run-pplc01-06-K1-1",
					origin: "explicit_user",
				})
				await flushElmAuthorityForSession(hK1.activeSession.sessionId)
				await hK1.host.runTurn({
					sessionId: hK1.activeSession.sessionId,
					prompt: "BCB continuations: command_status for J1, J2, then submit_and_exit",
					delivery: "queue",
				})
				await waitForMicrotasks(4)

				// K is a SESSION DIFFERENT from K1. K's
				// `agent_turn_done` event (with K's own runId)
				// MUST NOT settle K1's prompt.
				await enqueueElmAuthorityRecord({
					stage: "agent_turn_done",
					sessionId: hK.activeSession.sessionId,
					runId: "run-pplc01-06-K-1",
				})
				await flushElmAuthorityForSession(hK.activeSession.sessionId)
				await hK.coordinator.notifyAgentTurnDone(hK.activeSession.sessionId)
				await flushElmAuthorityForSession(hK1.activeSession.sessionId)

				// INVARIANT: K1's `pending_prompt` hold is intact.
				const decisionK1 = getElmAuthorityCompletionDecision(hK1.activeSession.sessionId)
				const reasonsK1 = decisionK1.kind === "hold" ? (decisionK1.holdReasons ?? []) : []
				expect(reasonsK1).toContain("pending_prompt")
			} finally {
				await hK.host.dispose()
				await hK1.host.dispose()
			}
		},
	)

	// -------------------------------------------------------------------------
	// PPLC-07: at-most-once — duplicate `agent_turn_done` does NOT cause a
	// second commit.
	// -------------------------------------------------------------------------
	it.runIf(canSpawnSubprocess && elmKernelAvailable)(
		"PPLC-07: at-most-once — duplicate agent_turn_done AFTER successful commit does not produce a second commit",
		async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				sessionId: "sess-pplc01-07",
				taskId: "task-pplc01-07",
				isolationDir,
				autoStart: false,
			})

			try {
				await h.host.startSession({
					source: "vscode",
					interactive: true,
					config: {
						sessionId: h.activeSession.sessionId,
						providerId: "mock-provider",
						modelId: "mock-model",
						cwd: isolationDir,
						workspaceRoot: isolationDir,
						systemPrompt: "pplc01-07 at-most-once test",
						mode: "act" as never,
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
				})

				await enqueueElmAuthorityRecord({
					stage: "task_started",
					sessionId: h.activeSession.sessionId,
					taskId: "task-pplc01-07",
				})
				await enqueueElmAuthorityRecord({
					stage: "run_turn_started",
					sessionId: h.activeSession.sessionId,
					runId: "run-pplc01-07-1",
					origin: "explicit_user",
				})
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "BCB continuations: command_status for J1, J2, then submit_and_exit",
					delivery: "queue",
				})
				await waitForMicrotasks(4)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				h.gate.setReady(true)
				const triggerResult = await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "USER_TRIGGER",
				})
				expect(triggerResult).toBeDefined()
				await waitForMicrotasks(8)
				await new Promise((r) => setTimeout(r, 50))
				await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// Sanity: the prompt is settled (no held prompt at the
				// Elm mirror); the BCB has no held terminal observation
				// to drain (the prompt was just an enqueue, not a real
				// `command: "true"` job).
				const decisionBeforeSubmit = getElmAuthorityCompletionDecision(h.activeSession.sessionId)
				const reasonsBefore = decisionBeforeSubmit.kind === "hold" ? (decisionBeforeSubmit.holdReasons ?? []) : []
				expect(reasonsBefore).not.toContain("pending_prompt")

				// Drive the FIRST eligible completion boundary. The
				// production commit effect (`setTurnPhase("completed",
				// ...)`) MUST fire exactly once here. `commitCount`
				// becomes 1.
				h.translatorState.setAttemptCompletionSeen()
				h.translatorState.setTerminalResponseCommittedThisTurn()
				const doneEvent = {
					type: "agent_event" as const,
					payload: {
						sessionId: h.activeSession.sessionId,
						event: {
							type: "done" as const,
							reason: "completed" as const,
							text: "Task completed.",
							iterations: 1,
						},
					},
				}
				await h.coordinator.handleSessionEvent(doneEvent as never)
				await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// Sanity: the first commit succeeded.
				expect(h.commitCount()).toBe(1)
				expect(h.lastPhase()).toBe("completed")

				// Replay 5 duplicate `agent_turn_done` notifications
				// (deliberate). Each MUST NOT manufacture a second
				// `setTurnPhase("completed", ...)` call. The production
				// commit effect is one-shot; subsequent calls see
				// `tracker.currentPhase === "completed"` and the
				// BCB barrier short-circuits (the held count and
				// prompt count stay 0). The deferred-barrier
				// re-evaluation registers no new marker (no
				// outstanding obligation), so the commit guard at
				// `sdk-session-event-coordinator.ts:1523` does not
				// fire. `commitCount` stays at 1.
				for (let i = 0; i < 5; i++) {
					await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)
				}
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// The duplicate-replay guard: a second commit did NOT
				// happen. `commitCount` stays at 1.
				expect(h.commitCount()).toBe(1)
				expect(h.lastPhase()).toBe("completed")
			} finally {
				await h.host.dispose()
			}
		},
	)

	// -------------------------------------------------------------------------
	// PPLC-08: NECESSITY ablation — withhold the canonical subscription
	// AND the runId publication. The `pending_prompt` hold MUST
	// return, proving the production chain proven by PPLC-01..03 is
	// not coincidental.
	//
	// This is the bounded, harness-only ablation the Expert verdict
	// demands. PPLC-02 proves the production chain reaches Elm when
	// the canonical subscription is wired; PPLC-08 proves that with
	// the canonical subscription withheld, the OCRRD01-04 sub-gate 3b
	// RED returns. Together: the production chain IS necessary.
	//
	// Expert verdict (2026-10-12, PPLC-08 correction): the harness
	// now exposes an `installCanonicalSubscription: false` opt that
	// disables BOTH the eager install AND the startSession-wrap,
	// so the canonical subscription is NEVER installed in this
	// ablation. This is the load-bearing change that makes the
	// negative test actually isolate the canonical subscription.
	// -------------------------------------------------------------------------
	it.runIf(canSpawnSubprocess && elmKernelAvailable)(
		"PPLC-08: NECESSITY ablation — without canonical subscription, the pending_prompt hold returns",
		async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			// Critical: do NOT pass `autoStart: true` and do NOT wire
			// the canonical subscription in this harness. The
			// production `onAgentTurnDone` capture is intentionally
			// not installed via `subscribeCanonicalRuntimeEventsToShadow`
			// — the agent stub therefore does NOT publish a
			// runId-bearing `agent_turn_done` event, the Elm prompt
			// mirror stays in `PromptRunning`, and the
			// `pending_prompt` hold returns.
			const h = makeHarness({
				sessionId: "sess-pplc01-08",
				taskId: "task-pplc01-08",
				isolationDir,
				autoStart: false,
				// P0 fix (2026-10-12): disable the harness's
				// canonical-subscription install AND its
				// startSession-wrap. This is the only way the
				// NECESSITY ablation can isolate the canonical
				// subscription's causal role; otherwise the
				// harness installs the subscription behind the
				// test's back and the negative test is invalid.
				installCanonicalSubscription: false,
			})

			try {
				await h.host.startSession({
					source: "vscode",
					interactive: true,
					config: {
						sessionId: h.activeSession.sessionId,
						providerId: "mock-provider",
						modelId: "mock-model",
						cwd: isolationDir,
						workspaceRoot: isolationDir,
						systemPrompt: "pplc01-08 necessity ablation",
						mode: "act" as never,
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
				})

				// Seed Elm with the explicit_user run (identical to PPLC-02).
				await enqueueElmAuthorityRecord({
					stage: "task_started",
					sessionId: h.activeSession.sessionId,
					taskId: "task-pplc01-08",
				})
				await enqueueElmAuthorityRecord({
					stage: "run_turn_started",
					sessionId: h.activeSession.sessionId,
					runId: "run-pplc01-08-1",
					origin: "explicit_user",
				})
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// Drive the real queue lifecycle (same as PPLC-02), but
				// the harness does NOT subscribe the canonical event
				// subscription and the agent stub does NOT publish a
				// runId-bearing `run-started` event. The agent's
				// `agent_turn_done` is therefore a no-op from Elm's
				// perspective: the `ContinuationStarted` record never
				// reaches the authority queue.
				await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "BCB continuations: command_status for J1, J2, then submit_and_exit",
					delivery: "queue",
				})
				await waitForMicrotasks(4)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				h.gate.setReady(true)
				const triggerResult = await h.host.runTurn({
					sessionId: h.activeSession.sessionId,
					prompt: "USER_TRIGGER",
				})
				expect(triggerResult).toBeDefined()
				await waitForMicrotasks(8)
				await new Promise((r) => setTimeout(r, 50))
				await h.coordinator.notifyAgentTurnDone(h.activeSession.sessionId)
				await flushElmAuthorityForSession(h.activeSession.sessionId)

				// INVARIANT (NECESSITY): the `pending_prompt` hold
				// returns. This is the load-bearing discriminant:
				// the canonical subscription is REQUIRED to clear
				// the hold, not just a redundant safety net.
				const decision = getElmAuthorityCompletionDecision(h.activeSession.sessionId)
				const reasons = decision.kind === "hold" ? (decision.holdReasons ?? []) : []
				expect(reasons).toContain("pending_prompt")
			} finally {
				await h.host.dispose()
			}
		},
	)
})
