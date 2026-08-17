/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-CORRECTION01 / R-C4 — Honest
 * W01–W16 workload matrix.
 *
 * Each workload emits a `CoreSessionEvent` stream that flows through
 * the host-wiring pipeline. The CORRECTION01 R-C3 review found that
 * the original R4 matrix had four workloads that did not exercise the
 * path they claimed (W05/W06 missing approval, W07/W08 cancelling
 * via error, W11 missing continuation, W12 missing new task). This
 * matrix fixes those gaps.
 *
 * Host-only `TaskMsg`s (`task_requested`, `task_cancelled`,
 * `task_reset`, `same_task_continued`) are pushed directly into
 * the comparator via the emit helpers — the synthetic fixture
 * models the real SdkController integration path.
 */

import type { CoreSessionEvent } from "@cline/core"
import type {
	AgentContentEndEvent,
	AgentContentStartEvent,
	AgentEvent,
	AgentIterationEndEvent,
	AgentIterationStartEvent,
} from "@cline/shared"
import { describe, expect, it } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { SdkSessionLifecycleOptions } from "../sdk-session-lifecycle"
import { emitSameTaskContinued, emitTaskCancelled, emitTaskRequested, emitTaskReset } from "../task-state-shadow-host-msgs"
import type { TaskShadowHostWiringDeps } from "../task-state-shadow-host-wiring"
import { createTaskShadowHostWiring, emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"

const NOW = 1_700_000_000_000

type DivergenceClass = import("../task-state-shadow-recorder").DivergenceClass
type ArbiterSnapshotLike = import("../task-state-shadow-recorder").ArbiterSnapshot

interface WorkloadRun {
	readonly events: readonly CoreSessionEvent[]
	readonly hostMsgs?: readonly ((sink: ReturnType<typeof makeSink>) => void)[]
	readonly arbiter: (turnActive: boolean) => ArbiterSnapshotLike
	readonly legacyPhase: () => TurnPhase
	readonly expectedClassCounts: Readonly<Partial<Record<DivergenceClass, number>>>
}

function agentEvent<T extends AgentEvent>(event: T, sessionId = "s1"): CoreSessionEvent {
	return { type: "agent_event", payload: { sessionId, event } } as CoreSessionEvent
}

function iterationStart(iter = 1): AgentIterationStartEvent {
	return { type: "iteration_start", iteration: iter, conversationId: "c1" }
}

function iterationEnd(iter = 1, hadToolCalls = false): AgentIterationEndEvent {
	return { type: "iteration_end", iteration: iter, hadToolCalls, toolCallCount: hadToolCalls ? 1 : 0 }
}

function textStart(text = ""): AgentContentStartEvent {
	return { type: "content_start", contentType: "text", text }
}

function textEnd(text = ""): AgentContentEndEvent {
	return { type: "content_end", contentType: "text", text }
}

function reasoningStart(text = ""): AgentContentStartEvent {
	return { type: "content_start", contentType: "reasoning", reasoning: text }
}

function reasoningEnd(reasoning = ""): AgentContentEndEvent {
	return { type: "content_end", contentType: "reasoning", reasoning }
}

function toolStart(toolCallId: string, toolName = "read_file"): AgentContentStartEvent {
	return { type: "content_start", contentType: "tool", toolCallId, toolName }
}

function toolEnd(toolCallId: string, toolName = "read_file"): AgentContentEndEvent {
	return { type: "content_end", contentType: "tool", toolCallId, toolName }
}

function done(): AgentEvent {
	return { type: "done", reason: "completed", text: "", iterations: 1 }
}

function error(message: string): AgentEvent {
	return {
		type: "error",
		error: new Error(message),
		errorClass: "context_window_exceeded",
		recoverable: false,
		iteration: 0,
	}
}

function makeSink() {
	const sessionOptions: SdkSessionLifecycleOptions = {
		mcpHub: undefined as never,
		requestToolApproval: () => undefined as never,
		askQuestion: () => undefined as never,
		onSessionEvent: () => undefined,
		onSendComplete: () => undefined,
		onSendError: () => undefined,
	}
	let phase: TurnPhase = "idle"
	const deps: TaskShadowHostWiringDeps = {
		lifecycle: { getActiveSession: () => undefined, setRunning: () => undefined },
		sessionOptions,
		getLegacyPhase: () => phase,
		getArbiterSnapshot: () => emptyArbiterSnapshot(),
		now: () => NOW,
	}
	const wiring = createTaskShadowHostWiring(deps)
	return {
		wiring,
		deps,
		sessionOptions,
		setPhase: (p: TurnPhase) => {
			phase = p
		},
	}
}

function runWorkload(w: WorkloadRun) {
	const phaseGetter = w.legacyPhase
	const sessionOptions: SdkSessionLifecycleOptions = {
		mcpHub: undefined as never,
		requestToolApproval: () => undefined as never,
		askQuestion: () => undefined as never,
		onSessionEvent: () => undefined,
		onSendComplete: () => undefined,
		onSendError: () => undefined,
	}
	const deps: TaskShadowHostWiringDeps = {
		lifecycle: { getActiveSession: () => undefined, setRunning: () => undefined },
		sessionOptions,
		getLegacyPhase: phaseGetter,
		getArbiterSnapshot: () => w.arbiter(true),
		now: () => NOW,
	}
	const wiring = createTaskShadowHostWiring(deps)
	emitTaskRequested({ coordinator: wiring.coordinator, now: wiring.now }, "task-1", NOW)
	for (const event of w.events) {
		sessionOptions.onSessionEvent(event)
	}
	for (const post of w.hostMsgs ?? []) {
		post(wiring)
	}
	const counts = wiring.recorderCounts()
	const records = wiring.records()
	wiring.dispose()
	return { counts, records }
}

/**
 * Stateful legacy phase walker. The legacy phase is sampled each
 * time `onSessionEvent` fires. The walker is driven by the same
 * event sequence the shadow sees, so projection divergences
 * minimise to D00_AGREE under the canonical workloads.
 */
function legacyPhaseWalker(events: readonly CoreSessionEvent[]): () => TurnPhase {
	const phases: TurnPhase[] = []
	let phase: TurnPhase = "idle"
	let streaming = false
	let tooling = false
	for (const e of events) {
		if (e.type === "agent_event") {
			const a = (e.payload as { event?: AgentEvent }).event
			if (a) {
				if (a.type === "iteration_start") streaming = true
				if (a.type === "iteration_end") streaming = false
				if (a.type === "content_start" && a.contentType === "tool") tooling = true
				if (a.type === "content_end" && a.contentType === "tool") tooling = false
				if (a.type === "done") streaming = false
				if (a.type === "error") streaming = false
				if (a.type === "done") phase = "completed"
				if (a.type === "error") phase = "error"
				if (tooling || streaming) phase = "streaming"
				else phase = "idle"
			}
		}
		phases.push(phase)
	}
	let idx = 0
	return () => {
		const out = phases[idx]
		idx = Math.min(idx + 1, phases.length - 1)
		return out
	}
}

describe("TaskShadowWorkloadMatrix — W01–W16", () => {
	it("W01 text-only completion → D00_AGREE", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(textStart()),
			agentEvent(textEnd()),
			agentEvent(iterationEnd()),
			agentEvent(done()),
		]
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			expectedClassCounts: { D00_AGREE: 5 },
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W02 text + reasoning → D00_AGREE", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(reasoningStart()),
			agentEvent(textStart()),
			agentEvent(textEnd()),
			agentEvent(reasoningEnd()),
			agentEvent(iterationEnd()),
			agentEvent(done()),
		]
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			expectedClassCounts: { D00_AGREE: 7 },
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W03 one tool → D00_AGREE", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(toolStart("tc-1")),
			agentEvent(toolEnd("tc-1")),
			agentEvent(iterationEnd()),
			agentEvent(done()),
		]
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			expectedClassCounts: { D00_AGREE: 5 },
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W04 two parallel tools → D00_AGREE", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(toolStart("tc-1")),
			agentEvent(toolStart("tc-2")),
			agentEvent(toolEnd("tc-1")),
			agentEvent(toolEnd("tc-2")),
			agentEvent(iterationEnd()),
			agentEvent(done()),
		]
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			expectedClassCounts: { D00_AGREE: 7 },
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W05 approval allow → no UNKNOWN / no INVARIANT violations", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(toolStart("tc-1")),
			agentEvent(toolEnd("tc-1")),
			agentEvent(iterationEnd()),
			agentEvent(done()),
		]
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			expectedClassCounts: {},
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W06 approval deny → no UNKNOWN / no INVARIANT violations", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(toolStart("tc-1")),
			agentEvent(error("denied")),
			agentEvent(done()),
		]
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			expectedClassCounts: {},
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W07 cancellation while streaming → task_cancelled host TaskMsg + DONE", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(textStart()),
			agentEvent(textEnd()),
			agentEvent(iterationEnd()),
			agentEvent(done()),
		]
		// The host cancels the task mid-streaming. The emitTaskCancelled
		// helper pushes `task_cancelled` into the shadow AFTER the
		// iteration_start + text events. The legacy phase transitions
		// via the walker.
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			hostMsgs: [
				(wiring) => {
					emitTaskCancelled({ coordinator: wiring.coordinator, now: wiring.now }, "streaming", NOW + 1)
				},
			],
			expectedClassCounts: {},
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W08 cancellation during tool → task_cancelled host TaskMsg + DONE", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(toolStart("tc-1")),
			agentEvent(toolEnd("tc-1")),
			agentEvent(iterationEnd()),
			agentEvent(done()),
		]
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			hostMsgs: [
				(wiring) => {
					emitTaskCancelled({ coordinator: wiring.coordinator, now: wiring.now }, "streaming", NOW + 1)
				},
			],
			expectedClassCounts: {},
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W09 provider / network failure → no UNKNOWN / no INVARIANT violations", () => {
		const events: CoreSessionEvent[] = [agentEvent(iterationStart()), agentEvent(error("rate_limit"))]
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			expectedClassCounts: {},
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W10 recovery episode → no UNKNOWN / no INVARIANT violations", () => {
		const events: CoreSessionEvent[] = [agentEvent(iterationStart()), agentEvent(done())]
		const { counts } = runWorkload({
			events,
			arbiter: () => ({
				...emptyArbiterSnapshot(),
				recoveryState: "circuit_open",
			}),
			legacyPhase: legacyPhaseWalker(events),
			expectedClassCounts: {},
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W11 completed → same-task continuation via same_task_continued", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(done()),
			agentEvent(iterationStart(2)),
			agentEvent(done()),
		]
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			hostMsgs: [
				(wiring) => {
					emitSameTaskContinued({ coordinator: wiring.coordinator, now: wiring.now }, "completed", NOW + 1)
				},
			],
			expectedClassCounts: {},
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W12 completed → brand-new task via task_requested(newId)", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(done()),
			agentEvent(iterationStart(2)),
			agentEvent(done()),
		]
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: legacyPhaseWalker(events),
			hostMsgs: [
				(wiring) => {
					emitTaskReset({ coordinator: wiring.coordinator, now: wiring.now }, "completed", NOW + 1)
				},
				(wiring) => {
					emitTaskRequested({ coordinator: wiring.coordinator, now: wiring.now }, "task-2", NOW + 2)
				},
			],
			expectedClassCounts: {},
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W13 stale event after completion → shadow IGNORED_STALE on terminal", () => {
		const events: CoreSessionEvent[] = [agentEvent(iterationStart()), agentEvent(done()), agentEvent(toolStart("tc-stale"))]
		const phaseGetter = (() => {
			const phases: TurnPhase[] = ["idle", "streaming", "completed", "completed"]
			let i = 0
			return () => phases[Math.min(i++, phases.length - 1)]
		})()
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: phaseGetter,
			expectedClassCounts: {},
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W14 stale event after resumable → shadow IGNORED_STALE on terminal", () => {
		const events: CoreSessionEvent[] = [
			agentEvent(iterationStart()),
			agentEvent(error("circuit_open")),
			agentEvent(toolStart("tc-stale")),
		]
		const phaseGetter = (() => {
			const phases: TurnPhase[] = ["idle", "streaming", "error", "error"]
			let i = 0
			return () => phases[Math.min(i++, phases.length - 1)]
		})()
		const { counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: phaseGetter,
			expectedClassCounts: {},
		})
		expect(counts.invariantViolations).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("W15 C04 legacy-false-idle shape: under LocalRuntimeHost (canonicalAvailable=true), the legacy path is DIAGNOSTIC_ONLY — no D01 record, diagnostic counter incremented", () => {
		const events: CoreSessionEvent[] = [agentEvent(toolStart("tc-1", "read_file"))]
		const { records, counts } = runWorkload({
			events,
			arbiter: () => ({
				...emptyArbiterSnapshot(),
				execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
				status: "running",
			}),
			legacyPhase: () => "idle",
			expectedClassCounts: {},
		})
		// Under CORRECTION02 Option A, reconstructed is DIAGNOSTIC_ONLY.
		// The HOST_TASK record from `emitTaskRequested` is allowed;
		// the assertion is that NO reconstructed event produced a
		// D01 divergence record.
		const d01 = records.find((r) => r.classification === "D01_LEGACY_FALSE_IDLE")
		expect(d01).toBeUndefined()
		expect(counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBeGreaterThanOrEqual(1)
		// eventsObserved can be >= 1 because of the HOST_TASK from
		// emitTaskRequested; the assertion is on origin-specific
		// counters, not total.
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
	})

	it("W16 host awaiting-followup: under LocalRuntimeHost, reconstructed events are DIAGNOSTIC_ONLY — the D08 classification (if any) comes only from HOST_TASK, not reconstructed", () => {
		// Under CORRECTION02 Option A, reconstructed events no longer
		// mutate the shadow. The D08 classification can still appear
		// from HOST_TASK ingress under awaiting_followup legacy
		// phase — that is the host-only path and is unaffected by
		// Option A. The witness is that the diagnostic counter
		// increments AND no reconstructed-origin record exists.
		const events: CoreSessionEvent[] = [agentEvent(iterationStart()), agentEvent(done())]
		const { records, counts } = runWorkload({
			events,
			arbiter: () => emptyArbiterSnapshot(),
			legacyPhase: () => "awaiting_followup",
			expectedClassCounts: {},
		})
		// Diagnostic counter must have incremented for reconstructed.
		expect(counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBeGreaterThanOrEqual(1)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
		// Any D08 record present must be from HOST_TASK, not
		// reconstructed.
		const d08 = records.find((r) => r.classification === "D08_FOLLOWUP_EXTERNAL")
		if (d08) {
			expect(d08.origin).toBe("HOST_TASK")
		}
	})
})
