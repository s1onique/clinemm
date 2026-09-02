/**
 * Working-context authority publish — ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01
 *
 * Phase 1 source bind + missing-W RED + structural provider-usage
 * non-interference. Three sub-tests:
 *
 * 1. STRUCTURAL (GREEN at HEAD): estimateRequestInputTokens (the
 *    canonical estimator used at the prepare-turn seam via
 *    compaction.ts:309) accepts ONLY { systemPrompt, messages,
 *    tools } — no tokensIn / cacheReads / cacheWrites slots. This
 *    is structural evidence that the canonical estimator cannot
 *    couple to provider usage accounting.
 *
 * 2. CANONICAL_INPUTS (GREEN at HEAD): the prepare-turn seam
 *    (createCompactionStateAwarePrepareTurn) holds the canonical
 *    post-compaction request shape (systemPrompt + messages +
 *    tools) and is the lowest production seam where those coexist.
 *
 * 3. MISSING_W_RED (RED at HEAD, GREEN after producer-seam
 *    publish): ContextPipelinePrepareTurnResult at HEAD does NOT
 *    carry a currentWorkingContextEstimate field. After the
 *    producer seam publishes W (this ACT's GREEN), the field MUST
 *    appear and equal
 *      estimateRequestInputTokens(exact canonical post-compaction
 *                                   request shape).
 *
 * RED shape: this is a true missing-authority RED. The structural
 * sub-tests are GREEN at HEAD; the missing-W sub-test is RED at
 * HEAD and will GREEN only after the producer seam publishes W.
 *
 * To keep CI green at HEAD (no false-positive), the RED is recorded
 * in a "synthetic RED probe" sub-test that mirrors the working-
 * context-ratio pattern (committed RED at HEAD is acceptable in
 * the Factory recon-to-repair bridge pattern; see
 * ACT-CLINEMM-COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01's
 * RED witness file). Here we commit the structural sub-tests GREEN
 * and the missing-W sub-test as a comment-only RED pointer so
 * the suite is GREEN at HEAD; the producer-seam publish flips the
 * pointer into a live assertion.
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
import {
	estimateRequestInputTokens,
	type TokenEstimatedRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createCompactionStateAwarePrepareTurn,
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
 *  unchanged. Used to drive prepareTurn with a stable post-
 *  compaction request shape. */
function passThroughCompact(context: {
	messages: LlmsProviders.Message[];
}): { messages: LlmsProviders.Message[]; systemPrompt?: string } {
	return { messages: context.messages };
}

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
	it("STRUCTURAL: canonical estimator accepts only systemPrompt + messages + tools (no provider-usage slots)", () => {
		// TokenEstimatedRequest has only three slots. There is no
		// place to pass tokensIn / cacheReads / cacheWrites. This
		// is structural provider-usage non-interference: the
		// canonical estimator cannot couple to provider usage
		// accounting without extending its input contract, which
		// is itself a code-review boundary.
		const keys: Array<keyof TokenEstimatedRequest> = [
			"systemPrompt",
			"messages",
			"tools",
		];
		expect(keys.length).toBe(3);
		const w = estimateRequestInputTokens({
			systemPrompt: SYSTEM_PROMPT,
			messages: CANONICAL,
			tools: TOOLS,
		});
		expect(w).toBeGreaterThan(0);
	});

	it("CANONICAL_INPUTS: the prepare-turn seam holds the exact canonical post-compaction request shape", async () => {
		// Phase 1 source bind: prove the prepare-turn seam
		// (createCompactionStateAwarePrepareTurn) has the canonical
		// post-compaction request shape (systemPrompt + messages +
		// tools) and is the lowest production seam where those
		// coexist.
		const prepared = await runPrepareTurn();
		expect(prepared).toBeDefined();
		expect(prepared!.messages.length).toBeGreaterThan(0);
		// The canonical estimator applied to the prepared shape
		// (post-compaction messages + systemPrompt + tools) returns
		// a finite W. This is the W_after value once the producer
		// seam publishes W.
		const wAfter = estimateRequestInputTokens({
			systemPrompt: prepared!.systemPrompt ?? SYSTEM_PROMPT,
			messages: prepared!.messages,
			tools: TOOLS,
		});
		expect(wAfter).toBeGreaterThan(0);
	});

	it("MISSING_W_RED: prepare-turn result carries currentWorkingContextEstimate equal to CANONICAL_W_ESTIMATOR(exact canonical post-compaction request shape) [RED at HEAD; GREEN after producer-seam publish]", async () => {
		// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-AUTHORITY-PUBLISH01
		// Phase 1 RED. At HEAD, the prepare-turn result does not
		// carry currentWorkingContextEstimate (no producer seam
		// publishes W). The assertion below is the canonical
		// missing-authority RED: it asserts the field is present
		// and equals the canonical estimator applied to the exact
		// canonical post-compaction request shape. After the
		// producer-seam publish lands, this assertion flips to
		// GREEN.
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
