/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (thirty-seventh-pass) — producer hypothesis witness.
 *
 * Phase: C1_GO_PRODUCER_RED (reclassified after HALT_RED_NOT_REPRODUCED
 * inspection per the user's plan).
 *
 * CLASSIFICATION:
 *
 *   PRODUCER_HYPOTHESIS_WITNESS =
 *     SYNTHETIC_REAL / NOT_REPRODUCED / PASS
 *
 * The live runtime trace for session 1788440371166_9hf7u showed
 * two `runtime_w_observe` rows with
 *   resultKind = "prepare_turn"
 *   prepareTurnW = undefined
 *   runtimeW     = undefined
 * which the causal review classified as A1 (LIVE producer-path
 * failure). The user's plan asks us to reproduce that exact
 * shape against the REAL production seam:
 *
 *   compact = createContextCompactionPrepareTurn(config)
 *   prepareTurn = createCompactionStateAwarePrepareTurn({ compact })
 *   result = await prepareTurn(ordinaryTurnContext)
 *
 * with `ordinaryTurnContext` comfortably below the compaction
 * threshold so `shouldCompact = false` and the inner
 * `createContextCompactionPrepareTurn` returns `undefined`.
 *
 * Expected (under the producer-cadence GREEN at compaction.ts:798):
 *
 *   result                                       !== undefined
 *   result.currentWorkingContextEstimate         === W (number)
 *   result.messages                              === undefined
 *   result.systemPrompt                          === undefined
 *
 * Outcome at HEAD (pre-c18 repair): the test PASSED. The
 * producer-side `createCompactionStateAwarePrepareTurn` already
 * publishes W on the ordinary no-compaction turn via
 * `publishWorkingContextEstimateMetadataOnly`. So this test is
 * a NOT_REPRODUCED witness for the producer hypothesis, NOT a
 * RED.
 *
 * That falsification is what triggered HALT_RED_NOT_REPRODUCED
 * and pointed at the real defect: the host-side wrapper at
 * `SessionRuntime.createRuntimePrepareTurn` strips
 * `currentWorkingContextEstimate` from the producer's result.
 * See `session-runtime-orchestrator.runtime-prepare-turn-w-strip
 * .test.ts` for the load-bearing RED → GREEN witness on the
 * actual host-side wrapper.
 *
 * This test is retained as a SYNTHETIC_REAL PASSING WITNESS:
 * it pins the producer's publish-on-every-prepareTurn invariant
 * against the REAL production factory, and prevents regressions
 * in the producer seam (a future branch returning without W
 * would flip this test RED).
 */

import * as LlmsProviders from "@cline/llms";
import { estimateRequestInputTokens } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";

const SYSTEM_PROMPT = "You are a concise coding assistant.";

// Tools use the same shape as the existing authority-publish suite
// (snake_case `input_schema`). The exact TS-shape is irrelevant for
// the RED — the estimator receives `tools: readonly unknown[]` and
// JSON.stringifies them.
const TOOLS = [
	{
		name: "read_files",
		description: "Read files",
		input_schema: { type: "object" },
	},
];

const ORDINARY_TURN_MESSAGES: LlmsProviders.Message[] = [
	{ role: "user", content: "List the files in /tmp" },
	{
		role: "assistant",
		content: "I will list the files in /tmp for you.",
	},
];

describe("createContextCompactionPrepareTurn real-producer-seam RED", () => {
	it(
		"C1 ordinary no-compaction turn: result.currentWorkingContextEstimate === CANONICAL_W_ESTIMATOR(systemPrompt + messages + tools)",
		async () => {
			const compact = createContextCompactionPrepareTurn({
				providerId: "anthropic",
				modelId: "claude-test",
				providerConfig: {
					providerId: "anthropic",
					modelId: "claude-test",
				} as LlmsProviders.ProviderConfig,
				compaction: {
					enabled: true,
					strategy: "basic",
				},
				logger: undefined,
			});
			expect(compact).toBeDefined();

			const saveState = vi_saveStateSentinel();
			const prepareTurn = createCompactionStateAwarePrepareTurn({
				compact,
				getState: () => undefined,
				saveState,
			});

			const result = await prepareTurn({
				agentId: "agent-red-c1",
				conversationId: "conv-red-c1",
				parentAgentId: null,
				iteration: 1,
				abortSignal: new AbortController().signal,
				systemPrompt: SYSTEM_PROMPT,
				tools: TOOLS,
				messages: ORDINARY_TURN_MESSAGES,
				apiMessages: ORDINARY_TURN_MESSAGES,
				model: {
					id: "claude-test",
					provider: "anthropic",
					info: {
						id: "claude-test",
						maxInputTokens: 200_000,
					},
				},
			});

			// ===== A1 REPRODUCTION ASSERTIONS =====
			expect(result).toBeDefined();
			expect(result?.currentWorkingContextEstimate).toEqual(
				expect.any(Number),
			);

			// ===== POST-FIX GREEN MATRIX (tenth-pass) =====
			expect(result?.messages).toBeUndefined();
			expect(result?.systemPrompt).toBeUndefined();

			// ===== CANONICAL W VALUE =====
			const expectedW = estimateRequestInputTokens({
				systemPrompt: SYSTEM_PROMPT,
				messages: ORDINARY_TURN_MESSAGES,
				tools: TOOLS,
			});
			expect(result?.currentWorkingContextEstimate).toBe(expectedW);

			// ===== DURABLE COMPACTION ARTIFACT CADENCE =====
			expect(saveState).not.toHaveBeenCalled();
		},
	);
});

/**
 * Sentinel saveState that throws on call. Any invocation surfaces
 * as a thrown assertion failure rather than silently passing.
 */
function vi_saveStateSentinel() {
	const fn = vi.fn(() => {
		throw new Error(
			"saveState MUST NOT be invoked on an ordinary no-compaction " +
				"prepareTurn (durable compaction artifact cadence = " +
				"compactions only, NOT per-turn).",
		);
	});
	return fn;
}
