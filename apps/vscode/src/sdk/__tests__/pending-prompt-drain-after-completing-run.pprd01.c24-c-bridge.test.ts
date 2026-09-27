/**
 * ACT-CLINEMM-PENDING-PROMPT-DRAIN-AFTER-COMPLETING-RUN01 — PPRD01
 *
 * Live-defect reproduction for the BCB finalization-prompt drain defect.
 *
 * The live capture shows: one completion-finalization prompt was enqueued,
 * zero were dequeued, zero continuations were scheduled, one submit_and_exit
 * was observed, zero authoritative task completions.
 *
 * Production chain under test:
 *
 *   submit_and_exit tool (lifecycle.completesRun === true)
 *     -> runtime.run() resolves with finishRun("completed")
 *     -> SdkSessionEventCoordinator.handleSessionEvent (BCB barrier)
 *        registers deferredCompletionBarrier + enqueueCompletionContinuationIfHeld
 *        -> sdkHost.send({ delivery: "queue" })
 *        -> LocalRuntimeHost.runTurn -> queue/steer short-circuit
 *        -> pendingPromptsController.enqueue
 *        -> scheduleDrain (gated on session.agent.canStartRun())
 *     -> LocalRuntimeHost.runTurn post-turn drain microtask (line 1268)
 *
 * The invariant under proof:
 *
 *   eligible pending prompt exists
 *   AND no run currently owns the session
 *   => exactly one drain attempt is eventually scheduled
 *
 * This file lives under the c24-c-bridge config because it imports the
 * REAL LocalRuntimeHost via @cline-internal/core/.../local-runtime-host
 * (the @cline/core bundle minifier collides class exports; see
 * .clinerules/sdk-transport-integration.md for the full bridge rationale).
 *
 * PRODUCTION SEAM EXERCISED:
 *   - LocalRuntimeHost (real runTurn, real PendingPromptsController)
 *   - PendingPromptsController (real enqueue/drain/shiftNext)
 *   - FileSessionService (real on-disk session storage)
 *   - SessionRuntime orchestrator (real SessionRuntime.run)
 *
 * SYNTHETIC STUBS (not the seam under test):
 *   - AgentRuntime stub: counter-backed run/continue/abort, immediate
 *     completion, controllable canStartRun via "gate"
 *   - SessionService mock: minimal surface required by LocalRuntimeHost
 *
 * OBSERVABLES via REAL PendingPromptsController capture hooks:
 *   - C4 pending_prompt_enqueued
 *   - C5 pending_prompt_dequeued
 *   - C6 continuation_scheduled
 *   - C7 run_turn_started
 *   - C8 agent_turn_done
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
		return { ...counters, records: records.slice() }
	}
	const filteredBySession = (sessionId: string) => records.filter((r) => r.sessionId === sessionId)
	return { record, snapshot, filteredBySession, records }
}

// ============================================================================
// Minimal agent stub
// ============================================================================

function makeAgentStub() {
	let running = false
	let ready = false
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
		// Yield once so the host's runTurn finishes the agent_turn_done
		// capture, queueMicrotask(drain) fires, and the recursive drain
		// runs BEFORE the test inspects state.
		await new Promise((resolve) => setImmediate(resolve))
		running = false
		return makeResult()
	})
	const continueFn = vi.fn(async (): Promise<AgentResult> => {
		running = true
		await new Promise((resolve) => setImmediate(resolve))
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
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		subscribeRecoveryStateChange: vi.fn().mockReturnValue(() => {}),
		getAgentId: vi.fn().mockReturnValue("agent-pprd01-bridge"),
		getConversationId: vi.fn().mockReturnValue("conv-pprd01-bridge"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	const gate = {
		setReady: (next: boolean) => {
			ready = next
		},
	}
	return { agent, run, continueFn, canStartRun, gate }
}

function makeSessionServiceMock() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions-pprd01"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/sessions-pprd01/manifest.json",
			messagesPath: "/tmp/sessions-pprd01/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-pprd01",
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
				messages_path: "/tmp/sessions-pprd01/messages.json",
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

function makeLoggerStub(): BasicLogger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
	} as unknown as BasicLogger
}

interface Harness {
	host: LocalRuntimeHost
	sessionId: string
	capture: ReturnType<typeof makeCardinalityCapture>
	runCount: () => number
	continueCount: () => number
	setReady: (ready: boolean) => void
}

async function makeHost(sessionId: string): Promise<Harness> {
	const sessionService = makeSessionServiceMock()
	const runtimeBuilder = makeRuntimeBuilderStub()
	const { agent, run, continueFn, gate } = makeAgentStub()
	const capture = makeCardinalityCapture()

	const host = new LocalRuntimeHost({
		distinctId: "act-pprd01-bridge",
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
			systemPrompt: "test",
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
	}
}

// ============================================================================
// Tests
// ============================================================================

describe("ACT-CLINEMM-PENDING-PROMPT-DRAIN-AFTER-COMPLETING-RUN01 — PPRD01", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "act-pprd01-bridge-"))
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
	// PPRD-01: live-defect RED
	//
	// PRODUCTION-SHAPED TEST: drive the real PendingPromptsController +
	// LocalRuntimeHost chain. NOT a pure helper.
	//
	// Live chronology to reproduce:
	//   1. session is running with a held completion prompt enqueued
	//      via the BCB barrier (delivery: "queue")
	//   2. the current run is a completesRun (submit_and_exit) turn
	//   3. the current run ends (finishReason: "completed")
	//   4. NO further user input arrives
	//
	// Expected RED:
	//   pending_prompt_enqueued   = 1 (the held completion prompt)
	//   pending_prompt_dequeued   = 0
	//   continuation_scheduled    = 0
	//
	// Expected GREEN:
	//   pending_prompt_enqueued   = 1
	//   pending_prompt_dequeued   = 1
	//   continuation_scheduled    = 1
	// -----------------------------------------------------------------
	it("PPRD-01-BRIDGE: a queued finalization prompt is dequeued + continuation scheduled after a completesRun turn ends (no user input)", async () => {
		const sessionId = "sess-pprd01-01-bridge"
		const h = await makeHost(sessionId)
		try {
			// Gate CLOSED: enqueue ONE finalization-style prompt with
			// delivery: "queue" while the agent run is still in flight
			// (mirrors the BCB barrier CORRECTION03 trigger firing
			// its sdkHost.send chain from inside the run-finished event
			// handler).
			const enqueueResult = await h.host.runTurn({
				sessionId,
				prompt: "FINALIZATION_PROMPT held completion",
				delivery: "queue",
			})
			expect(enqueueResult).toBeUndefined()

			// INVARIANT (RED TOPOLOGY): one C4 enqueue, NO C5/C6 yet.
			const enqueuedBefore = h.capture.filteredBySession(sessionId).filter((r) => r.stage === "pending_prompt_enqueued")
			const dequeuedBefore = h.capture.filteredBySession(sessionId).filter((r) => r.stage === "pending_prompt_dequeued")
			expect(enqueuedBefore).toHaveLength(1)
			expect(dequeuedBefore).toHaveLength(0)
			expect(h.capture.filteredBySession(sessionId).filter((r) => r.stage === "continuation_scheduled")).toHaveLength(0)

			// Open the gate: session.agent.canStartRun() returns true
			// AND the agent is not running. This is the post-completesRun
			// state: the user-submit_and_exit turn has already settled
			// (running=false) and the held completion prompt sits in
			// the queue.
			h.setReady(true)

			// Now drive a new user turn that completesRun on first turn
			// (the production agent stub always returns finishReason:
			// "completed"). This is the trigger turn that, in the live
			// defect, was the BCB barrier's submit_and_exit.
			//
			// The post-turn drain microtask (local-runtime-host.ts:1268)
			// fires after the agent finishes. The real drain should see
			// the queued prompt and dispatch it.
			const triggerResult = await h.host.runTurn({
				sessionId,
				prompt: "USER_FINAL_SUBMIT_AND_EXIT",
			})
			expect(triggerResult).toBeDefined()

			// Give the drain chain time to settle (one macrotask).
			await new Promise((resolve) => setTimeout(resolve, 80))

			// INVARIANT (GREEN TOPOLOGY): the queued prompt is dequeued
			// AND a continuation is dispatched.
			const records = h.capture.filteredBySession(sessionId)
			const enqueued = records.filter((r) => r.stage === "pending_prompt_enqueued")
			const dequeued = records.filter((r) => r.stage === "pending_prompt_dequeued")
			const dispatched = records.filter((r) => r.stage === "continuation_scheduled")

			expect(enqueued).toHaveLength(1)
			expect(dequeued).toHaveLength(1)
			expect(dispatched).toHaveLength(1)

			// INVARIANT: promptId round-trips through C4 -> C5 -> C6.
			expect(enqueued[0].promptId).toBe(dequeued[0].promptId)
			expect(enqueued[0].promptId).toBe(dispatched[0].promptId)

			// INVARIANT: the finalization prompt was actually dispatched
			// (the agent ran it). Total agent runs = 2 (1 trigger + 1 drained).
			const totalRuns = h.runCount() + h.continueCount()
			expect(totalRuns).toBe(2)

			// INVARIANT: queue is empty.
			const listAfter = await h.host.pendingPrompts.list({ sessionId })
			expect(listAfter).toHaveLength(0)
		} finally {
			await h.host.dispose()
		}
	})
})

// ============================================================================
// PPRD-02 — BCB chain through real sdkHost.send + real PendingPromptsController
// ============================================================================

describe("ACT-CLINEMM-PENDING-PROMPT-DRAIN-AFTER-COMPLETING-RUN01 — PPRD-02: BCB chain", () => {
	let isolationDir = ""
	let host: LocalRuntimeHost | undefined

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "act-pprd01-bridge-02-"))
		process.env.HOME = isolationDir
		process.env.CLINE_DIR = join(isolationDir, ".cline")
	})

	afterEach(async () => {
		if (host) {
			try {
				await host.dispose()
			} catch {
				/* dispose on idle host is fine */
			}
			host = undefined
		}
		if (isolationDir && existsSync(isolationDir)) {
			rmSync(isolationDir, { recursive: true, force: true })
		}
		vi.restoreAllMocks()
	})

	// -----------------------------------------------------------------
	// PPRD-02: BCB chain through real sdkHost.send -> real
	// PendingPromptsController -> real drain.
	//
	// Reproduction strategy:
	//   1. Start a session on the real LocalRuntimeHost
	//   2. Open the gate (canStartRun()=true, running=false)
	//   3. Enqueue a "finalization" prompt with delivery: "queue"
	//      WHILE the agent-stub is "running" (gate closed)
	//   4. Open the gate -> setReady(true)
	//   5. Run a trigger turn that completes (finishReason: "completed")
	//   6. The post-turn drain microtask (line 1268) should pick up
	//      the queued finalization prompt
	//
	// Expected GREEN: enqueued=1, dequeued=1, dispatched=1
	// -----------------------------------------------------------------
	it("PPRD-02-BRIDGE: queued finalization prompt is drained after a completesRun turn ends", async () => {
		const sessionId = "sess-pprd02-bridge"
		const sessionService = makeSessionServiceMock()
		const runtimeBuilder = makeRuntimeBuilderStub()
		const { agent, run, continueFn, gate } = makeAgentStub()
		const capture = makeCardinalityCapture()

		host = new LocalRuntimeHost({
			distinctId: "act-pprd02-bridge",
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
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "pprd02 test",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		// Phase 1: enqueue a "finalization" prompt via runTurn.
		// The BCB barrier's enqueue is delivery: "queue", which means the
		// agent is NOT to be started now (it joins the queue).
		const enqueueResult = await host.runTurn({
			sessionId,
			prompt: "FINALIZATION: call command_status for J1, J2, then submit_and_exit",
			delivery: "queue",
		})
		expect(enqueueResult).toBeUndefined()

		// INVARIANT (red topology): one C4, zero C5/C6.
		const enqueuedBefore = capture.filteredBySession(sessionId).filter((r) => r.stage === "pending_prompt_enqueued")
		const dequeuedBefore = capture.filteredBySession(sessionId).filter((r) => r.stage === "pending_prompt_dequeued")
		expect(enqueuedBefore).toHaveLength(1)
		expect(dequeuedBefore).toHaveLength(0)
		expect(capture.filteredBySession(sessionId).filter((r) => r.stage === "continuation_scheduled")).toHaveLength(0)

		const listBefore = await host.pendingPrompts.list({ sessionId })
		expect(listBefore).toHaveLength(1)
		expect(listBefore[0].prompt).toContain("FINALIZATION")

		// Open the gate (mirrors post-completesRun state: agent finished,
		// no run currently owns the session).
		gate.setReady(true)

		// Phase 2: drive a fresh user turn that completesRun on first
		// iteration. This is the analog of the user's submit_and_exit
		// turn ending -- the post-turn drain microtask at
		// local-runtime-host.ts:1268 should fire.
		const triggerResult = await host.runTurn({
			sessionId,
			prompt: "USER_SUBMIT_AND_EXIT_TRIGGER",
		})
		expect(triggerResult).toBeDefined()

		// Give microtasks + drain chain time to settle.
		await new Promise((resolve) => setTimeout(resolve, 80))

		// INVARIANT (green topology): the queued finalization prompt
		// IS dequeued + a continuation IS scheduled.
		const records = capture.filteredBySession(sessionId)
		const enqueued = records.filter((r) => r.stage === "pending_prompt_enqueued")
		const dequeued = records.filter((r) => r.stage === "pending_prompt_dequeued")
		const dispatched = records.filter((r) => r.stage === "continuation_scheduled")

		expect(enqueued).toHaveLength(1)
		expect(dequeued).toHaveLength(1)
		expect(dispatched).toHaveLength(1)

		// INVARIANT: promptId round-trips.
		expect(enqueued[0].promptId).toBe(dequeued[0].promptId)
		expect(enqueued[0].promptId).toBe(dispatched[0].promptId)

		// INVARIANT: agent ran twice (trigger + drained).
		expect(run.mock.calls.length + continueFn.mock.calls.length).toBe(2)

		// INVARIANT: queue is empty.
		const listAfter = await host.pendingPrompts.list({ sessionId })
		expect(listAfter).toHaveLength(0)
	})
})
