/**
 * ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 / QPSR01
 * — preliminary host-queue + abort controls PLUS the real-composition
 * discriminator (`QPSR02_REAL_COMPOSITION`).
 *
 * Upstream defect: `cline/cline#12975` — "Cline: Resume re-executes
 * previously completed commands instead of continuing with the queued
 * task."
 *
 * Status after Factory review:
 *   - The three QPSR01_CTL01 / QPSR01_CTL02 / QPSR01_PRIMARY tests below
 *     exercise the **host queue + abort control seam only**. They are
 *     honest preliminary controls: they prove that the host enqueue /
 *     abort / drain machinery lands at the right place, but they do NOT
 *     prove or disprove the upstream defect.
 *   - The load-bearing RED lives in `QPSR02_REAL_COMPOSITION` (separate
 *     `describe` block at the end of this file). That test constructs
 *     the REAL LocalRuntimeHost + SessionRuntime + AgentRuntime
 *     composition (mirroring SHRC01's pattern), runs a real P1 with C1
 *     and C2 tool invocations, queues P2, calls host.abort(), then
 *     calls host.runTurn() with a new prompt (the Resume gesture) and
 *     observes whether C1/C2 are re-executed via counter-backed tools.
 *   - `QPSR03_PRODUCTION_CHRONOLOGY` (third commit) closes the two P0
 *     gaps the Factory reviewer flagged against `e5a699695`:
 *     (1) P1 is provably active when P2 is submitted (queue
 *         precondition genuinely exercised, not bypassed).
 *     (2) Resume enters through the production Resume entrypoint
 *         (readLiveSessionMessages → fresh-host
 *         startSession({initialMessages}) → runTurn), not the
 *         simplified live-session `runTurn` shortcut.
 *
 * Final classification (narrowed per Factory reviewer disposition):
 *   CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST = NOT_REPRODUCED
 *   C1/C2_TOOL_RESULT_DURABILITY_ACROSS_RESUME     = PROVEN
 *   P2_QUEUE_ENQUEUE                                = PROVEN
 *   P2_QUEUE_DRAIN                                  = PROVEN
 *   PRODUCTION_RESUME_BOOTSTRAP                     = SYNTHETIC_REAL_COMPOSITION_PROVEN
 *   UPSTREAM_BEHAVIORAL_REPLAY                      = NOT_FULLY_DISCRIMINATED
 *   C3_ABORT_RESULT_SEMANTICS                       = SYNTHETIC
 *
 * The QPSR03 discriminator collapses the upstream #12975 question to
 * one specific causal hypothesis (loss of completed tool-result blocks
 * during Stop → history reload → fresh session bootstrap). A GREEN on
 * this discriminator rules out that hypothesis at this seam. It does
 * NOT prove that a real provider cannot choose to replay given a
 * preserved history (framing, span selection, salience, reconstructed
 * user turns — none of which this test exercises). The QPSR03
 * discriminator is necessary, not sufficient, for the global
 * "upstream defect absent at this fork" claim.
 *
 * Production seam under test (LocalRuntimeHost, sdk/packages/core):
 *   runTurn(input) → if delivery="queue" → pendingPromptsController.enqueue
 *     → executeTurn → executeAgentTurn → session.agent.run/.continue
 *   abort(sessionId, reason) — line 1077
 *     → session.aborting = true
 *     → if drainingPendingPrompts → pendingPromptsController.discardQueue
 *     → session.agent.abort(reason)
 *     → completeAbortedInteractiveTurn → persistSessionMessages
 *
 * Classification outcomes for QPSR02_REAL_COMPOSITION:
 *   PASS: HALT_RED_NOT_REPRODUCED — C1/C2 not re-executed, transcript intact
 *   RED : CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST — C1/C2 re-executed
 *
 * This file is BRIDGE-ONLY. It runs under
 *   apps/vscode/vitest.config.c2-4-c-bridge.ts
 * (NOT the base apps/vscode/vitest.config.ts).
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentRuntime } from "@cline/agents"
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentResult,
	AgentTool,
	BasicLogger,
	ToolApprovalRequest,
} from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { SessionRuntime } from "@cline-internal/core/runtime/orchestration/session-runtime-orchestrator"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const distinctId = "act-qpsr01"

// ---------------------------------------------------------------------------
// Synthetic stub agent. Counter-backed run/continue so we can prove no
// extra invocations happen after restoreSession.
// ---------------------------------------------------------------------------

function makeAgentStub() {
	let running = false
	const run = vi.fn(async (): Promise<AgentResult> => {
		running = true
		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))
		running = false
		return makeResult()
	})
	const continueFn = vi.fn(async (): Promise<AgentResult> => {
		running = true
		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))
		running = false
		return makeResult()
	})
	const abortFn = vi.fn(() => {
		running = false
	})
	const canStartRun = vi.fn(() => !running)
	const agent = {
		run,
		continue: continueFn,
		canStartRun,
		abort: abortFn,
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		subscribeRecoveryStateChange: vi.fn().mockReturnValue(() => {}),
		getAgentId: vi.fn().mockReturnValue("agent-qpsr01"),
		getConversationId: vi.fn().mockReturnValue("conv-qpsr01"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	return { agent, run, continueFn, abortFn, canStartRun }
}

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		finishReason: "completed",
		text: "",
		usage: {
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		durationMs: 1,
		iterations: 1,
		model: { id: "mock-model", provider: "mock-provider" },
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:01.000Z"),
		...overrides,
	}
}

function makeSessionServiceMock() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest.json",
			messagesPath: "/tmp/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-qpsr01",
				source: "vscode",
				pid: process.pid,
				started_at: "2026-01-01T00:00:00.000Z",
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
				messages_path: "/tmp/messages.json",
			},
		}),
		persistSessionMessages: vi.fn().mockResolvedValue(undefined),
		updateSessionStatus: vi.fn().mockResolvedValue({
			updated: true,
			endedAt: "2026-01-01T00:00:05.000Z",
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

async function makeHost() {
	const sessionService = makeSessionServiceMock()
	const runtimeBuilder = makeRuntimeBuilderStub()
	const { agent, run, continueFn, abortFn, canStartRun } = makeAgentStub()
	const host = new LocalRuntimeHost({
		distinctId,
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => agent as never,
		logger: makeLoggerStub(),
	})
	return { host, sessionService, run, continueFn, abortFn, canStartRun }
}

function makeStartConfig(sessionId: string) {
	return {
		sessionId,
		providerId: "mock-provider",
		modelId: "mock-model",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		systemPrompt: "test",
		mode: "act" as const,
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
	}
}

// Wait until the SUM of run + continue invocations reaches `expected`.
// After P1, session.started is true and subsequent turns enter via
// agent.continue(...) rather than agent.run(...) — so we track both.
async function waitForAnyAgentCall(
	runSpy: { mock: { calls: { length: number } } },
	continueSpy: { mock: { calls: { length: number } } },
	expected: number,
	deadlineMs = 5000,
): Promise<void> {
	const start = Date.now()
	const totalCalls = () => runSpy.mock.calls.length + continueSpy.mock.calls.length
	while (totalCalls() < expected) {
		if (Date.now() - start > deadlineMs) {
			throw new Error(
				`waitForAnyAgentCall: expected ${expected} (run+continue) calls within ${deadlineMs}ms; got ${totalCalls()} (run=${runSpy.mock.calls.length}, continue=${continueSpy.mock.calls.length})`,
			)
		}
		await new Promise((resolve) => setImmediate(resolve))
	}
	await new Promise((resolve) => setImmediate(resolve))
}

// Wait until the agent's `running` flag is false, indicating the
// current turn has settled. Used to assert that session.status
// transitions back to "idle" after a turn completes.
async function waitForIdle(canStartRunSpy: () => boolean, deadlineMs = 5000): Promise<void> {
	const start = Date.now()
	while (!canStartRunSpy()) {
		if (Date.now() - start > deadlineMs) {
			throw new Error(`waitForIdle: agent did not reach idle within ${deadlineMs}ms; canStartRun=${canStartRunSpy()}`)
		}
		await new Promise((resolve) => setImmediate(resolve))
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 / QPSR01", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "act-qpsr01-"))
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

	// -----------------------------------------------------------------------
	// QPSR01_CTL01 — baseline: normal uninterrupted queue drain.
	// -----------------------------------------------------------------------
	it("QPSR01_CTL01: uninterrupted queue drain runs each prompt exactly once", async () => {
		const sessionId = "sess-qpsr01-ctl01"
		const { host, run, continueFn, canStartRun } = await makeHost()
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(sessionId),
			})

			// P1: first turn.
			const p1 = await host.runTurn({
				sessionId,
				prompt: "P1: do the first task",
			})
			expect(p1?.finishReason).toBe("completed")
			expect(run).toHaveBeenCalledTimes(1)

			// P2: enqueue via delivery="queue". runTurn returns
			// undefined because the host's runTurn immediately
			// enqueues for the queue path (line 1011-1019). The
			// microtask drain then fires run() for the shifted P2.
			const p2 = await host.runTurn({
				sessionId,
				prompt: "P2: queued successor",
				delivery: "queue",
			})
			expect(p2).toBeUndefined()

			// Wait for the drain to fire. After P1, session.started
			// is true, so the second executeAgentTurn calls
			// session.agent.continue(...) (not session.agent.run()).
			await waitForAnyAgentCall(run, continueFn, 2)
			expect(continueFn).toHaveBeenCalledTimes(1)

			// Wait for the second turn to settle (canStartRun=true
			// means the agent is idle, not running).
			await waitForIdle(canStartRun)

			const queue = await host.pendingPrompts.list({ sessionId })
			expect(queue).toEqual([])

			const session = await host.getSession(sessionId)
			expect(session?.status).toBe("idle")
		} finally {
			await host.dispose()
		}
	})

	// -----------------------------------------------------------------------
	// QPSR01_PRIMARY — the upstream chronology from ACT §3.
	// -----------------------------------------------------------------------
	it("QPSR01_PRIMARY: Stop after P2 drain + Resume does not replay agent turns", async () => {
		const sessionId = "sess-qpsr01-primary"
		const { host, run, continueFn, abortFn, canStartRun } = await makeHost()
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(sessionId),
			})

			// P1: first turn.
			const p1 = await host.runTurn({
				sessionId,
				prompt: "P1: do the first task",
			})
			expect(p1?.finishReason).toBe("completed")
			expect(run).toHaveBeenCalledTimes(1)
			expect(continueFn).toHaveBeenCalledTimes(0)

			// P2: queued with delivery="queue". The host enqueues P2
			// and the microtask drain fires, calling agent.continue()
			// (since session.started is true after P1) via the queue's
			// deps.send → runTurn.
			const p2 = await host.runTurn({
				sessionId,
				prompt: "P2: queued successor",
				delivery: "queue",
			})
			expect(p2).toBeUndefined()

			// Wait for the drain to fire continue() for the shifted
			// P2. The upstream chronology places the user's Stop
			// AFTER P2 begins processing — so this is the exact window
			// we want to land in.
			await waitForAnyAgentCall(run, continueFn, 2)
			expect(continueFn).toHaveBeenCalledTimes(1)

			// Snapshot the queue length at this point — P2 has been
			// shifted off the queue, so it should be empty.
			const queueBeforeStop = await host.pendingPrompts.list({ sessionId })
			expect(queueBeforeStop).toEqual([])

			// Stop: drive the abort through the host seam.
			await host.abort(sessionId, "user-pressed-stop")

			// abort() should have reached the agent exactly once.
			expect(abortFn).toHaveBeenCalledTimes(1)
			expect(run).toHaveBeenCalledTimes(1)
			expect(continueFn).toHaveBeenCalledTimes(1)

			// Post-abort, the host should have a coherent state:
			// no orphan pendingPrompts, no extra agent calls, and
			// the agent can start a fresh turn (resumability).
			await waitForIdle(canStartRun)

			const postAbortQueue = await host.pendingPrompts.list({ sessionId })
			expect(postAbortQueue).toEqual([])
			expect(run).toHaveBeenCalledTimes(1)
			expect(continueFn).toHaveBeenCalledTimes(1)
		} finally {
			await host.dispose()
		}
	})

	// -----------------------------------------------------------------------
	// QPSR01_CTL02 — Stop/Resume with NO queued prompt.
	// -----------------------------------------------------------------------
	it("QPSR01_CTL02: Stop/Resume without a queued prompt does not replay", async () => {
		const sessionId = "sess-qpsr01-ctl02"
		const { host, run, continueFn, canStartRun } = await makeHost()
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(sessionId),
			})

			const p1 = await host.runTurn({
				sessionId,
				prompt: "P1 only",
			})
			expect(p1?.finishReason).toBe("completed")
			expect(run).toHaveBeenCalledTimes(1)

			await host.abort(sessionId, "user-pressed-stop")

			// Post-abort, the host should have a coherent state and
			// the agent should be idle (not replaying anything).
			await waitForIdle(canStartRun)

			const postAbortQueue = await host.pendingPrompts.list({ sessionId })
			expect(postAbortQueue).toEqual([])
			expect(run).toHaveBeenCalledTimes(1)
			expect(continueFn).toHaveBeenCalledTimes(0)
		} finally {
			await host.dispose()
		}
	})
})

// ===========================================================================
// ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 / QPSR02_REAL_COMPOSITION
// ===========================================================================
//
// Real composition discriminator for upstream `cline/cline#12975`.
//
// Production seam composition:
//   REAL:
//     LocalRuntimeHost (via @cline-internal/core bridge alias)
//     SessionRuntime orchestrator (via @cline-internal/core bridge alias)
//     AgentRuntime (via @cline/agents)
//     FileSessionService (via @cline-internal/core bridge alias)
//     ConversationStore (SessionRuntime's internal transcript store)
//
//   SYNTHETIC_REAL:
//     scripted StepModel — emits tool-call-delta or text-delta events
//       and INSPECTS the messages array on each request so it can be
//       data-dependent on whether prior tool results are present
//       (this is what makes a transcript-restore defect observable)
//     counter-backed AgentTool.execute() for run_c1, run_c2, run_c3
//       (counter is incremented on each invocation; the discriminator
//        is whether c1Count > 1 or c2Count > 1 after Resume)
//     requestToolApproval = approve-all (replaces VS Code approval UI)
//
//   NOT_EXERCISED:
//     VS Code approval UI
//     real LLM provider
//     CLI/desktop-app sidecar paths
//     the checkpoint / restoreSession path (production Resume in VS Code
//       uses startSession({ sessionId, prompt }) on the LIVE session,
//       NOT restoreSession — restoreSession is only used by
//       editMessageAndRegenerate)
//
// Chronology (per recon §15):
//   T1  runTurn P1 → C1 → C2 → text → completed
//       ConversationStore accumulates: [user-P1, asst(C1), tool(C1_result),
//                                       asst(C2), tool(C2_result), asst-text]
//   T2  runTurn P2 with delivery="queue" → enqueued → drain fires agent.continue
//       → model emits tool-call-delta for C3 → C3.execute() fires
//   T3  host.abort() → abort reaches agent exactly once → status="idle"
//   T4  runTurn P2_REATTEMPT (RESUME) → agent re-enters with the
//       ConversationStore still holding the T1 transcript
//       StepModel INSPECTS messages:
//         if (tool-result for C1 exists AND tool-result for C2 exists):
//           emit text-delta "Continuing with prior context" finish:stop
//           (no replay — transcript is intact)
//         else:
//           emit tool-call-delta for c1-replay → c1.execute() fires
//           (replay reproduced — transcript was lost / corrupted)
//   T5  Assertions:
//       expect(c1Count).toBe(1)
//       expect(c2Count).toBe(1)
//       conversation store contains the full T1 transcript
// ===========================================================================

interface RunCounters {
	c1Count: number
	c2Count: number
	c3Count: number
}

// Synthetic_real scripted AgentModel that INSPECTS the messages array
// to decide what to emit. Same pattern as the SHRC01 step model so the
// two ACTs share their model-adapter shape.
class StepModel implements AgentModel {
	readonly requests: AgentModelRequest[] = []
	constructor(
		private readonly steps: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>>,
	) {}
	async stream(request: AgentModelRequest): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request)
		const step = this.steps.shift()
		if (!step) throw new Error("No more scripted model steps available")
		const events = step(request)
		return (async function* () {
			for await (const ev of events) yield ev
		})()
	}
}

// Counter-backed synthetic_real AgentTools. Each tool's `execute()`
// increments its dedicated counter on the shared `RunCounters` object.
// The discriminator for the upstream defect is whether the count for
// run_c1 or run_c2 exceeds 1 after Resume — a single execution during
// P1 + an additional execution after Resume means the transcript was
// lost and the model is replaying the already-completed work.
function makeRunCommandsTool(
	name: "run_c1" | "run_c2" | "run_c3",
	counters: RunCounters,
	commands: string[],
): AgentTool<{ commands: string[] }, Array<{ result: string; success: true }>> {
	const toolKey = name
	const counterKey: keyof RunCounters = name === "run_c1" ? "c1Count" : name === "run_c2" ? "c2Count" : "c3Count"
	return {
		name: toolKey,
		description: `synthetic_real ${name}-shaped AgentTool; executor increments ${counterKey} on each invocation.`,
		inputSchema: {
			type: "object",
			properties: { commands: { type: "array", items: { type: "string" } } },
			required: ["commands"],
			additionalProperties: false,
		} as never,
		async execute(_input) {
			counters[counterKey]++
			return commands.map((c) => ({ result: `executed:${c}`, success: true as const }))
		},
	}
}

function hasToolResultForCall(request: AgentModelRequest, toolCallId: string): boolean {
	for (const message of request.messages) {
		if (message.role !== "tool") continue
		const content = (message as AgentMessage).content
		if (!Array.isArray(content)) continue
		for (const block of content) {
			if (
				block &&
				typeof block === "object" &&
				"type" in block &&
				(block as { type: unknown }).type === "tool-result" &&
				(block as { toolCallId?: unknown }).toolCallId === toolCallId
			) {
				return true
			}
		}
	}
	return false
}

// Build the resume-model: P1 emits C1 then C2 then text, P2 emits C3,
// Resume inspects transcript and emits text continuation if both C1 and
// C2 results are present, otherwise replays C1 (the upstream-defect shape).
function makeResumeModel(): StepModel {
	const stepDefs: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent>> = []

	stepDefs.push(() => [
		{
			type: "tool-call-delta",
			toolCallId: "qpsr-c1",
			toolName: "run_c1",
			inputText: JSON.stringify({ commands: ["echo C1"] }),
		},
		{ type: "finish", reason: "tool-calls" },
	])

	stepDefs.push(() => [
		{
			type: "tool-call-delta",
			toolCallId: "qpsr-c2",
			toolName: "run_c2",
			inputText: JSON.stringify({ commands: ["echo C2"] }),
		},
		{ type: "finish", reason: "tool-calls" },
	])

	stepDefs.push(() => [
		{ type: "text-delta", text: "P1 complete." },
		{ type: "finish", reason: "stop" },
	])

	stepDefs.push(() => [
		{
			type: "tool-call-delta",
			toolCallId: "qpsr-c3",
			toolName: "run_c3",
			inputText: JSON.stringify({ commands: ["echo C3"] }),
		},
		{ type: "finish", reason: "tool-calls" },
	])

	// Step 5: safety terminal stop after C3 (only fires if abort races after C3 finishes).
	stepDefs.push(() => [
		{ type: "text-delta", text: "P2 complete." },
		{ type: "finish", reason: "stop" },
	])

	// Step 6 (RESUME): INSPECT the messages array.
	stepDefs.push((request) => {
		const hasC1Result = hasToolResultForCall(request, "qpsr-c1")
		const hasC2Result = hasToolResultForCall(request, "qpsr-c2")
		if (hasC1Result && hasC2Result) {
			return [
				{ type: "text-delta", text: "Continuing P2 with prior context." },
				{ type: "finish", reason: "stop" },
			]
		}
		return [
			{
				type: "tool-call-delta",
				toolCallId: "qpsr-c1-replay",
				toolName: "run_c1",
				inputText: JSON.stringify({ commands: ["echo C1-replay"] }),
			},
			{ type: "finish", reason: "tool-calls" },
		]
	})

	// Step 7: terminal stop after resume.
	stepDefs.push(() => [
		{ type: "text-delta", text: "Resume complete." },
		{ type: "finish", reason: "stop" },
	])

	return new StepModel(stepDefs)
}

async function buildComposedQpsrHost(opts: { isolationDir: string; counters: RunCounters }): Promise<LocalRuntimeHost> {
	const { isolationDir, counters } = opts

	const c1 = makeRunCommandsTool("run_c1", counters, ["echo C1-from-test"])
	const c2 = makeRunCommandsTool("run_c2", counters, ["echo C2-from-test"])
	const c3 = makeRunCommandsTool("run_c3", counters, ["echo C3-from-test"])

	const model = makeResumeModel()

	const requestToolApproval = async (_req: ToolApprovalRequest) => {
		return { approved: true }
	}

	const runtimeBuilder = {
		build: async () => ({
			tools: [],
			shutdown: () => Promise.resolve(),
		}),
	}

	const createAgent: NonNullable<ConstructorParameters<typeof LocalRuntimeHost>[0]["createAgent"]> = (config) => {
		return new SessionRuntime(config, {
			createAgentRuntimeImpl: (runtimeConfig) => {
				return new AgentRuntime({
					...runtimeConfig,
					model,
					tools: [c1, c2, c3],
					toolPolicies: {
						run_c1: { autoApprove: false },
						run_c2: { autoApprove: false },
						run_c3: { autoApprove: false },
					},
					requestToolApproval,
				})
			},
		})
	}

	return new LocalRuntimeHost({
		distinctId: "act-qpsr02-real-composition",
		sessionService: new FileSessionService(join(isolationDir, "sessions")),
		runtimeBuilder: runtimeBuilder as never,
		createAgent,
	})
}

async function makeQpsrStartConfig(sessionId: string, isolationDir: string) {
	return {
		sessionId,
		providerId: "anthropic",
		modelId: "claude-3-5-sonnet",
		apiKey: "test-api-key-placeholder",
		systemPrompt: "You are a test agent for QPSR02 composition.",
		cwd: isolationDir,
		mode: "act" as const,
		enableTools: false,
		enableSpawnAgent: false,
		enableAgentTeams: false,
	}
}

// Wait until a counter reaches `target` (or throw on timeout).
async function waitForCounter(counters: RunCounters, key: keyof RunCounters, target: number, deadlineMs: number): Promise<void> {
	const start = Date.now()
	while (counters[key] < target) {
		if (Date.now() - start > deadlineMs) {
			throw new Error(`waitForCounter: expected ${key} to reach ${target} within ${deadlineMs}ms; actual=${counters[key]}`)
		}
		await new Promise((resolve) => setImmediate(resolve))
	}
}

// Wait until the host session transitions out of "running" status.
async function waitForSessionIdle(host: LocalRuntimeHost, sessionId: string, deadlineMs: number): Promise<void> {
	const start = Date.now()
	while (true) {
		const session = await host.getSession(sessionId)
		if (session?.status === "idle") return
		if (Date.now() - start > deadlineMs) {
			throw new Error(
				`waitForSessionIdle: session ${sessionId} did not reach idle within ${deadlineMs}ms; status=${session?.status}`,
			)
		}
		await new Promise((resolve) => setImmediate(resolve))
	}
}

describe("ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 / QPSR02_REAL_COMPOSITION", () => {
	let isolationDir = ""
	let host: LocalRuntimeHost | undefined

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "qpsr02-real-composition-"))
	})

	afterEach(async () => {
		if (host) {
			try {
				await host.dispose()
			} catch {
				/* dispose on a never-started host is fine */
			}
			host = undefined
		}
		if (isolationDir && existsSync(isolationDir)) {
			rmSync(isolationDir, { recursive: true, force: true })
		}
	})

	// -----------------------------------------------------------------
	// QPSR02_REAL_COMPOSITION — Stop/Resume through the real
	// LocalRuntimeHost + SessionRuntime + AgentRuntime composition.
	//
	// The discriminator for upstream `cline/cline#12975`:
	//   c1Count === 1 && c2Count === 1 → no replay (defect not present)
	//   c1Count >  1 || c2Count >  1 → replay reproduced
	//
	// The StepModel inspects the messages array on the post-Resume call:
	//   if both prior tool results are visible → emit text continuation
	//   otherwise → emit a C1 replay tool-call (the upstream-defect shape)
	// -----------------------------------------------------------------
	it("QPSR02_REAL_COMPOSITION: Resume after Stop does not replay already-completed C1/C2", async () => {
		const sessionId = "qpsr02-real-composition"
		const counters: RunCounters = { c1Count: 0, c2Count: 0, c3Count: 0 }
		host = await buildComposedQpsrHost({ isolationDir, counters })

		// T0: startSession.
		await host.startSession({
			source: "vscode",
			interactive: true,
			config: await makeQpsrStartConfig(sessionId, isolationDir),
		})

		// T1: P1 — first turn. The model emits C1, then C2, then text.
		const p1 = await host.runTurn({
			sessionId,
			prompt: "P1: please run C1 and C2",
		})
		expect(p1?.finishReason).toBe("completed")
		expect(counters.c1Count).toBe(1)
		expect(counters.c2Count).toBe(1)

		// T2: P2 — queued. Drain fires C3.execute().
		await host.runTurn({
			sessionId,
			prompt: "P2: please run C3",
			delivery: "queue",
		})
		await waitForCounter(counters, "c3Count", 1, 10_000)

		// T3: Stop — drive the abort through the host seam.
		await host.abort(sessionId, "user-pressed-stop")

		// Wait for the abort finalization to settle. The host runs
		// completeAbortedInteractiveTurn asynchronously after abort(),
		// which transitions status from "running" to "idle".
		await waitForSessionIdle(host, sessionId, 10_000)
		const postAbort = await host.getSession(sessionId)
		expect(postAbort?.status).toBe("idle")

		// T4: RESUME — call runTurn with a new prompt. This is the
		// upstream-chronology "Resume" gesture on the live session.
		const resume = await host.runTurn({
			sessionId,
			prompt: "Resume P2",
		})

		// T5: Assertions — the load-bearing discriminator.
		expect(resume?.finishReason).toBe("completed")
		expect(counters.c1Count).toBe(1)
		expect(counters.c2Count).toBe(1)

		const finalState = {
			c1Count: counters.c1Count,
			c2Count: counters.c2Count,
			c3Count: counters.c3Count,
			finishReason: resume?.finishReason,
			classification:
				counters.c1Count === 1 && counters.c2Count === 1
					? "QPSR02 preliminary control PASS — transcript intact at simplified live-session Resume seam (real composition proven; production Resume entrypoint deferred to QPSR03)"
					: "CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST — defect reproduced",
		}
		// eslint-disable-next-line no-console
		console.log("[QPSR02_REAL_COMPOSITION final state]", JSON.stringify(finalState, null, 2))
	})

	// -----------------------------------------------------------------
	// QPSR02_SANITY — bridge aliases resolve to the real production
	// classes. This is the package_pin: the bridge does NOT substitute
	// hand-rolled shims.
	// -----------------------------------------------------------------
	it("QPSR02_SANITY: bridge aliases resolve to real LocalRuntimeHost, real SessionRuntime, real AgentRuntime, real FileSessionService", () => {
		const probe = new LocalRuntimeHost({
			distinctId: "qpsr02-sanity",
			sessionService: new FileSessionService(join(tmpdir(), "qpsr02-sanity-sessions")),
			runtimeBuilder: { build: async () => ({ tools: [], shutdown: () => Promise.resolve() }) } as never,
		})
		const hostProto = Object.getPrototypeOf(probe) as Record<string, unknown>
		const hostMethodNames = Object.getOwnPropertyNames(hostProto)
		expect(hostMethodNames).toContain("runTurn")
		expect(hostMethodNames).toContain("startSession")
		expect(hostMethodNames).toContain("getSession")
		expect(hostMethodNames).toContain("abort")
		expect(hostMethodNames).toContain("dispose")

		const sessionProbe = new SessionRuntime(
			{
				providerId: "anthropic",
				modelId: "claude-3-5-sonnet",
				apiKey: "test-api-key-placeholder",
				systemPrompt: "test",
				tools: [],
			} as never,
			{},
		)
		const sessionProto = Object.getPrototypeOf(sessionProbe) as Record<string, unknown>
		const sessionMethodNames = Object.getOwnPropertyNames(sessionProto)
		expect(sessionMethodNames).toContain("run")
		expect(sessionMethodNames).toContain("continue")
		expect(sessionMethodNames).toContain("canStartRun")

		const runtimeProbe = new AgentRuntime({
			model: new StepModel([() => [{ type: "finish", reason: "stop" }]]),
			tools: [],
		})
		const runtimeProto = Object.getPrototypeOf(runtimeProbe) as Record<string, unknown>
		const runtimeMethodNames = Object.getOwnPropertyNames(runtimeProto)
		expect(runtimeMethodNames).toContain("run")
		expect(runtimeMethodNames).toContain("continue")
		expect(runtimeMethodNames).toContain("abort")

		const svc = new FileSessionService(join(tmpdir(), "qpsr02-sanity-svc"))
		expect(svc).toBeDefined()
		expect(typeof (svc as unknown as Record<string, unknown>).ensureSessionsDir).toBe("function")
	})
})

// ===========================================================================
// ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 / QPSR03_PRODUCTION_CHRONOLOGY
// ===========================================================================
//
// Third discriminator for upstream `cline/cline#12975`.
//
// What QPSR02 left unproven (per Factory reviewer disposition):
//
//   P0 #1 — P2 was submitted ONLY AFTER P1 finished, so the
//           `delivery: "queue"` label never had to exercise the
//           genuine queue path (P1 was idle, canStartRun() === true,
//           and the explicit `delivery:"queue"` was the only thing
//           driving the enqueue). The recon §15 chronology requires
//           P2 to be submitted WHILE P1 IS STILL EXECUTING.
//
//   P0 #2 — Resume was driven via `host.runTurn({sessionId, prompt})`
//           on the LIVE session. Production Resume is in fact two
//           steps (per `SdkFollowupCoordinator.resumeSessionFromTask`):
//
//             (1) `prepareTaskResumeStartInput(opts, taskId)` reads
//                 the persisted transcript via
//                 `SdkSessionHistoryLoader.loadInitialMessages(...)`.
//             (2) `sessions.startNewSession({ ...resumeStart, interactive: true })`
//                 re-bootstraps the session with `initialMessages`.
//             (3) `fireAndForgetSend(sdkHost, sessionId, prompt)` then
//                 calls `sdkHost.send` → `host.runTurn`.
//
//           QPSR02 silently bypassed step (1) and step (2).
//
// QPSR03 fixes both P0s with four explicit witnesses:
//
//   Witness #1 — P1 is provably active when P2 is submitted
//   Witness #2 — P2 enqueue is observed via the host event surface
//                (not inferred from the delivery label)
//   Witness #3 — P2 drain is observed via `pending_prompt_submitted`
//                AFTER P1 finishes, and C3 has begun executing
//   Witness #4 — Resume enters through the PRODUCTION entrypoint:
//                readMessages → fresh-host startSession(initialMessages)
//                → runTurn (mirrors SdkFollowupCoordinator + startNewSession
//                + fireAndForgetSend exactly)
//
// Tool deferral: C3 is wrapped in a deferred executor (release signal)
// so the test can deterministically observe Stop landing WHILE C3 is
// the current tool. QPSR02 waited for c3Count===1, which proves C3 had
// already executed; QPSR03 instead waits for C3's executor entry
// WITHOUT releasing it, so the upstream Stop can land at the exact
// same tool-active boundary the issue describes.
//
// Discriminators:
//   c1Count === 1  (C1 never re-executed after Resume)
//   c2Count === 1  (C2 never re-executed after Resume)
//   c3Count >= 1   (C3 was current when Stop occurred)
//   pending_prompts event count for P2 === 1
//   pending_prompt_submitted event count for P2 === 1
//
// Classification:
//   HALT_RED_NOT_REPRODUCED — same name as QPSR02, but with the
//     load-bearing seam proven:
//       (a) P2 actually entered the queue under the upstream
//           chronology, not just by force-labeling the delivery;
//       (b) Resume was driven through the production
//           startSession-with-history bootstrap.
//
// This file is BRIDGE-ONLY. It runs under
//   apps/vscode/vitest.config.c2-4-c-bridge.ts
// (NOT the base apps/vscode/vitest.config.ts).
// ===========================================================================

interface PendingPromptObserved {
	type: "pending_prompts" | "pending_prompt_submitted" | "status"
	promptText?: string
	promptDelivery?: string
	status?: string
}

// ---------------------------------------------------------------------------
// Resume-model for QPSR03. P1 emits C1 then C2 then text. P2 emits C3
// then text. The Resume step (consumed by the SECOND host) inspects
// messages — if both C1/C2 tool results are visible, emit a text
// continuation; else emit a C1-replay (the upstream-defect shape).
// ---------------------------------------------------------------------------
function makeResumeModelForQpsr03(): StepModel {
	return makeResumeStepModel(/* skipFirstSteps= */ 0)
}

// ---------------------------------------------------------------------------
// Resume-only StepModel for the SECOND host. By skipping the
// pre-resume steps, this model behaves as if the prior P1/P2 turns
// had ALREADY been emitted. The very first step it emits is the
// resume-inspection step that decides text vs. replay based on
// the messages array passed to it (which includes the initialMessages
// from the first host's readLiveSessionMessages).
// ---------------------------------------------------------------------------
function makeResumeOnlyStepModel(): StepModel {
	return makeResumeStepModel(/* skipFirstSteps= */ 5)
}

function makeResumeStepModel(skipFirstSteps: number): StepModel {
	const stepDefs: Array<(request: AgentModelRequest) => Iterable<AgentModelEvent>> = []

	// T1 turn 1: C1
	stepDefs.push(() => [
		{
			type: "tool-call-delta",
			toolCallId: "qpsr03-c1",
			toolName: "run_c1",
			inputText: JSON.stringify({ commands: ["echo C1"] }),
		},
		{ type: "finish", reason: "tool-calls" },
	])

	// T1 turn 2: C2
	stepDefs.push(() => [
		{
			type: "tool-call-delta",
			toolCallId: "qpsr03-c2",
			toolName: "run_c2",
			inputText: JSON.stringify({ commands: ["echo C2"] }),
		},
		{ type: "finish", reason: "tool-calls" },
	])

	// T1 turn 3: text completion
	stepDefs.push(() => [
		{ type: "text-delta", text: "P1 complete." },
		{ type: "finish", reason: "stop" },
	])

	// T2 turn 1 (the QUEUED P2): C3
	stepDefs.push(() => [
		{
			type: "tool-call-delta",
			toolCallId: "qpsr03-c3",
			toolName: "run_c3",
			inputText: JSON.stringify({ commands: ["echo C3"] }),
		},
		{ type: "finish", reason: "tool-calls" },
	])

	// T2 turn 2: terminal text (only fires if Resume releases C3 first)
	stepDefs.push(() => [
		{ type: "text-delta", text: "P2 complete (would not fire in QPSR03 because Stop lands first)." },
		{ type: "finish", reason: "stop" },
	])

	// T4 RESUME turn 1: inspect messages
	stepDefs.push((request) => {
		const hasC1Result = hasToolResultForCall(request, "qpsr03-c1")
		const hasC2Result = hasToolResultForCall(request, "qpsr03-c2")
		if (hasC1Result && hasC2Result) {
			return [
				{ type: "text-delta", text: "Continuing P2 with prior context." },
				{ type: "finish", reason: "stop" },
			]
		}
		return [
			{
				type: "tool-call-delta",
				toolCallId: "qpsr03-c1-replay",
				toolName: "run_c1",
				inputText: JSON.stringify({ commands: ["echo C1-replay"] }),
			},
			{ type: "finish", reason: "tool-calls" },
		]
	})

	// Skip the first `skipFirstSteps` steps so the second host can
	// reuse the same step-scripted semantics without re-emitting the
	// pre-resume tool calls. The remaining step (index skipFirstSteps)
	// is the resume-inspection step.
	if (skipFirstSteps > 0) {
		return new StepModel(stepDefs.slice(skipFirstSteps))
	}
	return new StepModel(stepDefs)
}

// ---------------------------------------------------------------------------
// Build the composed host for QPSR03. C3 is deferred so we can Stop
// mid-tool. C1 and C2 are normal counter-backed executors.
// `c3Release` is exposed to the test via a slot on the returned host
// (`host._pendingC3Release`). The test calls it ONLY if it needs to
// let the in-flight C3 complete (e.g. before disposing the host).
// ---------------------------------------------------------------------------
async function buildComposedQpsr03Host(opts: {
	isolationDir: string
	counters: RunCounters
	onC3Enter: () => void
}): Promise<LocalRuntimeHost> {
	const { isolationDir, counters, onC3Enter } = opts

	const c1 = makeRunCommandsTool("run_c1", counters, ["echo C1-from-test"])
	const c2 = makeRunCommandsTool("run_c2", counters, ["echo C2-from-test"])

	// Deferred C3: increment the counter, signal entry, and wait for
	// a release promise before returning.
	let releaseGate: (() => void) | undefined
	const gate = new Promise<void>((resolve) => {
		releaseGate = resolve
	})
	let entered = false
	const c3: AgentTool<{ commands: string[] }, Array<{ result: string; success: true }>> = {
		name: "run_c3",
		description:
			"synthetic_real deferred run_c3-shaped AgentTool; executor waits for release() or abort signal before returning. SEMANTIC NOTE: this tool's executor returns success:true on either path — it does NOT throw on abort. The abort signal unblocks the gate so the executor returns quickly, but the production executeTurn-throw-→-completeAbortedInteractiveTurn path is NOT faithfully reproduced. What IS reproduced: (a) C3 executor entered (c3Count >= 1), (b) Stop landed before release, (c) host.abort() drove session.status to 'idle' via the real LocalRuntimeHost.completeAbortedInteractiveTurn path.",
		inputSchema: {
			type: "object",
			properties: { commands: { type: "array", items: { type: "string" } } },
			required: ["commands"],
			additionalProperties: false,
		} as never,
		async execute(input, context) {
			counters.c3Count++
			if (!entered) {
				entered = true
				onC3Enter()
			}
			// Race the release promise against the abort signal so the
			// upstream `agent.abort()` (driven by host.abort()) unblocks
			// the gate. Whichever wins first resolves the race and the
			// executor returns success:true (NOT throwing — see SEMANTIC
			// NOTE in the description above).
			const signal = context?.signal
			if (signal) {
				await Promise.race([
					gate,
					new Promise<void>((resolve) => {
						if (signal.aborted) {
							resolve()
							return
						}
						signal.addEventListener("abort", () => resolve(), { once: true })
					}),
				])
			} else {
				await gate
			}
			return input.commands.map((c) => ({ result: `executed:${c}`, success: true as const }))
		},
	}
	const c3Release = (): void => {
		releaseGate?.()
		releaseGate = undefined
	}

	const model = makeResumeModelForQpsr03()
	const requestToolApproval = async (_req: ToolApprovalRequest) => {
		return { approved: true }
	}

	const runtimeBuilder = {
		build: async () => ({
			tools: [],
			shutdown: () => Promise.resolve(),
		}),
	}

	const createAgent: NonNullable<ConstructorParameters<typeof LocalRuntimeHost>[0]["createAgent"]> = (config) => {
		return new SessionRuntime(config, {
			createAgentRuntimeImpl: (runtimeConfig) => {
				return new AgentRuntime({
					...runtimeConfig,
					model,
					tools: [c1, c2, c3],
					toolPolicies: {
						run_c1: { autoApprove: false },
						run_c2: { autoApprove: false },
						run_c3: { autoApprove: false },
					},
					requestToolApproval,
				})
			},
		})
	}

	const host = new LocalRuntimeHost({
		distinctId: "act-qpsr03-production-chronology",
		sessionService: new FileSessionService(join(isolationDir, "sessions")),
		runtimeBuilder: runtimeBuilder as never,
		createAgent,
	})
	// expose the release closure so the test can settle the in-flight
	// C3 execute() before disposing the host.
	;(host as unknown as { _pendingC3Release?: () => void })._pendingC3Release = c3Release
	return host
}

// ---------------------------------------------------------------------------
// Wait for a counter to reach at least `target` or throw on timeout.
// ---------------------------------------------------------------------------
async function waitForCounterAtLeast(
	counters: RunCounters,
	key: keyof RunCounters,
	target: number,
	deadlineMs: number,
): Promise<void> {
	const start = Date.now()
	while (counters[key] < target) {
		if (Date.now() - start > deadlineMs) {
			throw new Error(
				`waitForCounterAtLeast: expected ${key} to reach at least ${target} within ${deadlineMs}ms; actual=${counters[key]}`,
			)
		}
		await new Promise((resolve) => setImmediate(resolve))
	}
}

// ---------------------------------------------------------------------------
// Wait until the host session transitions out of "running" status.
// ---------------------------------------------------------------------------
async function waitForSessionIdleQpsr03(host: LocalRuntimeHost, sessionId: string, deadlineMs: number): Promise<void> {
	const start = Date.now()
	while (true) {
		const session = await host.getSession(sessionId)
		if (session?.status === "idle") return
		if (Date.now() - start > deadlineMs) {
			throw new Error(
				`waitForSessionIdleQpsr03: session ${sessionId} did not reach idle within ${deadlineMs}ms; status=${session?.status}`,
			)
		}
		await new Promise((resolve) => setImmediate(resolve))
	}
}

describe("ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 / QPSR03_PRODUCTION_CHRONOLOGY", () => {
	let isolationDir = ""
	let firstHost: LocalRuntimeHost | undefined
	let secondHost: LocalRuntimeHost | undefined

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "qpsr03-production-chronology-"))
	})

	afterEach(async () => {
		if (firstHost) {
			const release = (firstHost as unknown as { _pendingC3Release?: () => void })._pendingC3Release
			release?.()
			try {
				await firstHost.dispose()
			} catch {
				/* dispose on an already-disposed host is fine */
			}
			firstHost = undefined
		}
		if (secondHost) {
			try {
				await secondHost.dispose()
			} catch {
				/* dispose on an already-disposed host is fine */
			}
			secondHost = undefined
		}
		if (isolationDir && existsSync(isolationDir)) {
			rmSync(isolationDir, { recursive: true, force: true })
		}
	})

	// -----------------------------------------------------------------
	// QPSR03_PRODUCTION_CHRONOLOGY — upstream-precise P0 closure.
	//
	// See the file header for the four explicit witnesses and the
	// production-Resume entrypoint mirror.
	// -----------------------------------------------------------------
	it("QPSR03_PRODUCTION_CHRONOLOGY: queued-P2 + production-Resume entrypoint leaves C1/C2 intact", async () => {
		const sessionId = "qpsr03-production-chronology"
		const counters: RunCounters = { c1Count: 0, c2Count: 0, c3Count: 0 }
		const pendingObservations: PendingPromptObserved[] = []

		let c3EnteredResolve!: () => void
		const c3EnteredPromise = new Promise<void>((resolve) => {
			c3EnteredResolve = resolve
		})
		const onC3Enter = (): void => {
			c3EnteredResolve()
		}

		firstHost = await buildComposedQpsr03Host({ isolationDir, counters, onC3Enter })
		const c3ReleaseRef = (firstHost as unknown as { _pendingC3Release?: () => void })._pendingC3Release

		// Subscribe to the host's CoreSessionEvent stream. We collect
		// every `pending_prompts`, `pending_prompt_submitted`, and
		// `status` event so we can prove:
		//   - P2 actually entered the queue (not just labeled "queue")
		//   - P2 was actually dequeued (drain fired)
		//   - Stop landed while C3 was the current tool
		const unsubscribe = firstHost.subscribe((event) => {
			if (event.type === "pending_prompts") {
				const prompts = event.payload.prompts
				for (const p of prompts) {
					pendingObservations.push({
						type: "pending_prompts",
						promptText: p.prompt,
						promptDelivery: p.delivery,
					})
				}
			} else if (event.type === "pending_prompt_submitted") {
				pendingObservations.push({
					type: "pending_prompt_submitted",
					promptText: event.payload.prompt,
					promptDelivery: event.payload.delivery,
				})
			} else if (event.type === "status") {
				pendingObservations.push({
					type: "status",
					status: event.payload.status,
				})
			}
		})

		try {
			// T0: startSession. No prompt — agent is bootstrapped idle.
			await firstHost.startSession({
				source: "vscode",
				interactive: true,
				config: await makeQpsrStartConfig(sessionId, isolationDir),
			})

			// Witness #1 prep: start P1 WITHOUT awaiting completion.
			// The promise resolves only when the entire P1 runTurn
			// chain (C1, C2, text, host.idle) completes.
			const p1Promise = firstHost.runTurn({
				sessionId,
				prompt: "P1: please run C1 and C2",
			})

			// Witness #1: P1 is provably active when we submit P2.
			// We wait for C1 to execute. Reaching c1Count === 1 means
			// the StepModel emitted its first tool-call, the approval
			// fired, and C1.execute() ran — the agent is mid-iteration
			// in the middle of the P1 turn.
			await waitForCounterAtLeast(counters, "c1Count", 1, 10_000)
			const liveSessionBeforeP2 = await firstHost.getSession(sessionId)
			expect(liveSessionBeforeP2?.status).toBe("running")

			// Witness #2: submit P2 with delivery="queue" while P1 is
			// still executing. The fact that delivery resolves to
			// "queue" can be either:
			//   (a) explicit input.delivery = "queue" (which it is),
			//   (b) implicit: interactive && !canStartRun() = "queue"
			// Either way the enqueue must happen, and we must observe
			// it via the event surface — not just trust the label.
			const p2QueuePromise = firstHost.runTurn({
				sessionId,
				prompt: "P2: please run C3",
				delivery: "queue",
			})
			expect(await p2QueuePromise).toBeUndefined()

			// The pending_prompts event fires SYNCHRONOUSLY in
			// PendingPromptsController.enqueue() at the start of the
			// runTurn that has delivery="queue". So it WILL land
			// before any drain. We require at least 1 such event.
			const p2EnqueueDeadline = Date.now() + 2_000
			while (Date.now() < p2EnqueueDeadline) {
				const observedP2InQueue = pendingObservations.some(
					(obs) =>
						obs.type === "pending_prompts" &&
						obs.promptText === "P2: please run C3" &&
						obs.promptDelivery === "queue",
				)
				if (observedP2InQueue) break
				await new Promise((resolve) => setImmediate(resolve))
			}
			const p2EnqueueObserved = pendingObservations.filter(
				(obs) =>
					obs.type === "pending_prompts" && obs.promptText === "P2: please run C3" && obs.promptDelivery === "queue",
			).length
			expect(p2EnqueueObserved).toBeGreaterThanOrEqual(1)

			// Now let P1 finish. Awaiting it triggers the queue drain
			// (canStartRun() flips true → scheduleDrain → drain →
			// runTurn → C3.execute() → deferred gate).
			await p1Promise

			// Witness #3: P2 drain is observed via pending_prompt_submitted
			// AND C3.execute() has entered.
			await c3EnteredPromise
			expect(counters.c3Count).toBeGreaterThanOrEqual(1)

			const p2DrainDeadline = Date.now() + 5_000
			while (Date.now() < p2DrainDeadline) {
				const drained = pendingObservations.some(
					(obs) =>
						obs.type === "pending_prompt_submitted" &&
						obs.promptText === "P2: please run C3" &&
						obs.promptDelivery === "queue",
				)
				if (drained) break
				await new Promise((resolve) => setImmediate(resolve))
			}
			const p2DrainCount = pendingObservations.filter(
				(obs) =>
					obs.type === "pending_prompt_submitted" &&
					obs.promptText === "P2: please run C3" &&
					obs.promptDelivery === "queue",
			).length
			expect(p2DrainCount).toBeGreaterThanOrEqual(1)

			// T3: Stop lands while C3 is the current tool. We DO NOT
			// release the C3 gate — the test's executor is sitting
			// inside C3.execute() waiting for the release promise.
			// This is the exact upstream Stop window.
			await firstHost.abort(sessionId, "user-pressed-stop")

			// Wait for the abort to settle. C3 may not have fully
			// completed (the gate is unreleased), but abort() flips
			// session.aborting and calls session.agent.abort(). The
			// host then runs completeAbortedInteractiveTurn which
			// transitions status to "idle" and persists messages.
			await waitForSessionIdleQpsr03(firstHost, sessionId, 10_000)
			const postAbort = await firstHost.getSession(sessionId)
			expect(postAbort?.status).toBe("idle")

			// Capture the discriminator before the (eventual) release.
			const preResume = {
				c1Count: counters.c1Count,
				c2Count: counters.c2Count,
				c3Count: counters.c3Count,
				p2EnqueueObserved,
				p2DrainCount,
			}
			void preResume // referenced for diagnostics only

			// Witness #4 — PRODUCTION Resume entrypoint. Mirror
			// `SdkFollowupCoordinator.resumeSessionFromTask` exactly:
			//   (a) `host.readMessages(sessionId)` mirrors
			//       `loadInitialMessages(sessionHost, taskId)`.
			//   (b) dispose the first host (mirrors `clearTaskForOperation`).
			//   (c) construct a SECOND `LocalRuntimeHost` against the
			//       SAME `FileSessionService` (mirrors the lifecycle's
			//       fresh-session bootstrap).
			//   (d) `host.startSession({ sessionId, initialMessages, ... })`
			//       on the second host (mirrors
			//       `sessions.startNewSession({...resumeStart, interactive:true})`).
			//   (e) `host.runTurn({ sessionId, prompt: "Resume P2" })`
			//       (mirrors `fireAndForgetSend(sdkHost, sessionId, prompt)`
			//       → `sdkHost.send` → `host.runTurn`).

			// (a) readMessages — production uses `readLiveMessages ??
			// readMessages` so the in-memory view wins; we use
			// `readLiveSessionMessages` which prefers the in-memory
			// conversation when the session is resident (see
			// local-runtime-host.ts:1494) and falls back to the
			// persisted file otherwise.
			const initialMessages = await firstHost.readLiveSessionMessages(sessionId)
			expect(initialMessages.length).toBeGreaterThan(0)

			// (b) dispose the first host — mirrors
			// `clearTaskForOperation` tearing down the prior session.
			// Release the C3 gate first so the in-flight execute can
			// settle and the host can fully tear down.
			c3ReleaseRef?.()
			try {
				await firstHost.dispose()
			} catch {
				/* fine */
			}
			firstHost = undefined

			// (c) construct the second host against the SAME
			// FileSessionService. This is the production-resume
			// equivalent: the lifecycle creates a fresh SdkSessionHost
			// against the shared session backend.
			const sharedSessionService = new FileSessionService(join(isolationDir, "sessions"))
			secondHost = new LocalRuntimeHost({
				distinctId: "act-qpsr03-production-chronology-resume",
				sessionService: sharedSessionService,
				runtimeBuilder: {
					build: async () => ({
						tools: [],
						shutdown: () => Promise.resolve(),
					}),
				} as never,
				// Install a fresh createAgent factory so the post-resume
				// model inspects the (now-loaded) initialMessages
				// transcript and decides text vs. replay.
				createAgent: ((config: unknown) => {
					return new SessionRuntime(config as ConstructorParameters<typeof SessionRuntime>[0], {
						createAgentRuntimeImpl: (runtimeConfig) => {
							return new AgentRuntime({
								...runtimeConfig,
								model: makeResumeOnlyStepModel(),
								tools: [
									makeRunCommandsTool("run_c1", counters, ["echo C1-resume"]),
									makeRunCommandsTool("run_c2", counters, ["echo C2-resume"]),
									makeRunCommandsTool("run_c3", counters, ["echo C3-resume"]),
								],
								toolPolicies: {
									run_c1: { autoApprove: false },
									run_c2: { autoApprove: false },
									run_c3: { autoApprove: false },
								},
								requestToolApproval: async () => ({ approved: true }),
							})
						},
					})
				}) as unknown as ConstructorParameters<typeof LocalRuntimeHost>[0]["createAgent"],
			})

			// (d) startSession on the SECOND host with the
			// initialMessages loaded from the first host. This is the
			// direct mirror of `sessions.startNewSession({...resumeStart,
			// interactive: true})`.
			await secondHost.startSession({
				source: "vscode",
				interactive: true,
				config: await makeQpsrStartConfig(sessionId, isolationDir),
				initialMessages,
			})

			// (e) runTurn on the LIVE second-host session. This is the
			// direct mirror of `fireAndForgetSend(sdkHost, sessionId, prompt)`
			// → `sdkHost.send` → `host.runTurn`.
			const resume = await secondHost.runTurn({
				sessionId,
				prompt: "Resume P2",
			})
			expect(resume?.finishReason).toBe("completed")

			// T5: Discriminators. Same shape as QPSR02 plus the new
			// upstream-chronology witnesses.
			const finalState = {
				c1Count: counters.c1Count,
				c2Count: counters.c2Count,
				c3Count: counters.c3Count,
				p2EnqueueObserved,
				p2DrainCount,
				finishReason: resume?.finishReason,
				preResume,
				classification:
					counters.c1Count === 1 && counters.c2Count === 1
						? "CASE_Q2 = NOT_REPRODUCED — C1/C2 durable transcript conservation at core Stop→Resume composition (real-provider replay NOT_EXERCISED)"
						: "CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST — defect reproduced",
			}
			// eslint-disable-next-line no-console
			console.log("[QPSR03_PRODUCTION_CHRONOLOGY final state]", JSON.stringify(finalState, null, 2))

			expect(counters.c1Count).toBe(1)
			expect(counters.c2Count).toBe(1)
			// P2 enqueue / drain witnesses — at least one each
			expect(p2EnqueueObserved).toBeGreaterThanOrEqual(1)
			expect(p2DrainCount).toBeGreaterThanOrEqual(1)
		} finally {
			unsubscribe()
		}
	})
})
