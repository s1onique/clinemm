// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01
//
// RED suite -- drives the REAL production selector
// selectTaskHeaderPresentation at the TaskHeader source/phase decision
// point that SdkController.getStateToPostToWebview reaches at
// apps/vscode/src/sdk/SdkController.ts:4104. The selector is the single
// producer of taskHeaderPresentation.phase and taskHeaderPresentation.source;
// the webview TaskHeader state label consumes those two fields directly.
// The activity.publication.v1 builder reads the same projection as
// taskHeaderPhase / taskHeaderSource on the diagnostic wire.
//
// LIVE specimen:
//   - Task: taskId 1788292664979_9qbpd, epoch 16
//   - LIVE TSWPD: writerId=controller-epoch-transition-reseed,
//     previous={phase:"streaming",seq:27543},
//     committed={phase:"streaming",seq:27545}
//     -> NO active->idle TurnState write was observed in epoch 16.
//     The previous bounded repair
//     (ACT-CLINEMM-RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01)
//     is NOT contradicted by this specimen.
//   - LIVE activity publication (publicationId 27546 onwards):
//       publicationId            = 27546
//       hostStatus               = "idle"
//       turnPhase                = "streaming"
//       taskHeaderPhase          = "idle"
//       taskHeaderSource         = "shadow"
//       shadowPublicationBinding = "UNBOUND"
//       modelStreaming           = false
//       toolActive               = false
//
// Hypothesis:
//   an UNBOUND shadow idle state is being allowed to demote authoritative
//   active TurnState during TaskHeader projection.
//
// Selector inspection:
//   selectTaskHeaderPresentation(input) at
//   apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:505 has FOUR rules:
//     1. HOST COMPACTION OVERRIDE            (currentLegacyPhase === "compacting")
//     2. HOST AWAITING_FOLLOWUP OVERRIDE     (currentLegacyPhase === "awaiting_followup")
//     3. CANONICAL SHADOW                    (canonicalShadowPhase !== undefined && !stale)
//     4. ABSENCE FALLBACK                    (legacy)
//
//   The staleness gate reads:
//     const isShadowStale =
//       input.canonicalShadowObservedTurnSeq !== undefined &&
//       input.seq > input.canonicalShadowObservedTurnSeq
//
//   Crucial: when canonicalShadowObservedTurnSeq === undefined (the UNBOUND
//   case at activity-publication-v1.ts:148), the gate does NOT fire -- the
//   shadow branch wins. This is the bug.
//
// REPRODUCTION PROOF:
//   The LIVE-shaped tuple reaches the selector as:
//     canonicalShadowPhase           = "idle"
//     currentLegacyPhase             = "streaming"
//     seq                            = 27545
//     canonicalShadowObservedTurnSeq = undefined
//
//   The selector currently returns
//     { phase: "idle", source: "shadow", seq: 27545 }
//   which is exactly the LIVE contradiction the ACT names.
//
//   This RED inverts the LIVE defect to a load-bearing assertion:
//     expected: not "idle"
//     received: "idle"
//   to mechanically prove that the production selector yields the LIVE-bug
//   tuple at HEAD.
//
// EVIDENCE CLASSIFICATION:
//   Uses the REAL selectTaskHeaderPresentation production selector -- no
//   shadowing, no re-implementation, no new Function() extractor. Per the
//   prompt §4 the discriminator composition is therefore
//   SYNTHETIC_REAL through REAL_PRODUCTION_SEAM (the synthetic aspect is
//   the LIVE-shape-input token constructed from the captured publication;
//   the production seam is the real selector itself).
// ===========================================================================

import type { TurnPhase } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { selectTaskHeaderPresentation, type TaskHeaderPresentationInputs } from "../task-state-shadow-arbiter-mapper"

// Production-seam input token. LIVE publicationId 27546 reaches the
// selector as the four production-seam fields below.
function inputs(overrides: Partial<TaskHeaderPresentationInputs> = {}): TaskHeaderPresentationInputs {
	return {
		canonicalShadowPhase: undefined,
		currentLegacyPhase: "idle" as TurnPhase,
		seq: 1,
		...overrides,
	}
}

describe("ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01 / LIVE-bug RED", () => {
	it("TUSA01-RED: LIVE-shaped UNBOUND shadow idle MUST NOT demote authoritative legacy streaming", () => {
		// LIVE publicationId 27546 reaches the selector as:
		//   canonicalShadowPhase           = "idle"  (UNBOUND shadow last observation)
		//   currentLegacyPhase             = "streaming" (authoritative TurnStateTracker)
		//   seq                            = 27545  (TurnStateTracker seq at publication)
		//   canonicalShadowObservedTurnSeq = undefined (UNBOUND: ArbiterSnapshot
		//                                                carries no generation identity)
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 27545,
				// canonicalShadowObservedTurnSeq intentionally omitted (UNBOUND)
			}),
		)
		// Bounded authority invariant: an UNBOUND shadow idle projection
		// cannot demote an authoritative active TurnState. At HEAD this
		// assertion REDs -- out.phase === "idle" (LIVE defect captured).
		expect(out.phase).not.toBe("idle")
	})

	it("TUSA01-RED-SOURCE: LIVE-shaped UNBOUND shadow MUST NOT yield source=shadow against authoritative active TurnState", () => {
		// Companion assertion: the demotion must not be granted shadow
		// provenance when the shadow has no TurnState-domain provenance
		// stamp. Either source=legacy or source=host is acceptable AFTER
		// repair; today it is shadow, which is the LIVE defect.
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 27545,
			}),
		)
		const isShadowGrantedAuthorityOverActive = out.source === "shadow" && out.phase === "idle"
		expect(isShadowGrantedAuthorityOverActive).toBe(false)
	})
})

describe("ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01 / CONTROL_A", () => {
	it("TUSA01-CTL_A: legacy=idle + UNBOUND shadow=idle -> taskHeaderPhase remains idle", () => {
		// Conservation: when authoritative legacy is already idle, the
		// UNBOUND shadow idle is consistent with it. TaskHeader may render
		// "Idle" in this case.
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "idle",
				seq: 1,
			}),
		)
		expect(out.phase).toBe("idle")
	})
})

describe("ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01 / CONTROL_D", () => {
	it("TUSA01-CTL_D: UNBOUND shadow=streaming agreeing with legacy=streaming -> shadow wins", () => {
		// Bounded conservation: an UNBOUND shadow non-idle phase that
		// agrees with authoritative active phase must not be rejected.
		// This pins the rule scope to demotion (idle shadow against
		// active legacy) only.
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "streaming",
				seq: 17,
			}),
		)
		expect(out.phase).toBe("streaming")
	})
})

describe("ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01 / regression guards", () => {
	it("TUSA01-REG_T9: REPAIR01-CORRECTION02 T9 -- stale shadow with explicit seq=2 demoted by legacy", () => {
		// REPAIR01-CORRECTION02 load-bearing RED (T9 in tcr01.test.ts):
		// stale shadow with explicit canonicalShadowObservedTurnSeq
		// proven stale relative to legacy MUST fall through to legacy.
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowObservedTurnSeq: 2,
			}),
		)
		expect(out.phase).toBe("streaming")
		expect(out.source).toBe("legacy")
	})

	it("TUSA01-REG_HOST_COMPACTING: host legacy compacting beats UNBOUND shadow idle", () => {
		// Host compaction override remains authoritative for the
		// compacting label, regardless of shadow binding.
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "compacting",
				seq: 7,
			}),
		)
		expect(out.phase).toBe("compacting")
		expect(out.source).toBe("host")
	})

	it("TUSA01-REG_HOST_AWAITING_FOLLOWUP: host legacy awaiting_followup beats UNBOUND shadow idle", () => {
		// TCCC01-B1 host override remains authoritative for the
		// awaiting_followup label, regardless of shadow binding.
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "awaiting_followup",
				seq: 11,
			}),
		)
		expect(out.phase).toBe("awaiting_followup")
		expect(out.source).toBe("host")
	})

	it("TUSA01-REG_FRESH_SHADOW_WINS: shadow with fresh TurnState-domain seq wins over stale legacy", () => {
		// Bound authority rule does not break the legitimate shadow-wins
		// path when shadow carries a TurnState-domain provenance stamp
		// at-or-newer than the legacy seq.
		const out = selectTaskHeaderPresentation(
			inputs({
				canonicalShadowPhase: "awaiting_followup",
				currentLegacyPhase: "streaming",
				seq: 7,
				canonicalShadowObservedTurnSeq: 7,
			}),
		)
		expect(out.phase).toBe("awaiting_followup")
		expect(out.source).toBe("shadow")
	})
})
