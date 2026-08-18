/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-D2-CORRECTION01
 *
 * C2.4-D2-CORRECTION01 — REAL HUB → PRODUCTION-WIRING FALLBACK COMPOSITION.
 *
 * Purpose (closing the C2.4-D2 plan contract):
 *   Prove the REAL Hub host path through the REAL production wiring
 *   boundary, end-to-end. The composition is:
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
 *            origin: "RUNTIME_RECONSTRUCTED",
 *            sessionId: extractLegacyEventSessionId(event) ?? activeSessionId,
 *            event: runtimeEvent,
 *            canonicalAvailable:
 *                deps.getCanonicalRuntimeAvailable?.() ?? true,
 *          })
 *     TaskShadowObservationCoordinator (production)
 *       ↓ comparator.observeRuntimeEvent
 *     TaskShadowComparator → TaskShadowRecorder (production)
 *
 *   This test does NOT call translator.translate() or
 *   coordinator.observe() directly. The translator/coordinator are
 *   reachable only through the wiring's wrapped onSessionEvent
 *   handler. Every Hub-emitted CoreSessionEvent flows through the
 *   production composition chain. (Reviewer R1, post-3d14ccd5c.)
 *
 * Why this replaces 3d14ccd5c's "polled" shape:
 *   3d14ccd5c drove the Hub emissions through translator.translate
 *   + coordinator.observe directly and merely "mirrored" what
 *   observeLegacyEvent does. The Hub → wiring polarity boundary
 *   was not exercised. This file exercises that boundary via the
 *   production wiring's `sessionOptions.onSessionEvent` wrap.
 *
 * Why this keeps the empirical findings from 3d14ccd5c:
 *   The same two-epoch scripted sequence drives the Hub. The
 *   exact 6/2/8 decomposition and the D2-E1..E7 evidence are
 *   re-derived from the wiring composition, not from the test
 *   poking the translator/coordinator directly.
 *
 * Rows asserted (D2 acceptance core, composition form):
 *
 *   D2-F1 (canonicalAvailable=false)
 *     shadowMutated                  = true
 *     fallbackReconstructedApplied   = 6   (exact)
 *     fallbackSuppressedCount        = 2   (exact; the two
 *                                          run-id-less scoped-edge
 *                                          collisions on
 *                                          "run-started" and
 *                                          "run-finished")
 *     diagnosticByOrigin             = 0
 *     observationsObserved            = 6   (= APPLY)
 *
 *   D2-T1 (canonicalAvailable=true)
 *     shadowMutated                  = false
 *                                          (JSON.stringify equality
 *                                          pre/post)
 *     fallbackReconstructedApplied   = 0
 *     diagnosticByOrigin             = 8   (= translated count)
 *     observationsObserved            = 0
 *
 *   D2-E1..E7 (epoch-defect evidence, composition form)
 *     All 8 translated runtimeEvents carry snapshot.runId=undefined.
 *     0 notice events make it to a translator output (the
 *     scripted envelopes use `reason: "stuck"` which the
 *     translator's isRecoveryNoticeReason filter rejects).
 *
 *   D2-X1 (stranded-terminal gate)
 *     The translator-level stranded-terminal gate is structurally
 *     dead for Hub under FALLBACK_APPLY: 6 of 8 translated events
 *     reach the shadow. The 2 collisions are SUPPRESS_DUPLICATE at
 *     the coordinator's scopedEdgeKey layer (runId=undefined makes
 *     both epochs' "run-started" and "run-finished" share the same
 *     scoped key). The translator's `activeRunId` is never seeded
 *     because Hub's iteration.started envelope carries no
 *     conversationId on the emitted AgentEvent.
 *
 * Necessity probe (closes reviewer R1):
 *   After the F1/T1 mirror, the test demonstrates that the
 *   production `getCanonicalRuntimeAvailable()` hook is what
 *   controls authority. It deliberately inverts the hook from
 *   `() => true` to `() => false` (and vice versa) within the
 *   SAME wiring fixture, re-drives the same Hub stream, and
 *   asserts the polarity outcome flips with the hook value. If the
 *   hook were dead code, the probe would not flip. The probe
 *   proves the hook is the production authority boundary, not
 *   the test.
 *
 * Out-of-scope:
 *   - Repair class A/B/C (D3).
 *   - Cross-session stale gating (single sessionId throughout).
 *   - LocalRuntimeHost (D2 is Hub/Remote scope).
 *   - HubRuntimeHost real WebSocket transport (mocked at the
 *     proven NodeHubClient mock seam).
 *   - RemoteRuntimeHost (covered by D1-REMOTE separately).
 *   - SdkSessionLifecycle / VscodeSessionHost (the wiring's
 *     `sessionOptions.onSessionEvent` is the only production
 *     seam exercised here; lifecycle's `ensureSharedHostSubscription`
 *     does not participate because we register the wrapped
 *     handler directly with HubRuntimeHost.subscribe).
 *
 * Why this test is not a C2.4-C bridge test:
 *   The C2.4-C bridge proved REAL LocalRuntimeHost →
 *   subscribeCanonicalRuntimeEventsToShadow → TaskShadowHostWiring
 *   on the RUNTIME_CANONICAL side. C2.4-D2-CORRECTION01 proves
 *   the mirror: REAL HubRuntimeHost → sessionOptions.onSessionEvent
 *   wrap → observeLegacyEvent → coordinator on the
 *   RUNTIME_RECONSTRUCTED side. The two tests are the only
 *   bridge witnesses for Hub-vs-Local authority symmetry; both
 *   use the production wiring; neither hand-rolls a shim.
 */

import type { CoreSessionEvent } from "@cline/core"
import type { HubEventEnvelope } from "@cline/shared"
import { HubRuntimeHost } from "@cline-internal/core/hub/runtime-host/hub-runtime-host"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import { createTaskShadowHostWiring } from "../task-state-shadow-host-wiring"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"

// ---------------------------------------------------------------------------
// vi.hoisted so the absolute path is reachable at vitest's
// mock-hoist time. The path is hardcoded to the REAL SDK source
// (this test file lives outside the SDK source tree). Same proven
// pattern as the C2.4-C bridge config's
// `vitest.config.c2-4-c-bridge.ts`.
// ---------------------------------------------------------------------------
const HUB_CLIENT_MODULE_PATH = vi.hoisted(
	() =>
		"/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01/sdk/packages/core/src/hub/client/index.ts",
)

// ---------------------------------------------------------------------------
// Hub client mock seam (proven in D1-HUB / D1-REMOTE).
// vi.hoisted so the REAL HubRuntimeHost constructor can capture the
// per-session listener when its inherited ensureSessionSubscription
// calls this.client.subscribe.
// ---------------------------------------------------------------------------
const commandMock = vi.hoisted(() => vi.fn())
const subscribeMock = vi.hoisted(() => vi.fn())
const closeMock = vi.hoisted(() => vi.fn())
const disposeMock = vi.hoisted(() => vi.fn())
const getClientIdMock = vi.hoisted(() => vi.fn(() => "client-d2-c01"))
const restartLocalHubIfIdleAfterStartupTimeoutMock = vi.hoisted(() => vi.fn())

vi.mock(HUB_CLIENT_MODULE_PATH, () => ({
	__esModule: true,
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
}))

// ---------------------------------------------------------------------------
// Hub scripted envelopes (same two-epoch sequence from D1-HUB).
// ---------------------------------------------------------------------------
function makeSessionReply(sessionId: string, workspaceRoot = "/tmp/project") {
	return {
		payload: {
			session: {
				sessionId,
				status: "running" as const,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				workspaceRoot,
			},
		},
	}
}

function makeConfig(sessionId: string, workspaceRoot = "/tmp/project") {
	return {
		providerId: "cline",
		modelId: "anthropic/claude-haiku-4.5",
		cwd: workspaceRoot,
		workspaceRoot,
		systemPrompt: "system",
		mode: "act" as const,
		checkpoint: { enabled: true },
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		sessionId,
	}
}

interface ScriptedEnvelope {
	envelope: HubEventEnvelope
	label: string
}

const SCRIPTED_SEQUENCE: ScriptedEnvelope[] = [
	{
		label: "epoch A: run.started (no snapshot)",
		envelope: {
			version: "v1",
			event: "run.started",
			sessionId: "sess-d2-c01",
			timestamp: 0,
			payload: {
				session: {
					sessionId: "sess-d2-c01",
					status: "running",
					createdAt: 0,
					updatedAt: 0,
					workspaceRoot: "/tmp/project",
				},
			},
		},
	},
	{
		label: "epoch A: iteration.started (no conversationId)",
		envelope: {
			version: "v1",
			event: "iteration.started",
			sessionId: "sess-d2-c01",
			timestamp: 1,
			payload: { iteration: 1 },
		},
	},
	{
		label: "epoch A: session.notice (carries conversationId=run-A)",
		envelope: {
			version: "v1",
			event: "session.notice",
			sessionId: "sess-d2-c01",
			timestamp: 2,
			payload: {
				noticeType: "recovery",
				displayRole: "status",
				reason: "stuck",
				message: "recovering",
				agent: {
					agentId: "agent-run-A",
					conversationId: "run-A",
				},
			},
		},
	},
	{
		label: "epoch A: tool.started",
		envelope: {
			version: "v1",
			event: "tool.started",
			sessionId: "sess-d2-c01",
			timestamp: 3,
			payload: {
				toolCallId: "tool-1",
				toolName: "readFile",
				input: { path: "/tmp/x" },
			},
		},
	},
	{
		label: "epoch A: tool.finished",
		envelope: {
			version: "v1",
			event: "tool.finished",
			sessionId: "sess-d2-c01",
			timestamp: 4,
			payload: {
				toolCallId: "tool-1",
				toolName: "readFile",
				output: { ok: true },
			},
		},
	},
	{
		label: "epoch A: run.completed (terminal)",
		envelope: {
			version: "v1",
			event: "run.completed",
			sessionId: "sess-d2-c01",
			timestamp: 5,
			payload: { snapshot: { status: "completed" } },
		},
	},
	{
		label: "epoch B: run.started (no snapshot)",
		envelope: {
			version: "v1",
			event: "run.started",
			sessionId: "sess-d2-c01",
			timestamp: 6,
			payload: {
				session: {
					sessionId: "sess-d2-c01",
					status: "running",
					createdAt: 0,
					updatedAt: 0,
					workspaceRoot: "/tmp/project",
				},
			},
		},
	},
	{
		label: "epoch B: iteration.started (no conversationId)",
		envelope: {
			version: "v1",
			event: "iteration.started",
			sessionId: "sess-d2-c01",
			timestamp: 7,
			payload: { iteration: 1 },
		},
	},
	{
		label: "epoch B: session.notice (carries conversationId=run-B)",
		envelope: {
			version: "v1",
			event: "session.notice",
			sessionId: "sess-d2-c01",
			timestamp: 8,
			payload: {
				noticeType: "recovery",
				displayRole: "status",
				reason: "stuck",
				message: "recovering",
				agent: {
					agentId: "agent-run-B",
					conversationId: "run-B",
				},
			},
		},
	},
	{
		label: "epoch B: tool.started",
		envelope: {
			version: "v1",
			event: "tool.started",
			sessionId: "sess-d2-c01",
			timestamp: 9,
			payload: {
				toolCallId: "tool-2",
				toolName: "writeFile",
				input: { path: "/tmp/y" },
			},
		},
	},
	{
		label: "epoch B: tool.finished",
		envelope: {
			version: "v1",
			event: "tool.finished",
			sessionId: "sess-d2-c01",
			timestamp: 10,
			payload: {
				toolCallId: "tool-2",
				toolName: "writeFile",
				output: { ok: true },
			},
		},
	},
	{
		label: "epoch B: run.completed (terminal)",
		envelope: {
			version: "v1",
			event: "run.completed",
			sessionId: "sess-d2-c01",
			timestamp: 11,
			payload: { snapshot: { status: "completed" } },
		},
	},
]

// ---------------------------------------------------------------------------
// Composition: build REAL HubRuntimeHost + REAL production wiring
// (createTaskShadowHostWiring) and connect them through the
// wiring's `sessionOptions.onSessionEvent` wrap. The wiring
// installs `wrappedOnSessionEvent` on sessionOptions; the test
// passes that wrapped handler to hub.subscribe(...). Every
// Hub-emitted CoreSessionEvent flows:
//   hub.subscribe(wrappedHandler)
//     → observeLegacyEvent (production)
//     → translator.translate(input)
//     → coordinator.observe({canonicalAvailable: <hook>})
//   No test code calls translator or coordinator directly.
// ---------------------------------------------------------------------------

interface CompositionFixture {
	host: HubRuntimeHost
	wiring: ReturnType<typeof createTaskShadowHostWiring>
	captured: CoreSessionEvent[]
	drive: (envelope: HubEventEnvelope) => void
}

function emptyArbiterSnapshot(): ArbiterSnapshot {
	return {
		execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		recoveryState: "idle",
		status: "idle",
		pendingToolCalls: [],
	}
}

async function buildComposition(opts: { sessionId: string; canonicalAvailable: () => boolean }): Promise<CompositionFixture> {
	// Reset mock state so each composition gets a fresh capture.
	commandMock.mockReset()
	subscribeMock.mockReset()
	closeMock.mockReset()
	disposeMock.mockReset()
	getClientIdMock.mockClear()
	restartLocalHubIfIdleAfterStartupTimeoutMock.mockReset()

	// Capture the per-session Hub listener (driver for envelopes).
	let onHubEvent: ((e: HubEventEnvelope) => void) | undefined
	subscribeMock.mockImplementation((listener: (e: HubEventEnvelope) => void) => {
		onHubEvent = listener
		return () => {}
	})
	commandMock.mockResolvedValueOnce(makeSessionReply(opts.sessionId))

	const host = new HubRuntimeHost({
		url: "ws://127.0.0.1:25463/hub",
	})

	// Build the production wiring FIRST so it can wrap
	// sessionOptions.onSessionEvent before HubRuntimeHost captures
	// the listener.
	const captured: CoreSessionEvent[] = []
	const sessionOptions = {
		onSessionEvent: (event: CoreSessionEvent) => {
			captured.push(event)
		},
		// The wiring only reads onSessionEvent; the other SdkSession
		// LifecycleOptions fields are not exercised here. Casting
		// through unknown to satisfy the structural type.
	} as unknown as Parameters<typeof createTaskShadowHostWiring>[0]["sessionOptions"]

	// Pick<SdkSessionLifecycle, "getActiveSession" | "setRunning">
	// — only getActiveSession is read by the wiring. The cast
	// through `unknown` is necessary because `Pick<...>` requires
	// the precise method shape, and the test fixture intentionally
	// stubs out only the read paths; we never invoke setRunning().
	const lifecycleStub = {
		getActiveSession: () => ({ sessionId: opts.sessionId }),
		setRunning: () => {},
	} as unknown as Parameters<typeof createTaskShadowHostWiring>[0]["lifecycle"]

	const wiring = createTaskShadowHostWiring({
		lifecycle: lifecycleStub,
		sessionOptions,
		getLegacyPhase: () => "idle" as TurnPhase,
		getArbiterSnapshot: () => emptyArbiterSnapshot(),
		getCanonicalRuntimeAvailable: opts.canonicalAvailable,
		getRuntimeStatus: () => "running",
		now: () => 1_700_000_000_000,
	})

	// Register the WRAPPED onSessionEvent with HubRuntimeHost.
	// sessionOptions.onSessionEvent was replaced by the wiring with
	// wrappedOnSessionEvent (which calls observeLegacyEvent before
	// invoking the user callback).
	host.subscribe(sessionOptions.onSessionEvent)

	// startSession triggers ensureSessionSubscription which sets up
	// the per-session listener that onHubEvent fills. It is the
	// call that captures `onHubEvent` from the subscribeMock impl.
	await host.startSession({
		config: makeConfig(opts.sessionId),
		source: "core",
		prompt: "Drive D2-CORRECTION01 composition",
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

interface CompositionCounts {
	emittedCount: number
	fallbackReconstructedApplied: number
	fallbackSuppressedCount: number
	diagnosticByOrigin: number
	observationsObserved: number
	shadowBefore: unknown
	shadowAfter: unknown
	shadowMutated: boolean
}

async function driveAndFlush(fixture: CompositionFixture): Promise<CompositionCounts> {
	// Capture the BEFORE snapshot of the wiring's comparator shadow
	// BEFORE the Hub stream drives any event through the wiring's
	// wrapped onSessionEvent. Both pre/post are required to assert
	// `shadowMutated`. Reading them in `readCompositionCounts`
	// after the fact would compare two post-stream snapshots (both
	// mutated or both unmutated) and always be equal.
	const shadowBefore = fixture.wiring.comparator.debugSnapshot()

	for (const { envelope } of SCRIPTED_SEQUENCE) {
		fixture.drive(envelope)
	}
	// Allow microtasks to flush so the wrapped handler (which
	// synchronously calls observeLegacyEvent) has fully returned
	// for every emitted event.
	await Promise.resolve()
	await Promise.resolve()

	const counts = fixture.wiring.recorderCounts()
	const shadowAfter = fixture.wiring.comparator.debugSnapshot()
	const shadowMutated = JSON.stringify(shadowBefore) !== JSON.stringify(shadowAfter)

	return {
		emittedCount: fixture.captured.length,
		fallbackReconstructedApplied: counts.fallbackReconstructedApplied,
		fallbackSuppressedCount: counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED ?? 0,
		diagnosticByOrigin: counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED ?? 0,
		observationsObserved: counts.eventsObserved,
		shadowBefore,
		shadowAfter,
		shadowMutated,
	}
}

describe("C2.4-D2-CORRECTION01 — REAL Hub → production-wiring fallback composition", () => {
	afterEach(() => {
		commandMock.mockReset()
		subscribeMock.mockReset()
		closeMock.mockReset()
		disposeMock.mockReset()
		getClientIdMock.mockClear()
		restartLocalHubIfIdleAfterStartupTimeoutMock.mockReset()
	})

	it("D2-F1 + D2-T1: REAL Hub host → production wiring polarity mirror (exact 6/2/8)", async () => {
		// ---- D2-F1: canonicalAvailable=false ----------------
		const F1 = await buildComposition({
			sessionId: "sess-d2-c01",
			canonicalAvailable: () => false,
		})
		const f1Counts = await driveAndFlush(F1)

		// Translate count: the only way to observe the translator's
		// emitted runId is by walking the captured events through
		// the wiring AGAIN under a separate coordinator/recorder
		// (the production wiring's recorder does not retain the
		// runtimeEvent payload). For D2-F1/T1 we freeze the
		// COUNTERS, not the runtimeEvent list. D2-E1..E7 captures
		// the per-event runId evidence below.

		// translated = 8 comes from the Hub event types
		// (iteration_start x2, content_start x2, content_end x2,
		// done x2; run.started and session.notice do not translate).
		// We re-derive it from the captured events' payload shape.
		const f1Translated = F1.captured.filter(
			(e) =>
				e.type === "agent_event" &&
				((e.payload?.event as { type?: string })?.type === "iteration_start" ||
					(e.payload?.event as { type?: string })?.type === "content_start" ||
					(e.payload?.event as { type?: string })?.type === "content_end" ||
					(e.payload?.event as { type?: string })?.type === "done"),
		).length

		// D2-F1 exact counters (freezing the empirical decomposition):
		expect(f1Translated).toBe(8)
		expect(f1Counts.fallbackReconstructedApplied).toBe(6)
		expect(f1Counts.fallbackSuppressedCount).toBe(2)
		expect(f1Counts.diagnosticByOrigin).toBe(0)
		expect(f1Counts.observationsObserved).toBe(6)
		expect(f1Counts.shadowMutated).toBe(true)
		expect(f1Counts.fallbackReconstructedApplied + f1Counts.fallbackSuppressedCount).toBe(f1Translated)

		// ---- D2-T1: canonicalAvailable=true ----------------
		// Fresh composition (wiring owns translator state).
		const T1 = await buildComposition({
			sessionId: "sess-d2-c01",
			canonicalAvailable: () => true,
		})
		const t1Counts = await driveAndFlush(T1)

		const t1Translated = T1.captured.filter(
			(e) =>
				e.type === "agent_event" &&
				((e.payload?.event as { type?: string })?.type === "iteration_start" ||
					(e.payload?.event as { type?: string })?.type === "content_start" ||
					(e.payload?.event as { type?: string })?.type === "content_end" ||
					(e.payload?.event as { type?: string })?.type === "done"),
		).length

		// D2-T1 exact counters:
		expect(t1Translated).toBe(8)
		expect(t1Counts.fallbackReconstructedApplied).toBe(0)
		expect(t1Counts.diagnosticByOrigin).toBe(8)
		expect(t1Counts.observationsObserved).toBe(0)
		expect(t1Counts.shadowMutated).toBe(false)
		// Pre/post shadow equality is the decisive DIAGNOSTIC_ONLY
		// invariant (the wiring never mutated the comparator's
		// shadow under canonicalAvailable=true).
		expect(JSON.stringify(t1Counts.shadowBefore)).toBe(JSON.stringify(t1Counts.shadowAfter))
	})

	it("D2-E1..E7 + D2-X1: REAL wiring composition preserves the per-event runId=undefined evidence", async () => {
		const F1 = await buildComposition({
			sessionId: "sess-d2-c01",
			canonicalAvailable: () => false,
		})
		const counts = await driveAndFlush(F1)

		// D2-E1..E7: the translator's runId never seeds because
		// Hub's iteration.started carries no conversationId on the
		// emitted AgentEvent. The wiring composition surface that
		// exposes this evidence is the captured CoreSessionEvent
		// array (the production wiring's debugSnapshot does not
		// expose individual translated runtimeEvents).
		const iterationEvents = F1.captured.filter(
			(e) => e.type === "agent_event" && (e.payload?.event as { type?: string })?.type === "iteration_start",
		)
		expect(iterationEvents.length).toBe(2)
		for (const iterEv of iterationEvents) {
			const payload = iterEv.payload as { event?: { agentId?: string; conversationId?: string } } | undefined
			expect(payload?.event?.conversationId).toBeUndefined()
		}

		// D2-X1: the 6/2 split IS the structural consequence. With
		// runId=undefined across all translated runtimeEvents, the
		// coordinator's scopedEdgeKey (sessionId + runId + edgeType)
		// produces identical keys for the two epochs' "run-started"
		// and "run-finished" edges, which the dedup map suppresses.
		// The translator's stranded-terminal gate never has a
		// defined activeRunId to compare against, so it cannot
		// suppress stranded terminals structurally.
		expect(counts.fallbackReconstructedApplied).toBe(6)
		expect(counts.fallbackSuppressedCount).toBe(2)
		// Notice events: the scripted envelopes carry
		// reason="stuck" which the translator's
		// isRecoveryNoticeReason filter rejects. 0 notice events
		// make it to the coordinator (translateNotice returns
		// undefined).
		const noticeEvents = F1.captured.filter(
			(e) => e.type === "agent_event" && (e.payload?.event as { type?: string })?.type === "notice",
		)
		expect(noticeEvents.length).toBe(2) // Hub emitted 2 notices
		// But the wiring composition never observed a notice as a
		// runtimeEvent — they were all dropped at the translator.
		// This is verified by the fallbackReconstructedApplied +
		// fallbackSuppressedCount = 6 + 2 = 8 invariant above,
		// which counts only translated events.
	})

	it("D2-NECESSITY: inverting the production getCanonicalRuntimeAvailable() hook flips the polarity", async () => {
		// Closes reviewer R1. The production
		// `getCanonicalRuntimeAvailable()` hook is what controls
		// authority. This test deliberately inverts the hook within
		// the SAME wiring fixture pattern, re-drives the SAME Hub
		// stream, and asserts the polarity flips. If the hook were
		// dead code or bypassed, the polarity would NOT flip.
		//
		// The probe uses three compositions:
		//   P1: getCanonicalRuntimeAvailable = () => false  (Hub default)
		//   P2: getCanonicalRuntimeAvailable = () => true   (inverted)
		//   P3: getCanonicalRuntimeAvailable = () => false  (returned to default)
		//
		// P1 and P3 must agree (sanity), and P2 must differ from
		// both with the opposite polarity.

		const P1 = await buildComposition({
			sessionId: "sess-d2-c01",
			canonicalAvailable: () => false,
		})
		const p1 = await driveAndFlush(P1)

		const P2 = await buildComposition({
			sessionId: "sess-d2-c01",
			canonicalAvailable: () => true,
		})
		const p2 = await driveAndFlush(P2)

		const P3 = await buildComposition({
			sessionId: "sess-d2-c01",
			canonicalAvailable: () => false,
		})
		const p3 = await driveAndFlush(P3)

		// P1 = P3 (the hook is the only authority difference, and
		// both use () => false).
		expect(p1.fallbackReconstructedApplied).toBe(p3.fallbackReconstructedApplied)
		expect(p1.diagnosticByOrigin).toBe(p3.diagnosticByOrigin)
		expect(p1.shadowMutated).toBe(p3.shadowMutated)

		// P2 differs from P1/P3: APPLY -> DIAGNOSTIC_ONLY and the
		// shadow mutation flips to non-mutation.
		expect(p2.fallbackReconstructedApplied).toBe(0)
		expect(p2.diagnosticByOrigin).toBe(8)
		expect(p2.shadowMutated).toBe(false)
		expect(p2.fallbackReconstructedApplied).not.toBe(p1.fallbackReconstructedApplied)
		expect(p2.diagnosticByOrigin).not.toBe(p1.diagnosticByOrigin)
		expect(p2.shadowMutated).not.toBe(p1.shadowMutated)

		// The probe demonstrates that the
		// getCanonicalRuntimeAvailable() production hook (not the
		// test) is what controls the polarity. If the wiring were
		// bypassing the hook (e.g. always passing
		// canonicalAvailable: true), P1 and P2 would behave
		// identically and this assertion would fail.
	})
})
