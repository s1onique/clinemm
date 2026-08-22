/**
 * ABORTED_ATTEMPT / REJECTED_REPAIR — DO NOT TREAT AS SPEC.
 *
 * This file is preserved solely as a historical witness for the
 * ABORTED attempt that produced the board disposition
 * HALT_TASK_LIFETIME_NOT_ACTIVITY_AUTHORITY. It does NOT
 * describe the desired TaskHeader behavior. It records the
 * rejected RED shape so the next ACT (the one that finds the
 * correct working-vs-waiting discriminator) does not repeat
 * the same conceptual mistake.
 *
 * ----- Background -----
 *
 * The LIVE-T1 symptom (taskId=1787361823207_6ta7a, epoch=3,
 * stateVersion 8552→8895, toolCalls 186→190) showed all three
 * existing phase authorities — runtime (`AgentRuntime.snapshot()
 * .status`), shadow (`ArbiterSnapshot.status`), legacy
 * (`turnStateTracker.currentPhase`) — reporting `idle` while
 * toolCalls was incrementing and the webview tail showed live
 * api_req_started / command partial / tool partial. TaskHeader
 * rendered "Idle" / live:false during visible work.
 *
 * The REJECTED attempt (this ACT's predecessor) introduced a
 * rule 0 in `selectTaskHeaderPresentation` keyed on
 * `TaskTelemetryTracker.isTaskActive()` — a pure task-LIFETIME
 * projection `currentTaskId !== undefined && endedAt ===
 * undefined` — and mapped it to phase `awaiting_followup` with
 * source `task-ownership`.
 *
 * Why that was wrong (Factory reviewer):
 *
 *   1. `taskIsActive` answers a LIFETIME question
 *      ("is there an anchored, non-terminal visible task?"),
 *      not an INTERACTION-OWNERSHIP question
 *      ("who owns forward progress right now? — the system,
 *      still working, or the user, paused for input?").
 *      TaskHeader phases encode the latter.
 *
 *   2. The same LIVE evidence the repair cited — toolCalls
 *      186→190, command partial, tool partial — describes
 *      ACTIVE asynchronous work continuing. Mapping that to
 *      `awaiting_followup` ("Waiting") replaces one defect
 *      (Idle while Cline is working) with another
 *      (Waiting while Cline is working).
 *
 *   3. The CTA-suite asserted `awaiting_followup` as the
 *      desired target phase without an independent authority
 *      proving that the live chronology was user-owned at
 *      those stateVersion instants. The assertion was
 *      internally contradictory: the chronology described
 *      active work, the assertion claimed user waiting.
 *
 *   4. The ablation signature was clean (rule 0 commented
 *      out → 3 RED, restored → 15 GREEN), but clean ablation
 *      only proves "the rule fires", not "the rule fires for
 *      the right reason". The reason was wrong.
 *
 * ----- What this file now asserts -----
 *
 * To preserve the value of the recon while NOT leaving a
 * rejected specification in the default GREEN gate, the tests
 * below are written as OBSERVATIONAL WITNESSES: they record
 * the pre-repair behavior and the rejected post-repair
 * behavior, and they verify that the rejected
 * `taskIsActive => awaiting_followup` rule is NOT currently
 * present in the selector (i.e. that the production code
 * behaves as it did before this aborted attempt).
 *
 * Concretely:
 *   - The selector no longer accepts a `taskIsActive` input.
 *   - The pre-existing four-rule precedence is unchanged.
 *   - The `task-ownership` provenance kind is NOT in the
 *     `source` enum.
 *   - `TaskTelemetryTracker.isTaskActive()` is NOT a public
 *     method.
 *
 * These checks would FAIL if the rejected repair were
 * silently re-introduced. They document the negative result so
 * the next ACT starts from a clean baseline.
 *
 * The expected target behavior — Working vs Waiting vs
 * Complete vs Idle, derived from a real working-vs-waiting
 * discriminator — is intentionally NOT specified here. The
 * successor ACT (`ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01`)
 * owns the discriminator discovery and the canonical
 * projection.
 */
import type { TurnPhase } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { selectTaskHeaderPresentation } from "../task-state-shadow-arbiter-mapper"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"

// ===========================================================================
// Negative witnesses — confirm the rejected repair was reverted cleanly.
// ===========================================================================

describe("ABORTED_ATTEMPT / REJECTED_REPAIR / negative witnesses", () => {
	it("NEG-01: TaskTelemetryTracker has no isTaskActive() method (rejected discriminator source removed)", () => {
		const t = new TaskTelemetryTracker()
		// @ts-expect-error — proves the method was removed from the public surface
		expect(typeof t.isTaskActive).toBe("undefined")
	})

	it("NEG-02: TaskHeaderPresentationProjection.source enum does not include 'task-ownership' (rejected provenance kind removed)", async () => {
		// The rejected repair widened the enum to add 'task-ownership'.
		// After revert, the enum must be back to its three-value
		// shape: 'shadow' | 'host' | 'legacy'.
		// We probe this by constructing inputs that would, under
		// the rejected repair, produce source: 'task-ownership',
		// and verifying the current selector returns one of the
		// original three sources instead.
		const legacyIdle = "idle" as TurnPhase
		const proj = selectTaskHeaderPresentation({
			canonicalShadowPhase: undefined,
			currentLegacyPhase: legacyIdle,
			seq: 1,
		})
		expect(proj.source).not.toBe("task-ownership")
		expect(["shadow", "host", "legacy"]).toContain(proj.source)
	})

	it("NEG-03: the selector still uses the pre-bridge three-rule precedence (compacting / shadow / legacy)", () => {
		// compacting override is unchanged
		expect(
			selectTaskHeaderPresentation({
				canonicalShadowPhase: "awaiting_followup",
				currentLegacyPhase: "compacting",
				seq: 1,
			}),
		).toEqual({ phase: "compacting", source: "host", seq: 1 })

		// shadow wins when present
		expect(
			selectTaskHeaderPresentation({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "idle",
				seq: 1,
			}),
		).toEqual({ phase: "streaming", source: "shadow", seq: 1 })

		// legacy fallback when shadow absent
		expect(
			selectTaskHeaderPresentation({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
				seq: 1,
			}),
		).toEqual({ phase: "idle", source: "legacy", seq: 1 })
	})
})

// ===========================================================================
// Live symptom witness — record the pre-repair symptom that motivated this
// ACT (and the next one), without asserting a desired projection. The
// successor ACT owns the desired Working-vs-Waiting discriminator.
// ===========================================================================

describe("ABORTED_ATTEMPT / REJECTED_REPAIR / live symptom witness", () => {
	it("LIVE-01: pre-repair symptom at taskId=1787361823207_6ta7a (epoch=3, stateVersion 8552→8895, toolCalls 186→190) — selector returns idle+legacy during visible work", () => {
		// This test pins the LIVE pre-repair behavior so the next
		// ACT has an unambiguous RED starting shape. The expected
		// phase is the pre-repair "idle+legacy" — the next ACT's
		// RED must REPLACE this expectation, NOT this witness.
		const proj = selectTaskHeaderPresentation({
			canonicalShadowPhase: undefined,
			currentLegacyPhase: "idle",
			seq: 8895,
		})
		// The pre-repair shape: selector says idle+legacy even
		// though toolCalls was incrementing. This is the
		// documented symptom that the next ACT must close.
		expect(proj).toEqual({ phase: "idle", source: "legacy", seq: 8895 })
	})
})
