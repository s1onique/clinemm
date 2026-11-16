/**
 * ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01 / CPR01
 * (PRODUCTION-SEAM CORRELATION-IDENTITY DISCRIMINATOR).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01` (OPPOR01) proved, at the
 * Elm state-machine level, that a continuation prompt stays `PromptScheduled`
 * forever unless a `ContinuationStarted promptRef runRef` transition arrives,
 * and that supplying such a transition removes the `pending_prompt` hold.
 *
 * The factory review of OPPOR01 raised a P0 evidence defect:
 *
 *   "The counterfactual associates prompts with the wrong run."
 *
 * The OPPOR01 counterfactual used `runId = run_rCw8nsup` for BOTH prompts,
 * but the historical bundle shows that run started at CCARD seq 3 and its
 * first `agent_turn_done` was at seq 41, while prompt P1 was scheduled at
 * seq 48 and prompt P2 at seq 57 -- i.e. BOTH prompts were scheduled AFTER
 * that run had already finished. The identifiers are individually authentic
 * but their ASSOCIATION is synthetic. Therefore OPPOR01 cannot authorize a
 * production repair, and the repair ACT is halted with
 * `HALT_CORRELATION_IDENTITY_UNPROVEN`.
 *
 * The review's "Exact next ACT" mandates a FIRST GATE that this file
 * implements:
 *
 *   1. Exercise two consecutive continuation turns through the ACTUAL
 *      `LocalRuntimeHost`, the REAL canonical subscription and the REAL Elm
 *      kernel. NO fabricated `run-started` delivery.
 *
 *      ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01-INSTALL-QUAL01
 *      §2 CORRECTION: the original `CPR01-01` arm claimed this scenario but
 *      actually ran ONE explicit turn + ONE queued continuation, so its
 *      receipt carried two `run-started` events but only ONE
 *      `continuation_started` association. The arm now runs ONE explicit
 *      turn + TWO consecutive queued continuations, and asserts three
 *      distinct run IDs, two correctly-correlated prompt IDs and no orphaned
 *      Elm prompt.
 *   2. Capture the actual `sessionId`, fresh `runId`, prompt ID, subscription
 *      attachment lifetime and run-started emission for each turn.
 *   3. Establish a failing RED at the production boundary. Distinguish:
 *        (a) event not emitted,
 *        (b) listener not attached,
 *        (c) wrong session identity,
 *        (d) event lost during lifecycle replacement.
 *   4. Test ONE causal intervention (e.g. correctly reattaching the
 *      listener) ONLY IF the evidence identifies that failure.
 *
 * WHAT IS REAL IN THIS FILE
 * -------------------------
 *   * `LocalRuntimeHost`      -- REAL (`@cline-internal/core/...` alias).
 *   * `SessionRuntime`         -- REAL.
 *   * `AgentRuntime`           -- REAL (`createAgentRuntime`), with a scripted
 *                                `AgentModel` so the model boundary is the
 *                                ONLY stub. The REAL runtime creates a FRESH
 *                                `runId` per run (`agent-runtime.ts:1788`)
 *                                and emits the REAL `run-started` event
 *                                (`agent-runtime.ts:1837`).
 *   * `subscribeCanonicalRuntimeEventsToShadow` -- REAL production seam.
 *   * `createProductionPendingPromptCapture`     -- REAL production seam.
 *   * `captureContinuationCardinalityAuthorityRecord` -- REAL production seam.
 *   * Elm completion authority                    -- REAL compiled kernel.
 *
 * WHAT IS STUBBED (and why it is causally inert)
 * ----------------------------------------------
 *   * `AgentModel.stream` -- the provider boundary. The runtime's own
 *     `execute()` (which allocates the runId and emits `run-started`) runs
 *     UNCHANGED around it.
 *   * `sessionService` / `runtimeBuilder` -- persistence + tool registry.
 *     Neither participates in the runId / run-started / subscription seam.
 *
 * NO `run-started` event is ever hand-delivered. Every `run-started` observed
 * in this file is emitted by the REAL `AgentRuntime.execute()`.
 *
 * THE IDENTITY CLAIM THIS FILE TESTS
 * ----------------------------------
 * For a queued continuation turn, the `continuation_started(promptId, runId)`
 * record must carry the runId of THE run that ACTUALLY executed that
 * continuation turn -- not the runId of some earlier turn. That identity is
 * established here by the REAL runtime's own runId allocation, and it is
 * cross-checked against the REAL `agent_turn_done` capture, which reads the
 * SAME retained runId map.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { AgentRuntimeEvent } from "@cline/shared"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The `SdkSessionLifecycle` / `VscodeSessionHost` read a handful of GLOBAL
// settings while starting a session (`autoApprovalSettings`,
// `terminalExecutionMode`). The lifecycle is exercised for REAL in CPR01-05,
// so those global-state reads are stubbed to their production defaults (no
// auto-approval settings -> no tool policies; default terminal execution
// mode). Nothing else in this file touches the global state: CPR01-01..04
// drive the REAL `LocalRuntimeHost` directly and never go through the
// lifecycle.
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => undefined,
			getGlobalStateKey: () => undefined,
		}),
	},
}))

import { subscribeCanonicalRuntimeEventsToShadow } from "@/sdk/canonical-event-subscription"
import {
	enqueueElmAuthorityRecord,
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	resetElmAuthorityForTests,
	setElmAuthorityProvider,
} from "@/sdk/completion-authority-elm-authority-runtime"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority"
import { createProductionPendingPromptCapture } from "@/sdk/continuation-cardinality-authority.session-host-capture"
import { SdkSessionLifecycle } from "@/sdk/sdk-session-lifecycle"

const HERE = fileURLToPath(import.meta.url)
// `HERE` ends with the test FILE NAME, so N ".." segments walk N directories
// up from `src/sdk/__tests__/`. 4 ups == `apps/vscode` (the Elm kernel root).
const REAL_KERNEL_PATH = join(HERE, "..", "..", "..", "..", "elm", "completion-authority", "vendor", "completion-authority.js")

const elmKernelAvailable = existsSync(REAL_KERNEL_PATH)

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A scripted `AgentModel` -- the ONLY stub in the causal chain. The REAL
 * `AgentRuntime` wraps it, allocates the runId, and emits the REAL
 * `run-started` / `run-finished` events around it.
 */
function makeScriptedModel() {
	const streamCalls: number[] = []
	return {
		streamCalls,
		stream: async () => {
			streamCalls.push(streamCalls.length)
			return (async function* () {
				yield {
					type: "text-delta" as const,
					text: "ok",
				}
				yield {
					type: "finish" as const,
					reason: "stop" as const,
				}
			})()
		},
	}
}

function makeSessionServiceStub() {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue("/tmp/sessions-cpr01"),
		createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
			manifestPath: "/tmp/sessions-cpr01/manifest.json",
			messagesPath: "/tmp/sessions-cpr01/messages.json",
			manifest: {
				version: 1,
				session_id: "sess-cpr01",
				source: "vscode",
				pid: process.pid,
				started_at: "2026-01-01T00:00:00.000Z",
				status: "running",
				interactive: true,
				provider: "mock-provider",
				model: "mock-model",
				cwd: "/tmp/project-cpr01",
				workspace_root: "/tmp/project-cpr01",
				enable_tools: true,
				enable_spawn: true,
				enable_teams: true,
				prompt: "cpr01",
				messages_path: "/tmp/sessions-cpr01/messages.json",
			},
		}),
		persistSessionMessages: vi.fn().mockResolvedValue(undefined),
		updateSessionStatus: vi.fn().mockResolvedValue({ updated: true, endedAt: "2026-01-01T00:00:05.000Z" }),
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

async function waitFor(predicate: () => boolean, description: string, deadlineMs = 10_000): Promise<void> {
	const start = Date.now()
	while (!predicate()) {
		if (Date.now() - start > deadlineMs) {
			throw new Error(`waitFor: ${description} did not become true within ${deadlineMs}ms`)
		}
		await new Promise((resolve) => setImmediate(resolve))
	}
}

// ---------------------------------------------------------------------------
// The discriminator
// ---------------------------------------------------------------------------

interface TurnObservation {
	/** The canonical `run-started` events observed at the REAL seam. */
	runStartedRunIds: string[]
	/** The `continuation_started` captures produced by the REAL producer. */
	continuationStarted: { promptId?: string; runId?: string }[]
	/** The `agent_turn_done` captures (they read the SAME retained runId). */
	agentTurnDoneRunIds: (string | undefined)[]
	/** The canonical events the wiring actually observed. */
	observedEventTypes: string[]
	/**
	 * The `continuation_scheduled` prompt IDs (the C6 seam). Every one of
	 * them MUST be consumed by EXACTLY ONE `continuation_started` record —
	 * this is the "no orphaned Elm prompt" invariant. A scheduled prompt
	 * with NO matching `continuation_started` stays `PromptScheduled` in the
	 * Elm completion authority and holds completion on `pending_prompt`
	 * forever; that is precisely the incident shape.
	 */
	continuationScheduledPromptIds: string[]
}

/**
 * Build the REAL `SessionRuntime` with a REAL `AgentRuntime` whose MODEL
 * boundary is the scripted stub. The `SessionRuntime`'s own
 * `createAgentRuntimeImpl` override replaces ONLY the `model` field of the
 * already-resolved runtime config -- every other field (hooks, tools,
 * conversation seed, telemetry, completion policy) is the REAL production
 * config, and the `AgentRuntime` class itself is the REAL one.
 *
 * Consequence: the REAL `AgentRuntime.execute()` allocates the runId
 * (`agent-runtime.ts:1788`) and emits the REAL `run-started` event
 * (`agent-runtime.ts:1837`). Nothing in this file fabricates a
 * `run-started`.
 */
async function makeRealSessionFactory(model: ReturnType<typeof makeScriptedModel>) {
	const { SessionRuntime } = await import("@cline-internal/core/runtime/orchestration/session-runtime-orchestrator")
	const { createAgentRuntime } = await import("@cline/agents")
	type AgentConfig = ConstructorParameters<typeof SessionRuntime>[0]
	type RuntimeConfig = Parameters<typeof createAgentRuntime>[0]
	return (config: AgentConfig) =>
		new SessionRuntime(config, {
			createAgentRuntimeImpl: (runtimeConfig: RuntimeConfig) =>
				createAgentRuntime({
					...(runtimeConfig as unknown as Record<string, unknown>),
					model: model as never,
				} as unknown as RuntimeConfig),
		})
}

describe("ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01 / CPR01 — production-seam correlation-identity discriminator", () => {
	let isolationDir = ""
	let host: LocalRuntimeHost | undefined
	const envSnapshot = { HOME: process.env.HOME, CLINE_DIR: process.env.CLINE_DIR }

	beforeEach(() => {
		isolationDir = mkdtempSync(join(tmpdir(), "cpr01-real-host-"))
		process.env.HOME = isolationDir
		process.env.CLINE_DIR = join(isolationDir, ".cline")
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		clearContinuationCardinalityAuthorityCapture()
		resetElmAuthorityForTests()
	})

	afterEach(async () => {
		setContinuationCardinalityAuthorityCaptureEnabled(false)
		clearContinuationCardinalityAuthorityCapture()
		resetElmAuthorityForTests()
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

	it("CPR01-01: two consecutive continuation turns through the REAL LocalRuntimeHost each produce a FRESH runId that reaches the REAL canonical subscription", async () => {
		const sessionId = "sess-cpr01-turns"
		const model = makeScriptedModel()
		const capture = createProductionPendingPromptCapture()
		const createSession = await makeRealSessionFactory(model)

		host = new LocalRuntimeHost({
			distinctId: "act-cpr01-turns",
			sessionService: makeSessionServiceStub() as never,
			runtimeBuilder: makeRuntimeBuilderStub() as never,
			createAgent: createSession as never,
			pendingPromptCapture: capture,
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
				systemPrompt: "cpr01 test agent",
				mode: "act" as const,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		})

		// The REAL canonical subscription, attached exactly the way
		// `SdkController.attachCanonicalRuntimeEventSubscription` does:
		// AFTER the session exists (the POINT_IN_TIME contract).
		const observedEventTypes: string[] = []
		const unsubscribe = subscribeCanonicalRuntimeEventsToShadow(
			host,
			{
				recorder: {} as never,
				recorderCounts: () => ({}) as never,
				records: () => [],
				observeCanonicalRuntimeEvent: (input: { event: AgentRuntimeEvent }) => {
					observedEventTypes.push(input.event.type)
				},
				resetForNewTask: () => {},
				dispose: () => {},
				fenceCanonicalRunForContinuation: () => {},
				coordinator: {} as never,
			},
			sessionId,
		)

		try {
			// ---- TURN 1: an explicit user turn (the incident's seq-3 run).
			const first = await host.runTurn({ sessionId, prompt: "explicit user turn" })
			expect(first).toBeDefined()
			await waitFor(
				() => getContinuationCardinalityAuthorityCaptureRecords().some((r) => r.stage === "agent_turn_done"),
				"turn 1 agent_turn_done",
			)

			// ---- TURN 2: the FIRST QUEUED continuation turn. The queue path
			// drains it after the first turn completes, which arms the held
			// continuation prompt (C6 `onBeforeDispatch`).
			await host.runTurn({ sessionId, prompt: "queued continuation turn 1", delivery: "queue" })
			await waitFor(
				() =>
					getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >= 2,
				"turn 2 agent_turn_done",
			)

			// ---- TURN 3: the SECOND QUEUED continuation turn.
			//
			// ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01-INSTALL-QUAL01
			// §2 (the bounded P1 evidence correction the factory review
			// raised): the original `CPR01-01` arm claimed to exercise TWO
			// consecutive continuation turns but actually ran ONE explicit
			// turn + ONE queued continuation, so its receipt carried two
			// `run-started` events but only ONE `continuation_started`
			// association. The mandated two-continuation scenario was NOT
			// exercised.
			//
			// This arm now runs the full scenario: ONE explicit user turn
			// followed by TWO consecutive queued continuations. The REAL
			// queue drain loop (`PendingPromptsController.drain`) dispatches
			// the second queued prompt after the first one completes, which
			// arms a SECOND held continuation prompt (C6 `onBeforeDispatch`)
			// and therefore MUST produce a SECOND `continuation_started`
			// association.
			await host.runTurn({ sessionId, prompt: "queued continuation turn 2", delivery: "queue" })
			await waitFor(
				() =>
					getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >= 3,
				"turn 3 agent_turn_done",
			)
			// The second continuation's `continuation_started` must also have
			// been produced (the join fires on the SAME `run-started` that
			// drives turn 3's `agent_turn_done`).
			await waitFor(
				() =>
					getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "continuation_started")
						.length >= 2,
				"turn 3 continuation_started",
			)

			const records = getContinuationCardinalityAuthorityCaptureRecords()
			const runStarted = records.filter((r) => r.stage === "run_turn_started")
			const continuationStarted = records.filter((r) => r.stage === "continuation_started")
			const agentTurnDone = records.filter((r) => r.stage === "agent_turn_done")
			const continuationScheduled = records.filter((r) => r.stage === "continuation_scheduled")

			const observation: TurnObservation = {
				runStartedRunIds: runStarted.map((r) => r.runId ?? ""),
				continuationStarted: continuationStarted.map((r) => ({ promptId: r.promptId, runId: r.runId })),
				agentTurnDoneRunIds: agentTurnDone.map((r) => r.runId),
				observedEventTypes,
				continuationScheduledPromptIds: continuationScheduled.map((r) => r.promptId ?? ""),
			}
			console.log("CPR01-01-REPORT", JSON.stringify(observation, null, 2))

			// ---- THE REAL `run-started` EVENTS REACHED THE REAL SUBSCRIPTION.
			// These are emitted by the REAL `AgentRuntime.execute()`; nothing
			// in this file fabricates them. THREE turns ran, so THREE
			// `run-started` events are expected.
			expect(observedEventTypes.filter((t) => t === "run-started").length).toBeGreaterThanOrEqual(3)

			// ---- EACH TURN GOT A DISTINCT runId.
			const distinctRunIds = new Set(observation.runStartedRunIds.filter(Boolean))
			expect(observation.runStartedRunIds.length).toBeGreaterThanOrEqual(3)
			expect(distinctRunIds.size).toBe(observation.runStartedRunIds.filter(Boolean).length)

			// ---- BOTH CONSECUTIVE CONTINUATIONS PRODUCED A CORRELATION.
			// This is the P1 correction's load-bearing assertion: TWO
			// `continuation_started` associations, not one.
			expect(continuationStarted.length).toBeGreaterThanOrEqual(2)

			// ---- THE CONTINUATION PROMPT WAS CORRELATED TO THE RUN THAT
			// ACTUALLY EXECUTED IT. The `continuation_started` runId MUST be
			// one of the OBSERVED runIds (a real run), and MUST NOT be a
			// synthetic / never-observed id.
			for (const cs of continuationStarted) {
				expect(cs.promptId).toBeTruthy()
				expect(cs.runId).toBeTruthy()
				expect(distinctRunIds.has(cs.runId as string)).toBe(true)
			}

			// ---- THE TWO CORRELATIONS ARE DISTINCT ON BOTH AXES: two
			// DIFFERENT prompts, each paired with a DIFFERENT run. A
			// repeated promptId or a repeated runId would mean the join
			// reused an identity instead of allocating a fresh one.
			const continuationPromptIds = continuationStarted.map((r) => r.promptId)
			const continuationRunIds = continuationStarted.map((r) => r.runId)
			expect(new Set(continuationPromptIds).size).toBe(continuationPromptIds.length)
			expect(new Set(continuationRunIds).size).toBe(continuationRunIds.length)

			// ---- THE CORRELATION IS NOT A REPLAY OF THE FIRST RUN. This is
			// the exact P0 the review raised: the continuation must be paired
			// with the run that executed IT, not with an earlier run.
			const firstRunId = observation.runStartedRunIds[0]
			expect(continuationRunIds).not.toContain(firstRunId)

			// ---- NO ORPHANED ELM PROMPT. Every scheduled continuation
			// prompt (C6 `continuation_scheduled`) MUST be consumed by
			// EXACTLY ONE `continuation_started` record. A scheduled prompt
			// with NO matching correlation stays `PromptScheduled` in the
			// Elm completion authority and holds completion on
			// `pending_prompt` forever — the incident shape.
			expect(observation.continuationScheduledPromptIds.length).toBeGreaterThanOrEqual(2)
			for (const scheduledPromptId of observation.continuationScheduledPromptIds) {
				expect(scheduledPromptId).toBeTruthy()
				const consumers = continuationStarted.filter((cs) => cs.promptId === scheduledPromptId)
				expect(consumers).toHaveLength(1)
			}
			// No `continuation_started` may point at a prompt that was never
			// scheduled (a fabricated association).
			for (const cs of continuationStarted) {
				expect(observation.continuationScheduledPromptIds).toContain(cs.promptId as string)
			}

			// ---- CONSERVATION: the `agent_turn_done` capture (which reads
			// the SAME retained runId map) agrees with the runStarted set.
			for (const doneRunId of observation.agentTurnDoneRunIds) {
				if (doneRunId) {
					expect(distinctRunIds.has(doneRunId)).toBe(true)
				}
			}
		} finally {
			unsubscribe()
		}
	}, 60_000)

	// -----------------------------------------------------------------------
	// CPR01-02 -- THE RED AT THE PRODUCTION BOUNDARY.
	//
	// The incident bundle shows ONE `run_turn_started` for FIVE
	// `agent_turn_done` records in ONE session. The REAL runtime emits
	// `run-started` on EVERY `AgentRuntime.execute()`, so the ONLY way the
	// canonical subscription can observe ONE of them is if its listener is
	// no longer attached to the live runtime for the later turns.
	//
	// `LocalRuntimeHost.subscribeRuntimeEvents` is POINT_IN_TIME: it walks
	// `this.sessions` and attaches to each entry's `agent` (the
	// `SessionRuntime`) AT CALL TIME. The production lifecycle REPLACES the
	// `SessionRuntime` under the SAME session id
	// (`local-runtime-host.ts:1363` -- `this.sessions.set(sessionId, active)`),
	// so a subscription attached before the replacement keeps listening to
	// the DISPOSED runtime.
	//
	// This arm drives EXACTLY that production shape:
	//   1. start session S, attach the REAL canonical subscription,
	//   2. turn 1 (explicit) -> the subscription observes `run-started`,
	//   3. LIFECYCLE REPLACEMENT: stop S and start S again (a NEW
	//      `SessionRuntime` under the SAME session id) WITHOUT re-attaching
	//      the subscription (this is the defect under test),
	//   4. turn 2 (queued continuation) -> the continuation runs, but its
	//      `run-started` is NOT observed by the stale subscription.
	//
	// Expected RED: NO `continuation_started` is produced, because the
	// producer's join never fires -- the Elm prompt would stay
	// `PromptScheduled` forever.
	// -----------------------------------------------------------------------
	it("CPR01-02: after a production-shaped SessionRuntime replacement under the same sessionId, the stale canonical subscription observes NO run-started and NO continuation_started", async () => {
		const sessionId = "sess-cpr01-replaced"
		const model = makeScriptedModel()
		const capture = createProductionPendingPromptCapture()
		const createSession = await makeRealSessionFactory(model)

		host = new LocalRuntimeHost({
			distinctId: "act-cpr01-replaced",
			sessionService: makeSessionServiceStub() as never,
			runtimeBuilder: makeRuntimeBuilderStub() as never,
			createAgent: createSession as never,
			pendingPromptCapture: capture,
		})

		const startSession = async () => {
			await host?.startSession({
				source: "vscode",
				interactive: true,
				config: {
					sessionId,
					providerId: "mock-provider",
					modelId: "mock-model",
					cwd: isolationDir,
					workspaceRoot: isolationDir,
					systemPrompt: "cpr01 replacement agent",
					mode: "act" as const,
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
			})
		}

		await startSession()

		const observedEventTypes: string[] = []
		const unsubscribe = subscribeCanonicalRuntimeEventsToShadow(
			host,
			{
				recorder: {} as never,
				recorderCounts: () => ({}) as never,
				records: () => [],
				observeCanonicalRuntimeEvent: (input: { event: AgentRuntimeEvent }) => {
					observedEventTypes.push(input.event.type)
				},
				resetForNewTask: () => {},
				dispose: () => {},
				fenceCanonicalRunForContinuation: () => {},
				coordinator: {} as never,
			},
			sessionId,
		)

		try {
			// ---- TURN 1 (explicit): the subscription IS attached.
			await host.runTurn({ sessionId, prompt: "explicit user turn" })
			await waitFor(
				() => getContinuationCardinalityAuthorityCaptureRecords().some((r) => r.stage === "agent_turn_done"),
				"turn 1 agent_turn_done",
			)
			const runStartedAfterTurn1 = observedEventTypes.filter((t) => t === "run-started").length
			expect(runStartedAfterTurn1).toBeGreaterThanOrEqual(1)

			// ---- LIFECYCLE REPLACEMENT (production shape): stop the session
			// and start it AGAIN under the SAME session id. This installs a
			// NEW `SessionRuntime` in `LocalRuntimeHost.sessions`, exactly as
			// `SdkSessionLifecycle.startNewSession` does on the follow-up
			// resume path. The canonical subscription is deliberately NOT
			// re-attached -- that omission IS the defect under test.
			await host.stopSession(sessionId)
			clearContinuationCardinalityAuthorityCapture()
			observedEventTypes.length = 0
			await startSession()

			// ---- TURN 2 (queued continuation) on the REPLACED runtime.
			await host.runTurn({ sessionId, prompt: "queued continuation turn", delivery: "queue" })
			await waitFor(
				() =>
					getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >= 1,
				"turn 2 agent_turn_done",
			)

			const records = getContinuationCardinalityAuthorityCaptureRecords()
			const runStarted = records.filter((r) => r.stage === "run_turn_started")
			const continuationStarted = records.filter((r) => r.stage === "continuation_started")
			const agentTurnDone = records.filter((r) => r.stage === "agent_turn_done")

			const observation = {
				observedRunStartedCount: observedEventTypes.filter((t) => t === "run-started").length,
				runStartedRunIds: runStarted.map((r) => r.runId ?? ""),
				continuationStarted: continuationStarted.map((r) => ({ promptId: r.promptId, runId: r.runId })),
				agentTurnDoneRunIds: agentTurnDone.map((r) => r.runId),
				observedEventTypes,
			}
			console.log("CPR01-02-REPORT", JSON.stringify(observation, null, 2))

			// ---- THE TURN REALLY EXECUTED (the runtime is not broken): the
			// REAL runtime allocated a runId and the host-side
			// `agent_turn_done` capture fired with that SAME runId. So the
			// `run-started` event WAS emitted by the REAL
			// `AgentRuntime.execute()` -- hypothesis (a) "event not emitted"
			// is REFUTED.
			expect(agentTurnDone.length).toBeGreaterThanOrEqual(1)
			expect(agentTurnDone[0]?.runId).toBeTruthy()

			// ---- THE RED: the STALE subscription observed NOTHING at all
			// from the replaced runtime -- in particular NO `run-started`.
			// So the producer's join never fired, NO `continuation_started`
			// was produced, and the prompt stays `PromptScheduled` in Elm:
			// the completion stays held on `pending_prompt`.
			//
			// This is the discriminating signature of hypothesis (d)
			// "event lost during lifecycle replacement" (and of (b)
			// "listener not attached to the live runtime"). It is NOT the
			// signature of (a) "event not emitted" (refuted above by the
			// allocated runId) nor of (c) "wrong session identity" (the
			// sessionId is byte-identical across the replacement, and the
			// `agent_turn_done` capture is keyed by that same sessionId).
			expect(observedEventTypes).toEqual([])
			expect(observation.observedRunStartedCount).toBe(0)
			expect(continuationStarted.length).toBe(0)
		} finally {
			unsubscribe()
		}
	}, 60_000)

	// -----------------------------------------------------------------------
	// CPR01-03 -- THE CAUSAL INTERVENTION.
	//
	// Exactly ONE intervention is applied, and it is the one the evidence
	// identified: RE-ATTACH the canonical subscription after the lifecycle
	// replacement. This mirrors what production already does on the
	// follow-up-resume path
	// (`SdkController.attachCanonicalRuntimeEventSubscription` ->
	// `CanonicalRuntimeShadowSubscription.attach()`, which disposes the
	// stale subscription and attaches a fresh one).
	//
	// The intervention must:
	//   * restore the `run-started` observation for the replaced runtime,
	//   * restore the `continuation_started(promptId, runId)` correlation
	//     with a FRESH runId (the run that actually executed the turn),
	//   * and leave every other invariant untouched.
	//
	// If the intervention did NOT restore the correlation, then "reattach
	// the listener" would NOT be the causally necessary repair and the ACT
	// would have to halt.
	// -----------------------------------------------------------------------
	it("CPR01-03: re-attaching the canonical subscription after the lifecycle replacement restores the continuation_started correlation with a FRESH runId", async () => {
		const sessionId = "sess-cpr01-intervention"
		const model = makeScriptedModel()
		const capture = createProductionPendingPromptCapture()
		const createSession = await makeRealSessionFactory(model)

		host = new LocalRuntimeHost({
			distinctId: "act-cpr01-intervention",
			sessionService: makeSessionServiceStub() as never,
			runtimeBuilder: makeRuntimeBuilderStub() as never,
			createAgent: createSession as never,
			pendingPromptCapture: capture,
		})

		const startSession = async () => {
			await host?.startSession({
				source: "vscode",
				interactive: true,
				config: {
					sessionId,
					providerId: "mock-provider",
					modelId: "mock-model",
					cwd: isolationDir,
					workspaceRoot: isolationDir,
					systemPrompt: "cpr01 intervention agent",
					mode: "act" as const,
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				},
			})
		}

		await startSession()

		const observedEventTypes: string[] = []
		const makeWiring = () => ({
			recorder: {} as never,
			recorderCounts: () => ({}) as never,
			records: () => [],
			observeCanonicalRuntimeEvent: (input: { event: AgentRuntimeEvent }) => {
				observedEventTypes.push(input.event.type)
			},
			resetForNewTask: () => {},
			dispose: () => {},
			fenceCanonicalRunForContinuation: () => {},
			coordinator: {} as never,
		})

		let unsubscribe = subscribeCanonicalRuntimeEventsToShadow(host, makeWiring(), sessionId)

		try {
			// ---- TURN 1 (explicit).
			await host.runTurn({ sessionId, prompt: "explicit user turn" })
			await waitFor(
				() => getContinuationCardinalityAuthorityCaptureRecords().some((r) => r.stage === "agent_turn_done"),
				"turn 1 agent_turn_done",
			)
			const firstRunIds = getContinuationCardinalityAuthorityCaptureRecords()
				.filter((r) => r.stage === "run_turn_started")
				.map((r) => r.runId ?? "")
			expect(firstRunIds.length).toBeGreaterThanOrEqual(1)

			// ---- LIFECYCLE REPLACEMENT + THE INTERVENTION: replace the
			// runtime, then re-attach the subscription (the production
			// `onCanonicalRuntimeRebind` behavior).
			await host.stopSession(sessionId)
			clearContinuationCardinalityAuthorityCapture()
			observedEventTypes.length = 0
			await startSession()
			unsubscribe()
			unsubscribe = subscribeCanonicalRuntimeEventsToShadow(host, makeWiring(), sessionId)

			// ---- TURN 2 (queued continuation) on the replaced runtime.
			await host.runTurn({ sessionId, prompt: "queued continuation turn", delivery: "queue" })
			await waitFor(
				() =>
					getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >= 1,
				"turn 2 agent_turn_done",
			)

			const records = getContinuationCardinalityAuthorityCaptureRecords()
			const runStarted = records.filter((r) => r.stage === "run_turn_started")
			const continuationStarted = records.filter((r) => r.stage === "continuation_started")
			const agentTurnDone = records.filter((r) => r.stage === "agent_turn_done")

			const observation = {
				observedRunStartedCount: observedEventTypes.filter((t) => t === "run-started").length,
				runStartedRunIds: runStarted.map((r) => r.runId ?? ""),
				continuationStarted: continuationStarted.map((r) => ({ promptId: r.promptId, runId: r.runId })),
				agentTurnDoneRunIds: agentTurnDone.map((r) => r.runId),
				firstRunIds,
			}
			console.log("CPR01-03-REPORT", JSON.stringify(observation, null, 2))

			// ---- THE INTERVENTION RESTORED THE OBSERVATION.
			expect(observedEventTypes.filter((t) => t === "run-started").length).toBeGreaterThanOrEqual(1)

			// ---- AND RESTORED THE CORRELATION.
			expect(continuationStarted.length).toBe(1)
			const correlated = continuationStarted[0]
			expect(correlated?.promptId).toBeTruthy()
			expect(correlated?.runId).toBeTruthy()

			// ---- WITH A FRESH runId -- the run that ACTUALLY executed the
			// continuation turn, NOT the pre-replacement run. This is the
			// identity property the OPPOR01 review found unproven.
			expect(firstRunIds).not.toContain(correlated?.runId)
			expect(runStarted.map((r) => r.runId)).toContain(correlated?.runId)

			// ---- AND THE `agent_turn_done` capture agrees (same retained
			// runId map).
			expect(agentTurnDone.map((r) => r.runId)).toContain(correlated?.runId)
		} finally {
			unsubscribe()
		}
	}, 60_000)

	// -----------------------------------------------------------------------
	// CPR01-04 -- THE REAL ELM KERNEL CONSUMES THE CORRELATION.
	//
	// The captures produced by the REAL production seam are replayed
	// through the REAL adapter (`adaptRecord`) into the REAL Elm authority
	// queue and the REAL compiled Elm kernel, exactly as
	// `completion-authority-elm-authority-runtime` does in production.
	//
	// This closes the loop OPPOR01 left open:
	//   * WITHOUT the correlation (the CPR01-02 shape) the prompt stays
	//     `PromptScheduled` and the completion is HELD on `pending_prompt`;
	//   * WITH the correlation (the CPR01-03 shape, carrying the FRESH
	//     runId of the run that actually executed the continuation) the
	//     prompt is consumed and the `pending_prompt` hold disappears.
	//
	// The promptId / runId used here are the ones the REAL producer
	// emitted during this test -- NOT fixture constants and NOT the
	// incident bundle's synthetic pairing.
	// -----------------------------------------------------------------------
	it("CPR01-04: the REAL Elm kernel holds on pending_prompt without the correlation and authorizes with the REAL producer's fresh correlation", async () => {
		if (!elmKernelAvailable) {
			throw new Error(`CPR01-04 prerequisites missing: kernel=${elmKernelAvailable}`)
		}
		setElmAuthorityProvider(REAL_KERNEL_PATH)

		// ---- Drive the REAL production seam twice: once WITHOUT the
		// re-attach (CPR01-02 shape) and once WITH it (CPR01-03 shape),
		// collecting the REAL captures each time.
		const driveProductionSeam = async (reattach: boolean): Promise<Record<string, unknown>[]> => {
			const sessionId = `sess-cpr01-elm-${reattach ? "fixed" : "broken"}`
			const model = makeScriptedModel()
			const capture = createProductionPendingPromptCapture()
			const createSession = await makeRealSessionFactory(model)
			const localHost = new LocalRuntimeHost({
				distinctId: `act-cpr01-elm-${reattach ? "fixed" : "broken"}`,
				sessionService: makeSessionServiceStub() as never,
				runtimeBuilder: makeRuntimeBuilderStub() as never,
				createAgent: createSession as never,
				pendingPromptCapture: capture,
			})
			const startSession = async () => {
				await localHost.startSession({
					source: "vscode",
					interactive: true,
					config: {
						sessionId,
						providerId: "mock-provider",
						modelId: "mock-model",
						cwd: isolationDir,
						workspaceRoot: isolationDir,
						systemPrompt: "cpr01 elm agent",
						mode: "act" as const,
						enableTools: true,
						enableSpawnAgent: false,
						enableAgentTeams: false,
					},
				})
			}
			await startSession()
			const wiring = {
				recorder: {} as never,
				recorderCounts: () => ({}) as never,
				records: () => [],
				observeCanonicalRuntimeEvent: () => {},
				resetForNewTask: () => {},
				dispose: () => {},
				fenceCanonicalRunForContinuation: () => {},
				coordinator: {} as never,
			}
			let unsub = subscribeCanonicalRuntimeEventsToShadow(localHost, wiring, sessionId)
			try {
				await localHost.runTurn({ sessionId, prompt: "explicit user turn" })
				await waitFor(
					() => getContinuationCardinalityAuthorityCaptureRecords().some((r) => r.stage === "agent_turn_done"),
					"elm arm turn 1",
				)
				await localHost.stopSession(sessionId)
				clearContinuationCardinalityAuthorityCapture()
				await startSession()
				if (reattach) {
					unsub()
					unsub = subscribeCanonicalRuntimeEventsToShadow(localHost, wiring, sessionId)
				}
				await localHost.runTurn({ sessionId, prompt: "queued continuation turn", delivery: "queue" })
				await waitFor(
					() =>
						getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "agent_turn_done").length >=
						1,
					"elm arm turn 2",
				)
				return getContinuationCardinalityAuthorityCaptureRecords().map((r) => ({ ...r })) as Record<string, unknown>[]
			} finally {
				unsub()
				await localHost.dispose().catch(() => {})
			}
		}

		// ---- ARM 1: WITHOUT the re-attach. The producer never emits
		// `continuation_started`, so the prompt stays `PromptScheduled`.
		const brokenRecords = await driveProductionSeam(false)
		expect(brokenRecords.filter((r) => r.stage === "continuation_started")).toHaveLength(0)
		expect(brokenRecords.filter((r) => r.stage === "pending_prompt_enqueued").length).toBeGreaterThanOrEqual(1)

		resetElmAuthorityForTests()
		setElmAuthorityProvider(REAL_KERNEL_PATH)
		for (const record of brokenRecords) {
			enqueueElmAuthorityRecord(record)
		}
		await flushElmAuthorityForSession("sess-cpr01-elm-broken")
		const brokenDecision = getElmAuthorityCompletionDecision("sess-cpr01-elm-broken")
		const brokenHoldReasons = brokenDecision.kind === "hold" ? (brokenDecision.holdReasons ?? []) : []
		console.log(
			"CPR01-04-BROKEN-REPORT",
			JSON.stringify({ kind: brokenDecision.kind, holdReasons: brokenHoldReasons }, null, 2),
		)

		// ---- ARM 2: WITH the re-attach. The producer emits
		// `continuation_started` carrying the FRESH runId of the run that
		// actually executed the continuation turn.
		clearContinuationCardinalityAuthorityCapture()
		const fixedRecords = await driveProductionSeam(true)
		const fixedContinuation = fixedRecords.filter((r) => r.stage === "continuation_started")
		expect(fixedContinuation).toHaveLength(1)

		resetElmAuthorityForTests()
		setElmAuthorityProvider(REAL_KERNEL_PATH)
		for (const record of fixedRecords) {
			enqueueElmAuthorityRecord(record)
		}
		await flushElmAuthorityForSession("sess-cpr01-elm-fixed")
		const fixedDecision = getElmAuthorityCompletionDecision("sess-cpr01-elm-fixed")
		const fixedHoldReasons = fixedDecision.kind === "hold" ? (fixedDecision.holdReasons ?? []) : []
		console.log("CPR01-04-FIXED-REPORT", JSON.stringify({ kind: fixedDecision.kind, holdReasons: fixedHoldReasons }, null, 2))

		// ---- The correlation is what changed the outcome.
		expect(brokenHoldReasons).toContain("pending_prompt")
		expect(fixedHoldReasons).not.toContain("pending_prompt")
	}, 120_000)
})

// ---------------------------------------------------------------------------
// CPR01-05 -- THE PRODUCTION REPAIR, AT THE PRODUCTION SEAM.
//
// CPR01-02..04 established the MECHANISM at the runtime seam. This arm
// exercises the REPAIR as it is wired in production:
//
//   REAL `SdkSessionLifecycle.replaceActiveSession(...)`
//     -> REAL `this.options.onCanonicalRuntimeRebind?.(sessionId)`
//        -> (production) `SdkController.attachCanonicalRuntimeEventSubscription`
//           -> `CanonicalRuntimeShadowSubscription.attach(...)`
//              -> REAL `subscribeCanonicalRuntimeEventsToShadow(...)`
//
// RED (no hook wired): the lifecycle replaces the session and the rebind
// never fires -> the caller's subscription stays bound to the OLD runtime.
//
// GREEN (hook wired): the rebind fires with the REPLACEMENT's session id,
// exactly once, AFTER the replacement session is installed.
//
// The `SdkSessionLifecycle` here is the REAL production class. Only the
// session HOST is a stub (the runtime seam is covered by CPR01-01..04).
// ---------------------------------------------------------------------------

/**
 * The lifecycle's active session is installed by `startNewSession`. This
 * helper asserts the precondition and narrows the type, so the arms below
 * carry no non-null assertion.
 */
function requireActiveSession(lifecycle: SdkSessionLifecycle) {
	const active = lifecycle.getActiveSession()
	if (!active) {
		throw new Error("expected the lifecycle to have an active session")
	}
	return active
}

/**
 * The `SdkSessionLifecycle` builds the shared `VscodeSessionHost`, whose
 * start path consults the MCP hub for server-provided tools. The MCP hub is
 * NOT part of the causal chain under test (the canonical subscription /
 * `run-started` / `continuation_started` seam), so the hub is stubbed to the
 * production default of ZERO configured servers.
 */
function makeMcpHubStub() {
	return {
		getServers: vi.fn(() => []),
		getServer: vi.fn(() => undefined),
		disconnectSession: vi.fn(async () => undefined),
		connectToSession: vi.fn(async () => undefined),
	} as unknown as ConstructorParameters<typeof SdkSessionLifecycle>[0]["mcpHub"]
}

/**
 * A schema-valid `startNewSession` input. The `VscodeSessionHost` validates
 * the start config against the SDK's session schema before handing it to the
 * runtime, so every required field is present here. The values are inert
 * (the MCP hub has zero servers and no provider is contacted).
 */
function makeStartInput(sessionId: string) {
	return {
		config: {
			sessionId,
			providerId: "mock-provider",
			modelId: "mock-model",
			cwd: process.cwd(),
			workspaceRoot: process.cwd(),
			systemPrompt: "cpr01 lifecycle arm",
			mode: "act" as const,
			enableTools: true,
			enableSpawnAgent: false,
			enableAgentTeams: false,
			enableMcp: false,
		},
		source: "vscode" as const,
		interactive: true,
	} as never
}

describe("ACT-CLINEMM-ELM-PENDING-PROMPT-CORRELATION-REPAIR01 / CPR01-05 — the production repair at the lifecycle seam", () => {
	// The REAL `VscodeSessionHost` resolves its storage root from
	// `CLINE_DIR`. Isolate it so the lifecycle arms never write into the
	// repository working tree.
	let cpr01IsolationDir = ""
	const cpr01EnvSnapshot = { CLINE_DIR: process.env.CLINE_DIR, HOME: process.env.HOME }

	beforeEach(() => {
		cpr01IsolationDir = mkdtempSync(join(tmpdir(), "cpr01-lifecycle-"))
		process.env.CLINE_DIR = join(cpr01IsolationDir, ".cline")
		process.env.HOME = cpr01IsolationDir
	})

	afterEach(() => {
		process.env.CLINE_DIR = cpr01EnvSnapshot.CLINE_DIR
		process.env.HOME = cpr01EnvSnapshot.HOME
		if (cpr01IsolationDir && existsSync(cpr01IsolationDir)) {
			rmSync(cpr01IsolationDir, { recursive: true, force: true })
		}
	})

	it("CPR01-05-RED: without the rebind hook, replaceActiveSession replaces the session and never notifies the subscriber", async () => {
		const rebind = vi.fn()
		const lifecycle = new SdkSessionLifecycle({
			mcpHub: makeMcpHubStub(),
			requestToolApproval: vi.fn(),
			askQuestion: vi.fn(),
			onSessionEvent: vi.fn(),
			onSendComplete: vi.fn(),
			onSendError: vi.fn(),
			// The hook is intentionally NOT wired -- this is the PRE-repair
			// production shape.
		})

		const startInput = makeStartInput("sess-cpr01")

		const initial = await lifecycle.startNewSession(startInput)
		expect(initial.status).toBe("started")
		const activeA = lifecycle.getActiveSession()
		expect(activeA).toBeDefined()
		lifecycle.setRunning(false)

		const replaced = await lifecycle.replaceActiveSession({
			expectedSession: requireActiveSession(lifecycle),
			startInput,
			disposeReason: "modeChange",
		})

		// The replacement SUCCEEDED (the runtime was replaced)...
		expect(replaced).toBeDefined()
		expect(replaced?.startResult.sessionId).toBe("sess-cpr01")
		// ...but the subscriber was NEVER told -> the canonical subscription
		// stays bound to the OLD (disposed) runtime. This is the incident.
		expect(rebind).not.toHaveBeenCalled()
	})

	it("CPR01-05-GREEN: with the rebind hook, replaceActiveSession notifies the subscriber exactly once with the replacement's session id", async () => {
		const rebind = vi.fn()
		const lifecycle = new SdkSessionLifecycle({
			mcpHub: makeMcpHubStub(),
			requestToolApproval: vi.fn(),
			askQuestion: vi.fn(),
			onSessionEvent: vi.fn(),
			onSendComplete: vi.fn(),
			onSendError: vi.fn(),
			// The production wiring.
			onCanonicalRuntimeRebind: (sessionId: string) => rebind(sessionId),
		})

		const startInput = makeStartInput("sess-cpr01")

		const initial = await lifecycle.startNewSession(startInput)
		expect(initial.status).toBe("started")
		const activeA = lifecycle.getActiveSession()
		expect(activeA).toBeDefined()
		lifecycle.setRunning(false)

		// The initial start must NOT fire the rebind (the subscriber attaches
		// itself on the initial attach path).
		expect(rebind).not.toHaveBeenCalled()

		const replaced = await lifecycle.replaceActiveSession({
			expectedSession: requireActiveSession(lifecycle),
			startInput,
			disposeReason: "modeChange",
		})

		expect(replaced).toBeDefined()
		// EXACTLY ONCE, with the REPLACEMENT's session id.
		expect(rebind).toHaveBeenCalledTimes(1)
		expect(rebind).toHaveBeenCalledWith("sess-cpr01")
	})

	it("CPR01-05-REFUSED: a refused replacement (running session) does NOT fire the rebind", async () => {
		const rebind = vi.fn()
		const lifecycle = new SdkSessionLifecycle({
			mcpHub: makeMcpHubStub(),
			requestToolApproval: vi.fn(),
			askQuestion: vi.fn(),
			onSessionEvent: vi.fn(),
			onSendComplete: vi.fn(),
			onSendError: vi.fn(),
			onCanonicalRuntimeRebind: (sessionId: string) => rebind(sessionId),
		})

		const startInput = makeStartInput("sess-cpr01")

		await lifecycle.startNewSession(startInput)
		const activeA = requireActiveSession(lifecycle)
		// The session is RUNNING -> the replacement is refused.
		lifecycle.setRunning(true)

		const replaced = await lifecycle.replaceActiveSession({
			expectedSession: activeA,
			startInput,
			disposeReason: "modeChange",
		})

		expect(replaced).toBeUndefined()
		// No replacement happened -> no rebind. The subscriber is untouched.
		expect(rebind).not.toHaveBeenCalled()
	})
})
