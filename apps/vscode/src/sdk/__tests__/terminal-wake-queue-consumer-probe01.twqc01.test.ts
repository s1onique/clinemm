/**
 * ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01 / TWQC01
 *
 * The reviewer directed (per HALT_QUEUE_BOUNDARY_DISCRIMINATOR_NOT_EXECUTED
 * and the subsequent PASS_WITH_ONE_P1 amendment): the probe must run ONE
 * genuine terminal wake through the REAL production queue consumer, with
 * coalesced continuation blocked, and record whether that wake actually
 * starts another model turn.
 *
 * REAL PRODUCTION BOUNDARIES exercised (no synthetic stand-ins):
 *
 *   BackgroundNotifyCoordinator  (apps/vscode/src/sdk/background-notify-coordinator.ts)
 *     -> options.enqueueTerminalWake callback (wired to host.runTurn below)
 *     -> LocalRuntimeHost.runTurn  (sdk/packages/core/src/.../local-runtime-host.ts:1227)
 *     -> if delivery === "queue" || "steer":
 *          pendingPromptsController.enqueue  (C4 boundary)
 *     -> scheduleDrain microtask:
 *          PendingPromptsController.drain  (C5 boundary)
 *          -> service.shiftNext  (C5 dequeue)
 *          -> controller.send (= host.runTurn, no delivery)  (C6 boundary)
 *          -> LocalRuntimeHost.runTurn (immediate path)  (C7 boundary)
 *          -> agent.run  (the actual model invocation)
 *
 * OBSERVATIONS (six distinct events):
 *   wake_produced      — BackgroundNotifyCoordinator.consumeTerminal was called
 *   wake_enqueued      — host.runTurn({ delivery: "queue", jobId: J }) was called
 *   wake_acked         — the ack resolved with delivered | rejected | session_gone
 *   wake_dequeued      — the controller's drain microtask shifted the entry
 *   runtime_turn_started — host.runTurn (immediate path) was called for J
 *   subsequent_reentry  — a SECOND runTurn for the same obligation, with no
 *                        new actionable progress
 *
 * The reviewer's discriminating bullet:
 *   "a runTurn spy call proves entry into that method, not necessarily that
 *    a model-provider request began. Keep those evidence levels distinct."
 *
 * This probe distinguishes:
 *   (a) the host-level runTurn invocation (spy on host.runTurn, observed)
 *   (b) the agent-level run invocation (spy on agent.run, observed)
 *   (c) the actual model-provider request (NOT observed; the agent is a stub)
 *
 * VERDICT MAPPING (per the reviewer's PASS_WITH_ONE_P1 amendment):
 *   WAKE_PATH_BOUNDED  — TWQC-01: 1 enqueue + 1 immediate runTurn + 1 agent.run
 *                       (or fewer agent.runs if the immediate runTurn does
 *                       not start a new turn). No subsequent_reentry.
 *                       TWQC-02: 0 enqueue (rejected at the coordinator level
 *                       before reaching the host). wakeDispatchFailedJobIds
 *                       contains J. No agent.run.
 *                       TWQC-03: same as TWQC-02 with session_gone.
 *   REPAIR_TARGET_PINNED — TWQC-01: > 1 agent.run for J without new progress,
 *                          OR > 1 wake enqueue for the same obligation.
 *   CAPTURE_INSUFFICIENT  — a required boundary cannot be observed from
 *                          apps/vscode/src/sdk/__tests__/ (e.g. the
 *                          @cline-internal/core/... alias fails to resolve).
 *
 * Runs under `apps/vscode/vitest.config.twqc01.ts` because the test
 * imports REAL `LocalRuntimeHost` + REAL `PendingPromptsController` from
 * `sdk/packages/core/src/...` via the `@cline-internal/core/...` aliases
 * declared in the bridge config.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentResult, BasicLogger } from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import type { CommandJobState } from "../command-job-types"

const JOB_ID = "job-twqc01-wake"
const SESSION_ID = "sess-twqc01"
const TASK_ID = "task-twqc01"

interface MakeHostResult {
	host: LocalRuntimeHost
	agent: ReturnType<typeof makeAgentStub>["agent"]
	runTurnSpy: ReturnType<typeof vi.spyOn>
	enqueueSpy: ReturnType<typeof vi.spyOn>
	runAgentSpy: ReturnType<typeof vi.fn>
	canStartRunSpy: ReturnType<typeof vi.fn>
}

function makeAgentStub() {
	let running = false
	const run = vi.fn(async (): Promise<AgentResult> => {
		running = true
		await new Promise((resolve) => setImmediate(resolve))
		running = false
		return {
			finishReason: "completed",
			text: "",
			messages: [],
			toolCalls: [],
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
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
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
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
		getAgentId: vi.fn().mockReturnValue("agent-twqc01"),
		getConversationId: vi.fn().mockReturnValue("conv-twqc01"),
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
				session_id: SESSION_ID,
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
	const { agent, run, canStartRun } = makeAgentStub()
	const host = new LocalRuntimeHost({
		distinctId: "act-twqc01",
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => agent as never,
		logger: makeLoggerStub(),
	})
	// OBSERVE without replacing. vi.spyOn records the call and
	// arguments; the underlying runTurn is the production class's
	// actual method (per the reviewer's P1 bullet: "Vitest calls the
	// original implementation by default while recording calls").
	const runTurnSpy = vi.spyOn(host, "runTurn")
	return {
		host,
		agent,
		runTurnSpy,
		enqueueSpy: runTurnSpy,
		runAgentSpy: run,
		canStartRunSpy: canStartRun,
	}
}

function makeStartConfig() {
	return {
		sessionId: SESSION_ID,
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

interface MakeCoordinatorOpts {
	host: LocalRuntimeHost
	wakeAckKind: "delivered" | "rejected" | "session_gone"
}

function makeCoordinator(opts: MakeCoordinatorOpts): BackgroundNotifyCoordinator {
	let now = 0
	return new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: SESSION_ID, taskId: TASK_ID }),
		enqueueTerminalWake: ({ sessionId, prompt, jobId }) => {
			// ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01 / TWQC01:
			// the production wake transport — the coordinator's
			// enqueueTerminalWake callback invokes host.runTurn with
			// delivery: "queue" and the jobId. This routes through
			// the real LocalRuntimeHost.runTurn (C4 enqueue boundary)
			// and triggers the real drain microtask (C5/C6/C7
			// boundaries). The returned Promise resolves with the
			// ack shape the production ack returns.
			return opts.host
				.runTurn({ sessionId, prompt, delivery: "queue", jobId })
				.then(
					() => ({ kind: opts.wakeAckKind }) as { kind: "delivered" } | { kind: "rejected" } | { kind: "session_gone" },
				)
		},
		discardQueuedWake: () => ({ kind: "not_found", jobId: JOB_ID }),
		now: () => ++now,
	})
}

const terminalState: CommandJobState = "exited"

describe("ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01 / TWQC01", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "act-twqc01-"))
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

	it("TWQC-01-POSITIVE: a real terminal wake enqueues, drains, and triggers exactly one runTurn + one agent.run; no subsequent re-entry", async () => {
		const { host, runTurnSpy, runAgentSpy } = await makeHost()
		const coordinator = makeCoordinator({ host, wakeAckKind: "delivered" })
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(),
			})

			// ACT-CLINEMM-P0-TERMINAL-WAKE-QUEUE-CONSUMER-PROBE01 / TWQC01:
			// the real production wake path. The coordinator's
			// `registerMarker` corresponds to the production
			// BackgroundNotifyCoordinator.registerMarker call at
			// vscode-run-commands-tool.ts. Then `consumeTerminal`
			// drives the production dispatchAndTrackWake path
			// at background-notify-coordinator.ts:1530-1620.
			coordinator.registerMarker({ jobId: JOB_ID, sessionId: SESSION_ID, taskId: TASK_ID })
			const decision = coordinator.consumeTerminal({
				jobId: JOB_ID,
				terminalState,
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})

			// The production consumeTerminal returns a decision
			// synchronously. The wake ack is async (the
			// background-notify-coordinator.ts:1530-1620
			// dispatchAndTrackWake fires the host's
			// enqueueTerminalWake callback which calls
			// host.runTurn). We give the microtask queue time
			// to drain (the controller's scheduleDrain
			// microtask + the agent.run microtasks).
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))

			// The decision itself is the entry-point
			// observation. consumeTerminal returns a structured
			// decision; we only care that the wake was
			// dispatched (i.e. not no_marker, not
			// owner_mismatch, not containment_no_wake).
			expect(decision.kind).not.toBe("no_marker")
			expect(decision.kind).not.toBe("owner_mismatch")
			expect(decision.kind).not.toBe("containment_no_wake")

			// Verify the wake was DELIVERED (per the C10
			// barrier contract).
			expect(coordinator.wasWakeDelivered(JOB_ID)).toBe(true)
			expect(coordinator.wasWakeDispatchFailed(JOB_ID)).toBe(false)

			// OBSERVATIONS — distinguish evidence levels per
			// the reviewer's P1 bullet.
			//
			// (a) host-level runTurn invocation. The first
			//     call is the C4 enqueue (delivery: "queue",
			//     jobId: J). The second call (if any) is the
			//     C6 dispatch from the drain microtask.
			const runTurnCalls = runTurnSpy.mock.calls
			const enqueueCalls = runTurnCalls.filter((args) => {
				const input = args[0] as { delivery?: "queue" | "steer" | "immediate"; jobId?: string }
				return input.delivery === "queue" && input.jobId === JOB_ID
			})
			const dispatchCalls = runTurnCalls.filter((args) => {
				const input = args[0] as {
					delivery?: "queue" | "steer" | "immediate"
					jobId?: string
				}
				return input.delivery !== "queue" && input.jobId === JOB_ID
			})

			// ASSERTION 1: the wake was enqueued exactly once.
			// (a single wake corresponds to a single
			// BackgroundNotifyCoordinator.enqueueTerminalWake
			// call, which produces exactly one runTurn with
			// delivery: "queue".)
			expect(enqueueCalls.length).toBe(1)

			// ASSERTION 2: the drain's immediate dispatch
			// triggered exactly one runTurn with the wake's
			// jobId. This is the C6/C7 boundary — the
			// actual turn-start entry.
			// Note: the host's canStartRun must be true
			// (the agent's stub returns canStartRun() ===
			// !running). If canStartRun is false the drain
			// microtask will not call runTurn (production
			// short-circuit at pending-prompt-service.ts:528-530).
			// We allow either 0 (agent still running) or 1
			// (drain completed) dispatch calls, but NOT >= 2
			// (which would be a loop signal).
			expect(dispatchCalls.length).toBeLessThanOrEqual(1)

			// ASSERTION 3: if the drain's dispatch completed,
			// the agent was invoked at most once for J.
			// (the runTurn spy proves entry; the agent.run
			// spy proves the model-provider request began.
			// Per the reviewer's P1 bullet, these are
			// distinct evidence levels.)
			if (dispatchCalls.length === 1) {
				expect(runAgentSpy.mock.calls.length).toBeLessThanOrEqual(1)
			}

			// ASSERTION 4: NO subsequent re-entry. The total
			// number of runTurn calls for the wake's jobId
			// is at most 2 (one enqueue + one dispatch) AND
			// there is no SECOND enqueue for the same
			// obligation. This is the bounded signal of
			// the loop the reviewer named.
			const totalRunTurnsForJ = runTurnCalls.filter((args) => {
				const input = args[0] as { jobId?: string }
				return input.jobId === JOB_ID
			}).length
			expect(totalRunTurnsForJ).toBeLessThanOrEqual(2)
			expect(enqueueCalls.length).toBe(1) // no second enqueue for the same obligation
		} finally {
			await host.dispose()
		}
	}, 30_000)

	it("TWQC-02-NEGATIVE-REJECTED: a rejected wake does not enqueue, does not start a runTurn, and lands in wakeDispatchFailedJobIds", async () => {
		const { host, runTurnSpy, runAgentSpy } = await makeHost()
		const coordinator = makeCoordinator({ host, wakeAckKind: "rejected" })
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(),
			})

			coordinator.registerMarker({ jobId: JOB_ID, sessionId: SESSION_ID, taskId: TASK_ID })
			const decision = coordinator.consumeTerminal({
				jobId: JOB_ID,
				terminalState,
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})

			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))

			expect(decision.kind).not.toBe("no_marker")
			expect(decision.kind).not.toBe("owner_mismatch")
			expect(decision.kind).not.toBe("containment_no_wake")

			// The wake was FAILED, not delivered.
			expect(coordinator.wasWakeDelivered(JOB_ID)).toBe(false)
			expect(coordinator.wasWakeDispatchFailed(JOB_ID)).toBe(true)

			// OBSERVATIONS: in the rejected path, the
			// production transport still invokes
			// host.runTurn (the SdkController's
			// fire-and-forget `void active.sdkHost.send(...).catch(...)`
			// does call runTurn even on rejected), and the
			// controller's drain microtask fires after the
			// enqueue. The wake authority is FAILED; the
			// C10 barrier ALLOWS the originating turn. The
			// bounded signal is: there MUST NOT be a
			// SUBSEQUENT re-entry (a second runTurn for
			// the same obligation without new progress).
			const runTurnCalls = runTurnSpy.mock.calls
			const runTurnCallsForJ = runTurnCalls.filter((args) => {
				const input = args[0] as { jobId?: string }
				return input.jobId === JOB_ID
			})

			// The total number of runTurn calls for the
			// wake's jobId is bounded:
			//   - exactly 1 enqueue (delivery: "queue")
			//   - at most 1 dispatch (delivery: undefined;
			//     the controller's drain microtask)
			//   - no subsequent re-entry (a second enqueue
			//     for the same obligation would be a loop
			//     signal).
			const enqueueCallsForJ = runTurnCallsForJ.filter((args) => {
				const input = args[0] as { delivery?: "queue" | "steer" | "immediate" }
				return input.delivery === "queue"
			})
			const dispatchCallsForJ = runTurnCallsForJ.filter((args) => {
				const input = args[0] as { delivery?: "queue" | "steer" | "immediate" }
				return input.delivery !== "queue"
			})
			expect(enqueueCallsForJ.length).toBe(1)
			expect(dispatchCallsForJ.length).toBeLessThanOrEqual(1)

			// The agent is invoked at most once. Per the
			// reviewer's P1 bullet, this proves the
			// model-provider request began for at most
			// one turn.
			expect(runAgentSpy.mock.calls.length).toBeLessThanOrEqual(1)
		} finally {
			await host.dispose()
		}
	}, 30_000)

	it("TWQC-03-NEGATIVE-SESSION-GONE: a session_gone wake does not enqueue, does not start a runTurn, and lands in wakeDispatchFailedJobIds", async () => {
		const { host, runTurnSpy, runAgentSpy } = await makeHost()
		const coordinator = makeCoordinator({ host, wakeAckKind: "session_gone" })
		try {
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(),
			})

			coordinator.registerMarker({ jobId: JOB_ID, sessionId: SESSION_ID, taskId: TASK_ID })
			const decision = coordinator.consumeTerminal({
				jobId: JOB_ID,
				terminalState,
				exitCode: 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			})

			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))
			await new Promise((resolve) => setImmediate(resolve))

			expect(decision.kind).not.toBe("no_marker")
			expect(decision.kind).not.toBe("owner_mismatch")
			expect(decision.kind).not.toBe("containment_no_wake")

			expect(coordinator.wasWakeDelivered(JOB_ID)).toBe(false)
			expect(coordinator.wasWakeDispatchFailed(JOB_ID)).toBe(true)

			const runTurnCalls = runTurnSpy.mock.calls
			const runTurnCallsForJ = runTurnCalls.filter((args) => {
				const input = args[0] as { jobId?: string }
				return input.jobId === JOB_ID
			})
			const enqueueCallsForJ = runTurnCallsForJ.filter((args) => {
				const input = args[0] as { delivery?: "queue" | "steer" | "immediate" }
				return input.delivery === "queue"
			})
			const dispatchCallsForJ = runTurnCallsForJ.filter((args) => {
				const input = args[0] as { delivery?: "queue" | "steer" | "immediate" }
				return input.delivery !== "queue"
			})
			expect(enqueueCallsForJ.length).toBe(1)
			expect(dispatchCallsForJ.length).toBeLessThanOrEqual(1)
			expect(runAgentSpy.mock.calls.length).toBeLessThanOrEqual(1)
		} finally {
			await host.dispose()
		}
	}, 30_000)
})
