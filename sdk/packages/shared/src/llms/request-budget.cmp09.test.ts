/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01.
 *
 * THE REASONING-AUTHORIZATION PROJECTION CONTROLS.
 *
 * ## THE DEFECT
 * ------------
 * The provider-visible projection carried EVERY reasoning block, signed or
 * not. On a transport that REQUIRES provider-origin authorization for a
 * reasoning block (the Anthropic family), an UNSIGNED reasoning block is
 * omitted by the resolved serializer: it warns "unsupported reasoning
 * metadata" and omits the block from the serialized body.
 *
 * The request-budget authority measured that SAME projection, so it counted
 * text the provider never received. The compaction trigger consumes that
 * measurement, so the divergence was CAUSAL.
 *
 * Historical consequence (session `1795639776267_j3nki`, run
 * `run_kR2y9UwW`): 659,674 characters of unsigned reasoning accumulated
 * across 18 output-exhausted responses, and 30.1% of a later measured
 * request was provider-excluded content.
 *
 * ## THE CONTROLS
 * --------------
 *   CMP09-PROJ-01  the DEFAULT projection is UNCHANGED (every reasoning
 *                  block is kept) — the pre-existing behaviour is preserved
 *                  exactly for every transport that does not declare the
 *                  requirement
 *   CMP09-PROJ-02  an unauthorized (unsigned) reasoning block is omitted
 *                  when the transport requires a signature
 *   CMP09-PROJ-03  a SIGNED reasoning block is conserved verbatim (text,
 *                  signature and details)
 *   CMP09-PROJ-04  redacted reasoning is conserved (the serializer emits it)
 *   CMP09-PROJ-05  the canonical transcript is NOT mutated
 *   CMP09-PROJ-06  tool calls, tool results and their ORDER are conserved
 *   CMP09-PROJ-07  the omitted block's text appears NOWHERE in the measured
 *                  request, so the budget cannot count it
 */

import { describe, expect, it } from "vitest";
import type { AgentMessage } from "../agent";
import {
	estimateProviderRequestInputTokens,
	omitUnauthorizedReasoningBlocks,
	type ProviderVisibleProjectionOptions,
	toProviderVisibleMessages,
} from "./request-budget";

const SIGNATURE = "a".repeat(64);

function assistantWithReasoning(
	reasoning: AgentMessage["content"][number],
): AgentMessage {
	return {
		id: "m1",
		role: "assistant",
		createdAt: 1,
		content: [reasoning],
	};
}

const SIGNED_REASONING: AgentMessage["content"][number] = {
	type: "reasoning",
	text: "signed reasoning",
	metadata: { signature: SIGNATURE },
};

const UNSIGNED_REASONING: AgentMessage["content"][number] = {
	type: "reasoning",
	text: "unsigned reasoning",
};

const REQUIRES_SIGNATURE: ProviderVisibleProjectionOptions = {
	requiresSignedReasoning: true,
};

describe("CMP-09 reasoning-authorization projection", () => {
	it("CMP09-PROJ-01: the DEFAULT projection keeps every reasoning block", () => {
		const projected = toProviderVisibleMessages([
			assistantWithReasoning(UNSIGNED_REASONING),
		]);
		expect(projected[0]!.content).toHaveLength(1);
		expect(projected[0]!.content[0]).toMatchObject({
			type: "thinking",
			thinking: "unsigned reasoning",
		});
	});

	it("CMP09-PROJ-02: an unauthorized reasoning block is omitted when required", () => {
		const projected = toProviderVisibleMessages(
			[assistantWithReasoning(UNSIGNED_REASONING)],
			REQUIRES_SIGNATURE,
		);
		expect(projected[0]!.content).toHaveLength(0);
	});

	it("CMP09-PROJ-03: a SIGNED reasoning block is conserved verbatim", () => {
		const projected = toProviderVisibleMessages(
			[assistantWithReasoning(SIGNED_REASONING)],
			REQUIRES_SIGNATURE,
		);
		expect(projected[0]!.content).toHaveLength(1);
		expect(projected[0]!.content[0]).toMatchObject({
			type: "thinking",
			thinking: "signed reasoning",
			signature: SIGNATURE,
		});
	});

	it("CMP09-PROJ-04: redacted reasoning is conserved", () => {
		const projected = toProviderVisibleMessages(
			[
				{
					id: "m1",
					role: "assistant",
					createdAt: 1,
					content: [
						{
							type: "reasoning",
							text: "",
							redacted: true,
							metadata: { data: "opaque" },
						},
					],
				},
			],
			REQUIRES_SIGNATURE,
		);
		expect(projected[0]!.content).toHaveLength(1);
		expect(projected[0]!.content[0]).toMatchObject({
			type: "redacted_thinking",
			data: "opaque",
		});
	});

	it("CMP09-PROJ-05: the canonical transcript is NOT mutated", () => {
		const transcript = [assistantWithReasoning(UNSIGNED_REASONING)];
		const before = JSON.stringify(transcript);
		toProviderVisibleMessages(transcript, REQUIRES_SIGNATURE);
		expect(JSON.stringify(transcript)).toBe(before);
	});

	it("CMP09-PROJ-06: tool calls, tool results and their ORDER are conserved", () => {
		const projected = toProviderVisibleMessages(
			[
				{
					id: "m1",
					role: "assistant",
					createdAt: 1,
					content: [
						UNSIGNED_REASONING,
						{
							type: "tool-call",
							toolCallId: "call-1",
							toolName: "run_commands",
							input: { commands: ["ls"] },
						},
					],
				},
				{
					id: "m2",
					role: "tool",
					createdAt: 2,
					content: [
						{
							type: "tool-result",
							toolCallId: "call-1",
							toolName: "run_commands",
							output: "ok",
						},
					],
				},
			],
			REQUIRES_SIGNATURE,
		);
		expect(projected).toHaveLength(2);
		expect(projected[0]!.content).toHaveLength(1);
		expect(projected[0]!.content[0]).toMatchObject({
			type: "tool_use",
			id: "call-1",
		});
		expect(projected[1]!.content[0]).toMatchObject({
			type: "tool_result",
			tool_use_id: "call-1",
		});
	});

	it("CMP09-PROJ-07: the omitted text appears nowhere in the measured request", () => {
		const transcript = [
			assistantWithReasoning({
				type: "reasoning",
				text: "X".repeat(60_000),
			}),
		];
		const measured = omitUnauthorizedReasoningBlocks(
			toProviderVisibleMessages(transcript),
			REQUIRES_SIGNATURE,
		);
		expect(JSON.stringify(measured)).not.toContain("X".repeat(100));
		// The measurement therefore cannot count it.
		const withExcluded = estimateProviderRequestInputTokens({
			systemPrompt: "",
			messages: measured,
			tools: [],
		});
		expect(withExcluded).toBeLessThan(100);
	});
});
