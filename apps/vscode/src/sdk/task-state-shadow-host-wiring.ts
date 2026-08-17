/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 15 — Host-side wiring.
 *
 * Owns the lifetime of one `TaskShadowReverseTranslator` + one
 * `TaskShadowComparator` + one `TaskShadowRecorder`. Subscribes to
 * the existing `SdkSessionLifecycle.onSessionEvent` /
 * `onToolStarted` / `onDidBecomeIdle` / `onSendStart` / `onSendError`
 * hooks to receive the legacy `CoreSessionEvent` stream, samples
 * the legacy `TurnStateTracker.currentPhase` synchronously at each
 * observation, and feeds everything into the recorder.
 *
 * CONSERVATION
 * ------------
 * - Reads: `TurnStateTracker.currentPhase` (synchronous observation).
 * - Writes: NONE.
 *
 * The host wiring NEVER calls:
 *   - `TurnStateTracker.set`
 *   - `postStateToWebview`
 *   - `requestToolApproval` / `approve` / `deny`
 *   - `agent.subscribeEvents`
 *
 * This module is OBSERVATION-ONLY. Production authority remains 100%
 * on the legacy path. EFFECT_EXECUTION_ENABLED is FALSE.
 */

import { TaskState } from "@cline/agents"
import type { CoreSessionEvent } from "@cline/core"
import type { AgentRunStatus, AgentRuntimeEvent, AgentRuntimeExecutionState, RecoveryState } from "@cline/shared"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { SdkSessionLifecycle, SdkSessionLifecycleOptions } from "./sdk-session-lifecycle"
import { TaskShadowComparator } from "./task-state-shadow"
import { createTaskShadowObservationCoordinator, type TaskShadowCoordinator } from "./task-state-shadow-coordinator"
import { TaskShadowReverseTranslator, type TaskShadowReverseTranslatorInput } from "./task-state-shadow-observer"

const { TaskStateShadow: _TaskStateShadow } = TaskState
// R2 (C2.2-CORRECTION01): the comparator owns a private TaskStateShadow
// exclusively. The wiring exposes that shadow via `comparator.debugSnapshot()`,
// so the public `shadow` handle is removed. See `TaskShadowComparator`.
// The local `_TaskStateShadow` alias is retained so the no-op wiring
// branch can still construct one internally for the (test-only)
// debugSnapshot escape hatch if needed in the future; today it is not.
type _TaskStateShadowRetired = TaskState.TaskStateShadow

import {
	type ArbiterSnapshot,
	MAX_RECORDS_PER_TASK,
	type TaskInvariantViolation,
	TaskShadowDifferentialRecord,
	TaskShadowRecorder,
	TaskShadowRecorderCounts,
} from "./task-state-shadow-recorder"

/**
 * E5-E6 internal dev/debug flag. Default ON; opt-out via env var.
 *
 *   CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = "0"  →  wiring disabled
 *
 * When disabled, `createTaskShadowHostWiring` returns a stub that
 * accepts lifecycle hooks without recording.
 */
const ENV_FLAG = "CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL"
const DEFAULT_ENABLED = true

function isWiringEnabled(): boolean {
	const v = process.env[ENV_FLAG]
	if (v === undefined || v === "") return DEFAULT_ENABLED
	return v !== "0" && v.toLowerCase() !== "false" && v !== "off"
}

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1:
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2:
 *
 * Origin marker for observation ingresses at the shadow boundary.
 * Every state-mutating ingress MUST tag its origin explicitly; the
 * unified `TaskShadowObservationCoordinator` is the only entity that
 * may assign an authority decision based on the origin.
 *
 *   RUNTIME_CANONICAL    — AgentRuntimeEvent from LocalRuntimeHost
 *                          (F1 canonical seam, qualified).
 *   RUNTIME_RECONSTRUCTED — AgentRuntimeEvent-shaped approximation
 *                          translated from a legacy CoreSessionEvent
 *                          by `TaskShadowReverseTranslator`. Used for
 *                          tool lifecycle / run lifecycle when canonical
 *                          authority is unavailable; suppressed when
 *                          canonical authority exists for the same edge.
 *   HOST_TASK            — visible-task identity event (task_requested,
 *                          task_reset, task_cancelled, same_task_continued).
 *                          Host-only; no canonical equivalent.
 *   HOST_RECOVERY        — recovery projection translated from a legacy
 *                          `notice(reason)` envelope. Fallback-only;
 *                          suppressed when canonical recovery is
 *                          available.
 */
export type TaskShadowRuntimeOrigin = "RUNTIME_CANONICAL" | "RUNTIME_RECONSTRUCTED" | "HOST_TASK" | "HOST_RECOVERY"

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1:
 * typed envelope for canonical events at the shadow boundary.
 * The `origin` field is required so that future observation
 * pathways (C2.2) can be distinguished unambiguously.
 */
export interface TaskShadowCanonicalEvent {
	readonly origin: TaskShadowRuntimeOrigin
	readonly sessionId: string
	readonly event: AgentRuntimeEvent
}

/**
 * Public surface of the live shadow wiring. The controller owns one
 * instance for the duration of its visible-task lifetime.
 */
export interface TaskShadowHostWiring {
	readonly recorder: TaskShadowRecorder
	readonly recorderCounts: () => TaskShadowRecorderCounts
	readonly records: () => readonly TaskShadowDifferentialRecord[]
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1:
	 * narrow bridge for the canonical `AgentRuntimeEvent` seam. The
	 * controller calls this from `attachCanonicalRuntimeEventSubscription`
	 * after it subscribes via `VscodeSessionHost.subscribeRuntimeEvents`.
	 *
	 * Observation-only: does not influence recovery, tool execution,
	 * approval, or task scheduling. The wiring's `dispose()` cleans
	 * up any state set by this method.
	 */
	observeCanonicalRuntimeEvent(input: TaskShadowCanonicalEvent): void
	resetForNewTask(): void
	dispose(): void
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2:
	 * The unified observation coordinator. The single ingress point
	 * for every state-mutating observation (canonical, reconstructed,
	 * host-task, host-recovery). Production code MUST funnel every
	 * observation through this object.
	 */
	readonly coordinator: TaskShadowCoordinator
}

/**
 * Extended host-only sink surface. Adds the comparator handle so
 * the host can emit `task_requested` / `task_cancelled` /
 * `task_reset` / `same_task_continued` TaskMsgs into the shadow via
 * the unified coordinator (the runtime cannot provide these
 * events). The comparator is exposed read-only; the only mutation
 * path is through the coordinator / emit helpers in
 * `task-state-shadow-host-msgs.ts`.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01 R2:
 * The previous `shadow` handle has been REMOVED. The comparator owns
 * exactly one `TaskStateShadow` internally; for read-only inspection
 * use `comparator.debugSnapshot()`.
 */
export interface TaskShadowHostWiringWithSink extends TaskShadowHostWiring {
	readonly comparator: TaskShadowComparator
	readonly now: () => number
}

/**
 * Build the live shadow wiring and bind it to the existing
 * `SdkSessionLifecycle` hooks. Returns a no-op wiring when the env
 * flag disables it.
 *
 * `getLegacyPhase` samples the legacy turn phase synchronously. The
 * wiring assumes the caller has a `TurnStateTracker` reachable.
 *
 * `getArbiterSnapshot` reads the canonical arbiter facts the
 * recorder needs to classify / arbitrate each comparison. The host
 * supplies these from `AgentRuntime.snapshot()` (or a substitute —
 * for tests, a static fixture).
 *
 * `getRuntimeStatus` is optional; when undefined the wiring falls
 * back to `running`.
 */
export interface TaskShadowHostWiringDeps {
	readonly lifecycle: Pick<SdkSessionLifecycle, "getActiveSession" | "setRunning">
	readonly sessionOptions: SdkSessionLifecycleOptions
	readonly getLegacyPhase: () => TurnPhase
	readonly getArbiterSnapshot: () => ArbiterSnapshot
	/**
	 * C3.CONT.0-CORRECTION01 R2: production ingress for the
	 * canonical-runtime-availability decision. Returns true when
	 * the canonical `AgentRuntimeEvent` stream is reachable
	 * (LocalRuntimeHost production path). Returns false when the
	 * host only sees reconstructed legacy envelopes (Hub/Remote
	 * fallback paths), in which case reconstructed observations
	 * are authoritative via FALLBACK_APPLY.
	 *
	 * Defaults to true when absent — preserves existing
	 * production behavior. Hosts that need fallback semantics
	 * MUST provide this dependency.
	 */
	readonly getCanonicalRuntimeAvailable?: () => boolean
	readonly getRuntimeStatus?: () => AgentRunStatus
	readonly now: () => number
	readonly onInvariantViolation?: (record: TaskShadowDifferentialRecord, violations: readonly unknown[]) => void
}

export function createTaskShadowHostWiring(deps: TaskShadowHostWiringDeps): TaskShadowHostWiringWithSink {
	if (!isWiringEnabled()) {
		return createNoopWiring()
	}
	const translator = new TaskShadowReverseTranslator()
	const comparator = new TaskShadowComparator()
	// R2 (C2.2-CORRECTION01): the wiring owns exactly ONE shadow
	// — the one inside the comparator. There is no `new TaskStateShadow()`
	// here. Read-only access goes through `comparator.debugSnapshot()`.
	const recorder = new TaskShadowRecorder((record, violations) => {
		if (deps.onInvariantViolation) {
			try {
				deps.onInvariantViolation(record, violations)
			} catch {
				/* Observation-only — never throw. */
			}
		}
	})

	// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2:
	// The unified observation coordinator is the single ingress point
	// for every state-mutating observation. The wiring owns exactly
	// one instance for the controller's visible-task lifetime.
	const coordinator: TaskShadowCoordinator = createTaskShadowObservationCoordinator({
		comparator,
		recorder,
		now: deps.now,
		getLegacyPhase: deps.getLegacyPhase,
		getArbiterSnapshot: deps.getArbiterSnapshot,
		getActiveSessionId: () => deps.lifecycle.getActiveSession()?.sessionId,
		getRuntimeStatus: () => deps.getRuntimeStatus?.() ?? "idle",
		onInvariantViolation: (record, violations) => {
			if (deps.onInvariantViolation && record) {
				try {
					deps.onInvariantViolation(record, violations as readonly TaskInvariantViolation[])
				} catch {
					/* Observation-only — never throw. */
				}
			}
		},
	})

	// Mirror the existing `onSessionEvent` hook without replacing it.
	// SdkSessionLifecycle reads `options.onSessionEvent` lazily inside
	// `ensureSharedHostSubscription`, so wrapping it here before the
	// lifecycle is constructed takes effect at first event.
	const userOnSessionEvent = deps.sessionOptions.onSessionEvent
	const wrappedOnSessionEvent = (event: CoreSessionEvent) => {
		try {
			observeLegacyEvent(event, deps, translator, comparator, coordinator)
		} catch {
			/* Observation-only — never throw into production paths. */
		}
		userOnSessionEvent(event)
	}
	deps.sessionOptions.onSessionEvent = wrappedOnSessionEvent

	return {
		recorder,
		recorderCounts: () => recorder.getCounts(),
		records: () => recorder.getRecords(),
		comparator,
		now: deps.now,
		coordinator,
		observeCanonicalRuntimeEvent(input: TaskShadowCanonicalEvent): void {
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2:
			// narrow bridge from the canonical `AgentRuntimeEvent` seam
			// into the unified observation coordinator. All four
			// ingress kinds funnel through the coordinator; this is
			// just the canonical-event wrapper.
			const origin = input.origin as "RUNTIME_CANONICAL"
			coordinator.observe({
				kind: "runtime-canonical",
				origin,
				sessionId: input.sessionId,
				event: input.event,
			})
		},
		resetForNewTask(): void {
			translator.debugReset()
			comparator.debugReset()
			recorder.debugReset()
			coordinator.debugReset()
		},
		dispose(): void {
			deps.sessionOptions.onSessionEvent = userOnSessionEvent
		},
	}
}

function createNoopWiring(): TaskShadowHostWiringWithSink {
	const recorder = new TaskShadowRecorder()
	const noopComparator = new TaskShadowComparator()
	const noopCoordinator: TaskShadowCoordinator = createTaskShadowObservationCoordinator({
		comparator: noopComparator,
		recorder,
		now: () => Date.now(),
		getLegacyPhase: () => "idle",
		getArbiterSnapshot: () => emptyArbiterSnapshot(),
		getActiveSessionId: () => undefined,
		getRuntimeStatus: () => "idle",
	})
	return {
		recorder,
		recorderCounts: () => recorder.getCounts(),
		records: () => recorder.getRecords(),
		comparator: noopComparator,
		now: () => Date.now(),
		coordinator: noopCoordinator,
		observeCanonicalRuntimeEvent(_input: TaskShadowCanonicalEvent): void {
			/* No-op: wiring disabled by env flag. */
		},
		resetForNewTask: () => {
			recorder.debugReset()
			noopCoordinator.debugReset()
		},
		dispose: () => {},
	}
}

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01:
 *
 * Extract the **source** session id from a legacy `CoreSessionEvent`.
 * Per C2.2-CORRECTION01 R3, reconstructed events must propagate the
 * id of the session that actually emitted the event — not the
 * currently active session. Identity laundering across session
 * boundaries defeats the stale-session gate.
 *
 * Only `agent_event` carries a `payload.sessionId`. Other legacy
 * envelopes (chunk, team_progress, snapshot, ended, pending_*) are
 * not state-mutating for the shadow and fall through as `undefined`.
 */
function extractLegacyEventSessionId(event: CoreSessionEvent): string | undefined {
	if (event.type === "agent_event") {
		const payload = (event as { payload?: { sessionId?: string } }).payload
		if (payload && typeof payload.sessionId === "string") {
			return payload.sessionId
		}
	}
	return undefined
}

function observeLegacyEvent(
	event: CoreSessionEvent,
	deps: TaskShadowHostWiringDeps,
	translator: TaskShadowReverseTranslator,
	comparator: TaskShadowComparator,
	coordinator: TaskShadowCoordinator,
): void {
	void comparator
	const now = deps.now()
	const legacyPhase = deps.getLegacyPhase()
	const arbiter = deps.getArbiterSnapshot()
	const previousExecution = translator.getPreviousExecution()
	const runtimeStatus = deps.getRuntimeStatus?.()
	const activeSession = deps.lifecycle.getActiveSession()
	const activeSessionId = activeSession?.sessionId
	const input: TaskShadowReverseTranslatorInput = {
		event,
		now,
		legacyPhase,
		arbiter,
		previousExecution,
		taskEpochOrOpaqueTaskKey: activeSessionId,
		runtimeStatus,
	}
	// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01 R1:
	//
	// Use the NON-MUTATING `translate()` API. The translator updates
	// its internal state (`previousExecution`, `lastRecoveryState`,
	// `activeRunId`) but does NOT touch the comparator. The
	// coordinator is the ONLY entity that decides whether the
	// reconstructed event mutates the shadow.
	const runtimeEvent = translator.translate(input)
	if (!runtimeEvent) {
		// No reconstructed event (presentation-only legacy envelope
		// that does not map to a state-mutating edge). The translator
		// still updated its internal state for the next call.
		return
	}
	// R3: propagate the SOURCE session id from the legacy envelope.
	// If the legacy event carries no `payload.sessionId`, fall back
	// to the active session id (the event arrived from this session's
	// stream by construction). Never fabricate `"unknown"` — that
	// would let stale envelopes sneak past the coordinator's stale
	// gate.
	const sourceSessionId = extractLegacyEventSessionId(event) ?? activeSessionId
	if (!sourceSessionId) {
		// No session id resolvable — refuse to relay a reconstructed
		// observation that cannot be session-scoped. Counts as a
		// session-id-missing diagnostic.
		return
	}
	coordinator.observe({
		kind: "runtime-reconstructed",
		origin: "RUNTIME_RECONSTRUCTED",
		sessionId: sourceSessionId,
		event: runtimeEvent,
		// C3.CONT.0-CORRECTION01 R2: the wiring now resolves
		// canonical-runtime availability from the host-supplied
		// dependency (LocalRuntimeHost = true; Hub/Remote = false).
		// Defaults to true to preserve existing production behavior.
		// This is the single production decision authority for
		// DIAGNOSTIC_ONLY vs FALLBACK_APPLY under the legacy ingress.
		canonicalAvailable: deps.getCanonicalRuntimeAvailable?.() ?? true,
	})
}

/**
 * Re-export the arbiter shape for downstream consumers.
 */
export type { ArbiterSnapshot, TaskShadowRecorderCounts, TaskShadowDifferentialRecord }
export { MAX_RECORDS_PER_TASK }

/**
 * Test-only helper. Construct an empty `ArbiterSnapshot` suitable
 * for unit tests of the recorder / classifier.
 */
export function emptyArbiterSnapshot(): ArbiterSnapshot {
	return {
		execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		recoveryState: "idle",
		status: "idle",
		pendingToolCalls: [],
	}
}

// Suppress unused-import diagnostics for ambient type re-exports
// that downstream consumers reach for but this module does not name
// directly.
void (null as unknown as AgentRuntimeExecutionState)
void (null as unknown as RecoveryState)
void (null as unknown as AgentRunStatus)
