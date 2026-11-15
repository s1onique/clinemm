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
 * - `execution`  — the tool was actually running;
 * - `delivery`   — the result existed but had not reached the transcript.
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
	// boolean, and `skipReason` is a diagnostic string owned by the
	// runtime. None of them carries command arguments, output or content.
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
}

/**
 * The boundary pairs that bound each stage.
 *
 * A stage is the gap between the END of one boundary and the START of the
 * next. The pair names what the gap MEANS:
 *
 * | From                        | To                        | Stage       | Meaning |
 * |-----------------------------|---------------------------|-------------|---------|
 * | `request_prepared`          | `provider_submitted`      | `queue`     | the request was built and held |
 * | `provider_submitted`        | `provider_first_token`    | `transport` | the provider had not answered |
 * | `provider_first_token`      | `provider_completed`      | `transport` | the provider was still generating |
 * | `provider_completed`        | `schema_validation`       | `queue`     | the agent had the turn and had not validated yet |
 * | `schema_validation`         | `tool_execution`          | `queue`     | validation passed and the tool had not started |
 * | `tool_execution`            | `tool_result_delivered`   | `execution` | THE TOOL WAS RUNNING |
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
		stage: "execution",
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
			sanitized[key] = value;
		}
	}
	return sanitized;
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
 * A boundary tracer for one turn.
 *
 * The tracer is READ-ONLY observation: it never changes a value the
 * runtime uses and never gates an operation. Every method is
 * failure-isolated — a throw inside the tracer cannot affect a model
 * call, a tool execution, or a lifecycle commit.
 */
export class LatencyTracer {
	private readonly events: LatencyBoundaryEvent[] = [];
	private readonly openSpans = new Map<
		LatencyBoundary,
		Array<{
			readonly boundary: LatencyBoundary;
			readonly startedAt: number;
			readonly toolCallId?: string;
		}>
	>();
	private readonly origin: number;
	/** The boundaries that were opened at least once. */
	private readonly openedBoundaries = new Set<LatencyBoundary>();
	/** The trace-integrity failures observed so far. */
	private readonly integrityFailures: LatencyIntegrityFailure[] = [];
	/** The measurements that were explicitly marked unavailable. */
	private readonly unavailableMeasurements: LatencyUnavailableMeasurement[] =
		[];

	constructor(
		readonly correlationId: string,
		private readonly clock: LatencyClock = DEFAULT_LATENCY_CLOCK,
	) {
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
			this.events.push({
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
			const stack = this.openSpans.get(boundary);
			const span = {
				boundary,
				startedAt: now,
				toolCallId: readToolCallId(metadata),
			};
			if (stack) {
				stack.push(span);
			} else {
				this.openSpans.set(boundary, [span]);
			}
		} catch {
			// Failure isolation.
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
			// A boundary exited without a matching entry is a trace-
			// integrity failure: the duration is not assertable.
			if (!stack || stack.length === 0) {
				this.integrityFailures.push({
					boundary,
					reason: "exit without a matching start",
				});
			} else if (
				toolCallId !== undefined &&
				!stack.some((span) => span.toolCallId === toolCallId)
			) {
				// An exit naming a tool call that was never entered.
				this.integrityFailures.push({
					boundary,
					reason: `unmatched span id ${toolCallId}`,
				});
			}
			const span = this.takeSpan(boundary, toolCallId);
			this.events.push({
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
			this.events.push({
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
			this.unavailableMeasurements.push({ boundary, reason });
			if (span === undefined) {
				this.integrityFailures.push({
					boundary,
					reason: "marked unavailable without a matching start",
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
				return span;
			}
		}
		return stack.pop();
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
	 * gap between an `end` event and the next `start` event, PLUS the
	 * duration the previous phase itself consumed.
	 *
	 * The span duration is included because the phase's own work IS the
	 * phase: a tool that runs for 60 ms spent 60 ms in the `execution`
	 * stage, whether or not the surrounding boundaries were adjacent.
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
			// The phase the pair denotes is the phase the PREVIOUS span
			// consumed, because the previous span's work happened inside
			// that phase.
			const stage = classifyLatencyStage(current.boundary, next.boundary);
			const spanDuration = current.durationMs ?? 0;
			stages.push({
				correlationId: this.correlationId,
				stage,
				from: current.boundary,
				to: next.boundary,
				durationMs: spanDuration + gap,
			});
		}
		return stages;
	}

	/**
	 * The complete trace.
	 */
	getTrace(): LatencyTrace {
		return {
			correlationId: this.correlationId,
			events: this.getEvents(),
			stages: this.getStages(),
			unavailable: this.getUnavailable(),
			integrityFailures: this.getIntegrityFailures(),
			wallClockMs: this.getWallClockMs(),
			overlapping: this.hasOverlap(),
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
	 */
	getIntegrityFailures(): readonly LatencyIntegrityFailure[] {
		const failures: LatencyIntegrityFailure[] = [...this.integrityFailures];
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
		return failures;
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
