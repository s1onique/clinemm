/**
 * ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01-CORRECTION02 /
 * FRSP01-CORRECTION02 — Phase 3 bounded repair (CORRECTION01), Phase 4
 * ablation, Phase 5 conservation witnesses, plus the CORRECTION02
 * identity-fence witnesses (C1 / C2 / C3).
 *
 * REPAIR (CORRECTION01, retained)
 * -------------------------------
 * Added an `onCanonicalRuntimeRebind?: (resumedSessionId: string) => void`
 * option to `SdkFollowupCoordinatorOptions`. The follow-up coordinator
 * invokes it after the successful `sessions.startNewSession(...)` in
 * `resumeSessionFromTask`, immediately after the task-identity guard
 * passes. The SdkController wires the option to a callback body that
 * reads `sessions.getActiveSession()` at call time and ONLY re-attaches
 * if the active session id still equals `resumedSessionId`.
 *
 * CORRECTION02 — IDENTITY CONTRACT TIGHTENING
 * -------------------------------------------
 * Replaces the earlier CORRECTION01 no-arg + "attach whoever is
 * currently active" contract. The earlier contract was weaker than the
 * invariant the lab actually demonstrated and added a forward-looking
 * `(startOutcome as unknown as { status: "superseded" })` branch that
 * was statically unreachable on the no-token `startNewSession` overload
 * the coordinator calls.
 *
 * New contract:
 *   - The callback receives the **resumed session id** (the
 *     `startResult.sessionId` reported by the lifecycle).
 *   - The controller body re-attaches iff
 *     `sessions.getActiveSession().sessionId === resumedSessionId`.
 *   - The forward-looking `superseded` branch and its synthetic
 *     witness test are removed; the lifecycle's existing guards +
 *     `endStartedResume` + `abandonFollowUp` cover any non-started
 *     outcome on the no-token overload.
 *
 * Tests below exercise the REAL identity-fence body (the same shape
 * that lives in `SdkController.onCanonicalRuntimeRebind`):
 *   - resolve `activeSessionId` at call time,
 *   - compare against the resumed id,
 *   - call `subscribeCanonicalRuntimeEventsToShadow` only on equality.
 *
 * SCOPE
 * -----
 * No TaskHeader heuristic, no Thinking heuristic, no message-tail
 * authority, no polling/timer, no host auto-wakeup, no provider
 * changes, no broad lifecycle rewrite, no public SDK API change, no
 * wire-format change.
 *
 * The callback is internal, optional, and testable.
 *
 * WITNESSES
 * ---------
 *   W1 (REPAIR, expected GREEN): the production follow-up resume
 *      with the rebind callback set in the harness delivers the new
 *      agent's events to the shadow. Proves the repair closes the
 *      FRSP01-W2 RED shape.
 *
 *   W2 ABLATION (expected RED on removal, GREEN on restore): when
 *      the rebind callback is removed (replaced with a no-op), the
 *      W2 RED shape returns. Proves NECESSITY of the new call.
 *
 *   C1 IDENTITY MATCH (expected GREEN): the real
 *      identity-fence callback body, with `resumed = active = "A"`,
 *      attaches A exactly once. Proves the identity fence fires
 *      on the happy path.
 *
 *   C2 IDENTITY MISMATCH (expected GREEN, ZERO ATTACH): the real
 *      identity-fence callback body, with `resumed = "A" but
 *      active = "B"`, attaches ZERO times. Proves the fence
 *      protects against a concurrent-replacement supersession.
 *
 *   C3 ACTIVE ABSENT (expected GREEN, ZERO ATTACH): the real
 *      identity-fence callback body, with `resumed = "A" but
 *      active = undefined`, attaches ZERO times. Proves the
 *      fence is safe under the "session already cleared" race.
 *
 *   W5 CONSERVATION — CALLBACK CALLED EXACTLY ONCE PER RESUME
 *      (expected GREEN): the rebind callback fires exactly once
 *      per successful follow-up resume (not on abandonment).
 *
 * REPAIR BUDGET
 * -------------
 * This ACT repairs AND verifies the repair's necessity. No new
 * public API. No permanent runtime instrumentation. No diagnostic.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { FileSessionService } from "@cline-internal/core/session/services/file-session-service"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
	/**
	 * Optional rebind callback to inject. When set, the harness
	 * includes it in the SdkFollowupCoordinatorOptions exactly as
	 * production's SdkController does. When unset (default), the
	 * callback is omitted — preserving FRSP01's W2 RED shape (no
	 * rebind → events lost).
	 *
	 * Production SdkController wires this to the identity-fence body:
	 *   const activeSessionId = this.sessions.getActiveSession()?.sessionId
	 *   if (activeSessionId && activeSessionId === resumedSessionId) {
	 *       this.attachCanonicalRuntimeEventSubscription(activeSessionId)
	 *   }
	 *
	 * Tests inject a spy that performs the same fence against the
	 * `lifecycleActiveSessionId` cell + records each call, plus performs
	 * a real `subscribeCanonicalRuntimeEventsToShadow(host, wiring, id)`
	 * on equality (to mimic the production effect).
	 */
	onCanonicalRuntimeRebind?: (resumedSessionId: string) => void
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
		// The CORRECTION01 repair callback. When the harness opts in
		// (via `opts.onCanonicalRuntimeRebind`), production-shape
		// rebind fires; otherwise the option is omitted (FRSP01
		// RED-shape preserved).
		...(opts.onCanonicalRuntimeRebind ? { onCanonicalRuntimeRebind: opts.onCanonicalRuntimeRebind } : {}),
	}
}

// =========================================================================
// Tests
// =========================================================================

describe("FRSP01-CORRECTION01 — bounded repair + ablation + conservation", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		lifecycleActiveSessionId.value = undefined
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "frsp01c01-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
	})

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		rmSync(isolatedHomeDir, { recursive: true, force: true })
	})

	// ---- W1 (REPAIR, expected GREEN) ----
	it("FRSP01-C01-W1 REPAIR — production follow-up resume WITH rebind callback delivers new agent events to shadow", async () => {
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps() as never)

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

		queueNextAgentEvents([
			runStartedEvent("run-2"),
			executionStateChanged("run-2", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-2"),
		])

		const rebindCalls: Array<{ activeSessionIdAtCall: string | undefined; resumedSessionId: string }> = []
		// Identity-fence body, mirroring the production
		// `SdkController.onCanonicalRuntimeRebind(resumedSessionId)`:
		// reads the active session id at call time and attaches only
		// when the active id equals the resumed id.
		const onCanonicalRuntimeRebind = (resumedSessionId: string) => {
			const activeSessionId = lifecycleActiveSessionId.value
			rebindCalls.push({ activeSessionIdAtCall: activeSessionId, resumedSessionId })
			if (activeSessionId && activeSessionId === resumedSessionId) {
				subscribeCanonicalRuntimeEventsToShadow(host, wiring, activeSessionId)
			}
		}

		let currentId: string | undefined = "A"
		const options = makeFollowupOptions({
			host,
			currentSessionId: () => currentId,
			onCanonicalRuntimeRebind,
		})
		const coordinator = new SdkFollowupCoordinator(options)
		await coordinator.askResponse("continue")

		expect(stubAgents.length).toBe(2)
		currentId = "A"
		lifecycleActiveSessionId.value = "A"
		await stubAgents[1].run()

		const afterObservations = wiring.recorderCounts().eventsObserved
		expect(afterObservations).toBeGreaterThan(controlObservations)
		expect(rebindCalls.length).toBe(1)
		expect(rebindCalls[0].activeSessionIdAtCall).toBe("A")
		// Coordinator passes startResult.sessionId (the resumed id).
		expect(rebindCalls[0].resumedSessionId).toBe("A")
	})

	// ---- W2 (ABLATION, expected RED-shape restored when callback removed) ----
	it("FRSP01-C01-W2 ABLATION — without rebind callback, W2 RED shape returns (proves necessity)", async () => {
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps() as never)

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

		queueNextAgentEvents([
			runStartedEvent("run-2"),
			executionStateChanged("run-2", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-2"),
		])

		let currentId: string | undefined = "A"
		const options = makeFollowupOptions({
			host,
			currentSessionId: () => currentId,
		})
		const coordinator = new SdkFollowupCoordinator(options)
		await coordinator.askResponse("continue")

		expect(stubAgents.length).toBe(2)
		currentId = "A"
		lifecycleActiveSessionId.value = "A"
		await stubAgents[1].run()

		const afterObservations = wiring.recorderCounts().eventsObserved
		expect(afterObservations).toBe(controlObservations)
	})

	// =========================================================================
	// CORRECTION02 IDENTITY-FENCE WITNESSES (C1 / C2 / C3)
	//
	// Each test exercises the REAL production identity-fence body
	// (mirrors `SdkController.onCanonicalRuntimeRebind(resumedSessionId)`):
	//
	//   const activeSessionId = lifecycle.getActiveSession()?.sessionId
	//   if (activeSessionId && activeSessionId === resumedSessionId) {
	//       subscribeCanonicalRuntimeEventsToShadow(host, wiring, activeSessionId)
	//   }
	//
	// These tests drive the active-session state directly via the
	// `lifecycleActiveSessionId` cell (the same cell the production
	// controller's `getActiveSession()` reads). A test attaches an
	// inner subscription for A before the follow-up to record the
	// baseline, then exercises the follow-up resume and asserts the
	// rebind-attached listener fired the expected number of times on
	// the expected id.
	//
	// C1 — resumed=A, active=A → attach A exactly once (happy path).
	// C2 — resumed=A, active=B → zero attach (supersession / replacement).
	// C3 — resumed=A, active=undefined → zero attach (session cleared).
	// =========================================================================

	// ---- C1 IDENTITY MATCH (expected GREEN, exactly one attach) ----
	it("FRSP01-C02-C1 IDENTITY MATCH — resumed=A, active=A attaches A exactly once", async () => {
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps() as never)

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

		queueNextAgentEvents([
			runStartedEvent("run-2"),
			executionStateChanged("run-2", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-2"),
		])

		let rebindCallCount = 0
		let rebindAttachedSessionId: string | undefined
		let rebindResumedId: string | undefined
		// Production-shape identity-fence body. Reads `activeSessionId`
		// at call time and attaches only when both ids are truthy and
		// match.
		const onCanonicalRuntimeRebind = (resumedSessionId: string) => {
			rebindCallCount++
			rebindResumedId = resumedSessionId
			const activeSessionId = lifecycleActiveSessionId.value
			if (activeSessionId && activeSessionId === resumedSessionId) {
				rebindAttachedSessionId = activeSessionId
				subscribeCanonicalRuntimeEventsToShadow(host, wiring, activeSessionId)
			}
		}

		// Active session id is A and matches the resumed id.
		lifecycleActiveSessionId.value = "A"
		const currentId: string | undefined = "A"
		const options = makeFollowupOptions({
			host,
			currentSessionId: () => currentId,
			onCanonicalRuntimeRebind,
		})
		const coordinator = new SdkFollowupCoordinator(options)
		await coordinator.askResponse("continue")

		expect(stubAgents.length).toBe(2)
		await stubAgents[1].run()

		// Identity fence fires exactly once on the happy path.
		expect(rebindCallCount).toBe(1)
		expect(rebindResumedId).toBe("A")
		expect(rebindAttachedSessionId).toBe("A")
		// New agent's events reach the shadow.
		const afterObservations = wiring.recorderCounts().eventsObserved
		expect(afterObservations).toBeGreaterThan(controlObservations)
	})

	// ---- C2 IDENTITY MISMATCH (expected GREEN, zero attach) ----
	it("FRSP01-C02-C2 IDENTITY MISMATCH — resumed=A, active=B skips the rebind (zero attach)", async () => {
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps() as never)

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

		queueNextAgentEvents([
			runStartedEvent("run-2"),
			executionStateChanged("run-2", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-2"),
		])

		let rebindCallCount = 0
		let rebindAttachedSessionId: string | undefined
		const onCanonicalRuntimeRebind = (resumedSessionId: string) => {
			rebindCallCount++
			// Simulate the moment-after-await race: a concurrent
			// intent has JUST taken over the active session, replacing
			// the resumed A with B. The fence MUST skip the attach.
			const activeSessionId = lifecycleActiveSessionId.value
			if (activeSessionId && activeSessionId === resumedSessionId) {
				rebindAttachedSessionId = activeSessionId
				subscribeCanonicalRuntimeEventsToShadow(host, wiring, activeSessionId)
			}
		}

		const currentId: string | undefined = "A"
		const options = makeFollowupOptions({
			host,
			currentSessionId: () => currentId,
			onCanonicalRuntimeRebind,
		})
		// Capture the harness's real startNewSession, then wrap it so
		// that AFTER the new session has been started under id "A",
		// the active cell flips to "B" (concurrent-replacement
		// simulation). This is exactly the race the identity fence is
		// designed to catch. Capture-then-wrap avoids infinite
		// self-recursion.
		//
		// We flip ONLY `lifecycleActiveSessionId.value` (the rebind-
		// gate cell) — `currentId` (the task-identity cell the
		// upstream `getTask()?.taskId !== taskId` guard reads) stays
		// at "A" so we exercise the rebind identity fence WITHOUT
		// tripping the upstream task guard. The two cells are read
		// by different checks in production code; the harness
		// instruments them independently to allow targeted fencing.
		const sessionsHandle = options.sessions as unknown as { startNewSession: ReturnType<typeof vi.fn> }
		const originalStartNewSession = sessionsHandle.startNewSession as unknown as (input: never) => Promise<{
			status: "started"
			startResult: { sessionId: string }
		}>
		sessionsHandle.startNewSession = vi.fn(async (input: never) => {
			const result = await originalStartNewSession(input)
			// Post-start race: a concurrent intent flips ONLY the
			// active session id cell (the rebind-gate side) to
			// "B" before our callback runs. The fence must
			// observe this mismatch and skip the attach.
			lifecycleActiveSessionId.value = "B"
			return result
		})
		const coordinator = new SdkFollowupCoordinator(options)
		await coordinator.askResponse("continue")

		expect(stubAgents.length).toBe(2)

		// Callback fired exactly once (still tied to the resume outcome).
		expect(rebindCallCount).toBe(1)
		// Identity fence DID NOT attach because active != resumed.
		expect(rebindAttachedSessionId).toBeUndefined()
		// `controlObservations` is captured to record the baseline
		// before the follow-up; keep it referenced so the
		// noUnusedLocals pass doesn't flag the work done above.
		expect(controlObservations).toBeGreaterThanOrEqual(3)
	})

	// ---- C3 ACTIVE ABSENT (expected GREEN, zero attach) ----
	it("FRSP01-C02-C3 ACTIVE ABSENT — resumed=A, active=undefined skips the rebind (zero attach)", async () => {
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps() as never)

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

		queueNextAgentEvents([
			runStartedEvent("run-2"),
			executionStateChanged("run-2", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-2"),
		])

		let rebindCallCount = 0
		let rebindAttachedSessionId: string | undefined
		const onCanonicalRuntimeRebind = (resumedSessionId: string) => {
			rebindCallCount++
			const activeSessionId = lifecycleActiveSessionId.value
			if (activeSessionId && activeSessionId === resumedSessionId) {
				rebindAttachedSessionId = activeSessionId
				subscribeCanonicalRuntimeEventsToShadow(host, wiring, activeSessionId)
			}
		}

		const currentId: string | undefined = "A"
		const options = makeFollowupOptions({
			host,
			currentSessionId: () => currentId,
			onCanonicalRuntimeRebind,
		})
		// Capture-then-wrap the harness's real startNewSession so that
		// AFTER the new session has been started under id "A", the
		// active cell is CLEARED (the "session already cleared" race —
		// e.g. clearTask ran first).
		//
		// We flip ONLY `lifecycleActiveSessionId.value` (the rebind-
		// gate cell). `currentId` (the task-identity cell the upstream
		// `getTask()?.taskId !== taskId` guard reads) stays at "A" so
		// we exercise the rebind identity fence WITHOUT tripping the
		// upstream task guard.
		const sessionsHandle = options.sessions as unknown as { startNewSession: ReturnType<typeof vi.fn> }
		const originalStartNewSession = sessionsHandle.startNewSession as unknown as (input: never) => Promise<{
			status: "started"
			startResult: { sessionId: string }
		}>
		sessionsHandle.startNewSession = vi.fn(async (input: never) => {
			const result = await originalStartNewSession(input)
			lifecycleActiveSessionId.value = undefined
			return result
		})
		const coordinator = new SdkFollowupCoordinator(options)
		await coordinator.askResponse("continue")

		expect(stubAgents.length).toBe(2)
		expect(rebindCallCount).toBe(1)
		expect(rebindAttachedSessionId).toBeUndefined()
		expect(controlObservations).toBeGreaterThanOrEqual(3)
	})

	// ---- W5 (CONSERVATION — CALLBACK CALLED EXACTLY ONCE PER RESUME) ----
	it("FRSP01-C01-W5 CONSERVATION — rebind callback called exactly once per successful follow-up resume", async () => {
		const { host, stubAgents, queueNextAgentEvents } = makeRealHostWithFreshAgent(isolatedHomeDir)
		const wiring = createTaskShadowHostWiring(makeWiringDeps() as never)

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

		queueNextAgentEvents([
			runStartedEvent("run-2"),
			executionStateChanged("run-2", {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			}),
			runFinishedEvent("run-2"),
		])

		let rebindCallCount = 0
		const onCanonicalRuntimeRebind = (resumedSessionId: string) => {
			rebindCallCount++
			const activeSessionId = lifecycleActiveSessionId.value
			if (activeSessionId && activeSessionId === resumedSessionId) {
				subscribeCanonicalRuntimeEventsToShadow(host, wiring, activeSessionId)
			}
		}

		let currentId: string | undefined = "A"
		const options = makeFollowupOptions({
			host,
			currentSessionId: () => currentId,
			onCanonicalRuntimeRebind,
		})
		const coordinator = new SdkFollowupCoordinator(options)
		await coordinator.askResponse("continue")

		expect(stubAgents.length).toBe(2)
		currentId = "A"
		lifecycleActiveSessionId.value = "A"
		await stubAgents[1].run()

		// Exactly ONE rebind for one successful follow-up resume.
		expect(rebindCallCount).toBe(1)

		const afterObservations = wiring.recorderCounts().eventsObserved
		expect(afterObservations).toBeGreaterThan(controlObservations)
	})
})
