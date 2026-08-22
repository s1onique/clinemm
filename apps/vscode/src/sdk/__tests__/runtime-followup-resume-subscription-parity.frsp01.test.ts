/**
 * ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01 / FRSP01 — Phase 1
 * behavioral RED at the production follow-up resume seam.
 *
 * SCOPE (per Factory reviewer authorization, FRSP01)
 * ------------------------------------------------
 * RSR01-CORRECTION01 (`apps/vscode/src/sdk/__tests__/runtime-shadow-reactivation.rsr01-correction01.test.ts`,
 * commit e29e5f655) PROVED: production `SdkController.reinitExistingTaskFromId`
 * reaches `attachCanonicalRuntimeEventSubscription` correctly when the
 * `sessionId === taskId` fence passes. D2 AT THE REINIT SEAM is REJECTED.
 *
 * But recon §2 surfaced a STRUCTURAL DEFECT elsewhere:
 * `SdkFollowupCoordinator.resumeSessionFromTask`
 * (`apps/vscode/src/sdk/sdk-followup-coordinator.ts:188-260`) calls
 * `sessions.startNewSession(...)` DIRECTLY at line 204, bypassing
 * `SdkController` entirely. The follow-up path NEVER invokes
 * `attachCanonicalRuntimeEventSubscription` — the canonical
 * subscription is whatever was last attached, which is the OLD
 * `SessionRuntime` instance (disposed by `startNewSession` →
 * `endActiveSession` → `stopSession`).
 *
 * This test reproduces the BEHAVIORAL CONSEQUENCE of that defect
 * (not just the structural absence of the attach call). It does NOT
 * manually reattach anything on behalf of production; production
 * must earn the call.
 *
 * PHASES
 * ------
 * Phase 0 (recon): frozen in CORRECTION01 + this test's
 *   `SdkFollowupCoordinator` option harness shape.
 *
 * Phase 1 (this file): BEHAVIORAL RED on the production follow-up
 *   resume path, mirroring the W3/W5 chronology on real
 *   LocalRuntimeHost + real CanonicalRuntimeShadowSubscription +
 *   real SdkFollowupCoordinator + real `sessions.startNewSession`
 *   that drives `host.stopSession(prevId) + host.startSession(newConfig)`.
 *
 * Phase 2 (parity discriminator): compare REINIT (GREEN today, per
 *   CORRECTION01) vs FOLLOW-UP (RED expected here).
 *
 * Phase 3 (bounded repair): only if Phase 1 reproduces — added in a
 *   follow-up ACT row.
 *
 * WITNESSES
 * ---------
 *   W1 (CONTROL, GREEN): start session A; attach canonical
 *      subscription; emit run-started on agent[0]; assert shadow
 *      received ≥1 observation.
 *
 *   W2 (PHASE 1 RED, expected): drive the PRODUCTION
 *      `coordinator.tryResumeSessionFromTask(task, prompt)` for the
 *      SAME sessionId A; this triggers `sessions.startNewSession`
 *      which stops A and starts a NEW A on the same host with a
 *      fresh agent[1]; emit run-started on agent[1]; assert shadow
 *      received ZERO new observations (bug).
 *
 *   W3 (PARITY DISCRIMINATOR): in the SAME test run, drive the
 *      production `reinitExistingTaskFromId` path (extracted body)
 *      for the same sessionId A; assert shadow received ≥1
 *      observation. This proves the asymmetry is at the follow-up
 *      path, not in the canonical subscription transport.
 *
 *   W4 (NEGATIVE CONTROL, expected GREEN): when the follow-up
 *      resume explicitly re-attaches (which production DOES NOT do),
 *      the shadow DOES receive the new agent's events. This proves
 *      the transport is functional and the only missing piece is
 *      the attach call.
 *
 * REPAIR BUDGET
 * -------------
 * This ACT does NOT repair. If W2 REDs, classification is
 * `D2c_CONFIRMED_NO_REATTACH_ON_FOLLOWUP_PATH`. The bounded repair
 * ACT comes next.
 *
 * CONSERVATION
 * ------------
 * - No production code change.
 * - No new public API.
 * - No permanent runtime instrumentation.
 * - No message/wire field.
 * - No UI authority.
 *
 * Bridge config: `apps/vscode/vitest.config.c2-4-c-bridge.ts`.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Unsubscribe } from "../canonical-event-subscription"
import { subscribeCanonicalRuntimeEventsToShadow } from "../canonical-event-subscription"
import type { ActiveSession } from "../cline-session-factory"
import type { SdkFollowupCoordinatorOptions } from "../sdk-followup-coordinator"
import { SdkFollowupCoordinator } from "../sdk-followup-coordinator"
import { createTaskShadowHostWiring, emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"

const NOW = 1_700_000_000_000

// =========================================================================
// Event fixtures (mirrors RSR01 exactly).
// =========================================================================

function makeSnapshot(status: AgentRuntimeStateSnapshot["status"]): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status,
		iteration: 0,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as readonly string[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

function runStartedEvent(runId: string): AgentRuntimeEvent {
	return { type: "run-started", snapshot: { ...makeSnapshot("running"), runId } }
}

function executionStateChanged(
	runId: string,
	previousExecution: { modelStreaming: boolean; tooling: boolean; awaitingApproval: boolean },
): AgentRuntimeEvent {
	return {
		type: "execution-state-changed",
		snapshot: { ...makeSnapshot("running"), runId },
		previousExecution,
	}
}

function runFinishedEvent(runId: string): AgentRuntimeEvent {
	return {
		type: "run-finished",
		snapshot: { ...makeSnapshot("completed"), runId },
		result: {
			agentId: "agent_test",
			runId,
			status: "completed" as const,
			iterations: 1,
			outputText: "ok",
			messages: [] as readonly AgentMessage[],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
		},
	}
}

function makeStubAgent(events: AgentRuntimeEvent[]) {
	const listeners = new Set<(event: AgentRuntimeEvent) => void>()
	const baseResult = {
		agentId: "agent_test",
		runId: "run_test",
		status: "completed" as const,
		iterations: 1,
		outputText: "ok",
		messages: [] as readonly never[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
	const agent = {
		run: vi.fn(async () => {
			for (const ev of events) {
				for (const l of listeners) l(ev)
			}
			return baseResult
		}),
		continue: vi.fn(async () => {
			for (const ev of events) {
				for (const l of listeners) l(ev)
			}
			return baseResult
		}),
		abort: vi.fn(),
		subscribe: vi.fn(),
		subscribeEvents: vi.fn(() => () => {}),
		subscribeRuntimeEvents: vi.fn((listener: (event: AgentRuntimeEvent) => void) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		}),
		subscribeRecoveryStateChange: vi.fn(() => () => {}),
		canStartRun: vi.fn(() => true),
		shutdown: vi.fn(async () => {}),
		getMessages: vi.fn(() => []),
		getAgentId: vi.fn(() => "agent_test"),
		getConversationId: vi.fn(() => "conv_test"),
		getStateSnapshot: vi.fn(() => makeSnapshot("running")),
	}
	return agent
}

// =========================================================================
// Wiring deps (C2.4-C shape, mirrors RSR01).
// =========================================================================

const lifecycleActiveSessionId: { value: string | undefined } = { value: undefined }

function makeActiveSession(sessionId: string): ActiveSession {
	return {
		sessionId,
		sdkHost: undefined as never,
		unsubscribe: () => undefined,
		isRunning: true,
	} as unknown as ActiveSession
}

function makeWiringDeps() {
	return {
		lifecycle: {
			getActiveSession: () => {
				const id = lifecycleActiveSessionId.value
				return id ? makeActiveSession(id) : undefined
			},
			setRunning: () => undefined,
		},
		sessionOptions: {
			mcpHub: undefined,
			requestToolApproval: undefined,
			askQuestion: undefined,
			onSessionEvent: () => {},
			onSendComplete: async () => {},
			onSendError: async () => {},
		} as never,
		getLegacyPhase: () => "idle" as const,
		getArbiterSnapshot: () => emptyArbiterSnapshot(),
		now: () => NOW,
	}
}

// =========================================================================
// Host construction. `createAgent` factory returns a FRESH stub for each
// call, simulating a fresh SessionRuntime/AgentRuntime composition on
// resume (matches the live capture's "resume creates a new agent"
// reality).
// =========================================================================

function makeRealHostWithFreshAgent(isolatedHomeDir: string) {
	const stubAgents: Array<ReturnType<typeof makeStubAgent>> = []
	const eventScripts: AgentRuntimeEvent[][] = [[]]
	const runtimeBuilder = {
		build: vi.fn().mockReturnValue({
			tools: [],
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}
	const host = new LocalRuntimeHost({
		distinctId: "frsp01",
		sessionService: new FileSessionService(join(isolatedHomeDir, "sessions")),
		runtimeBuilder: runtimeBuilder as never,
		createAgent: (() => {
			const events = eventScripts[eventScripts.length - 1] ?? []
			const stub = makeStubAgent(events)
			stubAgents.push(stub)
			return stub as never
		}) as never,
	})
	return {
		host,
		stubAgents,
		queueNextAgentEvents(events: AgentRuntimeEvent[]) {
			eventScripts.push(events)
		},
	}
}

async function startSessionAt(host: LocalRuntimeHost, sessionId: string) {
	return await host.startSession({
		config: {
			sessionId,
			providerId: "mock-provider",
			modelId: "mock-model",
			systemPrompt: "test",
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		},
	})
}

// =========================================================================
// Follow-up options harness. The ONLY non-trivial override is
// `sessions.startNewSession`: it must call `host.stopSession(prevId)`
// then `host.startSession(input)` on the REAL `LocalRuntimeHost`. This
// preserves the production lifecycle symmetry (previous session stops,
// new session starts under the same logical id) so the canonical
// subscription's listener pool reflects the actual production state.
//
// Everything else is a passthrough stub matching the existing
// `sdk-followup-coordinator.test.ts` shape. Importantly, this
// harness DOES NOT call `attachCanonicalRuntimeEventSubscription`
// anywhere — that is the production defect under test.
// =========================================================================

interface FollowupHarnessOpts {
	host: LocalRuntimeHost
	currentSessionId: () => string | undefined
}

function makeFollowupOptions(opts: FollowupHarnessOpts): SdkFollowupCoordinatorOptions {
	const host = opts.host
	const currentSessionId = opts.currentSessionId
	const config = {
		providerId: "anthropic",
		modelId: "model",
		apiKey: "key",
		// SdkFollowupCoordinator.resumeSessionFromTask reads
		// `startInput.config.sessionId` to pin identity — LocalRuntimeHost
		// uses the same field.
	}
	const tempHost = {
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
	return {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => "act"),
		} as never,
		interactions: {
			resolvePendingToolApproval: vi.fn(() => false),
			resolvePendingAskQuestion: vi.fn(() => false),
		} as never,
		sessions: {
			getActiveSession: vi.fn(() => {
				const id = currentSessionId()
				if (!id) return undefined
				return {
					sessionId: id,
					sdkHost: { send: vi.fn() },
					isRunning: false,
				}
			}),
			setRunning: vi.fn(),
			fireAndForgetSend: vi.fn(),
			startNewSession: vi.fn(async (input) => {
				// Production lifecycle symmetry: stop the previous session
				// (disposes the canonical subscription's listener pool for
				// the OLD agent), then start the new session under the
				// same logical id (creates a fresh agent with no listener).
				const prevId = currentSessionId()
				if (prevId && prevId !== input.config.sessionId) {
					throw new Error(
						`startNewSession harness: previous session id mismatch (${prevId} vs ${input.config.sessionId})`,
					)
				}
				if (prevId) {
					await host.stopSession(prevId)
				}
				const result = await host.startSession({
					...input,
					config: {
						...input.config,
						sessionId: input.config.sessionId,
						// Provide the same fields startSessionAt does so
						// LocalRuntimeHost.startResolvedSession can
						// build the runtime.
						enableTools: false,
						enableSpawnAgent: false,
						enableAgentTeams: false,
						systemPrompt: "test",
					},
				})
				return {
					status: "started",
					startResult: { sessionId: input.config.sessionId },
					sdkHost: { send: vi.fn() } as never,
				}
			}),
			endActiveSession: vi.fn(async () => {
				const id = currentSessionId()
				if (id) await host.stopSession(id)
			}),
		} as never,
		messages: {
			appendAndEmit: vi.fn(),
			emitSessionEvents: vi.fn(),
		} as never,
		taskHistory: {
			findHistoryItem: vi.fn(async (taskId: string) => ({
				id: taskId,
				ts: 1700000000000,
				task: "previous task",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			})),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			updateTaskHistoryItem: vi.fn().mockResolvedValue(undefined),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			getLegacyResumeInitialMessages: vi.fn(async (_taskId: string, fallbackMessages?: unknown[]) => fallbackMessages),
		} as never,
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		} as never,
		getTask: vi.fn(() => ({ taskId: currentSessionId() ?? "A", taskState: {} })) as never,
		createTempSessionHost: vi.fn().mockResolvedValue(tempHost),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		buildStartSessionInput: vi.fn(() => ({ prompt: "start" })) as never,
		resolveContextMentions: vi.fn(async (text: string) => `resolved: ${text}`),
		isClineManagedProviderActive: vi.fn(() => false),
		emitClineAuthError: vi.fn(),
		resetMessageTranslator: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		waitForPendingRebuilds: vi.fn().mockResolvedValue(undefined),
		runExclusive: vi.fn(async (operation: () => Promise<unknown>) => operation()) as never,
		onResumeFailed: vi.fn(),
		onFollowUpAbandoned: vi.fn(),
	}
}

// =========================================================================
// Tests
// =========================================================================

describe("FRSP01 — Follow-up resume subscription parity (Phase 1 behavioral RED)", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		lifecycleActiveSessionId.value = undefined
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "frsp01-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
	})

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	// ---- W1 (CONTROL, expected GREEN) ----
	it("FRSP01-W1 CONTROL — first startSession(A) + attach + agent[0].run() reaches shadow", async () => {
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		// queueNextAgentEvents MUST come BEFORE startSessionAt so the
		// fresh agent picks up the events.
		queueNextAgentEvents([
			runStartedEvent("run-1"),
			executionStateChanged("run-1", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-1"),
		])

		await startSessionAt(host, "A")
		expect(stubAgents.length).toBe(1)
		lifecycleActiveSessionId.value = "A" // wiring NO_ACTIVE_SESSION guard requires this.

		const wiring = createTaskShadowHostWiring(makeWiringDeps() as never)
		// Production initTask-time attach (line 1797 of SdkController).
		const unsub: Unsubscribe = subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")

		await stubAgents[0].run()

		const before = wiring.recorderCounts().eventsObserved
		expect(before).toBeGreaterThanOrEqual(3)
		unsub()
	})

	// ---- W2 (PHASE 1 RED, expected RED) ----
	it("FRSP01-W2 RED — follow-up resume on same sessionId leaves canonical subscription bound to old agent; new agent events lost", async () => {
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps() as never)

		// Phase A — first start (production initTask). Queue events
		// BEFORE startSessionAt so the fresh agent picks them up.
		queueNextAgentEvents([
			runStartedEvent("run-1"),
			executionStateChanged("run-1", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-1"),
		])

		await startSessionAt(host, "A")
		expect(stubAgents.length).toBe(1)
		lifecycleActiveSessionId.value = "A"
		subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")

		await stubAgents[0].run()
		const controlObservations = wiring.recorderCounts().eventsObserved
		expect(controlObservations).toBeGreaterThanOrEqual(3)

		// Phase B — queue events for the NEXT agent (agent[1]) BEFORE
		// the follow-up resume creates it. The harness's createAgent
		// factory reads the latest eventScripts entry.
		queueNextAgentEvents([
			runStartedEvent("run-2"),
			executionStateChanged("run-2", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-2"),
		])

		// Production FOLLOW-UP RESUME for the same sessionId "A".
		// Drives the actual SdkFollowupCoordinator path through
		// `askResponse → tryResumeSessionFromTask → resumeSessionFromTask`.
		// The harness's startNewSession performs host.stopSession(A) +
		// host.startSession(A) (lifecycle symmetry), creating stubAgents[1].
		let currentId: string | undefined = "A"
		const options = makeFollowupOptions({ host, currentSessionId: () => currentId })
		const coordinator = new SdkFollowupCoordinator(options)
		await coordinator.askResponse("continue")

		// The follow-up path created a fresh agent[1] under the same
		// logical id. The previous listener on agent[0] was disposed
		// by host.stopSession(A). The canonical subscription is NOT
		// re-attached to agent[1].
		expect(stubAgents.length).toBe(2)
		currentId = "A"
		lifecycleActiveSessionId.value = "A" // wiring still has a session.

		// Phase C — run the new agent. If the canonical subscription
		// were bound to agent[1], events would reach the wiring.
		await stubAgents[1].run()

		// THE RED: shadow received ZERO new observations since the
		// control phase. The new agent's events are lost because the
		// canonical subscription's listener pool is bound to agent[0],
		// not agent[1].
		const afterObservations = wiring.recorderCounts().eventsObserved
		expect(afterObservations).toBe(controlObservations)
	})

	// ---- W3 (PARITY DISCRIMINATOR, expected GREEN) ----
	it("FRSP01-W3 PARITY — REINIT path DOES deliver new agent events (asymmetry is on the follow-up path, not the transport)", async () => {
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps() as never)

		// Queue events for both agents BEFORE the first startSessionAt so
		// each fresh agent picks them up at createAgent time.
		queueNextAgentEvents([
			runStartedEvent("run-1"),
			executionStateChanged("run-1", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-1"),
		])

		await startSessionAt(host, "A")
		expect(stubAgents.length).toBe(1)
		lifecycleActiveSessionId.value = "A"
		subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")

		await stubAgents[0].run()
		const controlObservations = wiring.recorderCounts().eventsObserved
		expect(controlObservations).toBeGreaterThanOrEqual(3)

		// Reinit-path simulation: stop + start + RE-ATTACH (mirrors
		// what SdkController.reinitExistingTaskFromId would do at
		// line 1955).
		await host.stopSession("A")
		lifecycleActiveSessionId.value = undefined
		// Queue events for the next agent BEFORE startSessionAt so the
		// fresh agent picks them up.
		queueNextAgentEvents([
			runStartedEvent("run-2"),
			executionStateChanged("run-2", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-2"),
		])
		await startSessionAt(host, "A")
		expect(stubAgents.length).toBe(2)
		lifecycleActiveSessionId.value = "A"
		subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")

		await stubAgents[1].run()

		const afterObservations = wiring.recorderCounts().eventsObserved
		expect(afterObservations).toBeGreaterThan(controlObservations)
	})

	// ---- W4 (NEGATIVE CONTROL, expected GREEN) ----
	it("FRSP01-W4 NEGATIVE CONTROL — explicit re-attach on the follow-up path restores event delivery (proves the only missing piece is the attach call)", async () => {
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps() as never)

		// Queue events for both agents BEFORE the first startSessionAt.
		queueNextAgentEvents([
			runStartedEvent("run-1"),
			executionStateChanged("run-1", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-1"),
		])

		await startSessionAt(host, "A")
		expect(stubAgents.length).toBe(1)
		lifecycleActiveSessionId.value = "A"
		subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")

		await stubAgents[0].run()
		const controlObservations = wiring.recorderCounts().eventsObserved
		expect(controlObservations).toBeGreaterThanOrEqual(3)

		// Queue events for agent[1] BEFORE the follow-up resume.
		queueNextAgentEvents([
			runStartedEvent("run-2"),
			executionStateChanged("run-2", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-2"),
		])

		// Drive the follow-up resume.
		let currentId: string | undefined = "A"
		const options = makeFollowupOptions({ host, currentSessionId: () => currentId })
		const coordinator = new SdkFollowupCoordinator(options)
		await coordinator.askResponse("continue")
		expect(stubAgents.length).toBe(2)
		currentId = "A"
		lifecycleActiveSessionId.value = "A"

		// Explicit re-attach (simulating what production would do if
		// the follow-up path were repaired). This proves the transport
		// works; the only thing missing in production is the attach.
		subscribeCanonicalRuntimeEventsToShadow(host, wiring, "A")

		await stubAgents[1].run()

		const afterObservations = wiring.recorderCounts().eventsObserved
		expect(afterObservations).toBeGreaterThan(controlObservations)
	})
})
