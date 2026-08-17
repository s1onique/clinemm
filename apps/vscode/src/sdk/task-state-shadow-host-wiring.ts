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
import { TaskShadowReverseTranslator, type TaskShadowReverseTranslatorInput } from "./task-state-shadow-observer"

const { TaskStateShadow } = TaskState
type TaskStateShadow = TaskState.TaskStateShadow

import {
	type ArbiterSnapshot,
	MAX_RECORDS_PER_TASK,
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
 * origin marker for canonical runtime events at the shadow boundary.
 * Only `RUNTIME_CANONICAL` is in use in F1; C2.2 will add the
 * remaining values (e.g. `RUNTIME_RECONSTRUCTED`, `HOST_TASK`,
 * `HOST_RECOVERY`) when it unifies the observation surface.
 */
export type TaskShadowRuntimeOrigin = "RUNTIME_CANONICAL"

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
}

/**
 * Extended host-only sink surface. Adds the comparator and shadow
 * instance handles so the host can emit `task_requested` /
 * `task_cancelled` / `task_reset` / `same_task_continued` TaskMsgs
 * directly into the shadow (the runtime cannot provide these
 * events). The comparator and shadow are exposed read-only; the
 * only mutation path is through the emit helpers in
 * `task-state-shadow-host-msgs.ts`.
 */
export interface TaskShadowHostWiringWithSink extends TaskShadowHostWiring {
	readonly comparator: TaskShadowComparator
	readonly shadow: TaskStateShadow
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
	const shadow = new TaskStateShadow()
	// The comparator owns a private shadow; we mirror its `observeTaskMsg`
	// path through the comparator so the host-only emit helpers feed
	// the same recorder. The shadow exposed here is the comparator's
	// internal one — kept for read-only debug/test access.
	const recorder = new TaskShadowRecorder((record, violations) => {
		if (deps.onInvariantViolation) {
			try {
				deps.onInvariantViolation(record, violations)
			} catch {
				/* Observation-only — never throw. */
			}
		}
	})

	// Mirror the existing `onSessionEvent` hook without replacing it.
	// SdkSessionLifecycle reads `options.onSessionEvent` lazily inside
	// `ensureSharedHostSubscription`, so wrapping it here before the
	// lifecycle is constructed takes effect at first event.
	const userOnSessionEvent = deps.sessionOptions.onSessionEvent
	const wrappedOnSessionEvent = (event: CoreSessionEvent) => {
		try {
			observeLegacyEvent(event, deps, translator, comparator, recorder)
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
		shadow,
		now: deps.now,
		observeCanonicalRuntimeEvent(input: TaskShadowCanonicalEvent): void {
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1:
			// narrow bridge from the canonical `AgentRuntimeEvent` seam
			// into the shadow comparator AND recorder. Origin is checked
			// explicitly (not via implicit inference) so that C2.2 can
			// introduce additional origin values without ambiguity.
			if (input.origin !== "RUNTIME_CANONICAL") {
				/* F1 only knows RUNTIME_CANONICAL; future origins land here. */
				return
			}
			const now = deps.now()
			const legacyPhase = deps.getLegacyPhase()
			const arbiter = deps.getArbiterSnapshot()
			const activeSession = deps.lifecycle.getActiveSession()
			const taskEpochOrOpaqueTaskKey = activeSession?.sessionId
			const runtimeStatus = deps.getRuntimeStatus?.()
			try {
				const observation = comparator.observeRuntimeEvent(input.event, legacyPhase, now)
				const model = observation.observation.model
				if (!model) {
					/* No-op shadow observation; nothing to record. */
					return
				}
				const toolCalls = observation.observation.projections.toolCalls ?? 0
				const recoveryBudgetFailures = observation.observation.projections.recoveryBudgetFailures ?? 0
				recorder.record(
					{
						seq: 0,
						timestamp: now,
						divergence: observation.divergence,
						observationEvent: observation.observation.event,
						observationLifecycleKind: model.lifecycle.kind,
						observationModel: model,
						observationToolCalls: toolCalls,
						observationRecoveryBudgetFailures: recoveryBudgetFailures,
						taskEpochOrOpaqueTaskKey,
						runtimeStatus,
						arbiter,
					},
					observation.observation.violations,
				)
			} catch {
				/* Observation-only — never throw into production paths. */
			}
		},
		resetForNewTask(): void {
			translator.debugReset()
			comparator.debugReset()
			recorder.debugReset()
		},
		dispose(): void {
			deps.sessionOptions.onSessionEvent = userOnSessionEvent
		},
	}
}

function createNoopWiring(): TaskShadowHostWiringWithSink {
	const recorder = new TaskShadowRecorder()
	return {
		recorder,
		recorderCounts: () => recorder.getCounts(),
		records: () => recorder.getRecords(),
		comparator: new TaskShadowComparator(),
		shadow: new TaskStateShadow(),
		now: () => Date.now(),
		observeCanonicalRuntimeEvent(_input: TaskShadowCanonicalEvent): void {
			/* No-op: wiring disabled by env flag. */
		},
		resetForNewTask: () => {
			recorder.debugReset()
		},
		dispose: () => {},
	}
}

function observeLegacyEvent(
	event: CoreSessionEvent,
	deps: TaskShadowHostWiringDeps,
	translator: TaskShadowReverseTranslator,
	comparator: TaskShadowComparator,
	recorder: TaskShadowRecorder,
): void {
	const now = deps.now()
	const legacyPhase = deps.getLegacyPhase()
	const arbiter = deps.getArbiterSnapshot()
	const previousExecution = translator.getPreviousExecution()
	const runtimeStatus = deps.getRuntimeStatus?.()
	const activeSession = deps.lifecycle.getActiveSession()
	const taskEpochOrOpaqueTaskKey = activeSession?.sessionId
	const input: TaskShadowReverseTranslatorInput = {
		event,
		now,
		legacyPhase,
		arbiter,
		previousExecution,
		taskEpochOrOpaqueTaskKey,
		runtimeStatus,
	}
	const output = translator.observe(input, comparator)
	const violations = output.observation?.violations ?? []
	const observationModel = output.observation?.model
	if (!observationModel) return
	recorder.record(
		{
			seq: 0,
			timestamp: now,
			divergence: output.divergence,
			observationEvent: output.observationEvent,
			observationLifecycleKind: output.observation?.model.lifecycle.kind ?? "idle",
			observationModel,
			observationToolCalls: output.toolCalls,
			observationRecoveryBudgetFailures: output.recoveryBudgetFailures,
			taskEpochOrOpaqueTaskKey,
			runtimeStatus,
			arbiter,
		},
		violations,
	)
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
