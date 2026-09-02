// ===========================================================================
// ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01:
//
// Qualification suite for the webview-facing
// `selectTaskHeaderPresentation` projector. The projector is the
// single source of truth for the new `taskHeaderPresentation` field
// `SdkController.getStateToPostToWebview` will publish alongside
// `turnState` and `thinkingPresentation`. The TaskHeader state label
// (`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`)
// consumes this projection (via `taskHeaderStateLabel(taskHeaderPresentation, turnState)`)
// instead of `turnState.phase` directly.
//
// Frozen contract (this ACT):
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
//      event). The shadow CANNOT represent this phase, so authorising
//      the host as the source for this one dimension is not a fallback
//      — it is the only legitimate authority for the compacting
//      label.
//
//   2. CANONICAL SHADOW
//      else if canonicalShadowPhase is present
//        → phase = canonicalShadowPhase
//        → source = "shadow"
//      The canonical shadow substrate (`@cline/agents`
//      `TaskShadowObservation.projections.turnPhase`, surfaced via
//      `SdkController.getLocalShadowPhase()`) carries 7 of the 8
//      phases in the legacy `TurnPhase` vocabulary. The shadow's
//      `turnPhase` is the authority for these phases — even when the
//      legacy `turnStateTracker` disagrees (T2_LEGACY_INDEPENDENCE).
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
// Witness matrix (this ACT §11-§20):
//
//   THCP01  — canonical shadow beats stale legacy `streaming`
//   THCP02  — host-owned compaction override beats canonical shadow
//   THCP03  — user-owned incomplete yield beats stale legacy `streaming`
//   THCP04  — canonical shadow `error` beats stale legacy `streaming`
//   THCP05  — absence fallback preserves legacy `resumable`
//   THCP06  — `seq` stamping from `TurnStateTracker.seq`
//   THCP07  — active work `streaming` is preserved
//   THCP08  — `completed` is preserved
//   THCP09  — conservation: no background-command coupling
//   THCP10  — conservation: timing is NOT touched by this selector
// ===========================================================================

import type { TurnPhase } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { selectTaskHeaderPresentation, type TaskHeaderPresentationInputs } from "../task-state-shadow-arbiter-mapper"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function inputs(overrides: Partial<TaskHeaderPresentationInputs> = {}): TaskHeaderPresentationInputs {
	return {
		canonicalShadowPhase: undefined,
		currentLegacyPhase: "idle" as TurnPhase,
		seq: 1,
		...overrides,
	}
}

describe("ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 / host compaction override", () => {
	it("THCP02: host legacy `compacting` beats canonical shadow `awaiting_followup` → source='host', phase='compacting'", () => {
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "awaiting_followup",
				currentLegacyPhase: "compacting",
				seq: 42,
			}),
		)
		expect(out).toEqual({ phase: "compacting", source: "host", seq: 42 })
	})

	it("THCP02b: host legacy `compacting` beats canonical shadow `idle` → source='host'", () => {
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "compacting",
				seq: 7,
			}),
		)
		expect(out).toEqual({ phase: "compacting", source: "host", seq: 7 })
	})

	it("THCP02c: host legacy `compacting` beats canonical shadow absent → source='host'", () => {
		// The compacting override is independent of shadow presence.
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "compacting",
				seq: 3,
			}),
		)
		expect(out).toEqual({ phase: "compacting", source: "host", seq: 3 })
	})
})

describe("ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 / shadow branch", () => {
	it("THCP01: shadow `awaiting_followup` beats stale legacy `streaming` → source='shadow', TaskHeader shows Waiting not Working", () => {
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "awaiting_followup",
				currentLegacyPhase: "streaming",
				seq: 5,
			}),
		)
		expect(out).toEqual({ phase: "awaiting_followup", source: "shadow", seq: 5 })
	})

	it("THCP03: shadow `awaiting_followup` beats stale legacy `streaming` (user-owned incomplete yield) → source='shadow'", () => {
		// Same as THCP01 nominally but explicitly pinned for the
		// completion-liveness contract: a model that yielded without
		// `attempt_completion` against a stale `streaming` tracker
		// must show Waiting, not Working.
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "awaiting_followup",
				currentLegacyPhase: "streaming",
				seq: 11,
			}),
		)
		expect(out).toEqual({ phase: "awaiting_followup", source: "shadow", seq: 11 })
	})

	it("THCP04: shadow `error` beats stale legacy `streaming` → source='shadow'", () => {
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "error",
				currentLegacyPhase: "streaming",
				seq: 9,
				// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01:
				// BOUND-shadow terminal phase wins over stale legacy
				// when shadow carries same-generation TurnState-domain
				// provenance stamp (canonicalShadowObservedTurnSeq ===
				// seq → not stale → shadow wins).
				canonicalShadowObservedTurnSeq: 9,
			}),
		)
		expect(out).toEqual({ phase: "error", source: "shadow", seq: 9 })
	})

	it("THCP07: shadow `streaming` beats arbitrary legacy → source='shadow', phase='streaming'", () => {
		// Even when the legacy tracker is mid-transition (e.g.
		// `idle`) for a moment, the shadow's authoritative streaming
		// must win once observed.
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "idle",
				seq: 17,
			}),
		)
		expect(out).toEqual({ phase: "streaming", source: "shadow", seq: 17 })
	})

	it("THCP08: shadow `completed` beats legacy `streaming` → source='shadow', phase='completed'", () => {
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "completed",
				currentLegacyPhase: "streaming",
				seq: 21,
				// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01:
				// BOUND-shadow terminal phase wins when shadow carries
				// same-generation TurnState-domain provenance stamp
				// (canonicalShadowObservedTurnSeq === seq → not stale
				// → shadow wins).
				canonicalShadowObservedTurnSeq: 21,
			}),
		)
		expect(out).toEqual({ phase: "completed", source: "shadow", seq: 21 })
	})

	it("SHADOW_LEGACY_INDEPENDENCE: changing legacy phase while shadow is fixed does NOT change the shadow-source phase", () => {
		const a = selectTaskHeaderPresentation(
			inputs({ canonicalShadowPhase: "awaiting_followup", currentLegacyPhase: "streaming", seq: 1 }),
		)
		const b = selectTaskHeaderPresentation(
			inputs({ canonicalShadowPhase: "awaiting_followup", currentLegacyPhase: "idle", seq: 1 }),
		)
		expect(a.phase).toBe("awaiting_followup")
		expect(b.phase).toBe("awaiting_followup")
		expect(a.source).toBe("shadow")
		expect(b.source).toBe("shadow")
	})

	it("SHADOW_NECESSITY: changing shadow phase while legacy is fixed DOES change the shadow-source phase", () => {
		const a = selectTaskHeaderPresentation(
			inputs({ canonicalShadowPhase: "awaiting_followup", currentLegacyPhase: "streaming", seq: 1 }),
		)
		// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01:
		// SHADOW_NECESSITY (T8_NECESSITY) requires a BOUND-shadow
		// change to be observable. Pass a same-generation TurnState
		// stamp so the terminal shadow can win the rule-3 branch
		// without tripping the UNBOUND demotion guard. (The legacy
		// turn is `streaming` here — pre-repair this test never set
		// the obs seq, post-repair it MUST be set to assert the
		// shadow-wins path against an active legacy phase.)
		const b = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "completed",
				currentLegacyPhase: "streaming",
				seq: 1,
				canonicalShadowObservedTurnSeq: 1,
			}),
		)
		expect(a.phase).toBe("awaiting_followup")
		expect(b.phase).toBe("completed")
	})
})

describe("ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 / absence fallback", () => {
	it("THCP05: shadow absent + legacy `resumable` → source='legacy', phase='resumable' (Hub/Remote)", () => {
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "resumable",
				seq: 4,
			}),
		)
		expect(out).toEqual({ phase: "resumable", source: "legacy", seq: 4 })
	})

	it("ABS_FALLBACK_2: shadow absent + legacy `awaiting_approval` → source='legacy'", () => {
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "awaiting_approval",
				seq: 6,
			}),
		)
		expect(out).toEqual({ phase: "awaiting_approval", source: "legacy", seq: 6 })
	})

	it("ABS_FALLBACK_3: shadow absent + legacy `idle` → source='legacy', phase='idle'", () => {
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 1,
			}),
		)
		expect(out).toEqual({ phase: "idle", source: "legacy", seq: 1 })
	})

	it("ABS_FALLBACK_4: shadow absent + legacy `error` → source='legacy', phase='error'", () => {
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "error",
				seq: 13,
			}),
		)
		expect(out).toEqual({ phase: "error", source: "legacy", seq: 13 })
	})
})

describe("ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 / sequencing", () => {
	it("THCP06: projection.seq is always the legacy TurnStateTracker.seq across all branches", () => {
		const hostBranch = selectTaskHeaderPresentation(
			inputs({ canonicalShadowPhase: "idle", currentLegacyPhase: "compacting", seq: 99 }),
		)
		const shadowBranch = selectTaskHeaderPresentation(
			inputs({ canonicalShadowPhase: "streaming", currentLegacyPhase: "idle", seq: 99 }),
		)
		const legacyBranch = selectTaskHeaderPresentation(
			inputs({ canonicalShadowPhase: undefined, currentLegacyPhase: "resumable", seq: 99 }),
		)
		expect(hostBranch.seq).toBe(99)
		expect(shadowBranch.seq).toBe(99)
		expect(legacyBranch.seq).toBe(99)
	})

	it("SEQ_STAMPING: changing the seq while phase is fixed changes the projection.seq", () => {
		const a = selectTaskHeaderPresentation(inputs({ canonicalShadowPhase: "streaming", currentLegacyPhase: "idle", seq: 1 }))
		const b = selectTaskHeaderPresentation(inputs({ canonicalShadowPhase: "streaming", currentLegacyPhase: "idle", seq: 2 }))
		expect(a.seq).toBe(1)
		expect(b.seq).toBe(2)
		expect(a.phase).toBe(b.phase)
	})
})

describe("ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 / conservation", () => {
	it("THCP09: no background-command coupling — the selector does not read `CommandJobManager` state", () => {
		// The selector only consults canonicalShadowPhase,
		// currentLegacyPhase, and seq. By construction it is
		// orthogonal to background-command processing.
		// Pinned by the absence of any background-command input
		// field on TaskHeaderPresentationInputs and the type
		// signature of `selectTaskHeaderPresentation`.
		const out = selectTaskHeaderPresentation(
			inputs({ canonicalShadowPhase: "streaming", currentLegacyPhase: "idle", seq: 1 }),
		)
		expect(out.source).toBe("shadow")
		expect(out.phase).toBe("streaming")
	})

	it("THCP10: timing is NOT touched — the selector returns only phase, source, seq (no elapsed value)", () => {
		// The TaskHeader state-label path is what this selector
		// drives. Timing is the separate
		// `taskTelemetry.startedAt`/`endedAt` channel (host-owned
		// `TaskTelemetryTracker`) and is not in this selector's
		// outputs.
		const out = selectTaskHeaderPresentation(
			inputs({ canonicalShadowPhase: "streaming", currentLegacyPhase: "idle", seq: 1 }),
		)
		const keys = Object.keys(out).sort()
		expect(keys).toEqual(["phase", "seq", "source"])
	})
})
