/**
 * ACT-CLINEMM-REASONING-PROJECTION-CONTINUITY-P0-01.
 *
 * The provider-visible projection must carry the ORIGIN AUTHORITY of an
 * opaque reasoning payload.
 *
 * THE DEFECT
 * ----------
 *
 * `toProviderVisibleMessages` is the CANONICAL provider-visible projection.
 * Its reasoning case emitted `signature` and `details` but NOT
 * `originAuthority` — the only record of the route that issued the opaque
 * signature.
 *
 * The projection is used by the production session-dispatch preparation
 * (`session-runtime-orchestrator.ts`:
 * `prepareMessagesForModelRequest` -> `agentMessagesToMessages` ->
 * `toProviderVisibleMessages` -> `messagesToAgentMessages`) on EVERY
 * request, and its result REPLACES the request messages. So the authority
 * was silently destroyed before the request reached the gateway.
 *
 * The outbound conversion then read an ABSENT origin, failed closed (an
 * absent origin grants no replay authority), withheld the signature, and
 * the Anthropic serializer dropped the reasoning block from the request
 * entirely.
 *
 * WHAT MUST HOLD
 * --------------
 *
 * The authority survives the projection, so the outbound conversion can
 * enforce the route boundary instead of failing closed on absent data.
 *
 * This is an INTERNAL boundary only: the authority is consumed by the
 * outbound conversion and is never part of a provider's wire shape.
 */

import { describe, expect, it } from "vitest";
import { toProviderVisibleMessages } from "./request-budget";

/** A synthetic, opaque Anthropic-style signature (non-secret). */
const SIGNATURE_A = "synthetic-opaque-signature-aa11bb22";
/** A synthetic, non-secret reasoning text. */
const REASONING_A = "SYNTHETIC-REASONING-A";
/**
 * A synthetic origin authority in the production shape:
 * `<providerId>\0<origin>\0<path>`.
 */
const ORIGIN_AUTHORITY =
	"minimax\u0000https://api.minimax.io\u0000/anthropic/v1";

function reasoningTurn(metadata: Record<string, unknown> | undefined): {
	id: string;
	role: "assistant";
	createdAt: number;
	content: unknown[];
} {
	return {
		id: "m_assistant",
		role: "assistant",
		createdAt: 2,
		content: [
			{
				type: "reasoning",
				text: REASONING_A,
				...(metadata !== undefined ? { metadata } : {}),
			},
		],
	};
}

function firstThinkingBlock(
	messages: ReturnType<typeof toProviderVisibleMessages>,
): Record<string, unknown> {
	const content = messages[0].content;
	return (Array.isArray(content) ? content[0] : {}) as unknown as Record<
		string,
		unknown
	>;
}

describe("reasoning projection continuity (P0-01)", () => {
	it("carries the origin authority alongside the signature", () => {
		const projected = toProviderVisibleMessages([
			reasoningTurn({
				signature: SIGNATURE_A,
				originAuthority: ORIGIN_AUTHORITY,
			}),
		]);

		const thinking = firstThinkingBlock(projected);
		// The signature survives ...
		expect(thinking.signature).toBe(SIGNATURE_A);
		// ... AND the origin authority, so the outbound conversion can
		// establish the route instead of failing closed on absent data.
		expect(thinking.originAuthority).toBe(ORIGIN_AUTHORITY);
	});

	it("omits the origin authority when the part carries none", () => {
		// Backward compatibility: a record written before this field
		// existed simply has none, and the projection must not fabricate
		// one.
		const projected = toProviderVisibleMessages([
			reasoningTurn({ signature: SIGNATURE_A }),
		]);

		const thinking = firstThinkingBlock(projected);
		expect(thinking.signature).toBe(SIGNATURE_A);
		expect(Object.hasOwn(thinking, "originAuthority")).toBe(false);
	});

	it("omits the origin authority when it is not a string", () => {
		// A malformed authority yields NO authority — the same fail-closed
		// reading the outbound conversion applies.
		const projected = toProviderVisibleMessages([
			reasoningTurn({
				signature: SIGNATURE_A,
				originAuthority: { not: "a string" },
			}),
		]);

		const thinking = firstThinkingBlock(projected);
		expect(Object.hasOwn(thinking, "originAuthority")).toBe(false);
	});

	it("omits the origin authority when the part has no metadata at all", () => {
		const projected = toProviderVisibleMessages([reasoningTurn(undefined)]);

		const thinking = firstThinkingBlock(projected);
		expect(thinking.thinking).toBe(REASONING_A);
		expect(Object.hasOwn(thinking, "originAuthority")).toBe(false);
	});

	it("does not alter the redacted-thinking projection", () => {
		// A redacted reasoning block keeps its own shape: the authority
		// rides on the opaque payload, not on a redacted block.
		const projected = toProviderVisibleMessages([
			{
				id: "m_assistant",
				role: "assistant",
				createdAt: 2,
				content: [
					{
						type: "reasoning",
						text: "",
						redacted: true,
						metadata: { data: "SYNTHETIC-REDACTED" },
					},
				],
			},
		]);

		const block = projected[0].content[0] as unknown as Record<string, unknown>;
		expect(block.type).toBe("redacted_thinking");
		expect(block.data).toBe("SYNTHETIC-REDACTED");
	});
});
