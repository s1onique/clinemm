/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — RED witness.
 *
 * WHAT THIS WITNESS PROVES
 * -----------------------
 *
 * Before this ACT, the diagnostic could NOT authoritatively join a
 * compaction DECISION to the provider USAGE, and could NOT reconstruct the
 * exact pre-compaction candidate. This file records the PRE-ACT contract
 * as a standing witness.
 *
 * It is a RED witness in the sense the ACT requires: it demonstrates that
 * the gap was REAL and is now CLOSED by the GREEN suite
 * (`compaction.token-evidence-capture01.test.ts` and
 * `runtime/observability/compaction-candidate-capture.test.ts`).
 *
 * The two assertions below are the EXACT pre-ACT behaviours:
 *
 *   1. The compaction DECISION carried NO preparation identity. It minted
 *      its own `(sessionId, iteration, decisionOrdinal)` identity, and the
 *      source explicitly recorded that the provider request id "is NOT
 *      available here". A consumer therefore had to pair a decision with
 *      a provider usage CHRONOLOGICALLY — an INFERRED pairing, not an
 *      AUTHORITATIVE one.
 *
 *   2. The diagnostic carried NO candidate content, so the exact
 *      pre-compaction candidate could not be reconstructed from the
 *      metadata after the fact. The capture is what closed that gap.
 *
 * The witness is NOT a second copy of the GREEN suite: it pins the
 * PRE-ACT shape so a future change cannot silently remove the
 * correlation again without a witness failing.
 */
import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createContextCompactionPrepareTurn } from "./compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

type CompactionPrepareTurn = NonNullable<
	ReturnType<typeof createContextCompactionPrepareTurn>
>;
type CompactionModel = Parameters<CompactionPrepareTurn>[0]["model"];

const MODEL = {
	id: "red-probe-model",
	provider: "openai-compatible",
	info: { maxInputTokens: 115_200, contextWindow: 115_200 },
} as unknown as CompactionModel;

function makeUserMessage(text: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text }],
	} as unknown as MessageWithMetadata;
}

describe("ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — RED witness", () => {
	it("RED: without a preparation identity the decision join authority is UNAVAILABLE", async () => {
		const decisions: Record<string, unknown>[] = [];
		const prepareTurn = createContextCompactionPrepareTurn({
			providerId: "openai-compatible",
			modelId: "red-probe-model",
			providerConfig: {
				providerId: "openai-compatible",
				modelId: "red-probe-model",
			} as unknown as LlmsProviders.ProviderConfig,
			compaction: { enabled: true, strategy: "basic", preserveRecentTokens: 1 },
			modelBehaviorTraceSink: {
				isTraceEnabled: () => true,
				onCompactionDiagnostics: (observation: {
					payload: Record<string, unknown>;
				}) => {
					decisions.push(observation.payload);
				},
			},
		});

		await prepareTurn?.({
			agentId: "agent-red",
			conversationId: "conv-red",
			parentAgentId: null,
			iteration: 3,
			abortSignal: new AbortController().signal,
			systemPrompt: "red witness",
			tools: [],
			messages: [makeUserMessage("red witness content")],
			apiMessages: [makeUserMessage("red witness content")],
			model: MODEL,
		});

		expect(decisions.length).toBe(1);
		const decision = decisions[0]!;

		// The PRE-ACT decision had its OWN identity and NO link to the
		// request it measured.
		expect(decision.decisionId).toBeTruthy();
		expect(decision.preparationRequestId).toBeUndefined();
		expect(decision.decisionJoinAuthority).toBe("UNAVAILABLE");

		// The candidate CONTENT was never on the decision record. This is
		// the second half of the gap: the exact pre-compaction candidate
		// could not be reconstructed from the metadata.
		expect(decision).not.toHaveProperty("apiMessages");
		expect(decision).not.toHaveProperty("systemPrompt");
		expect(decision).not.toHaveProperty("tools");
		expect(decision).not.toHaveProperty("candidate");
	});
});
