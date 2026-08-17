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
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.2-CORRECTION04:
	 *
	 * Fences the canonical run-epoch terminal gate for the
	 * continuation-before-next-run-start window. Called by
	 * `SdkController` adjacent to `emitSameTaskContinued` when a
	 * follow-up resumes the SAME visible task after a terminal
	 * phase (completed / awaiting_followup / resumable / error).
	 *
	 * While fenced, any canonical `run-finished` / `run-failed`
	 * event arriving for the retired run identity is SUPPRESSED
	 * — even if its `snapshot.runId` matches the now-retired
	 * `canonicalRunId` — until the next accepted canonical
	 * `run-started` (or the fence is cleared by `resetForNewTask`).
	 *
	 * The fence is cleared on:
	 *   - the next accepted canonical `run-started` (new run begins)
	 *   - `resetForNewTask()` (a new visible task starts)
	 *   - `dispose()` (wiring is torn down)
	 *
	 * Observation-only: does not influence recovery, tool
	 * execution, approval, or task scheduling.
	 */
	fenceCanonicalRunForContinuation(): void
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

	// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.2-CORRECTION03:
	// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.2-CORRECTION04:
	// CANONICAL RUN-EPOCH TERMINAL OWNERSHIP GATE.
	//
	// CONT.2-CORRECTION02 closed the same race on the reconstructed
	// (legacy) ingress via TaskShadowReverseTranslator. But on
	// LocalRuntimeHost (canonicalAvailable=true) the *authoritative*
	// path is RUNTIME_CANONICAL, which BYPASSES the translator and
	// reaches the shadow-adapter directly. Without an equivalent
	// gate on the canonical side, a stranded canonical run-finished /
	// run-failed from a cancelled epoch that arrives AFTER
	// same_task_continued would still reach the reducer and could
	// terminate the resumed run.
	//
	// The canonical surface carries explicit `snapshot.runId`
	// provenance on every event. The wiring tracks the
	// `canonicalRunId` from the most recent canonical `run-started`
	// event. Terminal canonical events (`run-finished`,
	// `run-failed`) with a `snapshot.runId` that does NOT match
	// the tracked `canonicalRunId` are SUPPRESSED before they
	// reach the coordinator — they neither feed the shadow nor
	// feed the recorder.
	//
	// Policy (frozen, ALL clauses must hold):
	//   R1 session authority (BEFORE any other check):
	//     activeSession set && activeSession.sessionId !== input.sessionId
	//       → REFUSE (no tracker mutation; no diagnostic counter — the
	//         coordinator already counted cross-session STALE).
	//
	//   For run-finished / run-failed (terminal events):
	//     stranded =
	//         (fenced && event.runId === retiredCanonicalRunId)   // R2
	//      || (activeRunId defined && event.runId !== activeRunId) // identity mismatch
	//     if stranded → SUPPRESS + increment staleRunTerminalSuppressed.
	//
	//     Concrete truth table (the implementation is STRICTER than
	//     a naive "fence only suppresses retired ID" reading):
	//       fence=true,  active=A, terminal=A → SUPPRESS (R2)
	//       fence=true,  active=A, terminal=B → SUPPRESS (identity mismatch)
	//       fence=true,  active=A, terminal=undef → SUPPRESS (identity mismatch, undef != A)
	//       fence=true,  active=undef, terminal=undef → SUPPRESS (R2 + identity)
	//       fence=true,  active=undef, terminal=B   → apply (no retired identity known)
	//       fence=false, active=A, terminal=A → apply
	//       fence=false, active=A, terminal=B → SUPPRESS (identity mismatch)
	//       fence=false, active=undef, terminal=undef → apply (very first event)
	//       fence=false, active=undef, terminal=B → apply (transient)
	//
	//   Note: the fence=true + active=undef case is the
	//   `C23-HARDEN-1` carry-forward — currently a defined-runId
	//   terminal would pass while fenced. In normal Local runtime
	//   observed orderings run-started precedes run-finished, so
	//   this is unreachable in practice; qualifiy explicitly in C2.4.
	//
	//   Tracker update (only for accepted events):
	//     run-started && snapshot.runId defined
	//       → canonicalRunIdRef = snapshot.runId
	//       → awaitingNextCanonicalRunRef = false
	//
	//   The fence is cleared by:
	//     - accepted canonical run-started (above)
	//     - resetForNewTask()
	//     - dispose()
	//
	// R3 fix (C3.CONT.2-CORRECTION04): every suppressed stranded
	// canonical terminal increments `staleRunTerminalSuppressed`
	// on the recorder, so dogfood can distinguish
	//   "no stranded events occurred" from
	//   "17 stranded events were silently dropped".
	// This is a DIAGNOSTIC counter, not a divergence class —
	// suppression is correct behavior, but dogfood needs the
	// signal to detect chronic suppression as a runtime bug.
	const canonicalRunIdRef: { value: string | undefined } = { value: undefined }
	const awaitingNextCanonicalRunRef: { value: boolean } = { value: false }

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
			//
			// C3.CONT.2-CORRECTION03: enforce canonical run-epoch
			// terminal ownership BEFORE handing off to the coordinator.
			// On LocalRuntimeHost, canonical events own TaskState truth
			// — the reconstructed translator gate (CORRECTION02) does
			// not see them at all.
			//
			// C3.CONT.2-CORRECTION04 R1: validate session authority
			// FIRST. A canonical event from a stale session must NOT
			// mutate the run tracker; only accepted-session events
			// advance it. This prevents a late stale-session
			// run-started from poisoning canonicalRunIdRef.
			const evt = input.event
			const activeSession = deps.lifecycle.getActiveSession()
			if (activeSession && activeSession.sessionId !== input.sessionId) {
				// Cross-session canonical event. The coordinator
				// would classify this as STALE and refuse it. Do
				// not advance the tracker.
				return
			}

			// C3.CONT.2-CORRECTION04 R2 + R3: terminal canonical
			// events are SUPPRESSED if EITHER (a) the continuation
			// fence is set AND the event's runId matches the
			// retired identity, OR (b) the tracked active runId is
			// defined and the event's runId does not match it.
			// The disjunction is intentionally OR, not AND — while
			// fenced, defined-runId terminals are uniformly
			// suppressed regardless of identity equality, because
			// at this window the previous identity is retired and
			// the next run-started has not yet advanced the
			// tracker. See the gate's truth table at the top of
			// this file for the full enumeration. Any suppression
			// increments `staleRunTerminalSuppressed` so dogfood
			// can observe chronic suppression.
			if (evt.type === "run-finished" || evt.type === "run-failed") {
				const eventRunId = evt.snapshot.runId
				const active = canonicalRunIdRef.value
				const stranded =
					(awaitingNextCanonicalRunRef.value &&
						eventRunId !== undefined &&
						active !== undefined &&
						eventRunId === active) ||
					(active !== undefined && eventRunId !== undefined && active !== eventRunId)
				if (stranded) {
					recorder.recordStaleRunTerminalSuppressed?.()
					return
				}
			}

			// Tracker update only happens AFTER session + run-epoch
			// validation. The only accepted canonical run-started
			// events advance canonicalRunIdRef and clear the fence.
			if (evt.type === "run-started") {
				const newRunId = evt.snapshot.runId
				if (newRunId !== undefined) {
					canonicalRunIdRef.value = newRunId
					awaitingNextCanonicalRunRef.value = false
				}
			}

			const origin = input.origin as "RUNTIME_CANONICAL"
			coordinator.observe({
				kind: "runtime-canonical",
				origin,
				sessionId: input.sessionId,
				event: input.event,
			})
		},
		fenceCanonicalRunForContinuation(): void {
			// C3.CONT.2-CORRECTION04 R2: same_task_continued has
			// fired. The previous run identity (canonicalRunId)
			// is now RETIRED. Any canonical terminal whose
			// snapshot.runId matches the retired identity will be
			// suppressed until the next accepted canonical
			// run-started announces the new run. Until that
			// run-started arrives, the resumed task's lifecycle
			// stays "running" — it cannot be poisoned by a late
			// run-finished/run-failed from the previous run.
			awaitingNextCanonicalRunRef.value = true
		},
		resetForNewTask(): void {
			translator.debugReset()
			comparator.debugReset()
			recorder.debugReset()
			coordinator.debugReset()
			// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.2-CORRECTION03:
			// Clear the canonical run-epoch identity alongside
			// the translator's activeRunId. A new visible task
			// gets a fresh epoch.
			canonicalRunIdRef.value = undefined
			// C3.CONT.2-CORRECTION04 R2: clear the
			// continuation fence too. A new visible task starts
			// with no awaited-continuation state.
			awaitingNextCanonicalRunRef.value = false
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
		fenceCanonicalRunForContinuation: () => {
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
