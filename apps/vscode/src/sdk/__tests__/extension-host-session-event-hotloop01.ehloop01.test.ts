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
 * Production seams under test:
 *   - `SdkSessionEventCoordinator.handleSessionEvent`
 *   - `SdkSessionEventCoordinator.logQueueEvents`
 *   - `TurnStateTracker.setWithWriter` (real production class)
 *   - `extension-host-hotloop-diagnostic` counter module
 *
 * No production state semantics are changed by this ACT. The
 * diagnostic is a passive observer in all paths. The
 * `logQueueEvents` `Logger.log` calls are gated behind the
 * diagnostic profile (preserved for dogfood, suppressed for public)
 * so the production CPU monopoly is bounded.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Logger } from "@/shared/services/Logger"
import {
	getExtensionHostHotloopDiagnosticSnapshot,
	isExtensionHostHotloopDiagnosticEnabled,
	recordExtensionHostHotloopPendingPrompt,
	recordExtensionHostHotloopSessionEvent,
	resetExtensionHostHotloopDiagnostic,
	setExtensionHostHotloopDiagnosticEnabled,
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
	})

	afterEach(() => {
		setExtensionHostHotloopDiagnosticEnabled(false)
		resetExtensionHostHotloopDiagnostic()
	})

	it("EHLOOP-CTL-08: counter module is DEFAULT_OFF and the diagnostic must NOT be enabled without an explicit flip", () => {
		expect(isExtensionHostHotloopDiagnosticEnabled()).toBe(false)
	})
	it("EHLOOP-RED-01: logQueueEvents production Logger.log call is suppressed when the diagnostic profile is OFF (public default)", async () => {
		const { coordinator, event } = makeCoordinator({})
		expect(isExtensionHostHotloopDiagnosticEnabled()).toBe(false)

		await coordinator.handleSessionEvent(event)

		const queueLogCallCount = mockLogger.log.mock.calls.filter(
			(args) => typeof args[0] === "string" && args[0].includes("Pending prompts updated"),
		).length
		expect(queueLogCallCount).toBe(0)

		setExtensionHostHotloopDiagnosticEnabled(true)
		resetExtensionHostHotloopDiagnostic()
		await coordinator.handleSessionEvent(event)

		const armedSnapshot = getExtensionHostHotloopDiagnosticSnapshot()
		expect(armedSnapshot.logQueueEventsCalls).toBeGreaterThanOrEqual(1)
		expect(armedSnapshot.logQueueEventsLogCalls).toBeGreaterThanOrEqual(1)
		expect(armedSnapshot.logQueueEventsSuppressedByProfile).toBe(0)

		const queueLogCallCountArmed = mockLogger.log.mock.calls.filter(
			(args) => typeof args[0] === "string" && args[0].includes("Pending prompts updated"),
		).length
		expect(queueLogCallCountArmed).toBeGreaterThanOrEqual(1)
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
	it("EHLOOP-ABLATION-01: with diagnostic ENABLED (dogfood), counters capture the full call sequence and the breadcrumb Logger.log fires", async () => {
		setExtensionHostHotloopDiagnosticEnabled(true)
		resetExtensionHostHotloopDiagnostic()

		const { coordinator } = makeCoordinator({})
		const sessionId = "session-A"

		const e1 = {
			type: "pending_prompts",
			payload: { sessionId, prompts: [{ id: "p1", prompt: "run", images: [], files: [], createdAt: 1 }] },
		} as never
		const e2 = {
			type: "pending_prompt_submitted",
			payload: { sessionId, prompt: "run", mode: "act", delivery: "queue" },
		} as never
		const e3 = { type: "pending_prompts", payload: { sessionId, prompts: [] } } as never

		await coordinator.handleSessionEvent(e1)
		await coordinator.handleSessionEvent(e2)
		await coordinator.handleSessionEvent(e3)

		const snapshot = getExtensionHostHotloopDiagnosticSnapshot()
		expect(snapshot.sessionEvents).toBe(3)
		expect(snapshot.handleSessionEventCalls).toBe(3)
		expect(snapshot.logQueueEventsCalls).toBe(3)
		expect(snapshot.logQueueEventsLogCalls).toBe(3)
		expect(snapshot.logQueueEventsSuppressedByProfile).toBe(0)
		expect(snapshot.setWithWriterCalls).toBeGreaterThanOrEqual(1)
		expect(snapshot.actualPhaseChanges).toBeGreaterThanOrEqual(1)
		expect(snapshot.maxNestedHandleDepth).toBe(1)
		expect(snapshot.byEventType.pending_prompts).toBe(2)
		expect(snapshot.byEventType.pending_prompt_submitted).toBe(1)
		expect(Object.keys(snapshot.byWriter).length).toBeGreaterThanOrEqual(1)
	})

	it("EHLOOP-CTL-09: enabling then disabling the diagnostic returns the hot loop to the OFF behavior", async () => {
		const { coordinator, event } = makeCoordinator({})

		setExtensionHostHotloopDiagnosticEnabled(true)
		await coordinator.handleSessionEvent(event)
		const onCalls = mockLogger.log.mock.calls.length

		resetExtensionHostHotloopDiagnostic()
		mockLogger.log.mockClear()

		setExtensionHostHotloopDiagnosticEnabled(false)
		await coordinator.handleSessionEvent(event)
		const offCalls = mockLogger.log.mock.calls.length

		expect(offCalls).toBe(0)
		expect(onCalls).toBeGreaterThanOrEqual(1)
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
