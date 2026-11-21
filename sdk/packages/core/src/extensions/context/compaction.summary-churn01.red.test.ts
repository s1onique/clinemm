/**
 * ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — RED WITNESS
 *
 * A RED witness for the CACHE-PREFIX STABILITY counterexample.
 *
 * WHAT IT ASSERTS
 * ---------------
 *
 * The invariant a prompt cache depends on:
 *
 *   > The provider-visible compaction summary must be BYTE-STABLE across a
 *   > continuation in which the canonical history only GREW.
 *
 * WHY IT IS A RED, NOT A GREEN
 * ----------------------------
 *
 * Against the CURRENT production behaviour this assertion FAILS: the
 * summary is rewritten, because `applyVerifiedEvidenceToCompactedMessages()`
 * re-derives the verified-outcome section from the evolved canonical history
 * and replaces it in place.
 *
 * This file is EXCLUDED from the default suite on purpose. It is retained
 * as an isolated receipt of the observed defect, exactly as the ACT
 * requires ("Preserve any RED evidence as an isolated receipt or passing
 * reproduction witness"). It must not be flipped to GREEN by weakening the
 * assertion; the repair is a SEPARATE, later ACT.
 *
 * See `compaction.summary-churn01.test.ts` for the PASSING witness that
 * pins the observed production behaviour and the causal ablation.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { applyVerifiedEvidenceToCompactedMessages } from "./evidence-continuity";
import { applyTaskContractToCompactedMessages } from "./task-contract";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
} from "../../session/models/session-compaction";

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

function assistantTurn(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

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
			} as never,
		],
	};
}

function successfulPair(
	id: string,
	command: string,
): MessageWithMetadata[] {
	return [
		toolCall(id, "run_commands", { commands: [command] }),
		toolResult(id, "run_commands", [
			{ query: command, result: "ok", success: true },
		]),
	];
}

function compactionSummaryMessage(
	summaryText: string,
): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text: `Context summary:\n\n${summaryText}` }],
		metadata: {
			kind: "compaction_summary",
			displayRole: "system",
			userRunSpan: 1,
			summary: summaryText,
			details: { readFiles: [], modifiedFiles: [] },
			tokensBefore: 1_000,
			generatedAt: 1,
		},
	};
}

function projectedSummaryText(
	messages: readonly MessageWithMetadata[],
): string {
	const summary = messages.find(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	const metadata = summary?.metadata as { summary?: string } | undefined;
	return metadata?.summary ?? "";
}

const SUMMARY_PROSE = ["## Goal", "Adjudicate the findings."].join("\n");

describe("ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — RED witness", () => {
	it("FAILS: the provider-visible summary is NOT byte-stable across an append-only canonical continuation", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			...successfulPair("call_red_h0", "echo alpha"),
			assistantTurn("continuing"),
		];
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_red_h1", "echo bravo"),
		];

		const state = createSessionCompactionState({
			sourceMessages: h0,
			compactedMessages: [compactionSummaryMessage(SUMMARY_PROSE)],
			conversationId: "conv-red",
		});

		const projectedH0 = projectSessionCompactionState(state, h0);
		const projectedH1 = projectSessionCompactionState(state, h1);
		expect(projectedH0).toBeDefined();
		expect(projectedH1).toBeDefined();
		if (projectedH0 === undefined || projectedH1 === undefined) {
			throw new Error("expected a successful projection");
		}

		const prepare = async (
			projected: readonly MessageWithMetadata[],
			canonical: readonly MessageWithMetadata[],
		): Promise<string> => {
			const contracted = await applyTaskContractToCompactedMessages(
				projected,
				canonical,
			);
			const evidenced = applyVerifiedEvidenceToCompactedMessages(
				contracted.messages,
				canonical,
			);
			return projectedSummaryText(evidenced.messages);
		};

		const before = await prepare(projectedH0, h0);
		const after = await prepare(projectedH1, h1);

		// THE RED ASSERTION.
		//
		// A prompt cache can only reuse a checkpoint over an UNCHANGED prefix.
		// The summary is the FIRST provider-visible message, so a rewritten
		// summary invalidates every deeper checkpoint.
		//
		// This assertion FAILS against the current production behaviour.
		expect(after).toBe(before);
	});
});
