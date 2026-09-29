/**
 * ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02-CORRECTION01 / PCRS02C01
 * (production-shape seam proof).
 *
 * FACTORY REVIEW (HALT_ACT_EVIDENCE_CONTRACT_MISMATCH):
 *
 *   The PCRS02 suite committed in 4a4359bd5 proved only that
 *   the enum exists, that the capture helper records it, and
 *   that the counter increments — by calling
 *   `captureContinuationCardinalityAuthorityRecord(...)`
 *   directly. It did NOT exercise the REAL production seam.
 *
 *   Additionally, the committed capture site was placed in
 *   `LocalRuntimeHost.runTurn` immediately before the
 *   `executeTurn(...)` await. That placement proves only:
 *
 *     runTurn reached the call site immediately before executeTurn()
 *
 *   It does NOT prove:
 *
 *     executeTurn() itself entered, let alone which internal
 *     prelude awaits ran.
 *
 *   In JavaScript, code before the first `await` inside an
 *   async function executes synchronously when that function is
 *   called. Therefore the intended discriminator ("did
 *   executeTurn begin executing?") must be emitted INSIDE
 *   `executeTurn` at its first executable line, not in its
 *   caller.
 *
 *   This file closes both gaps. It exercises the REAL
 *   `LocalRuntimeHost.runTurn` chain and asserts the capture
 *   fires at the corrected boundary (first executable line of
 *   `executeTurn`).
 *
 *   Chain driven:
 *
 *     host.runTurn({ prompt, delivery: undefined })
 *       -> real LocalRuntimeHost (production class)
 *       -> C7 fires (onRunTurnStarted) — runTurn entered, after
 *          queue/steer short-circuit
 *       -> await this.executeTurn(...) — calls executeTurn
 *       -> [CORRECTION01 boundary]: first executable line of
 *          executeTurn runs SYNCHRONOUSLY at call time (before
 *          the first await)
 *       -> prelude capture fires
 *          (onExecuteTurnPreludeEnter)
 *       -> prepareTurnInput → ensureSessionPersisted → ... ->
 *          markTurnRunning -> executeAgentTurn
 *       -> if executeAgentTurn completes: agent.run resolves ->
 *          C8 fires (onAgentTurnDone) at runTurn exit
 *
 *   The same host wiring also captures the helper records via
 *   `captureContinuationCardinalityAuthorityRecord` so we can
 *   inspect the CCARD JSONL ring state directly.
 *
 *   This file is BRIDGE-ONLY. It runs under
 *   `apps/vscode/vitest.config.c2-4-c-bridge.ts` because the
 *   bridge aliases resolve `@cline-internal/core/...` to the
 *   real `LocalRuntimeHost` source rather than the `@cline/core`
 *   bundle or the base-config stub. The base vitest config
 *   excludes this file.
 *
 * Production wiring (mirrored from
 * `apps/vscode/src/sdk/vscode-session-host.ts:550-577`):
 *
 *   - onRunTurnStarted         -> capture { stage: "run_turn_started" }
 *   - onExecuteTurnPreludeEnter -> capture { stage: "execute_turn_prelude_enter" }
 *   - onAgentTurnDone          -> capture { stage: "agent_turn_done" }
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentResult, BasicLogger } from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	captureContinuationCardinalityAuthorityRecord,
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority"

// ---------------------------------------------------------------------------
// Stage identifiers matching the production CCARD capture module
// in apps/vscode/src/sdk/continuation-cardinality-authority.ts.
// ---------------------------------------------------------------------------

type WitnessStage = "run_turn_started" | "execute_turn_prelude_enter" | "agent_turn_done"

interface WitnessRecord {
	readonly stage: WitnessStage
	readonly sessionId: string
	readonly delivery?: "queue" | "steer"
	readonly jobId?: string
	readonly finishReason?: string
}

// Mirror the production `deriveOrigin(delivery, jobId)` precedence
// from `apps/vscode/src/sdk/vscode-session-host.ts` (line 445-453):
//   delivery === "queue"  -> pending_prompt_drain
//   delivery === "steer"  -> deferred_continuation
//   jobId !== undefined   -> pending_prompt_drain (fallback)
//   else                  -> explicit_user
function deriveOrigin(
	delivery: "queue" | "steer" | undefined,
	jobId?: string,
): "pending_prompt_drain" | "deferred_continuation" | "explicit_user" {
	if (delivery === "queue") return "pending_prompt_drain"
	if (delivery === "steer") return "deferred_continuation"
	if (jobId !== undefined) return "pending_prompt_drain"
	return "explicit_user"
}

function makeSyntheticAgent(opts: { onRun: (prompt: string) => Promise<AgentResult> }) {
	let running = false
	const run = vi.fn(async (prompt: string): Promise<AgentResult> => {
		running = true
		try {
			return await opts.onRun(prompt)
		} finally {
			running = false
		}
	})
	const agent = {
		run,
		continue: vi.fn(async (): Promise<AgentResult> => {
			throw new Error("continue not used in PCRS02C01")
		}),
		canStartRun: vi.fn(() => !running),
		abort: vi.fn(() => {
			running = false
		}),
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		subscribeRecoveryStateChange: vi.fn().mockReturnValue(() => {}),
		getAgentId: vi.fn().mockReturnValue("agent-pcrs02c01"),
		getConversationId: vi.fn().mockReturnValue("conv-pcrs02c01"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	return { agent, run }
}

function makeCompletedAgent(): ReturnType<typeof makeSyntheticAgent> {
	return makeSyntheticAgent({
		onRun: async () => ({
			finishReason: "completed",
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
		}),
	})
}

function makeHangingAgent(): ReturnType<typeof makeSyntheticAgent> & {
	unblockRun: () => void
} {
	let block: () => void = () => {}
	const blocked = new Promise<AgentResult>((resolve) => {
		block = () =>
			resolve({
				finishReason: "completed",
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
			})
	})
	return {
		...makeSyntheticAgent({
			onRun: async () => blocked,
		}),
		unblockRun: () => block(),
	}
}

function makeSessionServiceStub() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions-pcrs02c01"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/sessions-pcrs02c01/manifest.json",
			messagesPath: "/tmp/sessions-pcrs02c01/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-pcrs02c01",
				source: "vscode",
				pid: process.pid,
				started_at: "2026-01-01T00:00:00.000Z",
				status: "running",
				interactive: true,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project-pcrs02c01",
				workspace_root: "/tmp/project-pcrs02c01",
				enable_tools: true,
				enable_spawn: true,
				enable_teams: true,
				prompt: "test prompt",
				messages_path: "/tmp/sessions-pcrs02c01/messages.json",
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
// Host harness factory — wires the REAL capture ring via the production
// capture helper (mirrors the wiring in
// `apps/vscode/src/sdk/vscode-session-host.ts:530-577`).
// ---------------------------------------------------------------------------

interface HostHarness {
	host: LocalRuntimeHost
	sessionId: string
	witness: WitnessRecord[]
	ccardRecords: () => ReturnType<typeof getContinuationCardinalityAuthorityCaptureRecords>
	stageCount: (stage: WitnessStage) => number
}

function makeHost(opts: {
	sessionId: string
	agent: ReturnType<typeof makeSyntheticAgent>["agent"]
	isolationDir: string
	includePreludeHook: boolean
}): HostHarness {
	const witness: WitnessRecord[] = []
	const sessionService = makeSessionServiceStub()
	const runtimeBuilder = makeRuntimeBuilderStub()
	const pendingPromptCapture = {
		onRunTurnStarted: (input: { sessionId: string; delivery: "queue" | "steer" | undefined; jobId?: string }) => {
			witness.push({
				stage: "run_turn_started",
				sessionId: input.sessionId,
				delivery: input.delivery,
				jobId: input.jobId,
			})
			captureContinuationCardinalityAuthorityRecord({
				stage: "run_turn_started",
				origin: deriveOrigin(input.delivery, input.jobId),
				sessionId: input.sessionId,
				...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
			})
		},
		onAgentTurnDone: (input: {
			sessionId: string
			finishReason: string
			delivery: "queue" | "steer" | undefined
			jobId?: string
		}) => {
			witness.push({
				stage: "agent_turn_done",
				sessionId: input.sessionId,
				delivery: input.delivery,
				jobId: input.jobId,
				finishReason: input.finishReason,
			})
			captureContinuationCardinalityAuthorityRecord({
				stage: "agent_turn_done",
				origin: deriveOrigin(input.delivery, input.jobId),
				sessionId: input.sessionId,
				...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
			})
		},
		...(opts.includePreludeHook
			? {
					onExecuteTurnPreludeEnter: (input: {
						sessionId: string
						delivery: "queue" | "steer" | undefined
						jobId?: string
					}) => {
						witness.push({
							stage: "execute_turn_prelude_enter",
							sessionId: input.sessionId,
							delivery: input.delivery,
							jobId: input.jobId,
						})
						captureContinuationCardinalityAuthorityRecord({
							stage: "execute_turn_prelude_enter",
							origin: deriveOrigin(input.delivery, input.jobId),
							sessionId: input.sessionId,
							...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
						})
					},
				}
			: {}),
	}
	const host = new LocalRuntimeHost({
		distinctId: "act-pcrs02c01",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => opts.agent as never,
		logger: makeLoggerStub(),
		pendingPromptCapture,
	})
	return {
		host,
		sessionId: opts.sessionId,
		witness,
		ccardRecords: () => getContinuationCardinalityAuthorityCaptureRecords(),
		stageCount: (stage) => witness.filter((r) => r.stage === stage).length,
	}
}

describe("ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02-CORRECTION01 / PCRS02C01", () => {
	let isolationDir = ""
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "pcrs02c01-bridge-"))
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
		vi.restoreAllMocks()
	})

	// -----------------------------------------------------------------
	// PCRS02C01-01: real LocalRuntimeHost.runTurn → executeTurn chain
	// emits the prelude capture at the FIRST executable line of
	// executeTurn, BEFORE agent.run is called.
	// -----------------------------------------------------------------
	it("PCRS02C01-01: real host runTurn → executeTurn emits run_turn_started, execute_turn_prelude_enter, and agent_turn_done in order", async () => {
		const sessionId = "sess-pcrs02c01-01"
		const { agent } = makeCompletedAgent()
		const harness = makeHost({
			sessionId,
			agent,
			isolationDir,
			includePreludeHook: true,
		})

		await harness.host.startSession({
			source: "vscode",
			interactive: true,
			config: {
				sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "pcrs02c01 test agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		// Immediate runTurn (no delivery, canStartRun true).
		const result = await harness.host.runTurn({
			sessionId,
			prompt: "real host prelude proof prompt",
		})
		expect(result).toBeDefined()
		expect(result?.finishReason).toBe("completed")

		// Wait for the full ring to settle.
		await waitFor(() => harness.stageCount("agent_turn_done") >= 1, "agent_turn_done witness to be recorded")

		// 1. All three stages fire exactly once.
		expect(harness.stageCount("run_turn_started")).toBe(1)
		expect(harness.stageCount("execute_turn_prelude_enter")).toBe(1)
		expect(harness.stageCount("agent_turn_done")).toBe(1)

		// 2. The order is C7 -> prelude -> C8.
		const order = harness.witness.map((r) => r.stage)
		expect(order).toEqual(["run_turn_started", "execute_turn_prelude_enter", "agent_turn_done"])

		// 3. The CCARD capture helper records all three stages.
		const ccard = harness.ccardRecords()
		expect(ccard.filter((r) => r.stage === "run_turn_started")).toHaveLength(1)
		expect(ccard.filter((r) => r.stage === "execute_turn_prelude_enter")).toHaveLength(1)
		expect(ccard.filter((r) => r.stage === "agent_turn_done")).toHaveLength(1)

		// 4. The session settles back to idle.
		const finalSession = await harness.host.getSession(sessionId)
		expect(finalSession?.status).toBe("idle")

		await harness.host.dispose()
	})

	// -----------------------------------------------------------------
	// PCRS02C01-02: STALL fingerprint — when agent.run hangs after the
	// prelude completes, run_turn_started and execute_turn_prelude_enter
	// both fire (prelude entered), but agent_turn_done does NOT fire
	// (stall is inside executeAgentTurn).
	// -----------------------------------------------------------------
	it("PCRS02C01-02: real host STALL fingerprint — prelude fires but agent_turn_done absent when agent.run never resolves", async () => {
		const sessionId = "sess-pcrs02c01-02"
		const hanging = makeHangingAgent()
		const harness = makeHost({
			sessionId,
			agent: hanging.agent,
			isolationDir,
			includePreludeHook: true,
		})

		await harness.host.startSession({
			source: "vscode",
			interactive: true,
			config: {
				sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "pcrs02c02 hanging agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		// Fire the runTurn without awaiting completion (the agent.run
		// will hang — only the synchronous prelude completes).
		const pending = harness.host.runTurn({
			sessionId,
			prompt: "real host stall fingerprint prompt",
		})
		// Catch the pending promise to prevent unhandled rejection
		// when we abort below.
		pending.catch(() => {})

		// Wait for the synchronous prelude capture to land.
		await waitFor(
			() => harness.stageCount("execute_turn_prelude_enter") >= 1,
			"execute_turn_prelude_enter to fire (prelude entered)",
		)

		// Give a few microtask ticks to ensure C8 would have fired
		// by now if it were going to fire.
		for (let i = 0; i < 5; i++) {
			await new Promise((resolve) => setImmediate(resolve))
		}

		// Discriminator:
		//   C7 fired = 1, prelude fired = 1, C8 absent = 0
		//   -> EXECUTE_TURN_PRELUDE_STALL (stall inside executeAgentTurn)
		expect(harness.stageCount("run_turn_started")).toBe(1)
		expect(harness.stageCount("execute_turn_prelude_enter")).toBe(1)
		expect(harness.stageCount("agent_turn_done")).toBe(0)

		// The order so far is C7 -> prelude (no C8 yet).
		const order = harness.witness.map((r) => r.stage)
		expect(order).toEqual(["run_turn_started", "execute_turn_prelude_enter"])

		// Now unblock the agent.run and let it complete to clean up.
		hanging.unblockRun()
		// Wait for the agent to finish so the test cleans up properly.
		await pending
		await harness.host.dispose()
	})

	// -----------------------------------------------------------------
	// PCRS02C01-03: ABLATION — when the production hook is NOT wired
	// (includePreludeHook: false), the production code path does NOT
	// emit execute_turn_prelude_enter, even though run_turn_started
	// and agent_turn_done both fire normally.
	// -----------------------------------------------------------------
	it("PCRS02C01-03: ABLATION — when the prelude hook is NOT wired, execute_turn_prelude_enter is absent from the capture ring (proves the hook IS the seam)", async () => {
		const sessionId = "sess-pcrs02c01-03"
		const { agent } = makeCompletedAgent()
		const harness = makeHost({
			sessionId,
			agent,
			isolationDir,
			includePreludeHook: false,
		})

		await harness.host.startSession({
			source: "vscode",
			interactive: true,
			config: {
				sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "pcrs02c03 ablation agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		const result = await harness.host.runTurn({
			sessionId,
			prompt: "ablation prompt — no prelude hook wired",
		})
		expect(result).toBeDefined()
		expect(result?.finishReason).toBe("completed")

		await waitFor(() => harness.stageCount("agent_turn_done") >= 1, "agent_turn_done to fire")

		// Without the prelude hook wired, runTurn still fires C7 and
		// C8 (these are wired independently and not under test here),
		// but NO execute_turn_prelude_enter record exists. This proves
		// the seam is solely driven by the optional
		// `onExecuteTurnPreludeEnter` hook and not by any other
		// production-code side effect.
		expect(harness.stageCount("run_turn_started")).toBe(1)
		expect(harness.stageCount("execute_turn_prelude_enter")).toBe(0)
		expect(harness.stageCount("agent_turn_done")).toBe(1)

		// The CCARD helper did not see a prelude record either.
		const ccard = harness.ccardRecords()
		expect(ccard.filter((r) => r.stage === "execute_turn_prelude_enter")).toHaveLength(0)

		await harness.host.dispose()
	})

	// -----------------------------------------------------------------
	// PCRS02C01-04: SYNCHRONOUS BOUNDARY — prove the prelude capture
	// fires SYNCHRONOUSLY when `executeTurn` is called, BEFORE any
	// awaited promise inside executeTurn has a chance to schedule.
	// -----------------------------------------------------------------
	it("PCRS02C01-04: prelude capture fires SYNCHRONOUSLY at executeTurn entry (before the first await)", async () => {
		const sessionId = "sess-pcrs02c01-04"
		const hanging = makeHangingAgent()
		const harness = makeHost({
			sessionId,
			agent: hanging.agent,
			isolationDir,
			includePreludeHook: true,
		})

		await harness.host.startSession({
			source: "vscode",
			interactive: true,
			config: {
				sessionId,
				providerId: "mock-provider",
				modelId: "mock-model",
				cwd: isolationDir,
				workspaceRoot: isolationDir,
				systemPrompt: "pcrs02c04 sync-boundary agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		// Fire-and-forget: agent.run hangs, so the promise never
		// resolves.
		const pending = harness.host.runTurn({
			sessionId,
			prompt: "sync-boundary probe prompt",
		})
		pending.catch(() => {})

		// Wait for the run_turn_started (C7) witness, which fires
		// BEFORE the await this.executeTurn(...) line.
		await waitFor(() => harness.stageCount("run_turn_started") >= 1, "C7 (run_turn_started) to fire")

		// Drain a few microtasks. The prelude capture is synchronous
		// inside executeTurn, so it must be present now.
		for (let i = 0; i < 10; i++) {
			await new Promise((resolve) => setImmediate(resolve))
		}

		expect(harness.stageCount("execute_turn_prelude_enter")).toBe(1)
		expect(harness.stageCount("agent_turn_done")).toBe(0)

		// Unblock and clean up.
		hanging.unblockRun()
		await pending
		await harness.host.dispose()
	})
})
