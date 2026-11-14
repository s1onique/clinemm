/**
 * ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01-CORRECTION01
 *
 * INDEPENDENT conservation suite for the canonical provider-visible
 * projection in `request-budget.ts`.
 *
 * WHY THIS SUITE IS NOT A PARITY TEST
 * ------------------------------------
 * A "shared projection equals core codec projection" parity test cannot
 * catch a defect IN the shared projection: the core codec DELEGATES to the
 * shared projection, so both sides necessarily share the same behavior. Such
 * a test would have passed while the shared projection emitted empty image
 * blocks for non-string image payloads.
 *
 * These cases are instead PINNED to the PRE-REPAIR production contract,
 * captured verbatim from `@cline/core`'s `agent-message-codec.ts` at
 * `477b09c83^`:
 *
 *   case "image":
 *     return typeof part.image === "string"
 *       ? { type: "image", data: part.image, mediaType: part.mediaType ?? "image/png" }
 *       : undefined;
 *
 * The contract is:
 *  1. a STRING image is emitted verbatim (default media type `image/png`);
 *  2. a NON-STRING image (`Uint8Array` | `ArrayBuffer` | `URL`) is OMITTED
 *     from the emitted content — it is NEVER turned into an empty image
 *     block;
 *  3. an omitted image contributes NO image-token cost to the budget, so
 *     the provider-visible estimate for a request carrying only non-string
 *     images is identical to the estimate for the same request with no
 *     images at all.
 *
 * Rule 3 is the load-bearing one: an empty image block would still be
 * charged the flat per-image cost (`ESTIMATED_TOKENS_PER_IMAGE`), silently
 * changing image-token accounting on the provider-visible path.
 */

import type { AgentMessage } from "../agent";
import { describe, expect, it } from "vitest";
import {
	estimateProviderRequestInputTokens,
	toProviderVisibleMessages,
} from "./request-budget";
import { ESTIMATED_TOKENS_PER_IMAGE } from "./tokens";

function imageMessage(image: AgentMessage["content"][number]["image"]): AgentMessage {
	return {
		id: "m1",
		role: "user",
		createdAt: 1,
		content: [{ type: "image", image }],
	};
}

describe("request-budget — provider-visible image conservation (CORRECTION01)", () => {
	it("emits a string image verbatim with the default media type", () => {
		const messages = toProviderVisibleMessages([
			imageMessage("aGVsbG8="),
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [
					{ type: "image", data: "aGVsbG8=", mediaType: "image/png" },
				],
			},
		]);
	});

	it("emits a string image with its explicit media type", () => {
		const messages = toProviderVisibleMessages([
			{
				id: "m1",
				role: "user",
				createdAt: 1,
				content: [
					{ type: "image", image: "aGVsbG8=", mediaType: "image/jpeg" },
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [
					{ type: "image", data: "aGVsbG8=", mediaType: "image/jpeg" },
				],
			},
		]);
	});

	it("omits a Uint8Array image instead of emitting an empty image block", () => {
		const messages = toProviderVisibleMessages([
			imageMessage(new Uint8Array([1, 2, 3, 4])),
		]);

		// The pre-repair contract emits NO content for a non-string image.
		expect(messages).toEqual([{ role: "user", content: [] }]);
		expect(
			messages.some((message) =>
				Array.isArray(message.content) &&
				message.content.some(
					(block) => block.type === "image" && block.data === "",
				),
			),
		).toBe(false);
	});

	it("omits an ArrayBuffer image instead of emitting an empty image block", () => {
		const messages = toProviderVisibleMessages([
			imageMessage(new ArrayBuffer(8)),
		]);

		expect(messages).toEqual([{ role: "user", content: [] }]);
		expect(
			messages.some((message) =>
				Array.isArray(message.content) &&
				message.content.some(
					(block) => block.type === "image" && block.data === "",
				),
			),
		).toBe(false);
	});

	it("omits a URL image instead of emitting an empty image block", () => {
		const messages = toProviderVisibleMessages([
			imageMessage(new URL("https://example.com/cat.png")),
		]);

		expect(messages).toEqual([{ role: "user", content: [] }]);
		expect(
			messages.some((message) =>
				Array.isArray(message.content) &&
				message.content.some(
					(block) => block.type === "image" && block.data === "",
				),
			),
		).toBe(false);
	});

	it("omits only the non-string image and keeps sibling parts", () => {
		const messages = toProviderVisibleMessages([
			{
				id: "m1",
				role: "user",
				createdAt: 1,
				content: [
					{ type: "text", text: "before" },
					{ type: "image", image: new Uint8Array([1, 2, 3]) },
					{ type: "text", text: "after" },
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "before" },
					{ type: "text", text: "after" },
				],
			},
		]);
	});
});

describe("request-budget — image-token accounting conservation (CORRECTION01)", () => {
	// The estimator bills the serialized envelope as well as the image cost,
	// so every comparison below is made between two requests that differ ONLY
	// in the image part. That isolates the image-token contribution exactly.
	const textOnlyMessage: AgentMessage = {
		id: "m1",
		role: "user",
		createdAt: 1,
		content: [{ type: "text", text: "hello" }],
	};

	it("charges the flat per-image cost for a string image", () => {
		const withoutImage = estimateProviderRequestInputTokens({
			messages: toProviderVisibleMessages([textOnlyMessage]),
		});
		const withImage = estimateProviderRequestInputTokens({
			messages: toProviderVisibleMessages([
				{
					id: "m1",
					role: "user",
					createdAt: 1,
					content: [
						{ type: "text", text: "hello" },
						{ type: "image", image: "aGVsbG8=" },
					],
				},
			]),
		});

		// The image payload is blanked by the estimator and replaced by the
		// flat per-image cost. The delta therefore also includes the
		// serialized envelope of the emitted image block itself
		// (`{"type":"image","data":"","mediaType":"image/png"}`), which is
		// charged at CHARS_PER_TOKEN like any other content.
		expect(withImage - withoutImage).toBeGreaterThanOrEqual(
			ESTIMATED_TOKENS_PER_IMAGE,
		);
		expect(withImage - withoutImage).toBeLessThan(
			ESTIMATED_TOKENS_PER_IMAGE + 100,
		);
	});

	it("charges NO image-token cost for an omitted non-string image", () => {
		const baseline = estimateProviderRequestInputTokens({
			messages: toProviderVisibleMessages([textOnlyMessage]),
		});

		for (const image of [
			new Uint8Array([1, 2, 3, 4]),
			new ArrayBuffer(8),
			new URL("https://example.com/cat.png"),
		]) {
			const estimate = estimateProviderRequestInputTokens({
				messages: toProviderVisibleMessages([
					{
						id: "m1",
						role: "user",
						createdAt: 1,
						content: [
							{ type: "text", text: "hello" },
							{ type: "image", image },
						],
					},
				]),
			});

			// An omitted image must not be billed at all. An empty image
			// block would still be charged the flat per-image cost.
			expect(estimate).toBe(baseline);
			expect(estimate).toBeLessThan(baseline + ESTIMATED_TOKENS_PER_IMAGE);
		}
	});

	it("does not let an omitted non-string image flip a fail-closed budget decision", () => {
		const baseline = estimateProviderRequestInputTokens({
			messages: toProviderVisibleMessages([textOnlyMessage]),
		});

		// A ceiling that exactly admits the baseline request must still admit
		// it when the request carries only non-string images. If those images
		// were emitted as empty blocks they would add
		// `ESTIMATED_TOKENS_PER_IMAGE` and push the request over.
		const ceiling = baseline;
		const estimate = estimateProviderRequestInputTokens({
			messages: toProviderVisibleMessages([
				{
					id: "m1",
					role: "user",
					createdAt: 1,
					content: [
						{ type: "text", text: "hello" },
						{ type: "image", image: new Uint8Array([1, 2, 3, 4]) },
					],
				},
			]),
		});

		expect(estimate).toBeLessThanOrEqual(ceiling);
	});
});
