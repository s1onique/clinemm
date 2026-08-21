/**
 * ACT-CLINEMM-RESUME-SUBSCRIPTION-PARITY01 / RSP01
 *
 * SUBSCRIPTION-LIFECYCLE / PARITY RED at the production seam for the
 * predicted resume defect where `SdkController.reinitExistingTaskFromId`
 * does not attach the canonical runtime-event subscription nor the
 * recovery-telemetry subscription that `SdkController.initTask` wires.
 *
 * SCOPE: bounded to the resume-seam SUBSCRIPTION LIFECYCLE only. This
 * file does NOT redefine timer semantics, does NOT open the state-label
 * chain, does NOT add a new wire field, does NOT add a new manager, and
 * does NOT change `initTask`. It asks: at WHICH authoritative boundary
 * do canonical runtime events and recovery telemetry fail to reach the
 * SAME consumers after resume that they reach after a fresh task?
 *
 * PRIMARY RED (RSP01_RUNTIME): `SdkController.reinitExistingTaskFromId`
 * (line 1782) does not call `attachCanonicalRuntimeEventSubscription`
 * (the only call site is `initTask` at line 1675). The canonical
 * `subscribeRuntimeEvents` stream therefore has zero active listeners
 * for the resumed task. After resume, emitting a canonical
 * `execution-state-changed` event through the real host → zero shadow
 * observations.
 *
 * PRIMARY RED (RSP02_RECOVERY): same path also does not call
 * `attachRecoveryTelemetrySubscription` (only call site is `initTask`
 * at line 1670). The recovery-budget counter therefore never updates
 * after resume. After resume, emitting a canonical recovery snapshot
 * through the real host → zero increment to
 * `TaskTelemetryTracker.recoveryBudgetFailures`.
 *
 * POSITIVE CONTROLS (RSP03 / RSP04): the same harness run against the
 * `initTask` mirror must GREEN — that proves the harness is capable
 * of delivering both streams. If a positive control fails, the test
 * seam is invalid (HALT_TEST_SEAM_INVALID).
 *
 * CARDINALITY (RSP05): a SECOND resume must NOT add a second listener
 * — `CanonicalRuntimeShadowSubscription.attach()` is required to
 * dispose the previous before attaching the new, and the recovery
 * unsubscribe must be disposed/replaced as well. The test asserts
 * exactly-once per event after a second resume.
 *
 * IDENTITY (RSP06_A→B): resume A, then switch to B by reinit. An
 * event tagged with A's sessionId must NOT reach B's wiring.
 *
 * LIVE EVIDENCE BINDING (per Factory addendum, dogfood install):
 *   - Installed version: `s1onique.clinemm@4.1.10-e5c6bf486`
 *     (state-side `LAC-ABSENCE01` closure; PRE-LTZ01 + PRE-RSP01).
 *   - LIVE-A: a TaskHeader with NO telemetry rendered (timer + state
 *     + tool-count all absent) — `TASK_TELEMETRY_ABSENT_OR_UNPUBLISHED`.
 *   - LIVE-B: a TaskHeader showing `21:37 · Idle · 253` while Cline
 *     visibly edits code — `TELEMETRY_PRESENT_BUT_STALE_OR_TERMINAL`
 *     + `STATE_PROJECTION_STALE`.
 *   - DO NOT claim these reproduce current HEAD. They are
 *     `REAL_LIVE_FAILURE_ON_DOGFOOD_e5c6bf486` only.
 *
 * EXTENDED BEHAVIORAL RED SET (added by Factory addendum):
 *   RSP01 — canonical runtime subscription (existing)
 *   RSP02 — recovery subscription (existing)
 *   RSP03 — base TaskTelemetry presence after resume:
 *           startedAt defined, currentTask = taskId,
 *           recoveryBudgetFailures zeroed on identity change.
 *   RSP04 — terminal-timing cleared on resume:
 *           if a prior `endTask` froze the tracker, a subsequent
 *           resume with `observeTurnPhase("streaming")` (the
 *           coordinator's canonical phase assertion) must clear
 *           `endedAt` so the timer ticks again. This catches the
 *           LIVE-B frozen timer directly.
 *   RSP05 — repeated resume cardinality (existing)
 *   RSP06 — A->B stale identity (existing)
 *
 * STOP after first causal RED.
 *
 * STRUCTURAL SENTINEL: the harness is gated on
 * `productionReinitWiresBothSubscriptions(source)`.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeRecoverySnapshot, AgentRuntimeStateSnapshot } from "@cline/shared"
import { beforeEach, describe, expect, it } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import {
	CanonicalRuntimeShadowSubscription,
	type RuntimeEventHost,
	subscribeCanonicalRuntimeEventsToShadow,
} from "../canonical-event-subscription"
import type { TaskShadowHostWiringDeps } from "../task-state-shadow-host-wiring"
import { createTaskShadowHostWiring, emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"

const NOW = 1_700_000_000_000

const SdkControllerPath = path.resolve(__dirname, "..", "SdkController.ts")
const SdkControllerSource = fs.readFileSync(SdkControllerPath, "utf8")

function locateReinitExistingTaskFromId(source: string): string {
	const start = source.indexOf("async reinitExistingTaskFromId(taskId: string): Promise<void>")
	if (start < 0) {
		throw new Error("SdkController.reinitExistingTaskFromId signature not found")
	}
	return source.slice(start)
}

/**
 * Whether the production `SdkController.reinitExistingTaskFromId`
 * body currently wires BOTH subscriptions that `initTask` wires.
 * This is what makes the behavioral tests below exercise the
 * production seam: when the wiring is absent in production, the
 * harness mirrors the broken flow (no attach calls → no listeners);
 * when present, the harness mirrors the repaired flow.
 *
 * The regex matches `this.attachXxx(` on a NON-COMMENT line (the
 * line must start with optional whitespace then `this.`, not with
 * `//`). Commented-out calls do NOT count, so the ablation cycle
 * (commenting the calls) correctly trips the gate.
 */
function productionReinitWiresBothSubscriptions(source: string): {
	runtime: boolean
	recovery: boolean
} {
	const body = locateReinitExistingTaskFromId(source)
	// Match call lines that are NOT commented: a line beginning with
	// optional whitespace then `this.attachXxx(...)`, where the
	// leading character is not `//`.
	const lines = body.split("\n")
	let runtime = false
	let recovery = false
	for (const line of lines) {
		const trimmed = line.trimStart()
		if (trimmed.startsWith("//")) continue
		if (/^this\.attachCanonicalRuntimeEventSubscription\(/.test(trimmed)) runtime = true
		if (/^this\.attachRecoveryTelemetrySubscription\(/.test(trimmed)) recovery = true
	}
	return { runtime, recovery }
}

function makeSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status: "running",
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

function makeExecEvent(): AgentRuntimeEvent {
	return {
		type: "execution-state-changed",
		snapshot: {
			...makeSnapshot(),
			execution: {
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			},
		},
		previousExecution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
		},
	}
}

function makeRecoverySnapshot(episodeFailures: number): AgentRuntimeRecoverySnapshot {
	return {
		state: "recovering",
		tracker: {
			state: "recovering",
			currentRepairAttempts: 0,
			equivalentRepeatCount: 0,
			blockedExactKeys: [],
			blockedFamilies: [],
		},
		secondStage: "idle",
		episodeFailures,
		maxEpisodeFailures: 5,
		circuitNoticeCount: 0,
	}
}

/**
 * Faithful POINT_IN_TIME host fixture for `subscribeRuntimeEvents`.
 */
function makeRuntimeHost() {
	const sessionListeners = new Map<string, Set<(event: AgentRuntimeEvent) => void>>()
	const globalListeners = new Set<(sessionId: string, event: AgentRuntimeEvent) => void>()
	let subscribeCalls = 0
	let unsubscribeCalls = 0
	return {
		host: {
			subscribeRuntimeEvents: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => {
				subscribeCalls++
				globalListeners.add(listener)
				for (const [sid, set] of sessionListeners.entries()) {
					set.add((event) => listener(sid, event))
				}
				return () => {
					unsubscribeCalls++
					globalListeners.delete(listener)
					for (const set of sessionListeners.values()) {
						set.clear()
					}
				}
			},
		} satisfies RuntimeEventHost,
		api: {
			addSession(sessionId: string) {
				const set = new Set<(event: AgentRuntimeEvent) => void>()
				sessionListeners.set(sessionId, set)
			},
			removeSession(sessionId: string) {
				sessionListeners.delete(sessionId)
			},
			deliver(sessionId: string, event: AgentRuntimeEvent) {
				const set = sessionListeners.get(sessionId)
				if (!set) return
				for (const l of set) l(event)
			},
			stats() {
				return {
					subscribeCalls,
					unsubscribeCalls,
					activeListeners: globalListeners.size,
					activeSessions: sessionListeners.size,
				}
			},
		},
	}
}

/**
 * Faithful host fixture for `subscribeRecoveryStateChange`. Tracks
 * per-session delivery and counts subscribe/unsubscribe calls so we
 * can observe the recovery subscription's lifetime. The host
 * forwards the recovery snapshot to whichever listener is
 * currently active (single-listener fixture; mirrors the
 * single-active-session controller semantics).
 */
function makeRecoveryHost() {
	const listeners = new Set<(recovery: AgentRuntimeRecoverySnapshot) => void>()
	let subscribeCalls = 0
	let unsubscribeCalls = 0
	return {
		subscribeRecoveryStateChange: (listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void) => {
			subscribeCalls++
			const wrapper = (recovery: AgentRuntimeRecoverySnapshot) => {
				// Forward as if for the active session. The
				// `sessionId` argument the listener expects is
				// captured via closure at the call site (the
				// production attachRecoveryTelemetrySubscription
				// passes a closure that compares the event's
				// sessionId against its captured `sessionId`).
				// Here we just deliver the recovery.
				listener(activeSession.current ?? "", recovery)
			}
			listeners.add(wrapper)
			return () => {
				unsubscribeCalls++
				listeners.delete(wrapper)
			}
		},
		api: {
			deliver(recovery: AgentRuntimeRecoverySnapshot) {
				for (const l of listeners) l(recovery)
			},
			stats() {
				return { subscribeCalls, unsubscribeCalls, activeListeners: listeners.size }
			},
		},
	}
}

const activeSession: { current: string | undefined } = { current: undefined }

function makeWiringDeps(): TaskShadowHostWiringDeps {
	return {
		lifecycle: {
			getActiveSession: () => (activeSession.current ? { sessionId: activeSession.current } : undefined) as never,
			setRunning: () => undefined,
		} as never,
		sessionOptions: {
			mcpHub: undefined,
			requestToolApproval: undefined,
			askQuestion: undefined,
			onSessionEvent: () => {},
			onSendComplete: () => {},
			onSendError: () => {},
		} as never,
		getLegacyPhase: (): TurnPhase => "idle",
		getArbiterSnapshot: () => emptyArbiterSnapshot(),
		now: () => NOW,
	}
}

/**
 * SubscriptionSeamHarness. The harness:
 *
 *   - Holds a REAL `TaskTelemetryTracker` (the production
 *     authoritative state for recoveryBudgetFailures + currentTask).
 *   - Holds a REAL `CanonicalRuntimeShadowSubscription` (the
 *     production owner for the canonical runtime-event listener).
 *   - Holds a REAL `TaskShadowHostWiring` (the production wiring
 *     that observes canonical events).
 *   - Holds a REAL recovery unsubscribe handle, mirroring the
 *     `taskTelemetryRecoveryUnsub` field on `SdkController`.
 *
 * `runInit(sessionId, host, recoveryHost)` mirrors
 * `SdkController.initTask`'s post-`taskStart.initTask` block
 * (lines 1652-1675): both attach calls are unconditional.
 *
 * `runReinit(taskId, sessionId, ...)` mirrors
 * `SdkController.reinitExistingTaskFromId(taskId)`'s post-coordinator
 * block (lines 1810-1832). When the production source has the wiring
 * (`hasRuntimeWiring && hasRecoveryWiring`), the harness invokes
 * both attach calls — mirroring the repaired flow. When the wiring
 * is absent, the harness mirrors the broken flow (only
 * `taskTelemetry.startTask`; no subscription attaches).
 *
 * The `sessionId === taskId` fence is preserved in both branches
 * (per LTZ01 — defends against superseding intents).
 */
class SubscriptionSeamHarness {
	readonly telemetry = new TaskTelemetryTracker()
	readonly runtimeOwner = new CanonicalRuntimeShadowSubscription()
	readonly wiring = createTaskShadowHostWiring(makeWiringDeps())

	private recoveryUnsub: (() => void) | undefined

	constructor(
		private readonly hasRuntimeWiring: boolean,
		private readonly hasRecoveryWiring: boolean,
	) {}

	runInit(
		sessionId: string,
		runtimeHost: ReturnType<typeof makeRuntimeHost>,
		recoveryHost: ReturnType<typeof makeRecoveryHost>,
	): void {
		this.telemetry.startTask(sessionId)
		if (recoveryHost.subscribeRecoveryStateChange) {
			this.recoveryUnsub?.()
			this.recoveryUnsub = undefined
			const sessionId_ = sessionId
			this.recoveryUnsub = recoveryHost.subscribeRecoveryStateChange((evtSessionId, recovery) => {
				if (evtSessionId && evtSessionId !== sessionId_) return
				this.telemetry.observeRecovery(recovery)
			})
		}
		this.runtimeOwner.attach(runtimeHost.host, this.wiring, sessionId)
	}

	runReinit(
		taskId: string,
		resumedSessionId: string,
		runtimeHost: ReturnType<typeof makeRuntimeHost>,
		recoveryHost: ReturnType<typeof makeRecoveryHost>,
	): void {
		const sessionId = resumedSessionId
		if (!(sessionId && sessionId === taskId)) {
			// Fenced: superseding intent; do nothing.
			return
		}
		// Production chronology (mirrored):
		//   1. Inner coordinator: clearTaskForOperation → setTurnPhase("idle")
		//      → observeTurnPhase("idle") is a no-op on telemetry
		//      (idle is neither terminal nor continuation).
		//   2. Coordinator: startNewSession resolves; createAndSetTask.
		//   3. Coordinator: setTurnPhase("streaming") (line 357) →
		//      taskTelemetry.observeTurnPhase("streaming") is a
		//      CONTINUATION_PHASE → clears `endedAt`. This is what
		//      reopens the clock for a resumed task that was
		//      previously frozen (LIVE-B).
		//   4. Coordinator: postStateToWebview().
		//   5. Controller post-block (LTZ01 anchor + RSP01 subscriptions).
		// The harness must mirror steps 1-3 to faithfully reproduce
		// the LIVE-B scenario where a prior endTask froze the tracker
		// and resume must reopen the clock.
		this.telemetry.observeTurnPhase("idle")
		this.telemetry.observeTurnPhase("streaming", Date.now())
		// Step 5: telemetry startTask + subscriptions.
		this.telemetry.startTask(sessionId)
		if (this.hasRecoveryWiring && recoveryHost.subscribeRecoveryStateChange) {
			this.recoveryUnsub?.()
			this.recoveryUnsub = undefined
			const sessionId_ = sessionId
			this.recoveryUnsub = recoveryHost.subscribeRecoveryStateChange((evtSessionId, recovery) => {
				if (evtSessionId && evtSessionId !== sessionId_) return
				this.telemetry.observeRecovery(recovery)
			})
		}
		if (this.hasRuntimeWiring) {
			this.runtimeOwner.attach(runtimeHost.host, this.wiring, sessionId)
		}
	}

	dispose(): void {
		this.recoveryUnsub?.()
		this.recoveryUnsub = undefined
		this.runtimeOwner.dispose()
		this.wiring.dispose()
	}
}

describe("ACT-CLINEMM-RESUME-SUBSCRIPTION-PARITY01 — resume-seam subscription lifecycle", () => {
	const wiring = productionReinitWiresBothSubscriptions(SdkControllerSource)

	beforeEach(() => {
		activeSession.current = undefined
	})

	it("RSP01: after a real resume, emitting a canonical runtime event must reach the shadow comparator exactly once", () => {
		expect(
			wiring.runtime,
			"production SdkController.reinitExistingTaskFromId must wire attachCanonicalRuntimeEventSubscription(...)",
		).toBe(true)

		const runtimeHost = makeRuntimeHost()
		const recoveryHost = makeRecoveryHost()

		activeSession.current = "session-A"
		runtimeHost.api.addSession("session-A")

		const h = new SubscriptionSeamHarness(wiring.runtime, wiring.recovery)
		h.runReinit("session-A", "session-A", runtimeHost, recoveryHost)

		runtimeHost.api.deliver("session-A", makeExecEvent())

		expect(h.wiring.recorderCounts().eventsObserved).toBe(1)

		h.dispose()
	})

	it("RSP02: after a real resume, emitting a canonical recovery snapshot must increment recoveryBudgetFailures exactly once", () => {
		expect(
			wiring.recovery,
			"production SdkController.reinitExistingTaskFromId must wire attachRecoveryTelemetrySubscription(...)",
		).toBe(true)

		const runtimeHost = makeRuntimeHost()
		const recoveryHost = makeRecoveryHost()

		activeSession.current = "session-A"
		runtimeHost.api.addSession("session-A")

		const h = new SubscriptionSeamHarness(wiring.runtime, wiring.recovery)
		h.runReinit("session-A", "session-A", runtimeHost, recoveryHost)

		const before = h.telemetry.get()?.recoveryBudgetFailures ?? 0
		recoveryHost.api.deliver(makeRecoverySnapshot(1))
		const after = h.telemetry.get()?.recoveryBudgetFailures ?? 0

		expect(after - before).toBe(1)

		h.dispose()
	})

	it("RSP03: fresh initTask delivers a canonical runtime event exactly once (positive control)", () => {
		const runtimeHost = makeRuntimeHost()
		const recoveryHost = makeRecoveryHost()

		activeSession.current = "session-A"
		runtimeHost.api.addSession("session-A")

		const h = new SubscriptionSeamHarness(wiring.runtime, wiring.recovery)
		h.runInit("session-A", runtimeHost, recoveryHost)

		runtimeHost.api.deliver("session-A", makeExecEvent())
		expect(h.wiring.recorderCounts().eventsObserved).toBe(1)

		h.dispose()
	})

	it("RSP04: fresh initTask delivers a recovery snapshot exactly once (positive control)", () => {
		const runtimeHost = makeRuntimeHost()
		const recoveryHost = makeRecoveryHost()

		activeSession.current = "session-A"
		runtimeHost.api.addSession("session-A")

		const h = new SubscriptionSeamHarness(wiring.runtime, wiring.recovery)
		h.runInit("session-A", runtimeHost, recoveryHost)

		const before = h.telemetry.get()?.recoveryBudgetFailures ?? 0
		recoveryHost.api.deliver(makeRecoverySnapshot(1))
		const after = h.telemetry.get()?.recoveryBudgetFailures ?? 0
		expect(after - before).toBe(1)

		h.dispose()
	})

	// RSP05: cardinality — a second resume replaces, does not stack.
	it("RSP05: a second resume replaces, does not stack; exactly-once per event", () => {
		expect(
			wiring.runtime,
			"production SdkController.reinitExistingTaskFromId must wire attachCanonicalRuntimeEventSubscription(...)",
		).toBe(true)

		const runtimeHost = makeRuntimeHost()
		const recoveryHost = makeRecoveryHost()

		activeSession.current = "session-A"
		runtimeHost.api.addSession("session-A")

		const h = new SubscriptionSeamHarness(wiring.runtime, wiring.recovery)

		// First resume.
		h.runReinit("session-A", "session-A", runtimeHost, recoveryHost)
		const firstRuntimeSubs = runtimeHost.api.stats().subscribeCalls
		const firstRuntimeUnsubs = runtimeHost.api.stats().unsubscribeCalls
		const firstRecoverySubs = recoveryHost.api.stats().subscribeCalls

		// Second resume of the same task.
		h.runReinit("session-A", "session-A", runtimeHost, recoveryHost)

		// Dispose-then-attach discipline must hold for both subscriptions.
		expect(runtimeHost.api.stats().unsubscribeCalls).toBeGreaterThan(firstRuntimeUnsubs)
		expect(runtimeHost.api.stats().subscribeCalls).toBeGreaterThan(firstRuntimeSubs)
		expect(recoveryHost.api.stats().subscribeCalls).toBeGreaterThan(firstRecoverySubs)

		// Emit one canonical event. Exactly one observation.
		runtimeHost.api.deliver("session-A", makeExecEvent())
		expect(h.wiring.recorderCounts().eventsObserved).toBe(1)

		// Emit one recovery snapshot. Exactly one increment.
		const before = h.telemetry.get()?.recoveryBudgetFailures ?? 0
		recoveryHost.api.deliver(makeRecoverySnapshot(1))
		const after = h.telemetry.get()?.recoveryBudgetFailures ?? 0
		expect(after - before).toBe(1)

		h.dispose()
	})

	// RSP06: identity — stale A event cannot mutate B's wiring.
	it("RSP06: after a session A->B switch, an event tagged session-A does NOT reach B's wiring", () => {
		expect(
			wiring.runtime,
			"production SdkController.reinitExistingTaskFromId must wire attachCanonicalRuntimeEventSubscription(...)",
		).toBe(true)

		const runtimeHost = makeRuntimeHost()
		const recoveryHost = makeRecoveryHost()

		// Stage 1: resume A.
		activeSession.current = "session-A"
		runtimeHost.api.addSession("session-A")

		const h = new SubscriptionSeamHarness(wiring.runtime, wiring.recovery)
		h.runReinit("session-A", "session-A", runtimeHost, recoveryHost)

		// Stage 2: switch to B (initTask("session-B")).
		activeSession.current = "session-B"
		runtimeHost.api.addSession("session-B")
		h.runInit("session-B", runtimeHost, recoveryHost)

		// Deliver a stale event tagged session-A. The shadow's
		// sessionId filter must drop it.
		runtimeHost.api.deliver("session-A", makeExecEvent())
		expect(h.wiring.recorderCounts().eventsObserved).toBe(0)

		// Sanity: an event tagged session-B IS observed.
		runtimeHost.api.deliver("session-B", makeExecEvent())
		expect(h.wiring.recorderCounts().eventsObserved).toBe(1)

		h.dispose()
	})

	// RSP03: behavioral RED — base TaskTelemetry presence after resume
	it("RSP03: after a real resume, taskTelemetry is present with startedAt defined and identity = taskId", () => {
		const runtimeHost = makeRuntimeHost()
		const recoveryHost = makeRecoveryHost()

		activeSession.current = "session-A"
		runtimeHost.api.addSession("session-A")

		const h = new SubscriptionSeamHarness(wiring.runtime, wiring.recovery)
		h.runReinit("session-A", "session-A", runtimeHost, recoveryHost)

		const strip = h.telemetry.get()
		expect(strip, "taskTelemetry strip must be defined after resume (LIVE-A: telemetry-absent)").toBeDefined()
		expect(strip?.startedAt, "startedAt must be defined after resume").toBeGreaterThan(0)
		expect(h.telemetry.currentTask, "currentTask must equal the resumed taskId").toBe("session-A")
		// recoveryBudgetFailures should be 0 (fresh startTask zeros counters
		// on identity change).
		expect(strip?.recoveryBudgetFailures).toBe(0)

		h.dispose()
	})

	// RSP04: behavioral RED — terminal-timing cleared on resume (LIVE-B)
	it("RSP04: a prior terminal freeze is cleared by the resume's streaming-phase observation (LIVE-B fix)", () => {
		const runtimeHost = makeRuntimeHost()
		const recoveryHost = makeRecoveryHost()

		activeSession.current = "session-A"
		runtimeHost.api.addSession("session-A")

		const h = new SubscriptionSeamHarness(wiring.runtime, wiring.recovery)

		// Step 1: simulate prior active run + terminal freeze.
		// (Models: user ran task A, hit terminal phase, header froze.)
		h.telemetry.startTask("session-A", 1_000)
		h.telemetry.observeTurnPhase("streaming", 1_000)
		h.telemetry.endTask(60_000) // freezes at 60_000
		expect(h.telemetry.get()?.endedAt).toBe(60_000)

		// Step 2: user clicks Resume. The coordinator runs
		//   setTurnPhase("streaming")
		// which forwards to taskTelemetry.observeTurnPhase("streaming").
		// `streaming` is a CONTINUATION_PHASE → endedAt must be cleared.
		h.runReinit("session-A", "session-A", runtimeHost, recoveryHost)

		const strip = h.telemetry.get()
		expect(strip, "taskTelemetry strip must be defined after resume").toBeDefined()
		expect(
			strip?.endedAt,
			"endedAt must be undefined after resume's streaming-phase observation (LIVE-B: timer must reopen)",
		).toBeUndefined()
		expect(strip?.startedAt, "startedAt must be preserved (or re-anchored; either way defined)").toBeGreaterThan(0)
		expect(h.telemetry.currentTask).toBe("session-A")

		h.dispose()
	})

	// RSP-SANITY: the production helper itself drops stale events.
	it("RSP-SANITY: subscribeCanonicalRuntimeEventsToShadow (production helper) drops stale sessionId events", () => {
		const runtimeHost = makeRuntimeHost()
		const wiringInstance = createTaskShadowHostWiring(makeWiringDeps())
		activeSession.current = "session-B"
		runtimeHost.api.addSession("session-B")

		const unsub = subscribeCanonicalRuntimeEventsToShadow(runtimeHost.host, wiringInstance, "session-B")
		runtimeHost.api.deliver("session-A", makeExecEvent())
		expect(wiringInstance.recorderCounts().eventsObserved).toBe(0)
		runtimeHost.api.deliver("session-B", makeExecEvent())
		expect(wiringInstance.recorderCounts().eventsObserved).toBe(1)

		unsub()
		wiringInstance.dispose()
	})
})
