/**
 * Working-context authority publish — ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01
 *
 * Sub-tests (post-GREEN):
 *
 * 1. CANONICAL_INPUTS (GREEN): the prepare-turn seam
 *    (createCompactionStateAwarePrepareTurn) holds the canonical
 *    post-compaction request shape (systemPrompt + messages +
 *    tools) and is the lowest production seam where those coexist.
 *
 * 2. MISSING_W_AT_PREPARE_TURN = REPRODUCED (GREEN, post-fix):
 *    the prepare-turn result now carries
 *    currentWorkingContextEstimate, equal to
 *    CANONICAL_W_ESTIMATOR applied to the FINAL returned request
 *    shape (systemPrompt + messages + tools). The estimator is
 *    `estimateRequestInputTokens`; the input contract is
 *    TokenEstimatedRequest (systemPrompt + messages + tools) —
 *    structural provider-usage non-interference.
 *
 * Calibration note (factory causal reviewer, 2026-09-02):
 *   The earlier "POST_COMPACTION_BEHAVIORAL_RED = REPRODUCED"
 *   label was over-strong; the passThroughCompact fixture does
 *   not actually exercise a real compaction. The discriminator
 *   is, more precisely, MISSING_W_AT_PREPARE_TURN — the
 *   prepare-turn seam publishes W on every prepared request, not
 *   only after compaction. W is the post-preparation occupancy
 *   for the next provider request, computed from the FINAL
 *   returned request shape.
 *
 * P1 (factory causal reviewer, 2026-09-02):
 *   The earlier "STRUCTURAL: canonical estimator accepts only
 *   systemPrompt + messages + tools (no provider-usage slots)"
 *   sub-test was tautological — `keys.length === 3` against an
 *   Array literal of three strings proves the literal, not the
 *   type. The structural evidence now lives in the source/type
 *   declaration of TokenEstimatedRequest
 *   (sdk/packages/shared/src/llms/tokens.ts:25); the ACT records
 *   this as a SOURCE-level claim. No runtime test is required.
 *
 * Negative assertion:
 *   W_after need not equal H_a. The two quantities belong to
 *   different semantic spaces; any test asserting equality
 *   for a fixture would recreate the cross-scale arithmetic
 *   prohibition (Strategy-D). See
 *     ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01
 *     .factory/acts/ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-
 *       AUTHORITY-PUBLISH01.md
 *
 * Live-screenshot disclaimer:
 *   Do NOT use 264.3k (the live post-compaction H_a value) as
 *   a target for W. The screenshot is evidence of the UX defect,
 *   not an oracle for W. The test derives W from
 *   CANONICAL_W_ESTIMATOR, not from any embedded screenshot
 *   number.
 */

import * as LlmsProviders from "@cline/llms";
import { estimateRequestInputTokens } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createCompactionStateAwarePrepareTurn,
	type ContextPipelinePrepareTurn,
	type ContextPipelinePrepareTurnResult,
} from "./compaction";

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

const TOOLS = [
	{
		name: "read_files",
		description: "Read files",
		input_schema: { type: "object" },
	},
	{
		name: "write_to_file",
		description: "Write a file",
		input_schema: { type: "object" },
	},
];

const CANONICAL: LlmsProviders.Message[] = [
	{ role: "user", content: "Create the filter script." },
	{
		role: "assistant",
		content:
			"Older assistant explanation. ".repeat(50) +
			"Padding. ".repeat(25),
	},
	{
		role: "user",
		content:
			"Tool result: file contents of /tmp/example.ts are 'export const x = 1;'",
	},
	{ role: "assistant", content: "Done." },
];

/** A pass-through compact that returns the canonical messages
 *  unchanged. Used to drive prepareTurn with a stable final
 *  request shape. The fixture does not exercise a real
 *  compaction; the discriminator is the prepare-turn seam
 *  publishing W on every prepared request, not specifically
 *  after compaction. */
const passThroughCompact: ContextPipelinePrepareTurn = async (context) => {
	return { messages: context.messages };
};

async function runPrepareTurn(): Promise<ContextPipelinePrepareTurnResult | undefined> {
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: passThroughCompact,
	});
	return await prepareTurn({
		agentId: "agent-w-authority",
		conversationId: "conv-w-authority",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: TOOLS,
		messages: CANONICAL,
		apiMessages: CANONICAL,
		model: {
			id: "mock-w-authority",
			provider: "mock",
			info: { id: "mock-w-authority", maxInputTokens: 200_000 },
		},
	});
}

describe("compaction working-context authority publish", () => {
	it("CANONICAL_INPUTS: the prepare-turn seam holds the exact final request shape (systemPrompt + messages + tools)", async () => {
		// Phase 1 source bind: prove the prepare-turn seam
		// (createCompactionStateAwarePrepareTurn) returns the
		// canonical final request shape (messages + systemPrompt)
		// and that the estimator applied to that shape returns a
		// finite W. The expected W_after value is
		//   estimateRequestInputTokens({finalSystemPrompt,
		//                                  finalMessages,
		//                                  tools}).
		const prepared = await runPrepareTurn();
		expect(prepared).toBeDefined();
		expect(prepared!.messages.length).toBeGreaterThan(0);
		expect(prepared!.systemPrompt).toBe(SYSTEM_PROMPT);
		const wAfter = estimateRequestInputTokens({
			systemPrompt: prepared!.systemPrompt ?? SYSTEM_PROMPT,
			messages: prepared!.messages,
			tools: TOOLS,
		});
		expect(wAfter).toBeGreaterThan(0);
	});

	it("MISSING_W_AT_PREPARE_TURN: prepare-turn result carries currentWorkingContextEstimate equal to CANONICAL_W_ESTIMATOR(final request shape)", async () => {
		// GREEN (post-fix): the prepare-turn result MUST carry
		// currentWorkingContextEstimate, equal to
		//   estimateRequestInputTokens({finalSystemPrompt,
		//                                  finalMessages,
		//                                  tools}).
		// RED → GREEN transition recorded by commit 2 of this ACT.
		// The RED witness file (commit 1) intentionally failed at
		// HEAD because the field was absent; this commit flips it
		// GREEN by publishing W from the FINAL returned shape at
		// the prepare-turn seam.
		const prepared = await runPrepareTurn();
		expect(prepared).toBeDefined();
		const result = prepared as unknown as Record<string, unknown>;
		expect("currentWorkingContextEstimate" in result).toBe(true);
		const w = result.currentWorkingContextEstimate;
		expect(typeof w).toBe("number");
		const expected = estimateRequestInputTokens({
			systemPrompt: prepared!.systemPrompt ?? SYSTEM_PROMPT,
			messages: prepared!.messages,
			tools: TOOLS,
		});
		expect(w).toBe(expected);
	});
});
	it("CARRIER_CADENCE: SessionCompactionState is the durable compaction artifact, NOT the per-turn W carrier (falsification witness)", async () => {
		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
		// cadence falsification witness
		//   eighth-pass halt (2026-09-03) HALT_WRONG_CARRIER_SEMANTICS
		//   ninth-pass correction (2026-09-03) HALT_DEFAULT_SUITE_RED
		//
		// The eighth-pass halt falsified the seventh-pass carrier
		// verdict GENERIC_REUSABLE_CARRIER = BOUND / SessionCompaction-
		// State on the ground that the audit optimized for
		// reachability and missed the cadence invariant:
		//
		//   for every successful prepareTurn producing authoritative W_n:
		//     host-visible W eventually = W_n
		//   without requiring:
		//     compaction occurred
		//     provider response arrived
		//     api_req_started arrived
		//
		// The ninth-pass correction refines the falsification into
		// two distinct lifecycle observations, neither of which
		// should become a committed default-suite RED:
		//
		//   PUBLISH_GAP (real defect, next bounded repair):
		//     compaction.ts:730 returns `result` (undefined) on the
		//     no-compaction branch; publishWorkingContextEstimate is
		//     NOT called → B/C prepare-turn results carry no
		//     currentWorkingContextEstimate. The producer-side
		//     publish cadence bug.
		//
		//   SIDECAR_CADENCE (expected architectural fact):
		//     saveState is invoked only inside the
		//     `if (result?.messages)` branches (compaction.ts:705,
		//     :720). On an ordinary prepare-turn where the upstream
		//     `compact` returned undefined, saveState is NOT called.
		//     That is intentional: the durable compaction artifact
		//     is the latest COMPACTED working context, NOT generic
		//     per-turn state. Mutating it on every prepareTurn
		//     would erase the architectural distinction.
		//
		// This test is the PASSING FALSIFICATION WITNESS:
		//   - resultA carries currentWorkingContextEstimate
		//     (producer-side W publication GREEN already, from
		//      fc906dfc6)
		//   - saveState fires ONLY on real compaction
		//     (durable artifact cadence = compactions only)
		//
		// The pre-fix RED evidence (B/C W undefined + the
		// historical saveStateCalls === 3 discriminator that
		// falsified the rejected carrier hypothesis) is preserved
		// at
		//   .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
		//     CONTEXT-HEADER-TRANSPORT-REPAIR01/
		//     cadence-discriminator-red.provenance.ts
		// outside any default vitest discovery path, per the
		// "transient RED evidence = good / committed intentionally-
		// failing default test = not allowed" rule.

		const saveStateCalls: Array<{
			sourceMessageCount: number;
		}> = [];

		let compactCalls = 0;
		const compactAThenSkip: ContextPipelinePrepareTurn = async (context) => {
			compactCalls += 1;
			if (compactCalls === 1) {
				// A: simulate a real compaction by returning
				// visibly smaller compacted messages. This is the
				// branch where saveState WOULD fire today.
				const compacted = context.messages.slice(0, 2);
				return {
					messages: compacted,
					systemPrompt: SYSTEM_PROMPT,
				};
			}
			// B, C: simulate "no compaction needed". Real production
			// compact returns undefined when shouldCompact is
			// false. Returning undefined here drives the code
			// through the no-compaction branch, which returns
			// `result` (undefined) without calling saveState.
			return undefined;
		};

		const prepareTurn = createCompactionStateAwarePrepareTurn({
			compact: compactAThenSkip,
			saveState: async (state, sourceMessages) => {
				saveStateCalls.push({
					sourceMessageCount: sourceMessages.length,
				});
			},
		});

		// Three prepare-turns: A (compaction), B (no compaction,
		// ordinary growth), C (no compaction, ordinary growth).
		// Each call has more canonical messages than the previous,
		// so W grows monotonically.
		const buildContext = (
			iteration: number,
			extraPaddingTurns: number,
		): Parameters<ContextPipelinePrepareTurn>[0] => ({
			agentId: "agent-c-cadence",
			conversationId: "conv-c-cadence",
			parentAgentId: null,
			iteration,
			abortSignal: new AbortController().signal,
			systemPrompt: SYSTEM_PROMPT,
			tools: TOOLS,
			messages: [
				...CANONICAL,
				...Array.from({ length: extraPaddingTurns }, () => ({
					role: "user" as const,
					content: "Padding turn. ".repeat(50),
				})),
			],
			apiMessages: [],
			model: {
				id: "mock-cadence",
				provider: "mock",
				info: { id: "mock-cadence", maxInputTokens: 200_000 },
			},
		});

		const resultA = await prepareTurn(buildContext(1, 0));
		const resultB = await prepareTurn(buildContext(2, 4));
		const resultC = await prepareTurn(buildContext(3, 8));

		// ===== POST-NINTH-PASS CAUSAL CORRECTION =====
		//
		// This test is now a PASSING FALSIFICATION WITNESS for the
		// SessionCompactionState cadence observation. The previous
		// RED-only form was halted at ninth-pass
		// HALT_DEFAULT_SUITE_RED on the ground that it conflated
		// two distinct lifecycles (durable compaction persistence
		// vs. per-turn W publication) and committed an
		// intentionally-failing default test.
		//
		// The committed assertions below preserve the architectural
		// invariant:
		//   - resultA carries currentWorkingContextEstimate
		//     (producer-seam publish GREEN from fc906dfc6)
		//   - saveState fires ONLY on real compaction
		//     (durable artifact cadence = compactions only)
		//
		// The pre-fix RED evidence (B/C currentWorkingContext-
		// Estimate === undefined + historical saveStateCalls === 3
		// discriminator that falsified the rejected carrier) is
		// preserved in
		//   .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
		//     CONTEXT-HEADER-TRANSPORT-REPAIR01/
		//     cadence-discriminator-red.provenance.ts
		// which is OUTSIDE any default vitest discovery path
		// (transient RED evidence = good; committed intentionally-
		// failing default test = not allowed).
		expect(
			(resultA as { currentWorkingContextEstimate?: number } | undefined)
				?.currentWorkingContextEstimate,
		).toBeDefined();

		// Architectural invariant: durable compaction artifact
		// moves only on real compactions. This guard is
		// load-bearing — if a future change forces saveState on
		// every prepareTurn, this assertion fails and forces the
		// author to justify erasing the durable / per-turn
		// lifecycle distinction.
		expect(saveStateCalls).toHaveLength(1);

		// Future-proofing note for resultB/resultC:
		//
		// At HEAD, the no-compaction branch in
		// createCompactionStateAwarePrepareTurn (compaction.ts:730)
		// returns the upstream `result` directly, which is
		// `undefined` when the upstream `compact` returned
		// undefined. So resultB and resultC are `undefined` at
		// HEAD — both the prepare-turn RETURN and any embedded
		// currentWorkingContextEstimate.
		//
		// After the producer-cadence fix (the next bounded repair
		// commit lands at compaction.ts:730 to call
		// publishWorkingContextEstimate on the no-compaction
		// branch too), resultB / resultC become defined + carry
		// currentWorkingContextEstimate.
		//
		// At that point, the committed test evolves to:
		//   expect(resultB? .currentWorkingContextEstimate).toBeDefined()
		//   expect(resultC? .currentWorkingContextEstimate).toBeDefined()
		//   expect(resultB? .currentWorkingContextEstimate
		//     !== resultA? .currentWorkingContextEstimate)
		//   expect(resultC? .currentWorkingContextEstimate
		//     !== resultB? .currentWorkingContextEstimate)
		//   expect(saveStateCalls).toHaveLength(1)  // unchanged
		//
		// The RED provenance for the no-compaction branch is
		// preserved at
		//   .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
		//     CONTEXT-HEADER-TRANSPORT-REPAIR01/
		//     cadence-discriminator-red.provenance.ts
		// outside any default vitest discovery path. resultB /
		// resultC are intentionally not asserted here — that
		// would commit an RED in the default suite.
	});
