// ============================================================================
// ACT-CLINEMM-TASKHEADER-UNOBSERVED-IDLE-DEMOTES-COMPLETED-REPAIR01
//
// RED suite -- drives the REAL production Elm kernel via
// `invokeElmKernel` against the ACT's proposed fixture:
//
//   canonicalShadowPhase           = "idle"
//   currentLegacyPhase             = "completed"
//   seq                            = 1309
//   canonicalShadowObservedTurnSeq = undefined
//
// This is the UNOBSERVED-idle branch the proposed bounded repair
// targets: an UNBOUND shadow projecting `idle` against an
// authoritative `completed` legacy TurnState.
//
// LIVE-defect shape (per ACT §3):
//   The task has committed completion evidence; the host's
//   TurnStateTracker records `currentLegacyPhase = "completed"` at
//   seq 1309; the canonical shadow was sampled at the seam but has
//   no `canonicalShadowObservedTurnSeq` (no `lastObservedTurnSeqByPhase`
//   entry for the projected phase). The selector MUST fall through
//   to the legacy branch -- the host's committed `completed` is the
//   truthful user-visible surface.
//
// At HEAD this assertion is predicted to RED with
//   { phase: "idle", source: "shadow", seq: 1309 }
// which is the exact LIVE defect.
//
// The RED must be observed against the COMPILED Elm kernel, not a
// mock. The test deliberately reuses the production
// `buildFactsJson` / `invokeElmKernel` seam that the existing
// `task-header-elm-orchestration-authority01.test.ts` ELM-AUTH
// describe block uses, so the RED is mechanically observed against
// the production authority.
//
// Provenance note (per ACT §3 critical provenance check): the live
// capture diagnostic
// (`apps/vscode/src/sdk/task-header-selector-input-capture.ts`) has
// not yet bound a `stateVersion=1310` record on the local file
// system at the time of authoring. This RED therefore exercises the
// ACT's PROPOSED input tuple against the production kernel; it is
// not labelled a LIVE reproduction. The fixture is the canonical
// selector-input shape that would yield the LIVE defect, derived
// from the §3 published table and from the production seam at
// SdkController.ts:6117-6142.
//
// EVIDENCE CLASSIFICATION:
//   SYNTHETIC_REAL via the real `invokeElmKernel` production seam.
// ============================================================================

import { describe, expect, it } from "vitest"
import { buildFactsJson, invokeElmKernel, type TaskHeaderElmDecision } from "../task-header-elm-shadow"

describe("ACT-CLINEMM-TASKHEADER-UNOBSERVED-IDLE-DEMOTES-COMPLETED-REPAIR01 / RED", () => {
	it("TUIDC01-RED-PHASE: legacy=completed + UNBOUND shadow=idle MUST NOT demote committed completion", async () => {
		// The ACT's proposed fixture (§4):
		//   canonicalShadowPhase           = "idle"        (UNBOUND shadow last projection)
		//   currentLegacyPhase             = "completed"   (authoritative host completion)
		//   seq                            = 1309          (TurnStateTracker seq)
		//   canonicalShadowObservedTurnSeq = undefined     (UNBOUND -- no observation stamp)
		const facts = {
			canonicalShadowPhase: "idle" as const,
			currentLegacyPhase: "completed" as const,
			seq: 1309,
			canonicalShadowObservedTurnSeq: undefined,
		}
		const decision: TaskHeaderElmDecision = await invokeElmKernel(buildFactsJson(facts))
		expect(decision.kind).toBe("presentation")
		if (decision.kind !== "presentation") {
			throw new Error(`ELM_DECODE_ERROR on RED fixture: ${JSON.stringify(decision)}`)
		}
		// The host's committed `completed` MUST win. At HEAD this is
		// predicted to RED -- decision.value.phase === "idle" (the
		// captured defect).
		expect(decision.value.phase).toBe("completed")
	})

	it("TUIDC01-RED-SOURCE: shadow MUST NOT be granted authority over committed completion when UNBOUND", async () => {
		// Companion assertion: the demotion must not carry shadow
		// provenance when the shadow has no TurnState-domain stamp.
		const facts = {
			canonicalShadowPhase: "idle" as const,
			currentLegacyPhase: "completed" as const,
			seq: 1309,
			canonicalShadowObservedTurnSeq: undefined,
		}
		const decision = await invokeElmKernel(buildFactsJson(facts))
		if (decision.kind !== "presentation") {
			throw new Error(`ELM_DECODE_ERROR on RED-SOURCE fixture: ${JSON.stringify(decision)}`)
		}
		const isShadowGrantedAuthorityOverCompleted = decision.value.source === "shadow" && decision.value.phase === "idle"
		expect(isShadowGrantedAuthorityOverCompleted).toBe(false)
	})

	it("TUIDC01-RED-SEQ: input seq is preserved verbatim", async () => {
		// The Elm kernel must preserve the input seq verbatim (no
		// hold-last-good, no stale seq publication). The ACT §6
		// explicit rule: "For all cases, preserve the exact input seq."
		const facts = {
			canonicalShadowPhase: "idle" as const,
			currentLegacyPhase: "completed" as const,
			seq: 1309,
			canonicalShadowObservedTurnSeq: undefined,
		}
		const decision = await invokeElmKernel(buildFactsJson(facts))
		if (decision.kind !== "presentation") {
			throw new Error(`ELM_DECODE_ERROR on RED-SEQ fixture: ${JSON.stringify(decision)}`)
		}
		expect(decision.value.seq).toBe(1309)
	})
})

// ============================================================================
// ACT-CLINEMM-TASKHEADER-UNOBSERVED-IDLE-DEMOTES-COMPLETED-REPAIR01
// Publication seam witness.
//
// Per ACT §8: pure Elm success alone is insufficient for a user-visible
// repair. This describe block drives the ACTUAL production-side
// adapter `pickTaskHeaderPresentationForPublication` (no DI) so the
// real compiled kernel is the load-bearing authority. The four
// production-seam inputs the SdkController.getStateToPostToWebview
// seam reaches at line 6117-6142 are passed verbatim.
// ============================================================================

describe("ACT-CLINEMM-TASKHEADER-UNOBSERVED-IDLE-DEMOTES-COMPLETED-REPAIR01 / publication", () => {
	it("TUIDC01-PUB: real publication adapter returns completed/legacy at seq 1309", async () => {
		// The SdkController reaches the production adapter with
		// exactly these four input fields (per
		// SdkController.ts:6117-6142). This test is the
		// "ExtensionState.taskHeaderPresentation" assert from
		// ACT §8 step 8.
		const { pickTaskHeaderPresentationForPublication } = await import("../task-header-elm-authority")
		const result = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "completed",
			seq: 1309,
			canonicalShadowObservedTurnSeq: undefined,
		})
		expect(result.phase).toBe("completed")
		expect(result.source).toBe("legacy")
		expect(result.seq).toBe(1309)
	})

	it("TUIDC01-PUB-SEQ: real publication adapter preserves input seq verbatim", async () => {
		// The seq-preservation invariant: the publication adapter
		// must publish the CURRENT input.seq, never a held
		// last-good.
		const { pickTaskHeaderPresentationForPublication } = await import("../task-header-elm-authority")
		const result = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "completed",
			seq: 27545,
			canonicalShadowObservedTurnSeq: undefined,
		})
		expect(result.seq).toBe(27545)
	})

	it("TUIDC01-PUB-LIFECYCLE: new task returning to idle after completed is not stuck", async () => {
		// ACT §9 adversarial check: "verify that the repair does
		// not make `completed` permanently sticky. The existing
		// current-task lifecycle must remain capable of returning
		// the header to `idle` when genuinely appropriate."
		//
		// Two-step lifecycle:
		//   step 1: legacy=completed, shadow=idle, UNBOUND
		//     -> legacy completed (G01)
		//   step 2: same task, then the user starts a new task
		//           and the host transitions to legacy=idle,
		//           shadow=idle, UNBOUND
		//     -> shadow idle (the new guard's third clause
		//        `currentLegacyPhase == PhaseCompleted` no longer
		//        matches, so R3 shadow branch runs)
		const { pickTaskHeaderPresentationForPublication } = await import("../task-header-elm-authority")
		const completed = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "completed",
			seq: 1309,
			canonicalShadowObservedTurnSeq: undefined,
		})
		expect(completed).toStrictEqual({ phase: "completed", source: "legacy", seq: 1309 })

		const newTask = await pickTaskHeaderPresentationForPublication({
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "idle",
			seq: 1, // fresh TurnStateTracker seq for the new task
			canonicalShadowObservedTurnSeq: undefined,
		})
		// After the new task lifecycle, shadow idle wins (the
		// ABSEQUAL precedent: when shadow == legacy, shadow source
		// is preferred). The header is NOT pinned to "completed".
		expect(newTask.phase).toBe("idle")
		expect(newTask.source).toBe("shadow")
		expect(newTask.seq).toBe(1)
	})
})
