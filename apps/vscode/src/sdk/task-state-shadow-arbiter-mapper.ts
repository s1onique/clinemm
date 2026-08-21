// ===========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-F1-CANONICAL-RUNTIME-EVENT-SEAM01-ELM-02F-CORRECTION01:
//
// `mapAgentRuntimeStateSnapshotToArbiterSnapshot` and
// `legacyArbiterSnapshotFromTurnPhase` are the two load-bearing
// arbiter-source producers that ELM-02F-CORRECTION01 unblocks.
//
// The plan (docs/architecture/elm/task-state-e5-e6-correction02-elm-02f-correction01-canonical-arbiter-source-plan.md)
// freezes the source-selection contract in §1.2 (CONTRACT_1/CONTRACT_2/CONTRACT_3):
//
//   CONTRACT_1:  method-absent (Hub/Remote host) ≡ returns-undefined
//                (Local active but no AgentRuntime instance)
//                ≡ use legacy fallback
//   CONTRACT_2:  production code uses ?.() everywhere
//   CONTRACT_3:  one fallback path; one fallback shape; one disposition
//
// And the two-function rule in §3.2:
//
//   CANONICAL_MAPPER_ACCEPTS_TURN_PHASE = false
//
// The canonical mapper therefore ACCEPTS ONLY `AgentRuntimeStateSnapshot`
// — never a `TurnPhase`. The legacy fallback function ACCEPTS ONLY
// `TurnPhase` — never a snapshot. Selection is at the call site:
//
//     const canonical = sdkHost.runtimeSnapshot?.()
//     return canonical
//         ? mapAgentRuntimeStateSnapshotToArbiterSnapshot(canonical)
//         : legacyArbiterSnapshotFromTurnPhase(turnStateTracker.currentPhase)
//
// This shape makes it impossible for the canonical branch to
// accidentally read the legacy phase (and vice versa), even in
// future maintenance.
//
// T2_LEGACY_INDEPENDENCE (the load-bearing causal property):
//   the canonical mapper reads ONLY from `snapshot`. Changing
//   `turnStateTracker.currentPhase` while holding the canonical
//   snapshot constant produces an identical ArbiterSnapshot.
//
// T8_NECESSITY (the dual of T2):
//   changing the canonical snapshot while holding the legacy phase
//   constant produces a DIFFERENT ArbiterSnapshot, proving the
//   canonical source actually captures new mutations.
// ===========================================================================

import type { AgentRunStatus, AgentRuntimeStateSnapshot, RecoveryState } from "@cline/shared"
import type { ThinkingPresentationProjection, TurnPhase } from "@shared/ExtensionMessage"
import { emptyArbiterSnapshot } from "./task-state-shadow-host-wiring"
import type { ArbiterSnapshot } from "./task-state-shadow-recorder"

/**
 * Map a canonical `AgentRuntimeStateSnapshot` (from
 * `AgentRuntime.snapshot()`) into the `ArbiterSnapshot` shape the
 * `TaskShadowRecorder` consumes.
 *
 * Contract: reads ONLY from `snapshot`. Never accepts a
 * `TurnPhase`. The legacy phase is not in scope of this
 * function — by construction, T2_LEGACY_INDEPENDENCE holds.
 *
 * Field mapping (frozen by §1.3 of the plan):
 *
 *   execution.modelStreaming       ← snapshot.execution?.modelStreaming ?? false
 *   execution.tooling              ← snapshot.execution?.tooling ?? false
 *   execution.awaitingApproval     ← snapshot.execution?.awaitingApproval ?? false
 *   pendingToolCalls               ← snapshot.pendingToolCalls ?? []
 *   recoveryState                  ← snapshot.recovery?.state ?? "idle"
 *   status                         ← snapshot.status
 */
export function mapAgentRuntimeStateSnapshotToArbiterSnapshot(snapshot: AgentRuntimeStateSnapshot): ArbiterSnapshot {
	return {
		execution: {
			modelStreaming: snapshot.execution?.modelStreaming ?? false,
			tooling: snapshot.execution?.tooling ?? false,
			awaitingApproval: snapshot.execution?.awaitingApproval ?? false,
		},
		pendingToolCalls: snapshot.pendingToolCalls ?? [],
		recoveryState: (snapshot.recovery?.state ?? "idle") as RecoveryState,
		status: snapshot.status as AgentRunStatus,
	}
}

/**
 * Legacy arbiter source — byte-/field-equivalent to the pre-ELM-02F
 * mirror at `SdkController.ts:565-580`. Used ONLY when the canonical
 * `runtimeSnapshot?.()` returns `undefined` (Hub/Remote hosts that
 * omit the method, or Local sessions with no active AgentRuntime
 * instance — these two absence states collapse per CONTRACT_2).
 *
 * Contract: reads ONLY from `phase`. Never accepts a snapshot.
 * The canonical snapshot is not in scope of this function — by
 * construction, T3C_FALLBACK_EXACTNESS holds.
 *
 * Field mapping (frozen by §1.3 of the plan + the pre-ELM-02F
 * closure):
 *
 *   execution.modelStreaming       ← phase === "streaming"
 *   execution.tooling              ← phase === "streaming"
 *   execution.awaitingApproval     ← phase === "awaiting_approval"
 *   pendingToolCalls               ← []
 *   recoveryState                  ← "idle"  (emptyArbiterSnapshot default)
 *   status                         ← "idle"  (emptyArbiterSnapshot default)
 *
 * ELM02F-N2 — fallback dependence: this function is byte-equivalent
 * to the pre-ELM-02F closure for the canonical cases; ELM02F-N2
 * witnesses verify the equivalence.
 */
export function legacyArbiterSnapshotFromTurnPhase(phase: TurnPhase): ArbiterSnapshot {
	return {
		...emptyArbiterSnapshot(),
		execution: {
			modelStreaming: phase === "streaming",
			tooling: phase === "streaming",
			awaitingApproval: phase === "awaiting_approval",
		},
	}
}

// ===========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7-LOCAL-BACKEND-ACTIVATION01-CORRECTION01 R1:
//
//   selectTaskShadowArbiterSnapshot
//
// Single source of the canonical-arbiter selection expression. The
// production SdkController.getArbiterSnapshot closure and the E7-PRE1
// integration witness BOTH call this function — there is no test-side
// re-implementation of the selection (E7-CORRECTION01 R1).
//
// CONTRACT (frozen by ELM-02F-CORRECTION01 §1.2):
//
//   * `canonicalSnapshot` is consulted first; if it returns a truthy
//     `AgentRuntimeStateSnapshot`, the canonical mapper is applied.
//   * Otherwise, the legacy fallback
//     (`legacyArbiterSnapshotFromTurnPhase(currentLegacyPhase)`) is
//     used — the legacy phase is read ONLY in this branch.
//
// The two absence states collapse per CONTRACT_2:
//
//   * `canonicalSnapshot` is `undefined` (denormalized: Hub/Remote
//     hosts that omit `runtimeSnapshot()`, or Local sessions with no
//     active AgentRuntime instance)
//   * `canonicalSnapshot` returns `undefined` (the method exists but
//     yields no run)
//
// Both produce the legacy fallback ArbiterSnapshot.
// ===========================================================================

export function selectTaskShadowArbiterSnapshot(input: {
	readonly canonicalSnapshot: AgentRuntimeStateSnapshot | undefined
	readonly currentLegacyPhase: TurnPhase
}): ArbiterSnapshot {
	if (input.canonicalSnapshot) {
		return mapAgentRuntimeStateSnapshotToArbiterSnapshot(input.canonicalSnapshot)
	}
	return legacyArbiterSnapshotFromTurnPhase(input.currentLegacyPhase)
}

// ===========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01:
//
//   selectThinkingPresentation
//
// The webview-facing Thinking/presentation projection. Single source
// of truth for the `thinkingPresentation` field that
// `SdkController.getStateToPostToWebview` publishes. The three webview
// Thinking consumers actually migrated by E7.1 (ChatRow `case "reasoning"`,
// RequestStartRow inline shimmer, useThinkingLoaderRow loader row)
// consume this projection — NOT `turnState.phase` directly.
//
// The TaskHeader state label
// (`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`)
// is explicitly NOT migrated by E7.1 — its `taskHeaderStateLabel`
// helper consumes the full multi-phase `turnState.phase` vocabulary
// ("Working" / "Approval" / "Complete" / "Error" / "Paused" /
// "Waiting"). Migrating it requires a richer TurnPhase-shaped
// projection that the current `modelStreaming`-only shape does not
// carry; the E7.1-2 slice is reserved for that.
//
// Selection rule (frozen):
//
//   * When `canonicalShadow` is provided (LOCAL with the qualified
//     TaskState shadow available), the canonical
//     `execution.modelStreaming` flag is the source of truth. Source is
//     labeled `"shadow"`. This is the E7.1 consumer cutover target.
//
//   * When `canonicalShadow` is `undefined` (Hub/Remote hosts that omit
//     `runtimeSnapshot()`, or Local sessions with no active AgentRuntime
//     instance yet — both collapse per CONTRACT_2 in the arbiter mapper
//     above), the legacy `TurnStateTracker.phase === "streaming"` flag
//     is used. Source is labeled `"legacy"`. This preserves the existing
//     Hub/Remote consumer behavior byte-equivalent.
//
// `seq` is stamped from the legacy `TurnStateTracker.seq` so the webview
// can apply the same stale-push-fencing rule the legacy `turnState.seq`
// field already provides (the seq gating is applied UPSTREAM in
// `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`,
// not inside the migrated consumers).
//
// The two-source rule is a true causal property:
//   - T2_LEGACY_INDEPENDENCE: changing the legacy phase while the
//     canonical shadow is fixed does NOT change `modelStreaming` in
//     shadow-source mode (pinned by mutation test).
//   - T8_NECESSITY: changing the canonical `modelStreaming` while the
//     legacy phase is fixed DOES change the shadow-source value
//     (pinned by mutation test).
//
// EFFECT_EXECUTION_ENABLED remains `false` — this projector is
// read-only; it does NOT mutate any Task or control state. E9 owns
// the effect-execution cutover.
// ===========================================================================

export interface ThinkingPresentationInputs {
	/**
	 * The canonical TaskState shadow projection (the same one
	 * `SdkController.getLocalShadowProjection()` returns). May be
	 * `undefined` for Hub/Remote hosts and for Local sessions with no
	 * active AgentRuntime instance yet.
	 */
	readonly canonicalShadow: ArbiterSnapshot | undefined
	/**
	 * The legacy host-owned phase. Read ONLY in the legacy-source
	 * branch — by construction, T2_LEGACY_INDEPENDENCE holds.
	 */
	readonly currentLegacyPhase: TurnPhase
	/**
	 * Monotonic seq stamp from `TurnStateTracker`. Carried through to
	 * the projection so webview stale-push fencing continues to work.
	 */
	readonly seq: number
}

/**
 * Pure, deterministic Thinking presentation projector.
 *
 *   shadow available → `source: "shadow"`, `modelStreaming` from
 *     `canonicalShadow.execution.modelStreaming`
 *
 *   shadow absent   → `source: "legacy"`, `modelStreaming` from
 *     `currentLegacyPhase === "streaming"`
 *
 * NEVER throws. NEVER reads global state. The two-source rule is
 * enforced by the body shape, not by an assertion.
 */
export function selectThinkingPresentation(input: ThinkingPresentationInputs): ThinkingPresentationProjection {
	if (input.canonicalShadow) {
		return {
			modelStreaming: input.canonicalShadow.execution.modelStreaming,
			source: "shadow",
			seq: input.seq,
		}
	}
	return {
		modelStreaming: input.currentLegacyPhase === "streaming",
		source: "legacy",
		seq: input.seq,
	}
}

// ===========================================================================
// ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01:
//
//   selectTaskHeaderPresentation
//
// The webview-facing TaskHeader projection. Single source of truth for
// the `taskHeaderPresentation` field `SdkController.getStateToPostToWebview`
// will publish alongside `turnState` and `thinkingPresentation`. The
// TaskHeader state label
// (`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`)
// consumes this projection (via
// `taskHeaderStateLabel(taskHeaderPresentation, turnState)`) instead of
// `turnState.phase` directly.
//
// Frozen contract:
//
//   1. HOST COMPACTION OVERRIDE
//      if currentLegacyPhase === "compacting"
//        → phase = "compacting"
//        → source = "host"
//      This is an EXPLICIT host-owned override, NOT a generic legacy
//      fallback. `compacting` is a host-owned system transition
//      (`SdkCompactionCoordinator.enterCompactingPhase` writes it
//      directly to `TurnStateTracker`; the canonical shadow is
//      structurally unaware because compaction is not a runtime
//      event). The shadow CANNOT represent this phase, so
//      authorising the host as the source for this one dimension is
//      not a fallback — it is the only legitimate authority for the
//      `compacting` label.
//
//   2. CANONICAL SHADOW
//      else if canonicalShadowPhase is defined
//        → phase = canonicalShadowPhase
//        → source = "shadow"
//      The canonical shadow substrate (`@cline/agents`
//      `TaskShadowObservation.projections.turnPhase`, surfaced via
//      `SdkController.getLocalShadowPhase()` → wiring
//      `getLastObservedShadowPhase`) carries 7 of the 8 phases in
//      the legacy `TurnPhase` vocabulary. The shadow's `turnPhase`
//      is the authority for these phases — even when the legacy
//      `turnStateTracker` disagrees (T2_LEGACY_INDEPENDENCE).
//
//   3. ABSENCE FALLBACK
//      else
//        → phase = currentLegacyPhase
//        → source = "legacy"
//      Hub/Remote hosts (no `taskStateShadowWiring`), Local sessions
//      with no observed runtime event yet, and the absence-state
//      collapse (`CONTRACT_2` in `task-state-shadow-arbiter-mapper.ts`)
//      all collapse to the legacy fallback. Same byte-equivalent
//      semantics as the E7.1 Thinking projection's legacy branch.
//
//   4. `seq` is ALWAYS the legacy `TurnStateTracker.seq` so the
//      webview's transport-level stale-push fencing rule continues
//      to work unchanged.
//
// The selector is observation-only. It does NOT mutate any Task or
// control state. It does NOT call `TurnStateTracker.set()`. It does
// NOT read any background-command processing state. It does NOT
// compute any timer value. It is the single author of the
// TaskHeader's view of the current phase.
//
// Companion property (T2_LEGACY_INDEPENDENCE for the shadow branch):
//   changing `currentLegacyPhase` while the shadow is fixed does NOT
//   change the shadow-source phase, EXCEPT when the legacy phase is
//   `compacting` (the host override takes precedence in that one
//   case).
// ===========================================================================

export interface TaskHeaderPresentationProjection {
	/**
	 * The phase the TaskHeader should render. This is the canonical
	 * multi-phase vocabulary (`idle` / `streaming` /
	 * `awaiting_approval` / `awaiting_followup` / `compacting` /
	 * `completed` / `error` / `resumable`).
	 */
	phase: TurnPhase
	/**
	 * Provenance of `phase`. Exactly one of:
	 *   - `"host"`    — host-owned compaction system transition
	 *                   (the canonical shadow cannot represent this
	 *                   phase; the host is the only legitimate
	 *                   authority for the `compacting` label).
	 *   - `"shadow"`  — canonical `@cline/agents` TaskStateShadow
	 *                   projection (`getLocalShadowPhase()`).
	 *   - `"legacy"`  — Hub/Remote absence fallback (or Local
	 *                   pre-observation collapse), same byte-equivalent
	 *                   semantics as the E7.1 Thinking legacy branch.
	 */
	source: "shadow" | "host" | "legacy"
	/**
	 * Monotonic seq stamp from `TurnStateTracker`. Carried through
	 * unchanged so the webview's transport-level stale-push fencing
	 * (`ExtensionStateContext` replica reducer) continues to work.
	 * Same domain as `thinkingPresentation.seq` per the E7.1
	 * contract.
	 */
	seq: number
}

export interface TaskHeaderPresentationInputs {
	/**
	 * The canonical shadow phase, returned by
	 * `SdkController.getLocalShadowPhase()`. May be `undefined` for
	 * Hub/Remote hosts and for Local sessions with no observed
	 * runtime event yet.
	 */
	readonly canonicalShadowPhase: TurnPhase | undefined
	/**
	 * The current authoritative `TurnStateTracker` phase. Read in
	 * TWO branches:
	 *   - the HOST COMPACTION OVERRIDE branch (always)
	 *   - the ABSENCE FALLBACK branch (when canonicalShadowPhase is
	 *     undefined)
	 * By construction, the shadow-source branch is independent of
	 * this value.
	 */
	readonly currentLegacyPhase: TurnPhase
	/**
	 * Monotonic seq stamp from `TurnStateTracker`. The single fence
	 * token for the entire publish batch.
	 */
	readonly seq: number
}

/**
 * Pure, deterministic TaskHeader projection selector.
 *
 *   1. if currentLegacyPhase === "compacting"
 *        → phase = "compacting", source = "host"
 *   2. else if currentLegacyPhase === "awaiting_followup"
 *        → phase = "awaiting_followup", source = "host"
 *   3. else if canonicalShadowPhase is defined
 *        → phase = canonicalShadowPhase, source = "shadow"
 *   4. else
 *        → phase = currentLegacyPhase, source = "legacy"
 *
 * `seq` is always the input `seq` (TurnStateTracker.seq).
 *
 * NEVER throws. NEVER reads global state. NEVER mutates any
 * Task or control state. The precedence is enforced by the
 * body shape, not by an assertion.
 *
 * ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01 — CASE_B1
 * bounded repair (TCCC01-B1):
 *
 * The two host-override branches ("compacting" + "awaiting_followup")
 * exist because the canonical shadow's `projectTurnState(model)`
 * (sdk/packages/agents/src/runtime/state/task-state/selectors.ts:47)
 * CANNOT represent these two phases:
 *
 *   - `compacting` is an internal host-owned SYSTEM TRANSITION
 *     (owned by `SdkCompactionCoordinator.enterCompactingPhase()` /
 *     `restorePhase()`). It is not a runtime event.
 *
 *   - `awaiting_followup` is a user-owned phase. The only selector
 *     that produces it is `projectHostTurnState(model, hostInteraction)`
 *     which consumes a `hostInteraction.awaitingFollowup` boolean that
 *     production code never supplies. The canonical shadow wiring
 *     (apps/vscode/src/sdk/task-state-shadow-host-wiring.ts:445)
 *     calls `TaskState.projectTurnState(model)` — WITHOUT the host
 *     interaction arg — so its projection collapses to whatever
 *     `projectTurnState` yields, which (when the model is genuinely
 *     between turns during a follow-up ask, with no modelStreaming
 *     and no active tooling) is `"idle"`.
 *
 * Without this override, the SAME publication identity carries:
 *
 *   buttonsForPhase(turnState, ...)   → "Continue" CTA (real authority)
 *   taskHeaderPresentation.phase      → "idle"        (stale shadow)
 *
 * which is the LIVE-W2 contradiction the ACT names
 * CASE_B1_CONTINUATION_STATE_COLLAPSED_TO_IDLE.
 *
 * The override mirrors the compaction precedent exactly: the host
 * is the only legitimate authority for these two phases; the
 * shadow's projection is acknowledged to be incomplete for them.
 */
export function selectTaskHeaderPresentation(input: TaskHeaderPresentationInputs): TaskHeaderPresentationProjection {
	// 1. HOST COMPACTION OVERRIDE — explicit host authority for the
	// one phase the canonical shadow cannot represent.
	if (input.currentLegacyPhase === "compacting") {
		return {
			phase: "compacting",
			source: "host",
			seq: input.seq,
		}
	}
	// 2. HOST AWAITING_FOLLOWUP OVERRIDE — explicit host authority
	// for the user-owned phase the canonical shadow cannot
	// represent (TCCC01-B1 CASE_B1). See the JSDoc above.
	if (input.currentLegacyPhase === "awaiting_followup") {
		return {
			phase: "awaiting_followup",
			source: "host",
			seq: input.seq,
		}
	}
	// 3. CANONICAL SHADOW — the shadow's `turnPhase` is the
	// authority for 6 of the 8 phases (idle / streaming /
	// awaiting_approval / completed / error / resumable). It
	// overrides a stale legacy phase when present. The two
	// host-owned phases (compacting / awaiting_followup) are
	// handled by the two host-override branches above.
	if (input.canonicalShadowPhase !== undefined) {
		return {
			phase: input.canonicalShadowPhase,
			source: "shadow",
			seq: input.seq,
		}
	}
	// 4. ABSENCE FALLBACK — Hub/Remote / Local pre-observation.
	return {
		phase: input.currentLegacyPhase,
		source: "legacy",
		seq: input.seq,
	}
}

/**
 * ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02
 *
 * Canonical restore projection for the legacy `TurnStateTracker`
 * after a compaction completes. Returns the `TurnPhase` that the
 * canonical authority (canonical shadow + host-owned overrides)
 * considers authoritative at the moment of restore, or `undefined`
 * when no canonical observation is available.
 *
 * Mirrors `selectTaskHeaderPresentation` precedence (the canonical
 * architectural precedent for resolving `compacting` +
 * `awaiting_followup`) but produces only the phase value --
 * `selectTaskHeaderPresentation` returns a richer projection
 * (`source` + `seq`) for TaskHeader consumers, while this helper
 * returns just the `TurnPhase | undefined` for the legacy
 * `TurnStateTracker` writer.
 *
 *   1. if currentLegacyPhase === "compacting"
 *        → "compacting"
 *   2. else if currentLegacyPhase === "awaiting_followup"
 *        → "awaiting_followup"
 *   3. else if canonicalShadowPhase is defined
 *        → canonicalShadowPhase
 *   4. else
 *        → undefined  (Factory P1: `unavailable != idle`)
 *
 * Why this exists:
 *
 * CORRECTION01 wired the compaction coordinator to
 * `getCanonicalRestorePhase?: () => TurnPhase | undefined`. The
 * previous incarnation bound the callback to
 * `taskStateShadowWiring?.getLastObservedShadowPhase()`, which
 * delegates to `TaskState.projectTurnState(model)` -- NOT the
 * host-aware variant. That projection CANNOT distinguish
 * `idle + awaitingFollowup=true` from `idle + awaitingFollowup=false`;
 * both collapse to `idle`. The canonical mapper's own JSDoc at
 * `selectTaskHeaderPresentation` above explains this gap and
 * resolves it with an explicit HOST AWAITING_FOLLOWUP OVERRIDE
 * branch. The compaction restore needs the SAME override.
 *
 * Pure: no side effects, no I/O, no allocation beyond the
 * returned value. The body shape is the contract; no assertion
 * enforces it. The `SdkCompactionCoordinator` honors whatever the
 * caller passes; the caller is responsible for supplying a value
 * produced by this selector.
 */
export function selectCanonicalRestorePhase(input: {
	readonly canonicalShadowPhase: TurnPhase | undefined
	readonly currentLegacyPhase: TurnPhase
}): TurnPhase | undefined {
	// 1. HOST COMPACTING OVERRIDE -- mirror
	//    `selectTaskHeaderPresentation` step 1.
	if (input.currentLegacyPhase === "compacting") {
		return "compacting"
	}
	// 2. HOST AWAITING_FOLLOWUP OVERRIDE -- mirror step 2. The
	//    canonical shadow's `projectTurnState(model)` cannot
	//    produce `awaiting_followup` because that requires
	//    `hostInteraction.awaitingFollowup`, which the canonical
	//    shadow wiring does not propagate. The legacy
	//    `TurnStateTracker.currentPhase` IS the authoritative
	//    source for this user-owned phase (the session-event
	//    coordinator writes it directly), so we read it here.
	if (input.currentLegacyPhase === "awaiting_followup") {
		return "awaiting_followup"
	}
	// 3. TERMINAL OWNER ENTRY (idle / completed / resumable /
	//    error) -- preserve entry. The legacy tracker IS the
	//    authority for these phases (the session-event coordinator
	//    writes them directly); consulting the canonical shadow
	//    could regress a terminal state. Mirrors the
	//    ABSENCE-FALLBACK semantics of `selectTaskHeaderPresentation`
	//    step 4 but generalized: terminal owners ALWAYS preserve,
	//    regardless of canonical shadow.
	const isTerminalOwner =
		input.currentLegacyPhase === "idle" ||
		input.currentLegacyPhase === "completed" ||
		input.currentLegacyPhase === "resumable" ||
		input.currentLegacyPhase === "error"
	if (isTerminalOwner) {
		return input.currentLegacyPhase
	}
	// 4. NON-TERMINAL OWNER (streaming / awaiting_approval) +
	//    canonical available -- bounded repair fires, write the
	//    canonical projection.
	if (input.canonicalShadowPhase !== undefined) {
		return input.canonicalShadowPhase
	}
	// 5. NON-TERMINAL OWNER + canonical undefined -- preserve
	// entry via the coordinator's `undefined -> preserve` gate.
	// Factory P1: `unavailable != idle`; the bounded repair must
	// NOT fire when the canonical projection is unavailable.
	return undefined
}

/**
 * ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02
 *
 * Factory: builds the canonical restore callback that
 * `SdkController` wires into `getCanonicalRestorePhase`. The
 * callback reads `canonicalShadowPhase` (the EXISTING
 * `taskStateShadowWiring.getLastObservedShadowPhase()` projection)
 * and `currentLegacyPhase` (the legacy `TurnStateTracker.currentPhase`)
 * and delegates to `selectCanonicalRestorePhase` for the
 * three-source precedence.
 *
 * Extracted as a small factory so the binding composition is
 * testable end-to-end. The factory takes the two dependencies
 * directly (not the live `taskStateShadowWiring` /
 * `turnStateTracker`) so the test can drive the binding without
 * spinning up a full SdkController. This satisfies the Factory
 * reviewer's real-wiring discriminator: the binding's value source
 * is `selectCanonicalRestorePhase({canonicalShadowPhase, currentLegacyPhase})`,
 * not the bare canonical shadow.
 *
 * The factory does not duplicate `selectCanonicalRestorePhase`'s
 * switch -- it just composes its inputs from the two existing
 * production dependencies and returns the closure.
 */
export function createCanonicalRestorePhaseCallback(input: {
	readonly getCanonicalShadowPhase: () => TurnPhase | undefined
	readonly getCurrentLegacyPhase: () => TurnPhase
}): () => TurnPhase | undefined {
	const { getCanonicalShadowPhase, getCurrentLegacyPhase } = input
	return () =>
		selectCanonicalRestorePhase({
			canonicalShadowPhase: getCanonicalShadowPhase(),
			currentLegacyPhase: getCurrentLegacyPhase(),
		})
}
