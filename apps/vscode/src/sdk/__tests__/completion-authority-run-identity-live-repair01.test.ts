/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-RUN-IDENTITY-LIVE-REPAIR01
 *
 * Production-shape RED/GREEN/ABLATION test for the run-identity
 * defect isolated in the LIVE trace:
 *   - DUPLICATE_RUN_STARTED_AUTHORITY: two `run_turn_started`
 *     records per physical turn (one caller-side, no runId; one
 *     authoritative, with runId).
 *   - AGENT_TURN_DONE_MISSING_FACTUAL_RUN_ID: `agent_turn_done`
 *     carries no runId, so it cannot correlate to its start.
 *
 * This test drives the REAL `LocalRuntimeHost` production class
 * (via the @cline-internal/core/.../local-runtime-host alias) and
 * the REAL production capture seam:
 *   - `subscribeCanonicalRuntimeEventsToShadow` (authoritative C7)
 *   - `recordRunStart` + `recordAgentTurnDone` (production helpers
 *     wired into `vscode-session-host.ts`)
 *
 * The test toggles the production-side helper module's globals to
 * reproduce pre-repair vs post-repair state. The helper module IS
 * the production seam; toggling its globals is the repair.
 *
 * Bridge config: `apps/vscode/vitest.config.c2-4-c-bridge.ts`.
 * Excluded from `apps/vscode/vitest.config.ts`.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentRuntimeEvent, BasicLogger } from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { subscribeCanonicalRuntimeEventsToShadow } from "@/sdk/canonical-event-subscription"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority"
import {
	setAgentTurnDoneReadsRunId,
	setCallerSideRunStartCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority.runtime-capture"
import { createProductionPendingPromptCapture } from "@/sdk/continuation-cardinality-authority.session-host-capture"

// ---------------------------------------------------------------------------
// Stub agent that drives the canonical event stream with a SINGLE
// `run-started` event whose snapshot.runId is the factual
// AgentRuntime-issued runtime run id.
// ---------------------------------------------------------------------------

function makeStubAgent(opts: { runId: string; listeners: Set<(event: AgentRuntimeEvent) => void> }) {
	const emitRunStarted = (runId: string) => {
		const event: AgentRuntimeEvent = {
			type: "run-started",
			snapshot: {
				agentId: "agent-rilr01",
				runId,
				sessionId: undefined,
				conversationId: "conv-rilr01",
				status: "running",
				iteration: 0,
				messages: [],
				pendingToolCalls: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
				recovery: {
					state: "none",
					previousState: "none",
					attempt: 0,
				},
			},
		}
		for (const l of opts.listeners) l(event)
	}
	const baseResult = {
		finishReason: "completed" as const,
		text: "",
		messages: [],
		toolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
		durationMs: 1,
		iterations: 1,
		model: { id: "mock-model", provider: "mock-provider" },
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:01.000Z"),
	}
	return {
		agent: {
			run: vi.fn(async () => {
				emitRunStarted(opts.runId)
				return baseResult
			}),
			continue: vi.fn(async () => {
				emitRunStarted(opts.runId)
				return baseResult
			}),
			canStartRun: vi.fn(() => true),
			abort: vi.fn(),
			subscribeEvents: vi.fn(() => () => {}),
			subscribeRuntimeEvents: vi.fn((listener: (event: AgentRuntimeEvent) => void) => {
				opts.listeners.add(listener)
				return () => {
					opts.listeners.delete(listener)
				}
			}),
			subscribeRecoveryStateChange: vi.fn(() => () => {}),
			getAgentId: vi.fn(() => "agent-rilr01"),
			getConversationId: vi.fn(() => "conv-rilr01"),
			shutdown: vi.fn(async () => {}),
			getMessages: vi.fn(() => []),
		},
		emitRunStarted,
	}
}

function makeSessionServiceStub() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions-rilr01"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/sessions-rilr01/manifest.json",
			messagesPath: "/tmp/sessions-rilr01/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-rilr01",
				source: "vscode",
				pid: process.pid,
				started_at: "2026-01-01T00:00:00.000Z",
				status: "running",
				interactive: true,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project-rilr01",
				workspace_root: "/tmp/project-rilr01",
				enable_tools: true,
				enable_spawn: true,
				enable_teams: true,
				prompt: "test prompt",
				messages_path: "/tmp/sessions-rilr01/messages.json",
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

async function waitFor(predicate: () => boolean, description: string, deadlineMs = 5_000): Promise<void> {
	const start = Date.now()
	while (!predicate()) {
		if (Date.now() - start > deadlineMs) {
			throw new Error(`waitFor: ${description} did not become true within ${deadlineMs}ms`)
		}
		await new Promise((resolve) => setImmediate(resolve))
	}
}

// ---------------------------------------------------------------------------
// Harness: drives the production seam.
// - The harness wires `pendingPromptCapture` with the SAME
//   production helpers (`recordRunStart`, `recordAgentTurnDone`)
//   the production `vscode-session-host.ts` wiring calls.
// - The harness wires the REAL `subscribeCanonicalRuntimeEventsToShadow`
//   so the authoritative `run_turn_started` capture fires on the
//   `run-started` event with the runtime runId.
// - The test toggles the helper module's globals to reproduce
//   pre-repair vs post-repair state.
// ---------------------------------------------------------------------------

interface Harness {
	host: LocalRuntimeHost
	sessionId: string
	runId: string
	listeners: Set<(event: AgentRuntimeEvent) => void>
}

async function makeHarness(opts: { sessionId: string; runId: string; isolationDir: string }): Promise<Harness> {
	const listeners = new Set<(event: AgentRuntimeEvent) => void>()
	const { agent } = makeStubAgent({ runId: opts.runId, listeners })
	const sessionService = makeSessionServiceStub()
	const runtimeBuilder = makeRuntimeBuilderStub()
	// PRODUCTION-SEAM: use the SAME factory
	// `VscodeSessionHost` uses at `apps/vscode/src/sdk/vscode-session-host.ts`.
	// The test is NOT a mirror; it drives the real production
	// capture callbacks.
	const pendingPromptCapture = createProductionPendingPromptCapture()
	const host = new LocalRuntimeHost({
		distinctId: "act-rilr01",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => agent as never,
		logger: makeLoggerStub(),
		pendingPromptCapture,
	})
	await host.startSession({
		source: "vscode",
		interactive: true,
		config: {
			sessionId: opts.sessionId,
			providerId: "mock-provider",
			modelId: "mock-model",
			cwd: opts.isolationDir,
			workspaceRoot: opts.isolationDir,
			systemPrompt: "rilr01 test agent",
			mode: "act" as const,
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
	})
	return {
		host,
		sessionId: opts.sessionId,
		runId: opts.runId,
		listeners,
	}
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-RUN-IDENTITY-LIVE-REPAIR01", () => {
	let isolationDir = ""
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "rilr01-bridge-"))
		process.env.HOME = isolationDir
		process.env.CLINE_DIR = join(isolationDir, ".cline")
		delete process.env.CLINE_DATA_DIR
		setHomeDir(isolationDir)
		setClineDir(process.env.CLINE_DIR)
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		clearContinuationCardinalityAuthorityCapture()
	})

	afterEach(async () => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		if (envSnapshot.CLINE_DATA_DIR === undefined) {
			delete process.env.CLINE_DATA_DIR
		} else {
			process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR
		}
		setHomeDir(envSnapshot.HOME ?? "~")
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"))
		if (isolationDir && existsSync(isolationDir)) {
			rmSync(isolationDir, { recursive: true, force: true })
		}
		setContinuationCardinalityAuthorityCaptureEnabled(false)
		clearContinuationCardinalityAuthorityCapture()
		setCallerSideRunStartCaptureEnabled(false)
		setAgentTurnDoneReadsRunId(true)
		vi.restoreAllMocks()
	})

	// =======================================================================
	// PRE-REPAIR RED
	// =======================================================================

	describe("PRE-REPAIR RED — captures the live defect", () => {
		// PRE-repair toggles mirror the live trace dump:
		//   - caller-side C7 capture ACTIVE
		//   - agent_turn_done reads NO runId
		beforeEach(() => {
			setCallerSideRunStartCaptureEnabled(true)
			setAgentTurnDoneReadsRunId(false)
		})

		it("RILR-01.RED: pre-repair emits TWO run_turn_started records for one physical turn", async () => {
			const sessionId = "sess-rilr01-pre-01"
			const runId = "run-rilr01-pre-01"
			const harness = await makeHarness({ sessionId, runId, isolationDir })
			const unsubscribeCanonical = subscribeCanonicalRuntimeEventsToShadow(
				harness.host,
				{ observeCanonicalRuntimeEvent: () => {}, resetForNewTask: () => {}, dispose: () => {} } as never,
				sessionId,
			)
			try {
				await harness.host.runTurn({ sessionId, prompt: "rilr01 pre-01 prompt" })
				await waitFor(
					() =>
						getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >=
						1,
					"agent_turn_done to fire",
				)
				const starts = getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "run_turn_started")
				expect(starts.length).toBe(2)
				expect(starts[0].runId).toBeUndefined()
				expect(starts[1].runId).toBe(runId)
			} finally {
				unsubscribeCanonical()
				await harness.host.dispose()
			}
		})

		it("RILR-02.RED: pre-repair records an anonymous run_turn_started (runId absent)", async () => {
			const sessionId = "sess-rilr01-pre-02"
			const runId = "run-rilr01-pre-02"
			const harness = await makeHarness({ sessionId, runId, isolationDir })
			const unsubscribeCanonical = subscribeCanonicalRuntimeEventsToShadow(
				harness.host,
				{ observeCanonicalRuntimeEvent: () => {}, resetForNewTask: () => {}, dispose: () => {} } as never,
				sessionId,
			)
			try {
				await harness.host.runTurn({ sessionId, prompt: "rilr01 pre-02 prompt" })
				await waitFor(
					() =>
						getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >=
						1,
					"agent_turn_done to fire",
				)
				const starts = getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "run_turn_started")
				expect(starts.filter((r) => r.runId === undefined).length).toBeGreaterThanOrEqual(1)
			} finally {
				unsubscribeCanonical()
				await harness.host.dispose()
			}
		})

		it("RILR-03.RED: pre-repair agent_turn_done carries no runId", async () => {
			const sessionId = "sess-rilr01-pre-03"
			const runId = "run-rilr01-pre-03"
			const harness = await makeHarness({ sessionId, runId, isolationDir })
			const unsubscribeCanonical = subscribeCanonicalRuntimeEventsToShadow(
				harness.host,
				{ observeCanonicalRuntimeEvent: () => {}, resetForNewTask: () => {}, dispose: () => {} } as never,
				sessionId,
			)
			try {
				await harness.host.runTurn({ sessionId, prompt: "rilr01 pre-03 prompt" })
				await waitFor(
					() =>
						getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >=
						1,
					"agent_turn_done to fire",
				)
				const dones = getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done")
				expect(dones.length).toBe(1)
				expect(dones[0].runId).toBeUndefined()
			} finally {
				unsubscribeCanonical()
				await harness.host.dispose()
			}
		})

		it("RILR-04.RED: pre-repair chronology shows two run_turn_started records preceding done (done.runId undefined)", async () => {
			const sessionId = "sess-rilr01-pre-04"
			const runId = "run-rilr01-pre-04"
			const harness = await makeHarness({ sessionId, runId, isolationDir })
			const unsubscribeCanonical = subscribeCanonicalRuntimeEventsToShadow(
				harness.host,
				{ observeCanonicalRuntimeEvent: () => {}, resetForNewTask: () => {}, dispose: () => {} } as never,
				sessionId,
			)
			try {
				await harness.host.runTurn({ sessionId, prompt: "rilr01 pre-04 prompt" })
				await waitFor(
					() =>
						getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >=
						1,
					"agent_turn_done to fire",
				)
				const records = getContinuationCardinalityAuthorityCaptureRecords()
				const startSeqs = records.filter((r) => r.stage === "run_turn_started").map((r) => r.seq)
				const doneSeq = records.find((r) => r.stage === "agent_turn_done")?.seq
				expect(startSeqs).toHaveLength(2)
				expect(doneSeq).toBeDefined()
				expect(Math.max(...startSeqs)).toBeLessThan(doneSeq!)
				const done = records.find((r) => r.stage === "agent_turn_done")!
				expect(done.runId).toBeUndefined()
			} finally {
				unsubscribeCanonical()
				await harness.host.dispose()
			}
		})
	})

	// =======================================================================
	// POST-REPAIR GREEN
	// =======================================================================

	describe("POST-REPAIR GREEN — sole run-start authority, done correlates", () => {
		// POST-repair toggles: caller-side C7 OFF; C8 reads runId.
		beforeEach(() => {
			setCallerSideRunStartCaptureEnabled(false)
			setAgentTurnDoneReadsRunId(true)
		})

		it("RILR-01.GREEN: post-repair emits exactly ONE run_turn_started with the factual runtime runId", async () => {
			const sessionId = "sess-rilr01-post-01"
			const runId = "run-rilr01-post-01"
			const harness = await makeHarness({ sessionId, runId, isolationDir })
			const unsubscribeCanonical = subscribeCanonicalRuntimeEventsToShadow(
				harness.host,
				{ observeCanonicalRuntimeEvent: () => {}, resetForNewTask: () => {}, dispose: () => {} } as never,
				sessionId,
			)
			try {
				await harness.host.runTurn({ sessionId, prompt: "rilr01 post-01 prompt" })
				await waitFor(
					() =>
						getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >=
						1,
					"agent_turn_done to fire",
				)
				const starts = getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "run_turn_started")
				expect(starts.length).toBe(1)
				expect(starts[0].runId).toBe(runId)
			} finally {
				unsubscribeCanonical()
				await harness.host.dispose()
			}
		})

		it("RILR-02.GREEN: post-repair has ZERO anonymous run_turn_started records", async () => {
			const sessionId = "sess-rilr01-post-02"
			const runId = "run-rilr01-post-02"
			const harness = await makeHarness({ sessionId, runId, isolationDir })
			const unsubscribeCanonical = subscribeCanonicalRuntimeEventsToShadow(
				harness.host,
				{ observeCanonicalRuntimeEvent: () => {}, resetForNewTask: () => {}, dispose: () => {} } as never,
				sessionId,
			)
			try {
				await harness.host.runTurn({ sessionId, prompt: "rilr01 post-02 prompt" })
				await waitFor(
					() =>
						getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >=
						1,
					"agent_turn_done to fire",
				)
				const starts = getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "run_turn_started")
				expect(starts.filter((r) => r.runId === undefined).length).toBe(0)
			} finally {
				unsubscribeCanonical()
				await harness.host.dispose()
			}
		})

		it("RILR-03.GREEN: post-repair done.runId equals start.runId (correlates to same run)", async () => {
			const sessionId = "sess-rilr01-post-03"
			const runId = "run-rilr01-post-03"
			const harness = await makeHarness({ sessionId, runId, isolationDir })
			const unsubscribeCanonical = subscribeCanonicalRuntimeEventsToShadow(
				harness.host,
				{ observeCanonicalRuntimeEvent: () => {}, resetForNewTask: () => {}, dispose: () => {} } as never,
				sessionId,
			)
			try {
				await harness.host.runTurn({ sessionId, prompt: "rilr01 post-03 prompt" })
				await waitFor(
					() =>
						getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >=
						1,
					"agent_turn_done to fire",
				)
				const records = getContinuationCardinalityAuthorityCaptureRecords()
				const start = records.find((r) => r.stage === "run_turn_started")
				const done = records.find((r) => r.stage === "agent_turn_done")
				expect(start).toBeDefined()
				expect(done).toBeDefined()
				expect(start!.runId).toBe(runId)
				expect(done!.runId).toBe(runId)
				expect(start!.runId).toBe(done!.runId)
			} finally {
				unsubscribeCanonical()
				await harness.host.dispose()
			}
		})

		it("RILR-04.GREEN: post-repair chronology is start(runId) before done(same runId)", async () => {
			const sessionId = "sess-rilr01-post-04"
			const runId = "run-rilr01-post-04"
			const harness = await makeHarness({ sessionId, runId, isolationDir })
			const unsubscribeCanonical = subscribeCanonicalRuntimeEventsToShadow(
				harness.host,
				{ observeCanonicalRuntimeEvent: () => {}, resetForNewTask: () => {}, dispose: () => {} } as never,
				sessionId,
			)
			try {
				await harness.host.runTurn({ sessionId, prompt: "rilr01 post-04 prompt" })
				await waitFor(
					() =>
						getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >=
						1,
					"agent_turn_done to fire",
				)
				const records = getContinuationCardinalityAuthorityCaptureRecords()
				const start = records.find((r) => r.stage === "run_turn_started")
				const done = records.find((r) => r.stage === "agent_turn_done")
				expect(start).toBeDefined()
				expect(done).toBeDefined()
				expect(start!.seq).toBeLessThan(done!.seq)
				expect(start!.runId).toBe(runId)
				expect(done!.runId).toBe(runId)
			} finally {
				unsubscribeCanonical()
				await harness.host.dispose()
			}
		})

		it("RILR-06.GREEN: capture-OFF leaves the seam as a complete no-op (zero CCARD records)", async () => {
			setContinuationCardinalityAuthorityCaptureEnabled(false)
			clearContinuationCardinalityAuthorityCapture()
			const sessionId = "sess-rilr01-post-06"
			const runId = "run-rilr01-post-06"
			const harness = await makeHarness({ sessionId, runId, isolationDir })
			const unsubscribeCanonical = subscribeCanonicalRuntimeEventsToShadow(
				harness.host,
				{ observeCanonicalRuntimeEvent: () => {}, resetForNewTask: () => {}, dispose: () => {} } as never,
				sessionId,
			)
			try {
				const result = await harness.host.runTurn({ sessionId, prompt: "rilr01 post-06 prompt" })
				expect(result?.finishReason).toBe("completed")
				for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
				const records = getContinuationCardinalityAuthorityCaptureRecords()
				expect(records.length).toBe(0)
			} finally {
				unsubscribeCanonical()
				await harness.host.dispose()
				setContinuationCardinalityAuthorityCaptureEnabled(true)
			}
		})
	})
})
