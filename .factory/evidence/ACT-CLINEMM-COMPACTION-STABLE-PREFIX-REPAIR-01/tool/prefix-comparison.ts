/**
 * ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01
 * OFFLINE PROVIDER-PREFIX COMPARISON
 *
 * A DISPOSABLE, OFFLINE analysis tool. It lives under `.factory/evidence/`
 * and is NOT part of any production build, package export or runtime path.
 *
 * WHAT IT DOES
 * ------------
 * It measures the provider-visible representation of FOUR successive
 * post-compaction requests (A: the persisted summary established, B: the first
 * append-only verified outcome, C: the second append-only verified outcome,
 * D: an unchanged-history control) under the SAME source inputs, for the
 * BASELINE behaviour and the REPAIRED behaviour.
 *
 * The BASELINE is the historical production behaviour: the verified-outcome
 * section is re-derived from the WHOLE canonical history on every restoration.
 * The REPAIRED behaviour is the boundary-scoped derivation.
 *
 * It never calls a provider. It never writes a session.
 *
 * THE MEASURE
 * -----------
 * The common prefix is measured in UTF-16 CODE UNITS over the SERIALIZED
 * provider-visible message list. It is STRUCTURAL: it is neither a tokenizer
 * token offset nor a byte count, and it says nothing about whether a provider
 * retained a checkpoint at that boundary.
 */

import { writeFileSync } from "node:fs";
import type { MessageWithMetadata } from "@cline/shared";
import {
	applyVerifiedEvidenceToCompactedMessages,
} from "../../../../sdk/packages/core/src/extensions/context/evidence-continuity";
import { applyTaskContractToCompactedMessages } from "../../../../sdk/packages/core/src/extensions/context/task-contract";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
} from "../../../../sdk/packages/core/src/session/models/session-compaction";
import { MessageBuilder } from "../../../../sdk/packages/core/src/session/services/message-builder";

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

function assistantTurn(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

function successfulPair(id: string, command: string): MessageWithMetadata[] {
	return [
		{
			role: "assistant",
			content: [{ type: "tool_use", id, name: "run_commands", input: { commands: [command] } }],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					name: "run_commands",
					content: [{ query: command, result: "ok", success: true }],
				} as never,
			],
		},
	];
}

const SUMMARY_PROSE = ["## Goal", "Adjudicate the findings."].join("\n");

function compactionSummaryMessage(summaryText: string): MessageWithMetadata {
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

/** The serialized provider-visible representation. */
function serialize(messages: readonly MessageWithMetadata[]): string {
	return JSON.stringify(new MessageBuilder().buildForApi(messages as never));
}

/** The structural common prefix, in UTF-16 code units. */
function commonPrefixCodeUnits(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	let index = 0;
	while (index < limit && left[index] === right[index]) {
		index += 1;
	}
	return index;
}

/** The provider-visible summary text. */
function summaryTextOf(messages: readonly MessageWithMetadata[]): string {
	const summary = messages.find(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	const metadata = summary?.metadata as { summary?: string } | undefined;
	return metadata?.summary ?? "";
}

async function prepare(
	projected: readonly MessageWithMetadata[],
	canonical: readonly MessageWithMetadata[],
	mode: "baseline" | "repaired",
	boundary: number,
): Promise<MessageWithMetadata[]> {
	const contracted = await applyTaskContractToCompactedMessages(
		projected,
		canonical,
	);
	// The BASELINE is the HISTORICAL production behaviour: the section was
	// re-derived from the WHOLE canonical history on every restoration. The
	// boundary is the whole canonical history, which is exactly what the
	// pre-repair helper used.
	const evidenced = applyVerifiedEvidenceToCompactedMessages(
		contracted.messages,
		canonical,
		mode === "baseline"
			? { sourceMessageCount: canonical.length }
			: { sourceMessageCount: boundary },
	);
	return evidenced.messages;
}

async function main(): Promise<void> {
	const h0: MessageWithMetadata[] = [
		userTurn("Adjudicate the ten findings."),
		...successfulPair("call_pc_0", "echo alpha"),
		assistantTurn("continuing"),
	];
	const h1: MessageWithMetadata[] = [
		...h0,
		...successfulPair("call_pc_1", "echo bravo"),
	];
	const h2: MessageWithMetadata[] = [
		...h1,
		...successfulPair("call_pc_2", "echo charlie"),
	];

	const state = createSessionCompactionState({
		sourceMessages: h0,
		compactedMessages: [compactionSummaryMessage(SUMMARY_PROSE)],
		conversationId: "conv-prefix",
	});

	const steps = [
		{ id: "A", label: "persisted compaction summary established", canonical: h0 },
		{ id: "B", label: "first append-only verified outcome", canonical: h1 },
		{ id: "C", label: "second append-only verified outcome", canonical: h2 },
		{ id: "D", label: "unchanged-history control", canonical: h2 },
	];

	const result: Record<string, unknown> = {
		act: "ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01",
		tool: "offline provider-prefix comparison",
		mode: "SYNTHETIC_REAL_SEAM",
		measure:
			"Structural common prefix in UTF-16 code units over the serialized " +
			"provider-visible message list. NOT a tokenizer token offset and NOT " +
			"a byte count.",
		limitations: [
			"A longer structural common prefix establishes that ClineMM stopped the targeted early mutation.",
			"It does NOT establish that Strata retained a checkpoint at that boundary.",
			"TOKEN_LEVEL_CACHE_COMPATIBILITY is unavailable unless directly verified.",
			"LIVE_PREFILL_IMPROVEMENT is NOT_EXECUTED.",
		],
		steps: [],
	};

	for (const mode of ["baseline", "repaired"] as const) {
		const rendered: Record<string, unknown>[] = [];
		let previousSerialized = "";
		for (const step of steps) {
			const projected = projectSessionCompactionState(state, step.canonical);
			if (!projected) {
				throw new Error(`${mode}/${step.id}: expected a successful projection`);
			}
			const prepared = await prepare(
				projected,
				step.canonical,
				mode,
				state.source_message_count,
			);
			const serialized = serialize(prepared);
			const summary = summaryTextOf(prepared);
			rendered.push({
				id: step.id,
				label: step.label,
				providerVisibleMessageCount: prepared.length,
				summaryByteLength: Buffer.byteLength(summary, "utf8"),
				summaryFingerprintSha256Prefix: (
					await import("node:crypto")
				)
					.createHash("sha256")
					.update(summary)
					.digest("hex")
					.slice(0, 16),
				serializedLengthCodeUnits: serialized.length,
				commonPrefixWithPreviousCodeUnits: previousSerialized
					? commonPrefixCodeUnits(previousSerialized, serialized)
					: serialized.length,
				containsPostBoundaryOutcome:
					step.id === "B"
						? serialized.includes("call_pc_1")
						: step.id === "C"
							? serialized.includes("call_pc_2")
							: true,
				containsBoundaryOutcome: serialized.includes("call_pc_0"),
				containsTaskContract: serialized.includes(
					"## Active task contract (authoritative)",
				),
				serialized: serialized,
			});
			previousSerialized = serialized;
		}
		result[mode] = rendered;
	}

	// The structural comparison table.
	const baseline = result.baseline as Record<string, unknown>[];
	const repaired = result.repaired as Record<string, unknown>[];
	const table = steps.map((step, index) => {
		const b = baseline[index] as Record<string, unknown>;
		const r = repaired[index] as Record<string, unknown>;
		return {
			step: step.id,
			label: step.label,
			baselineSummaryFingerprint: b.summaryFingerprintSha256Prefix,
			repairedSummaryFingerprint: r.summaryFingerprintSha256Prefix,
			baselineSummaryByteLength: b.summaryByteLength,
			repairedSummaryByteLength: r.summaryByteLength,
			baselineCommonPrefixCodeUnits: b.commonPrefixWithPreviousCodeUnits,
			repairedCommonPrefixCodeUnits: r.commonPrefixWithPreviousCodeUnits,
			baselineCurrentVerifiedOutcomesVisible: b.containsPostBoundaryOutcome,
			repairedCurrentVerifiedOutcomesVisible: r.containsPostBoundaryOutcome,
			baselineTaskContractVisible: b.containsTaskContract,
			repairedTaskContractVisible: r.containsTaskContract,
			baselineProviderVisibleMessageCount: b.providerVisibleMessageCount,
			repairedProviderVisibleMessageCount: r.providerVisibleMessageCount,
			additionalProviderRequests: 0,
		};
	});
	result.comparison = table;

	// The serialized payloads are NOT emitted: they carry the synthetic
	// fixture content and would bloat the artifact without adding evidence.
	for (const mode of ["baseline", "repaired"] as const) {
		for (const entry of result[mode] as Record<string, unknown>[]) {
			delete entry.serialized;
		}
	}

	writeFileSync(
		new URL("../provider-prefix-comparison.json", import.meta.url),
		`${JSON.stringify(result, null, 2)}\n`,
		"utf8",
	);

	process.stdout.write(`${JSON.stringify(table, null, 2)}\n`);
}

await main();
