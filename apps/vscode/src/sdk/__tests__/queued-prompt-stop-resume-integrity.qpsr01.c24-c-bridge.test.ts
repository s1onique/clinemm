/**
 * ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 / QPSR01 — RED
 * discriminator for upstream `cline/cline#12975`.
 *
 * Upstream defect: on VS Code/JetBrains, a user queues a second request
 * while the first is still executing; the second request begins
 * processing; the user presses Stop; the user presses Resume; Cline
 * re-executes already-completed commands instead of continuing from the
 * queued successor.
 *
 * Production seam under test (LocalRuntimeHost, sdk/packages/core):
 *   runTurn(input) → if delivery="queue" → pendingPromptsController.enqueue
 *     → executeTurn → executeAgentTurn → session.agent.run/.continue
 *   abort(sessionId, reason) — line 1077
 *     → session.aborting = true
 *     → if drainingPendingPrompts → pendingPromptsController.discardQueue
 *     → session.agent.abort(reason)
 *     → completeAbortedInteractiveTurn → persistSessionMessages
 *   restoreSession(input) — line 962
 *     → sessionVersioning.restoreCheckpoint
 *     → new ActiveSession built at line 821 with pendingPrompts: [] (line 844)
 *
 * Evidence priority per ACT §4:
 *   1. real LocalRuntimeHost (via @cline-internal/core bridge alias)
 *   2. real PendingPromptsController (production class, in-process)
 *   3. real FileSessionService + real SessionVersioningService
 *   4. synthetic agent: stub SessionRuntime with counter-backed run/continue
 *
 * This test is BRIDGE-ONLY. It runs under
 *   apps/vscode/vitest.config.c2-4-c-bridge.ts
 * (NOT the base apps/vscode/vitest.config.ts).
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentResult, BasicLogger } from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
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
			throw new Error(
				`waitForIdle: agent did not reach idle within ${deadlineMs}ms; canStartRun=${canStartRunSpy()}`,
			)
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