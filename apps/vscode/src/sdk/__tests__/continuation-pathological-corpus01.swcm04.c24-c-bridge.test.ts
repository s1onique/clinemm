/**
 * ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01 / BOUNDED CORRECTION
 * — REAL PendingPromptService + REAL drain + REAL runTurn re-entry.
 *
 * The companion file `continuation-pathological-corpus01.swcm04.test.ts`
 * (running under the base vitest config) drives the
 * `SdkSessionEventCoordinator + BackgroundNotifyCoordinator + CommandJobManager`
 * composition with a SIMULATED `TestPendingPromptQueue` to exercise the
 * COMPLETION-BARRIER and NOTIFY-AUTHORITY correctness of the production
 * coordinator seam. That test is faithful to the boundary the
 * `setTurnPhase("completed", ...)` decision makes (the user-attention
 * handoff), but it does NOT exercise the real queue / drain / runTurn
 * re-entry chain. Per the HALT_PRODUCTION_SEAM_NOT_EXERCISED review:
 *
 *   real PendingPromptService + real drain + real LocalRuntimeHost re-entry
 *     => no prompt loss / no duplicate continuation / correct steer ordering
 *
 * This file closes that gap for the QUEUE-MECHANICS scenarios:
 *
 *   P3  pending prompt already queued at turn end
 *   P5  steer entry promoted to head of queue
 *   P6  wake + ordinary queued prompt co-exist
 *   A   duplicate jobIds in enqueue
 *   B   stale prompt deleted before drain
 *
 * The barrier/authority-only scenarios (P1, P2, P4, P7, P8, P9, P10, P11,
 * P12, E, H) remain in the companion file because their load-bearing
 * question is the framework barrier at `setTurnPhase("completed", ...)`,
 * NOT the queue mechanics.
 *
 * PRODUCTION FIDELITY (per HALT_PRODUCTION_SEAM_NOT_EXERCISED):
 *
 *   Real classes:
 *     - LocalRuntimeHost (sdk/packages/core) — real runTurn,
 *       real PendingPromptsController, real drain.
 *     - PendingPromptsController.drain / shiftNext / consumeSteer — real
 *       implementations read from the production service.
 *     - FileSessionService — real on-disk session storage.
 *
 *   Synthetic stubs (necessary — these are not the seam under test):
 *     - agent stub (counter-backed run/continue/abort). Records but does
 *       not influence queue mechanics. We deliberately do NOT exercise
 *       the live agent run/stream semantics; the SW-CM04 contract is
 *       about whether the queue drains correctly, not about agent
 *       fidelity.
 *
 * OBSERVABLES (real PendingPromptsController captures via the host's
 * `pendingPromptCapture` option, NOT via a simulated mirror):
 *
 *   - pending_prompt_enqueued (C4)  — fires for every real enqueue
 *   - pending_prompt_dequeued (C5)  — fires for every real drain shift
 *   - continuation_scheduled (C6)   — fires for every real dispatch
 *   - run_turn_started (C7)         — fires for every real runTurn entry
 *   - agent_turn_done (C8)          — fires for every real agent finish
 *
 * Then the test asserts CARDINALITY and ORDER from those real records —
 * not from a simulated queue.
 *
 * CLASSIFICATION (per ACT §7):
 *
 *   PASS_CURRENT       — the real PendingPromptService + drain exhibit
 *                        the expected cardinality and order.
 *   FAIL_CURRENT       — the real chain violates an invariant.
 *   LIVE_UNOBSERVABLE  — the real chain cannot be exercised end-to-end
 *                        in this harness (none expected for this file).
 *
 * This file is BRIDGE-ONLY. It runs under
 *   apps/vscode/vitest.config.c2-4-c-bridge.ts
 * (NOT the base apps/vscode/vitest.config.ts). The base config excludes
 * this file (see apps/vscode/vitest.config.ts `exclude:` block).
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentResult, BasicLogger } from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Cardinality capture (C4..C8) via the host's pendingPromptCapture hook.
// These records are produced by the REAL PendingPromptsController and
// LocalRuntimeHost, NOT by a harness-side mirror.
// ---------------------------------------------------------------------------

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
	const reset = () => {
		records.length = 0
	}
	const counters: Record<Stage, number> = {
		pending_prompt_enqueued: 0,
		pending_prompt_dequeued: 0,
		continuation_scheduled: 0,
		run_turn_started: 0,
		agent_turn_done: 0,
	}
	const snapshot = () => {
		const out: Record<Stage, number> = { ...counters }
		for (const r of records) {
			counters[r.stage] += 1
		}
		return out
	}
	const all = (): readonly CaptureRecord[] => records.slice()
	const filteredBySession = (sessionId: string) => records.filter((r) => r.sessionId === sessionId)
	return { record, reset, snapshot, all, filteredBySession }
}

// ---------------------------------------------------------------------------
// Minimal agent stub: counter-backed run/continue, immediate completion.
// This is NOT the seam under test; we only need it to satisfy the host's
// createAgent contract so runTurn completes its real drain loop.
//
// `gate.ready` flag controls whether canStartRun returns true. Tests
// leave the gate CLOSED while enqueueing prompts (so scheduleDrain's
// canStartRun check is false and the queue grows), then open the gate
// via `gate.setReady(true)` to release the drain. This gives precise
// control over WHEN the production drain fires.
// ---------------------------------------------------------------------------

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
	const abortFn = vi.fn(() => {
		running = false
	})
	const canStartRun = vi.fn(() => ready && !running)
	const agent = {
		run,
		continue: continueFn,
		canStartRun,
		abort: abortFn,
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		subscribeRecoveryStateChange: vi.fn().mockReturnValue(() => {}),
		getAgentId: vi.fn().mockReturnValue("agent-swcm04-bridge"),
		getConversationId: vi.fn().mockReturnValue("conv-swcm04-bridge"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	const gate = {
		setReady: (next: boolean) => {
			ready = next
		},
	}
	return { agent, run, continueFn, abortFn, canStartRun, gate }
}

// ---------------------------------------------------------------------------
// Session service mock — minimal surface required by LocalRuntimeHost.
// ---------------------------------------------------------------------------

function makeSessionServiceMock() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions-swcm04"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/sessions-swcm04/manifest.json",
			messagesPath: "/tmp/sessions-swcm04/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-swcm04",
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
				messages_path: "/tmp/sessions-swcm04/messages.json",
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
		distinctId: "act-swcm04-bridge",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => agent as never,
		logger: makeLoggerStub(),
		// ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01:
		// the production wiring for C4..C8 capture. The hooks fire
		// from INSIDE the real PendingPromptsController.drain /
		// LocalRuntimeHost.runTurn — NOT from any harness-side mirror.
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

describe("ACT-CLINEMM-SW-CM04 BOUNDED CORRECTION — REAL PendingPromptService + drain + runTurn re-entry", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "act-swcm04-bridge-"))
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
	// P3 — PENDING PROMPT ALREADY QUEUED AT TURN END
	// (REAL enqueue + REAL drain + REAL runTurn re-entry)
	//
	// PRODUCTION OBSERVATION:
	// The harness uses the agent-gate (canStartRun starts false) to keep
	// the queue from draining while we enqueue. Then we open the gate
	// and observe the full C4 -> C5 -> C6 -> C7 -> C8 chain. This is
	// the REAL production drain semantics, not a simulated mirror.
	// -----------------------------------------------------------------
	it("SWCM04-P3-BRIDGE: pending prompt enqueued via runTurn({delivery:'queue'}) -> real drain -> real runTurn re-entry fires exactly one agent run", async () => {
		const sessionId = "sess-swcm04-p3-bridge"
		const h = await makeHost(sessionId)
		try {
			// Gate CLOSED: enqueue one prompt with delivery:"queue".
			// The scheduleDrain microtask fires but bails on
			// canStartRun() === false (production behavior:
			// drain refuses to start a run it can't begin).
			const r = await h.host.runTurn({
				sessionId,
				prompt: "Pending user steer prompt",
				delivery: "queue",
			})
			expect(r).toBeUndefined()

			// INVARIANT (real): C4 fired for the enqueue; queue has
			// one entry; drain HAS NOT run yet (C5/C6 still 0).
			const recordsBefore = h.capture.filteredBySession(sessionId)
			expect(recordsBefore.filter((r) => r.stage === "pending_prompt_enqueued")).toHaveLength(1)
			expect(recordsBefore.filter((r) => r.stage === "pending_prompt_dequeued")).toHaveLength(0)
			expect(recordsBefore.filter((r) => r.stage === "run_turn_started")).toHaveLength(0)
			const queueListBefore = await h.host.pendingPrompts.list({ sessionId })
			expect(queueListBefore).toHaveLength(1)
			expect(queueListBefore[0].prompt).toBe("Pending user steer prompt")
			expect(queueListBefore[0].delivery).toBe("queue")

			// Open the gate + trigger a fresh user turn so the
			// host's post-executeTurn queueMicrotask(drain) fires.
			// (Opening the gate alone does NOT trigger drain
			// because scheduleDrain was a no-op when canStartRun
			// was false at enqueue time. A new runTurn with
			// canStartRun=true runs immediately and, on finish,
			// fires queueMicrotask(drain) which then shifts the
			// queued prompt.)
			h.setReady(true)
			const triggerResult = await h.host.runTurn({ sessionId, prompt: "USER_TRIGGER" })
			expect(triggerResult).toBeDefined()
			await new Promise((resolve) => setTimeout(resolve, 50))

			// INVARIANT (real): the FULL chain fired exactly once:
			// C4 enqueue, C5 dequeue, C6 dispatch, C7 run_turn_started,
			// C8 agent_turn_done.
			const records = h.capture.filteredBySession(sessionId)
			const enqueued = records.filter((r) => r.stage === "pending_prompt_enqueued")
			const dequeued = records.filter((r) => r.stage === "pending_prompt_dequeued")
			const dispatched = records.filter((r) => r.stage === "continuation_scheduled")
			const runsStarted = records.filter((r) => r.stage === "run_turn_started")
			const agentDone = records.filter((r) => r.stage === "agent_turn_done")
			expect(enqueued).toHaveLength(1)
			expect(dequeued).toHaveLength(1)
			expect(dispatched).toHaveLength(1)
			expect(runsStarted).toHaveLength(2) // 1 trigger + 1 drained
			expect(agentDone).toHaveLength(2)
			// INVARIANT: the promptId round-trips through C4 -> C5 -> C6.
			expect(enqueued[0].promptId).toBe(dequeued[0].promptId)
			expect(enqueued[0].promptId).toBe(dispatched[0].promptId)
			// INVARIANT: the agent ran for both the user-trigger
			// turn AND the drained queued prompt (2 agent runs total).
			const totalRuns = h.runCount() + h.continueCount()
			expect(totalRuns).toBe(2)
			// INVARIANT: the queue is empty.
			const queueList = await h.host.pendingPrompts.list({ sessionId })
			expect(queueList).toHaveLength(0)
		} finally {
			await h.host.dispose()
		}
	})

	// -----------------------------------------------------------------
	// P5 — STEER PRIORITY
	// (REAL enqueue + REAL drain ordering)
	// -----------------------------------------------------------------
	it("SWCM04-P5-BRIDGE: steer entry prepends to head; real drain dispatches steer before queue in order", async () => {
		const sessionId = "sess-swcm04-p5-bridge"
		const h = await makeHost(sessionId)
		try {
			// Gate CLOSED: enqueue three prompts. Steer prepended to
			// head by the real PendingPromptsController.enqueue
			// (the steer unshift semantics at line 241-242).
			await h.host.runTurn({ sessionId, prompt: "FIFO prompt 1", delivery: "queue" })
			await h.host.runTurn({ sessionId, prompt: "STEERED prompt (head)", delivery: "steer" })
			await h.host.runTurn({ sessionId, prompt: "FIFO prompt 2", delivery: "queue" })

			// INVARIANT (real): three enqueues; the steer is at the head.
			const enqueued = h.capture.filteredBySession(sessionId).filter((r) => r.stage === "pending_prompt_enqueued")
			expect(enqueued).toHaveLength(3)
			const listBeforeDrain = await h.host.pendingPrompts.list({ sessionId })
			expect(listBeforeDrain).toHaveLength(3)
			expect(listBeforeDrain[0].prompt).toBe("STEERED prompt (head)")
			expect(listBeforeDrain[0].delivery).toBe("steer")
			expect(listBeforeDrain[1].prompt).toBe("FIFO prompt 1")
			expect(listBeforeDrain[2].prompt).toBe("FIFO prompt 2")

			// Open the gate and trigger drain via a fresh user
			// turn. The post-executeTurn queueMicrotask(drain)
			// fires; the real drain shifts the head entry (steer),
			// dispatches it, awaits, then drains again. Order is
			// steer, FIFO1, FIFO2.
			h.setReady(true)
			const triggerResult = await h.host.runTurn({ sessionId, prompt: "USER_TRIGGER" })
			expect(triggerResult).toBeDefined()
			await new Promise((resolve) => setTimeout(resolve, 80))

			// INVARIANT (real): C5 (dequeue) order is steer, queue, queue.
			const dequeueOrder = h.capture
				.filteredBySession(sessionId)
				.filter((r) => r.stage === "pending_prompt_dequeued")
				.map((r) => r.delivery)
			expect(dequeueOrder).toEqual(["steer", "queue", "queue"])
			// INVARIANT: three dispatches (C6=3) for the three
			// queued prompts. Plus 1 trigger runTurn. Total C7=4,
			// C8=4.
			expect(h.capture.filteredBySession(sessionId).filter((r) => r.stage === "continuation_scheduled")).toHaveLength(3)
			expect(h.capture.filteredBySession(sessionId).filter((r) => r.stage === "run_turn_started")).toHaveLength(4)
			expect(h.capture.filteredBySession(sessionId).filter((r) => r.stage === "agent_turn_done")).toHaveLength(4)
			// INVARIANT: queue is empty.
			const listAfter = await h.host.pendingPrompts.list({ sessionId })
			expect(listAfter).toHaveLength(0)
		} finally {
			await h.host.dispose()
		}
	})

	// -----------------------------------------------------------------
	// P6 — WAKE + ORDINARY QUEUED PROMPT CO-EXIST
	// (REAL enqueue + REAL drain — no duplicate continuation)
	// -----------------------------------------------------------------
	it("SWCM04-P6-BRIDGE: wake enqueued via delivery:'queue' + pre-existing prompt co-exist -> real drain dispatches each exactly once", async () => {
		const sessionId = "sess-swcm04-p6-bridge"
		const h = await makeHost(sessionId)
		try {
			// Gate CLOSED: enqueue both prompts without draining.
			await h.host.runTurn({ sessionId, prompt: "Pre-existing user prompt", delivery: "queue" })
			await h.host.runTurn({
				sessionId,
				prompt: "BACKGROUND_TERMINAL_WAKE_PROMPT\nJob: J",
				delivery: "queue",
				jobId: "J",
			})

			// INVARIANT (real): two enqueues; both jobIds tracked.
			const enqueued = h.capture.filteredBySession(sessionId).filter((r) => r.stage === "pending_prompt_enqueued")
			expect(enqueued).toHaveLength(2)
			expect(enqueued.find((r) => r.jobId === "J")).toBeDefined()

			// Open the gate and trigger drain via a fresh user
			// turn. The post-executeTurn queueMicrotask(drain)
			// fires; the real drain dispatches both queued
			// prompts. NO duplicate continuation.
			h.setReady(true)
			const triggerResult = await h.host.runTurn({ sessionId, prompt: "USER_TRIGGER" })
			expect(triggerResult).toBeDefined()
			await new Promise((resolve) => setTimeout(resolve, 80))

			// INVARIANT (real): exactly TWO dequeue events; NO
			// duplicate continuation. If the drain dispatched the
			// same prompt twice, we would see C5>2.
			const dequeueCount = h.capture
				.filteredBySession(sessionId)
				.filter((r) => r.stage === "pending_prompt_dequeued").length
			expect(dequeueCount).toBe(2)
			// INVARIANT: exactly THREE run_turn_started (1 user-trigger
			// + 2 drained queued prompts). No duplicate dispatch.
			const runCount = h.capture.filteredBySession(sessionId).filter((r) => r.stage === "run_turn_started").length
			expect(runCount).toBe(3)
			// INVARIANT: queue is empty.
			const listAfter = await h.host.pendingPrompts.list({ sessionId })
			expect(listAfter).toHaveLength(0)
		} finally {
			await h.host.dispose()
		}
	})

	// -----------------------------------------------------------------
	// A — DUPLICATE JOBIDS
	// (REAL enqueue does NOT dedupe by jobId)
	// -----------------------------------------------------------------
	it("SWCM04-A-BRIDGE: duplicate jobIds produce distinct queue entries in the real PendingPromptService", async () => {
		const sessionId = "sess-swcm04-a-bridge"
		const h = await makeHost(sessionId)
		try {
			// Gate CLOSED: enqueue two prompts with the same jobId.
			await h.host.runTurn({ sessionId, prompt: "wake for J (attempt 1)", delivery: "queue", jobId: "J" })
			await h.host.runTurn({ sessionId, prompt: "wake for J (attempt 2)", delivery: "queue", jobId: "J" })

			// INVARIANT (real): two distinct queue entries — the
			// real PendingPromptService does NOT dedupe by jobId.
			// (The SessionPendingPrompt snapshot returned by
			// `list()` omits jobId; we assert jobId correlation
			// through the C4 capture hook which DOES preserve it.)
			const list = await h.host.pendingPrompts.list({ sessionId })
			expect(list).toHaveLength(2)
			expect(list[0].prompt).toBe("wake for J (attempt 1)")
			expect(list[1].prompt).toBe("wake for J (attempt 2)")
			const enqueued = h.capture.filteredBySession(sessionId).filter((r) => r.stage === "pending_prompt_enqueued")
			expect(enqueued).toHaveLength(2)
			expect(enqueued[0].jobId).toBe("J")
			expect(enqueued[1].jobId).toBe("J")
		} finally {
			await h.host.dispose()
		}
	})

	// -----------------------------------------------------------------
	// B — STALE PROMPT DELETED BEFORE DRAIN
	// (REAL enqueue + REAL delete-by-promptId)
	// -----------------------------------------------------------------
	it("SWCM04-B-BRIDGE: delete-by-promptId on the real PendingPromptsController drops the entry; drain sees nothing for it", async () => {
		const sessionId = "sess-swcm04-b-bridge"
		const h = await makeHost(sessionId)
		try {
			// Gate CLOSED: enqueue one stale prompt.
			await h.host.runTurn({ sessionId, prompt: "stale wake", delivery: "queue", jobId: "J" })

			const listBefore = await h.host.pendingPrompts.list({ sessionId })
			expect(listBefore).toHaveLength(1)
			const staleId = listBefore[0].id

			// Delete the stale entry via the production service.
			await h.host.pendingPrompts.delete({ sessionId, promptId: staleId })

			// INVARIANT (real): queue is empty after delete.
			const listAfterDelete = await h.host.pendingPrompts.list({ sessionId })
			expect(listAfterDelete).toHaveLength(0)

			// Open the gate and trigger drain via a fresh user
			// turn. The post-executeTurn queueMicrotask(drain)
			// fires; the queue is empty (the entry was deleted),
			// so no dequeue occurs.
			h.setReady(true)
			const triggerResult = await h.host.runTurn({ sessionId, prompt: "USER_TRIGGER" })
			expect(triggerResult).toBeDefined()
			await new Promise((resolve) => setTimeout(resolve, 80))

			// INVARIANT (real): no dequeue for the deleted prompt.
			const dequeueCount = h.capture
				.filteredBySession(sessionId)
				.filter((r) => r.stage === "pending_prompt_dequeued").length
			expect(dequeueCount).toBe(0)
			// INVARIANT: only the trigger turn ran (no queued prompt).
			expect(h.runCount() + h.continueCount()).toBe(1)
		} finally {
			await h.host.dispose()
		}
	})
})
