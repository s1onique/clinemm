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
import type { HostOwnershipFactsSnapshot } from "@/shared/host-ownership-diagnostic"
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
			/**
			 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION02:
			 *
			 * `true` when the canonical transport is available
			 * (LocalRuntimeHost). Under Option A, reconstructed
			 * observations are DIAGNOSTIC_ONLY and never mutate
			 * the shadow.
			 *
			 * `false` (HubRuntimeHost / RemoteRuntimeHost) makes
			 * reconstructed observations authoritative via
			 * FALLBACK_APPLY with session/run-scoped dedup.
			 */
			readonly canonicalAvailable: boolean
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
	/**
	 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01:
	 * Optional diagnostic accessor for the six host-ownership facts.
	 * Returns `undefined` when:
	 *   * the host does not implement `captureHostOwnershipFacts?`,
	 *   * the session is not active,
	 *   * the dependency is omitted.
	 *
	 * Read-only; never mutates runtime/session state. Production
	 * projection paths never read the stamped diagnostic.
	 */
	readonly getHostOwnershipFacts?: () => HostOwnershipFactsSnapshot | undefined
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
/**
 * Build the session/run-scoped edge identity used by the fallback
 * dedup gate.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION02:
 *
 * `edgeKeyOf()` produces a globally-unique key for a state edge,
 * but the resolver state is shared across the controller's
 * visible-task lifetime. Without scoping, two unrelated runs of
 * the same visible task (W11/W12 multi-run scenarios) would
 * cross-dedup each other's edges. The scoped identity combines
 * the originating `sessionId` with `runId` (when the runtime
 * event carries one) and the semantic edge key, so cross-session
 * / cross-run observations cannot collide.
 */
function scopedEdgeKey(input: TaskShadowObservationInput): string {
	if (input.kind === "runtime-canonical" || input.kind === "runtime-reconstructed") {
		// Runtime events carry their own snapshot; runId is taken
		// from there. sessionId comes from the originating stream.
		const baseEdge = edgeKeyOf(input.event)
		const runId = input.event.snapshot?.runId
		const sessionPart = input.sessionId
		const runPart = runId ? `:${runId}` : ""
		return `${sessionPart}${runPart}:${baseEdge}`
	}
	// host-task / host-recovery don't go through the dedup gate in
	// the current design, but the helper must be total.
	if (input.kind === "host-task") {
		return `host-task:${input.taskId}:${msgEdgeKey(input.msg.type)}`
	}
	if (input.kind === "host-recovery") {
		return `host-recovery:${input.sessionId}:${msgEdgeKey(input.msg.type)}`
	}
	return "unknown"
}

function msgEdgeKey(msgType: string): string {
	return `msg:${msgType}`
}

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
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01 R6:
 * The previous `activeSessionId` field has been REMOVED. The active
 * session id is read directly from `deps.getActiveSessionId()` (the
 * real `SdkSessionLifecycle.getActiveSession()`) so the resolver
 * never confuses a `taskId` (visible-task identity, host-only) with
 * a `sessionId` (runtime session identity).
 */
interface ResolverState {
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION02:
	 * Set of `scopedEdgeKey()` values already applied under
	 * fallback (canonicalAvailable=false) reconstruction. Cross-
	 * session / cross-run collisions are impossible because
	 * `scopedEdgeKey` includes sessionId + runId.
	 */
	fallbackEdges: Set<string>
	lastAuthority: Record<TaskShadowRuntimeOrigin, ObservationAuthority | undefined>
}

function makeInitialResolverState(): ResolverState {
	return {
		fallbackEdges: new Set(),
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
export function resolveObservationAuthority(
	input: TaskShadowObservationInput,
	state: ResolverState,
	getActiveSessionId: () => string | undefined,
): ObservationAuthority {
	// Rule 1: stale session. The active session id comes from the
	// dep so it tracks the live `SdkSessionLifecycle.getActiveSession()`
	// result rather than only the previously-observed canonical id.
	if (input.kind !== "host-task") {
		const active = getActiveSessionId()
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
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION02:
			//
			// Option A: when canonical transport is available
			// (`canonicalAvailable=true`), RUNTIME_RECONSTRUCTED is
			// DIAGNOSTIC_ONLY. Canonical authority owns runtime truth;
			// reconstructed events cannot duplicate-mutate the shadow.
			// This mirrors the recovery Policy A and eliminates the
			// "reconstructed first, canonical later" double-mutation
			// race entirely.
			//
			// For fallback hosts (Hub/Remote, `canonicalAvailable=false`),
			// reconstructed events ARE authoritative, and dedup is by
			// session/run-scoped edge identity to avoid cross-session
			// collisions in W11/W12 multi-run scenarios.
			if (input.canonicalAvailable) {
				return "DIAGNOSTIC_ONLY"
			}
			// Fallback dedup: scope by session + run + edge.
			const scoped = scopedEdgeKey(input)
			if (state.fallbackEdges.has(scoped)) {
				return "SUPPRESS_DUPLICATE"
			}
			return "FALLBACK_APPLY"
		}
		case "host-task":
			return "APPLY"
		case "host-recovery":
			// R8 (C2.2-CORRECTION01): freeze Policy A. When canonical
			// transport is available, HOST_RECOVERY is
			// DIAGNOSTIC_ONLY — never authoritative. This is simpler
			// than semantic-edge matching (which the implementation
			// does not actually do — `SUPPRESS_DUPLICATE` was
			// applied to every HOST_RECOVERY observation
			// indiscriminately) and prevents any chance of dual
			// authority on recovery state.
			return input.canonicalAvailable ? "DIAGNOSTIC_ONLY" : "FALLBACK_APPLY"
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
		// 1. Resolve authority (handles stale-session check against
		// the live active session id).
		const authority = resolveObservationAuthority(input, state, deps.getActiveSessionId)
		state.lastAuthority[input.origin] = authority

		// R6 (C2.2-CORRECTION01): no internal `activeSessionId` mutation.
		// The active session id always comes from `deps.getActiveSessionId()`
		// (live `SdkSessionLifecycle.getActiveSession()`). Resolver state
		// never holds a session id, so it cannot confuse one with a
		// `taskId`.

		// 2. Branch on authority outcome.
		try {
			switch (authority) {
				case "STALE":
					return
				case "SUPPRESS_DUPLICATE":
					deps.recorder.recordSuppression(input.origin)
					return
				case "DIAGNOSTIC_ONLY":
					// R8 (C2.2-CORRECTION01): HOST_RECOVERY with
					// canonicalAvailable=true is diagnostic-only.
					// Increment a counter so qualification can see
					// the diagnostic volume.
					deps.recorder.recordDiagnosticObservation(input.origin)
					return
				case "FALLBACK_APPLY":
					// C2.3 C23-R2: truth-bound per-origin fallback counters.
					// Both runtime-reconstructed and host-recovery can
					// reach FALLBACK_APPLY when canonicalAvailable=false.
					if (input.origin === "RUNTIME_RECONSTRUCTED") {
						deps.recorder.recordFallbackReconstructedApplied()
					} else if (input.origin === "HOST_RECOVERY") {
						deps.recorder.recordFallbackRecoveryApplied()
					}
					applyAndRecord(input, undefined)
					state.fallbackEdges.add(scopedEdgeKey(input))
					return
				case "APPLY":
					applyAndRecord(input, undefined)
					// Canonical authority always wins; canonical events
					// do not need to be dedup'd against each other
					// (the runtime emits each event exactly once per
					// edge by contract). We still record the canonical
					// edge so a fallback rebuild in the same
					// controller lifetime does not duplicate it.
					if (input.kind === "runtime-canonical") {
						state.fallbackEdges.add(scopedEdgeKey(input))
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
			origin: input.origin,
			divergence,
			observationEvent: observation.event,
			observationLifecycleKind: observation.model.lifecycle.kind,
			observationModel: observation.model,
			observationToolCalls: toolCalls,
			observationRecoveryBudgetFailures: recoveryBudgetFailures,
			taskEpochOrOpaqueTaskKey,
			runtimeStatus: deps.getRuntimeStatus(),
			// ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01:
			// optional diagnostic. Reads through deps.getHostOwnershipFacts?
			// (optional). When the dep is absent / returns undefined / is
			// disabled, the recorder leaves `record.hostOwnershipFacts`
			// undefined. Production projection paths never read it.
			hostOwnershipFacts: deps.getHostOwnershipFacts?.(),
			arbiter,
			classificationOverride: overrideClassification,
			arbitrationOverride: overrideClassification === "D11_HOST_PREENGAGED" ? "BOTH_VALID_DIFFERENT_PROJECTION" : undefined,
		}
		// R4 (C2.2-CORRECTION01): the comparator has already mutated
		// the shadow above. If `recorder.record` throws, the bounded
		// record buffer does not contain this transition — the shadow
		// has advanced without a corresponding record. Surface this
		// explicitly as an EVIDENCE_GAP so qualification can detect
		// the asymmetry. The throw still propagates to the outer
		// catch so the legacy/runtime authority remains unaffected.
		let persisted: ReturnType<typeof deps.recorder.record>
		try {
			persisted = deps.recorder.record(recordInput, observation.violations)
		} catch {
			deps.recorder.recordEvidenceGap()
			throw new Error("EVIDENCE_GAP")
		}

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
			state.fallbackEdges.clear()
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
