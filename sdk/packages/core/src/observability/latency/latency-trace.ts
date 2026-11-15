/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 2 latency instrumentation.
 *
 * ## What this module is
 *
 * A boundary tracer for the agent turn. It records WHEN each of the nine
 * load-bearing boundaries was crossed, HOW LONG each stage took, and how
 * the stages correlate — so that a slow turn can be attributed to
 * execution, queuing, transport, or delivery instead of guessed at.
 *
 * ## The nine boundaries
 *
 * | # | Boundary                        | Phase                  |
 * |---|---------------------------------|------------------------|
 * | 1 | model request prepared          | `request_prepared`     |
 * | 2 | provider request submitted      | `provider_submitted`   |
 * | 3 | first provider response / token | `provider_first_token` |
 * | 4 | provider response completed    | `provider_completed`   |
 * | 5 | tool-call schema validation    | `schema_validation`    |
 * | 6 | tool execution                 | `tool_execution`       |
 * | 7 | tool result delivered          | `tool_result_delivered`|
 * | 8 | tool result in provider request| `provider_ready`       |
 * | 9 | compaction                     | `compaction`           |
 *
 * ## Why the distinction between phases matters
 *
 * The Round C transcript showed a ~5 s floor on command results. That
 * floor is only meaningful once EXECUTION time is separated from
 * QUEUEING, TRANSPORT and DELIVERY time. The tracer therefore records a
 * stage START and a stage END for every span, and the derived
 * `LatencyStage` durations name the gap they cover:
 *
 * - `queue`      — the agent held the work and had not sent it yet;
 * - `transport`  — the request was sent and the provider had not answered;
 * - `preparation`— the request was being prepared for the provider;
 * - `execution`  — the tool was actually running (the executor's own
 *                  measured run time, reported as its own stage);
 * - `delivery`   — the result existed but had not reached the transcript.
 *
 * The post-execution gap is a DELIVERY delay and is classified as
 * `delivery`, NEVER as `execution`. A tool that ran for 10 ms and whose
 * result was delivered 5 s later therefore reports 10 ms of `execution`
 * and 5,000 ms of `delivery` at the stage level.
 *
 * ## Privacy invariant (load-bearing)
 *
 * The tracer records COUNTS, BYTE SIZES and DIGESTS. It never records a
 * prompt, a file's content, a command's arguments, a command's output, a
 * secret, or an authorization header. The metadata is passed through a
 * strict ALLOWLIST: a field that is not on the list is DROPPED, not
 * recorded.
 *
 * The digest of a tool result is a SHA-256 over its bytes, so two
 * observations of the same result can be correlated without the content
 * ever leaving the process.
 *
 * ## Cost
 *
 * The tracer is OPT-IN and disabled by default. When disabled every call
 * site pays a single boolean check. The overhead of the enabled path is
 * measured by the benchmark in `latency-trace.test.ts`.
 */

import { createHash } from "node:crypto";

/**
 * The instrumented boundaries.
 *
 * `provider_first_response` and `provider_first_token` are DISTINCT
 * boundaries, and the distinction matters: the first response EVENT (the
 * provider acknowledging, or sending its first byte) is not the same
 * instant as the first generated TOKEN. A provider may take a long time
 * to send its first byte and then stream tokens quickly, or respond
 * instantly and then think before its first token.
 *
 * A stream's COMPLETION is neither of them. Recording the completion as
 * if it were the first token produces a fabricated time-to-first-token,
 * so the two are kept apart and an unobservable measurement is reported
 * as UNAVAILABLE rather than as a zero-duration success.
 */
export type LatencyBoundary =
	| "request_preparation"
	| "request_prepared"
	| "provider_submitted"
	| "provider_first_response"
	| "provider_first_token"
	| "provider_completed"
	| "schema_validation"
	| "tool_execution"
	| "tool_result_delivered"
	| "provider_ready"
	| "compaction";

/**
 * Every boundary, in the order a well-behaved turn crosses them.
 *
 * The list is used to report which measurements were NOT available.
 */
export const ALL_LATENCY_BOUNDARIES: readonly LatencyBoundary[] = [
	"request_preparation",
	"request_prepared",
	"provider_submitted",
	"provider_first_response",
	"provider_first_token",
	"provider_completed",
	"schema_validation",
	"tool_execution",
	"tool_result_delivered",
	"provider_ready",
	"compaction",
];

/**
 * The stage a measured gap belongs to.
 */
export type LatencyStage =
	/** The agent had the work and had not sent it. */
	| "queue"
	/** The request was in flight; the provider had not answered. */
	| "transport"
	/** The request was being prepared for the provider. */
	| "preparation"
	/** The tool was actually running. */
	| "execution"
	/** The result existed but had not reached the conversation. */
	| "delivery"
	/** The span was not attributable to a single stage. */
	| "unclassified";

/**
 * The status of a completed span.
 */
export type LatencyStatus =
	| "ok"
	| "failed"
	| "cancelled"
	| "rejected"
	| "aborted";

/**
 * The metadata fields the tracer is ALLOWED to record.
 *
 * This list is the whole privacy contract. A field that is not here is
 * DROPPED by {@link sanitizeLatencyMetadata}. Adding a field here is a
 * deliberate act: it must be a count, a size, a digest, an identifier, or
 * a classification — never content.
 */
export const LATENCY_METADATA_ALLOWLIST: readonly string[] = [
	// Identity / correlation
	"modelId",
	"providerId",
	"toolName",
	"toolCallId",
	"commandCount",
	"toolCount",
	// Token accounting (numbers only)
	"inputTokens",
	"outputTokens",
	"cacheReadTokens",
	"cacheWriteTokens",
	"totalTokens",
	// Context budget
	"contextWindow",
	"effectiveMaxInputTokens",
	"budgetTriggerTokens",
	"usedBudgetFallback",
	// Content accounting (sizes and digests only)
	"requestBytes",
	"messageCount",
	"toolResultBytes",
	"toolResultDigest",
	"toolResultCharCount",
	"toolResultItemCount",
	// Classifications
	"status",
	"schemaValid",
	"schemaErrorKind",
	"compactionTrigger",
	"compactionReason",
	"truncated",
	"rewritten",
	"included",
	// ACT-CLINEMM-ROUND-C-HARNESS-02 — the tool-call OUTCOME
	// classification.
	//
	// These are the runtime's OWN authoritative outcome facts, and they
	// are what distinguishes a completed tool from one that was denied,
	// skipped, cancelled or failed. Without them the trace reported every
	// finished tool call as a successful completion.
	//
	// `outcome` is a short classification word, `executionInvoked` is a
	// boolean, and `skipReason` is a BOUNDED classification derived from
	// the runtime's diagnostic (never the diagnostic text itself).
	"outcome",
	"executionInvoked",
	"skipReason",
	// ACT-CLINEMM-ROUND-C-HARNESS-02 — the provider-ready and
	// compaction boundaries.
	//
	// These are counts, classifications and digests. The provider-ready
	// boundary reports the SIZE of the request that was actually sent and
	// the INCLUSION state of each tool result in it; the compaction
	// boundary reports the message counts before and after and the
	// continuity of the evidence references.
	"providerRequestBytes",
	"providerRequestDigest",
	"providerMessageCount",
	"toolResultIncludedCount",
	"toolResultShortenedCount",
	"toolResultOmittedCount",
	"compactionMessagesBefore",
	"compactionMessagesAfter",
	"compactionMessagesRemoved",
	"compactionEvidenceRefsBefore",
	"compactionEvidenceRefsAfter",
	"compactionEvidenceRefsRetained",
	"compactionEvidenceRefsDropped",
	"compactionEvidenceRefsReplaced",
	// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the compaction EXECUTION
	// discriminators.
	//
	// `compactionInitiated` is a boolean classification published by the
	// production compaction seam: it is true exactly when the seam
	// proceeds PAST its eligibility decision and begins real compaction
	// work. It lets a consumer tell a no-op eligibility CHECK from an
	// INITIATED compaction, so a span is bounded to the real execution
	// rather than to every check.
	//
	// `compactionOutcome` is the OBSERVED terminal outcome of an
	// initiated compaction ("completed" | "failed" | "cancelled"). It
	// lets a consumer close an initiated compaction truthfully instead of
	// inventing a successful completion or leaving the span open.
	//
	// Both are CLASSIFICATIONS — never content.
	"compactionInitiated",
	"compactionOutcome",
	// ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the first-token observation.
	//
	// `generatedTextLength` is the LENGTH of the first observed
	// generated output. It is a SIZE, never content: the text itself is
	// never recorded.
	"generatedTextLength",
];

/**
 * The ALLOWLIST as a set, for O(1) membership checks.
 */
const ALLOWLIST_SET: ReadonlySet<string> = new Set(LATENCY_METADATA_ALLOWLIST);

/**
 * The sanitized metadata type: every value is a primitive.
 */
export type LatencyMetadata = Readonly<
	Record<string, string | number | boolean | undefined>
>;

/**
 * One recorded boundary crossing.
 */
export interface LatencyBoundaryEvent {
	/** The correlation id of the turn this event belongs to. */
	readonly correlationId: string;
	/** The boundary that was crossed. */
	readonly boundary: LatencyBoundary;
	/** Whether the boundary was ENTERED or EXITED. */
	readonly phase: "start" | "end";
	/**
	 * The MONOTONIC offset, in milliseconds, from the tracer's origin.
	 *
	 * A monotonic clock is used deliberately: a wall clock can jump
	 * backwards (NTP, suspend), which would produce a NEGATIVE duration
	 * and silently corrupt every derived stage.
	 */
	readonly monotonicMs: number;
	/** The wall-clock time, for human correlation with logs. */
	readonly wallClockIso: string;
	/** The allowlisted metadata. */
	readonly metadata: LatencyMetadata;
	/** The duration of the span, when this is an `end` event. */
	readonly durationMs?: number;
	/** The status, when this is an `end` event. */
	readonly status?: LatencyStatus;
}

/**
 * A measured stage: the gap between two boundaries, and what it means.
 */
export interface LatencyStageMeasurement {
	readonly correlationId: string;
	readonly stage: LatencyStage;
	readonly from: LatencyBoundary;
	readonly to: LatencyBoundary;
	readonly durationMs: number;
	/**
	 * The independently measured duration of the `from` span, when that
	 * span owns a phase's work (request preparation or tool execution).
	 *
	 * This is the number that must be used for causal attribution. The
	 * `durationMs` above is the GAP between the two boundaries and does
	 * NOT include the `from` span's own duration; a phase that owns a
	 * span's work is emitted as its own stage (the executor's run time
	 * is the explicit `execution` stage), so the gap and the span stay
	 * separable and additive. For a tool, the `execution` stage carries
	 * the executor's own measured run time, while the adjacent
	 * `tool_execution → tool_result_delivered` stage carries only the
	 * delivery delay.
	 */
	readonly spanDurationMs?: number;
}

/**
 * A measurement that was NOT available, and why.
 *
 * An unavailable measurement is reported EXPLICITLY. It is never
 * represented as a zero-duration success, because a zero-duration span
 * reads as "this took no time" rather than "we do not know how long this
 * took".
 */
export interface LatencyUnavailableMeasurement {
	/** The boundary whose measurement is unavailable. */
	readonly boundary: LatencyBoundary;
	/** Why it is unavailable. */
	readonly reason: string;
}

/**
 * A trace-integrity failure.
 *
 * These are the defects in the TRACE ITSELF, not in the agent: a span
 * that was exited without being entered, an exit naming an id that was
 * never started, or a span left open when the trace was taken.
 */
export interface LatencyIntegrityFailure {
	/** The boundary the failure concerns. */
	readonly boundary: LatencyBoundary;
	/** What went wrong. */
	readonly reason: string;
}

/**
 * The completeness metadata of a bounded latency trace.
 *
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — BOUNDED RETENTION.
 *
 * The tracer retains a BOUNDED window of observations. A trace that has
 * dropped observations is therefore INCOMPLETE, and this block states that
 * explicitly: a partial trace is never presented as a complete one.
 *
 * The dropped observations are the OLDEST ones (a ring), so the retained
 * window always carries the MOST RECENT boundaries — which is what the
 * ~5 s floor investigation needs (the floor is visible in the most recent
 * tool-execution → tool-result-delivered gap).
 */
export interface LatencyTraceTruncation {
	/**
	 * True when at least one observation was dropped from the ring.
	 *
	 * When this is true the trace is INCOMPLETE: `events` does not contain
	 * every observation the tracer saw.
	 */
	readonly truncated: boolean;
	/**
	 * How many boundary events were dropped from the ring.
	 */
	readonly droppedEventCount: number;
	/**
	 * How many UNAVAILABLE measurements were dropped from the ring.
	 */
	readonly droppedUnavailableCount: number;
	/**
	 * How many trace-INTEGRITY failures were dropped from the ring.
	 */
	readonly droppedIntegrityFailureCount: number;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — how many OPEN spans were
	 * discarded because the open-span bound was reached.
	 *
	 * A discarded span is a span that was ENTERED but whose start could no
	 * longer be retained. Its exit can therefore never be measured: the
	 * tracer reports that as a trace-integrity failure instead of
	 * fabricating a duration.
	 */
	readonly droppedOpenSpanCount: number;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — how many open spans were
	 * ever opened.
	 */
	readonly totalOpenSpanCount: number;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — how many open spans are
	 * currently retained.
	 */
	readonly retainedOpenSpanCount: number;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the maximum number of
	 * open spans the tracer retains.
	 */
	readonly maxOpenSpans: number;
	/**
	 * Total boundary events ever accepted by the tracer.
	 */
	readonly totalEventCount: number;
	/**
	 * How many boundary events are currently retained.
	 */
	readonly retainedEventCount: number;
	/**
	 * Total unavailable measurements ever accepted by the tracer.
	 */
	readonly totalUnavailableCount: number;
	/**
	 * Total integrity failures ever accepted by the tracer.
	 */
	readonly totalIntegrityFailureCount: number;
	/**
	 * The maximum number of events the tracer retains.
	 */
	readonly maxEvents: number;
	/**
	 * The maximum number of unavailable measurements the tracer retains.
	 */
	readonly maxUnavailable: number;
	/**
	 * The maximum number of integrity failures the tracer retains.
	 */
	readonly maxIntegrityFailures: number;
}

/**
 * The complete trace of one turn.
 */
export interface LatencyTrace {
	readonly correlationId: string;
	readonly events: readonly LatencyBoundaryEvent[];
	readonly stages: readonly LatencyStageMeasurement[];
	/**
	 * The measurements that were NOT available.
	 *
	 * A boundary appears here when the seam that would measure it was
	 * never crossed — for example, a provider that does not report its
	 * first token. The absence of a measurement is therefore visible,
	 * rather than being indistinguishable from a measurement of zero.
	 */
	readonly unavailable: readonly LatencyUnavailableMeasurement[];
	/**
	 * The trace-integrity failures.
	 *
	 * A missing start, a missing end, or an unmatched span id shows up
	 * here. These are the conditions that would otherwise make a
	 * duration assertable when it is not.
	 */
	readonly integrityFailures: readonly LatencyIntegrityFailure[];
	/**
	 * The wall-clock duration of the trace.
	 *
	 * This is measured from the FIRST event to the LAST event, NOT by
	 * summing span durations. When operations overlap, the sum of the
	 * durations exceeds the wall clock, and the wall clock is the honest
	 * figure.
	 */
	readonly wallClockMs: number;
	/**
	 * Whether any two spans overlapped in time.
	 *
	 * When this is true, the per-span durations must NOT be summed to
	 * obtain a total.
	 */
	readonly overlapping: boolean;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — BOUNDED RETENTION.
	 *
	 * The completeness metadata of the bounded trace. A consumer MUST
	 * consult `truncation.truncated` before presenting the trace as
	 * exhaustive: when it is true, observations were dropped and the
	 * retained window is only the MOST RECENT slice of the capture.
	 */
	readonly truncation: LatencyTraceTruncation;
}

/**
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — the retention bounds.
 *
 * The tracer is a LONG-LIVED diagnostic: it is installed for a whole
 * session, and a session can run for hours. Without an explicit bound the
 * event array grows with EVERY observation, so a long-running dogfood
 * session would accumulate unbounded trace history — the exact opposite of
 * the bounded-capture requirement.
 *
 * The bounds are deliberately generous enough that a normal investigation
 * window (tens of tool calls, hundreds of boundaries) is retained WHOLE,
 * while a pathological session is bounded rather than unbounded.
 */
export const LATENCY_TRACE_MAX_EVENTS = 4_096;
export const LATENCY_TRACE_MAX_UNAVAILABLE = 256;
export const LATENCY_TRACE_MAX_INTEGRITY_FAILURES = 256;

/**
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the OPEN-SPAN bound.
 *
 * The event ring is not the only thing that grows. The tracer also keeps
 * the spans it has ENTERED but not yet EXITED — the "open spans" — so it
 * can measure a duration when the matching exit arrives.
 *
 * That map is INDEPENDENT of the event ring: a completed span is removed
 * from it, but an unmatched start stays in it FOREVER. A pathological (or
 * merely buggy) caller that enters without exiting therefore grows the map
 * without limit, even though the event ring stays bounded. The retained
 * open-span count is a MEMORY bound, so it needs its own bound.
 *
 * The bound is deliberately separate from {@link LATENCY_TRACE_MAX_EVENTS}:
 * the two caps protect different things (history vs. in-flight state), and
 * one cannot be derived from the other.
 *
 * A span that is discarded because of this bound is COUNTED as a dropped
 * span, and a later exit that would have closed it is reported as a
 * trace-integrity failure rather than being given a fabricated duration.
 */
export const LATENCY_TRACE_MAX_OPEN_SPANS = 1_024;

/**
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the TOMBSTONE bound.
 *
 * When an open span is discarded by the open-span bound, the tracer keeps
 * a small TOMBSTONE in its place: a record that "a start for this id was
 * discarded". The tombstone is what lets a LATE exit be recognised as
 * belonging to a discarded start instead of being matched to an unrelated
 * span.
 *
 * The tombstone registry is itself bounded, so a long session cannot grow
 * it without limit either. When a tombstone is evicted, the fact that the
 * boundary had discarded starts is still remembered as a COUNT, which is
 * enough to refuse to fabricate a duration for an unmatched id.
 */
export const LATENCY_TRACE_MAX_DISCARDED_SPAN_TOMBSTONES = 1_024;

/**
 * The boundary pairs that bound each stage.
 *
 * A stage is the gap between the END of one boundary and the START of the
 * next. The pair names what the gap MEANS:
 *
 * | From                        | To                        | Stage       | Meaning |
 * |-----------------------------|---------------------------|-------------|---------|
 * | `request_preparation`       | `request_prepared`        | `preparation` | the request was being prepared for the provider |
 * | `request_prepared`          | `provider_submitted`      | `queue`     | the request was built and held |
 * | `provider_submitted`        | `provider_first_token`    | `transport` | the provider had not answered |
 * | `provider_first_token`      | `provider_completed`      | `transport` | the provider was still generating |
 * | `provider_completed`        | `schema_validation`       | `queue`     | the agent had the turn and had not validated yet |
 * | `schema_validation`         | `tool_execution`          | `queue`     | validation passed and the tool had not started |
 * | `tool_execution`            | `tool_result_delivered`   | `delivery`  | the tool had finished; the result had not been delivered yet |
 * | `tool_result_delivered`     | `provider_ready`          | `delivery`  | the result existed but was not in the request |
 * | `provider_ready`            | `provider_submitted`      | `queue`     | the request was assembled and held |
 */
const STAGE_BOUNDARIES: Readonly<
	Record<
		string,
		{
			readonly from: LatencyBoundary;
			readonly to: LatencyBoundary;
			readonly stage: LatencyStage;
		}
	>
> = {
	"request_preparation>request_prepared": {
		from: "request_preparation",
		to: "request_prepared",
		stage: "preparation",
	},
	"request_prepared>provider_submitted": {
		from: "request_prepared",
		to: "provider_submitted",
		stage: "queue",
	},
	"provider_submitted>provider_first_token": {
		from: "provider_submitted",
		to: "provider_first_token",
		stage: "transport",
	},
	"provider_first_token>provider_completed": {
		from: "provider_first_token",
		to: "provider_completed",
		stage: "transport",
	},
	"provider_completed>schema_validation": {
		from: "provider_completed",
		to: "schema_validation",
		stage: "queue",
	},
	"schema_validation>tool_execution": {
		from: "schema_validation",
		to: "tool_execution",
		stage: "queue",
	},
	"tool_execution>tool_result_delivered": {
		from: "tool_execution",
		to: "tool_result_delivered",
		stage: "delivery",
	},
	"tool_result_delivered>provider_ready": {
		from: "tool_result_delivered",
		to: "provider_ready",
		stage: "delivery",
	},
	"provider_ready>provider_submitted": {
		from: "provider_ready",
		to: "provider_submitted",
		stage: "queue",
	},
};

/**
 * Classify the stage a gap between two boundaries represents.
 *
 * A pair that is not in the table is `unclassified` — the tracer never
 * guesses. The Round C investigation needed exactly this distinction:
 * the ~5 s command-result floor is only meaningful if the EXECUTION gap
 * is separated from the QUEUE, TRANSPORT and DELIVERY gaps around it.
 */
export function classifyLatencyStage(
	from: LatencyBoundary,
	to: LatencyBoundary,
): LatencyStage {
	return STAGE_BOUNDARIES[`${from}>${to}`]?.stage ?? "unclassified";
}

/**
 * Drop every metadata field that is not on the allowlist.
 *
 * This is the privacy boundary. A field that is not allowlisted is
 * DROPPED — it is never recorded, never logged, never returned. The
 * sanitizer also rejects non-primitive values (objects, arrays,
 * functions) so a caller cannot smuggle content through a
 * scalar-shaped field.
 */
export function sanitizeLatencyMetadata(
	metadata: Readonly<Record<string, unknown>> | undefined,
): LatencyMetadata {
	if (!metadata) {
		return {};
	}
	const sanitized: Record<string, string | number | boolean | undefined> = {};
	for (const key of Object.keys(metadata)) {
		if (!ALLOWLIST_SET.has(key)) {
			continue;
		}
		const value = metadata[key];
		if (
			typeof value === "string" ||
			typeof value === "boolean" ||
			typeof value === "number"
		) {
			sanitized[key] = key === "skipReason" ? classifySkipReason(value) : value;
		}
	}
	return sanitized;
}

/**
 * Classify a runtime skip diagnostic into a bounded vocabulary.
 *
 * The raw diagnostic is deliberately NOT persisted: it can contain a
 * path, a command fragment, a provider name, or host-authored text. The
 * trace only needs to distinguish the structural reason a call did not
 * execute, so the classification is intentionally coarse and stable.
 */
export type LatencySkipReasonClassification =
	| "schema_validation"
	| "normalization"
	| "approval_rejected"
	| "policy_disabled"
	| "provider_execution_disabled"
	| "runtime_hook_blocked"
	| "recovery_blocked"
	| "unknown_tool"
	| "other";

export function classifySkipReason(
	value: string | number | boolean,
): LatencySkipReasonClassification {
	const text = String(value).toLowerCase();
	if (
		text.includes("invalid input") ||
		text.includes("schema") ||
		text.includes("validation")
	) {
		return "schema_validation";
	}
	if (text.includes("normaliz")) {
		return "normalization";
	}
	if (
		text.includes("not approved") ||
		text.includes("approval") ||
		text.includes("denied") ||
		text.includes("rejected")
	) {
		return "approval_rejected";
	}
	if (text.includes("disabled by policy")) {
		return "policy_disabled";
	}
	if (text.includes("disabled for provider")) {
		return "provider_execution_disabled";
	}
	if (text.includes("runtime hook") || text.includes("blocked by")) {
		return "runtime_hook_blocked";
	}
	if (text.includes("recovery") || text.includes("repair budget")) {
		return "recovery_blocked";
	}
	if (text.includes("unknown tool")) {
		return "unknown_tool";
	}
	return "other";
}

/**
 * Compute a content DIGEST for a tool result.
 *
 * The digest lets two observations of the same result be correlated
 * (for example: the bytes the executor produced, and the bytes that
 * reached the provider-ready request) WITHOUT the content itself ever
 * being recorded or transmitted.
 *
 * The digest is a plain SHA-256 of the content's bytes, hex-encoded. It
 * is NOT a keyed hash: its purpose is change detection and correlation
 * within one capture, not concealment. A digest of a SHORT or
 * LOW-ENTROPY string could be brute-forced, so for small results the
 * caller should prefer the byte count alone.
 */
export function digestLatencyContent(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Read the `toolCallId` out of a metadata payload, if it has one.
 *
 * The id is the model's own identifier for a tool call, so it is the
 * natural key for matching a parallel call's exit to its entry. It is
 * read from the RAW payload rather than the sanitised one so that the
 * matching works even if the allowlist is ever narrowed — matching a
 * span must not depend on which metadata fields happen to be recorded.
 */
function readToolCallId(
	metadata: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
	const value = metadata?.toolCallId;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The clock the tracer reads.
 *
 * `performance.now()` is monotonic; `Date.now()` is not. The tracer reads
 * the monotonic clock for every duration and the wall clock only for the
 * human-readable stamp.
 */
export interface LatencyClock {
	/** A MONOTONIC millisecond reading. */
	monotonic(): number;
	/** The wall-clock time, as an ISO-8601 string. */
	wallClockIso(): string;
}

/**
 * The default clock.
 */
export const DEFAULT_LATENCY_CLOCK: LatencyClock = {
	monotonic: () =>
		typeof performance !== "undefined" && typeof performance.now === "function"
			? performance.now()
			: Date.now(),
	wallClockIso: () => new Date().toISOString(),
};

/**
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — the tracer's retention
 * options.
 *
 * The bounds are injectable so a test can prove the ring behaves, and so a
 * host that needs a tighter (or looser) window can set one explicitly.
 * Each bound is clamped to at least 1, so the tracer can never be
 * constructed with a zero-capacity ring.
 */
export interface LatencyTracerOptions {
	/** Max retained boundary events. Defaults to {@link LATENCY_TRACE_MAX_EVENTS}. */
	readonly maxEvents?: number;
	/** Max retained unavailable measurements. Defaults to {@link LATENCY_TRACE_MAX_UNAVAILABLE}. */
	readonly maxUnavailable?: number;
	/** Max retained integrity failures. Defaults to {@link LATENCY_TRACE_MAX_INTEGRITY_FAILURES}. */
	readonly maxIntegrityFailures?: number;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — max retained OPEN spans.
	 *
	 * Defaults to {@link LATENCY_TRACE_MAX_OPEN_SPANS}. This bound is
	 * INDEPENDENT of `maxEvents`: the event ring bounds the retained
	 * HISTORY, while this bounds the retained IN-FLIGHT state.
	 */
	readonly maxOpenSpans?: number;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — max retained TOMBSTONES
	 * for discarded open spans.
	 *
	 * Defaults to {@link LATENCY_TRACE_MAX_DISCARDED_SPAN_TOMBSTONES}.
	 */
	readonly maxDiscardedSpanTombstones?: number;
}

/**
 * A boundary tracer for one turn.
 *
 * The tracer is READ-ONLY observation: it never changes a value the
 * runtime uses and never gates an operation. Every method is
 * failure-isolated — a throw inside the tracer cannot affect a model
 * call, a tool execution, or a lifecycle commit.
 */
export class LatencyTracer {
	private readonly events: LatencyBoundaryEvent[] = [];
	/**
	 * The spans that were ENTERED but not yet EXITED, grouped by boundary.
	 *
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — this map is BOUNDED.
	 *
	 * It used to be unbounded: a span stayed here until its exit arrived,
	 * so a caller that entered without exiting grew the map without limit.
	 * Each boundary's array is a STACK (last-in-first-out), and the
	 * `seq` on each span is the global order in which the span was
	 * opened — it is what lets the tracer discard the globally OLDEST
	 * span when the bound is reached.
	 */
	private readonly openSpans = new Map<
		LatencyBoundary,
		Array<{
			readonly boundary: LatencyBoundary;
			readonly startedAt: number;
			readonly toolCallId?: string;
			readonly seq: number;
		}>
	>();
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the GLOBAL FIFO of open
	 * spans, in the order they were opened.
	 *
	 * This is what makes the open-span bound evict the OLDEST span rather
	 * than an arbitrary one. Because the eviction order matches the
	 * opening order, the spans that remain on a boundary are exactly the
	 * NEWEST ones, so the last-in-first-out matching between a start and
	 * an exit keeps working for every span that was NOT discarded.
	 */
	private readonly openSpanOrder: Array<{
		readonly boundary: LatencyBoundary;
		readonly seq: number;
	}> = [];
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the TOMBSTONES of spans
	 * that were discarded by the open-span bound.
	 *
	 * A tombstone records that "a start for this id was discarded". It is
	 * what lets a LATE exit be recognised as belonging to a discarded
	 * start instead of being matched to an UNRELATED span (which would
	 * fabricate a duration).
	 *
	 * The registry is itself bounded, and each boundary remembers how many
	 * of its starts were discarded — so even after a tombstone has been
	 * evicted, the tracer still knows that it must not guess.
	 */
	private readonly discardedSpanTombstones: Array<{
		readonly boundary: LatencyBoundary;
		readonly toolCallId?: string;
	}> = [];
	/** How many starts were discarded on each boundary. */
	private readonly discardedSpanCounts = new Map<LatencyBoundary, number>();
	/** The global order counter for open spans. */
	private nextOpenSpanSeq = 0;
	private readonly origin: number;
	/** The boundaries that were opened at least once. */
	private readonly openedBoundaries = new Set<LatencyBoundary>();
	/** The trace-integrity failures observed so far. */
	private readonly integrityFailures: LatencyIntegrityFailure[] = [];
	/** The measurements that were explicitly marked unavailable. */
	private readonly unavailableMeasurements: LatencyUnavailableMeasurement[] =
		[];

	// -------------------------------------------------------------------------
	// ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — BOUNDED RETENTION.
	//
	// The tracer is installed for a whole SESSION, so its retention must be
	// bounded: an unbounded event array would grow with every observation
	// for the lifetime of the extension host.
	//
	// The retention is a RING: the OLDEST observation is dropped when the
	// bound is reached, so the retained window always carries the MOST
	// RECENT boundaries. That is the window the ~5 s floor investigation
	// needs — the floor shows up in the most recent
	// `tool_execution → tool_result_delivered` gap.
	//
	// Every drop is COUNTED. The counts are reported through
	// {@link LatencyTraceTruncation} so an incomplete trace is never
	// presented as a complete one, and NO continuity is invented across
	// discarded observations.
	// -------------------------------------------------------------------------

	/** The maximum number of retained boundary events. */
	private readonly maxEvents: number;
	/** The maximum number of retained unavailable measurements. */
	private readonly maxUnavailable: number;
	/** The maximum number of retained integrity failures. */
	private readonly maxIntegrityFailures: number;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the maximum number of
	 * OPEN spans the tracer retains.
	 */
	private readonly maxOpenSpans: number;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the maximum number of
	 * TOMBSTONES the tracer retains.
	 */
	private readonly maxDiscardedSpanTombstones: number;
	/** How many boundary events were dropped from the ring. */
	private droppedEventCount = 0;
	/** How many unavailable measurements were dropped from the ring. */
	private droppedUnavailableCount = 0;
	/** How many integrity failures were dropped from the ring. */
	private droppedIntegrityFailureCount = 0;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — how many open spans were
	 * discarded by the open-span bound.
	 */
	private droppedOpenSpanCount = 0;
	/** How many open spans were ever opened. */
	private totalOpenSpanCount = 0;
	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — how many integrity
	 * failures were dropped when the EXPORT was bounded.
	 *
	 * This counts the failures the tracer knows about but does NOT include
	 * in the exported list — including the ones synthesised from
	 * still-open spans.
	 */
	private droppedExportedIntegrityFailureCount = 0;
	/** How many boundary events were ever accepted. */
	private totalEventCount = 0;
	/** How many unavailable measurements were ever accepted. */
	private totalUnavailableCount = 0;
	/** How many integrity failures were ever accepted. */
	private totalIntegrityFailureCount = 0;

	constructor(
		readonly correlationId: string,
		private readonly clock: LatencyClock = DEFAULT_LATENCY_CLOCK,
		options: LatencyTracerOptions = {},
	) {
		this.maxEvents = Math.max(1, options.maxEvents ?? LATENCY_TRACE_MAX_EVENTS);
		this.maxUnavailable = Math.max(
			1,
			options.maxUnavailable ?? LATENCY_TRACE_MAX_UNAVAILABLE,
		);
		this.maxIntegrityFailures = Math.max(
			1,
			options.maxIntegrityFailures ?? LATENCY_TRACE_MAX_INTEGRITY_FAILURES,
		);
		this.maxOpenSpans = Math.max(
			1,
			options.maxOpenSpans ?? LATENCY_TRACE_MAX_OPEN_SPANS,
		);
		this.maxDiscardedSpanTombstones = Math.max(
			1,
			options.maxDiscardedSpanTombstones ??
				LATENCY_TRACE_MAX_DISCARDED_SPAN_TOMBSTONES,
		);
		// The origin is read defensively: a broken clock must not prevent
		// the tracer from being CONSTRUCTED, because the tracer is created
		// on the runtime's hot path.
		try {
			this.origin = clock.monotonic();
		} catch {
			this.origin = 0;
		}
	}

	/**
	 * Whether a tracer is present.
	 *
	 * A disabled tracer records nothing and pays only this check.
	 */
	static isEnabled(tracer: LatencyTracer | undefined): boolean {
		return tracer !== undefined;
	}

	/**
	 * Record the ENTRY into a boundary.
	 */
	enter(
		boundary: LatencyBoundary,
		metadata?: Readonly<Record<string, unknown>>,
	): void {
		try {
			const now = this.clock.monotonic() - this.origin;
			this.openedBoundaries.add(boundary);
			this.appendEvent({
				correlationId: this.correlationId,
				boundary,
				phase: "start",
				monotonicMs: now,
				wallClockIso: this.clock.wallClockIso(),
				metadata: sanitizeLatencyMetadata(metadata),
			});
			// A boundary may be entered more than once (parallel tool
			// calls). Each entry pushes onto the boundary's own stack, so
			// the matching exit pops exactly the span it closes.
			//
			// The `toolCallId` is carried on the span so that an exit can
			// be matched to the RIGHT entry even when parallel calls
			// finish out of order — see `takeSpan`.
			//
			// ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the `seq` is the
			// GLOBAL order in which this span was opened. It is what lets
			// the open-span bound discard the OLDEST span rather than an
			// arbitrary one.
			const stack = this.openSpans.get(boundary);
			const span = {
				boundary,
				startedAt: now,
				toolCallId: readToolCallId(metadata),
				seq: this.nextOpenSpanSeq,
			};
			this.nextOpenSpanSeq += 1;
			this.totalOpenSpanCount += 1;
			if (stack) {
				stack.push(span);
			} else {
				this.openSpans.set(boundary, [span]);
			}
			this.openSpanOrder.push({ boundary, seq: span.seq });
			// ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — enforce the
			// OPEN-SPAN bound. The event ring is bounded independently;
			// this bounds the IN-FLIGHT state.
			this.enforceOpenSpanBound();
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — discard the OLDEST open
	 * spans until the open-span bound is satisfied.
	 *
	 * The OLDEST span is discarded because the retained spans must keep
	 * their last-in-first-out relationship: on a given boundary the
	 * discarded spans are then exactly the ones that were opened FIRST,
	 * so every RETAINED span still receives its own exit.
	 *
	 * A discarded span leaves a TOMBSTONE behind, so a late exit is
	 * recognised as belonging to a discarded start instead of being
	 * matched to an unrelated span.
	 */
	private enforceOpenSpanBound(): void {
		while (this.openSpanOrder.length > this.maxOpenSpans) {
			const oldest = this.openSpanOrder.shift();
			if (!oldest) {
				break;
			}
			const stack = this.openSpans.get(oldest.boundary);
			if (!stack) {
				continue;
			}
			const index = stack.findIndex((span) => span.seq === oldest.seq);
			if (index === -1) {
				// Already closed by its own exit.
				continue;
			}
			const [discarded] = stack.splice(index, 1);
			if (!discarded) {
				continue;
			}
			if (stack.length === 0) {
				this.openSpans.delete(oldest.boundary);
			}
			this.droppedOpenSpanCount += 1;
			this.discardedSpanCounts.set(
				oldest.boundary,
				(this.discardedSpanCounts.get(oldest.boundary) ?? 0) + 1,
			);
			this.discardedSpanTombstones.push({
				boundary: discarded.boundary,
				toolCallId: discarded.toolCallId,
			});
			while (
				this.discardedSpanTombstones.length > this.maxDiscardedSpanTombstones
			) {
				this.discardedSpanTombstones.shift();
			}
		}
	}

	/**
	 * Record the EXIT from a boundary.
	 *
	 * The duration is measured against the matching `enter`, when there is
	 * one. A boundary that is exited without a matching entry still
	 * records the event, with no duration, so a missing entry is visible
	 * rather than silent.
	 *
	 * ## Matching a parallel exit to the RIGHT entry
	 *
	 * Parallel tool calls do NOT necessarily finish in the order they
	 * started. A plain last-in-first-out stack would then attribute one
	 * call's duration to another. When the exit carries a `toolCallId`
	 * that matches an open span, THAT span is the one closed; otherwise
	 * the behaviour falls back to last-in-first-out, which is correct for
	 * every boundary that is entered at most once.
	 */
	/**
	 * Record the EXIT from a boundary.
	 *
	 * The duration is measured against the matching `enter`, when there is
	 * one. A boundary that is exited without a matching entry still
	 * records the event, with no duration, so a missing entry is visible
	 * rather than silent.
	 *
	 * ## Matching a parallel exit to the RIGHT entry
	 *
	 * Parallel tool calls do NOT necessarily finish in the order they
	 * started. A plain last-in-first-out stack would then attribute one
	 * call's duration to another. When the exit carries a `toolCallId`
	 * that matches an open span, THAT span is the one closed; otherwise
	 * the behaviour falls back to last-in-first-out, which is correct for
	 * every boundary that is entered at most once.
	 */
	exit(
		boundary: LatencyBoundary,
		options: {
			readonly metadata?: Readonly<Record<string, unknown>>;
			readonly status?: LatencyStatus;
		} = {},
	): void {
		try {
			const now = this.clock.monotonic() - this.origin;
			const toolCallId = readToolCallId(options.metadata);
			const stack = this.openSpans.get(boundary);
			// ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the exit is
			// matched against the RETAINED spans, the TOMBSTONES of
			// discarded spans, and only then the never-entered case.
			//
			// The order matters: a start that was DISCARDED by the
			// open-span bound must never fall through to the
			// last-in-first-out fallback, because that would close an
			// UNRELATED span and fabricate its duration.
			const retainedMatch = this.findRetainedSpan(boundary, toolCallId);
			const discardedMatch = this.findDiscardedSpan(boundary, toolCallId);
			if (retainedMatch) {
				// The exit closes a span that is still retained: its
				// duration is measured against that span's own start.
				this.removeRetainedSpan(retainedMatch);
				this.appendEvent({
					correlationId: this.correlationId,
					boundary,
					phase: "end",
					monotonicMs: now,
					wallClockIso: this.clock.wallClockIso(),
					metadata: sanitizeLatencyMetadata(options.metadata),
					durationMs: now - retainedMatch.startedAt,
					status: options.status,
				});
				return;
			}
			if (discardedMatch) {
				// ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the start of
				// this span was DISCARDED by the open-span bound. Its
				// duration is not assertable, so NO duration is recorded
				// and NO unrelated span is closed.
				this.consumeDiscardedSpan(discardedMatch);
				this.appendIntegrityFailure({
					boundary,
					reason: discardedMatch.toolCallId
						? `start discarded by the open-span bound for tool call ${discardedMatch.toolCallId}`
						: "start discarded by the open-span bound",
				});
				this.appendEvent({
					correlationId: this.correlationId,
					boundary,
					phase: "end",
					monotonicMs: now,
					wallClockIso: this.clock.wallClockIso(),
					metadata: sanitizeLatencyMetadata(options.metadata),
					durationMs: undefined,
					status: options.status,
				});
				return;
			}
			// No retained span and no tombstone matches this exit.
			//
			// If the boundary HAS discarded starts, the exit may belong to
			// one of them whose tombstone has already been evicted. The
			// tracer must not guess: no duration is recorded and no
			// unrelated span is closed.
			const discardedCount = this.discardedSpanCounts.get(boundary) ?? 0;
			if (discardedCount > 0) {
				this.appendIntegrityFailure({
					boundary,
					reason: toolCallId
						? `start for tool call ${toolCallId} was discarded by the open-span bound`
						: "start was discarded by the open-span bound",
				});
				this.appendEvent({
					correlationId: this.correlationId,
					boundary,
					phase: "end",
					monotonicMs: now,
					wallClockIso: this.clock.wallClockIso(),
					metadata: sanitizeLatencyMetadata(options.metadata),
					durationMs: undefined,
					status: options.status,
				});
				return;
			}
			// A boundary exited without a matching entry is a trace-
			// integrity failure: the duration is not assertable.
			if (!stack || stack.length === 0) {
				this.appendIntegrityFailure({
					boundary,
					reason: "exit without a matching start",
				});
			} else if (toolCallId !== undefined) {
				// An exit naming a tool call that was never entered.
				// This id was NEVER a start on this boundary, so the
				// last-in-first-out fallback is safe: there is no
				// discarded start it could belong to.
				this.appendIntegrityFailure({
					boundary,
					reason: `unmatched span id ${toolCallId}`,
				});
			}
			const span = this.takeSpan(boundary, toolCallId);
			this.appendEvent({
				correlationId: this.correlationId,
				boundary,
				phase: "end",
				monotonicMs: now,
				wallClockIso: this.clock.wallClockIso(),
				metadata: sanitizeLatencyMetadata(options.metadata),
				durationMs: span ? now - span.startedAt : undefined,
				status: options.status,
			});
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * Record that a boundary's measurement will NEVER be available.
	 *
	 * The span is closed WITHOUT a duration, so no fabricated number
	 * enters the trace, and the boundary is recorded as unavailable with
	 * the reason. This is how a provider that never reports its first
	 * token is represented.
	 */
	markUnavailable(
		boundary: LatencyBoundary,
		reason: string,
		options: {
			readonly metadata?: Readonly<Record<string, unknown>>;
			readonly status?: LatencyStatus;
		} = {},
	): void {
		try {
			const now = this.clock.monotonic() - this.origin;
			const span = this.takeSpan(boundary, undefined);
			this.appendEvent({
				correlationId: this.correlationId,
				boundary,
				phase: "end",
				monotonicMs: now,
				wallClockIso: this.clock.wallClockIso(),
				metadata: sanitizeLatencyMetadata(options.metadata),
				// No duration: the measurement is unavailable, not zero.
				durationMs: undefined,
				status: options.status,
			});
			this.appendUnavailable({ boundary, reason });
			if (span === undefined) {
				// ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — distinguish the
				// case where the boundary had DISCARDED starts from the case
				// where it never had a start at all. Neither produces a
				// duration, but they are different defects.
				const discardedCount = this.discardedSpanCounts.get(boundary) ?? 0;
				this.appendIntegrityFailure({
					boundary,
					reason:
						discardedCount > 0
							? "marked unavailable after its start was discarded by the open-span bound"
							: "marked unavailable without a matching start",
				});
			}
		} catch {
			// Failure isolation.
		}
	}

	/**
	 * Whether a boundary has an open span.
	 *
	 * A host uses this to decide whether a boundary still needs closing,
	 * or whether its event already closed it.
	 */
	isOpen(boundary: LatencyBoundary): boolean {
		return (this.openSpans.get(boundary)?.length ?? 0) > 0;
	}

	/**
	 * Take the open span an exit closes.
	 *
	 * When the exit names a `toolCallId` and an open span carries the
	 * same id, that span is closed. The stack order is otherwise
	 * preserved, so removing a span from the middle does not disturb the
	 * relative order of the others.
	 */
	private takeSpan(
		boundary: LatencyBoundary,
		toolCallId: string | undefined,
	):
		| { readonly boundary: LatencyBoundary; readonly startedAt: number }
		| undefined {
		const stack = this.openSpans.get(boundary);
		if (!stack || stack.length === 0) {
			return undefined;
		}
		if (toolCallId !== undefined) {
			const index = stack.findIndex((span) => span.toolCallId === toolCallId);
			if (index !== -1) {
				const [span] = stack.splice(index, 1);
				this.forgetOpenSpanOrder(boundary, span?.seq);
				return span;
			}
		}
		const span = stack.pop();
		this.forgetOpenSpanOrder(boundary, span?.seq);
		return span;
	}

	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — find the RETAINED span an
	 * exit closes.
	 *
	 * When the exit names a `toolCallId`, the span carrying that id is the
	 * one closed — even when the calls finish out of order. When the exit
	 * names no id, the most recently opened retained span is the one closed,
	 * which is the last-in-first-out rule that is correct for a boundary
	 * that is entered at most once.
	 *
	 * The search is NOT allowed to fall back when the boundary has
	 * discarded starts: see {@link findDiscardedSpan}.
	 */
	private findRetainedSpan(
		boundary: LatencyBoundary,
		toolCallId: string | undefined,
	):
		| {
				readonly boundary: LatencyBoundary;
				readonly startedAt: number;
				readonly toolCallId?: string;
				readonly seq: number;
		  }
		| undefined {
		const stack = this.openSpans.get(boundary);
		if (!stack || stack.length === 0) {
			return undefined;
		}
		if (toolCallId !== undefined) {
			return stack.find((span) => span.toolCallId === toolCallId);
		}
		return stack[stack.length - 1];
	}

	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — remove a retained span
	 * that an exit closed.
	 */
	private removeRetainedSpan(span: {
		readonly boundary: LatencyBoundary;
		readonly seq: number;
	}): void {
		const stack = this.openSpans.get(span.boundary);
		if (!stack) {
			return;
		}
		const index = stack.findIndex((candidate) => candidate.seq === span.seq);
		if (index !== -1) {
			stack.splice(index, 1);
		}
		if (stack.length === 0) {
			this.openSpans.delete(span.boundary);
		}
		this.forgetOpenSpanOrder(span.boundary, span.seq);
	}

	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — find the TOMBSTONE of a
	 * span whose start was discarded by the open-span bound.
	 *
	 * A tombstone is matched by `toolCallId` when the exit names one. When
	 * the exit names no id, the OLDEST tombstone for the boundary is the
	 * match: the discarded spans on a boundary are exactly the ones that
	 * were opened FIRST, and their exits arrive last.
	 */
	private findDiscardedSpan(
		boundary: LatencyBoundary,
		toolCallId: string | undefined,
	):
		| {
				readonly boundary: LatencyBoundary;
				readonly toolCallId?: string;
		  }
		| undefined {
		if (toolCallId !== undefined) {
			return this.discardedSpanTombstones.find(
				(tombstone) =>
					tombstone.boundary === boundary &&
					tombstone.toolCallId === toolCallId,
			);
		}
		return this.discardedSpanTombstones.find(
			(tombstone) =>
				tombstone.boundary === boundary && tombstone.toolCallId === undefined,
		);
	}

	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — consume a tombstone once
	 * its late exit has been reported.
	 */
	private consumeDiscardedSpan(tombstone: {
		readonly boundary: LatencyBoundary;
		readonly toolCallId?: string;
	}): void {
		const index = this.discardedSpanTombstones.findIndex(
			(candidate) =>
				candidate.boundary === tombstone.boundary &&
				candidate.toolCallId === tombstone.toolCallId,
		);
		if (index === -1) {
			return;
		}
		this.discardedSpanTombstones.splice(index, 1);
		const remaining = this.discardedSpanCounts.get(tombstone.boundary) ?? 0;
		if (remaining <= 1) {
			this.discardedSpanCounts.delete(tombstone.boundary);
		} else {
			this.discardedSpanCounts.set(tombstone.boundary, remaining - 1);
		}
	}

	/**
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — drop a closed span from
	 * the global open-span order.
	 *
	 * The order queue is what makes the open-span bound discard the OLDEST
	 * span, so a span that has been closed must leave the queue as well —
	 * otherwise the bound would count it as retained.
	 */
	private forgetOpenSpanOrder(
		boundary: LatencyBoundary,
		seq: number | undefined,
	): void {
		if (seq === undefined) {
			return;
		}
		const index = this.openSpanOrder.findIndex(
			(entry) => entry.boundary === boundary && entry.seq === seq,
		);
		if (index !== -1) {
			this.openSpanOrder.splice(index, 1);
		}
	}

	// -------------------------------------------------------------------------
	// ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — the bounded ring.
	//
	// Each append pushes onto its ring and evicts the OLDEST entry when the
	// bound is reached. Every eviction is COUNTED, so the tracer can always
	// state how much of the capture it no longer holds.
	// -------------------------------------------------------------------------

	/**
	 * Append a boundary event, evicting the oldest when the ring is full.
	 */
	private appendEvent(event: LatencyBoundaryEvent): void {
		this.totalEventCount += 1;
		this.events.push(event);
		while (this.events.length > this.maxEvents) {
			const evicted = this.events.shift();
			if (!evicted) {
				break;
			}
			this.droppedEventCount += 1;
		}
	}

	/**
	 * Append an unavailable measurement, evicting the oldest when the ring
	 * is full.
	 */
	private appendUnavailable(measurement: LatencyUnavailableMeasurement): void {
		this.totalUnavailableCount += 1;
		this.unavailableMeasurements.push(measurement);
		while (this.unavailableMeasurements.length > this.maxUnavailable) {
			const evicted = this.unavailableMeasurements.shift();
			if (!evicted) {
				break;
			}
			this.droppedUnavailableCount += 1;
		}
	}

	/**
	 * Append a trace-integrity failure, evicting the oldest when the ring
	 * is full.
	 */
	private appendIntegrityFailure(failure: LatencyIntegrityFailure): void {
		this.totalIntegrityFailureCount += 1;
		this.integrityFailures.push(failure);
		while (this.integrityFailures.length > this.maxIntegrityFailures) {
			const evicted = this.integrityFailures.shift();
			if (!evicted) {
				break;
			}
			this.droppedIntegrityFailureCount += 1;
		}
	}

	/**
	 * The completeness metadata of the bounded capture.
	 *
	 * `truncated` is true when ANY observation was dropped. A consumer MUST
	 * check it before presenting the trace as exhaustive.
	 */
	getTruncation(): LatencyTraceTruncation {
		return {
			truncated:
				this.droppedEventCount > 0 ||
				this.droppedUnavailableCount > 0 ||
				this.droppedIntegrityFailureCount > 0 ||
				this.droppedOpenSpanCount > 0 ||
				this.droppedExportedIntegrityFailureCount > 0,
			droppedEventCount: this.droppedEventCount,
			droppedUnavailableCount: this.droppedUnavailableCount,
			droppedIntegrityFailureCount:
				this.droppedIntegrityFailureCount +
				this.droppedExportedIntegrityFailureCount,
			droppedOpenSpanCount: this.droppedOpenSpanCount,
			totalOpenSpanCount: this.totalOpenSpanCount,
			retainedOpenSpanCount: this.openSpanOrder.length,
			maxOpenSpans: this.maxOpenSpans,
			totalEventCount: this.totalEventCount,
			retainedEventCount: this.events.length,
			totalUnavailableCount: this.totalUnavailableCount,
			totalIntegrityFailureCount: this.totalIntegrityFailureCount,
			maxEvents: this.maxEvents,
			maxUnavailable: this.maxUnavailable,
			maxIntegrityFailures: this.maxIntegrityFailures,
		};
	}

	/**
	 * The recorded events, in order.
	 */
	getEvents(): readonly LatencyBoundaryEvent[] {
		return [...this.events];
	}

	/**
	 * The measured stages.
	 *
	 * A stage is the time attributed to ONE named phase of the turn. It is
	 * measured as the interval between the moment the PREVIOUS phase's
	 * work finished and the moment the NEXT phase's work began — i.e. the
	 * gap between an `end` event and the next `start` event.
	 *
	 * The gap does NOT include the previous span's own duration: that
	 * duration is reported SEPARATELY as `spanDurationMs`, and a phase
	 * that OWNS its span's work is emitted as its own stage (see the
	 * `execution` stage below). The interval AFTER a span ends belongs to
	 * the gap between that span and the next one; it is never silently
	 * charged to the phase named by the span. In particular, a tool that
	 * ran for 10 ms and whose result was delivered 5 s later reports 10 ms
	 * of execution and a separate 5 s delivery delay.
	 */
	getStages(): readonly LatencyStageMeasurement[] {
		const stages: LatencyStageMeasurement[] = [];
		for (let index = 0; index < this.events.length - 1; index++) {
			const current = this.events[index] as LatencyBoundaryEvent;
			const next = this.events[index + 1] as LatencyBoundaryEvent;
			if (current.phase !== "end" || next.phase !== "start") {
				continue;
			}
			const gap = next.monotonicMs - current.monotonicMs;
			const stage = classifyLatencyStage(current.boundary, next.boundary);
			// The independently measured span duration is retained for every
			// boundary that owns a span's work. The PHASE total measures the
			// gap between boundaries only, so a provider round trip is never
			// folded into the adjacent queue interval and a post-execution
			// delay is never folded into execution.
			const spanDuration = current.durationMs ?? 0;
			const totalDuration = gap;
			stages.push({
				correlationId: this.correlationId,
				stage,
				from: current.boundary,
				to: next.boundary,
				durationMs: totalDuration,
				...(spanDuration !== undefined ? { spanDurationMs: spanDuration } : {}),
			});
		}
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02 — the EXECUTOR's own
		// run time is an EXECUTION stage in its own right.
		//
		// The inter-boundary gap that FOLLOWS the execution span is a
		// post-execution DELIVERY delay (see
		// `tool_execution>tool_result_delivered`). Reporting the executor's
		// measured run time only as the `spanDurationMs` of that delivery
		// stage made it invisible to a consumer that aggregates stage
		// durations — the Round C ~5 s floor then had nowhere to go except
		// into `execution`.
		//
		// Emitting an explicit `execution` stage keeps the two facts
		// separable AND additive:
		//
		//   execution  = the executor's measured run time (10 ms)
		//   delivery   = the post-execution delay (5,000 ms)
		//
		// The execution stage's `durationMs` is the executor's own measured
		// run time, so a stage-level aggregation attributes exactly the
		// measured execution cost to execution and exactly the measured
		// delay to delivery.
		for (const event of this.events) {
			if (event.phase !== "end" || event.boundary !== "tool_execution") {
				continue;
			}
			stages.push({
				correlationId: this.correlationId,
				stage: "execution",
				from: "tool_execution",
				to: "tool_execution",
				durationMs: event.durationMs ?? 0,
				spanDurationMs: event.durationMs ?? 0,
			});
		}
		return stages;
	}

	/**
	 * The complete trace.
	 *
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the integrity-failure
	 * export is computed BEFORE the truncation block, so the block reports
	 * exactly how many failures the export withheld.
	 */
	getTrace(): LatencyTrace {
		const integrityFailures = this.getIntegrityFailures();
		return {
			correlationId: this.correlationId,
			events: this.getEvents(),
			stages: this.getStages(),
			unavailable: this.getUnavailable(),
			integrityFailures,
			wallClockMs: this.getWallClockMs(),
			overlapping: this.hasOverlap(),
			truncation: this.getTruncation(),
		};
	}

	/**
	 * The measurements that were NOT available.
	 *
	 * A boundary is unavailable when it was never opened. The reason
	 * distinguishes the cases that matter:
	 *
	 *  - `not-observed`: the seam that would have measured it was never
	 *    crossed (a provider that does not report its first token);
	 *  - `left-open`: the span was entered and never closed, which is a
	 *    trace-integrity failure rather than an absent measurement.
	 */
	getUnavailable(): readonly LatencyUnavailableMeasurement[] {
		const unavailable: LatencyUnavailableMeasurement[] = [
			...this.unavailableMeasurements,
		];
		const reported = new Set(unavailable.map((item) => item.boundary));
		for (const boundary of ALL_LATENCY_BOUNDARIES) {
			// A boundary that was opened AND closed is available. A
			// boundary that was explicitly marked unavailable has its own
			// reason. Anything else was never observed.
			if (reported.has(boundary)) {
				continue;
			}
			if (this.openedBoundaries.has(boundary)) {
				continue;
			}
			unavailable.push({
				boundary,
				reason: "not-observed",
			});
		}
		return unavailable;
	}

	/**
	 * The trace-integrity failures.
	 *
	 * A failure is recorded when:
	 *
	 *  - a boundary is exited without a matching entry;
	 *  - an exit names a tool call id that was never entered;
	 *  - a span is still OPEN when the trace is taken.
	 *
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR02 — the EXPORT is BOUNDED.
	 *
	 * The failures that are synthesised from the still-open spans are not
	 * a fixed number: there is one per open span, and the open-span count
	 * is itself bounded but still large. Without an export bound a trace
	 * dump could therefore carry far more integrity failures than the
	 * declared retention bound allows.
	 *
	 * The exported list is therefore capped at `maxIntegrityFailures`. The
	 * failures that are recorded explicitly (the ones the tracer observed
	 * as they happened) are kept first, and the synthesised "span left
	 * open" failures fill the remainder. Every failure that does NOT make
	 * it into the export is COUNTED, so the truncation metadata states
	 * exactly how much of the failure list was withheld.
	 */
	getIntegrityFailures(): readonly LatencyIntegrityFailure[] {
		const failures: LatencyIntegrityFailure[] = [...this.integrityFailures];
		// The recorded failures are already bounded by the ring, but the
		// synthesised ones are not. Cap the TOTAL.
		for (const [boundary, stack] of this.openSpans) {
			for (const span of stack) {
				failures.push({
					boundary,
					reason: span.toolCallId
						? `span left open for tool call ${span.toolCallId}`
						: "span left open",
				});
			}
		}
		if (failures.length <= this.maxIntegrityFailures) {
			this.droppedExportedIntegrityFailureCount = 0;
			return failures;
		}
		const exported = failures.slice(0, this.maxIntegrityFailures);
		this.droppedExportedIntegrityFailureCount =
			failures.length - this.maxIntegrityFailures;
		return exported;
	}

	/**
	 * The wall-clock duration of the trace.
	 *
	 * Measured from the first event to the last, NOT by summing span
	 * durations. When operations overlap the sum exceeds the wall clock,
	 * and the wall clock is the honest figure.
	 */
	getWallClockMs(): number {
		if (this.events.length === 0) {
			return 0;
		}
		const first = this.events[0] as LatencyBoundaryEvent;
		const last = this.events[this.events.length - 1] as LatencyBoundaryEvent;
		return last.monotonicMs - first.monotonicMs;
	}

	/**
	 * Whether any two spans overlapped in time.
	 *
	 * Two spans overlap when one starts before the other ends. This is
	 * what makes the per-span durations non-additive.
	 */
	hasOverlap(): boolean {
		// The span intervals, reconstructed from the events.
		const intervals: Array<{ start: number; end: number }> = [];
		const open = new Map<LatencyBoundary, number[]>();
		for (const event of this.events) {
			if (event.phase === "start") {
				const stack = open.get(event.boundary) ?? [];
				stack.push(event.monotonicMs);
				open.set(event.boundary, stack);
				continue;
			}
			const stack = open.get(event.boundary);
			const startedAt = stack?.pop();
			if (startedAt !== undefined) {
				intervals.push({ start: startedAt, end: event.monotonicMs });
			}
		}
		intervals.sort((a, b) => a.start - b.start);
		let latestEnd = Number.NEGATIVE_INFINITY;
		for (const interval of intervals) {
			if (interval.start < latestEnd) {
				return true;
			}
			if (interval.end > latestEnd) {
				latestEnd = interval.end;
			}
		}
		return false;
	}
}
