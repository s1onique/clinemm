/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 14 — Differential comparator.
 *
 * The comparator lives at the host boundary. It owns a `TaskStateShadow`
 * (private), subscribes to the runtime event stream, and records
 * divergences between the shadow's `projectTurnState` and the legacy
 * `TurnStateTracker.currentPhase`. The comparator MUST NOT:
 *
 *   - call `TurnStateTracker.set()`
 *   - call `postStateToWebview()`
 *   - execute tools, approve / deny, or alter recovery
 *   - mutate the runtime state in any way
 *
 * It is observation-only. The recorded divergences are typed and
 * privacy-safe (ELM10).
 *
 * Phase 15 (DIVERGENCE_ACTION = RECORD_ONLY): no correction is
 * attempted during shadow mode.
 */

import { TaskState } from "@cline/agents"
import type { AgentRuntimeEvent } from "@cline/shared"
import type { TurnPhase } from "@/shared/ExtensionMessage"

// Mirror the established pattern in `task-state-shadow-recorder.ts`:
// `TaskState` is the namespace re-export from `@cline/agents`; its
// `TaskModel` member is not promoted to a top-level package export.
type TaskModel = TaskState.TaskModel

const { TaskStateShadow } = TaskState
type TaskMsg = TaskState.TaskMsg
type TaskShadowObservation = TaskState.TaskShadowObservation

/**
 * Phase mapping: shadow `ShadowTurnPhase` -> legacy `TurnPhase`.
 *
 * The shadow taxonomy is intentionally identical to the legacy
 * `TurnPhase` taxonomy. They are deliberately so: the only divergence
 * the comparator records is when the two diverge on the SAME axis.
 */
/**
 * Phase mapping: shadow `ShadowTurnPhase` -> legacy `TurnPhase`.
 *
 * The shadow taxonomy is intentionally identical to the legacy
 * `TurnPhase` taxonomy on the overlap (Phase 14 design rule). The
 * legacy taxonomy adds ONE host-only phase — `"compacting"` — owned
 * by the compaction coordinator, never produced by the shadow. This
 * map therefore is an exhaustive identity on the overlap; the
 * `"compacting"` member exists in `TurnPhase` only so the union
 * remains closed for downstream consumers (selectors, webview).
 *
 * Exported so the host wiring's `getLastObservedShadowPhase`
 * accessor can delegate to the canonical `@cline/agents`
 * `projectTurnState` projection and then run the shadow→legacy
 * bridge without duplicating either piece of authority.
 */
export function toLegacyPhase(s: TaskShadowObservation["projections"]["turnPhase"]): TurnPhase {
	switch (s) {
		case "idle":
			return "idle"
		case "streaming":
			return "streaming"
		case "awaiting_approval":
			return "awaiting_approval"
		case "awaiting_followup":
			return "awaiting_followup"
		case "completed":
			return "completed"
		case "error":
			return "error"
		case "resumable":
			return "resumable"
		default: {
			const exhaustive: never = s
			void exhaustive
			return "idle"
		}
	}
}

/**
 * Single divergence record. Strict privacy (ELM10): event kind, both
 * phase labels, lifecycle tags, monotonic seq — nothing more.
 */
export interface TaskShadowDivergence {
	readonly seq: number
	readonly event: TaskMsg["type"] | "noop"
	readonly legacyPhase: TurnPhase
	readonly shadowPhase: TurnPhase
	readonly lifecycleKind: string
	readonly modelStreaming: boolean
	/**
	 * Derived boolean: `activeToolCallIds.length > 0`. Kept as a
	 * named field on the divergence record so the host test stays
	 * readable. The shadow's projection (selectors.isTooling) is
	 * the single source of truth.
	 */
	readonly tooling: boolean
	readonly awaitingApproval: boolean
}

/**
 * Comparator. Owns a private shadow and records divergences as a
 * bounded ring buffer (the legacy WebView consumers don't see this).
 *
 * Phase 15: divergence_action = "RECORD_ONLY". No correction.
 */
export class TaskShadowComparator {
	private readonly shadow = new TaskStateShadow()
	private readonly legacyPhases: TurnPhase[] = []
	private readonly divergences: TaskShadowDivergence[] = []
	private seq = 0

	/**
	 * Feed a runtime event through the shadow and compare against the
	 * legacy phase observed at that instant. Returns the recorded
	 * divergence (if any) and the shadow observation.
	 */
	observeRuntimeEvent(
		event: AgentRuntimeEvent,
		legacyPhase: TurnPhase,
		now: number,
	): { readonly observation: TaskShadowObservation; readonly divergence: TaskShadowDivergence | undefined } {
		const observation = this.shadow.observeRuntimeEvent(event, now) ?? this.shadow.noop(now)
		return this.compareWith(observation, legacyPhase, observation.event)
	}

	/**
	 * Feed a `TaskMsg` directly (used by tests; production goes through
	 * `observeRuntimeEvent`).
	 */
	observeTaskMsg(
		msg: TaskMsg,
		legacyPhase: TurnPhase,
		now: number,
	): { readonly observation: TaskShadowObservation; readonly divergence: TaskShadowDivergence | undefined } {
		const observation = this.shadow.observe(msg, now)
		return this.compareWith(observation, legacyPhase, msg.type)
	}

	private compareWith(
		observation: TaskShadowObservation,
		legacyPhase: TurnPhase,
		event: TaskMsg["type"] | "noop",
	): { readonly observation: TaskShadowObservation; readonly divergence: TaskShadowDivergence | undefined } {
		this.seq += 1
		this.legacyPhases.push(legacyPhase)
		const shadowPhase = toLegacyPhase(observation.projections.turnPhase)
		if (shadowPhase !== legacyPhase) {
			const divergence: TaskShadowDivergence = {
				seq: this.seq,
				event,
				legacyPhase,
				shadowPhase,
				lifecycleKind: observation.model.lifecycle.kind,
				modelStreaming: observation.model.activity.modelStreaming,
				tooling: observation.model.activity.activeToolCallIds.length > 0,
				awaitingApproval: observation.model.activity.awaitingApproval,
			}
			this.divergences.push(divergence)
			return { observation, divergence }
		}
		return { observation, divergence: undefined }
	}

	/**
	 * Recorded divergences so far. The comparator never reads this from
	 * production code paths — it exists for tests and the debug hook.
	 */
	getDivergences(): readonly TaskShadowDivergence[] {
		return this.divergences
	}

	/**
	 * For tests only: reset the comparator back to a clean state.
	 */
	debugReset(): void {
		this.shadow.debugReset()
		this.divergences.length = 0
		this.legacyPhases.length = 0
		this.seq = 0
	}

	/**
	 * Test-only: read the comparator's internal shadow model. Production
	 * code MUST NOT call this. Used by the host-msgs emitter tests to
	 * observe the post-state of `task_requested` / `task_cancelled` / etc.
	 * without exposing the shadow via a public writer API.
	 */
	debugSnapshot(): TaskModel {
		return this.shadow.debugSnapshot()
	}

	/**
	 * ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01:
	 *
	 * Read-only accessor for the comparator's monotonic
	 * observation seq. Used by the wiring's
	 * `getLastObservedShadowSeq()` accessor to surface the
	 * shadow's generation to the publication selectors, so the
	 * selectors can detect "shadow is stale relative to the
	 * legacy tracker" and forbid the LIVE contradiction where
	 * a stale `getLastObservedShadowPhase()` would override a
	 * fresh `turnStateTracker.currentPhase`.
	 *
	 * Returns 0 when the comparator has never accepted an
	 * observation (i.e. `hasObservedShadowState() === false`).
	 * The wiring's accessor wraps this with the
	 * `hasObservedShadowState()` presence gate and returns
	 * `undefined` for the absence case — so production
	 * consumers never see `0`.
	 */
	debugObservedSeq(): number {
		return this.seq
	}

	/**
	 * ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01-CORRECTION01-FIX01:
	 *
	 * Presence seam (host-wiring responsibility).
	 *
	 * Returns `true` once the comparator has accepted at least one
	 * observation through `observeRuntimeEvent` / `observeTaskMsg`
	 * for the CURRENT shadow instance. Returns `false` for a brand-
	 * new shadow (never observed) and after `debugReset()` /
	 * `resetForNewTask()` (which both clear the observation seq).
	 *
	 * This is the canonical host-side answer to "has the shadow
	 * published any shadow-driven phase for this visible task?".
	 * The frozen three-source selector
	 * (`selectTaskHeaderPresentation` in
	 * `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts`)
	 * depends on this distinction to honour the precedence rule
	 *
	 *   host-compacting > shadow > legacy absence fallback
	 *
	 * — i.e. when the shadow is absent, the legacy phase wins, not
	 * the shadow's default "idle" projection of a never-observed
	 * `TaskModel`.
	 *
	 * Does NOT touch `@cline/agents`: this is a host concern about
	 * the lifetime of an observation session, not a projection rule.
	 * Production phase semantics remain in `@cline/agents`'s
	 * `projectTurnState` (selectors.ts:47-71).
	 */
	hasObservedShadowState(): boolean {
		return this.seq > 0
	}
}
