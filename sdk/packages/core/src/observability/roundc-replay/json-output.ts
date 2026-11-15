/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 1 deterministic profile output.
 *
 * ## Determinism
 *
 * The profiler's JSON output must be byte-identical across runs, hosts, and
 * process invocations. `JSON.stringify` is NOT sufficient on its own:
 * object key order follows insertion order, and `undefined` members are
 * silently DROPPED rather than reported. This serializer therefore:
 *
 *   - sorts object keys lexicographically,
 *   - emits `undefined` members as an explicit `null` so a missing field
 *     is never confused with an absent one,
 *   - renders arrays in their natural order (order IS data here),
 *   - escapes strings with the same rules `JSON.stringify` uses.
 *
 * The result is a stable string that can be committed, diffed, and
 * compared byte-for-byte across runs.
 */

import type { ReplayProfile } from "./types";

/**
 * A JSON-compatible value.
 */
type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/**
 * Convert an arbitrary value into a JSON-compatible one.
 *
 * `undefined` becomes `null` (explicitly reported, never dropped).
 * Non-finite numbers become `null` (JSON has no representation for them).
 * Functions and symbols become `null`.
 */
function toJsonValue(value: unknown): JsonValue {
	if (value === undefined) {
		return null;
	}
	if (value === null) {
		return null;
	}
	if (typeof value === "string" || typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (Array.isArray(value)) {
		return value.map(toJsonValue);
	}
	if (typeof value === "object") {
		const result: { [key: string]: JsonValue } = {};
		for (const [key, member] of Object.entries(
			value as Record<string, unknown>,
		)) {
			result[key] = toJsonValue(member);
		}
		return result;
	}
	return null;
}

/**
 * Recursively sort the keys of a JSON-compatible value.
 */
function sortKeys(value: JsonValue): JsonValue {
	if (Array.isArray(value)) {
		return value.map(sortKeys);
	}
	if (value !== null && typeof value === "object") {
		const sorted: { [key: string]: JsonValue } = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = sortKeys(value[key] as JsonValue);
		}
		return sorted;
	}
	return value;
}

/**
 * Serialize a value to deterministic, pretty-printed JSON.
 *
 * Keys are sorted lexicographically at every depth; arrays keep their
 * order. The output always ends with a newline so it is a well-formed
 * text file.
 */
export function toDeterministicJson(value: unknown): string {
	return `${JSON.stringify(sortKeys(toJsonValue(value)), null, 2)}\n`;
}

/**
 * The stable, human-readable summary of a replay profile.
 *
 * This is the shape the Round C baseline crosswalk is checked against. It
 * deliberately reports TRANSCRIPT-REPORTED and PROFILER-DERIVED metrics
 * side by side with their provenance, so a reader can always tell which
 * numbers came from the transcript and which were computed here.
 */
export interface ReplayProfileSummary {
	readonly session_id: string;
	readonly model: string | null;
	readonly provider: string | null;
	readonly extension_version: string | null;

	readonly elapsed_ms: number;
	readonly elapsed_ms_provenance: string;
	readonly message_count: number;
	readonly model_turns: number;
	readonly tool_invocations: number;
	readonly tool_invocations_by_name: { readonly [name: string]: number };
	readonly valid_command_strings: number;
	readonly rejected_command_schema_invocations: number;
	readonly rejected_command_schema_by_shape: {
		readonly [shape: string]: number;
	};

	readonly interval_ms_by_kind: {
		readonly model: number;
		readonly tool: number;
		readonly other: number;
	};
	readonly interval_ms_by_kind_provenance: { readonly [kind: string]: string };

	readonly input_tokens_sum: number;
	readonly output_tokens_sum: number;
	readonly cache_read_tokens_sum: number;
	readonly cache_write_tokens_sum: number;
	readonly token_provenance: string;

	readonly compaction_snapshots: number;
	readonly compaction: readonly {
		readonly conversation_id: string | null;
		readonly source_message_count: number | null;
		readonly source_prefix_hash: string | null;
		readonly generated_at_utc: string | null;
		readonly summary_chars: number;
		readonly contract_chars: number;
		readonly contract_ratio: number;
		readonly carried_message_count: number;
	}[];
}

/**
 * Build the stable summary of a replay profile.
 */
export function summarizeProfile(profile: ReplayProfile): ReplayProfileSummary {
	return {
		session_id: profile.sessionId,
		model: profile.model ?? null,
		provider: profile.provider ?? null,
		extension_version: profile.extensionVersion ?? null,
		elapsed_ms: profile.elapsedMs.value,
		elapsed_ms_provenance: profile.elapsedMs.provenance,
		message_count: profile.messageCount.value,
		model_turns: profile.modelTurns.value,
		tool_invocations: profile.toolInvocations.value,
		tool_invocations_by_name: { ...profile.toolInvocationsByName },
		valid_command_strings: profile.validCommandStrings.value,
		rejected_command_schema_invocations:
			profile.rejectedCommandSchemaInvocations.value,
		rejected_command_schema_by_shape: {
			...profile.rejectedCommandSchemaByShape,
		},
		interval_ms_by_kind: {
			model: profile.intervalMsByKind.model.value,
			tool: profile.intervalMsByKind.tool.value,
			other: profile.intervalMsByKind.other.value,
		},
		interval_ms_by_kind_provenance: {
			model: profile.intervalMsByKind.model.provenance,
			tool: profile.intervalMsByKind.tool.provenance,
			other: profile.intervalMsByKind.other.provenance,
		},
		input_tokens_sum: profile.inputTokens.value,
		output_tokens_sum: profile.outputTokens.value,
		cache_read_tokens_sum: profile.cacheReadTokens.value,
		cache_write_tokens_sum: profile.cacheWriteTokens.value,
		token_provenance: profile.inputTokens.provenance,
		compaction_snapshots: profile.compactionSnapshots.value,
		compaction: profile.perCompaction.map((snapshot) => ({
			conversation_id: snapshot.conversationId ?? null,
			source_message_count: snapshot.sourceMessageCount ?? null,
			source_prefix_hash: snapshot.sourcePrefixHash ?? null,
			generated_at_utc: snapshot.generatedAtUtc ?? null,
			summary_chars: snapshot.summaryChars,
			contract_chars: snapshot.contractChars,
			contract_ratio:
				snapshot.summaryChars > 0
					? snapshot.contractChars / snapshot.summaryChars
					: 0,
			carried_message_count: snapshot.carriedMessageCount,
		})),
	};
}
