/**
 * ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02 + CORRECTION01 —
 * Module-level (capture helper) tests + post-capture classifier
 * shape.
 *
 * This file proves only:
 *   - the stage is enumerable in the CCARD counter snapshot,
 *   - the capture helper records the stage and increments the
 *     counter, and
 *   - the post-capture classifier SHAPE recognizes both
 *     EXECUTE_TURN_PRELUDE_STALL and EXECUTE_TURN_PRELUDE_HUNG
 *     fingerprints.
 *
 * It does NOT prove the production seam fires at the intended
 * boundary. That proof lives in
 * `apps/vscode/src/sdk/__tests__/post-continuation-run-stall02-correction01.pcrs02c01.c24-c-bridge.test.ts`,
 * which exercises the REAL `LocalRuntimeHost.runTurn` →
 * `executeTurn` chain with the production hook wired.
 *
 * Why both files exist:
 *   The CORRECTION01 review (HALT_ACT_EVIDENCE_CONTRACT_MISMATCH)
 *   identified that the previous PCRS02 suite synthesized the
 *   stages via direct `captureContinuationCardinalityAuthorityRecord`
 *   calls and overclaimed "PASS_OBSERVATION_SEAM" because the
 *   real-host seam was never exercised. The production-shape
 *   proof has been split out into a bridge test (runs under
 *   `vitest.config.c2-4-c-bridge.ts`) so it can drive the real
 *   `LocalRuntimeHost` class via the `@cline-internal/core/...`
 *   alias. The module-level tests here remain useful as
 *   regression checks on the capture helper itself.
 *
 * Frozen invariant (CORRECTION01):
 *   C7 (run_turn_started) fires at runTurn entry (post
 *     queue/steer short-circuit).
 *   execute_turn_prelude_enter fires at the FIRST EXECUTABLE LINE
 *     of `LocalRuntimeHost.executeTurn`, BEFORE the first await
 *     (`prepareTurnInput`). This is the placement that proves
 *     `executeTurn` actually entered (JavaScript code before the
 *     first `await` in an async function runs synchronously at
 *     call time).
 *   C8 (agent_turn_done) fires after `executeTurn(...)` resolves.
 *
 * Live-stall discriminator:
 *   C7 fired → execute_turn_prelude_enter fired → (no C8):
 *     EXECUTE_TURN_PRELUDE_STALL (stall is INSIDE executeAgentTurn).
 *   C7 fired → execute_turn_prelude_enter NOT fired → (no C8):
 *     EXECUTE_TURN_PRELUDE_HUNG (stall is in the prelude awaits
 *     themselves).
 *
 * Tests in this file (module-level):
 *   PCRS02-01: the new stage exists and is enumerable in the CCARD
 *               counter snapshot.
 *   PCRS02-02: capture() with the new stage writes a record and
 *               increments the per-stage counter.
 *   PCRS02-03: capture() with the new stage is a complete no-op
 *               when the seam is OFF (production default).
 *   PCRS02-04: C7 + execute_turn_prelude_enter + (no C8) is the
 *               EXECUTE_TURN_PRELUDE_STALL fingerprint (SHAPE
 *               only — see the bridge test for the real seam
 *               proof).
 *   PCRS02-05: C7 + (no execute_turn_prelude_enter) + (no C8) is
 *               the EXECUTE_TURN_PRELUDE_HUNG fingerprint (SHAPE
 *               only — see the bridge test for the real seam
 *               proof).
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

	it("PCRS02-04: C7 + execute_turn_prelude_enter + (no C8) is the EXECUTE_TURN_PRELUDE_STALL classifier-shape fingerprint (module-level only; real-host proof lives in PCRS02C01)", () => {
		// SHAPE-ONLY discriminator. The post-capture join
		// (operator-side) will recognize this counter pattern as
		// "stall inside executeAgentTurn". The post-capture
		// classifier is OUT OF SCOPE for this file — only the
		// counter shape is asserted here.
		//
		// This test does NOT exercise the production seam. The
		// production seam proof (that LocalRuntimeHost.runTurn
		// actually emits `execute_turn_prelude_enter` at the first
		// executable line of `executeTurn`) lives in
		// `post-continuation-run-stall02-correction01.pcrs02c01.c24-c-bridge.test.ts`.
		//
		// The live RED in
		// `.factory/evidence/ACT-CLINEMM-POST-CONTINUATION-RUN-STALL02`
		// has the expected operator-side counter pattern:
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

	it("PCRS02-05: C7 + (no execute_turn_prelude_enter) + (no C8) is the EXECUTE_TURN_PRELUDE_HUNG classifier-shape fingerprint (module-level only; real-host proof lives in PCRS02C01)", () => {
		// SHAPE-ONLY discriminator. The post-capture join
		// (operator-side) will recognize this counter pattern as
		// "stall inside the prelude awaits". The classifier itself
		// is OUT OF SCOPE for this file — only the counter shape
		// is asserted here.
		//
		// This test does NOT exercise the production seam. The
		// production seam proof lives in
		// `post-continuation-run-stall02-correction01.pcrs02c01.c24-c-bridge.test.ts`.
		// Resolving the HUNG branch on a real stall requires
		// blocking `prepareTurnInput` itself, which is private to
		// `LocalRuntimeHost`. The HUNG branch can only be
		// definitively discriminated by a follow-up ACT that adds
		// a deeper seam inside the prelude awaits once the STALL
		// branch is ruled out.
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
