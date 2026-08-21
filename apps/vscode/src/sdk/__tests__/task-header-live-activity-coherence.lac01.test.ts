/**
 * ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01 / LAC01
 *
 * STRUCTURAL RED at the production seam for the LIVE contradiction
 * where TaskHeader simultaneously shows `Idle · 00:00` while the agent
 * is actively executing for the same visible task.
 *
 * Primary invariant (the one being asserted as RED → GREEN):
 *
 *   When the visible task has an ACTIVE runtime session that has
 *   emitted its canonical `run-started` event (i.e. the agent is
 *   genuinely executing for THIS task identity), the publication
 *   surface the webview consumes MUST publish:
 *
 *     1. taskHeaderPresentation.phase ≠ "idle"
 *        (canonical shadow says running; selector overrides legacy
 *         absence fallback; the webview's stateLabel() must yield a
 *         non-idle label)
 *
 *     2. taskTelemetry.startedAt defined AND belonging to the
 *        CURRENT task identity (so the elapsed display is truthful,
 *        not stale or absent).
 */
import type { AgentRuntimeEvent, AgentRuntimeRecoverySnapshot, AgentRunStatus, LiveAgentRuntimeEvent } from "@cline/shared"
import type { TurnPhase } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { subscribeCanonicalRuntimeEventsToShadow } from "../canonical-event-subscription"
import type { SdkSessionHost } from "../session-host"
import { emitTaskReset, emitTaskRequested, sinkFromWiring } from "../task-state-shadow-host-msgs"
import {
	createTaskShadowHostWiring,
	emptyArbiterSnapshot,
	type TaskShadowHostWiringWithSink,
} from "../task-state-shadow-host-wiring"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"
import { selectTaskHeaderPresentation } from "../task-state-shadow-arbiter-mapper"
import {
	formatElapsed,
	resolveElapsedDisplayMs,
	taskHeaderPresentationStateLabel,
} from "./task-header-live-activity-coherence.lac01.helpers"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

// ----------------------------------------------------------------------------
// Long-form test description (continued from header).
// ----------------------------------------------------------------------------
//
// Both failures happening simultaneously is the LIVE symptom. The
// prior canonical projection ACT (`THCP-MIGRATION01`) settled the
// selector architecture (host-compacting > shadow > legacy); the prior
// timing ACT (`OAT01`) settled the timer semantic domain (wall-clock
// age). This ACT targets the *boundary* between them — the publication
// moment when both dimensions are co-pinned to the same logical task.
//
// WHAT THE TEST DOES
// ------------------
// Wires REAL production owners end-to-end:
//   - REAL `TaskTelemetryTracker`
//   - REAL `createTaskShadowHostWiring` with controllable `getActiveSession`
//   - REAL `selectTaskHeaderPresentation` selector (frozen three-source)
//   - REAL `emitTaskRequested` host-only emitter
//   - REAL canonical-event subscription seam (`observeCanonicalRuntimeEvent`)
//   - REAL `formatElapsed` + `resolveElapsedDisplayMs` webview helpers
//
// Then it drives the EXACT production chronology of `SdkController.initTask`:
//
//   1. prior task A is running (legacy=streaming, shadow=streaming,
//      telemetry currentTaskId=A, startedAt=earlierTimestamp)
//   2. user clicks "New Task" → controller `clearTask()` runs:
//      - turnStateTracker.set("idle")
//      - shadow observes `task_reset` (HOST_TASK origin) → shadow idle
//      - taskTelemetry.currentTaskId remains A (only cancelTask calls endTask)
//   3. user submits prompt → controller `initTask(B)` runs:
//      - internal `clearTaskForOperation` (idempotent on already-idle)
//      - `startNewSession(B)` resolves, session becomes active
//      - inside the coordinator: `setTurnPhase("streaming")` — legacy=streaming
//      - back in SdkController.initTask (line 1657+):
//          * taskTelemetry.startTask(B, persistedTs) — persistedTs may be undefined
//          * attachRecoveryTelemetrySubscription(B)
//          * attachCanonicalRuntimeEventSubscription(B)
//          * taskStateShadowWiring.resetForNewTask()
//          * emitTaskRequested({...}, B)
//   4. the runtime emits `run-started` for B via the canonical seam
//   5. AT PUBLICATION: snapshot mirrors getStateToPostToWebview()
//
// FAILURE MODES THIS TEST CATCHES
// --------------------------------
//   F-A (timer identity): telemetry.startTask(B) is called with stale
//     currentTaskId=A because clearTask doesn't clear telemetry; OR
//     persistedTs undefined + fallback Date.now() wrong.
//   F-B (state): canonical `run-started` silently dropped because
//     wiring's `getActiveSession()` guard returned undefined.
//   F-C (publication boundary): telemetry and projection on different
//     fence tokens; one was superseded.

interface CanonicalHost {
	// Production-side subscribeRuntimeEvents listener signature:
	//   (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => () => void
	subscribeRuntimeEvents?: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => () => void
}

interface SessionInfo {
	sessionId: string
	isRunning: boolean
	// The shape the wiring's lifecycle.getActiveSession() expects is the
	// production `ActiveSession`. We only need `sessionId` + `isRunning`
	// for the wiring's guards; cast at the boundary.
	sdkHost: { subscribeRuntimeEvents?: unknown }
	unsubscribe: () => void
}

interface LiveSnapshot {
	turnPhase: TurnPhase
	taskHeaderPhase: TurnPhase
	taskHeaderSource: "host" | "shadow" | "legacy"
	taskTelemetryStartedAt: number | undefined
	taskTelemetryTaskId: string | undefined
	stateLabel: string
	elapsedText: string
	now: number
}

interface Harness {
	wiring: TaskShadowHostWiringWithSink
	telemetry: TaskTelemetryTracker
	legacyPhase: TurnPhase
	activeSession: SessionInfo | undefined
	runtimeStatus: AgentRunStatus
	publications: LiveSnapshot[]
	now: { value: number }
	sessionHost: CanonicalHost & SdkSessionHost
	attachCanonicalSubscription(): () => void
	emitRuntimeEvent(event: AgentRuntimeEvent): void
}

/**
 * A controllable mock `LocalRuntimeHost` shape — exposes ONLY the
 * `subscribeRuntimeEvents` method production reads. Listeners are
 * invoked synchronously when `emitRuntimeEvent` is called.
 */
function makeControllableHost(): CanonicalHost & SdkSessionHost {
	const listeners = new Set<(sessionId: string, event: AgentRuntimeEvent) => void>()
	const counter = { value: 0 }
	const host = {
		subscribeRuntimeEvents: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		emit(event: AgentRuntimeEvent): void {
			counter.value += 1
			const sid = (host as unknown as { __sessionId: string }).__sessionId ?? "session-B"
			for (const l of listeners) {
				l(sid, event)
			}
		},
		__counter: counter,
		__listenerCount: () => listeners.size,
	} as unknown as CanonicalHost & SdkSessionHost
	return host
}

function emptyRecovery(): AgentRuntimeRecoverySnapshot {
	return {
		state: "idle",
		tracker: {
			state: "idle",
			currentRepairAttempts: 0,
			equivalentRepeatCount: 0,
			blockedExactKeys: [],
			blockedFamilies: [],
		},
		secondStage: "idle",
		episodeFailures: 0,
		maxEpisodeFailures: 100,
		circuitNoticeCount: 0,
	}
}

function makeHarness(): Harness {
	const now = { value: 1_700_000_000_000 }
	// Mutable state held in refs so the wiring's closures read the
	// CURRENT value at call time (plain `let` / object-property
	// reassignment does not propagate through the wiring closure).
	const legacyPhaseRef: { current: TurnPhase } = { current: "idle" }
	const activeSessionRef: { current: SessionInfo | undefined } = { current: undefined }
	const runtimeStatusRef: { current: AgentRunStatus } = { current: "idle" }

	const sessionHost = makeControllableHost()
	;(sessionHost as unknown as { __sessionId: string }).__sessionId = "session-B"

	const wiring = createTaskShadowHostWiring({
		lifecycle: {
			getActiveSession: () =>
				activeSessionRef.current as unknown as import("../cline-session-factory").ActiveSession | undefined,
			setRunning: (flag: boolean) => {
				if (activeSessionRef.current) {
					activeSessionRef.current.isRunning = flag
				}
			},
		},
		sessionOptions: {
			mcpHub: undefined as never,
			requestToolApproval: () => undefined as never,
			askQuestion: () => undefined as never,
			onSessionEvent: () => undefined,
			onSendComplete: () => undefined,
			onSendError: () => undefined,
		},
		getLegacyPhase: () => legacyPhaseRef.current,
		getArbiterSnapshot: () => {
			if (!activeSessionRef.current || runtimeStatusRef.current === "idle") {
				return emptyArbiterSnapshot()
			}
			return {
				...emptyArbiterSnapshot(),
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
				status: runtimeStatusRef.current,
			}
		},
		getRuntimeStatus: () => runtimeStatusRef.current,
		now: () => now.value,
	})

	const telemetry = new TaskTelemetryTracker()
	const publications: LiveSnapshot[] = []

	let unsubscribeCanonical: (() => void) | undefined
	const attachCanonicalSubscription = () => {
		unsubscribeCanonical?.()
		unsubscribeCanonical = undefined
		if (!sessionHost.subscribeRuntimeEvents) {
			return () => {}
		}
		unsubscribeCanonical = subscribeCanonicalRuntimeEventsToShadow(
			{
				subscribeRuntimeEvents: (listener) => {
					return sessionHost.subscribeRuntimeEvents!(listener)
				},
			},
			wiring,
			"session-B",
		)
		return () => {
			unsubscribeCanonical?.()
			unsubscribeCanonical = undefined
		}
	}

	const emitRuntimeEvent = (event: AgentRuntimeEvent) => {
		;(sessionHost as unknown as { emit: (e: AgentRuntimeEvent) => void }).emit(event)
	}

	// Mutable getters that always read the LATEST ref value.
	const activeSessionGetter = () => activeSessionRef.current
	const runtimeStatusGetter = () => runtimeStatusRef.current
	const activeSessionSetter = (v: SessionInfo | undefined) => {
		activeSessionRef.current = v
	}
	const runtimeStatusSetter = (v: AgentRunStatus) => {
		runtimeStatusRef.current = v
	}

	// The harness exposes the refs via plain properties (no setter
	// functions in the interface — the test mutates these directly).
	// To make that work we wrap the ref getters behind properties that
	// delegate to the current ref value at access time.
	const h: Harness = {
		wiring,
		telemetry,
		get legacyPhase() {
			return legacyPhaseRef.current
		},
		set legacyPhase(v: TurnPhase) {
			legacyPhaseRef.current = v
		},
		get activeSession() {
			return activeSessionGetter()
		},
		set activeSession(v: SessionInfo | undefined) {
			activeSessionSetter(v)
		},
		get runtimeStatus() {
			return runtimeStatusGetter()
		},
		set runtimeStatus(v: AgentRunStatus) {
			runtimeStatusSetter(v)
		},
		publications,
		now,
		sessionHost,
		attachCanonicalSubscription,
		emitRuntimeEvent,
	}
	return h
}

function publish(h: Harness): void {
	const turnPhase = h.legacyPhase
	const shadowPhase = h.wiring.getLastObservedShadowPhase()
	const projection = selectTaskHeaderPresentation({
		canonicalShadowPhase: shadowPhase,
		currentLegacyPhase: turnPhase,
		seq: 1,
	})
	const telemetrySnap = h.telemetry.get()
	const stateLabel = taskHeaderPresentationStateLabel(projection, {
		phase: turnPhase,
		seq: 1,
		anchorTs: h.now.value,
	})
	const elapsedMs = resolveElapsedDisplayMs(telemetrySnap?.startedAt ?? 0, telemetrySnap?.endedAt, h.now.value)
	h.publications.push({
		turnPhase,
		taskHeaderPhase: projection.phase,
		taskHeaderSource: projection.source,
		taskTelemetryStartedAt: telemetrySnap?.startedAt,
		taskTelemetryTaskId: h.telemetry.currentTask,
		stateLabel: stateLabel.label,
		elapsedText: formatElapsed(elapsedMs),
		now: h.now.value,
	})
}

describe("ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01 / LAC01 — taskHeaderPresentation + taskTelemetry co-pinned to the same active task", () => {
	beforeEach(() => {
		process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = "1"
	})

	it("LAC01: when the active task is genuinely running, the publication snapshot is non-idle AND telemetry.startedAt belongs to the current task", () => {
		const h = makeHarness()

		// Phase 1 — prior task A is running.
		h.legacyPhase = "streaming"
		h.activeSession = {
			sessionId: "session-A",
			isRunning: true,
			sdkHost: h.sessionHost as unknown as { subscribeRuntimeEvents?: unknown },
			unsubscribe: () => {},
		}
		h.runtimeStatus = "running"
		const aStartedAt = 1_699_999_990_000
		h.telemetry.startTask("session-A", aStartedAt)
		h.attachCanonicalSubscription()
		const aRunStarted: LiveAgentRuntimeEvent = {
			type: "run-started",
			snapshot: {
				agentId: "a",
				runId: "run-A",
				status: "running",
				iteration: 0,
				messages: [],
				pendingToolCalls: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
				recovery: emptyRecovery(),
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
			},
		}
		h.emitRuntimeEvent(aRunStarted)
		h.now.value = 1_700_000_000_000

		// Phase 2 — user clicks "New Task" → controller.clearTask()
		h.legacyPhase = "idle"
		h.activeSession = undefined
		h.runtimeStatus = "idle"
		emitTaskReset(sinkFromWiring(h.wiring), h.legacyPhase)
		h.now.value = 1_700_000_010_000

		// Phase 3 — user submits prompt → controller.initTask(B)
		h.activeSession = {
			sessionId: "session-B",
			isRunning: true,
			sdkHost: h.sessionHost as unknown as { subscribeRuntimeEvents?: unknown },
			unsubscribe: () => {},
		}
		h.legacyPhase = "streaming"
		const bStartedAt = h.now.value
		h.telemetry.startTask("session-B", bStartedAt)
		h.attachCanonicalSubscription()
		h.wiring.resetForNewTask()
		emitTaskRequested({ coordinator: h.wiring.coordinator, now: () => h.now.value }, "session-B")

		// Phase 4 — runtime emits canonical `run-started` for B.
		// In production the runtime emits `run-started` AFTER
		// `startNewSession` resolves. If the controller attaches the
		// canonical subscription AFTER the run starts, `run-started` is
		// dropped — leaving the shadow at the post-reset idle state.
		// The runtime then emits `execution-state-changed` with
		// `modelStreaming: false→true`, which translates to a
		// `model_stream_started` TaskMsg that promotes the shadow's
		// lifecycle and sets `activity.modelStreaming = true`. After
		// that the comparator's `projectTurnState` returns "streaming".
		// If `getLastObservedShadowPhase` reads from the comparator
		// correctly, the selector picks the canonical shadow and the
		// webview shows "Working".
		h.runtimeStatus = "running"
		const bRunStarted: LiveAgentRuntimeEvent = {
			type: "run-started",
			snapshot: {
				agentId: "b",
				runId: "run-B",
				status: "running",
				iteration: 0,
				messages: [],
				pendingToolCalls: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
				recovery: emptyRecovery(),
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
			},
		}
		h.emitRuntimeEvent(bRunStarted)
		// The canonical post-run-started execution state change.
		const bExecStateChange: AgentRuntimeEvent = {
			type: "execution-state-changed",
			snapshot: {
				agentId: "b",
				runId: "run-B",
				status: "running",
				iteration: 0,
				messages: [],
				pendingToolCalls: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
				recovery: emptyRecovery(),
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
			},
			previousExecution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		}
		h.emitRuntimeEvent(bExecStateChange)

		// Phase 5 — publication after canonical events. Advance ≥1s for the timer.
		h.now.value = bStartedAt + 5_000
		publish(h)

		const live = h.publications[h.publications.length - 1]

		// LIVE invariant A — taskHeaderPresentation must NOT be idle.
		expect
			.soft(
				live.taskHeaderPhase,
				"taskHeaderPresentation.phase must NOT be 'idle' while runtime is running for the visible task",
			)
			.not.toBe("idle")
		expect
			.soft(live.stateLabel, "webview state label must NOT be 'Idle' while runtime is running for the visible task")
			.not.toBe("Idle")
		// The canonical source must be `shadow` — the legacy mirror is
		// observation-only for the Local runtime path; if the source
		// collapses to `legacy`, the canonical event did not reach the
		// wiring (F-B / publication identity failure).
		expect
			.soft(
				live.taskHeaderSource,
				"taskHeaderPresentation.source must be 'shadow' on Local — legacy collapse means run-started never reached the wiring",
			)
			.toBe("shadow")

		// LIVE invariant B — taskTelemetry must reflect the current task.
		expect.soft(live.taskTelemetryTaskId, "telemetry.currentTaskId must equal the active task id").toBe("session-B")
		expect
			.soft(typeof live.taskTelemetryStartedAt === "number", "taskTelemetry.startedAt must be defined for the active task")
			.toBe(true)
		expect.soft(live.elapsedText, "elapsed display must be > 00:00 for a task running >=1s").not.toBe("00:00")

		// Print the final snapshot for forensic readability on RED.
		// (commented out by default; uncomment locally if RED fires and
		// the assertion message alone is insufficient to diagnose)
		// console.log("[LAC01 LIVE snapshot]", JSON.stringify(live, null, 2))

		h.wiring.dispose()
	})
})
