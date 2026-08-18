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
import type { TurnPhase } from "@shared/ExtensionMessage"
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
