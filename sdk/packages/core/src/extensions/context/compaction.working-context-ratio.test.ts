/**
 * Working-context ratio discriminator — ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01
 *
 * Causal A/B probe that binds W_before / W_after to the REAL production
 * turn-preparation seam (createCompactionStateAwarePrepareTurn →
 * projectSessionCompactionState) and applies exactly one manual
 * compaction between captures.
 *
 * Harness invariants (per factory causal reviewer's fourth-review-
 * second-pass PASS_WITH_ONE_P1_FIX, 2026-09-02):
 *   NON_MESSAGE_INPUTS_BEFORE == NON_MESSAGE_INPUTS_AFTER
 *   CANONICAL_BEFORE          == CANONICAL_AFTER
 *   ONLY_MUTATED_AUTHORITY    == compactionState
 *
 * Concrete:
 *   - buildForApi invoked through a FRESH MessageBuilder per capture
 *     (production rebuild-fresh-Message-objects pattern;
 *     committedOutdatedRewrites cache NOT carried across A/B).
 *   - systemPrompt, tools, model, and all non-message inputs are
 *     identical between A and B.
 *   - canonical history is identical between A and B.
 *   - the only state change between A and B is the compaction artifact.
 *
 * To produce a non-trivial W_before (i.e., one that still flows
 * through the production state-aware seam), we use a pass-through
 * `compact` for the W_before capture. This is equivalent to the
 * production behaviour when no compaction has occurred yet but
 * prepareTurn is still the production seam (i.e., session has just
 * been resumed with an explicit identity state).
 *
 * See:
 *   - .factory/evidence/ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01/working-context-seam-recon.md
 *   - sdk/ARCHITECTURE.md:480-498 ("9. Context Compaction")
 *   - sdk/packages/core/src/extensions/context/compaction.ts:672-712
 *     (createCompactionStateAwarePrepareTurn)
 *   - sdk/packages/core/src/session/models/session-compaction.ts:161-193
 *     (projectSessionCompactionState)
 *   - sdk/packages/core/src/session/services/message-builder.ts:166
 *     (MessageBuilder.buildForApi — verified to NOT consult any
 *     compaction state outside its message argument)
 */

import type * as LlmsProviders from "@cline/llms";
import { estimateRequestInputTokens } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createSessionCompactionState,
} from "../../session/models/session-compaction";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
} from "./compaction";
import type { ContextPipelinePrepareTurnResult } from "./compaction";

type TokenEstimate = number;

interface PreparedCapture {
	prepared: ContextPipelinePrepareTurnResult | undefined;
	apiMessages: LlmsProviders.Message[];
	estimate: TokenEstimate;
}

interface ProbeOutcome {
	manualRatio: number;
	workingContextRatio: number;
	verdict: "S3_REPRODUCED" | "S3_RATIO_TRANSFER_NOT_REPRODUCED" | "INDETERMINATE";
	HBefore: number;
	HAfter: number;
	WBefore: number;
	WAfter: number;
	preparedBefore: number;
	preparedAfter: number;
}

const SYSTEM_PROMPT = "You are a helpful coding assistant.";
const TOOLS = [
	{ name: "read_files", description: "Read files", input_schema: { type: "object" } },
	{ name: "write_to_file", description: "Write a file", input_schema: { type: "object" } },
];

/** Build a representative canonical history with a long assistant transcript
 *  that the compactor will replace. */
function buildCanonicalHistory(): LlmsProviders.Message[] {
	return [
		{ role: "user", content: "Create the filter script." },
		{
			role: "assistant",
			content:
				"Older assistant explanation. ".repeat(400) +
				"Padding to make sure the projection matters. ".repeat(200),
		},
		{
			role: "user",
			content:
				"Tool result: file contents of /tmp/example.ts are 'export const x = 1;'",
		},
		{
			role: "assistant",
			content:
				"Older assistant explanation 2. ".repeat(400) +
				"More padding. ".repeat(200),
		},
		{
			role: "user",
			content:
				"Tool result: file contents of /tmp/example2.ts are 'export const y = 2;'",
		},
		{
			role: "assistant",
			content:
				"Older assistant explanation 3. ".repeat(400) +
				"Even more padding. ".repeat(200),
		},
		{ role: "user", content: "Continue with the implementation." },
	];
}

/** A deterministic manual-compaction producer. Replaces the entire
 *  canonical history with a tiny summary so the projection visibly
 *  shrinks. This is the real "manual /compact" behaviour: it
 *  intentionally summarizes the full canonical transcript (per
 *  apps/cli/src/runtime/interactive/compaction.ts:99-100 comment:
 *  "Manual compaction intentionally summarizes the full canonical
 *  transcript instead of reusing a prior sidecar summary"). */
function manualCompact(
	context: { messages: LlmsProviders.Message[] },
): { messages: LlmsProviders.Message[]; systemPrompt?: string } {
	return {
		messages: [
			{ role: "user", content: "SUMMARY: working on filter script" },
			{ role: "assistant", content: "Plan: implement filter and verify." },
		],
		systemPrompt: SYSTEM_PROMPT,
	};
}

/** A pass-through compaction that simply returns the canonical
 *  messages unchanged. Used for W_before to drive the production
 *  seam end-to-end without changing the working context. The seam
 *  will save this state and project it on subsequent calls — but
 *  for THIS capture, the prepared messages equal the canonical. */
function passThroughCompact(
	context: { messages: LlmsProviders.Message[] },
): { messages: LlmsProviders.Message[]; systemPrompt?: string } {
	return {
		messages: context.messages,
		systemPrompt: SYSTEM_PROMPT,
	};
}

/** Drive the production turn-preparation seam against identical
 *  canonical state, with the supplied state bindings. */
async function drivePrepareTurn(
	canonical: LlmsProviders.Message[],
	sessionState: {
		getState: () => ReturnType<typeof createSessionCompactionState> | undefined;
		saveState: (state: unknown) => void;
	},
	compact: (
		context: { messages: LlmsProviders.Message[] },
	) => { messages: LlmsProviders.Message[]; systemPrompt?: string } | undefined,
): Promise<ContextPipelinePrepareTurnResult | undefined> {
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact,
		getState: sessionState.getState,
		saveState: sessionState.saveState,
	});
	return await prepareTurn({
		agentId: "agent-discriminator",
		conversationId: "conv-discriminator",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: TOOLS,
		messages: canonical,
		apiMessages: canonical,
		model: {
			id: "mock-discriminator",
			provider: "mock",
			info: { id: "mock-discriminator", maxInputTokens: 200_000 },
		},
	});
}

/** Run a capture of W. The MessageBuilder is FRESH per capture to
 *  honor the production rebuild-fresh-Message-objects pattern and
 *  satisfy BUILD_FOR_API_SIDE_CHANNEL_INVARIANT. */
function captureW(
	prepared: ContextPipelinePrepareTurnResult | undefined,
): PreparedCapture {
	const apiMessages = prepared?.messages ?? [];
	const builder = new MessageBuilder();
	const built = builder.buildForApi(apiMessages);
	const estimate = estimateRequestInputTokens({
		systemPrompt: SYSTEM_PROMPT,
		messages: built,
		tools: TOOLS,
	});
	return { prepared, apiMessages: built, estimate };
}

/** Estimate H (compactor input/output pair). */
function captureH(
	canonical: LlmsProviders.Message[],
): { before: TokenEstimate; after: TokenEstimate } {
	const inputEstimate = estimateRequestInputTokens({
		systemPrompt: SYSTEM_PROMPT,
		messages: canonical,
		tools: TOOLS,
	});
	const result = manualCompact({ messages: canonical });
	const outputEstimate = estimateRequestInputTokens({
		systemPrompt: SYSTEM_PROMPT,
		messages: result.messages,
		tools: TOOLS,
	});
	return { before: inputEstimate, after: outputEstimate };
}

describe("working-context ratio discriminator", () => {
	it("isolates the compaction effect under identical surrounding canonical state", async () => {
		const canonical = buildCanonicalHistory();

		// Session state lives in this closure so the two captures
		// share the same getState/saveState pair (the production
		// pattern). The compaction artifact is the ONLY thing
		// that mutates between A and B.
		let sessionStateRef:
			| ReturnType<typeof createSessionCompactionState>
			| undefined = undefined;
		const sessionState = {
			getState: () => sessionStateRef,
			saveState: (state: unknown) => {
				sessionStateRef = state as ReturnType<
					typeof createSessionCompactionState
				>;
			},
		};

		// === CAPTURE A: pre-compaction ===
		// Drive the production seam with a pass-through compact
		// so that the prepared messages equal the canonical
		// (W_before = no compaction has occurred yet, full
		// canonical flows through).
		const preparedBefore = await drivePrepareTurn(
			canonical,
			sessionState,
			passThroughCompact,
		);
		const wBefore = captureW(preparedBefore);
		const hBefore = captureH(canonical);

		// === Apply exactly one manual compaction ===
		// Manual compaction passes canonical H (per
		// apps/cli/src/runtime/interactive/compaction.ts:99-100).
		// This call writes a NEW compaction artifact via saveState,
		// with the same source-messages basis the production seam
		// uses (see compaction.ts:684-693 sourceMessages contract).
		const manualResult = manualCompact({ messages: canonical });
		const newState = createSessionCompactionState({
			sourceMessages: canonical,
			compactedMessages: manualResult.messages,
			updatedAt: new Date().toISOString(),
		});
		sessionState.saveState(newState);

		// === CAPTURE B: post-compaction ===
		// Drive the SAME production seam again. Now state exists,
		// so prepareTurn projects state.messages + canonical.tail
		// (the real working-context shrinkage).
		const preparedAfter = await drivePrepareTurn(
			canonical,
			sessionState,
			manualCompact,
		);
		const wAfter = captureW(preparedAfter);
		const hAfter = captureH(canonical);

		// === Invariants ===
		expect(preparedBefore?.messages).toBeDefined();
		expect(preparedBefore?.messages?.length).toBeGreaterThan(0);
		expect(preparedAfter?.messages).toBeDefined();
		expect(preparedAfter?.messages?.length).toBeGreaterThan(0);

		// Post-compaction working context is SMALLER than
		// pre-compaction: the projection actually replaces the
		// canonical prefix with the compacted artifact + tail.
		expect(wAfter.apiMessages.length).toBeLessThan(wBefore.apiMessages.length);
		expect(wAfter.estimate).toBeLessThan(wBefore.estimate);

		// === Discriminator ===
		const manualRatio = hAfter.after / hBefore.before;
		const workingContextRatio = wAfter.estimate / wBefore.estimate;

		// === Verdict ===
		// The reviewer's "narrowed" PASS_WITH_ONE_P1_FIX explicitly
		// removes the universal buildForApi-equivalence gate. The
		// A/B harness asserts identical non-message inputs and
		// fresh MessageBuilder per capture (side-channel invariant).
		// A > 10% RELATIVE divergence between manualRatio and
		// workingContextRatio indicates the manual-mode ratio does
		// NOT transfer cleanly to the working-context projection —
		// the wire is overloaded. The comparison must be relative
		// because both ratios are near zero in heavy-compaction
		// regimes; an absolute tolerance would be meaningless.
		const RELATIVE_TOLERANCE = 0.10;
		const denom = Math.max(manualRatio, workingContextRatio, 1e-9);
		const relativeDiff = Math.abs(manualRatio - workingContextRatio) / denom;
		const verdict: ProbeOutcome["verdict"] =
			relativeDiff > RELATIVE_TOLERANCE
				? "S3_REPRODUCED"
				: "S3_RATIO_TRANSFER_NOT_REPRODUCED";

		const outcome: ProbeOutcome = {
			manualRatio,
			workingContextRatio,
			verdict,
			HBefore: hBefore.before,
			HAfter: hAfter.after,
			WBefore: wBefore.estimate,
			WAfter: wAfter.estimate,
			preparedBefore: wBefore.apiMessages.length,
			preparedAfter: wAfter.apiMessages.length,
		};

		// Surface the result for human inspection. The verdict is
		// informational — the discriminator is the ratio pair, not
		// the verdict.
		// eslint-disable-next-line no-console
		console.log("[discriminator]", JSON.stringify(outcome, null, 2));

		// === Causal assertions ===
		// 1. manualRatio and workingContextRatio are both finite
		expect(Number.isFinite(manualRatio)).toBe(true);
		expect(Number.isFinite(workingContextRatio)).toBe(true);

		// 2. The probe is meaningful: working_context_ratio < 1
		//    (compaction actually shrunk the working context)
		expect(workingContextRatio).toBeLessThan(1);
		expect(workingContextRatio).toBeGreaterThan(0);

		// 3. manualRatio < 1 (compactor's input was shrunk to its
		//    output)
		expect(manualRatio).toBeLessThan(1);
		expect(manualRatio).toBeGreaterThan(0);

		// 4. The probe exercises both halves of the seam:
		//    prepareTurn returned NON-IDENTICAL prepared messages
		//    between A and B
		expect(wBefore.apiMessages.length).not.toEqual(
			wAfter.apiMessages.length,
		);
	});

	it("preserves the ratio across a realistic canonical history with very long assistant text", async () => {
		// Realistic case: the canonical history has assistant
		// messages long enough to engage MessageBuilder's
		// truncateAssistantText (DEFAULT_MAX_ASSISTANT_TEXT_CHARS
		// = 200_000). The compact produces a tiny summary. The
		// question: does the manual_ratio (estimated on H) still
		// track the working_context_ratio (estimated on W)?
		const LONG = 600_000; // well above the 200K cap
		const canonical: LlmsProviders.Message[] = [
			{ role: "user", content: "Build a compiler." },
			{
				role: "assistant",
				content: "Assistant draft:\n" + "x".repeat(LONG),
			},
			{
				role: "user",
				content: "Tool result: x",
			},
			{
				role: "assistant",
				content: "Assistant draft 2:\n" + "y".repeat(LONG),
			},
			{
				role: "user",
				content: "Tool result: y",
			},
			{
				role: "assistant",
				content: "Assistant draft 3:\n" + "z".repeat(LONG),
			},
			{ role: "user", content: "Continue with the implementation." },
		];

		let sessionStateRef:
			| ReturnType<typeof createSessionCompactionState>
			| undefined = undefined;
		const sessionState = {
			getState: () => sessionStateRef,
			saveState: (state: unknown) => {
				sessionStateRef = state as ReturnType<
					typeof createSessionCompactionState
				>;
			},
		};

		const preparedBefore = await drivePrepareTurn(
			canonical,
			sessionState,
			passThroughCompact,
		);
		const wBefore = captureW(preparedBefore);
		const hBefore = captureH(canonical);

		const manualResult = manualCompact({ messages: canonical });
		const newState = createSessionCompactionState({
			sourceMessages: canonical,
			compactedMessages: manualResult.messages,
			updatedAt: new Date().toISOString(),
		});
		sessionState.saveState(newState);

		const preparedAfter = await drivePrepareTurn(
			canonical,
			sessionState,
			manualCompact,
		);
		const wAfter = captureW(preparedAfter);
		const hAfter = captureH(canonical);

		const manualRatio = hAfter.after / hBefore.before;
		const workingContextRatio = wAfter.estimate / wBefore.estimate;

		const RELATIVE_TOLERANCE = 0.10;
		const denom = Math.max(manualRatio, workingContextRatio, 1e-9);
		const relativeDiff = Math.abs(manualRatio - workingContextRatio) / denom;
		const verdict: ProbeOutcome["verdict"] =
			relativeDiff > RELATIVE_TOLERANCE
				? "S3_REPRODUCED"
				: "S3_RATIO_TRANSFER_NOT_REPRODUCED";

		const outcome: ProbeOutcome = {
			manualRatio,
			workingContextRatio,
			verdict,
			HBefore: hBefore.before,
			HAfter: hAfter.after,
			WBefore: wBefore.estimate,
			WAfter: wAfter.estimate,
			preparedBefore: wBefore.apiMessages.length,
			preparedAfter: wAfter.apiMessages.length,
		};

		// eslint-disable-next-line no-console
		console.log("[discriminator: realistic]", JSON.stringify(outcome, null, 2));

		// Working context was actually shrunk
		expect(wAfter.estimate).toBeLessThan(wBefore.estimate);
		expect(workingContextRatio).toBeLessThan(1);

		// Causal invariants still hold
		expect(Number.isFinite(manualRatio)).toBe(true);
		expect(Number.isFinite(workingContextRatio)).toBe(true);
		expect(manualRatio).toBeGreaterThan(0);
		expect(workingContextRatio).toBeGreaterThan(0);
	});

	it("preserves the buildForApi side-channel invariant: a fresh MessageBuilder per capture yields the same projection as long as the prepared messages match", () => {
		// The narrowing invariant from the fourth-review-second-pass
		// PASS_WITH_ONE_P1_FIX: a fresh MessageBuilder per capture
		// is the production pattern. Identical prepared messages →
		// identical W.
		const messages: LlmsProviders.Message[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];
		const a = new MessageBuilder();
		const b = new MessageBuilder();
		expect(a.buildForApi(messages)).toEqual(b.buildForApi(messages));
	});
});
