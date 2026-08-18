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
// `SdkController.getStateToPostToWebview` publishes. The four webview
// Thinking consumers (ChatRow `case "reasoning"`, RequestStartRow inline
// shimmer, useThinkingLoaderRow, TaskHeader) consume this projection —
// NOT `turnState.phase` directly.
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
// field already provides.
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
