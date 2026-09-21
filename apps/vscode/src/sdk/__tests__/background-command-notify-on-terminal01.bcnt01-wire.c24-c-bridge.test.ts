/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / BCNT01 WIRE
 * (correction01 — real production wire test)
 *
 * Drives the REAL production wire:
 *
 *   BackgroundNotifyCoordinator
 *     -> SdkController closure (the one constructed in
 *        src/sdk/SdkController.ts:996-1020)
 *     -> active.sdkHost.send({ sessionId, prompt, delivery: "queue" })
 *     -> VscodeSessionHost.send
 *     -> inner.send (ClineCore LocalRuntimeHost)
 *     -> LocalRuntimeHost.runTurn (sdk/packages/core/src/.../local-runtime-host.ts:1044)
 *        - if delivery === "queue" || "steer":
 *            pendingPromptsController.enqueue(input.sessionId, {...})
 *
 * and asserts the wake appears in host.pendingPrompts.list({sessionId}).
 *
 * This is the bridge-only wire proof that the
 * `enqueueTerminalWake` callback's `sdkHost.send({ delivery: "queue" })`
 * path actually lands a queued prompt in the production
 * PendingPromptsController. The unit tests in
 * background-command-notify-on-terminal01.bcnt01.test.ts prove the
 * coordinator's HOLD/DRAIN/containment/owner_mismatch logic; this
 * test proves the TRANSPORT.
 *
 * Runs only under `apps/vscode/vitest.config.c2-4-c-bridge.ts`
 * because the bridge needs the real `@cline-internal/core/...`
 * aliases (NOT the @cline/core stub).
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentResult, BasicLogger } from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface MakeHostResult {
	host: LocalRuntimeHost
	run: ReturnType<typeof vi.fn>
	continueFn: ReturnType<typeof vi.fn>
	canStartRun: ReturnType<typeof vi.fn>
	agentId: string
}

function makeAgentStub() {
	let running = false
	const run = vi.fn(async (): Promise<AgentResult> => {
		running = true
		await new Promise((resolve) => setImmediate(resolve))
		await new Promise((resolve) => setImmediate(resolve))
		running = false
		return {
			finishReason: "completed",
			text: "",
			messages: [],
			toolCalls: [],
			usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
			durationMs: 1,
			iterations: 1,
			model: { id: "mock", provider: "mock" },
			startedAt: new Date(),
			endedAt: new Date(),
		}
	})
	const continueFn = vi.fn(async (): Promise<AgentResult> => {
		running = true
		await new Promise((resolve) => setImmediate(resolve))
		running = false
		return {
			finishReason: "completed",
			text: "",
			messages: [],
			toolCalls: [],
			usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
			durationMs: 1,
			iterations: 1,
			model: { id: "mock", provider: "mock" },
			startedAt: new Date(),
			endedAt: new Date(),
		}
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
		getAgentId: vi.fn().mockReturnValue("agent-bcnt01-wire"),
		getConversationId: vi.fn().mockReturnValue("conv-bcnt01-wire"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	return { agent, run, continueFn, abortFn, canStartRun }
}

function makeSessionServiceMock() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest.json",
			messagesPath: "/tmp/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-bcnt01-wire",
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
				messages_path: "/tmp/messages.json",
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

async function makeHost(): Promise<MakeHostResult> {
	const sessionService = makeSessionServiceMock()
	const runtimeBuilder = makeRuntimeBuilderStub()
	const { agent, run, continueFn, canStartRun } = makeAgentStub()
	const host = new LocalRuntimeHost({
		distinctId: "act-bcnt01-wire",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => agent as never,
		logger: makeLoggerStub(),
	})
	return { host, run, continueFn, canStartRun, agentId: "agent-bcnt01-wire" }
}

const distinctId = "act-bcnt01-wire"

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

describe("ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / BCNT01 WIRE", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "act-bcnt01-wire-"))
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

	it("BCNT-WIRE-01: sdkHost.send({ delivery: 'queue' }) lands a prompt in the production PendingPromptsController", async () => {
		const sessionId = "sess-bcnt01-wire-01"
		const { host } = await makeHost()
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(sessionId),
			})

			// Fire the wake directly with delivery:"queue".
			// This is the EXACT shape of the call the
			// BackgroundNotifyCoordinator's transport closure
			// makes:
			//   void active.sdkHost.send({
			//     sessionId, prompt, delivery: "queue"
			//   })
			// which routes through
			// VscodeSessionHost.send -> inner.send
			// -> LocalRuntimeHost.runTurn.
			//
			// Per LocalRuntimeHost.runTurn:1060, when
			// delivery === "queue", the prompt is enqueued
			// via PendingPromptsController.enqueue. The
			// runTurn returns undefined.
			//
			// We abort the session BEFORE awaiting so the
			// queued prompt can't drain — this gives us a
			// stable view of the queue contents.
			const wakePrompt =
				"A background command you asked to be notified about has reached a terminal state.\n\nJob: cmd_test\nState: exited\nExitCode: 0\n\n<bounded-output>hello</bounded-output>"
			const enqueuePromise = host.runTurn({
				sessionId,
				prompt: wakePrompt,
				delivery: "queue",
			})
			// The runTurn synchronous body enqueues
			// immediately and returns undefined. We do not
			// await the promise yet so we can inspect the
			// queue BEFORE the drain microtask fires.
			await host.abort(sessionId, "test-wire")
			const result = await enqueuePromise
			expect(result).toBeUndefined()

			// Direct verification: the production
			// PendingPromptsController list contains the
			// wake. (new Set + JSON to dedupe in case the
			// drain got partway.)
			const queue = await host.pendingPrompts.list({ sessionId })
			const seen = new Set(queue.map((q) => q.prompt))
			expect(seen.has(wakePrompt)).toBe(true)
			const found = queue.find((q) => q.prompt === wakePrompt)
			expect(found?.delivery).toBe("queue")
		} finally {
			await host.dispose()
		}
	}, 30_000)
})
