/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2:
 *
 * Unified observation coordinator. One instance per wiring; the
 * single observation/evidence boundary for every state-changing
 * ingress into the TaskState shadow.
 *
 * EVERY STATE-MUTATING INGRESS MUST FUNNEL THROUGH THIS OBJECT.
 *
 *   RUNTIME_CANONICAL     → coordinator.observe({ kind: "runtime-canonical",    ... })
 *   RUNTIME_RECONSTRUCTED → coordinator.observe({ kind: "runtime-reconstructed",... })
 *   HOST_TASK             → coordinator.observe({ kind: "host-task",            ... })
 *   HOST_RECOVERY         → coordinator.observe({ kind: "host-recovery",        ... })
 *
 * Transaction contract (per ACT §8):
 *
 *   1. resolve authority (canonical > reconstructed; host-task unique;
 *      host-recovery fallback-only)
 *   2. apply exactly one logical transition to the shadow
 *   3. sample legacy phase
 *   4. classify legacy/shadow relation (with D11_HOST_PREENGAGED override)
 *   5. arbitrate using canonical facts
 *   6. append exactly one bounded record (or SUPPRESS_DUPLICATE)
 *   7. increment counters exactly once
 *
 * Authority (per ACT §10, §11, §12, §13):
 *
 *   CANONICAL > RECONSTRUCTED for any fact represented by an AgentRuntimeEvent.
 *   HOST_TASK is the only authority for visible-task identity events.
 *   HOST_RECOVERY is fallback-only (FALLBACK_APPLY when canonicalAvailable===false).
 *   Stale canonical events (sessionId != active) do not mutate state.
 */
import { TaskState } from "@cline/agents"
import type { AgentRunStatus, AgentRuntimeEvent } from "@cline/shared"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import { TaskShadowComparator, type TaskShadowDivergence } from "./task-state-shadow"
import type { TaskShadowRuntimeOrigin } from "./task-state-shadow-host-wiring"
import {
	type ArbiterSnapshot,
	type DivergenceClass,
	MAX_RECORDS_PER_TASK,
	type TaskShadowRecorder,
	type TaskShadowRecordInput,
} from "./task-state-shadow-recorder"

type TaskMsg = TaskState.TaskMsg
type ShadowObservation = TaskState.TaskShadowObservation
type TaskInvariantViolation = TaskState.TaskInvariantViolation

/**
 * Authority outcome for one observation. Centralizing this decision
 * keeps dedup policy testable and prevents scattering `if
 * (origin === ...)` across files (per ACT §46).
 */
export type ObservationAuthority =
	| "APPLY" // apply the transition, record exactly one
	| "DIAGNOSTIC_ONLY" // observe but record as a diagnostic (no state mutation)
	| "SUPPRESS_DUPLICATE" // a higher-authority ingress already produced this transition
	| "STALE" // session mismatch; no state mutation
	| "FALLBACK_APPLY" // HOST_RECOVERY applied because canonical transport unavailable

/**
 * Input to the coordinator. The `kind` discriminates the four
 * ingress types and carries exactly the data the shadow accepts.
 */
export type TaskShadowObservationInput =
	| {
			readonly kind: "runtime-canonical"
			readonly origin: "RUNTIME_CANONICAL"
			readonly sessionId: string
			readonly event: AgentRuntimeEvent
	  }
	| {
			readonly kind: "runtime-reconstructed"
			readonly origin: "RUNTIME_RECONSTRUCTED"
			readonly sessionId: string
			readonly event: AgentRuntimeEvent
	  }
	| {
			readonly kind: "host-task"
			readonly origin: "HOST_TASK"
			readonly taskId: string
			readonly msg: TaskMsg
	  }
	| {
			readonly kind: "host-recovery"
			readonly origin: "HOST_RECOVERY"
			readonly sessionId: string
			readonly msg: TaskMsg
			/**
			 * `true` when the canonical transport is available and
			 * canonical recovery has not already produced the same
			 * edge; `false` forces FALLBACK_APPLY (HubRuntimeHost /
			 * RemoteRuntimeHost).
			 */
			readonly canonicalAvailable: boolean
	  }

/**
 * Coordinator dependencies. The wiring owns a single instance; the
 * comparator and recorder are owned internally and reachable only
 * via the read-only accessors for qualification tests.
 */
export interface TaskShadowCoordinatorDeps {
	readonly comparator: TaskShadowComparator
	readonly recorder: TaskShadowRecorder
	readonly now: () => number
	readonly getLegacyPhase: () => TurnPhase
	readonly getArbiterSnapshot: () => ArbiterSnapshot
	readonly getActiveSessionId: () => string | undefined
	readonly getRuntimeStatus: () => AgentRunStatus
	readonly onInvariantViolation?: (
		record: ReturnType<TaskShadowRecorder["getRecords"]>[number] | undefined,
		violations: readonly TaskInvariantViolation[],
	) => void
}

export interface TaskShadowCoordinator {
	readonly observe: (input: TaskShadowObservationInput) => void
	/**
	 * Diagnostic-only accessor for the recorder's bounded buffer.
	 */
	readonly records: () => ReturnType<TaskShadowRecorder["getRecords"]>
	readonly counts: () => ReturnType<TaskShadowRecorder["getCounts"]>
	/**
	 * Read-only handle to the comparator for qualification tests
	 * that need to read the comparator's internal shadow model.
	 * Production code MUST NOT use this to write.
	 */
	readonly comparator: TaskShadowComparator
	/**
	 * Diagnostic: most-recent authority outcome per origin. Read-only.
	 */
	readonly lastAuthorityByOrigin: () => Readonly<Record<TaskShadowRuntimeOrigin, ObservationAuthority | undefined>>
	/**
	 * Test-only: clear all internal state.
	 */
	readonly debugReset: () => void
}

/**
 * Minimal edge key for canonical authority dedup. NOT a timestamp;
 * semantic-edge identity (per ACT §14, §13).
 *
 * Presentational events (assistant text, message-added, usage,
 * status-notice) carry an `presentational:<type>` key so that
 * canonical authority is registered but they do not enter the
 * dedup gate (they do not represent a state-mutating edge).
 */
function edgeKeyOf(event: AgentRuntimeEvent): string {
	switch (event.type) {
		case "execution-state-changed": {
			const prev = event.previousExecution
			const cur = event.snapshot.execution
			if (!cur) return `exec:${prev.modelStreaming}|${prev.tooling}|${prev.awaitingApproval}->?`
			return `exec:${prev.modelStreaming}|${prev.tooling}|${prev.awaitingApproval}->${cur.modelStreaming}|${cur.tooling}|${cur.awaitingApproval}`
		}
		case "recovery-state-changed": {
			const prev = event.previousRecovery
			const cur = event.snapshot.recovery
			if (!cur) return `recovery:${prev.state}->?`
			return `recovery:${prev.state}->${cur.state}`
		}
		case "run-started":
			return `run-started`
		case "run-finished":
			return `run-finished`
		case "run-failed":
			return `run-failed`
		case "turn-started":
			return `turn-started:${event.iteration}`
		case "turn-finished":
			return `turn-finished:${event.iteration}`
		case "tool-started":
			return `tool-started:${event.toolCall.toolCallId}`
		case "tool-updated":
			return `tool-updated:${event.toolCall.toolCallId}`
		case "tool-finished":
			return `tool-finished:${event.toolCall.toolCallId}`
		case "message-added":
		case "assistant-text-delta":
		case "assistant-reasoning-delta":
		case "assistant-message":
		case "usage-updated":
		case "status-notice":
			return `presentational:${event.type}`
		default: {
			// Exhaustive switch on AgentRuntimeEvent.
			const _exhaustive: never = event
			void _exhaustive
			return "unknown"
		}
	}
}

/**
 * Resolver state. Tracks the canonical edges already applied for
 * dedup; reset between tasks (via `debugReset`).
 */
interface ResolverState {
	activeSessionId: string | undefined
	canonicalEdges: Set<string>
	lastAuthority: Record<TaskShadowRuntimeOrigin, ObservationAuthority | undefined>
}

function makeInitialResolverState(): ResolverState {
	return {
		activeSessionId: undefined,
		canonicalEdges: new Set(),
		lastAuthority: {
			RUNTIME_CANONICAL: undefined,
			RUNTIME_RECONSTRUCTED: undefined,
			HOST_TASK: undefined,
			HOST_RECOVERY: undefined,
		},
	}
}

/**
 * Resolve the authority decision for one observation. Centralized
 * so dedup policy is testable in isolation (per ACT §46).
 *
 * Rules:
 *
 *   1. sessionId mismatch (when the active session id is set) → STALE.
 *   2. RUNTIME_CANONICAL   → APPLY (when not stale).
 *   3. RUNTIME_RECONSTRUCTED:
 *        APPLY unless canonical already produced the same edge
 *        (then SUPPRESS_DUPLICATE).
 *   4. HOST_TASK            → APPLY (host-only authority).
 *   5. HOST_RECOVERY        → SUPPRESS_DUPLICATE if canonicalAvailable,
 *                              FALLBACK_APPLY otherwise.
 */
export function resolveObservationAuthority(input: TaskShadowObservationInput, state: ResolverState): ObservationAuthority {
	// Rule 1: stale session.
	if (input.kind !== "host-task") {
		const active = state.activeSessionId
		if (active !== undefined) {
			if (input.sessionId !== active) {
				return "STALE"
			}
		}
	}
	switch (input.kind) {
		case "runtime-canonical":
			return "APPLY"
		case "runtime-reconstructed": {
			const edgeKey = edgeKeyOf(input.event)
			if (state.canonicalEdges.has(edgeKey)) {
				return "SUPPRESS_DUPLICATE"
			}
			return "APPLY"
		}
		case "host-task":
			return "APPLY"
		case "host-recovery":
			return input.canonicalAvailable ? "SUPPRESS_DUPLICATE" : "FALLBACK_APPLY"
	}
}

/**
 * Build the unified coordinator. The wiring owns exactly one of
 * these per controller lifetime (per ACT §45).
 */
export function createTaskShadowObservationCoordinator(deps: TaskShadowCoordinatorDeps): TaskShadowCoordinator {
	const state = makeInitialResolverState()
	const seqCounter = { value: 0 }

	function nextSeq(): number {
		seqCounter.value += 1
		return seqCounter.value
	}

	function observe(input: TaskShadowObservationInput): void {
		// 0. Track the active session for stale detection.
		if (input.kind === "runtime-canonical") {
			state.activeSessionId = input.sessionId
		} else if (input.kind === "host-task") {
			if (state.activeSessionId === undefined) {
				state.activeSessionId = input.taskId
			}
		}

		// 1. Resolve authority.
		const authority = resolveObservationAuthority(input, state)
		state.lastAuthority[input.origin] = authority

		// 2. Branch on authority outcome.
		try {
			switch (authority) {
				case "STALE":
					return
				case "SUPPRESS_DUPLICATE":
					deps.recorder.recordSuppression(input.origin)
					return
				case "DIAGNOSTIC_ONLY":
					return
				case "FALLBACK_APPLY":
					deps.recorder.recordFallbackRecoveryApplied()
					applyAndRecord(input, undefined)
					return
				case "APPLY":
					applyAndRecord(input, undefined)
					if (input.kind === "runtime-canonical") {
						state.canonicalEdges.add(edgeKeyOf(input.event))
					}
					return
			}
		} catch {
			// Exception isolation (per ACT §32).
			deps.recorder.recordObserverError()
		}
	}

	/**
	 * Apply the transition, sample legacy phase, classify (with D11),
	 * arbitrate, and record. The recorder.record call is the single
	 * bounded record path; nothing else persists.
	 *
	 * `classificationOverride` is set by the coordinator when the
	 * D11 host-pre-engaged window applies; the recorder's
	 * `classify()` remains the authoritative writer for D00-D10.
	 */
	function applyAndRecord(input: TaskShadowObservationInput, _unused: undefined): void {
		const now = deps.now()
		const legacyPhase = deps.getLegacyPhase()
		const arbiter = deps.getArbiterSnapshot()
		const activeSession = deps.getActiveSessionId()
		const taskEpochOrOpaqueTaskKey = activeSession

		// 2. Apply the transition to the shadow via the comparator.
		const observationResult = applyToComparator(input, legacyPhase, now)
		const observation: ShadowObservation = observationResult.observation
		const divergence: TaskShadowDivergence | undefined = observationResult.divergence

		// 3. D11 override classification (host-pre-engaged).
		const overrideClassification = classifyD11(divergence, observation, input, arbiter)

		const toolCalls = observation.projections.toolCalls ?? 0
		const recoveryBudgetFailures = observation.projections.recoveryBudgetFailures ?? 0

		const recordInput: TaskShadowRecordInput = {
			seq: nextSeq(),
			timestamp: now,
			divergence,
			observationEvent: observation.event,
			observationLifecycleKind: observation.model.lifecycle.kind,
			observationModel: observation.model,
			observationToolCalls: toolCalls,
			observationRecoveryBudgetFailures: recoveryBudgetFailures,
			taskEpochOrOpaqueTaskKey,
			runtimeStatus: deps.getRuntimeStatus(),
			arbiter,
			classificationOverride: overrideClassification,
		}
		const persisted = deps.recorder.record(recordInput, observation.violations)

		if (observation.violations.length > 0 && deps.onInvariantViolation) {
			try {
				deps.onInvariantViolation(persisted, observation.violations)
			} catch {
				/* Observation-only — never throw. */
			}
		}
	}

	function applyToComparator(
		input: TaskShadowObservationInput,
		legacyPhase: TurnPhase,
		now: number,
	): { observation: ShadowObservation; divergence: TaskShadowDivergence | undefined } {
		switch (input.kind) {
			case "runtime-canonical":
			case "runtime-reconstructed":
				return deps.comparator.observeRuntimeEvent(input.event, legacyPhase, now)
			case "host-task":
			case "host-recovery":
				return deps.comparator.observeTaskMsg(input.msg, legacyPhase, now)
		}
	}

	return {
		observe,
		records: () => deps.recorder.getRecords(),
		counts: () => deps.recorder.getCounts(),
		comparator: deps.comparator,
		lastAuthorityByOrigin: () => ({ ...state.lastAuthority }),
		debugReset: () => {
			deps.recorder.debugReset()
			deps.comparator.debugReset()
			state.canonicalEdges.clear()
			state.activeSessionId = undefined
			state.lastAuthority = {
				RUNTIME_CANONICAL: undefined,
				RUNTIME_RECONSTRUCTED: undefined,
				HOST_TASK: undefined,
				HOST_RECOVERY: undefined,
			}
			seqCounter.value = 0
		},
	}
}

/**
 * D11_HOST_PREENGAGED override. Returns the D11 class when the
 * host-pre-engaged condition holds; otherwise returns `undefined`
 * so the recorder's classifier remains the authoritative writer.
 */
function classifyD11(
	divergence: TaskShadowDivergence | undefined,
	observation: ShadowObservation,
	input: TaskShadowObservationInput,
	arbiter: ArbiterSnapshot,
): DivergenceClass | undefined {
	if (!divergence) return undefined
	const hostPreEngaged =
		divergence.legacyPhase === "streaming" &&
		arbiter.status === "running" &&
		!arbiter.execution.modelStreaming &&
		!observation.model.activity.modelStreaming
	if (!hostPreEngaged) return undefined
	if (input.kind !== "runtime-canonical" && input.kind !== "runtime-reconstructed") {
		return undefined
	}
	if (input.event.type !== "execution-state-changed") return undefined
	return "D11_HOST_PREENGAGED"
}

// Re-export the bounded-record constant for downstream consumers.
export { MAX_RECORDS_PER_TASK }

// Exposed for tests only.
export { edgeKeyOf, makeInitialResolverState }
