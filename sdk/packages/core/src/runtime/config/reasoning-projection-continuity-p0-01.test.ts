/**
 * ACT-CLINEMM-REASONING-PROJECTION-CONTINUITY-P0-01.
 *
 * CONSERVATION of the opaque reasoning payload (the signature) and of the
 * ORIGIN AUTHORITY that authorises its replay, across the CANONICAL
 * provider-visible projection.
 *
 * WHAT THIS SUITE PINS
 * ---------------------
 *
 * The projection is the CANONICAL provider-visible representation: both the
 * request-budget authority and the provider codec measure and emit exactly
 * it. It is also the projection the production session-dispatch preparation
 * uses, on every request:
 *
 *   `session-runtime-orchestrator.ts`:
 *   `prepareMessagesForModelRequest` -> `agentMessagesToMessages`
 *     -> `toProviderVisibleMessages` -> `messagesToAgentMessages`
 *
 * Its result REPLACES the request messages, so anything the projection drops
 * is gone before the gateway sees the request.
 *
 * The projection used to drop `originAuthority` — the ONLY record of the
 * route that issued the opaque signature. The outbound conversion then
 * failed closed on absent data, withheld the provider-required signature,
 * and the Anthropic serializer dropped the reasoning block from the request
 * entirely.
 *
 * These cases are CONSERVATION assertions: the authority SURVIVES the
 * projection. The end-to-end wire behaviour is pinned by
 * `session-runtime-orchestrator.reasoning-projection-continuity-p0-01.test.ts`.
 */

import type { AgentMessage } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	agentMessageToMessageWithMetadata,
	messagesToAgentMessages,
} from "./agent-message-codec";

/** A synthetic, opaque Anthropic-style signature (non-secret). */
const SIGNATURE_A = "synthetic-opaque-signature-aa11bb22";
/** A synthetic, non-secret reasoning text. */
const REASONING_A = "SYNTHETIC-REASONING-A";
/**
 * The ORIGIN AUTHORITY the production extraction stamps on a reasoning
 * payload issued by the published MiniMax route.
 */
const ORIGIN_AUTHORITY =
	"minimax\u0000https://api.minimax.io\u0000/anthropic/v1";

/** The assistant turn carrying the historical signed reasoning block. */
function signedAssistantTurn(): AgentMessage {
	return {
		id: "m_assistant",
		role: "assistant",
		createdAt: 2,
		content: [
			{
				type: "reasoning",
				text: REASONING_A,
				metadata: {
					signature: SIGNATURE_A,
					originAuthority: ORIGIN_AUTHORITY,
				},
			},
		],
	};
}

describe("reasoning projection conservation (P0-01)", () => {
	it("conserves the origin authority through the canonical projection", async () => {
		// The CANONICAL projection. This is the boundary that used to drop
		// the authority.
		const { toProviderVisibleMessages } = await import("@cline/shared");

		const projected = toProviderVisibleMessages([signedAssistantTurn()]);
		const thinking = projected[0].content[0] as unknown as Record<
			string,
			unknown
		>;

		// The signature survives ...
		expect(thinking.signature).toBe(SIGNATURE_A);
		// ... AND the origin authority, so the outbound conversion can
		// establish the route instead of failing closed on absent data.
		expect(thinking.originAuthority).toBe(ORIGIN_AUTHORITY);
	});

	it("conserves the origin authority through the persistence codec", () => {
		// The persistence codec already preserved it; this pins that the
		// two projections agree, so the authority cannot be lost between
		// them.
		const persisted = [
			agentMessageToMessageWithMetadata(signedAssistantTurn()),
		];
		const block = (Array.isArray(persisted[0].content)
			? persisted[0].content
			: [])[0] as unknown as Record<string, unknown>;

		expect(block.signature).toBe(SIGNATURE_A);
		expect(block.originAuthority).toBe(ORIGIN_AUTHORITY);
	});

	it("conserves the origin authority through the restoration codec", () => {
		const persisted = [
			agentMessageToMessageWithMetadata(signedAssistantTurn()),
		];
		const restored = messagesToAgentMessages(persisted);
		const metadata = (
			restored[0].content[0] as unknown as Record<string, unknown>
		).metadata as Record<string, unknown>;

		expect(metadata.signature).toBe(SIGNATURE_A);
		expect(metadata.originAuthority).toBe(ORIGIN_AUTHORITY);
	});

	it("does not fabricate an origin authority for an unsigned payload", async () => {
		// An ABSENT authority must stay absent: the outbound conversion
		// treats an absent authority as no replay authority, and the
		// projection must not invent one.
		const { toProviderVisibleMessages } = await import("@cline/shared");

		const projected = toProviderVisibleMessages([
			{
				id: "m_assistant",
				role: "assistant",
				createdAt: 2,
				content: [
					{
						type: "reasoning",
						text: REASONING_A,
						metadata: { signature: SIGNATURE_A },
					},
				],
			},
		]);
		const thinking = projected[0].content[0] as unknown as Record<
			string,
			unknown
		>;

		expect(Object.hasOwn(thinking, "originAuthority")).toBe(false);
	});
});
