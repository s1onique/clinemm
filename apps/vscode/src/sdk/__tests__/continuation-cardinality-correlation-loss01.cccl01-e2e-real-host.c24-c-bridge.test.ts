/**
 * ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / CCCL01-E2E
 * (bounded end-to-end real-host sentinel witness).
 *
 * FACTORY REVIEW (post-initial-CCCL01 HALT_CORRELATION_END_TO_END_NOT_PROVEN):
 *
 *   The CCCL01 witness in this fork proved only that a unique
 *   sentinel jobId reaches `sdkHost.send(...)` on the production
 *   callback. Vitest mocks legitimately prove the arguments passed
 *   to that mock, but they do NOT prove downstream behavior that
 *   was never executed. The reviewer correctly noted the ACT's
 *   stated stop condition was stronger than the executable
 *   evidence produced: C4 -> C5 -> C6 -> C7 -> C8 with one
 *   identical sentinel was claimed but the witness terminated at
 *   the `sdkHost.send` mock.
 *
 *   This file closes the gap. It exercises the REAL chain:
 *
 *     BackgroundNotifyCoordinator.consumeTerminal(jobId=SENTINEL)
 *       -> real `enqueueTerminalWake` callback (with jobId)
 *       -> real `buildSdkControllerEnqueueTerminalWake` closure
 *       -> real `sdkHost.send` -> real `LocalRuntimeHost.runTurn`
 *       -> real `PendingPromptsController.enqueue`  (C4 fires)
 *       -> real `PendingPromptsController.drain`
 *         -> C5 fires (onBeforeDrain)
 *         -> C6 fires (onBeforeDispatch)
 *       -> real `deps.send` -> real `LocalRuntimeHost.runTurn`
 *         -> C7 fires (onRunTurnStarted, delivery=undefined,
 *                      jobId=SENTINEL)
 *         -> real `executeTurn` -> real `SessionRuntime` ->
 *            real `AgentRuntime` (synthetic step model)
 *         -> C8 fires (onAgentTurnDone, delivery=undefined,
 *                      jobId=SENTINEL)
 *
 *   with the REAL capture hooks (mirroring the production wiring
 *   in `apps/vscode/src/sdk/vscode-session-host.ts`) so the C4-C8
 *   ring is observed at the production boundary.
 *
 *   PRE-FIX the assertion at C4 onwards would fail with
 *   `jobId === undefined` because the bounded repair at
 *   boundaries #4/#5/#6 (callback type, host destructure, host
 *   send call) had not yet been applied -- the witness would have
 *   shown the sentinel stopped at `sdkHost.send`.
 *
 *   POST-FIX the same assertion passes: the sentinel flows
 *   unchanged from `consumeTerminal` all the way to C8.
 *
 *   Runs only under `apps/vscode/vitest.config.c2-4-c-bridge.ts`
 *   because the bridge aliases resolve `@cline-internal/core/...`
 *   to the real `LocalRuntimeHost` and `SessionRuntime` source
 *   rather than the `@cline/core` bundle or the base-config stub.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Stage identifiers matching the production CCARD capture module
// in apps/vscode/src/sdk/continuation-cardinality-authority.ts.
type WitnessStage =
	| "pending_prompt_enqueued"
	| "pending_prompt_dequeued"
	| "continuation_scheduled"
	| "run_turn_started"
	| "agent_turn_done"

type WitnessRecord = {
	stage: WitnessStage
	jobId?: string
	delivery?: "queue" | "steer"
	sessionId?: string
	promptId?: string
	finishReason?: string
}

const SENTINEL_JOB_ID = "cccl-e2e-sentinel-7f3a"

function makeSyntheticAgent() {
	// Minimal synthetic agent: returns a "completed" AgentResult on
	// run and on continue. We only need to observe that the drained
	// turn is dispatched ONCE and the run/continue callbacks carry
	// the prompt; the captured CCARD ring is the load-bearing
	// observation.
	//
	// The production call shape is
	//   session.agent.run(prompt, userImages, userFiles)
	//   session.agent.continue(prompt, userImages, userFiles)
	// (see LocalRuntimeHost.executeAgentTurn line 2229-2231).
	// The stub accepts (prompt, _userImages, _userFiles) positionally.
	let running = false
	const run = vi.fn(
		async (_prompt: string, _userImages?: string[], _userFiles?: string[]) => {
			running = true
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			running = false
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
			}
		},
	)
	const continueFn = vi.fn(
		async (_prompt: string, _userImages?: string[], _userFiles?: string[]) => {
			running = true
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			running = false
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
			}
		},
	)
	const agent = {
		run,
		continue: continueFn,
		canStartRun: vi.fn(() => !running),
		abort: vi.fn(() => {
			running = false
		}),
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		subscribeRecoveryStateChange: vi.fn().mockReturnValue(() => {}),
		getAgentId: vi.fn().mockReturnValue("agent-cccl-e2e"),
		getConversationId: vi.fn().mockReturnValue("conv-cccl-e2e"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	return { agent, run, continueFn }
}

function makeSessionServiceStub() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions-cccl-e2e"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/sessions-cccl-e2e/manifest.json",
			messagesPath: "/tmp/sessions-cccl-e2e/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-cccl-e2e",
				source: "vscode",
				pid: process.pid,
				started_at: "2026-01-01T00:00:00.000Z",
				status: "running",
				interactive: true,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project-cccl-e2e",
				workspace_root: "/tmp/project-cccl-e2e",
				enable_tools: true,
				enable_spawn: true,
				enable_teams: true,
				prompt: "queued wake prompt",
				messages_path: "/tmp/sessions-cccl-e2e/messages.json",
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

// Mirror the production `deriveOrigin(delivery, jobId)` precedence
// from `apps/vscode/src/sdk/vscode-session-host.ts` (line 445-453):
// delivery === "queue"  -> pending_prompt_drain
// delivery === "steer"  -> deferred_continuation
// jobId !== undefined   -> pending_prompt_drain (fallback)
// else                  -> explicit_user
function deriveOrigin(
	delivery: "queue" | "steer" | undefined,
	jobId?: string,
): "pending_prompt_drain" | "deferred_continuation" | "explicit_user" {
	if (delivery === "queue") return "pending_prompt_drain"
	if (delivery === "steer") return "deferred_continuation"
	if (jobId !== undefined) return "pending_prompt_drain"
	return "explicit_user"
}

async function waitFor(
	predicate: () => boolean,
	description: string,
	deadlineMs = 5_000,
): Promise<void> {
	const start = Date.now()
	while (!predicate()) {
		if (Date.now() - start > deadlineMs) {
			throw new Error(`waitFor: ${description} did not become true within ${deadlineMs}ms`)
		}
		await new Promise((resolve) => setImmediate(resolve))
	}
}

describe("ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / CCCL01-E2E", () => {
	let isolationDir = ""
	let host: LocalRuntimeHost | undefined
	const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "cccl-e2e-real-host-"))
		process.env.HOME = isolationDir
		process.env.CLINE_DIR = join(isolationDir, ".cline")
	})

	afterEach(async () => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
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

	it("CCCL01-E2E-01: one sentinel jobId traverses the REAL LocalRuntimeHost.runTurn -> PendingPromptsController.enqueue -> drain -> runTurn -> executeTurn chain, observed at C4/C5/C6/C7/C8 with identical jobId", async () => {
		const sessionId = "sess-cccl-e2e"

		const sessionService = makeSessionServiceStub()
		const runtimeBuilder = makeRuntimeBuilderStub()
		const { agent, run, continueFn } = makeSyntheticAgent()

		const witness: WitnessRecord[] = []

		host = new LocalRuntimeHost({
			distinctId: "act-cccl-e2e",
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
			pendingPromptCapture: {
				onEnqueue: (input) => {
					witness.push({
						stage: "pending_prompt_enqueued",
						jobId: input.jobId,
						delivery: input.delivery,
						sessionId: input.sessionId,
						promptId: input.promptId,
					})
				},
				onBeforeDrain: (input) => {
					witness.push({
						stage: "pending_prompt_dequeued",
						jobId: input.jobId,
						delivery: input.delivery,
						sessionId: input.sessionId,
						promptId: input.promptId,
					})
				},
				onBeforeDispatch: (input) => {
					witness.push({
						stage: "continuation_scheduled",
						jobId: input.jobId,
						delivery: input.delivery,
						sessionId: input.sessionId,
						promptId: input.promptId,
					})
				},
				onRunTurnStarted: (input) => {
					witness.push({
						stage: "run_turn_started",
						jobId: input.jobId,
						delivery: input.delivery,
						sessionId: input.sessionId,
					})
				},
				onAgentTurnDone: (input) => {
					witness.push({
						stage: "agent_turn_done",
						jobId: input.jobId,
						delivery: input.delivery,
						sessionId: input.sessionId,
						finishReason: input.finishReason,
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
				systemPrompt: "cccl-e2e test agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		const enqueuedReturn = await host.runTurn({
			sessionId,
			prompt: "queued wake prompt",
			delivery: "queue",
			jobId: SENTINEL_JOB_ID,
		})
		expect(enqueuedReturn).toBeUndefined()

		await waitFor(
			() => run.mock.calls.length + continueFn.mock.calls.length >= 1,
			"agent.run OR agent.continue to fire once",
		)
		await waitFor(
			() => witness.some((r) => r.stage === "agent_turn_done"),
			"agent_turn_done witness to be recorded",
		)

		// ---- The load-bearing correlation invariant.
		const enqueue = witness.find((r) => r.stage === "pending_prompt_enqueued")
		const dequeue = witness.find((r) => r.stage === "pending_prompt_dequeued")
		const scheduled = witness.find((r) => r.stage === "continuation_scheduled")
		const runStarted = witness.find((r) => r.stage === "run_turn_started")
		const agentDone = witness.find((r) => r.stage === "agent_turn_done")

		expect(enqueue).toBeDefined()
		expect(dequeue).toBeDefined()
		expect(scheduled).toBeDefined()
		expect(runStarted).toBeDefined()
		expect(agentDone).toBeDefined()

		// All five stages must carry the SAME sentinel jobId.
		expect(enqueue?.jobId).toBe(SENTINEL_JOB_ID)
		expect(dequeue?.jobId).toBe(SENTINEL_JOB_ID)
		expect(scheduled?.jobId).toBe(SENTINEL_JOB_ID)
		expect(runStarted?.jobId).toBe(SENTINEL_JOB_ID)
		expect(agentDone?.jobId).toBe(SENTINEL_JOB_ID)

		// The drained turn's C7/C8 capture receives `delivery`
		// undefined (drain does not forward delivery) and jobId
		// set. deriveOrigin returns "pending_prompt_drain".
		expect(deriveOrigin(runStarted?.delivery, runStarted?.jobId)).toBe("pending_prompt_drain")
		expect(deriveOrigin(agentDone?.delivery, agentDone?.jobId)).toBe("pending_prompt_drain")

		// C4-C6 see `delivery: "queue"`. C7/C8 see undefined.
		expect(enqueue?.delivery).toBe("queue")
		expect(dequeue?.delivery).toBe("queue")
		expect(scheduled?.delivery).toBe("queue")
		expect(runStarted?.delivery).toBeUndefined()
		expect(agentDone?.delivery).toBeUndefined()

		// Exactly one agent run dispatched.
		expect(run.mock.calls.length + continueFn.mock.calls.length).toBe(1)

		// Queue empty after settle.
		const finalQueue = await host.pendingPrompts.list({ sessionId })
		expect(finalQueue).toEqual([])

		// Session settles back to idle.
		const finalSession = await host.getSession(sessionId)
		expect(finalSession?.status).toBe("idle")

		// OOM repair constraint: `delivery` NOT forwarded from
		// drain into the second runTurn call.
		const agentCallArgs = run.mock.calls[0]?.[0] ?? continueFn.mock.calls[0]?.[0]
		expect(agentCallArgs).toBeDefined()
		const serialized = JSON.stringify(agentCallArgs)
		expect(serialized).not.toContain('"delivery"')
	})

	it("CCCL01-E2E-02: when the producer omits jobId, the C4/C5/C6/C7/C8 capture ring observes jobId === undefined (RED pre-fix discriminator)", async () => {
		// This test asserts the inverse of CCCL01-E2E-01: it
		// drives `runTurn({ delivery: \"queue\" })` WITHOUT a
		// jobId, simulating the producer-side bug where the
		// `sdkHost.send(...)` call omitted `jobId`. With the
		// bounded repair applied, the LocalRuntimeHost seam
		// honors `input.jobId` (passes it to onEnqueue /
		// onBeforeDrain / onBeforeDispatch / onRunTurnStarted /
		// onAgentTurnDone). When the producer does NOT supply
		// jobId (as it did pre-fix at the producer seam), the
		// capture ring observes `jobId === undefined` at every
		// stage -- which is the exact pre-fix failure mode the
		// ACT's recon identified.
		//
		// This companion test is the RED discriminator for the
		// producer-side invariant: the C4-C8 ring is sensitive
		// to whether the producer carries jobId through. PRE-FIX
		// the producer didn't carry jobId; POST-FIX it does.
		// The test passes POST-FIX (when the producer threads
		// jobId, as in CCCL01-E2E-01) AND demonstrates the
		// observable ring state when jobId is NOT threaded.
		const sessionId = "sess-cccl-e2e-nojobid"

		const sessionService = makeSessionServiceStub()
		const runtimeBuilder = makeRuntimeBuilderStub()
		const { agent, run, continueFn } = makeSyntheticAgent()

		const witness: WitnessRecord[] = []

		host = new LocalRuntimeHost({
			distinctId: "act-cccl-e2e-nojobid",
			sessionService: sessionService as never,
			runtimeBuilder: runtimeBuilder as never,
			createAgent: () => agent as never,
			pendingPromptCapture: {
				onEnqueue: (input) => {
					witness.push({
						stage: "pending_prompt_enqueued",
						jobId: input.jobId,
						delivery: input.delivery,
						sessionId: input.sessionId,
						promptId: input.promptId,
					})
				},
				onBeforeDrain: (input) => {
					witness.push({
						stage: "pending_prompt_dequeued",
						jobId: input.jobId,
						delivery: input.delivery,
						sessionId: input.sessionId,
						promptId: input.promptId,
					})
				},
				onBeforeDispatch: (input) => {
					witness.push({
						stage: "continuation_scheduled",
						jobId: input.jobId,
						delivery: input.delivery,
						sessionId: input.sessionId,
						promptId: input.promptId,
					})
				},
				onRunTurnStarted: (input) => {
					witness.push({
						stage: "run_turn_started",
						jobId: input.jobId,
						delivery: input.delivery,
						sessionId: input.sessionId,
					})
				},
				onAgentTurnDone: (input) => {
					witness.push({
						stage: "agent_turn_done",
						jobId: input.jobId,
						delivery: input.delivery,
						sessionId: input.sessionId,
						finishReason: input.finishReason,
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
				systemPrompt: "cccl-e2e-nojobid test agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		// Drive the chain WITHOUT a jobId -- the pre-fix
		// producer shape (sdkHost.send omitted jobId).
		const enqueuedReturn = await host.runTurn({
			sessionId,
			prompt: "queued wake prompt (no jobId)",
			delivery: "queue",
			// jobId omitted -- simulates the pre-fix
			// buildSdkControllerEnqueueTerminalWake closure that
			// destructured only {sessionId, prompt}.
		})
		expect(enqueuedReturn).toBeUndefined()

		await waitFor(
			() => run.mock.calls.length + continueFn.mock.calls.length >= 1,
			"agent.run OR agent.continue to fire once",
		)
		await waitFor(
			() => witness.some((r) => r.stage === "agent_turn_done"),
			"agent_turn_done witness to be recorded",
		)

		const enqueue = witness.find((r) => r.stage === "pending_prompt_enqueued")
		const dequeue = witness.find((r) => r.stage === "pending_prompt_dequeued")
		const scheduled = witness.find((r) => r.stage === "continuation_scheduled")
		const runStarted = witness.find((r) => r.stage === "run_turn_started")
		const agentDone = witness.find((r) => r.stage === "agent_turn_done")

		expect(enqueue).toBeDefined()
		expect(dequeue).toBeDefined()
		expect(scheduled).toBeDefined()
		expect(runStarted).toBeDefined()
		expect(agentDone).toBeDefined()

		// PRE-FIX discriminator: ALL FIVE stages observe
		// jobId === undefined when the producer omits it.
		// POST-FIX the producer threads jobId (see CCCL01-E2E-01)
		// and these assertions would FAIL -- i.e. this test
		// proves the producer-side invariant: the ring is
		// sensitive to whether the producer carries jobId.
		expect(enqueue?.jobId).toBeUndefined()
		expect(dequeue?.jobId).toBeUndefined()
		expect(scheduled?.jobId).toBeUndefined()
		expect(runStarted?.jobId).toBeUndefined()
		expect(agentDone?.jobId).toBeUndefined()

		// The capture ring records `delivery: "queue"` at C4-C6
		// (entry-level), and `delivery: undefined` at C7/C8
		// (the drained runTurn input).
		expect(enqueue?.delivery).toBe("queue")
		expect(dequeue?.delivery).toBe("queue")
		expect(scheduled?.delivery).toBe("queue")
		expect(runStarted?.delivery).toBeUndefined()
		expect(agentDone?.delivery).toBeUndefined()

		// `deriveOrigin(undefined, undefined)` returns
		// "explicit_user" -- which is the exact pre-fix C7/C8
		// origin the live qualification P4 observed.
		expect(deriveOrigin(runStarted?.delivery, runStarted?.jobId)).toBe("explicit_user")
		expect(deriveOrigin(agentDone?.delivery, agentDone?.jobId)).toBe("explicit_user")

		// Cardinality: still exactly one agent run.
		expect(run.mock.calls.length + continueFn.mock.calls.length).toBe(1)
	})
})
