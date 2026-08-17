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
function toLegacyPhase(s: TaskShadowObservation["projections"]["turnPhase"]): TurnPhase {
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
				tooling: observation.model.activity.tooling,
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
}
