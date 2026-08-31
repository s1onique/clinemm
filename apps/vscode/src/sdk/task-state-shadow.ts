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

// ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION05:
// Structural equality over the canonical phase-authority tuple
// that `projectTurnState` (selectors.ts:47) consumes. The tuple
// is exactly:
//   activity.awaitingApproval    -> projects "awaiting_approval"
//   activity.modelStreaming      -> projects "streaming"
//   activity.activeToolCallIds   -> projects "streaming" via isTooling()
//   lifecycle.kind               -> terminal/resumable axes
//   lifecycle.reason             -> only when kind === "failed"
// Recovery/telemetry/identity mutations do NOT participate in
// phase derivation; they MUST NOT refresh the phase-keyed stamp.
// Replace CORRECTION04's `isSameTaskModel` check with this
// narrower projection-authority check.
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
	 * ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION06:
	 *
	 * Phase-keyed TurnStateTracker.seq stamp. Advances only
	 * when a non-`"noop"` observation finds both phase
	 * authorities in AGREEMENT — i.e. when the canonical
	 * shadow projection equals the legacy TurnState phase
	 * at the same observation:
	 *
	 *   lastObservedTurnSeqByPhase[P] === N
	 *   iff shadowPhase === legacyPhase === P
	 *     at TurnState generation N
	 *
	 * Rationale — chain of corrections (this is the FINAL
	 * correction; the chain is closed at C06):
	 *
	 *   CORRECTION02:
	 *     P0 `HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN`.
	 *     Stamp was on a single `number | undefined`, sampled
	 *     from `turnStateTracker.get().seq` at observation.
	 *
	 *   CORRECTION03:
	 *     P0 `HALT_SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION`.
	 *     Stamp is now per-phase (`Map<TurnPhase, ...>`) and
	 *     gated on `event !== "noop"` (adapter-generated
	 *     `"noop"` sentinels don't refresh).
	 *
	 *   CORRECTION04:
	 *     P0 `HALT_PHASE_STAMP_ADVANCES_ON_SEMANTIC_NOOP`.
	 *     The `event !== "noop"` rule was a label-based proxy
	 *     for mutation. The production reducer accepts
	 *     non-`"noop"` TaskMsgs as semantic no-ops — e.g.
	 *     "an approval_resolved WITHOUT an active approval
	 *     is a no-op" (`task-state.update.test.ts:312`).
	 *     The label proxy permitted those to bypass the gate
	 *     too. Replaced with full-model `isSameTaskModel`.
	 *
	 *   CORRECTION05:
	 *     P0 `HALT_PHASE_STAMP_ADVANCES_ON_NON_PHASE_MUTATION`.
	 *     Full-model equality was over-broad: mutations to
	 *     recovery/telemetry/identity don't participate in
	 *     phase derivation but did refresh the stamp.
	 *     Replaced with the narrower projection-authority
	 *     check `isSameTurnProjectionAuthority` (compares
	 *     only the canonical phase-authority tuple).
	 *
	 *   CORRECTION06 (this entry — final):
	 *     P0 `HALT_PHASE_STAMP_REFRESHED_BY_MASKED_AUTHORITY_MUTATION`.
	 *     Even a correctly-bounded projection-authority check
	 *     can't model `projectTurnState`'s precedence
	 *     (`awaitingApproval` > `modelStreaming || tooling`
	 *     > `lifecycle`). A `tool_started` under awaitingApproval
	 *     mutates `activeToolCallIds` (a lower-precedence axis)
	 *     while the projection stays `awaiting_approval`. The
	 *     C05 helper still detected the mutation and refreshed
	 *     the awaiting_approval stamp.
	 *     C06 DELETES the mutation-proxy and replaces the
	 *     stamping rule with same-generation agreement:
	 *       shadowPhase === legacyPhase  AND  event !== "noop"
	 *     The comparator already had all three facts at the
	 *     observation site. No copied dependency list, no
	 *     precedence-masking trap. The selector's input
	 *     graph is no longer redundantly maintained.
	 *
	 * `undefined` when:
	 *   - the comparator has never accepted a same-phase
	 *     agreement observation yielding this phase
	 *   - the observation was made by a host without a
	 *     TurnStateTracker in the same domain (Hub/Remote
	 *     fallback path), so no TurnState seq was available
	 *     to stamp
	 *
	 * Initialized lazily — entries are added when
	 * `compareWith` first sees a same-phase agreement
	 * observation yielding that phase.
	 */
	private lastObservedTurnSeqByPhase = new Map<TurnPhase, number | undefined>()

	/**
	 * Feed a runtime event through the shadow and compare against the
	 * legacy phase observed at that instant. Returns the recorded
	 * divergence (if any) and the shadow observation.
	 */
	observeRuntimeEvent(
		event: AgentRuntimeEvent,
		legacyPhase: TurnPhase,
		now: number,
		turnSeq?: number,
	): { readonly observation: TaskShadowObservation; readonly divergence: TaskShadowDivergence | undefined } {
		const observation = this.shadow.observeRuntimeEvent(event, now) ?? this.shadow.noop(now)
		return this.compareWith(observation, legacyPhase, observation.event, turnSeq)
	}

	/**
	 * Feed a `TaskMsg` directly (used by tests; production goes through
	 * `observeRuntimeEvent`).
	 */
	observeTaskMsg(
		msg: TaskMsg,
		legacyPhase: TurnPhase,
		now: number,
		turnSeq?: number,
	): { readonly observation: TaskShadowObservation; readonly divergence: TaskShadowDivergence | undefined } {
		const observation = this.shadow.observe(msg, now)
		return this.compareWith(observation, legacyPhase, msg.type, turnSeq)
	}

	private compareWith(
		observation: TaskShadowObservation,
		legacyPhase: TurnPhase,
		event: TaskMsg["type"] | "noop",
		turnSeq?: number,
	): { readonly observation: TaskShadowObservation; readonly divergence: TaskShadowDivergence | undefined } {
		this.seq += 1
		this.legacyPhases.push(legacyPhase)
		// ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION04:
		// Stamp the TurnStateTracker.seq value keyed by the
		// PHASE the comparator is currently observing (the
		// shadow's projected phase), BUT ONLY when this
		// observation materially CHANGED the shadow model.
		//
		// The previous rule (CORRECTION03,
		// "only when `event !== "noop"`") was a label-based
		// proxy for mutation. The production shadow reducer
		// has documented semantic-noop paths
		// (`task-state.update.test.ts:312` and
		// `task-state.update.test.ts:335`):
		//   "an approval_resolved WITHOUT an active approval
		//    is a no-op"
		// i.e. a perfectly valid TaskMsg with a non-`"noop"`
		// event label that the reducer accepts but leaves
		// the model untouched. The label-based rule cannot
		// distinguish those from real mutations.
		//
		// CORRECTION04 replaces the label proxy with the
		// canonical structural-equality check
		// `isSameTaskModel` (`@cline/agents/.../model.ts`).
		// The stamp advances only when the model
		// structurally changed, OR when this is the very
		// first observation (no pre-model to compare
		// against). Every other observation — adapter
		// `"noop"` sentinels, semantic no-ops at the
		// reducer, same-phase reads — leaves the stamp at
		// the generation it was last established under.
		//
		// Invariant preserved: for any phase P the map
		// keys,
		//   lastObservedTurnSeqByPhase[P] === N
		// ⇔ a NON-NOOP, model-material observation yielded
		//   a transition that established phase P under
		//   TurnState generation N.
		const shadowPhase = toLegacyPhase(observation.projections.turnPhase)
		// ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION06:
		//
		// Simplification. Phase freshness is now defined
		// by same-generation agreement between the two
		// phase authorities:
		//
		//   stamp[P] = N
		//   iff shadowPhase === legacyPhase === P
		//     at TurnState generation N
		//
		// No mutation inference, no copied dependency
		// list, no precedence-masking trap. The
		// comparator already has all three facts at
		// this observation site (shadowPhase, legacyPhase,
		// turnSeq). We just compose them.
		//
		// RATIONALE (chain of corrections):
		//   CORRECTION02 same-domain identity
		//   CORRECTION03 phase-key + adapter-noop guard
		//   CORRECTION04 model-equality (isSameTaskModel)
		//   CORRECTION05 projection-authority
		//     (isSameTurnProjectionAuthority)
		//   CORRECTION06 (this) same-generation
		//     shadowPhase === legacyPhase agreement.
		//
		// CORRECTION06 closes
		// HALT_PHASE_STAMP_REFRESHED_BY_MASKED_AUTHORITY_MUTATION:
		// a tool_started under awaitingApproval=true
		// mutates the lower-precedence activeToolCallIds
		// but does NOT change the projected phase. The
		// previous mutation-based proxies (C04, C05)
		// both incorrectly refreshed the awaiting_approval
		// stamp because they couldn't model the canonical
		// selector's precedence. Agreement-based stamping
		// is precedence-agnostic by construction.
		const phaseAuthoritiesAgree = shadowPhase === legacyPhase
		if (event !== "noop" && phaseAuthoritiesAgree) {
			this.lastObservedTurnSeqByPhase.set(shadowPhase, turnSeq)
		}
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
		this.lastObservedTurnSeqByPhase.clear()
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
	 * ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION03:
	 *
	 * Read-only accessor for the TurnStateTracker.seq value
	 * the comparator stamped on its LAST observation yielding
	 * the SPECIFIC projected phase `phase`. The phase-keyed
	 * stamp collapses the previous unbounded observation-count
	 * stamp into a per-projection invariant:
	 *
	 *   (getLastObservedShadowPhase() === P) AND
	 *   (debugLastObservedTurnSeqForPhase(P) === N)
	 *   ⇒ P was the shadow projection established/validated
	 *     at TurnState generation N
	 *
	 * Returns `undefined` when the comparator has never accepted
	 * an observation yielding `phase`, or when the observation
	 * lacked a TurnState-domain seq (Hub/Remote fallback).
	 *
	 * The wiring's `getLastObservedTurnSeqForPhase(phase)`
	 * accessor wraps this with the `hasObservedShadowState()`
	 * presence gate.
	 */
	debugLastObservedTurnSeqForPhase(phase: TurnPhase): number | undefined {
		// ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION03:
		// Phase-keyed stamp. Returns the TurnStateTracker.seq
		// value the comparator stamped on its LAST observation
		// yielding the SPECIFIC projected phase `phase`. Phase-
		// keyed (not observation-keyed) so a no-op observation
		// that yields the same projection as the prior
		// observation does NOT bypass the staleness gate.
		return this.lastObservedTurnSeqByPhase.get(phase)
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
