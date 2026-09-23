/**
 * ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01 / EHLOOP01
 *
 * Reproduction + bounded repair test for the LIVE failure:
 *
 *   One ordinary background-command completion lifecycle
 *   → multiple `pending_prompts` / `pending_prompt_submitted`
 *     session events flowing through `handleSessionEvent`
 *   → `logQueueEvents` invoked unconditionally per event
 *   → synchronous `Logger.log` → `Logger.#output` →
 *     `outputChannel.appendLine` I/O wait
 *   → extension host monopolized for seconds at a time
 *   → VSCodium declares the extension host UNRESPONSIVE
 *   → automatic CPU profile captured
 *   → extension host terminated + restarted
 *
 * LIVE evidence: exthost-66cdb2.cpuprofile (5,379.2 ms, 38,457 samples).
 *   20.3% of all samples fell below `logQueueEvents`.
 *   7.1% of all samples were spent inside `Logger.#output` (rank 4).
 *   26.6% of all samples were spent inside Node-side
 *     `outputChannel.appendLine` I/O wait (rank 1).
 *   44.7% of all samples fell below `handleSessionEvent`.
 *
 * The LIVE failure was captured in the **dogfood** profile (installed
 * build `s1onique.clinemm-4.1.16-99006fbcc`,
 * `CLINEMM_RUNTIME_PROFILE=dogfood`). The original repair (V1)
 * gated the synchronous `Logger.log` inside `logQueueEvents` behind
 * the diagnostic enablement bit, which is itself driven by the
 * dogfood profile — that made the gate unfixable because the
 * hot path was deliberately re-armed in dogfood, the exact mode
 * where the LIVE failure occurred.
 *
 * CORRECTION01 (this version): the diagnostic enablement bit and
 * the synchronous breadcrumb opt-in are DECOUPLED. The hot path is
 * bounded by the PERMANENT production rule:
 *
 *   - Diagnostic enablement (counters + phase writes): defaulted by
 *     dogfood profile. Cheap. May be removed post-qualification.
 *   - Synchronous queue-log opt-in (the Logger.log breadcrumb):
 *     DEFAULT OFF in every profile. Honored ONLY when the operator
 *     explicitly sets `CLINEMM_DIAG_HOTLOOP_QUEUE_LOG=<truthy>` in
 *     dogfood. Public installs can never enable this.
 *
 * Production seams under test:
 *   - `SdkSessionEventCoordinator.handleSessionEvent`
 *   - `SdkSessionEventCoordinator.logQueueEvents`
 *   - `TurnStateTracker.setWithWriter` (real production class)
 *   - `extension-host-hotloop-diagnostic` counter module
 *   - `applyExtensionHostHotloopDiagnosticProfile` activation helper
 *
 * No production state semantics are changed by this ACT. The
 * diagnostic is a passive observer in all paths.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Logger } from "@/shared/services/Logger"
import { applyExtensionHostHotloopDiagnosticProfile } from "../dogfood-diagnostic-profile"
import {
	getExtensionHostHotloopDiagnosticSnapshot,
	isExtensionHostHotloopDiagnosticEnabled,
	isExtensionHostHotloopQueueLogEnabled,
	recordExtensionHostHotloopPendingPrompt,
	recordExtensionHostHotloopSessionEvent,
	resetExtensionHostHotloopDiagnostic,
	setExtensionHostHotloopDiagnosticEnabled,
	setExtensionHostHotloopQueueLogEnabled,
} from "../extension-host-hotloop-diagnostic"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
		trace: vi.fn(),
	},
}))

const mockLogger = Logger as unknown as {
	log: ReturnType<typeof vi.fn>
	error: ReturnType<typeof vi.fn>
	warn: ReturnType<typeof vi.fn>
	debug: ReturnType<typeof vi.fn>
	info: ReturnType<typeof vi.fn>
	trace: ReturnType<typeof vi.fn>
}

type ActiveSession = {
	sessionId: string
	isRunning: boolean
}

function makeCoordinator(opts: {
	activeSession?: ActiveSession
	translation?: {
		messages?: ClineMessage[]
		sessionEnded?: boolean
		turnComplete?: boolean
	}
}) {
	const minter = new MessageIdMinter()
	const messageTranslatorState = new MessageTranslatorState(minter)
	const activeSession = opts.activeSession ?? { sessionId: "session-A", isRunning: true }
	const translation = opts.translation ?? { messages: [], sessionEnded: false, turnComplete: false }
	const turnStateTracker = new TurnStateTracker(minter)

	const options: SdkSessionEventCoordinatorOptions = {
		messageTranslatorState,
		sessions: {
			getActiveSession: () => activeSession,
			setRunning: vi.fn(),
		} as never,
		messages: {
			appendAndEmit: vi.fn(),
		} as never,
		taskHistory: {} as never,
		getTask: () => undefined,
		postStateToWebview: vi.fn(async () => {}),
		setTurnPhase: (phase, anchorTs, writerId) => {
			turnStateTracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		},
		getTurnPhase: () => turnStateTracker.currentPhase,
	}

	const coordinator = new SdkSessionEventCoordinator(options)
	;(coordinator as unknown as { translateSessionEvent: (...args: unknown[]) => unknown }).translateSessionEvent = () => ({
		messages: translation.messages ?? [],
		sessionEnded: translation.sessionEnded ?? false,
		turnComplete: translation.turnComplete ?? false,
		usage: undefined,
	})

	const event = {
		type: "pending_prompts",
		payload: {
			sessionId: activeSession.sessionId,
			prompts: [{ id: "prompt-1", prompt: "run in background", images: [], files: [], createdAt: Date.now() }],
		},
	} as never

	return { coordinator, options, event, turnStateTracker, activeSession }
}

describe("ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01", () => {
	beforeEach(() => {
		mockLogger.log.mockClear()
		mockLogger.warn.mockClear()
		mockLogger.error.mockClear()
		mockLogger.debug.mockClear()
		mockLogger.info.mockClear()
		mockLogger.trace.mockClear()
		resetExtensionHostHotloopDiagnostic()
		setExtensionHostHotloopDiagnosticEnabled(false)
		setExtensionHostHotloopQueueLogEnabled(false)
	})

	afterEach(() => {
		setExtensionHostHotloopDiagnosticEnabled(false)
		setExtensionHostHotloopQueueLogEnabled(false)
		resetExtensionHostHotloopDiagnostic()
	})

	it("EHLOOP-CTL-08: counter module is DEFAULT_OFF and the diagnostic must NOT be enabled without an explicit flip", () => {
		expect(isExtensionHostHotloopDiagnosticEnabled()).toBe(false)
		expect(isExtensionHostHotloopQueueLogEnabled()).toBe(false)
	})

	// -------------------------------------------------------------------
	// PROFILE RESOLUTION GATES (CORRECTION01)
	// -------------------------------------------------------------------

	it("EHLOOP-PROFILE-01: dogfood profile resolution enables diagnostic counters but NOT the synchronous queue-log breadcrumb", () => {
		const result = applyExtensionHostHotloopDiagnosticProfile(true, {})
		expect(result.enabled).toBe(true)
		expect(result.queueLogEnabled).toBe(false)
		expect(isExtensionHostHotloopDiagnosticEnabled()).toBe(true)
		expect(isExtensionHostHotloopQueueLogEnabled()).toBe(false)
	})

	it("EHLOOP-PROFILE-02: dogfood + explicit CLINEMM_DIAG_HOTLOOP_QUEUE_LOG=1 enables the synchronous breadcrumb", () => {
		const result = applyExtensionHostHotloopDiagnosticProfile(true, {
			CLINEMM_DIAG_HOTLOOP_QUEUE_LOG: "1",
		})
		expect(result.enabled).toBe(true)
		expect(result.queueLogEnabled).toBe(true)
		expect(isExtensionHostHotloopQueueLogEnabled()).toBe(true)
	})

	it("EHLOOP-PROFILE-03: public profile + queue-log env override still does NOT enable the synchronous breadcrumb (public never granted)", () => {
		const result = applyExtensionHostHotloopDiagnosticProfile(false, {
			CLINEMM_DIAG_HOTLOOP_QUEUE_LOG: "1",
			CLINEMM_DIAG_HOTLOOP_DIAGNOSTIC: "1",
		})
		expect(result.enabled).toBe(false)
		expect(result.queueLogEnabled).toBe(false)
		expect(isExtensionHostHotloopDiagnosticEnabled()).toBe(false)
		expect(isExtensionHostHotloopQueueLogEnabled()).toBe(false)
	})

	it("EHLOOP-PROFILE-04: dogfood + CLINEMM_DIAG_HOTLOOP_DIAGNOSTIC=0 forces the diagnostic off (matches decideKnob invariant)", () => {
		const result = applyExtensionHostHotloopDiagnosticProfile(true, {
			CLINEMM_DIAG_HOTLOOP_DIAGNOSTIC: "0",
		})
		expect(result.enabled).toBe(false)
		expect(isExtensionHostHotloopDiagnosticEnabled()).toBe(false)
	})

	// -------------------------------------------------------------------
	// RED (the LIVE failure provenance reproduction under real dogfood)
	// -------------------------------------------------------------------

	it("EHLOOP-RED-01: in real dogfood (the LIVE failure environment), the synchronous Logger.log breadcrumb is suppressed", async () => {
		// Resolve under real dogfood profile, no opt-in env knob.
		// This is the exact runtime the LIVE failure was captured in
		// (exthost-66cdb2.cpuprofile,
		// s1onique.clinemm-4.1.16-99006fbcc,
		// CLINEMM_RUNTIME_PROFILE=dogfood).
		applyExtensionHostHotloopDiagnosticProfile(true, {})

		const { coordinator, event } = makeCoordinator({})
		await coordinator.handleSessionEvent(event)
		await coordinator.handleSessionEvent(event)

		const queueLogCallCount = mockLogger.log.mock.calls.filter(
			(args) => typeof args[0] === "string" && args[0].includes("Pending prompts updated"),
		).length
		const submittedLogCallCount = mockLogger.log.mock.calls.filter(
			(args) => typeof args[0] === "string" && args[0].includes("Pending prompt submitted"),
		).length

		expect(queueLogCallCount).toBe(0)
		expect(submittedLogCallCount).toBe(0)

		const snapshot = getExtensionHostHotloopDiagnosticSnapshot()
		expect(snapshot.logQueueEventsCalls).toBeGreaterThanOrEqual(2)
		expect(snapshot.logQueueEventsLogCalls).toBe(0)
		expect(snapshot.logQueueEventsSuppressedByProfile).toBeGreaterThanOrEqual(2)
	})

	it("EHLOOP-RED-02: in public profile, the synchronous Logger.log breadcrumb is also suppressed", async () => {
		applyExtensionHostHotloopDiagnosticProfile(false, {})
		const { coordinator, event } = makeCoordinator({})
		await coordinator.handleSessionEvent(event)

		const queueLogCallCount = mockLogger.log.mock.calls.filter(
			(args) => typeof args[0] === "string" && args[0].includes("Pending prompts updated"),
		).length
		expect(queueLogCallCount).toBe(0)
	})

	it("EHLOOP-COMPOSE-01: production-composition one lifecycle captures bounded counters when the diagnostic is OFF", async () => {
		const { coordinator } = makeCoordinator({})
		const sessionId = "session-A"

		const e1 = {
			type: "pending_prompts",
			payload: { sessionId, prompts: [{ id: "p1", prompt: "run", images: [], files: [], createdAt: 1 }] },
		} as never
		const e2 = {
			type: "pending_prompts",
			payload: { sessionId, prompts: [{ id: "p1", prompt: "run", images: [], files: [], createdAt: 1 }] },
		} as never
		const e3 = {
			type: "pending_prompt_submitted",
			payload: { sessionId, prompt: "run", mode: "act", delivery: "queue" },
		} as never
		const e4 = { type: "pending_prompts", payload: { sessionId, prompts: [] } } as never

		await coordinator.handleSessionEvent(e1)
		await coordinator.handleSessionEvent(e2)
		await coordinator.handleSessionEvent(e3)
		await coordinator.handleSessionEvent(e4)

		const snapshot = getExtensionHostHotloopDiagnosticSnapshot()
		expect(snapshot.sessionEvents).toBe(0)
		expect(snapshot.handleSessionEventCalls).toBe(0)
		expect(snapshot.logQueueEventsCalls).toBe(0)
		expect(snapshot.setWithWriterCalls).toBe(0)

		const queueLogCallCount = mockLogger.log.mock.calls.filter(
			(args) => typeof args[0] === "string" && args[0].includes("Pending prompts"),
		).length
		expect(queueLogCallCount).toBe(0)
	})
	it("EHLOOP-ABLATION-01: same installed dogfood profile; only the explicit queue-log opt-in changes the breadcrumb", async () => {
		// Round A: dogfood default (no opt-in) — counters ON, log suppressed.
		applyExtensionHostHotloopDiagnosticProfile(true, {})
		resetExtensionHostHotloopDiagnostic()
		mockLogger.log.mockClear()
		{
			const { coordinator } = makeCoordinator({})
			const sessionId = "session-A"
			await coordinator.handleSessionEvent({
				type: "pending_prompts",
				payload: { sessionId, prompts: [{ id: "p1", prompt: "run", images: [], files: [], createdAt: 1 }] },
			} as never)
			await coordinator.handleSessionEvent({
				type: "pending_prompt_submitted",
				payload: { sessionId, prompt: "run", mode: "act", delivery: "queue" },
			} as never)
			const snapA = getExtensionHostHotloopDiagnosticSnapshot()
			expect(snapA.logQueueEventsCalls).toBeGreaterThanOrEqual(2)
			expect(snapA.logQueueEventsLogCalls).toBe(0)
			expect(snapA.logQueueEventsSuppressedByProfile).toBeGreaterThanOrEqual(2)
			const logCallsA = mockLogger.log.mock.calls.filter(
				(args) =>
					typeof args[0] === "string" &&
					(args[0].includes("Pending prompts updated") || args[0].includes("Pending prompt submitted")),
			).length
			expect(logCallsA).toBe(0)
		}

		// Round B: dogfood + explicit opt-in — breadcrumb fires.
		applyExtensionHostHotloopDiagnosticProfile(true, {
			CLINEMM_DIAG_HOTLOOP_QUEUE_LOG: "1",
		})
		resetExtensionHostHotloopDiagnostic()
		mockLogger.log.mockClear()
		{
			const { coordinator } = makeCoordinator({})
			const sessionId = "session-A"
			await coordinator.handleSessionEvent({
				type: "pending_prompts",
				payload: { sessionId, prompts: [{ id: "p1", prompt: "run", images: [], files: [], createdAt: 1 }] },
			} as never)
			await coordinator.handleSessionEvent({
				type: "pending_prompt_submitted",
				payload: { sessionId, prompt: "run", mode: "act", delivery: "queue" },
			} as never)
			const snapB = getExtensionHostHotloopDiagnosticSnapshot()
			expect(snapB.logQueueEventsCalls).toBeGreaterThanOrEqual(2)
			expect(snapB.logQueueEventsLogCalls).toBeGreaterThanOrEqual(2)
			expect(snapB.logQueueEventsSuppressedByProfile).toBe(0)
			const logCallsB = mockLogger.log.mock.calls.filter(
				(args) =>
					typeof args[0] === "string" &&
					(args[0].includes("Pending prompts updated") || args[0].includes("Pending prompt submitted")),
			).length
			expect(logCallsB).toBeGreaterThanOrEqual(2)
		}

		// Round C: drop the opt-in — breadcrumb stops firing.
		applyExtensionHostHotloopDiagnosticProfile(true, {})
		resetExtensionHostHotloopDiagnostic()
		mockLogger.log.mockClear()
		{
			const { coordinator } = makeCoordinator({})
			const sessionId = "session-A"
			await coordinator.handleSessionEvent({
				type: "pending_prompts",
				payload: { sessionId, prompts: [{ id: "p1", prompt: "run", images: [], files: [], createdAt: 1 }] },
			} as never)
			await coordinator.handleSessionEvent({
				type: "pending_prompt_submitted",
				payload: { sessionId, prompt: "run", mode: "act", delivery: "queue" },
			} as never)
			const logCallsC = mockLogger.log.mock.calls.filter(
				(args) =>
					typeof args[0] === "string" &&
					(args[0].includes("Pending prompts updated") || args[0].includes("Pending prompt submitted")),
			).length
			expect(logCallsC).toBe(0)
		}
	})

	it("EHLOOP-CTL-09: with counters enabled (dogfood), counter snapshot captures the full call sequence WITHOUT firing the synchronous log breadcrumb", async () => {
		// CORRECTION01: the diagnostic enablement no longer controls the
		// breadcrumb. Counters are cheap and on in dogfood; the
		// breadcrumb is independent.
		setExtensionHostHotloopDiagnosticEnabled(true)
		setExtensionHostHotloopQueueLogEnabled(false)
		resetExtensionHostHotloopDiagnostic()
		mockLogger.log.mockClear()

		const { coordinator } = makeCoordinator({})
		const sessionId = "session-A"
		await coordinator.handleSessionEvent({
			type: "pending_prompts",
			payload: { sessionId, prompts: [{ id: "p1", prompt: "run", images: [], files: [], createdAt: 1 }] },
		} as never)
		await coordinator.handleSessionEvent({
			type: "pending_prompt_submitted",
			payload: { sessionId, prompt: "run", mode: "act", delivery: "queue" },
		} as never)

		const snapshot = getExtensionHostHotloopDiagnosticSnapshot()
		expect(snapshot.sessionEvents).toBeGreaterThanOrEqual(2)
		expect(snapshot.handleSessionEventCalls).toBeGreaterThanOrEqual(2)
		expect(snapshot.logQueueEventsCalls).toBeGreaterThanOrEqual(2)
		expect(snapshot.logQueueEventsLogCalls).toBe(0)
		expect(snapshot.logQueueEventsSuppressedByProfile).toBeGreaterThanOrEqual(2)
		expect(snapshot.maxNestedHandleDepth).toBe(1)
		expect(snapshot.byEventType.pending_prompts).toBeGreaterThanOrEqual(1)
		expect(snapshot.byEventType.pending_prompt_submitted).toBeGreaterThanOrEqual(1)
		expect(Object.keys(snapshot.byWriter).length).toBeGreaterThanOrEqual(1)

		const logCalls = mockLogger.log.mock.calls.filter(
			(args) =>
				typeof args[0] === "string" &&
				(args[0].includes("Pending prompts updated") || args[0].includes("Pending prompt submitted")),
		).length
		expect(logCalls).toBe(0)
	})

	it("EHLOOP-CTL-04 / EHLOOP-CTL-05: pending-prompt drain counter hooks are exposed and bounded", () => {
		setExtensionHostHotloopDiagnosticEnabled(true)
		resetExtensionHostHotloopDiagnostic()

		recordExtensionHostHotloopPendingPrompt({ kind: "drain" })
		recordExtensionHostHotloopPendingPrompt({ kind: "drain" })
		recordExtensionHostHotloopPendingPrompt({ kind: "dispatch" })

		const snapshot = getExtensionHostHotloopDiagnosticSnapshot()
		expect(snapshot.pendingPromptDrainCalls).toBe(2)
		expect(snapshot.pendingPromptDispatchCalls).toBe(1)

		for (let i = 0; i < 40; i++) {
			recordExtensionHostHotloopSessionEvent(`unique-${i}`)
		}
		const overflowed = getExtensionHostHotloopDiagnosticSnapshot()
		expect(overflowed.overflowed).toBeGreaterThan(0)
	})

	it("EHLOOP-CTL-10: explicit user turn still flows through handleSessionEvent without state-semantic delta", async () => {
		const { coordinator, turnStateTracker } = makeCoordinator({})
		setExtensionHostHotloopDiagnosticEnabled(true)
		resetExtensionHostHotloopDiagnostic()

		const event = {
			type: "pending_prompt_submitted",
			payload: { sessionId: "session-A", prompt: "user message", mode: "act", delivery: "queue" },
		} as never

		const phaseBefore = turnStateTracker.currentPhase
		await coordinator.handleSessionEvent(event)
		const phaseAfter = turnStateTracker.currentPhase

		expect(phaseBefore).toBe("idle")
		expect(phaseAfter).toBe("streaming")
	})

	it("EHLOOP-CTL-01 / EHLOOP-CTL-02: ordinary session event handling still works with the diagnostic OFF", async () => {
		const { coordinator, options, event } = makeCoordinator({
			translation: { messages: [{ ts: 1, type: "say", say: "text", text: "hello" }] },
		})
		expect(isExtensionHostHotloopDiagnosticEnabled()).toBe(false)

		await coordinator.handleSessionEvent(event)
		await Promise.resolve()

		expect(options.messages.appendAndEmit).toHaveBeenCalled()
		expect(options.postStateToWebview).toHaveBeenCalled()
	})
})
