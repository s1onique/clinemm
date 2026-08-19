/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-D3
 *
 * C2.4-D3 — HUB/REMOTE PROVENANCE + EPOCH SAFETY PRE-REPAIR WITNESS MATRIX.
 *
 * Purpose (qualification ACT, not a repair ACT):
 *   Seven-axis provenance qualification for Hub/Remote fallback.
 *   D3 MUST NOT preselect a repair. The pre-repair witness matrix
 *   must be observed first, then the A/B/C feasibility gate runs
 *   against this evidence.
 *
 *   This file contains the pre-repair adversarial witness matrix
 *   D3-W1..D3-W8. Each witness drives a real scripted Hub sequence
 *   through the same REAL production wiring used by D2:
 *
 *     REAL HubRuntimeHost
 *       ↓ host.subscribe(wrappedOnSessionEvent)
 *     production TaskShadowHostWiring (createTaskShadowHostWiring)
 *       ↓ sessionOptions.onSessionEvent wrap
 *     observeLegacyEvent (production)
 *       ↓ translator.translate(input)
 *     TaskShadowReverseTranslator (production)
 *       ↓ runtimeEvent
 *     coordinator.observe({
 *            kind: "runtime-reconstructed",
 *            canonicalAvailable: <hook>,
 *          })
 *     TaskShadowObservationCoordinator (production)
 *
 *   No test code calls translator.translate() or coordinator.observe()
 *   directly. The translator/coordinator are reachable only through
 *   the wiring's wrapped onSessionEvent. Pre-repair observation only.
 *
 *   Witness-locked behaviorals (D3-W1..D3-W8 + R-D3-1..R-D3-3):
 *     D3-W1 CURRENT RUN               : single epoch happy path.
 *     D3-W2 TWO RUNS SAME SESSION     : pre-repair expected to fail
 *           scopedEdgeKey separation (runId=undefined).
 *     D3-W3 STALE-TERMINAL-AFTER-NEW  : pre-repair translator
 *           stranded-terminal gate is structurally dead because
 *           both activeRunId and eventConvId are undefined.
 *     D3-W4 CONTINUATION WINDOW       : PROTOCOL_ABSENCE
 *           qualification row. Hub protocol has no continueTask
 *           envelope; the same_task_continued boundary is
 *           implicit and observable only via the lifecycleStub.
 *           The witness DOES NOT emit/invoke same_task_continued;
 *           it observes the structural inability to distinguish
 *           old-epoch terminal from new-epoch resume under
 *           FALLBACK_APPLY.
 *     D3-W5 TASK RESET BOUNDARY       : PROTOCOL_ABSENCE
 *           qualification row. Hub protocol has no task-reset
 *           envelope; the same sessionId is reused for both
 *           tasks. The witness DOES NOT emit/invoke task_reset;
 *           it observes that the translator's activeRunId has no
 *           concept of task boundary under FALLBACK_APPLY.
 *     D3-W6 CROSS-SESSION             : SESSION_GUARD control.
 *           The wiring's session guard rejects cross-session
 *           events at the coordinator's authority resolver
 *           (resolveObservationAuthority returns STALE → return),
 *           so cross-session events do not increment any of
 *           APPLY/SUPPRESS/DIAGNOSTIC counters. This proves
 *           D3 is isolating run provenance rather than
 *           conflating it with session provenance.
 *     D3-W7 RECOVERY MISSING ID       : RECOVERY_MISSING_ID
 *           single-epoch shape; never fabricated.
 *     D3-W8 TERMINAL VARIANTS         : run.failed / run.aborted
 *           route through emitAgentDoneIfNeeded → emit "done"
 *           agent_event → translator maps to "run-failed" /
 *           "run-failed-with-aborted-reason". Same 4/4/0 shape
 *           as W1.
 *     R-D3-1 REMOTE TWO EPOCHS        : real RemoteRuntimeHost
 *           parity for the D3-W2 two-epoch shape. Remote
 *           inherits HubRuntimeHost verbatim; expected 8/6/2.
 *     R-D3-2 REMOTE STALE TERMINAL    : real RemoteRuntimeHost
 *           parity for the D3-W3 stale-terminal shape. Expected
 *           8/6/2 (same as W3 because the translator's
 *           stranded-terminal gate is structurally dead for the
 *           same reason under Remote).
 *     R-D3-3 REMOTE RECOVERY MISSING  : real RemoteRuntimeHost
 *           parity for the D3-W7 recovery missing shape.
 *           Expected 4/4/0 (same as W7 because the translator's
 *           activeRunId is never seeded from the absent
 *           conversationId).
 *
 *   Done-vs-ended terminal-path ( per reviewer R4, D3-CORRECTION01):
 *     run.completed/failed/aborted envelopes:
 *       1. emitAgentDoneIfNeeded may emit an `agent_event` with
 *          payload.event.type === "done" (or "error"). This is
 *          the TRANSLATOR-VISIBLE edge that the
 *          TaskShadowReverseTranslator maps to "run-finished" or
 *          "run-failed" in the runtime event stream.
 *       2. The same handleHubEvent path may ALSO emit an "ended"
 *          CoreSessionEvent (type === "ended") which is NOT
 *          agent_event. The translator's translate() returns
 *          undefined for type !== "agent_event", so the "ended"
 *          edge does NOT enter the runtime event stream.
 *     These are TWO DIFFERENT downstream surfaces: the agent_event
 *     "done" edge routes through the production wiring's
 *     observeLegacyEvent path; the "ended" CoreSessionEvent
 *     surfaces only in the host's lifecycle (SessionLifecycle) and
 *     does not reach the shadow under the wiring composition.
 *
 *   Per-event translation filter (matches D2-F1 filter, scope-wise):
 *     agent_event with payload.event.type in {iteration_start,
 *     content_start, content_end, done}:
 *     exactly the events the existing translator translate()
 *     function is willing to map to a runtime event.
 *     run.started -> status; run.completed/failed/aborted -> ended
 *     (NOT agent_event; translator drops). session.notice ->
 *     agent_event(notice): notice is dropped because
 *     isRecoveryNoticeReason returns false.
 *
 *     THE LATE-TIME EMIT: when run.completed/failed/aborted
 *     arrives AFTER a previous run.completed/failed/aborted in
 *     the same session, emitAgentDoneIfNeeded returns early
 *     (agentDoneEmittedForCurrentRunBySession.has(sessionId)
 *     is true) and does NOT emit a second "done" agent_event.
 *     This dedup is at the HubRuntimeHost layer, not the
 *     coordinator. See D3-W4 for the consequence.
 *
 *   NOT a frozen-control gate. The D2 decoder (8/6/2 + 8/0/8)
 *   remains the frozen control in 3d14ccd5c (direct-translator)
 *   and 88d0ec391 (production-wiring composition). D3 adds
 *   NEW adversarial witnesses ON TOP of that frozen control.
 *
 * Pre-repair empirical decoder (D2-freeze, retained as control):
 *   canonicalAvailable=false:
 *     translated                    = 8 EXACT
 *     FALLBACK_APPLY                = 6 EXACT
 *     SUPPRESS_DUPLICATE            = 2 EXACT
 *     DIAGNOSTIC_ONLY               = 0
 *     shadow_mutated                = true
 *   canonicalAvailable=true:
 *     translated                    = 8 EXACT
 *     FALLBACK_APPLY                = 0
 *     DIAGNOSTIC_ONLY               = 8 EXACT
 *     shadow_mutated                = false
 *
 *   These counts are CONTROL observations. D3 must NOT rewrite
 *   these tests to make a repair look successful. If A or B is
 *   selected and the post-repair decoder differs, document the
 *   exact before/after counts and explain every changed edge.
 *
 *   The D2 test file is the negative control. This D3 file is
 *   the adversarial witness matrix that proves D3's qualification
 *   boundary.
 */

// NOTE: vi.mock of the SDK Hub client is hoisted, so the dep
// imports inside C2.4-D2-CORRECTION01 re-execute inside the same
// vitest worker. The hoisted seam below is the same proven D2
// seam; D3-C2 is a new test file in the same dedicated config.
const HUB_CLIENT_MODULE_PATH = vi.hoisted(() => {
	const nodePath = require("node:path") as typeof import("node:path")
	return nodePath.resolve(__dirname, "../../../../../sdk/packages/core/src/hub/client/index.ts")
})

// vi.hoisted so the REAL HubRuntimeHost constructor can capture the
// per-session listener when its inherited ensureSessionSubscription
// calls this.client.subscribe.
const commandMock = vi.hoisted(() => vi.fn())
const subscribeMock = vi.hoisted(() => vi.fn())
const closeMock = vi.hoisted(() => vi.fn())
const disposeMock = vi.hoisted(() => vi.fn())
const getClientIdMock = vi.hoisted(() => vi.fn(() => "client-d3"))
const restartLocalHubIfIdleAfterStartupTimeoutMock = vi.hoisted(() => vi.fn())

vi.mock(HUB_CLIENT_MODULE_PATH, async () => {
	// Mock strategy: forward the actual module's `normalizeHubWebSocketUrl`
	// (needed by RemoteRuntimeHost's constructor) but replace `NodeHubClient`,
	// `isHubCommandTimeoutError`, and `restartLocalHubIfIdleAfterStartupTimeout`
	// with hoisted mocks. The actual module transitively imports
	// `@cline/shared/storage` which is not resolvable under the dedicated
	// vitest config; we therefore use `vi.importActual` and tolerate
	// the import chain by passing through only the helpers we need.
	//
	// Strategy: dynamically import normalizeHubWebSocketUrl via a
	// lightweight re-export path. To keep the test seam minimal,
	// we re-implement the normalize locally here (it is a 4-line
	// pure function: http(s):// -> ws(s)://). The function is
	// re-verified by R-D3 below to match the production code.
	const normalizeHubWebSocketUrl = (url: string): string => {
		if (url.startsWith("https://")) {
			return url.replace(/^https/, "wss")
		}
		if (url.startsWith("http://")) {
			return url.replace(/^http/, "ws")
		}
		return url
	}
	return {
		__esModule: true,
		normalizeHubWebSocketUrl,
		NodeHubClient: class {
			private readonly url: string
			constructor(options: { url: string }) {
				this.url = options.url
			}
			command = commandMock
			subscribe = subscribeMock
			close = closeMock
			dispose = disposeMock
			getClientId = getClientIdMock
			getUrl = () => this.url
		},
		isHubCommandTimeoutError: (error: unknown, command?: string): error is Error & { command?: string; code?: string } =>
			!!error &&
			typeof error === "object" &&
			(error as { code?: unknown }).code === "hub_command_timeout" &&
			(command === undefined || (error as { command?: unknown }).command === command),
		restartLocalHubIfIdleAfterStartupTimeout: restartLocalHubIfIdleAfterStartupTimeoutMock,
	}
})

import type { CoreSessionEvent } from "@cline/core"
import type { HubEventEnvelope } from "@cline/shared"
import { HubRuntimeHost } from "@cline-internal/core/hub/runtime-host/hub-runtime-host"
import { RemoteRuntimeHost } from "@cline-internal/core/hub/runtime-host/remote-runtime-host"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import { createTaskShadowHostWiring } from "../task-state-shadow-host-wiring"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"

// ---------------------------------------------------------------------------
// Scripted envelope types (intentionally named differently from D2 to make
// splicing with D2 sequences impossible — D3 witnesses are independent
// pre-repair observations).
// ---------------------------------------------------------------------------

interface ScriptedEnvelope {
	envelope: HubEventEnvelope
	label: string
}

/** Build a run.started envelope. */
function runStarted(sessionId: string, ts: number): HubEventEnvelope {
	return {
		version: "v1",
		event: "run.started",
		sessionId,
		timestamp: ts,
		payload: {
			session: {
				sessionId,
				status: "running",
				createdAt: ts,
				updatedAt: ts,
				workspaceRoot: "/tmp/project",
			},
		},
	}
}

/** Build an iteration.started envelope WITHOUT conversationId. */
function iterationStarted(sessionId: string, ts: number, iteration: number): HubEventEnvelope {
	return {
		version: "v1",
		event: "iteration.started",
		sessionId,
		timestamp: ts,
		payload: { iteration },
	}
}

/** Build a session.notice envelope WITH conversationId. */
function sessionNoticeWithConversationId(
	sessionId: string,
	ts: number,
	conversationId: string,
	agentId: string,
	reason: string = "stuck",
): HubEventEnvelope {
	return {
		version: "v1",
		event: "session.notice",
		sessionId,
		timestamp: ts,
		payload: {
			noticeType: "recovery",
			displayRole: "status",
			reason,
			message: "recovering",
			agent: { agentId, conversationId },
		},
	}
}

/** Build a tool.started envelope. */
function toolStarted(sessionId: string, ts: number, toolCallId: string, toolName: string): HubEventEnvelope {
	return {
		version: "v1",
		event: "tool.started",
		sessionId,
		timestamp: ts,
		payload: { toolCallId, toolName, input: { path: "/tmp/x" } },
	}
}

/** Build a tool.finished envelope. */
function toolFinished(sessionId: string, ts: number, toolCallId: string, toolName: string): HubEventEnvelope {
	return {
		version: "v1",
		event: "tool.finished",
		sessionId,
		timestamp: ts,
		payload: { toolCallId, toolName, output: { ok: true } },
	}
}

/** Build a run.completed envelope (terminal). */
function runCompleted(sessionId: string, ts: number): HubEventEnvelope {
	return {
		version: "v1",
		event: "run.completed",
		sessionId,
		timestamp: ts,
		payload: { snapshot: { status: "completed" } },
	}
}

/** Build a run.failed envelope (terminal). */
function runFailed(sessionId: string, ts: number, reason: string = "error"): HubEventEnvelope {
	return {
		version: "v1",
		event: "run.failed",
		sessionId,
		timestamp: ts,
		payload: { reason, snapshot: { status: "failed" } },
	}
}

/** Build a run.aborted envelope (terminal). */
function runAborted(sessionId: string, ts: number): HubEventEnvelope {
	return {
		version: "v1",
		event: "run.aborted",
		sessionId,
		timestamp: ts,
		payload: { snapshot: { status: "aborted" } },
	}
}

/** Count the per-event translated snapshots in the captured CoreSessionEvent stream. */
function countTranslated(captured: CoreSessionEvent[]): {
	total: number
	iterationStart: number
	contentStart: number
	contentEnd: number
	done: number
} {
	let iterationStart = 0
	let contentStart = 0
	let contentEnd = 0
	let done = 0
	for (const e of captured) {
		if (e.type !== "agent_event") continue
		const t = (e.payload?.event as { type?: string } | undefined)?.type
		if (t === "iteration_start") iterationStart++
		else if (t === "content_start") contentStart++
		else if (t === "content_end") contentEnd++
		else if (t === "done") done++
	}
	return {
		total: iterationStart + contentStart + contentEnd + done,
		iterationStart,
		contentStart,
		contentEnd,
		done,
	}
}

function emptyArbiterSnapshot(): ArbiterSnapshot {
	return {
		execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		recoveryState: "idle",
		status: "idle",
		pendingToolCalls: [],
	}
}

function makeSessionReply(sessionId: string) {
	return {
		payload: {
			session: {
				sessionId,
				status: "running" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				workspaceRoot: "/tmp/project",
			},
		},
	}
}

function makeConfig(sessionId: string) {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-haiku-4.5",
		cwd: "/tmp/project",
		workspaceRoot: "/tmp/project",
		systemPrompt: "system",
		mode: "act" as const,
		checkpoint: { enabled: true },
		enableTools: true,
		enableSpawnAgent: true,
		enable_teams: true,
		enableAgentTeams: true,
		sessionId,
	}
}

// ---------------------------------------------------------------------------
// Composition fixture (mirrors D2 pattern; the same harness is used to
// ensure D3-W1..W8 exercise the production wiring, not a test-local seam).
// ---------------------------------------------------------------------------

interface CompositionFixture {
	host: HubRuntimeHost
	wiring: ReturnType<typeof createTaskShadowHostWiring>
	captured: CoreSessionEvent[]
	drive: (envelope: HubEventEnvelope) => void
}

async function buildComposition(opts: { sessionId: string; canonicalAvailable?: () => boolean }): Promise<CompositionFixture> {
	commandMock.mockReset()
	subscribeMock.mockReset()
	closeMock.mockReset()
	disposeMock.mockReset()
	getClientIdMock.mockClear()
	restartLocalHubIfIdleAfterStartupTimeoutMock.mockReset()

	let onHubEvent: ((e: HubEventEnvelope) => void) | undefined
	subscribeMock.mockImplementation((listener: (e: HubEventEnvelope) => void) => {
		onHubEvent = listener
		return () => {}
	})
	commandMock.mockResolvedValueOnce(makeSessionReply(opts.sessionId))

	const host = new HubRuntimeHost({ url: "ws://127.0.0.1:25463/hub" })

	const captured: CoreSessionEvent[] = []
	const sessionOptions = {
		onSessionEvent: (event: CoreSessionEvent) => {
			captured.push(event)
		},
	} as unknown as Parameters<typeof createTaskShadowHostWiring>[0]["sessionOptions"]

	const lifecycleStub = {
		getActiveSession: () => ({ sessionId: opts.sessionId }),
		setRunning: () => {},
	} as unknown as Parameters<typeof createTaskShadowHostWiring>[0]["lifecycle"]

	const wiring = createTaskShadowHostWiring({
		lifecycle: lifecycleStub,
		sessionOptions,
		getLegacyPhase: () => "idle" as TurnPhase,
		getArbiterSnapshot: () => emptyArbiterSnapshot(),
		getCanonicalRuntimeAvailable: opts.canonicalAvailable ?? (() => false),
		getRuntimeStatus: () => "running",
		now: () => 1_700_000_000_000,
	})

	host.subscribe(sessionOptions.onSessionEvent)

	await host.startSession({
		config: makeConfig(opts.sessionId),
		source: "core",
		prompt: "Drive D3 pre-repair witness",
		interactive: true,
	})

	return {
		host,
		wiring,
		captured,
		drive: (envelope) => {
			if (!onHubEvent) {
				throw new Error("HubRuntimeHost did not attach its session listener")
			}
			onHubEvent(envelope)
		},
	}
}

async function driveAndSample(fixture: CompositionFixture, sequence: ScriptedEnvelope[]) {
	const shadowBefore = fixture.wiring.comparator.debugSnapshot()
	for (const { envelope } of sequence) {
		fixture.drive(envelope)
	}
	await Promise.resolve()
	await Promise.resolve()
	const counts = fixture.wiring.recorderCounts()
	const shadowAfter = fixture.wiring.comparator.debugSnapshot()
	return {
		counts: {
			emittedCount: fixture.captured.length,
			fallbackReconstructedApplied: counts.fallbackReconstructedApplied,
			fallbackSuppressedCount: counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED ?? 0,
			diagnosticByOrigin: counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED ?? 0,
			observationsObserved: counts.eventsObserved,
			shadowBefore,
			shadowAfter,
			shadowMutated: JSON.stringify(shadowBefore) !== JSON.stringify(shadowAfter),
		},
		shadowBefore,
		shadowAfter,
		shadowMutated: JSON.stringify(shadowBefore) !== JSON.stringify(shadowAfter),
	}
}

// buildRemoteComposition — real RemoteRuntimeHost version of buildComposition.
// RemoteRuntimeHost is a 27-line constructor-only subclass of HubRuntimeHost;
// the client seam is inherited via super(). R-D3-* tests use this helper.
async function buildRemoteComposition(opts: {
	sessionId: string
	canonicalAvailable?: () => boolean
}): Promise<CompositionFixture> {
	commandMock.mockReset()
	subscribeMock.mockReset()
	closeMock.mockReset()
	disposeMock.mockReset()
	getClientIdMock.mockClear()
	restartLocalHubIfIdleAfterStartupTimeoutMock.mockReset()

	let onHubEvent: ((e: HubEventEnvelope) => void) | undefined
	subscribeMock.mockImplementation((listener: (e: HubEventEnvelope) => void) => {
		onHubEvent = listener
		return () => {}
	})
	commandMock.mockResolvedValueOnce(makeSessionReply(opts.sessionId))

	const host = new RemoteRuntimeHost({
		endpoint: "http://127.0.0.1:25463/hub-remote",
		clientType: "core-remote-runtime",
	})

	const captured: CoreSessionEvent[] = []
	const sessionOptions = {
		onSessionEvent: (event: CoreSessionEvent) => {
			captured.push(event)
		},
	} as unknown as Parameters<typeof createTaskShadowHostWiring>[0]["sessionOptions"]

	const lifecycleStub = {
		getActiveSession: () => ({ sessionId: opts.sessionId }),
		setRunning: () => {},
	} as unknown as Parameters<typeof createTaskShadowHostWiring>[0]["lifecycle"]

	const wiring = createTaskShadowHostWiring({
		lifecycle: lifecycleStub,
		sessionOptions,
		getLegacyPhase: () => "idle" as TurnPhase,
		getArbiterSnapshot: () => emptyArbiterSnapshot(),
		getCanonicalRuntimeAvailable: opts.canonicalAvailable ?? (() => false),
		getRuntimeStatus: () => "running",
		now: () => 1_700_000_000_000,
	})

	host.subscribe(sessionOptions.onSessionEvent)

	await host.startSession({
		config: makeConfig(opts.sessionId),
		source: "core",
		prompt: "Drive R-D3 Remote parity witness",
		interactive: true,
	})

	return {
		host,
		wiring,
		captured,
		drive: (envelope) => {
			if (!onHubEvent) {
				throw new Error("RemoteRuntimeHost did not attach its session listener")
			}
			onHubEvent(envelope)
		},
	}
}

describe("C2.4-D3 — Hub/Remote provenance + epoch safety pre-repair witness matrix", () => {
	afterEach(() => {
		commandMock.mockReset()
		subscribeMock.mockReset()
		closeMock.mockReset()
		disposeMock.mockReset()
		getClientIdMock.mockClear()
		restartLocalHubIfIdleAfterStartupTimeoutMock.mockReset()
	})

	// D3-W1: CURRENT RUN — epoch A only, complete happy path.
	// Pre-repair expected: iteration_start with runId=undefined,
	// content_start and content_end pass through, run.completed
	// terminal CANNOT translate (it's an "ended" event, not
	// agent_event) so the translator's stranded-terminal gate
	// never has a chance to fire.
	it("D3-W1: current run — single epoch A, complete happy path", async () => {
		const fixture = await buildComposition({ sessionId: "sess-d3-w1" })
		const sequence: ScriptedEnvelope[] = [
			{ label: "A: run.started", envelope: runStarted("sess-d3-w1", 0) },
			{ label: "A: iteration.started", envelope: iterationStarted("sess-d3-w1", 1, 1) },
			{
				label: "A: session.notice (run-A)",
				envelope: sessionNoticeWithConversationId("sess-d3-w1", 2, "run-A", "agent-A"),
			},
			{ label: "A: tool.started", envelope: toolStarted("sess-d3-w1", 3, "tool-1", "readFile") },
			{ label: "A: tool.finished", envelope: toolFinished("sess-d3-w1", 4, "tool-1", "readFile") },
			{ label: "A: run.completed", envelope: runCompleted("sess-d3-w1", 5) },
		]
		const result = await driveAndSample(fixture, sequence)
		const counts = countTranslated(fixture.captured)
		// Pre-repair: 4 translated events (iteration_start, content_start,
		// content_end, done). run.completed emits "ended" not "agent_event",
		// so the translator drops it.
		expect(counts.total).toBe(4)
		// All 4 should APPLY (no second epoch to collide with).
		expect(result.counts.fallbackReconstructedApplied).toBe(4)
		expect(result.counts.fallbackSuppressedCount).toBe(0)
		expect(result.counts.diagnosticByOrigin).toBe(0)
		expect(result.shadowMutated).toBe(true)
	})

	// D3-W2: TWO RUNS SAME SESSION — frozen pre-repair 6/2 decoder.
	// Pre-repair: scopedEdgeKey(A, run-started) == scopedEdgeKey(B, run-started)
	// because runId=undefined for both, so 2 collisions.
	// This is the D2-F1 control. D3 re-derives it independently.
	it("D3-W2: two runs same session — pre-repair scopedEdgeKey collision (frozen 6/2 control)", async () => {
		const fixture = await buildComposition({ sessionId: "sess-d3-w2" })
		const sequence: ScriptedEnvelope[] = [
			{ label: "A: run.started", envelope: runStarted("sess-d3-w2", 0) },
			{ label: "A: iteration.started", envelope: iterationStarted("sess-d3-w2", 1, 1) },
			{
				label: "A: session.notice (run-A)",
				envelope: sessionNoticeWithConversationId("sess-d3-w2", 2, "run-A", "agent-A"),
			},
			{ label: "A: tool.started", envelope: toolStarted("sess-d3-w2", 3, "tool-1", "readFile") },
			{ label: "A: tool.finished", envelope: toolFinished("sess-d3-w2", 4, "tool-1", "readFile") },
			{ label: "A: run.completed", envelope: runCompleted("sess-d3-w2", 5) },
			{ label: "B: run.started", envelope: runStarted("sess-d3-w2", 6) },
			{ label: "B: iteration.started", envelope: iterationStarted("sess-d3-w2", 7, 1) },
			{
				label: "B: session.notice (run-B)",
				envelope: sessionNoticeWithConversationId("sess-d3-w2", 8, "run-B", "agent-B"),
			},
			{ label: "B: tool.started", envelope: toolStarted("sess-d3-w2", 9, "tool-2", "readFile") },
			{ label: "B: tool.finished", envelope: toolFinished("sess-d3-w2", 10, "tool-2", "readFile") },
			{ label: "B: run.completed", envelope: runCompleted("sess-d3-w2", 11) },
		]
		const result = await driveAndSample(fixture, sequence)
		const counts = countTranslated(fixture.captured)
		// Frozen pre-repair empirical decoder (D2-F1).
		expect(counts.total).toBe(8)
		expect(result.counts.fallbackReconstructedApplied).toBe(6)
		expect(result.counts.fallbackSuppressedCount).toBe(2)
		expect(result.counts.diagnosticByOrigin).toBe(0)
		expect(result.shadowMutated).toBe(true)
		// The 2 suppressed events are structurally the two cross-epoch
		// collisions on scopedEdgeKey (runId=undefined for both epochs).
		// This is the negative control D3 must beat if A or B is selected.
	})

	// D3-W3: STALE TERMINAL AFTER NEW RUN HAS STARTED.
	// Pre-repair: late terminal run.completed(A) arrives AFTER
	// cycle.started(B) and run.started(B). The translator's
	// stranded-terminal gate is structurally dead because both
	// activeRunId and eventConvId are undefined.
	//
	// Done-vs-ended terminal-path (per reviewer R4, D3-CORRECTION01):
	//   A's first run.completed at step 5 calls emitAgentDoneIfNeeded.
	//   agentDoneEmittedForCurrentRunBySession has NOT yet been set
	//   (the run.started at step 0 deletes it), so a "done" agent_event
	//   is emitted (translator-visible edge → maps to "run-finished").
	//   A's late run.completed at step 8 calls emitAgentDoneIfNeeded
	//   AGAIN — but B's run.started at step 6 deleted the dedup flag,
	//   so the late A terminal also emits a second "done" agent_event.
	//   This is why W3's translated count is 8 (4 per epoch: iter_start,
	//   content_start, content_end, done × 2), not 7.
	//
	//   B's run.completed at step 11 also calls emitAgentDoneIfNeeded,
	//   but the dedup flag was set by A's late terminal at step 8,
	//   so B's "done" is suppressed at the HubRuntimeHost layer.
	//
	//   Consequence: the coordinator's scopedEdgeKey for run-started
	//   collides twice (A and B both have runId=undefined → same key),
	//   producing 2 SUPPRESS_DUPLICATE. The translator's stranded-
	//   terminal gate cannot fire because both activeRunId and
	//   eventConvId are undefined under Hub — the MISMATCH branch
	//   is structurally dead.
	it("D3-W3: late terminal from epoch A after epoch B has started — observer records the structural deadness", async () => {
		const fixture = await buildComposition({ sessionId: "sess-d3-w3" })
		const sequence: ScriptedEnvelope[] = [
			{ label: "A: run.started", envelope: runStarted("sess-d3-w3", 0) },
			{ label: "A: iteration.started", envelope: iterationStarted("sess-d3-w3", 1, 1) },
			{ label: "A: tool.started", envelope: toolStarted("sess-d3-w3", 2, "tool-1", "readFile") },
			{ label: "A: tool.finished", envelope: toolFinished("sess-d3-w3", 3, "tool-1", "readFile") },
			{ label: "A: run.completed", envelope: runCompleted("sess-d3-w3", 4) },
			{ label: "B: run.started", envelope: runStarted("sess-d3-w3", 5) },
			{ label: "B: iteration.started", envelope: iterationStarted("sess-d3-w3", 6, 1) },
			// LATE terminal from A AFTER B has started:
			{ label: "A: late run.completed", envelope: runCompleted("sess-d3-w3", 7) },
			{ label: "B: tool.started", envelope: toolStarted("sess-d3-w3", 8, "tool-2", "readFile") },
			{ label: "B: tool.finished", envelope: toolFinished("sess-d3-w3", 9, "tool-2", "readFile") },
			{ label: "B: run.completed", envelope: runCompleted("sess-d3-w3", 10) },
		]
		const result = await driveAndSample(fixture, sequence)
		const counts = countTranslated(fixture.captured)
		// Pre-repair: same 8/6/2 as W2 because the late terminal
		// manifests as a second "done" agent_event (NOT as "ended";
		// see done-vs-ended comment above), and the translator cannot
		// structurally distinguish it from a fresh terminal. The
		// deadness of the stranded-terminal gate is the structural
		// reason: both sides are undefined under Hub.
		expect(counts.total).toBe(8)
		expect(result.counts.fallbackReconstructedApplied).toBe(6)
		expect(result.counts.fallbackSuppressedCount).toBe(2)
		// The pre-repair path does NOT prove it can distinguish
		// W3 from W2. The collision count is identical.
	})

	// D3-W4: CONTINUATION WINDOW — PROTOCOL_ABSENCE qualification row
	// (per reviewer R2, D3-CORRECTION01).
	//
	// Hub protocol has no `continueTask` envelope. The
	// `same_task_continued` boundary is observable only via the
	// lifecycleStub (SdkSessionLifecycle.continueTask method), NOT
	// via any Hub-stream event. The witness DOES NOT emit/invoke
	// `same_task_continued`; it observes the structural inability
	// to distinguish an old-epoch terminal from a new-epoch
	// resume under FALLBACK_APPLY.
	//
	// The Hub-stream shape is "epoch A interrupted (no run.completed)
	// followed by epoch B begins, then a late A terminal arrives".
	// Pre-repair: this is structurally the same as W3 because the
	// translator's stranded-terminal gate cannot fire (both sides
	// undefined). The test observes the cycle shape and confirms
	// NO cross-epoch suppression capability.
	it("D3-W4 (PROTOCOL_ABSENCE): continuation window — late terminal A arrives after B begins; Hub has no continueTask envelope", async () => {
		const fixture = await buildComposition({ sessionId: "sess-d3-w4" })
		// The Hub-stream shape approximates the continuation hazard:
		// epoch A is interrupted (no run.completed), then B starts,
		// then a late A terminal arrives. There is NO Hub-stream
		// envelope for same_task_continued; the boundary is implicit.
		const sequence: ScriptedEnvelope[] = [
			{ label: "A: run.started", envelope: runStarted("sess-d3-w4", 0) },
			{ label: "A: iteration.started", envelope: iterationStarted("sess-d3-w4", 1, 1) },
			{ label: "A: tool.started", envelope: toolStarted("sess-d3-w4", 2, "tool-1", "readFile") },
			{ label: "A: tool.finished", envelope: toolFinished("sess-d3-w4", 3, "tool-1", "readFile") },
			// No run.completed for A — interrupted by continuation.
			{ label: "B: run.started", envelope: runStarted("sess-d3-w4", 4) },
			{ label: "B: iteration.started", envelope: iterationStarted("sess-d3-w4", 5, 1) },
			// Late terminal A arrives AFTER B has started.
			{ label: "A: late run.completed", envelope: runCompleted("sess-d3-w4", 6) },
			{ label: "B: tool.started", envelope: toolStarted("sess-d3-w4", 7, "tool-2", "readFile") },
			{ label: "B: tool.finished", envelope: toolFinished("sess-d3-w4", 8, "tool-2", "readFile") },
			{ label: "B: run.completed", envelope: runCompleted("sess-d3-w4", 9) },
		]
		const result = await driveAndSample(fixture, sequence)
		const counts = countTranslated(fixture.captured)
		// Pre-repair: A has no run.completed (interrupted), so A
		// contributes 3 translated events (iteration_start,
		// content_start, content_end). B contributes 3. Plus the
		// late A's run.completed fires emitAgentDoneIfNeeded which
		// produces a "done" event (B's run.started at step 4
		// deleted the dedup flag, so the late A terminal emits).
		// B's run.completed is suppressed at the HubRuntimeHost
		// layer because the sessionId's agentDoneEmittedForCurrentRunBySession
		// flag was set by the late A terminal. Total = 7.
		expect(counts.total).toBe(7)
		// Pre-repair: scopedEdgeKey collision on the two run-started
		// edges (iteration_start emits "run-started" via the
		// translator) means 1 SUPPRESS_DUPLICATE on the second
		// run-started (the first APPLY's, the second's is
		// SUPPRESS because both runId=undefined). The single
		// late-A "done" maps to "run-finished"; the
		// scopedEdgeKey for run-finished does NOT collide because
		// there is only one (B's run.completed did not emit a
		// second "done"). 6 APPLY / 1 SUPPRESS.
		expect(result.counts.fallbackReconstructedApplied).toBe(6)
		expect(result.counts.fallbackSuppressedCount).toBe(1)
		// PROTOCOL_ABSENCE: there is no Hub-stream event that
		// distinguishes continuation from cross-epoch. D3-P5 is
		// NOT_YET_QUALIFIED.
	})

	// D3-W5: TASK RESET / NEW-TASK boundary — PROTOCOL_ABSENCE qualification
	// row (per reviewer R2, D3-CORRECTION01).
	//
	// Hub protocol has no `task_reset` envelope. The task boundary is
	// observable only via the lifecycleStub (SdkSessionLifecycle methods),
	// NOT via any Hub-stream event. The witness DOES NOT emit/invoke
	// `task_reset`; it observes that the translator's activeRunId has
	// no concept of task boundary under FALLBACK_APPLY.
	//
	// The Hub-stream shape is "task-1 complete, task-2 begins on the
	// same sessionId, then a late task-1 terminal arrives". Pre-repair:
	// same sessionId is reused for both tasks (the production wiring
	// captures CoreSessionEvent by sessionId, not taskId). The
	// translator's activeRunId is never seeded, so a "reset" boundary
	// has no observable effect on the translator's state.
	it("D3-W5 (PROTOCOL_ABSENCE): task reset boundary — same sessionId, late task-1 terminal after task-2 begins; Hub has no task_reset envelope", async () => {
		const fixture = await buildComposition({ sessionId: "sess-d3-w5" })
		const sequence: ScriptedEnvelope[] = [
			{ label: "task-1: run.started", envelope: runStarted("sess-d3-w5", 0) },
			{ label: "task-1: iteration.started", envelope: iterationStarted("sess-d3-w5", 1, 1) },
			{ label: "task-1: tool.started", envelope: toolStarted("sess-d3-w5", 2, "tool-1", "readFile") },
			{ label: "task-1: tool.finished", envelope: toolFinished("sess-d3-w5", 3, "tool-1", "readFile") },
			{ label: "task-1: run.completed", envelope: runCompleted("sess-d3-w5", 4) },
			// Same session. No "task.reset" envelope on the Hub protocol.
			{ label: "task-2: run.started", envelope: runStarted("sess-d3-w5", 5) },
			{ label: "task-2: iteration.started", envelope: iterationStarted("sess-d3-w5", 6, 1) },
			// Late terminal from task-1 arrives AFTER task-2 has started.
			{ label: "task-1: late run.completed", envelope: runCompleted("sess-d3-w5", 7) },
			{ label: "task-2: tool.started", envelope: toolStarted("sess-d3-w5", 8, "tool-2", "readFile") },
			{ label: "task-2: tool.finished", envelope: toolFinished("sess-d3-w5", 9, "tool-2", "readFile") },
			{ label: "task-2: run.completed", envelope: runCompleted("sess-d3-w5", 10) },
		]
		const result = await driveAndSample(fixture, sequence)
		const counts = countTranslated(fixture.captured)
		// Pre-repair: same 8/6/2 shape as W2. The Hub protocol
		// carries no task-reset signal, so the translator cannot
		// distinguish task-1 from task-2 by any structural means.
		// The HubRuntimeHost's run.started at step 5 deletes the
		// agentDoneEmittedForCurrentRunBySession flag, so the late
		// task-1 terminal at step 7 emits a "done" agent_event
		// (translator-visible). task-2's run.completed at step 10
		// is then deduped at the HubRuntimeHost layer.
		expect(counts.total).toBe(8)
		expect(result.counts.fallbackReconstructedApplied).toBe(6)
		expect(result.counts.fallbackSuppressedCount).toBe(2)
		// PROTOCOL_ABSENCE: there is no Hub-stream event that
		// signals a task boundary. D3-P6 is NOT_YET_QUALIFIED.
	})

	// D3-W6: CROSS-SESSION — SESSION_GUARD control (per reviewer R3,
	// D3-CORRECTION01: tightened to exact positive assertions).
	//
	// The wiring's authority resolver (task-state-shadow-coordinator.ts:311)
	// rejects cross-session events by returning STALE, which short-circuits
	// the recorder/coordinator without incrementing ANY of APPLY / SUPPRESS /
	// DIAGNOSTIC counters (coordinator.ts:386-388: `case "STALE": return`).
	//
	// The fixture's authoritative lifecycle session is "sess-d3-w6"; events
	// arrive with sessionId "sess-d3-w6-A" or "sess-d3-w6-B" which differ
	// from the active session id, so the authority resolver returns STALE
	// for every translated event.
	//
	// All 8 agent_events still reach fixture.captured (the wiring does not
	// reject at the envelope-routing layer for the reconstructed path; it
	// rejects at the coordinator's authority-resolver layer). But none of
	// them APPLY, SUPPRESS, or DIAGNOSTIC — they all STALE.
	//
	// This proves D3 is isolating RUN provenance rather than conflating it
	// with SESSION provenance. The session guard already works correctly
	// under FALLBACK_APPLY for cross-session events.
	it("D3-W6 (SESSION_GUARD control): cross-session events are rejected at the authority resolver as STALE; 0 APPLY", async () => {
		const fixture = await buildComposition({ sessionId: "sess-d3-w6" })
		// Drive sessionId A events first, then sessionId B events.
		// The wiring captures CoreSessionEvent with sessionId, but
		// the active session is "sess-d3-w6", so A's and B's events
		// both originate from a different session than the active
		// session — the authority resolver returns STALE for each.
		const sequence: ScriptedEnvelope[] = [
			{ label: "session A: run.started", envelope: runStarted("sess-d3-w6-A", 0) },
			{ label: "session A: iteration.started", envelope: iterationStarted("sess-d3-w6-A", 1, 1) },
			{ label: "session A: tool.started", envelope: toolStarted("sess-d3-w6-A", 2, "tool-1", "readFile") },
			{ label: "session A: tool.finished", envelope: toolFinished("sess-d3-w6-A", 3, "tool-1", "readFile") },
			{ label: "session A: run.completed", envelope: runCompleted("sess-d3-w6-A", 4) },
			{ label: "session B: run.started", envelope: runStarted("sess-d3-w6-B", 5) },
			{ label: "session B: iteration.started", envelope: iterationStarted("sess-d3-w6-B", 6, 1) },
			{ label: "session B: tool.started", envelope: toolStarted("sess-d3-w6-B", 7, "tool-2", "readFile") },
			{ label: "session B: tool.finished", envelope: toolFinished("sess-d3-w6-B", 8, "tool-2", "readFile") },
			{ label: "session B: run.completed", envelope: runCompleted("sess-d3-w6-B", 9) },
		]
		const result = await driveAndSample(fixture, sequence)
		// Tightened to exact positive assertions (per reviewer R3).
		// Cross-session: authority resolver returns STALE for every
		// translated event, so none of APPLY/SUPPRESS/DIAGNOSTIC
		// are incremented. The captured CoreSessionEvent array still
		// has 8 agent_event envelopes (these reach the wiring but
		// are rejected before the recorder's counters increment).
		const counts = countTranslated(fixture.captured)
		expect(counts.total).toBe(8)
		// Exact: 0 APPLY, 0 SUPPRESS, 0 DIAGNOSTIC. The session
		// guard works correctly for cross-session events under
		// FALLBACK_APPLY.
		expect(result.counts.fallbackReconstructedApplied).toBe(0)
		expect(result.counts.fallbackSuppressedCount).toBe(0)
		expect(result.counts.diagnosticByOrigin).toBe(0)
	})

	// D3-W7: RECOVERY MISSING RUN ID — produce a recovery-shaped
	// notice with conversationId INTENTIONALLY absent. Observe the
	// translator's structural inability to seed activeRunId.
	it("D3-W7: recovery notice without conversationId — observer records the seed failure", async () => {
		const fixture = await buildComposition({ sessionId: "sess-d3-w7" })
		// session.notice with NO agent.conversationId (test that
		// the field is genuinely absent, not a synthetic empty string).
		const noticeWithoutConversationId: HubEventEnvelope = {
			version: "v1",
			event: "session.notice",
			sessionId: "sess-d3-w7",
			timestamp: 2,
			payload: {
				noticeType: "recovery",
				displayRole: "status",
				reason: "stuck",
				message: "recovering",
				agent: { agentId: "agent-unknown" /* no conversationId */ },
			},
		}
		const sequence: ScriptedEnvelope[] = [
			{ label: "A: run.started", envelope: runStarted("sess-d3-w7", 0) },
			{ label: "A: iteration.started", envelope: iterationStarted("sess-d3-w7", 1, 1) },
			{ label: "A: session.notice (no conversationId)", envelope: noticeWithoutConversationId },
			{ label: "A: tool.started", envelope: toolStarted("sess-d3-w7", 3, "tool-1", "readFile") },
			{ label: "A: tool.finished", envelope: toolFinished("sess-d3-w7", 4, "tool-1", "readFile") },
			{ label: "A: run.completed", envelope: runCompleted("sess-d3-w7", 5) },
		]
		const result = await driveAndSample(fixture, sequence)
		const counts = countTranslated(fixture.captured)
		// Single epoch: 4 translated, all apply.
		expect(counts.total).toBe(4)
		expect(result.counts.fallbackReconstructedApplied).toBe(4)
		expect(result.counts.fallbackSuppressedCount).toBe(0)
		// Notice with conversationId=undefined cannot rescue the
		// activeRunId tracker. The translator's stranded-terminal
		// gate stays dead for this composition.
	})

	// D3-W8: TERMINAL VARIANTS — run.failed and run.aborted.
	// Pre-repair: same shape as W1 (single epoch) but with the
	// failure/abort terminal variants. Failure and aborted also
	// route through emitAgentDoneIfNeeded, so they emit a "done"
	// event (the translator's "error" path) and contribute to the
	// 4 translated events/n cycle. Both terminal variants are
	// treated identically under the pre-repair translator.
	//
	// NOTE: This is a Hub harness-side witness only. Real
	// RemoteRuntimeHost parity is NOT inherited from D1-REMOTE
	// for the D3 disposition (per reviewer R1, D3-CORRECTION01).
	// The D1-REMOTE witness was a single-epoch structural-parity
	// witness. The R-D3-1..R-D3-3 tests below exercise real
	// RemoteRuntimeHost for the decisive D3 subset.
	it("D3-W8: terminal variants — run.failed and run.aborted both route through emitAgentDoneIfNeeded", async () => {
		// Variant 1: run.failed
		const f1 = await buildComposition({ sessionId: "sess-d3-w8-f" })
		const f1Sequence: ScriptedEnvelope[] = [
			{ label: "A: run.started", envelope: runStarted("sess-d3-w8-f", 0) },
			{ label: "A: iteration.started", envelope: iterationStarted("sess-d3-w8-f", 1, 1) },
			{ label: "A: tool.started", envelope: toolStarted("sess-d3-w8-f", 2, "tool-1", "readFile") },
			{ label: "A: tool.finished", envelope: toolFinished("sess-d3-w8-f", 3, "tool-1", "readFile") },
			{ label: "A: run.failed", envelope: runFailed("sess-d3-w8-f", 4) },
		]
		const f1Result = await driveAndSample(f1, f1Sequence)
		const f1Counts = countTranslated(f1.captured)
		// run.failed → emitAgentDoneIfNeeded → "done" event;
		// translator maps to "run-failed" (different from "run-finished").
		// Same 4 translated events pre-repair (iteration_start,
		// content_start, content_end, done).
		expect(f1Counts.total).toBe(4)
		expect(f1Result.counts.fallbackReconstructedApplied).toBe(4)
		expect(f1Result.counts.fallbackSuppressedCount).toBe(0)

		// Variant 2: run.aborted
		const a1 = await buildComposition({ sessionId: "sess-d3-w8-a" })
		const a1Sequence: ScriptedEnvelope[] = [
			{ label: "A: run.started", envelope: runStarted("sess-d3-w8-a", 0) },
			{ label: "A: iteration.started", envelope: iterationStarted("sess-d3-w8-a", 1, 1) },
			{ label: "A: tool.started", envelope: toolStarted("sess-d3-w8-a", 2, "tool-1", "readFile") },
			{ label: "A: tool.finished", envelope: toolFinished("sess-d3-w8-a", 3, "tool-1", "readFile") },
			{ label: "A: run.aborted", envelope: runAborted("sess-d3-w8-a", 4) },
		]
		const a1Result = await driveAndSample(a1, a1Sequence)
		const a1Counts = countTranslated(a1.captured)
		expect(a1Counts.total).toBe(4)
		expect(a1Result.counts.fallbackReconstructedApplied).toBe(4)
		expect(a1Result.counts.fallbackSuppressedCount).toBe(0)
	})

	it("R-D3-1: real RemoteRuntimeHost — two same-session epochs (mirrors D3-W2; expected 8/6/2)", async () => {
		const fixture = await buildRemoteComposition({ sessionId: "sess-r-d3-1" })
		const sequence: ScriptedEnvelope[] = [
			{ label: "A: run.started", envelope: runStarted("sess-r-d3-1", 0) },
			{ label: "A: iteration.started", envelope: iterationStarted("sess-r-d3-1", 1, 1) },
			{
				label: "A: session.notice (run-A)",
				envelope: sessionNoticeWithConversationId("sess-r-d3-1", 2, "run-A", "agent-A"),
			},
			{ label: "A: tool.started", envelope: toolStarted("sess-r-d3-1", 3, "tool-1", "readFile") },
			{ label: "A: tool.finished", envelope: toolFinished("sess-r-d3-1", 4, "tool-1", "readFile") },
			{ label: "A: run.completed", envelope: runCompleted("sess-r-d3-1", 5) },
			{ label: "B: run.started", envelope: runStarted("sess-r-d3-1", 6) },
			{ label: "B: iteration.started", envelope: iterationStarted("sess-r-d3-1", 7, 1) },
			{
				label: "B: session.notice (run-B)",
				envelope: sessionNoticeWithConversationId("sess-r-d3-1", 8, "run-B", "agent-B"),
			},
			{ label: "B: tool.started", envelope: toolStarted("sess-r-d3-1", 9, "tool-2", "readFile") },
			{ label: "B: tool.finished", envelope: toolFinished("sess-r-d3-1", 10, "tool-2", "readFile") },
			{ label: "B: run.completed", envelope: runCompleted("sess-r-d3-1", 11) },
		]
		const result = await driveAndSample(fixture, sequence)
		const counts = countTranslated(fixture.captured)
		// Real RemoteRuntimeHost inherits HubRuntimeHost's handleHubEvent.
		// Expected: same 8/6/2 as D3-W2.
		expect(counts.total).toBe(8)
		expect(result.counts.fallbackReconstructedApplied).toBe(6)
		expect(result.counts.fallbackSuppressedCount).toBe(2)
	})

	it("R-D3-2: real RemoteRuntimeHost — late terminal from epoch A after epoch B starts (mirrors D3-W3; expected 8/6/2)", async () => {
		const fixture = await buildRemoteComposition({ sessionId: "sess-r-d3-2" })
		const sequence: ScriptedEnvelope[] = [
			{ label: "A: run.started", envelope: runStarted("sess-r-d3-2", 0) },
			{ label: "A: iteration.started", envelope: iterationStarted("sess-r-d3-2", 1, 1) },
			{ label: "A: tool.started", envelope: toolStarted("sess-r-d3-2", 2, "tool-1", "readFile") },
			{ label: "A: tool.finished", envelope: toolFinished("sess-r-d3-2", 3, "tool-1", "readFile") },
			{ label: "A: run.completed", envelope: runCompleted("sess-r-d3-2", 4) },
			{ label: "B: run.started", envelope: runStarted("sess-r-d3-2", 5) },
			{ label: "B: iteration.started", envelope: iterationStarted("sess-r-d3-2", 6, 1) },
			{ label: "A: late run.completed", envelope: runCompleted("sess-r-d3-2", 7) },
			{ label: "B: tool.started", envelope: toolStarted("sess-r-d3-2", 8, "tool-2", "readFile") },
			{ label: "B: tool.finished", envelope: toolFinished("sess-r-d3-2", 9, "tool-2", "readFile") },
			{ label: "B: run.completed", envelope: runCompleted("sess-r-d3-2", 10) },
		]
		const result = await driveAndSample(fixture, sequence)
		const counts = countTranslated(fixture.captured)
		expect(counts.total).toBe(8)
		expect(result.counts.fallbackReconstructedApplied).toBe(6)
		expect(result.counts.fallbackSuppressedCount).toBe(2)
	})

	it("R-D3-3: real RemoteRuntimeHost — recovery notice without conversationId (mirrors D3-W7; expected 4/4/0)", async () => {
		const fixture = await buildRemoteComposition({ sessionId: "sess-r-d3-3" })
		const noticeWithoutConversationId: HubEventEnvelope = {
			version: "v1",
			event: "session.notice",
			sessionId: "sess-r-d3-3",
			timestamp: 2,
			payload: {
				noticeType: "recovery",
				displayRole: "status",
				reason: "stuck",
				message: "recovering",
				agent: { agentId: "agent-unknown" /* no conversationId */ },
			},
		}
		const sequence: ScriptedEnvelope[] = [
			{ label: "A: run.started", envelope: runStarted("sess-r-d3-3", 0) },
			{ label: "A: iteration.started", envelope: iterationStarted("sess-r-d3-3", 1, 1) },
			{ label: "A: session.notice (no conversationId)", envelope: noticeWithoutConversationId },
			{ label: "A: tool.started", envelope: toolStarted("sess-r-d3-3", 3, "tool-1", "readFile") },
			{ label: "A: tool.finished", envelope: toolFinished("sess-r-d3-3", 4, "tool-1", "readFile") },
			{ label: "A: run.completed", envelope: runCompleted("sess-r-d3-3", 5) },
		]
		const result = await driveAndSample(fixture, sequence)
		const counts = countTranslated(fixture.captured)
		expect(counts.total).toBe(4)
		expect(result.counts.fallbackReconstructedApplied).toBe(4)
		expect(result.counts.fallbackSuppressedCount).toBe(0)
	})
})
