/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 1 offline replay profiler types.
 *
 * ## Purpose
 *
 * A statically typed, dependency-minimal model of a recorded agent session
 * transcript (the shape produced by the SDK's session persistence) plus the
 * metrics the offline profiler derives from it.
 *
 * ## Safety invariant (load-bearing)
 *
 * The profiler PARSES the transcript. It never EXECUTES anything it reads.
 * Transcript text is data, never instructions: no field of this module is
 * interpreted as a command, a script, a path to read, or a directive to
 * follow. Command strings are carried as opaque text and are only ever
 * counted and length-measured. This is what makes it safe to point the
 * profiler at a transcript captured from an adversarial session.
 */

/**
 * A single content block inside a recorded message.
 *
 * Only the structural fields are modelled. Free-form payloads (text,
 * thinking, tool arguments) are typed as `unknown` so the profiler can
 * reason about their SHAPE without ever interpreting their CONTENT.
 */
export type ReplayContentBlock =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "thinking"; readonly thinking: string }
	| {
			readonly type: "tool_use";
			readonly id: string;
			readonly name: string;
			readonly input: unknown;
	  }
	| {
			readonly type: "tool_result";
			readonly tool_use_id: string;
			readonly name?: string;
			readonly content: unknown;
	  }
	| { readonly type: "unknown"; readonly raw: unknown };

/**
 * One recorded message in the session transcript.
 */
export interface ReplayMessage {
	readonly id: string;
	readonly role: "user" | "assistant" | "unknown";
	readonly ts: number | undefined;
	readonly content: readonly ReplayContentBlock[];
	readonly modelInfo: ReplayModelInfo | undefined;
	readonly metrics: ReplayUsageMetrics | undefined;
}

/**
 * Model identity reported by the transcript for an assistant turn.
 */
export interface ReplayModelInfo {
	readonly id: string;
	readonly provider: string;
}

/**
 * Token accounting reported by the transcript for an assistant turn.
 *
 * These are TRANSCRIPT-REPORTED values. They describe what the provider
 * claimed to have billed; they are not an independent measurement of the
 * host's own accounting. The profiler keeps the two apart on purpose (see
 * `ReplayMetricProvenance`).
 */
export interface ReplayUsageMetrics {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
}

/**
 * The persisted transcript document.
 */
export interface ReplayTranscript {
	readonly version: number | undefined;
	readonly sessionId: string;
	readonly agent: string | undefined;
	readonly origin: ReplayOrigin | undefined;
	readonly messages: readonly ReplayMessage[];
}

/**
 * Where a session came from and which extension build produced it.
 */
export interface ReplayOrigin {
	readonly source?: string;
	readonly mode?: string;
	readonly sessionId?: string;
	readonly version?: string;
}

/**
 * How a metric was obtained.
 *
 * This distinction is the point of the profiler: a number that the
 * transcript REPORTED is not the same kind of evidence as a number the
 * profiler MEASURED from the transcript's own structure.
 */
export type ReplayMetricProvenance =
	/** Reported by the transcript's own fields (token counts, model id). */
	| "transcript_reported"
	/** Derived by the profiler from the transcript's structure (counts, spans). */
	| "profiler_derived";

/**
 * A metric with its provenance attached.
 */
export interface ReplayMetric<T> {
	readonly value: T;
	readonly provenance: ReplayMetricProvenance;
}

/**
 * How a wall-clock span between two consecutive transcript events is
 * attributed.
 *
 * - `model`   — the gap the agent spent waiting for the model's next turn.
 * - `tool`    — the gap between an assistant tool call and its tool result.
 * - `other`   — every other gap (e.g. consecutive tool-result messages).
 */
export type ReplayIntervalKind = "model" | "tool" | "other";

/**
 * One attributed gap between two consecutive transcript events.
 */
export interface ReplayInterval {
	readonly kind: ReplayIntervalKind;
	readonly fromIndex: number;
	readonly toIndex: number;
	readonly durationMs: number;
}

/**
 * A tool invocation paired with its result.
 */
export interface ReplayToolInvocation {
	/** Index of the assistant message that carried the tool call. */
	readonly eventIndex: number;
	/** The tool name as recorded in the transcript. */
	readonly tool: string;
	/**
	 * Whether the recorded input matched the STRICT `run_commands` schema
	 * shape. `null` for tools whose input is not command-shaped.
	 */
	readonly schemaValid: boolean | null;
	/** Number of VALID command strings the invocation contributed. */
	readonly commandCount: number | null;
	/** Number of result items the invocation produced. */
	readonly resultItems: number;
	/** Number of result items reported successful. */
	readonly successItems: number;
	/** Number of result items reported failed. */
	readonly failedItems: number;
	/** Total characters of result text (never the text itself). */
	readonly resultTextChars: number;
	/** Whether the result was a schema rejection rather than an execution. */
	readonly schemaError: boolean;
	/** The raw rejection message, if the invocation was schema-rejected. */
	readonly schemaErrorMessage: string | undefined;
}

/**
 * One assistant model turn.
 */
export interface ReplayModelTurn {
	readonly eventIndex: number;
	readonly tsUtc: string | undefined;
	/** Wall-clock gap from the previous transcript event to this turn. */
	readonly elapsedMs: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly modelId: string | undefined;
	readonly provider: string | undefined;
}

/**
 * The compaction snapshot sidecar, as recorded.
 */
export interface ReplayCompactionSnapshot {
	readonly conversationId: string | undefined;
	readonly sourceMessageCount: number | undefined;
	readonly sourcePrefixHash: string | undefined;
	readonly sourceLastMessageKey: string | undefined;
	readonly generatedAtUtc: string | undefined;
	readonly summaryChars: number;
	/** Characters of the summary attributed to the task contract. */
	readonly contractChars: number;
	/** Number of messages the snapshot carries forward. */
	readonly carriedMessageCount: number;
}

/**
 * The complete profile produced by the offline replay.
 */
export interface ReplayProfile {
	readonly sessionId: string;
	readonly model: string | undefined;
	readonly provider: string | undefined;
	readonly extensionVersion: string | undefined;

	readonly elapsedMs: ReplayMetric<number>;
	readonly messageCount: ReplayMetric<number>;
	readonly modelTurns: ReplayMetric<number>;
	readonly toolInvocations: ReplayMetric<number>;
	readonly toolInvocationsByName: Readonly<Record<string, number>>;
	readonly validCommandStrings: ReplayMetric<number>;
	readonly rejectedCommandSchemaInvocations: ReplayMetric<number>;
	readonly rejectedCommandSchemaByShape: Readonly<Record<string, number>>;

	readonly intervalMsByKind: Readonly<
		Record<ReplayIntervalKind, ReplayMetric<number>>
	>;
	readonly inputTokens: ReplayMetric<number>;
	readonly outputTokens: ReplayMetric<number>;
	readonly cacheReadTokens: ReplayMetric<number>;
	readonly cacheWriteTokens: ReplayMetric<number>;
	readonly compactionSnapshots: ReplayMetric<number>;

	readonly perModelTurn: readonly ReplayModelTurn[];
	readonly perToolInvocation: readonly ReplayToolInvocation[];
	readonly perCompaction: readonly ReplayCompactionSnapshot[];
}
