/**
 * ACT-CLINEMM-PENDING-PROMPT-LOST-WAKEUP01 — PPLW01
 *
 * Lost-wakeup reproduction tests for the BCB finalization-prompt drain defect.
 *
 * The live capture shows:
 *   pending_prompt_enqueued   = 1 (BCB chain fired during completing run)
 *   pending_prompt_dequeued   = 0
 *   continuation_scheduled    = 0
 *   task_completion_committed  = 0
 *
 * The predecessor ACT (PPRD01) argued both orderings drain correctly
 * via the post-turn drain microtask at local-runtime-host.ts:1269. It did NOT
 * deterministically reproduce either ordering — its bridge tests use a
 * controllable AgentRuntime stub whose `run` completes immediately, so the
 * BCB enqueue can only happen BEFORE the run starts (when the gate is closed).
 *
 * This file fixes that: it uses a controllable `run` that BLOCKS until
 * signalled, allowing a queued finalization prompt to be enqueued DURING the
 * active run (mirroring the live BCB chain's `sdkHost.send({delivery:"queue"})`
 * invocation fired from inside the run-finished event listener).
 *
 * PRODUCTION CHAIN UNDER TEST:
 *   - LocalRuntimeHost (real runTurn, real PendingPromptsController)
 *   - PendingPromptsController (real enqueue/drain/shiftNext)
 *   - SessionRuntime orchestrator (real SessionRuntime.run)
 *
 * TWO ORDERINGS, both must drain:
 *   PPLW-01: BCB enqueue DURING active run, then run completes -> drain
 *   PPLW-02: BCB enqueue AFTER run ends (runTurn post-turn drain microtask
 *            fires first with empty queue, then BCB enqueue's scheduleDrain
 *            fires and queues a new drain)
 *
 * CONSERVATION:
 *   - C4..C8 capture hooks remain the canonical seam
 *   - MAX_ACTIVE_RUNS_PER_SESSION = 1 (no parallel run)
 *   - MAX_DRAIN_SCHEDULERS_PER_SESSION = 1 (reentrancy guard)
 *   - FIFO preserved
 *   - No background scheduler infrastructure
 *   - No polling loops
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentResult, BasicLogger } from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ============================================================================
// Cardinality capture (C4..C8) via the host's pendingPromptCapture hook.
// ============================================================================

type Stage =
	| "pending_prompt_enqueued"
	| "pending_prompt_dequeued"
	| "continuation_scheduled"
	| "run_turn_started"
	| "agent_turn_done"

interface CaptureRecord {
	readonly stage: Stage
	readonly sessionId: string
	readonly delivery?: "queue" | "steer"
	readonly promptId?: string
	readonly jobId?: string
	readonly prompt?: string
	readonly finishReason?: string
}

function makeCardinalityCapture() {
	const records: CaptureRecord[] = []
	const record = (r: CaptureRecord) => {
		records.push(r)
	}
	const snapshot = () => {
		const counters: Record<Stage, number> = {
			pending_prompt_enqueued: 0,
			pending_prompt_dequeued: 0,
			continuation_scheduled: 0,
			run_turn_started: 0,
			agent_turn_done: 0,
		}
		for (const r of records) {
			counters[r.stage] += 1
		}
		return counters
	}
	const filteredBySession = (sessionId: string) => records.filter((r) => r.sessionId === sessionId)
	return { record, snapshot, filteredBySession, records }
}
// ============================================================================
// Controllable agent stub — `run` BLOCKS until `signalRunComplete()` is called.
// This is the load-bearing mechanism for exercising BOTH orderings:
//   PPLW-01 — enqueue DURING the active run, then signal completion
//   PPLW-02 — signal completion first, then enqueue (race window)
// ============================================================================

function makeControllableAgentStub() {
	let running = false
	let ready = false
	let runGate: { resolve: () => void } | undefined
	let continueGate: { resolve: () => void } | undefined

	const makeResult = (): AgentResult => ({
		finishReason: "completed",
		text: "",
		messages: [],
		toolCalls: [],
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
		durationMs: 1,
		iterations: 1,
		model: { id: "mock", provider: "mock" },
		startedAt: new Date(),
		endedAt: new Date(),
	})

	const run = vi.fn(async (): Promise<AgentResult> => {
		running = true
		await new Promise<void>((resolve) => {
			runGate = { resolve }
		})
		running = false
		return makeResult()
	})

	const continueFn = vi.fn(async (): Promise<AgentResult> => {
		running = true
		await new Promise<void>((resolve) => {
			continueGate = { resolve }
		})
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
			runGate?.resolve()
			continueGate?.resolve()
		}),
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		subscribeRecoveryStateChange: vi.fn().mockReturnValue(() => {}),
		getAgentId: vi.fn().mockReturnValue("agent-pplw01-bridge"),
		getConversationId: vi.fn().mockReturnValue("conv-pplw01-bridge"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}

	const gate = {
		setReady: (next: boolean) => {
			ready = next
		},
		signalRunComplete: () => {
			runGate?.resolve()
			runGate = undefined
		},
		signalContinueComplete: () => {
			continueGate?.resolve()
			continueGate = undefined
		},
	}

	return { agent, run, continueFn, canStartRun, gate }
}

function makeSessionServiceMock() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions-pplw01"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/sessions-pplw01/manifest.json",
			messagesPath: "/tmp/sessions-pplw01/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-pplw01",
				source: "vscode",
				pid: process.pid,
				started_at: new Date().toISOString(),
				status: "running",
				interactive: true,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project",
				workspace_root: "/tmp/project",
				enable_tools: true,
				enable_spawn: true,
				enable_teams: true,
				prompt: "hello",
				messages_path: "/tmp/sessions-pplw01/messages.json",
			},
		}),
		persistSessionMessages: vi.fn().mockResolvedValue(undefined),
		updateSessionStatus: vi.fn().mockResolvedValue({
			updated: true,
			endedAt: new Date().toISOString(),
		}),
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

interface Harness {
	host: LocalRuntimeHost
	sessionId: string
	capture: ReturnType<typeof makeCardinalityCapture>
	runCount: () => number
	continueCount: () => number
	setReady: (ready: boolean) => void
	signalRunComplete: () => void
	signalContinueComplete: () => void
}

async function makeHost(sessionId: string): Promise<Harness> {
	const sessionService = makeSessionServiceMock()
	const runtimeBuilder = makeRuntimeBuilderStub()
	const { agent, run, continueFn, gate } = makeControllableAgentStub()
	const capture = makeCardinalityCapture()

	const host = new LocalRuntimeHost({
		distinctId: "act-pplw01-bridge",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => agent as never,
		logger: makeLoggerStub(),
		pendingPromptCapture: {
			onEnqueue: (input) => {
				capture.record({
					stage: "pending_prompt_enqueued",
					sessionId: input.sessionId,
					delivery: input.delivery,
					promptId: input.promptId,
					jobId: input.jobId,
				})
			},
			onBeforeDrain: (input) => {
				capture.record({
					stage: "pending_prompt_dequeued",
					sessionId: input.sessionId,
					delivery: input.delivery,
					promptId: input.promptId,
					jobId: input.jobId,
				})
			},
			onBeforeDispatch: (input) => {
				capture.record({
					stage: "continuation_scheduled",
					sessionId: input.sessionId,
					delivery: input.delivery,
					promptId: input.promptId,
					jobId: input.jobId,
				})
			},
			onRunTurnStarted: (input) => {
				capture.record({
					stage: "run_turn_started",
					sessionId: input.sessionId,
					delivery: input.delivery,
					jobId: input.jobId,
				})
			},
			onAgentTurnDone: (input) => {
				capture.record({
					stage: "agent_turn_done",
					sessionId: input.sessionId,
					finishReason: input.finishReason,
					delivery: input.delivery,
					jobId: input.jobId,
				})
			},
		},
	})

	await host.startSession({
		source: "vscode",
		interactive: true,
		config: {
			sessionId,
			providerId: "mock-provider",
			modelId: "mock-model",
			cwd: "/tmp/project",
			workspaceRoot: "/tmp/project",
			systemPrompt: "pplw01 test",
			mode: "act",
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
	})

	return {
		host,
		sessionId,
		capture,
		runCount: () => run.mock.calls.length,
		continueCount: () => continueFn.mock.calls.length,
		setReady: (ready: boolean) => gate.setReady(ready),
		signalRunComplete: () => gate.signalRunComplete(),
		signalContinueComplete: () => gate.signalContinueComplete(),
	}
}
function makeLoggerStub(): BasicLogger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
	} as unknown as BasicLogger
}

// ============================================================================
// Tests
// ============================================================================

describe("ACT-CLINEMM-PENDING-PROMPT-LOST-WAKEUP01 — PPLW01", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "act-pplw01-bridge-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		delete process.env.CLINE_DATA_DIR
		setHomeDir(isolatedHomeDir)
		setClineDir(process.env.CLINE_DIR)
	})

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		if (envSnapshot.CLINE_DATA_DIR === undefined) {
			delete process.env.CLINE_DATA_DIR
		} else {
			process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR
		}
		setHomeDir(envSnapshot.HOME ?? "~")
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"))
		if (isolatedHomeDir && existsSync(isolatedHomeDir)) {
			rmSync(isolatedHomeDir, { recursive: true, force: true })
		}
		vi.restoreAllMocks()
	})

	// -----------------------------------------------------------------
	// PPLW-01: BCB ENQUEUE DURING ACTIVE RUN
	// -----------------------------------------------------------------
	it("PPLW-01: enqueue DURING active run, then run completes -> drain", async () => {
		const sessionId = "sess-pplw01-01-during"
		const h = await makeHost(sessionId)
		try {
			h.setReady(true)
			const userTurnPromise = h.host.runTurn({
				sessionId,
				prompt: "USER_SUBMIT_AND_EXIT",
			})
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))

			expect(h.runCount()).toBe(1)

			const enqueueResult = await h.host.runTurn({
				sessionId,
				prompt: "FINALIZATION: call command_status for held jobs, then submit_and_exit",
				delivery: "queue",
			})
			expect(enqueueResult).toBeUndefined()

			const mid = h.capture.filteredBySession(sessionId)
			expect(mid.filter((r) => r.stage === "pending_prompt_enqueued")).toHaveLength(1)
			expect(mid.filter((r) => r.stage === "pending_prompt_dequeued")).toHaveLength(0)
			expect(mid.filter((r) => r.stage === "continuation_scheduled")).toHaveLength(0)

			h.signalRunComplete()
			await userTurnPromise

			await new Promise((resolve) => setTimeout(resolve, 80))
			await new Promise((resolve) => setImmediate(resolve))

			const records = h.capture.filteredBySession(sessionId)
			const enqueued = records.filter((r) => r.stage === "pending_prompt_enqueued")
			const dequeued = records.filter((r) => r.stage === "pending_prompt_dequeued")
			const dispatched = records.filter((r) => r.stage === "continuation_scheduled")
			expect(enqueued).toHaveLength(1)
			expect(dequeued).toHaveLength(1)
			expect(dispatched).toHaveLength(1)

			expect(enqueued[0].promptId).toBe(dequeued[0].promptId)
			expect(enqueued[0].promptId).toBe(dispatched[0].promptId)

			expect(h.runCount() + h.continueCount()).toBe(2)

			const listAfter = await h.host.pendingPrompts.list({ sessionId })
			expect(listAfter).toHaveLength(0)
		} finally {
			h.signalRunComplete()
			h.signalContinueComplete()
		}
	})

	// -----------------------------------------------------------------
	// PPLW-02: TURN-DONE FIRST, THEN ENQUEUE
	// -----------------------------------------------------------------
	it("PPLW-02: turn completes first, then enqueue -> drain", async () => {
		const sessionId = "sess-pplw01-02-after"
		const h = await makeHost(sessionId)
		try {
			const bc1 = await h.host.runTurn({
				sessionId,
				prompt: "FINALIZATION_PHASE_1",
				delivery: "queue",
			})
			expect(bc1).toBeUndefined()

			h.setReady(true)
			// Kick off the user turn in the background. The agent.run()
			// inside is BLOCKED on runGate. We give the host a moment
			// to enter executeAgentTurn (so runGate is registered),
			// then signal completion.
			const userTurnPromise = h.host.runTurn({
				sessionId,
				prompt: "USER_TURN",
			})
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			h.signalRunComplete()
			const userTurnResult = await userTurnPromise
			expect(userTurnResult).toBeDefined()

			// The post-turn drain microtask fires and dispatches the
			// queued prompt via agent.continue() (which is BLOCKED).
			await new Promise((resolve) => setImmediate(resolve))
			h.signalContinueComplete()

			await new Promise((resolve) => setTimeout(resolve, 80))
			await new Promise((resolve) => setImmediate(resolve))

			const phase2 = h.capture.filteredBySession(sessionId)
			expect(phase2.filter((r) => r.stage === "pending_prompt_enqueued")).toHaveLength(1)
			expect(phase2.filter((r) => r.stage === "pending_prompt_dequeued")).toHaveLength(1)
			expect(phase2.filter((r) => r.stage === "continuation_scheduled")).toHaveLength(1)

			// Phase 3: enqueue a NEW finalization prompt AFTER the
			// user turn has settled. scheduleDrain queues a new drain.
			const bc2 = await h.host.runTurn({
				sessionId,
				prompt: "FINALIZATION_PHASE_2",
				delivery: "queue",
			})
			expect(bc2).toBeUndefined()

			// The drain triggered by the bc2 enqueue's scheduleDrain
			// will invoke agent.continue() again.
			await new Promise((resolve) => setImmediate(resolve))
			h.signalContinueComplete()

			await new Promise((resolve) => setTimeout(resolve, 80))
			await new Promise((resolve) => setImmediate(resolve))

			const final = h.capture.filteredBySession(sessionId)
			expect(final.filter((r) => r.stage === "pending_prompt_enqueued")).toHaveLength(2)
			expect(final.filter((r) => r.stage === "pending_prompt_dequeued")).toHaveLength(2)
			expect(final.filter((r) => r.stage === "continuation_scheduled")).toHaveLength(2)

			const dequeuedRecords = final.filter((r) => r.stage === "pending_prompt_dequeued")
			expect(dequeuedRecords[0].promptId).not.toBe(dequeuedRecords[1].promptId)
			expect(
				final
					.filter((r) => r.stage === "pending_prompt_enqueued")
					.find((r) => r.promptId === dequeuedRecords[0].promptId),
			).toBeDefined()
			expect(
				final
					.filter((r) => r.stage === "pending_prompt_enqueued")
					.find((r) => r.promptId === dequeuedRecords[1].promptId),
			).toBeDefined()

			const listAfter = await h.host.pendingPrompts.list({ sessionId })
			expect(listAfter).toHaveLength(0)
		} finally {
			h.signalRunComplete()
			h.signalContinueComplete()
		}
	})
})
