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
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02:
	 *
	 * The TurnStateTracker.seq value the canonical shadow had
	 * when it produced `canonicalShadow` (or, equivalently,
	 * when it produced the last `getLastObservedShadowPhase()`
	 * projection). Used to forbid the LIVE contradiction where
	 * the canonical shadow's LAST observation was a prior
	 * lifecycle state (e.g. `streaming` from a prior turn, or
	 * the initial `idle` projection of a never-observed
	 * TaskModel) and the legacy `TurnStateTracker` has since
	 * advanced to a different phase (e.g. `completed`,
	 * `error`, `resumable`, or `streaming`).
	 *
	 * **DOMAIN IDENTITY (CORRECTION02):** this value MUST be in
	 * the **TurnState sequence domain** — the same domain as
	 * `seq`. The shadow observation is stamped with the
	 * TurnStateTracker.seq at the moment the shadow accepted
	 * the observation (via `wiring.getLastObservedTurnSeq()`).
	 *
	 * When `canonicalShadowObservedTurnSeq !== undefined &&
	 * seq > canonicalShadowObservedTurnSeq` the shadow is STALE
	 * relative to the legacy phase. The selector MUST fall
	 * through to the legacy branch.
	 *
	 * Hub/Remote hosts and Local sessions with no observation
	 * pass `canonicalShadowObservedTurnSeq === undefined`, which
	 * is the absence-collapse case (the shadow branch does not
	 * fire anyway).
	 */
	readonly canonicalShadowObservedTurnSeq?: number
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
	// ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02:
	// When the shadow observation is STALE relative to the most
	// recent legacy transition (`seq > canonicalShadowObservedTurnSeq`),
	// fall through to the legacy branch. Both `seq` and
	// `canonicalShadowObservedTurnSeq` are in the SAME TurnState
	// sequence domain — the cross-domain numeric comparison
	// CORRECTION01 attempted has been removed.
	const isShadowStale =
		input.canonicalShadow !== undefined &&
		input.canonicalShadowObservedTurnSeq !== undefined &&
		input.seq > input.canonicalShadowObservedTurnSeq
	if (input.canonicalShadow && !isShadowStale) {
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
	/**
	 * ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01:
	 *
	 * ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02:
	 *
	 * The TurnStateTracker.seq value the canonical shadow had
	 * when it produced `canonicalShadowPhase`. Used to forbid
	 * the LIVE contradiction where the canonical shadow's LAST
	 * observation was a prior lifecycle state (e.g. `streaming`
	 * from a prior turn, or the initial `idle` projection of a
	 * never-observed TaskModel) and the legacy `TurnStateTracker`
	 * has since advanced to a different phase (e.g. `completed`,
	 * `error`, `resumable`, or `streaming`).
	 *
	 * **DOMAIN IDENTITY (CORRECTION02):** this value MUST be in
	 * the **TurnState sequence domain** — the same domain as
	 * `seq`. The shadow observation is stamped with the
	 * TurnStateTracker.seq at the moment the shadow accepted
	 * the observation (via `wiring.getLastObservedTurnSeq()`).
	 *
	 * When `canonicalShadowObservedTurnSeq !== undefined &&
	 * seq > canonicalShadowObservedTurnSeq` the shadow is STALE
	 * relative to the legacy phase. The selector MUST fall
	 * through to the legacy branch.
	 *
	 * Mirrors the same parameter on `ThinkingPresentationInputs`.
	 */
	readonly canonicalShadowObservedTurnSeq?: number
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
	//
	// ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02:
	// When the canonical shadow's last observation is STALE
	// relative to the most recent legacy transition (`seq >
	// canonicalShadowObservedTurnSeq`), fall through to the
	// legacy branch. A stale shadow must NOT override a fresh
	// legacy phase — this is the LIVE contradiction the
	// REPAIR01 captures (publicationId 15/17 of taskId
	// 1788189447617_rw5zx: turnState.phase="streaming" +
	// taskHeaderPresentation.phase="idle").
	//
	// Both `seq` and `canonicalShadowObservedTurnSeq` are in
	// the SAME TurnState sequence domain — the cross-domain
	// numeric comparison CORRECTION01 attempted has been
	// removed.
	if (input.canonicalShadowPhase !== undefined) {
		const isShadowStale =
			input.canonicalShadowObservedTurnSeq !== undefined && input.seq > input.canonicalShadowObservedTurnSeq
		if (!isShadowStale) {
			return {
				phase: input.canonicalShadowPhase,
				source: "shadow",
				seq: input.seq,
			}
		}
	}
	// 4. ABSENCE FALLBACK — Hub/Remote / Local pre-observation.
	// Also the destination for a stale shadow (per the staleness
	// gate above).
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
	readonly entryPhase: TurnPhase
	readonly canonicalShadowPhase: TurnPhase | undefined
	readonly currentLegacyPhase: TurnPhase
}): TurnPhase | undefined {
	// ============================================================
	// CORRECTION04: temporal identity resolved
	// ============================================================
	//
	// CORRECTION02/03 confused `entryPhase` (the CAPTURED phase
	// before compaction took ownership) with `currentLegacyPhase`
	// (the LIVE tracker value at callback time). They are not
	// the same: the coordinator writes "compacting" at entry
	// (`sdk-compaction-coordinator.ts:412`) and the live tracker
	// reads "compacting" for the entire compaction work. The
	// CORRECTION02 `compacting -> compacting` branch therefore
	// ALWAYS fired during the restore callback, blocking the
	// canonical projection from ever winning.
	//
	// The CORRECTION04 model separates three concepts:
	//   entryPhase          -- CAPTURED before compaction (governs
	//                           terminal-owner preservation)
	//   canonicalShadowPhase -- canonical authority (canonical
	//                           projection at restore time)
	//   currentLegacyPhase  -- LIVE tracker; legitimate signal only
	//                           for `awaiting_followup` (host-owned
	//                           override during compaction)
	//
	// Precedence (CORRECTION04):
	//
	//   1. TERMINAL OWNER ENTRY -- preserve entry. The canonical
	//      shadow NEVER overrides a terminal entry. The host-owned
	//      awaiting_followup override also does not fire here:
	//      a terminal entry is an authoritative state, not a
	//      transition marker.
	//   2. HOST-OWNED AWAITING_FOLLOWUP -- the live tracker reports
	//      "awaiting_followup" only when the session-event
	//      coordinator wrote it during compaction. That is a
	//      user-owned override that legitimately supersedes the
	//      entry. Return `awaiting_followup`.
	//   3. NON-TERMINAL ENTRY + canonical available -- bounded
	//      repair fires; write canonical projection.
	//   4. NON-TERMINAL ENTRY + canonical undefined -- return
	//      undefined (coordinator preserves entry; P1: unavailable
	//      != idle).
	//
	// `compacting` is intentionally NOT a restore destination.
	// It is a transition marker written by the coordinator at
	// entry. The selector MUST NOT consult
	// `currentLegacyPhase === "compacting"`; the live tracker
	// reads "compacting" for the entire window by construction.

	// 1. HOST-OWNED AWAITING_FOLLOWUP OVERRIDE -- the live tracker
	//    reports awaiting_followup ONLY when the session-event
	//    coordinator wrote it. This is a user-owned signal that
	//    legitimately supersedes any prior state (including a
	//    terminal idle). If the live tracker says awaiting_followup,
	//    the user has taken ownership -- return awaiting_followup.
	if (input.currentLegacyPhase === "awaiting_followup") {
		return "awaiting_followup"
	}

	// 2. TERMINAL OWNER ENTRY (idle / completed / resumable /
	//    error) -- preserve entry ALWAYS. The canonical shadow
	//    NEVER overrides a terminal entry; the host override above
	//    (awaiting_followup) already fired if applicable.
	const isTerminalOwner =
		input.entryPhase === "idle" ||
		input.entryPhase === "completed" ||
		input.entryPhase === "resumable" ||
		input.entryPhase === "error"
	if (isTerminalOwner) {
		return input.entryPhase
	}

	// 3. AWAITING_FOLLOWUP ENTRY -- entry was awaiting_followup;
	//    the session-event coordinator had authoritative state
	//    awaiting user response. Preserve it.
	if (input.entryPhase === "awaiting_followup") {
		return "awaiting_followup"
	}

	// 4. CANONICAL SHADOW -- bounded repair fires for non-terminal
	//    entries when the canonical projection is available.
	if (input.canonicalShadowPhase !== undefined) {
		return input.canonicalShadowPhase
	}

	// 5. ABSENCE -- Factory P1: `unavailable != idle`. The
	//    coordinator preserves the entry phase in this branch.
	return undefined
}

/**
 * ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION04
 *
 * Factory: builds the canonical restore callback that
 * `SdkController` wires into `getCanonicalRestorePhase`. The
 * callback reads `canonicalShadowPhase` (the EXISTING
 * `taskStateShadowWiring.getLastObservedShadowPhase()` projection),
 * `currentLegacyPhase` (the live `turnStateTracker.currentPhase`,
 * sampled at restore time), and `entryPhase` (the CAPTURED phase
 * before compaction took ownership -- passed by the coordinator
 * as an argument). It delegates to `selectCanonicalRestorePhase`
 * for the three-source precedence.
 *
 * Extracted as a small factory so the binding composition is
 * testable end-to-end. The factory takes the two host-derived
 * dependencies directly (not the live `taskStateShadowWiring` /
 * `turnStateTracker`) so the test can drive the binding without
 * spinning up a full SdkController. The factory then closes over
 * `entryPhase` via the returned callback -- the coordinator
 * supplies `entryPhase` when it invokes the callback.
 *
 * Why `entryPhase` is a parameter and not a third factory input:
 * the entry phase is coordinator-internal (captured at
 * `enterCompactingPhase()` before any host read). The factory
 * cannot know it without the coordinator passing it through. The
 * returned closure takes `entryPhase` as a parameter; the
 * coordinator invokes it with the captured value.
 *
 * `compacting` is intentionally NOT a restore destination. The
 * factory does not consult `currentLegacyPhase` for the
 * `compacting -> compacting` branch. `compacting` is a transition
 * marker written by the coordinator at entry, and the live
 * tracker reads `compacting` for the entire compaction window by
 * construction. Any selector that returns `compacting` from
 * `currentLegacyPhase` would always fire during the restore
 * callback, blocking the canonical projection from ever winning.
 */
export function createCanonicalRestorePhaseCallback(input: {
	readonly getCanonicalShadowPhase: () => TurnPhase | undefined
	readonly getCurrentLegacyPhase: () => TurnPhase
}): (entryPhase: TurnPhase) => TurnPhase | undefined {
	const { getCanonicalShadowPhase, getCurrentLegacyPhase } = input
	return (entryPhase: TurnPhase) =>
		selectCanonicalRestorePhase({
			entryPhase,
			canonicalShadowPhase: getCanonicalShadowPhase(),
			currentLegacyPhase: getCurrentLegacyPhase(),
		})
}
