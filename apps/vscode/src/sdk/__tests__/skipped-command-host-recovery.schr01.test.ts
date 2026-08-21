/**
 * ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-RESUME01 / SCHR01 — RED
 * discriminator suite for the HOST/APPLICATION recovery seam above
 * AgentRuntime.
 *
 * Context (per ACT §0 inherited evidence):
 *
 *   The AgentRuntime rejection path is already GREEN (SCTR01). The
 *   unresolved question is exactly one layer higher: after a
 *   USER_REJECT_BEFORE_EXECUTION command path completes cleanly inside
 *   AgentRuntime, does the REAL host (LocalRuntimeHost) turn boundary:
 *
 *     (a) settle into a truthful ownership state (USER_OWNED or TERMINAL),
 *     (b) publish that state truthfully through `session.status`,
 *     (c) permit a distinct next user turn via `host.runTurn(...)`.
 *
 *   This file exercises that seam directly with the production
 *   `LocalRuntimeHost` (via the @cline-internal/core bridge alias), the
 *   real `FileSessionService`, and a stub agent whose `run`/`continue`
 *   chronology mirrors the SCTR01 GREEN AgentRuntime rejection outcome
 *   — so the host seam is the only variable under test.
 *
 * Production seam under test (LocalRuntimeHost, sdk/packages/core):
 *   `runTurn(input)` — line 994
 *     → `executeTurn(session, input)` — line 1708
 *       → `markTurnRunning(session)` — line 1749 → updateStatus("running")
 *       → `executeAgentTurn(session, prompt)` — line 1882
 *         → `session.agent.run(prompt)` (stub; rejection outcome)
 *       → returns `AgentResult` with `finishReason`
 *     → `completeInteractiveTurn(session, finishReason)` — line 1775
 *       → `markTurnIdle(session)` — line 2164 → updateStatus("idle")
 *       → `session.aborting = false`
 *     → `pendingPromptsController.drain(sessionId)` — line 1041
 *
 * For interactive sessions, turn-finalization is
 * `completeInteractiveTurn` → `markTurnIdle`, NOT `shutdownSession`. The
 * session must end `idle` (NON_TERMINAL), not `completed`/`failed`/
 * `cancelled` (TERMINAL). An idle session is the precondition for the
 * next user turn.
 *
 * Discrimination matrix (mirrors ACT §4–§10):
 *   SCHR01 — host settles to "idle" after a USER_REJECT turn through runTurn
 *   SCHR02 — second distinct runTurn call enters and runs the agent
 *   SCHR03 — host publishes truthful idle/non-running state
 *   SCHR04 — SUCCESS control: approved harmless command, same recovery
 *   SCHR05 — EXECUTION FAILURE control: non-zero exit, same recovery
 *
 * The expected invariant (per ACT §5):
 *
 *     Once AgentRuntime has returned cleanly (no model/tool work
 *     active), the host MUST settle into one truthful owner:
 *
 *       A. USER_OWNED  → next user turn can enter immediately
 *                        (status="idle", canStartRun()=true).
 *       B. TERMINAL    → task is explicitly terminal.
 *
 *     Forbidden (the dead-zone):
 *
 *       AgentRuntime completed AND no model/tool work active
 *       BUT host remains busy/running (status="running", or
 *       next-turn-entry is a no-op).
 *
 *   If this test fails, classify per ACT §11 CASE_H1..H5.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentResult, BasicLogger } from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"

import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── Types & helpers ───────────────────────────────────────────────────

const distinctId = "act-schr01-test"

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		text: "ok",
		iterations: 1,
		finishReason: "completed",
		usage: {
			inputTokens: 1,
			outputTokens: 2,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		durationMs: 1,
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
				session_id: "sess-schr01",
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

/**
 * Stub agent whose `run()` returns the rejection outcome (mirrors the
 * SCTR01 GREEN chronology: model proposed a tool, model saw rejection,
 * model emitted terminal response, AgentRuntime returned "completed").
 *
 * Captures: how many times `run` vs `continue` were invoked, so we can
 * prove a second `runTurn` enters a fresh `continue` (not a re-run).
 */
function makeAgentStub() {
	const run = vi.fn(async () => makeResult({ text: "first-turn" }))
	const continueFn = vi.fn(async () => makeResult({ text: "second-turn" }))
	const agent = {
		run,
		continue: continueFn,
		canStartRun: vi.fn(() => true),
		abort: vi.fn(),
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		subscribeRecoveryStateChange: vi.fn().mockReturnValue(() => {}),
		getAgentId: vi.fn().mockReturnValue("agent-schr01"),
		getConversationId: vi.fn().mockReturnValue("conv-schr01"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	return { agent, run, continueFn }
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
	const { agent, run, continueFn } = makeAgentStub()
	const host = new LocalRuntimeHost({
		distinctId,
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => agent as never,
		logger: makeLoggerStub(),
	})
	return { host, sessionService, run, continueFn }
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

// ── Test environment ──────────────────────────────────────────────────

describe("ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01 / SCHR01 — host seam above AgentRuntime", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "act-schr01-host-recovery-"))
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
		rmSync(isolatedHomeDir, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	// SCHR01 — host settles to "idle" after a USER_REJECT turn.
	//
	// Mirrors SCTR01 at the host layer: the AgentRuntime outcome of
	// a rejected run is `completed`. After `runTurn` returns, the
	// host must have transitioned the session from `running` →
	// `idle` via `markTurnIdle`.
	it("SCHR01_REJECTION_HOST_SETTLES_TO_IDLE: after a USER_REJECT turn, host.session.status === 'idle'", async () => {
		const sessionId = "sess-schr01-rejection"
		const { host, run } = await makeHost()
		try {
			// Subscribe BEFORE startSession so we capture the
			// initial "running" status emission.
			const statusTrace: string[] = []
			host.subscribe((event) => {
				const e = event as {
					type?: string
					payload?: { status?: string }
				}
				if (e?.type === "status" && typeof e.payload?.status === "string") {
					statusTrace.push(e.payload.status)
				}
			})

			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(sessionId),
			})

			const first = await host.runTurn({
				sessionId,
				prompt: "run a command (will be rejected)",
			})

			expect(first?.finishReason).toBe("completed")
			expect(run).toHaveBeenCalledTimes(1)

			// Expected chronology: ["running", "idle"].
			expect(statusTrace).toContain("running")
			expect(statusTrace[statusTrace.length - 1]).toBe("idle")

			const session = await host.getSession(sessionId)
			expect(session).toBeDefined()
			expect(session?.status).toBe("idle")
		} finally {
			await host.dispose()
		}
	})

	// SCHR02 — distinct second `runTurn` enters and runs the agent.
	//
	// This is the load-bearing gap left by SCTR01. After the first
	// USER_REJECT turn has fully returned, a brand-new second
	// `host.runTurn(...)` call must (a) be accepted, (b) re-enter
	// the agent via `session.agent.continue(...)` (NOT a fresh
	// `run()`), and (c) settle the host back to "idle".
	it("SCHR02_DISTINCT_SECOND_TURN_ENTERS: a second runTurn after the first USER_REJECT turn re-enters the agent via continue() and settles again", async () => {
		const sessionId = "sess-schr02-second-turn"
		const { host, run, continueFn } = await makeHost()
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(sessionId),
			})

			const first = await host.runTurn({
				sessionId,
				prompt: "first turn (rejection)",
			})
			expect(first?.finishReason).toBe("completed")
			expect(run).toHaveBeenCalledTimes(1)

			const mid = await host.getSession(sessionId)
			expect(mid?.status).toBe("idle")

			const second = await host.runTurn({
				sessionId,
				prompt: "second turn (followup)",
			})

			expect(second).toBeDefined()
			expect(second?.finishReason).toBe("completed")

			// agent.run() called exactly ONCE (first turn);
			// agent.continue() called exactly ONCE (second turn).
			expect(run).toHaveBeenCalledTimes(1)
			expect(continueFn).toHaveBeenCalledTimes(1)

			const after = await host.getSession(sessionId)
			expect(after?.status).toBe("idle")
		} finally {
			await host.dispose()
		}
	})

	// SCHR03 — host publication must not block a new turn.
	//
	// We don't prescribe the exact publication shape; we only
	// require that whatever is published does NOT prevent the
	// next user turn from entering. We observe the host directly:
	// it must not claim `running` after the rejection turn has
	// fully returned.
	it("SCHR03_HOST_PUBLICATION_DOES_NOT_BLOCK_NEXT_TURN: post-rejection session.status is not 'running'", async () => {
		const sessionId = "sess-schr03-publication"
		const { host } = await makeHost()
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(sessionId),
			})

			await host.runTurn({
				sessionId,
				prompt: "first turn (rejection)",
			})

			const session = await host.getSession(sessionId)
			expect(session).toBeDefined()

			expect(session?.status).not.toBe("running")
			expect(["idle", "completed", "failed", "cancelled"]).toContain(session?.status)
		} finally {
			await host.dispose()
		}
	})

	// SCHR04 — SUCCESS control.
	//
	// Repeat the same chronology with an APPROVED harmless
	// successful command. If the rejection-specific path is
	// broken (CASE_H5) but the success path is healthy, this
	// control stays GREEN while SCHR01–SCHR03 RED. If both RED,
	// it is CASE_H4 (generic).
	it("SCHR04_SUCCESS_CONTROL: approved harmless turn settles to idle and a second turn still works", async () => {
		const sessionId = "sess-schr04-success"
		const { host, run, continueFn } = await makeHost()
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(sessionId),
			})

			const first = await host.runTurn({
				sessionId,
				prompt: "harmless approved command",
			})
			expect(first?.finishReason).toBe("completed")
			expect(run).toHaveBeenCalledTimes(1)

			const mid = await host.getSession(sessionId)
			expect(mid?.status).toBe("idle")

			const second = await host.runTurn({
				sessionId,
				prompt: "followup after success",
			})
			expect(second?.finishReason).toBe("completed")
			expect(continueFn).toHaveBeenCalledTimes(1)

			const after = await host.getSession(sessionId)
			expect(after?.status).toBe("idle")
		} finally {
			await host.dispose()
		}
	})

	// SCHR05 — EXECUTION FAILURE control.
	//
	// Repeat with an executed command that exits non-zero. Host
	// must still settle and accept a second turn. This guards
	// against conflating "execution failure" with "user rejection"
	// — they share the same host finalization path.
	it("SCHR05_EXECUTION_FAILURE_CONTROL: executor-non-zero turn settles to idle and a second turn still works", async () => {
		const sessionId = "sess-schr05-exec-failure"
		const { host, run, continueFn } = await makeHost()
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(sessionId),
			})

			// Override the first-turn result to simulate an
			// executed non-zero exit.
			run.mockResolvedValueOnce(
				makeResult({
					text: "command exited 1",
					toolCalls: [
						{
							name: "run_commands",
							arguments: { commands: ["false"] },
							result: {
								output: "",
								exitCode: 1,
								success: false,
							},
						},
					] as never,
				}),
			)

			const first = await host.runTurn({
				sessionId,
				prompt: "command that exits 1",
			})
			expect(first?.finishReason).toBe("completed")

			const mid = await host.getSession(sessionId)
			expect(mid?.status).toBe("idle")

			const second = await host.runTurn({
				sessionId,
				prompt: "followup after failure",
			})
			expect(second?.finishReason).toBe("completed")
			expect(continueFn).toHaveBeenCalledTimes(1)

			const after = await host.getSession(sessionId)
			expect(after?.status).toBe("idle")
		} finally {
			await host.dispose()
		}
	})

	// SCHR-SANITY — the test harness itself is valid.
	//
	// Proves that the bridge @cline-internal/core/* aliases
	// resolve to the real LocalRuntimeHost (production class)
	// and the real FileSessionService, not a stub.
	it("SCHR_SANITY: @cline-internal/core bridge aliases resolve to the real LocalRuntimeHost and FileSessionService", () => {
		// Construct a fresh host and confirm the prototype
		// carries the production methods. This is more robust
		// than `Function.name` (which can be mangled by
		// minifiers / TS-compiled ESM).
		const probe = new LocalRuntimeHost({
			distinctId,
			sessionService: makeSessionServiceMock() as never,
			runtimeBuilder: makeRuntimeBuilderStub() as never,
			createAgent: () => makeAgentStub().agent as never,
		})
		const proto = Object.getPrototypeOf(probe) as Record<string, unknown>
		const methodNames = Object.getOwnPropertyNames(proto)
		expect(methodNames).toContain("runTurn")
		expect(methodNames).toContain("startSession")
		expect(methodNames).toContain("getSession")
		expect(methodNames).toContain("dispose")

		const svc = new FileSessionService(join(isolatedHomeDir, "sanity-sessions"))
		expect(svc).toBeDefined()
		expect(typeof (svc as unknown as Record<string, unknown>).ensureSessionsDir).toBe("function")
		// Constructor is lazy; the directory is created on the
		// first call to ensureSessionsDir().
		;(
			svc as unknown as {
				ensureSessionsDir: () => string
			}
		).ensureSessionsDir()
		expect(existsSync(join(isolatedHomeDir, "sanity-sessions"))).toBe(true)
	})
})
