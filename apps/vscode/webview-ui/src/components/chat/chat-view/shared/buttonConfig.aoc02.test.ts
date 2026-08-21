/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 / AOC02 §2
 * Cancel-authority discriminator.
 *
 * Per Factory reviewer's strict stop order:
 *
 *   1. §2 CANCEL AUTHORITY FIRST
 *   2. §3 REAL PRODUCER OBJECT
 *   3. §6 REAL PARTIAL SUBSCRIPTION PATH
 *
 * This test executes §2 ONLY.
 *
 * Question:
 *
 *   Can the REAL production predicate `getButtonConfigFromState(...)`
 *   render Cancel while ALL of these hold at one committed state?
 *
 *     turnState.phase === "idle"
 *     foregroundCommandRunning === true
 *
 *   The LIVE screenshot at s1onique.clinemm@4.1.10-4fd4dda6b proves:
 *
 *     TaskHeader = Idle
 *     Cancel visible
 *
 *   It does NOT prove the foreground-command ownership value. The
 *   evidence label is therefore:
 *
 *     LIVE_FOREGROUND_COMMAND_RUNNING = UNPROVEN_FROM_SCREENSHOT
 *
 *   §2 ran the foregroundCommandRunning=true case as an adversarial
 *   input -- even if fgCmd is true, the production predicate still
 *   gives no Cancel for turnState.phase === "idle". That is the
 *   stronger, screenshot-independent finding.
 *
 * Method:
 *
 *   - Use the real `getButtonConfigFromState` predicate (the production
 *     caller is `ActionButtons.tsx:53`).
 *   - Use the real `buttonsForPhase` switch (the production route when
 *     `turnState` is present, which it is on the SDK path).
 *   - Drive all four (phase × foregroundCommandRunning) combinations.
 *
 * CONSERVATION:
 *
 *   This test does NOT modify any production code. It does NOT reopen
 *   AOC01 4/4 GREEN, AOPC02 stale full-state fencing, TCCC01 CASE_B1
 *   awaiting_followup host override, THCP/LAC/RSP/LTZ/task-control,
 *   RBE01, or the canonical coverage ratchet.
 *
 * STOP RULE (per ACT §7 / §15):
 *
 *   - If any control below shows the LIVE contradiction (idle + fgCmd =
 *     Cancel visible), classify `CASE_G_COMMAND_OWNERSHIP_NOT_PROJECTED`
 *     and STOP. Do not cascade to §3-§6.
 *   - If all four controls show the idle branch returning the
 *     `default` config (no Cancel), §2 is GREEN; proceed to §3
 *     producer-object discriminator in a follow-up test file.
 */

import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { BUTTON_CONFIGS, buttonsForPhase, getButtonConfigFromState } from "./buttonConfig"

// -----------------------------------------------------------------------
// Real production predicate caller signature (ActionButtons.tsx:53):
//
//   getButtonConfigFromState(messages, turnState, mode, foregroundCommandRunning)
//
// We exercise BOTH the convenience function (with empty messages) AND
// the underlying `buttonsForPhase` switch directly. The two routes
// must agree — they do, because `getButtonConfigFromState` is a thin
// wrapper when `turnState` is defined.
// -----------------------------------------------------------------------

function ts(phase: TurnState["phase"]): TurnState {
	return { phase, anchorTs: undefined, seq: 1 }
}

const emptyMessages: ClineMessage[] = []

describe("AOC02 §2 — Cancel authority under LIVE-shape inputs", () => {
	describe("buttonsForPhase (real production switch, ActionButtons.tsx:53)", () => {
		it("idle + foregroundCommandRunning=true => no Cancel (default config)", () => {
			const cfg = buttonsForPhase(ts("idle"), undefined, true)
			expect(cfg).toBe(BUTTON_CONFIGS.default)
			expect(cfg.secondaryText).toBeUndefined()
			expect(cfg.secondaryAction).toBeUndefined()
			expect(cfg.primaryText).toBeUndefined()
			expect(cfg.primaryAction).toBeUndefined()
			expect(cfg.enableButtons).toBe(false)
		})

		it("idle + foregroundCommandRunning=false => no Cancel (default config)", () => {
			const cfg = buttonsForPhase(ts("idle"), undefined, false)
			expect(cfg).toBe(BUTTON_CONFIGS.default)
			expect(cfg.secondaryText).toBeUndefined()
			expect(cfg.secondaryAction).toBeUndefined()
		})

		it("streaming + foregroundCommandRunning=true => Cancel visible (foreground_command_running config)", () => {
			const cfg = buttonsForPhase(ts("streaming"), undefined, true)
			expect(cfg).toBe(BUTTON_CONFIGS.foreground_command_running)
			expect(cfg.secondaryText).toBe("Cancel")
			expect(cfg.secondaryAction).toBe("cancel")
			expect(cfg.primaryText).toBe("Proceed While Running")
		})

		it("streaming + foregroundCommandRunning=false => Cancel visible (partial config)", () => {
			const cfg = buttonsForPhase(ts("streaming"), undefined, false)
			expect(cfg).toBe(BUTTON_CONFIGS.partial)
			expect(cfg.secondaryText).toBe("Cancel")
			expect(cfg.secondaryAction).toBe("cancel")
		})
	})

	describe("getButtonConfigFromState (real production wrapper, ActionButtons.tsx:53)", () => {
		it("idle + foregroundCommandRunning=true => no Cancel (delegates to default)", () => {
			const cfg = getButtonConfigFromState(emptyMessages, ts("idle"), "act", true)
			expect(cfg).toBe(BUTTON_CONFIGS.default)
			expect(cfg.secondaryText).toBeUndefined()
			expect(cfg.secondaryAction).toBeUndefined()
		})

		it("idle + foregroundCommandRunning=false => no Cancel", () => {
			const cfg = getButtonConfigFromState(emptyMessages, ts("idle"), "act", false)
			expect(cfg).toBe(BUTTON_CONFIGS.default)
			expect(cfg.secondaryText).toBeUndefined()
			expect(cfg.secondaryAction).toBeUndefined()
		})

		it("streaming + foregroundCommandRunning=true => Cancel visible", () => {
			const cfg = getButtonConfigFromState(emptyMessages, ts("streaming"), "act", true)
			expect(cfg.secondaryText).toBe("Cancel")
			expect(cfg.secondaryAction).toBe("cancel")
		})

		it("streaming + foregroundCommandRunning=false => Cancel visible", () => {
			const cfg = getButtonConfigFromState(emptyMessages, ts("streaming"), "act", false)
			expect(cfg.secondaryText).toBe("Cancel")
			expect(cfg.secondaryAction).toBe("cancel")
		})
	})

	describe("§2 classification (the LIVE contradiction)", () => {
		it("LIVE shape: turnState=idle + fgCmd=true => Cancel is NOT produced by the production predicate", () => {
			// This is the AOC01 gap closed: AOC01 fixed foregroundCommandRunning=false
			// in every fixture; AOC02 §2 runs the LIVE-shape input
			// (foregroundCommandRunning=true) explicitly and observes the result.
			const cfg = getButtonConfigFromState(emptyMessages, ts("idle"), "act", true)
			const hasCancel = cfg.secondaryAction === "cancel"
			// The production predicate cannot produce Idle + Cancel from a
			// coherent committed state. The LIVE screenshot's `Idle + Cancel`
			// must therefore come from one of:
			//   (a) a stale buttonConfig cached before turnState advanced to idle
			//       (RED at §3 / §5 / §6 — partial-subscription or stale-cache),
			//   (b) the LEGACY path (turnState=undefined, falling through to
			//       getButtonConfigForMessages tail-walking — RED at §3 producer
			//       which we will inspect in a follow-up test),
			//   (c) the LIVE build is calling something other than the real
			//       predicate (RED at the production-caller surface, §3).
			expect(hasCancel).toBe(false)
		})
	})
})
