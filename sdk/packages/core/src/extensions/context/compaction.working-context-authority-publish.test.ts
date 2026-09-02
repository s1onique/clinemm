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
		expect(prepared!.messages?.length).toBeGreaterThan(0);
		expect(prepared!.systemPrompt).toBe(SYSTEM_PROMPT);
		const wAfter = estimateRequestInputTokens({
			systemPrompt: prepared!.systemPrompt ?? SYSTEM_PROMPT,
			messages: prepared!.messages ?? CANONICAL,
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
			messages: prepared!.messages ?? CANONICAL,
			tools: TOOLS,
		});
		expect(w).toBe(expected);
	});
});
	it("CARRIER_CADENCE: producer publishes W on every prepareTurn; durable compaction artifact cadence preserved; P1_1 no-op projection conservation (tenth-pass GREEN matrix)", async () => {
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
		// Tenth-pass (2026-09-03) producer-cadence GREEN:
		//   PUBLISH_GAP is now FIXED at compaction.ts:730. The
		//   no-compaction branch returns
		//     publishWorkingContextEstimateMetadataOnly(
		//       context.messages,
		//       context.systemPrompt,
		//       context.tools,
		//     )
		//   which carries W on every prepareTurn but sets ONLY
		//   `currentWorkingContextEstimate` (messages and
		//   systemPrompt are NOT populated) so the downstream
		//   projection branches at agent-runtime.ts:2319-2324
		//   do NOT fire (`next === request`, semantic
		//   conservation).
		//
		// This test is now the FULL POST-FIX GREEN MATRIX:
		//   - resultA/B/C all carry currentWorkingContextEstimate
		//     (producer publishes W on every prepareTurn)
		//   - B.W != A.W, C.W != B.W (W grows monotonically
		//     with the canonical message stream)
		//   - B/C carry messages=undefined + systemPrompt=
		//     undefined (P1_1 no-op projection conservation)
		//   - saveState fires ONLY on real compaction
		//     (durable artifact cadence = compactions only)
		//
		// The ninth-pass HALT_DEFAULT_SUITE_RED evidence file
		//   .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
		//     CONTEXT-HEADER-TRANSPORT-REPAIR01/
		//     cadence-discriminator-red.provenance.ts
		// was RETIRED in the tenth-pass producer-cadence GREEN
		// commit. The publish-gap RED it captured is now fixed
		// in production (compaction.ts:730 returns
		// publishWorkingContextEstimateMetadataOnly instead of
		// undefined), and the post-fix GREEN state is asserted
		// by this committed test (CARRIER_CADENCE). See the
		// ACT body for the full green-matrix evidence.

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
		// The committed assertions below are the FULL POST-FIX
		// GREEN MATRIX (tenth-pass): the producer-cadence GREEN
		// is now in place at compaction.ts:730 (returns
		// publishWorkingContextEstimateMetadataOnly on the
		// no-compaction branch, carrying W but not populating
		// messages or systemPrompt — see the P1_1
		// NO_COMPACTION_REQUEST_SEMANTICS_DELTA control below).
		//
		// The ninth-pass HALT_DEFAULT_SUITE_RED evidence file
		//   .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
		//     CONTEXT-HEADER-TRANSPORT-REPAIR01/
		//     cadence-discriminator-red.provenance.ts
		// was RETIRED in this same tenth-pass commit (its
		// captured RED is no longer reproducible after the fix
		// and the post-fix GREEN state is now authoritative in
		// this committed test).
		expect(
			(resultA as { currentWorkingContextEstimate?: number } | undefined)
				?.currentWorkingContextEstimate,
		).toBeDefined();

		// POST-TENTH-PASS PRODUCER-CADENCE GREEN
		//
		// Compaction.ts:730 now returns a metadata-only
		// prepare-turn result carrying currentWorkingContext-
		// Estimate via the new
		// publishWorkingContextEstimateMetadataOnly helper.
		// The result is defined (downstream falls past the
		// `!result` early return at agent-runtime.ts:2303)
		// but sets ONLY currentWorkingContextEstimate, so
		// the projection branches at agent-runtime.ts:2319
		// and :2323 are NOT triggered, and `next ===
		// request` (semantic conservation).
		//
		// P1_1 NO_COMPACTION_REQUEST_SEMANTICS_DELTA = ZERO:
		//   resultB.messages === undefined
		//   resultC.messages === undefined
		//   resultB.systemPrompt === undefined
		//   resultC.systemPrompt === undefined
		//
		// These four assertions are LOAD-BEARING. If any
		// future change populates result.messages or
		// result.systemPrompt on the no-compaction branch —
		// even with content-equal values — the projection
		// branches fire and downstream observes
		// `next !== request` (a fresh array clone of
		// messages + a systemPrompt replacement), violating
		// the no-op projection invariant the reviewer
		// demanded as the gate for producer-cadence GREEN.
		expect(
			(resultB as { currentWorkingContextEstimate?: number } | undefined)
				?.currentWorkingContextEstimate,
		).toBeDefined();
		expect(
			(resultC as { currentWorkingContextEstimate?: number } | undefined)
				?.currentWorkingContextEstimate,
		).toBeDefined();
		expect(
			(resultA as { currentWorkingContextEstimate: number }).currentWorkingContextEstimate,
		).not.toBe(
			(resultB as { currentWorkingContextEstimate: number }).currentWorkingContextEstimate,
		);
		expect(
			(resultB as { currentWorkingContextEstimate: number }).currentWorkingContextEstimate,
		).not.toBe(
			(resultC as { currentWorkingContextEstimate: number }).currentWorkingContextEstimate,
		);

		// P1_1 NO_COMPACTION_REQUEST_SEMANTICS_DELTA = ZERO
		// (reviewer-mandated conservation before producer-
		// cadence GREEN). resultB and resultC MUST be
		// metadata-only: messages + systemPrompt are NOT
		// populated, so the downstream projection branches
		// at agent-runtime.ts:2319-2324 do NOT fire and
		// `next === request` (semantic conservation).
		expect(
			(resultB as { messages?: unknown }).messages,
		).toBeUndefined();
		expect(
			(resultC as { messages?: unknown }).messages,
		).toBeUndefined();
		expect(
			(resultB as { systemPrompt?: unknown }).systemPrompt,
		).toBeUndefined();
		expect(
			(resultC as { systemPrompt?: unknown }).systemPrompt,
		).toBeUndefined();

		// Architectural invariant: durable compaction
		// artifact moves only on real compactions. UNCHANGED
		// by the producer-cadence GREEN. This guard is
		// load-bearing — if a future change forces
		// saveState on every prepareTurn, this assertion
		// fails and forces the author to justify erasing
		// the durable / per-turn lifecycle distinction.
		expect(saveStateCalls).toHaveLength(1);
	});
