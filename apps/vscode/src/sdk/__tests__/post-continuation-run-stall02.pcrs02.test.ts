/**
 * ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02 — RED witness + GREEN regression.
 *
 * Pins the BOUNDED enter-only observation seam that makes the first
 * currently-unobservable boundary after C7 (`run_turn_started`)
 * observable in the CCARD JSONL.
 *
 * Frozen invariant (per §3 of ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02):
 *   C7 (run_turn_started) fires at runTurn entry.
 *   execute_turn_prelude_enter fires at runTurn exit (after the
 *     queue/steer short-circuit), IMMEDIATELY BEFORE the
 *     `await executeTurn(...)` await on `LocalRuntimeHost.runTurn`.
 *   C8 (agent_turn_done) fires after `executeTurn(...)` resolves.
 *
 * Live-stall discriminator:
 *   C7 fired → execute_turn_prelude_enter fired → (no C8):
 *     EXECUTE_TURN_PRELUDE_STALL (stall is INSIDE executeAgentTurn).
 *   C7 fired → execute_turn_prelude_enter NOT fired → (no C8):
 *     EXECUTE_TURN_PRELUDE_HUNG (stall is in the prelude awaits
 *     themselves).
 *
 * Tests:
 *   PCRS02-01: the new stage exists and is enumerable in the CCARD
 *               counter snapshot.
 *   PCRS02-02: capture() with the new stage writes a record and
 *               increments the per-stage counter.
 *   PCRS02-03: capture() with the new stage is a complete no-op
 *               when the seam is OFF (production default).
 *   PCRS02-04: C7 + execute_turn_prelude_enter + (no C8) is the
 *               EXECUTE_TURN_PRELUDE_STALL fingerprint.
 *   PCRS02-05: C7 + (no execute_turn_prelude_enter) + (no C8) is
 *               the EXECUTE_TURN_PRELUDE_HUNG fingerprint.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	type ContinuationCardinalityAuthorityRecord,
	captureContinuationCardinalityAuthorityRecord,
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	getContinuationCardinalityAuthorityCounters,
	setContinuationCardinalityAuthorityCaptureBufferSize,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "../continuation-cardinality-authority"

// Disable the experimental sandbox (mirrors the BJLA / CCARD tests).
const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	clearContinuationCardinalityAuthorityCapture()
	setContinuationCardinalityAuthorityCaptureBufferSize(64)
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
})

describe("PCRS02 — execute_turn_prelude_enter bounded observation seam", () => {
	it("PCRS02-01: the new stage exists and is enumerable in the CCARD counter snapshot", () => {
		// Discriminator witness — the post-capture join consults
		// `counters.stages.execute_turn_prelude_enter` to know
		// whether the prelude actually entered. Without the new
		// stage this property is undefined and the join fails.
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.stages).toHaveProperty("execute_turn_prelude_enter")
		expect(counters.stages.execute_turn_prelude_enter.count).toBe(0)
		expect(counters.stages.execute_turn_prelude_enter.origins).toEqual([])
	})

	it("PCRS02-02: capture() with the new stage writes a record and increments the per-stage counter", () => {
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		captureContinuationCardinalityAuthorityRecord({
			stage: "execute_turn_prelude_enter",
			origin: "explicit_user",
			sessionId: "s-prelude",
		})
		const records = getContinuationCardinalityAuthorityCaptureRecords()
		expect(records).toHaveLength(1)
		const rec = records[0] as ContinuationCardinalityAuthorityRecord
		expect(rec.stage).toBe("execute_turn_prelude_enter")
		expect(rec.origin).toBe("explicit_user")
		expect(rec.sessionId).toBe("s-prelude")
		expect(rec.seq).toBe(1)
		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.stages.execute_turn_prelude_enter.count).toBe(1)
		expect(counters.stages.execute_turn_prelude_enter.origins).toEqual(["explicit_user"])
	})

	it("PCRS02-03: capture() with the new stage is a complete no-op when the seam is OFF", () => {
		setContinuationCardinalityAuthorityCaptureEnabled(false)
		captureContinuationCardinalityAuthorityRecord({
			stage: "execute_turn_prelude_enter",
			origin: "explicit_user",
			sessionId: "s-prelude",
		})
		expect(getContinuationCardinalityAuthorityCaptureRecords()).toHaveLength(0)
		expect(getContinuationCardinalityAuthorityCounters().stages.execute_turn_prelude_enter.count).toBe(0)
	})

	it("PCRS02-04: C7 + execute_turn_prelude_enter + (no C8) is the EXECUTE_TURN_PRELUDE_STALL fingerprint", () => {
		// Discriminator for the live RED in
		// `.factory/evidence/ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02`.
		// The post-capture join (operator-side) will see:
		//   run_turn_started.count = 3
		//   execute_turn_prelude_enter.count = 1 (only run #3)
		//   agent_turn_done.count = 2
		// → stall is INSIDE executeAgentTurn (the prelude DID fire
		// for run #3, but no agent_turn_done followed).
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		const sessionId = "1790633775136_8mrnl"
		captureContinuationCardinalityAuthorityRecord({
			stage: "run_turn_started",
			origin: "explicit_user",
			sessionId,
		})
		captureContinuationCardinalityAuthorityRecord({
			stage: "execute_turn_prelude_enter",
			origin: "explicit_user",
			sessionId,
		})
		// No agent_turn_done for run #3 — the stall.
		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.stages.run_turn_started.count).toBe(1)
		expect(counters.stages.execute_turn_prelude_enter.count).toBe(1)
		expect(counters.stages.agent_turn_done.count).toBe(0)
	})

	it("PCRS02-05: C7 + (no execute_turn_prelude_enter) + (no C8) is the EXECUTE_TURN_PRELUDE_HUNG fingerprint", () => {
		// Mirror branch: the prelude did NOT enter, but the runTurn
		// itself did. The stall is in the prelude awaits
		// (`prepareTurnInput` → `ensureSessionPersisted` → ...).
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		const sessionId = "1790633775136_8mrnl"
		captureContinuationCardinalityAuthorityRecord({
			stage: "run_turn_started",
			origin: "explicit_user",
			sessionId,
		})
		// No execute_turn_prelude_enter.
		const counters = getContinuationCardinalityAuthorityCounters()
		expect(counters.stages.run_turn_started.count).toBe(1)
		expect(counters.stages.execute_turn_prelude_enter.count).toBe(0)
		expect(counters.stages.agent_turn_done.count).toBe(0)
	})
})
