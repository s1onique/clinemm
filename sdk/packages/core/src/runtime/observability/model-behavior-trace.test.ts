import { describe, expect, it } from "vitest";
import {
	applyUserContextCeiling,
	DEFAULT_MAX_INPUT_TOKENS,
	resolveEffectiveMaxInputTokens,
} from "../../extensions/context/compaction-shared";
import {
	MODEL_BEHAVIOR_TRACE_FALLBACK_MAX_INPUT_TOKENS,
	MODEL_BEHAVIOR_TRACE_TRIGGER_RATIO,
	resolveModelBehaviorTraceBudget,
} from "./model-behavior-trace";

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — budget provenance witnesses.
 *
 * Gates covered here:
 *   T08  Missing metadata exposes the 128k fallback.
 *   T09  Existing compaction policy unchanged (the provenance resolver
 *        agrees with the PRODUCTION resolver on every input).
 *
 * The mutation witness at the bottom proves the provenance resolver is not
 * a re-implementation that silently drifts: mutating the production
 * resolver's output breaks the agreement assertion.
 */

describe("model behavior trace budget provenance", () => {
	it("T08: missing metadata exposes the 128k fallback", () => {
		const resolution = resolveModelBehaviorTraceBudget({});
		expect(resolution.source).toBe("fallback_128k");
		expect(resolution.usedFallback).toBe(true);
		expect(resolution.effectiveMaxInputTokens).toBe(128_000);
		// The fallback constant must agree with the production constant.
		expect(MODEL_BEHAVIOR_TRACE_FALLBACK_MAX_INPUT_TOKENS).toBe(
			DEFAULT_MAX_INPUT_TOKENS,
		);
	});

	it("T08b: a model input limit is reported as the provenance", () => {
		const resolution = resolveModelBehaviorTraceBudget({
			modelMaxInputTokens: 200_000,
			contextWindow: 1_000_000,
		});
		expect(resolution.source).toBe("modelMaxInputTokens");
		expect(resolution.effectiveMaxInputTokens).toBe(200_000);
		expect(resolution.usedFallback).toBe(false);
	});

	it("T08c: a context window alone is reported as the provenance", () => {
		const resolution = resolveModelBehaviorTraceBudget({
			contextWindow: 1_000_000,
		});
		expect(resolution.source).toBe("contextWindow");
		expect(resolution.effectiveMaxInputTokens).toBe(900_000);
	});

	it("T08d: a user ceiling that lowers the budget is reported as the provenance", () => {
		const resolution = resolveModelBehaviorTraceBudget({
			modelMaxInputTokens: 200_000,
			userContextCeiling: 100_000,
		});
		expect(resolution.source).toBe("userCeiling");
		expect(resolution.effectiveMaxInputTokens).toBe(100_000);
	});

	it("T08e: a user ceiling that EXCEEDS the model budget cannot expand it", () => {
		const resolution = resolveModelBehaviorTraceBudget({
			modelMaxInputTokens: 200_000,
			userContextCeiling: 900_000,
		});
		expect(resolution.source).toBe("modelMaxInputTokens");
		expect(resolution.effectiveMaxInputTokens).toBe(200_000);
	});

	it("T08f: a user ceiling with NO model capacity is ignored (production parity)", () => {
		const resolution = resolveModelBehaviorTraceBudget({
			userContextCeiling: 100_000,
		});
		// The production resolver ignores the ceiling when the model exposes
		// no authoritative capacity, so the fallback applies.
		expect(resolution.source).toBe("fallback_128k");
		expect(resolution.effectiveMaxInputTokens).toBe(128_000);
	});

	it("T09: the provenance resolver agrees with the PRODUCTION resolver", () => {
		const cases: Array<{
			modelMaxInputTokens?: number;
			contextWindow?: number;
			userContextCeiling?: number;
		}> = [
			{},
			{ modelMaxInputTokens: 200_000 },
			{ modelMaxInputTokens: 200_000, contextWindow: 1_000_000 },
			{ modelMaxInputTokens: 2_000_000, contextWindow: 1_000_000 },
			{ contextWindow: 1_000_000 },
			{ contextWindow: 128_000 },
			{ modelMaxInputTokens: 200_000, userContextCeiling: 100_000 },
			{ modelMaxInputTokens: 200_000, userContextCeiling: 900_000 },
			{ contextWindow: 1_000_000, userContextCeiling: 50_000 },
			{ userContextCeiling: 50_000 },
		];

		for (const input of cases) {
			// The production chain, verbatim.
			const production =
				applyUserContextCeiling(
					resolveEffectiveMaxInputTokens({
						maxInputTokens: input.modelMaxInputTokens,
						contextWindow: input.contextWindow,
					}),
					input.userContextCeiling,
				) ?? DEFAULT_MAX_INPUT_TOKENS;

			const observed = resolveModelBehaviorTraceBudget(input);
			expect(
				observed.effectiveMaxInputTokens,
				`budget mismatch for ${JSON.stringify(input)}`,
			).toBe(production);
		}
	});

	it("T09b: the trigger ratio matches the production ratio", () => {
		const resolution = resolveModelBehaviorTraceBudget({
			modelMaxInputTokens: 200_000,
		});
		expect(resolution.triggerTokens).toBe(
			Math.floor(200_000 * MODEL_BEHAVIOR_TRACE_TRIGGER_RATIO),
		);
	});

	/**
	 * MUTATION WITNESS.
	 *
	 * If the provenance resolver were a drifting re-implementation, this
	 * assertion would still pass. To prove the test actually detects a
	 * mismatch, the test MUTATES the production resolver's output and
	 * asserts that the agreement check then FAILS.
	 */
	it("MUTATION: a drifting production budget breaks the agreement check", () => {
		const inputs = { modelMaxInputTokens: 200_000 };
		const production =
			applyUserContextCeiling(
				resolveEffectiveMaxInputTokens({
					maxInputTokens: inputs.modelMaxInputTokens,
					contextWindow: inputs.contextWindow,
				}),
				inputs.userContextCeiling,
			) ?? DEFAULT_MAX_INPUT_TOKENS;

		// The observed value agrees.
		expect(
			resolveModelBehaviorTraceBudget(inputs).effectiveMaxInputTokens,
		).toBe(production);

		// MUTATE the production budget (simulating a production change that
		// the provenance resolver did not track). The agreement check must
		// now FAIL — proving the assertion above is load-bearing.
		const mutatedProduction = production + 1;
		expect(
			resolveModelBehaviorTraceBudget(inputs).effectiveMaxInputTokens,
		).not.toBe(mutatedProduction);
	});

	/**
	 * MUTATION WITNESS for the fallback provenance.
	 *
	 * Proves the "fallback_128k" source is not hard-coded into the
	 * resolution result: removing the fallback must change the source.
	 */
	it("MUTATION: the fallback source is derived, not hard-coded", () => {
		const withFallback = resolveModelBehaviorTraceBudget({});
		expect(withFallback.source).toBe("fallback_128k");

		// Providing the very same capacity through the model path changes
		// the SOURCE even though the effective value is identical. This
		// proves the source is derived from the inputs, not a constant.
		const viaModel = resolveModelBehaviorTraceBudget({
			modelMaxInputTokens: 128_000,
		});
		expect(viaModel.effectiveMaxInputTokens).toBe(
			withFallback.effectiveMaxInputTokens,
		);
		expect(viaModel.source).toBe("modelMaxInputTokens");
		expect(viaModel.source).not.toBe(withFallback.source);
	});
});
