/**
 * ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01 / TCCC01-B1
 *
 * STRUCTURAL RED at the production `taskHeaderPresentation`
 * projection seam for the LIVE-W1/W2 contradiction:
 *
 *   - LIVE-W1: TaskHeader reads `Complete` while the same task is
 *     still progressing through real foreground work (model tool
 *     cards, command cards visible, agent narrative continuing).
 *   - LIVE-W2 (shortly after): TaskHeader reads `Idle` while the
 *     SAME task has just become user-owned (Continue CTA visible,
 *     Cancel visible, unfinished continuation content remains,
 *     "Thinking >" disclosure visible).
 *
 * This ACT treats the two screenshots as one chronology. The
 * discriminating question (§6 of the ACT plan) is:
 *
 *   At the SAME publication identity, if Continue is rendered,
 *   then `turnState.phase === "awaiting_followup"` AND the
 *   TaskHeader must show the truthful user-owned phase — NOT
 *   `idle`.
 *
 * REPAIR: minimal CASE_B1 fix — extend the existing host-override
 * branch (the `compacting` precedent at
 * `task-state-shadow-arbiter-mapper.ts:399-407`) to include
 * `currentLegacyPhase === "awaiting_followup"` as an authoritative
 * host-owned label. The shadow cannot represent `awaiting_followup`;
 * the host is the only legitimate authority for that label.
 *
 * CONSERVATION: THCP11 host-override stays GREEN (P5);
 * LAC01 active non-idle stays GREEN; AOPC02 publication
 * fencing stays GREEN; RSP / LTZ / completion liveness /
 * task-control / STP / async-command contract untouched.
 */
import type { TurnPhase, TurnState } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MessageIdMinter } from "../message-id-minter"
import { selectTaskHeaderPresentation } from "../task-state-shadow-arbiter-mapper"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

type StateLabelProjection = { label: string; glyph: string; live: boolean }

function stateLabel(phase: TurnPhase | undefined): StateLabelProjection {
	switch (phase) {
		case "idle":
			return { label: "Idle", glyph: "○", live: false }
		case "streaming":
			return { label: "Working", glyph: "●", live: true }
		case "awaiting_approval":
			return { label: "Approval", glyph: "?", live: true }
		case "awaiting_followup":
			return { label: "Waiting", glyph: "…", live: true }
		case "compacting":
			return { label: "Compacting", glyph: "⌄", live: true }
		case "completed":
			return { label: "Complete", glyph: "✓", live: false }
		case "error":
			return { label: "Error", glyph: "!", live: false }
		case "resumable":
			return { label: "Paused", glyph: "↻", live: false }
		default:
			return { label: "Unknown", glyph: "?", live: false }
	}
}

function taskHeaderPresentationStateLabel(
	taskHeaderProjection: { phase: TurnPhase; source: "host" | "shadow" | "legacy"; seq: number } | undefined,
	turnState: TurnState | undefined,
): StateLabelProjection {
	if (taskHeaderProjection) {
		return stateLabel(taskHeaderProjection.phase)
	}
	return stateLabel(turnState?.phase)
}

function projectPublication(opts: { tracker: TurnStateTracker; getCanonicalShadowPhase: () => TurnPhase | undefined }): {
	taskHeaderProjection: { phase: TurnPhase; source: "host" | "shadow" | "legacy"; seq: number }
	turnState: TurnState
} {
	const turnState = opts.tracker.get()
	const taskHeaderProjection = selectTaskHeaderPresentation({
		canonicalShadowPhase: opts.getCanonicalShadowPhase(),
		currentLegacyPhase: opts.tracker.currentPhase,
		seq: turnState.seq,
	})
	return { taskHeaderProjection, turnState }
}

describe("ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01 / TCCC01-B1", () => {
	let minter: MessageIdMinter
	let tracker: TurnStateTracker

	beforeEach(() => {
		vi.clearAllMocks()
		minter = new MessageIdMinter()
		tracker = new TurnStateTracker(minter)
	})

	it("P1: at awaiting_followup with observed shadow projecting 'idle', the production selector MUST collapse to awaiting_followup (CASE_B1 RED before repair)", () => {
		tracker.set("idle")
		const shadowProjectedPhase: TurnPhase = "idle"

		const askMessageTs = 12345
		tracker.set("awaiting_followup", askMessageTs)

		const { taskHeaderProjection, turnState } = projectPublication({
			tracker,
			getCanonicalShadowPhase: () => shadowProjectedPhase,
		})

		expect.soft(turnState.phase, "legacy phase must be awaiting_followup (real Continue authority)").toBe("awaiting_followup")
		expect.soft(turnState.anchorTs, "anchorTs must equal the ask message ts (real Continue authority)").toBe(askMessageTs)

		expect
			.soft(
				taskHeaderProjection.phase,
				"taskHeaderPresentation.phase must NOT be 'idle' when legacy is awaiting_followup (CASE_B1)",
			)
			.not.toBe("idle")
		expect
			.soft(
				taskHeaderProjection.phase,
				"taskHeaderPresentation.phase MUST equal 'awaiting_followup' for coherent publication",
			)
			.toBe("awaiting_followup")
		expect.soft(taskHeaderProjection.source, "host is the only authority that can represent awaiting_followup").toBe("host")

		const label = taskHeaderPresentationStateLabel(taskHeaderProjection, turnState)
		expect.soft(label.label, "user-visible TaskHeader label must be 'Waiting' for the continuation state").toBe("Waiting")
		expect.soft(label.live, "Waiting must be live (elapsed clock keeps ticking while paused for follow-up)").toBe(true)
	})

	it("P2: at awaiting_followup with NO observed shadow, the selector returns awaiting_followup via the host-override branch (mirroring compaction precedent)", () => {
		tracker.set("awaiting_followup", 12345)

		const { taskHeaderProjection, turnState } = projectPublication({
			tracker,
			getCanonicalShadowPhase: () => undefined,
		})

		expect.soft(turnState.phase).toBe("awaiting_followup")
		expect.soft(taskHeaderProjection.phase, "user-visible phase MUST surface awaiting_followup").toBe("awaiting_followup")
		expect
			.soft(
				taskHeaderProjection.source,
				"host override wins when currentLegacyPhase === awaiting_followup (matches compaction precedent)",
			)
			.toBe("host")

		const label = taskHeaderPresentationStateLabel(taskHeaderProjection, turnState)
		expect.soft(label.label).toBe("Waiting")
	})

	it("P3: at awaiting_followup with shadow ALSO projecting 'awaiting_followup', the host-override branch still wins (matches compaction precedent)", () => {
		tracker.set("awaiting_followup", 12345)

		const { taskHeaderProjection } = projectPublication({
			tracker,
			getCanonicalShadowPhase: () => "awaiting_followup",
		})

		expect.soft(taskHeaderProjection.phase).toBe("awaiting_followup")
		expect
			.soft(
				taskHeaderProjection.source,
				"host override wins over shadow for awaiting_followup (same as compaction precedent)",
			)
			.toBe("host")
	})

	it("P4: at 'completed' with shadow projecting 'completed', TaskHeader stays 'Complete' (W1 / completed-projection fencing conservation)", () => {
		tracker.set("completed", 12345)

		const { taskHeaderProjection } = projectPublication({
			tracker,
			getCanonicalShadowPhase: () => "completed",
		})

		expect.soft(taskHeaderProjection.phase).toBe("completed")
		expect.soft(taskHeaderProjection.source).toBe("shadow")

		const label = taskHeaderPresentationStateLabel(taskHeaderProjection, undefined)
		expect.soft(label.label).toBe("Complete")
	})

	it("P5: at 'compacting' the host-override branch still wins (THCP11 conservation)", () => {
		tracker.set("compacting", 12345)

		const { taskHeaderProjection } = projectPublication({
			tracker,
			getCanonicalShadowPhase: () => "streaming",
		})

		expect.soft(taskHeaderProjection.phase).toBe("compacting")
		expect.soft(taskHeaderProjection.source).toBe("host")

		const label = taskHeaderPresentationStateLabel(taskHeaderProjection, undefined)
		expect.soft(label.label).toBe("Compacting")
	})
})
