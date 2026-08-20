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
 *   2. else if canonicalShadowPhase is defined
 *        → phase = canonicalShadowPhase, source = "shadow"
 *   3. else
 *        → phase = currentLegacyPhase, source = "legacy"
 *
 * `seq` is always the input `seq` (TurnStateTracker.seq).
 *
 * NEVER throws. NEVER reads global state. NEVER mutates any
 * Task or control state. The three-source precedence is enforced
 * by the body shape, not by an assertion.
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
	// 2. CANONICAL SHADOW — the shadow's `turnPhase` is the
	// authority for 7 of the 8 phases (idle / streaming /
	// awaiting_approval / awaiting_followup / completed / error /
	// resumable). It overrides a stale legacy phase when present.
	if (input.canonicalShadowPhase !== undefined) {
		return {
			phase: input.canonicalShadowPhase,
			source: "shadow",
			seq: input.seq,
		}
	}
	// 3. ABSENCE FALLBACK — Hub/Remote / Local pre-observation.
	return {
		phase: input.currentLegacyPhase,
		source: "legacy",
		seq: input.seq,
	}
}
