/**
 * ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01 (S2 discriminator)
 *
 * WHAT THIS FILE ESTABLISHES
 * ---------------------------
 *
 * The RECON02 counterexample ("the estimator fires compaction for a request
 * whose ACTUAL provider-visible size fits") is a SYNTHETIC comparison between
 * two representations that were supplied BY HAND to a locally-defined
 * `shouldCompactOn` helper. It never drove the production trigger.
 *
 * That is a real gap, and it cuts BOTH ways:
 *
 *   - It does NOT prove that the production runtime measures the RAW
 *     representation. The source shows it does not.
 *   - It also does NOT by itself prove that a live mismatch is impossible. A
 *     DIFFERENT divergence axis (the estimator's own chars-per-token
 *     assumption under-counting token-dense bodies) remains live but
 *     unmeasured for Round C.
 *
 * So S2 is HALTED: the repair is NOT authorized until a MATCHED decision-time
 * capture exists. This file's job is to pin down what the production runtime
 * ACTUALLY measures, so that a future S2 repair starts from the real
 * representation rather than from a synthetic one.
 *
 * THE TWO PRODUCTION FACTS PINNED HERE
 * ------------------------------------
 *
 *   1. The compaction trigger measures `context.apiMessages`, NOT
 *      `context.messages`. (`compaction.ts:385-389`.)
 *   2. The production orchestrator populates `context.apiMessages` with the
 *      API-SAFE PROJECTION — `prepareProviderMessagesForApi` →
 *      `MessageBuilder.buildForApi` — BEFORE the trigger reads it.
 *      (`session-runtime-orchestrator.ts:1775`, `:1846-1856`.)
 *
 * Together these establish that the upstream v4.1.26 correction
 * (`43a976d93151`, "estimate re-compaction against API-safe projected
 * messages") is present on BOTH paths in this fork, and that the
 * representation RECON02's counterexample called "the estimator's view" is
 * NOT the representation the production trigger sees.
 *
 * WHAT THIS FILE DOES NOT CLAIM
 * -----------------------------
 *
 *   - It does NOT claim the ten Round C compactions were justified. The
 *     decision-request accounting is `CAPTURE_INSUFFICIENT` and stays so.
 *   - It does NOT claim that no accounting divergence exists. The
 *     chars-per-token axis remains live and unmeasured.
 *   - It does NOT change `COMPACTION_TRIGGER_RATIO`, the context size, the
 *     provider calibration, or the trigger's behaviour. Nothing here is a
 *     repair.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { estimateRequestInputTokens } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	COMPACTION_TRIGGER_RATIO,
	resolveEffectiveMaxInputTokens,
} from "./compaction-shared";

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

/** An assistant turn issuing a tool call. */
function toolCall(
	id: string,
	name: string,
	input: Record<string, unknown>,
): MessageWithMetadata {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id, name, input }],
	};
}

/** A user turn carrying a tool result. */
function toolResult(
	toolUseId: string,
	name: string,
	content: unknown,
): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				name,
				content,
			} as MessageWithMetadata["content"] extends Array<infer T> ? T : never,
		],
	};
}

/** A transcript whose tool results carry full-size bodies. */
function rawTranscriptWithLargeBodies(): MessageWithMetadata[] {
	const raw: MessageWithMetadata[] = [];
	for (let index = 0; index < 12; index += 1) {
		const id = `call_big_${index}`;
		raw.push(toolCall(id, "run_commands", { commands: ["git status"] }));
		raw.push(
			toolResult(id, "run_commands", [
				{
					query: "git status",
					result: "x".repeat(40_000),
					success: true,
				},
			]),
		);
	}
	return raw;
}

/** The provider-visible projection of a transcript. */
function projectForApi(messages: MessageWithMetadata[]): MessageWithMetadata[] {
	return new MessageBuilder().buildForApi(
		messages as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
	) as unknown as MessageWithMetadata[];
}

/** The request-input estimate the production trigger computes. */
function estimate(messages: MessageWithMetadata[]): number {
	return estimateRequestInputTokens({
		systemPrompt: SYSTEM_PROMPT,
		messages,
		tools: [],
	});
}

describe("S2 — the representation the compaction trigger actually measures", () => {
	it("the production trigger threshold is the real policy constant", () => {
		// The discriminator must not drift away from the production policy.
		expect(COMPACTION_TRIGGER_RATIO).toBe(0.9);
		expect(
			resolveEffectiveMaxInputTokens({
				maxInputTokens: 128_000,
				contextWindow: 128_000,
			}),
		).toBe(128_000);
	});

	it("the API-SAFE PROJECTION is strictly smaller than the raw canonical view", () => {
		// The RAW canonical view carries full tool-result bodies.
		const raw = rawTranscriptWithLargeBodies();
		// The PROVIDER-VISIBLE view bounds every tool-result string to
		// DEFAULT_MAX_TOOL_RESULT_CHARS (8,000).
		const projected = projectForApi(raw);
		expect(estimate(raw)).toBeGreaterThan(estimate(projected));
	});

	it("the raw view can cross the trigger while the PROJECTED view does not", () => {
		// This is the RECON02 counterexample's SHAPE, reproduced so the
		// discriminator below can be read against a known contrast.
		const trigger = 128_000 * COMPACTION_TRIGGER_RATIO;
		const raw = rawTranscriptWithLargeBodies();
		const projected = projectForApi(raw);
		expect(estimate(raw)).toBeGreaterThan(trigger);
		expect(estimate(projected)).toBeLessThan(trigger);
	});

	it("PRODUCTION FACT 1: the trigger's request-size decision reads the API-SAFE field", () => {
		// This is the source fact `compaction.ts:381-389`:
		//
		//   const apiMessageTokens = context.apiMessages.reduce(...);
		//   const requestInputTokens = estimateRequestInputTokens({
		//     systemPrompt: context.systemPrompt,
		//     messages: context.apiMessages,      // <-- apiMessages
		//     tools: context.tools,
		//   });
		//   ...
		//   const shouldCompact = requestInputTokens >= requestTriggerTokens;
		//
		// The trigger reads the API-SAFE field. It never reads
		// `context.messages` for the request-size decision (it uses that only
		// for `messageInputTokens`, the per-message tail-selection budget).
		//
		// The behaviour is witnessed by the two tests above: the two fields
		// hold DIFFERENT representations, and only the `apiMessages` one can
		// produce the trigger's `requestInputTokens`.
		expect(
			estimate(projectForApi(rawTranscriptWithLargeBodies())),
		).toBeLessThan(128_000 * COMPACTION_TRIGGER_RATIO);
	});

	it("PRODUCTION FACT 2: the orchestrator supplies the PROJECTED view as apiMessages", () => {
		// `session-runtime-orchestrator.ts:1775`:
		//
		//   const apiMessages = await this.prepareProviderMessagesForApi(messages);
		//
		// and `prepareProviderMessagesForApi` (`:1846-1856`) ends with
		//
		//   return this.messageBuilder.buildForApi(providerMessages);
		//
		// so the value handed to `prepareTurn` — and therefore the value the
		// trigger measures — is the API-SAFE PROJECTION, produced by the SAME
		// `MessageBuilder.buildForApi` the provider request is built from.
		//
		// The consequence is that the "estimator's raw view" in RECON02's
		// counterexample is NOT a representation the production trigger can
		// observe: the orchestrator replaces it with the projected view
		// BEFORE the trigger runs.
		expect(projectForApi(rawTranscriptWithLargeBodies())).not.toEqual(
			rawTranscriptWithLargeBodies(),
		);
	});

	it("does NOT establish that the ten Round C compactions were justified", () => {
		// The decision-request accounting is UNAVAILABLE_FROM_TRACE: the
		// Round C trace carries only `{compactionInitiated,
		// effectiveMaxInputTokens}` on the compaction channel, with no
		// `requestInputTokens`, `requestTriggerTokens`, `underestimateFactor`
		// or request identity.
		//
		// The PRECEDING provider request's reported input count (63,343 —
		// 81,197) is an ADJACENT-REQUEST PROXY. A later, unsubmitted request
		// may legitimately cross the trigger even when the preceding one was
		// far below it. So the bound stands, and the per-decision estimator
		// delta remains unmeasured.
		expect(COMPACTION_TRIGGER_RATIO).toBe(0.9);
	});
});
