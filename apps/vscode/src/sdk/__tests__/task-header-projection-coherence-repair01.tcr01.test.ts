// ===========================================================================
// ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01 /
// THCP11 / TCR01 — STALE-SHADOW-OVERRIDES-FRESH-LEGACY RED.
//
// Why this test exists:
//
//   The LIVE capture from `activity.publication.v1` for
//   taskId 1788189447617_rw5zx epoch=2 published:
//
//     pub 13  turnPhase=idle      taskHeaderPhase=idle      (coherent)
//     pub 15  turnPhase=streaming taskHeaderPhase=idle      (CONTRADICTION)
//     pub 17  turnPhase=streaming taskHeaderPhase=idle      (CONTRADICTION)
//     pub 21  turnPhase=error     taskHeaderPhase=error     (coherent)
//
//   `turnPhase` and `taskHeaderPhase` are snapshot-derived from the
//   SAME publication object (per the activity-publication-v1.ts
//   builder). So the contradiction cannot come from
//   "two different times" — it MUST come from "two different
//   authorities disagreeing on the same instant":
//
//     turnState.phase              ← TurnStateTracker.currentPhase
//                                       (host-driven, synchronous, advances
//                                        on every setTurnPhase() call)
//     taskHeaderPresentation.phase ← selectTaskHeaderPresentation(
//                                       canonicalShadowPhase,
//                                       currentLegacyPhase,
//                                       seq)
//
//   `selectTaskHeaderPresentation`'s branch-3 fires whenever
//   `canonicalShadowPhase !== undefined && !== "compacting" && !==
//   "awaiting_followup"` and returns `phase = canonicalShadowPhase,
//   source = "shadow"` — with NO generation/seq comparison against
//   the legacy phase. So when the canonical shadow last observed a
//   pre-streaming idle event and the legacy tracker has since
//   advanced to "streaming", the selector returns phase="idle" and
//   the publication carries:
//
//     turnState.phase              = "streaming"   (real)
//     taskHeaderPresentation.phase = "idle"        (stale shadow)
//
//   which is exactly the LIVE contradiction this RED reproduces.
//
// REPAIR01 fix surface (the test passes when the fix lands):
//
//   The selector must compare `currentLegacyPhase`'s authoring seq
//   to `canonicalShadowPhase`'s observation seq (or use whatever
//   generation-tagged authority the implementation prefers). When
//   the shadow's last observation predates a more recent legacy
//   transition, the selector must fall back to the legacy branch
//   (preserving the "shadow is authoritative when FRESH" property
//   while forbidding "stale shadow overrides fresh legacy").
//
//   The fix is bounded: one extra input parameter to
//   `selectTaskHeaderPresentation` (`canonicalShadowSeq` /
//   equivalent), one extra precedence check.
//
// This file lives at `apps/vscode/src/sdk/__tests__/...` (not under
// `__tests__/c2-4-c-bridge/`) because the selectors in
// `task-state-shadow-arbiter-mapper.ts` are pure functions in the
// host (`apps/vscode`) and are exercised end-to-end by the
// production-seam vitest suite (`bun run test:unit` /
// `vitest run`); no SDK bridge config is required.
// ===========================================================================

import type { TurnPhase } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	selectTaskHeaderPresentation,
	selectThinkingPresentation,
	type TaskHeaderPresentationInputs,
	type ThinkingPresentationInputs,
} from "../task-state-shadow-arbiter-mapper"
import { emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"

// ---------------------------------------------------------------------------
// Test helpers (mirror thcp01's shape; intentionally duplicated to keep
// the RED self-contained and easy to delete on PASS).
// ---------------------------------------------------------------------------

function taskHeaderInputs(overrides: Partial<TaskHeaderPresentationInputs> = {}): TaskHeaderPresentationInputs {
	return {
		canonicalShadowPhase: undefined,
		currentLegacyPhase: "idle" as TurnPhase,
		seq: 1,
		...overrides,
	}
}

function shadowWith(execution: Partial<ArbiterSnapshot["execution"]> = {}): ArbiterSnapshot {
	return {
		...emptyArbiterSnapshot(),
		execution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
			...execution,
		},
	}
}

function thinkingInputs(overrides: Partial<ThinkingPresentationInputs> = {}): ThinkingPresentationInputs {
	return {
		canonicalShadow: undefined,
		currentLegacyPhase: "idle" as TurnPhase,
		seq: 1,
		...overrides,
	}
}

// ---------------------------------------------------------------------------
// Conservation suite (T1..T11) — proves the repair does NOT regress any
// frozen contract from the THCP01 / E7.1 / THCP11 witnesses. Pinned by
// ACT body PHASE 7.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01 / conservation", () => {
	it("T1: idle turn → task header idle (no shadow)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 1,
			}),
		)
		expect(out).toEqual({ phase: "idle", source: "legacy", seq: 1 })
	})

	it("T2: streaming turn → task header NOT idle (shadow fresh)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowSeq: 5,
			}),
		)
		expect(out.phase).toBe("streaming")
		expect(out.source).toBe("shadow")
	})

	it("T3: completed turn → completed preserved (shadow fresh)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "completed",
				currentLegacyPhase: "completed",
				seq: 10,
				canonicalShadowSeq: 10,
			}),
		)
		expect(out).toEqual({ phase: "completed", source: "shadow", seq: 10 })
	})

	it("T4: error turn → error preserved (shadow fresh)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "error",
				currentLegacyPhase: "error",
				seq: 7,
				canonicalShadowSeq: 7,
			}),
		)
		expect(out).toEqual({ phase: "error", source: "shadow", seq: 7 })
	})

	it("T5: resumable task reopened from History → Resume presentation preserved (shadow absent)", () => {
		// Mirrors `SdkTaskControlCoordinator.showTaskWithId()` which
		// sets turnState.phase = "resumable" with no shadow
		// observation. The selector must fall through to the
		// legacy branch.
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "resumable",
				seq: 3,
			}),
		)
		expect(out).toEqual({ phase: "resumable", source: "legacy", seq: 3 })
	})

	it("T6: completed task reopened → completed presentation preserved (shadow absent)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "completed",
				seq: 4,
			}),
		)
		expect(out).toEqual({ phase: "completed", source: "legacy", seq: 4 })
	})

	it("T7: task switching does not leak previous task phase (no shadow)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 1,
			}),
		)
		expect(out.phase).toBe("idle")
		expect(out.source).toBe("legacy")
	})

	it("T8: cancel fence behavior preserved (legacy 'resumable' beats stale shadow 'streaming')", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "resumable",
				seq: 10,
				canonicalShadowSeq: 5,
			}),
		)
		expect(out.phase).toBe("resumable")
		expect(out.source).toBe("legacy")
	})

	it("T9: stale older projection/generation cannot overwrite newer authoritative phase", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowSeq: 2,
			}),
		)
		expect(out.phase).toBe("streaming")
		expect(out.source).toBe("legacy")
	})

	it("T10: thinking presentation remains coherent with streaming lifecycle (stale shadow fallback)", () => {
		const staleShadow = shadowWith({ modelStreaming: false })
		const out = selectThinkingPresentation(
			thinkingInputs({
				canonicalShadow: staleShadow,
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowSeq: 2,
			}),
		)
		expect(out.modelStreaming).toBe(true)
		expect(out.source).toBe("legacy")
	})

	it("T11: foreground/background command-running presentation remains conserved (fresh shadow wins)", () => {
		const freshShadow = shadowWith({ modelStreaming: true })
		const out = selectThinkingPresentation(
			thinkingInputs({
				canonicalShadow: freshShadow,
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowSeq: 5,
			}),
		)
		expect(out.modelStreaming).toBe(true)
		expect(out.source).toBe("shadow")
	})

	it("T12 (regression guard): host compaction override still wins over fresh shadow", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "awaiting_followup",
				currentLegacyPhase: "compacting",
				seq: 42,
				canonicalShadowSeq: 42,
			}),
		)
		expect(out).toEqual({ phase: "compacting", source: "host", seq: 42 })
	})

	it("T13 (regression guard): shadow equal-or-newer than legacy wins over legacy absence", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "awaiting_followup",
				currentLegacyPhase: "streaming",
				seq: 7,
				canonicalShadowSeq: 7,
			}),
		)
		expect(out).toEqual({ phase: "awaiting_followup", source: "shadow", seq: 7 })
	})

	it("T14: canonicalShadowSeq === undefined keeps legacy-absent fallback (Hub/Remote)", () => {
		const out = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 1,
				// canonicalShadowSeq intentionally omitted
			}),
		)
		// With undefined canonicalShadowSeq, the staleness gate
		// does NOT fire — the shadow branch wins, source="shadow".
		// This is the pre-repair behavior preserved for the
		// "no observation yet" case.
		expect(out.phase).toBe("idle")
		expect(out.source).toBe("shadow")
	})
})
//
// Reproduces the LIVE capture:
//
//   turnState.phase              = "streaming"
//   taskHeaderPresentation.phase = "idle"   <-- MUST NOT HAPPEN
//
// On the current source tree (HEAD = 7caca443b), the selector returns:
//
//   { phase: "idle", source: "shadow", seq: <legacy seq> }
//
// because canonicalShadowPhase="idle" and branch-3 fires. This RED
// will FAIL until the repair enforces shadow-vs-legacy generation
// coherence (Phase 6).
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01 / RED", () => {
	it("THCP11_RED: stale shadow 'idle' MUST NOT override fresh legacy 'streaming' (LIVE capture contradiction)", () => {
		// Reproduction of the LIVE capture at pubId 15/17 of
		// taskId 1788189447617_rw5zx epoch=2:
		//
		//   turnState.phase              = "streaming"
		//   taskHeaderPresentation.phase = "idle"
		//
		// The selector's input contract (post-REPAIR01):
		//   - canonicalShadowPhase: the LAST shadow observation
		//   - currentLegacyPhase:   the LIVE TurnStateTracker phase
		//   - seq:                  the LIVE legacy seq
		//   - canonicalShadowSeq:   the shadow's last-observation seq
		//     (undefined when no shadow observation; otherwise the
		//     seq the comparator had at its last observation)
		//
		// Here the legacy tracker has advanced to seq=5 since the
		// shadow's last observation at seq=2. The shadow says
		// "idle" from that prior observation; the selector must
		// fall through to the legacy branch.
		const projection = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowSeq: 2,
			}),
		)

		// CORE RED ASSERTION:
		//   the published projection MUST agree with the LIVE
		//   turn phase when the legacy phase says "streaming".
		//   An "idle" projection alongside a "streaming"
		//   `turnState` is the defect.
		expect(projection.phase).not.toBe("idle")
		// Stronger form: the projection should match the legacy
		// phase when the shadow is stale (the repair's documented
		// outcome).
		expect(projection.phase).toBe("streaming")
		// The source should also reflect the skew: a stale shadow
		// does not earn the "shadow" attribution.
		expect(projection.source).not.toBe("shadow")
		expect(projection.source).toBe("legacy")
	})

	it("THCP11_RED_INVERSE: stale shadow 'streaming' MUST NOT override fresh legacy 'completed'", () => {
		// Mirror case: the shadow was last observed "streaming"
		// (from a prior turn at seq=8) and the legacy tracker
		// has since advanced to "completed" at seq=12. The
		// selector must NOT return "streaming" as the task-header
		// phase when the legacy phase says "completed".
		const projection = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "completed",
				seq: 12,
				canonicalShadowSeq: 8,
			}),
		)
		expect(projection.phase).not.toBe("streaming")
		expect(projection.phase).toBe("completed")
		expect(projection.source).not.toBe("shadow")
		expect(projection.source).toBe("legacy")
	})

	it("THCP11_RED_FRESH_SHADOW_PRESERVED: when the shadow matches the legacy phase, no regression", () => {
		// The repair MUST NOT regress the "shadow is authoritative
		// when fresh" property (per the E7.1 / THCP01 contract).
		// If shadow and legacy both say "streaming" and the
		// shadow's last observation is at-or-after the legacy's
		// last transition (canonicalShadowSeq >= seq), the
		// selector must still return phase="streaming",
		// source="shadow".
		const projection = selectTaskHeaderPresentation(
			taskHeaderInputs({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowSeq: 5,
			}),
		)
		expect(projection).toEqual({ phase: "streaming", source: "shadow", seq: 5 })
	})

	it("THCP11_THINKING_RED: selectThinkingPresentation modelStreaming must match legacy 'streaming' when shadow is stale", () => {
		// The thinking projection has the same dual-authority
		// structure. With a STALE shadow whose
		// modelStreaming=false (the shadow hasn't observed the
		// current streaming turn — last observation at seq=2
		// while legacy is now at seq=5), the current source
		// returns source="shadow" with modelStreaming=false —
		// same defect class as THCP11.
		//
		// The RED mirrors the THCP11 reproduction exactly.
		const staleShadow = shadowWith({ modelStreaming: false })
		const projection = selectThinkingPresentation(
			thinkingInputs({
				canonicalShadow: staleShadow,
				currentLegacyPhase: "streaming",
				seq: 5,
				canonicalShadowSeq: 2,
			}),
		)
		// CORE RED ASSERTION: modelStreaming must reflect the
		// live legacy phase when the shadow is stale (the repair
		// outcome). On current HEAD (pre-repair), modelStreaming=false
		// is returned from the shadow branch even though the
		// legacy phase is "streaming" — same LIVE contradiction
		// class.
		expect(projection.modelStreaming).toBe(true)
		expect(projection.source).not.toBe("shadow")
		expect(projection.source).toBe("legacy")
	})
})
