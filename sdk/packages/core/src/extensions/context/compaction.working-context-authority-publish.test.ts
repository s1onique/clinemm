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
