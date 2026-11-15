/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 2 latency sink adapter.
 *
 * ## What this is
 *
 * A {@link ModelBehaviorTraceSink} that turns the runtime's EXISTING
 * observation channels into a {@link LatencyTrace}.
 *
 * ## Why it is an ADAPTER and not a hot-path change
 *
 * The agent runtime already reports the boundaries this ACT needs:
 * `onModelRequestStart` / `onModelRequestFinish` cover the model request
 * and the provider round trip, and `onToolStart` / `onToolFinish` cover
 * the tool execution. Those channels are already read-only and
 * failure-isolated.
 *
 * Building the latency trace as a CONSUMER of those channels means the
 * instrumentation adds NO work to the runtime's hot path: when the
 * adapter is not installed, the runtime behaves exactly as before.
 *
 * The boundaries the runtime does not yet report — schema validation, the
 * tool result's delivery into the conversation, and the tool result's
 * presence in the provider-ready request — are exposed as explicit
 * `record*` methods on this adapter, so a host that owns those seams can
 * report them without the runtime's dispatch path growing.
 *
 * ## Privacy invariant (load-bearing)
 *
 * Everything this adapter reads from the observation channels passes
 * through the latency metadata ALLOWLIST before it is recorded. A payload
 * field that is not allowlisted is DROPPED.
 */

import type {
	ModelBehaviorTraceObservation,
	ModelBehaviorTraceSink,
} from "@cline/shared";
import {
	DEFAULT_LATENCY_CLOCK,
	digestLatencyContent,
	type LatencyBoundary,
	type LatencyClock,
	type LatencyStageMeasurement,
	type LatencyStatus,
	type LatencyTrace,
	LatencyTracer,
} from "./latency-trace";

/**
 * Derive the tool-execution span's status from the runtime's own outcome
 * facts.
 *
 * ACT-CLINEMM-ROUND-C-HARNESS-02. The runtime is the authority for three
 * facts, and this adapter only translates them:
 *
 *   - `executionInvoked === false` — the executor never ran. The call was
 *     skipped (validation failure, policy, denied approval, registry
 *     miss). That is a REJECTION, not a success and not a failure of
 *     the tool itself.
 *   - `outcome === "error"` — the executor ran and reported an error.
 *   - `outcome === "cancelled"` / `"aborted"` — the call was cancelled.
 *
 * An UNKNOWN payload (a caller that publishes none of these fields)
 * falls back to `"ok"`, which preserves the previous behaviour for
 * callers that only ever report successes.
 */
function deriveToolFinishStatus(
	payload: Readonly<Record<string, unknown>>,
): LatencyStatus {
	const outcome = payload.outcome;
	if (outcome === "cancelled" || outcome === "aborted") {
		return "cancelled";
	}
	if (outcome === "error" || outcome === "failed") {
		return "failed";
	}
	if (payload.executionInvoked === false) {
		return "rejected";
	}
	if (typeof payload.skipReason === "string" && payload.skipReason.length > 0) {
		return "rejected";
	}
	return "ok";
}

/**
 * The adapter.
 */
export class LatencyTraceSink implements ModelBehaviorTraceSink {
	private readonly tracer: LatencyTracer;

	constructor(
		correlationId: string,
		clock: LatencyClock = DEFAULT_LATENCY_CLOCK,
	) {
		this.tracer = new LatencyTracer(correlationId, clock);
	}

	/**
	 * The correlation id this sink reports under.
	 */
	get correlationId(): string {
		return this.tracer.correlationId;
	}

	/**
	 * The recorded trace.
	 */
	getTrace(): LatencyTrace {
		return this.tracer.getTrace();
	}

	/**
	 * The measured stages.
	 */
	getStages(): readonly LatencyStageMeasurement[] {
		return this.tracer.getStages();
	}

	/**
	 * Report a boundary explicitly.
	 *
	 * A host that owns a seam the runtime does not report uses this to
	 * record it without the runtime's dispatch path growing.
	 */
	record(
		boundary: LatencyBoundary,
		phase: "start" | "end",
		options: {
			readonly metadata?: Readonly<Record<string, unknown>>;
			readonly status?: LatencyStatus;
		} = {},
	): void {
		if (phase === "start") {
			this.tracer.enter(boundary, options.metadata);
			return;
		}
		this.tracer.exit(boundary, options);
	}

	/**
	 * Record the tool-call SCHEMA VALIDATION boundary.
	 */
	recordSchemaValidation(
		phase: "start" | "end",
		options: {
			readonly metadata?: Readonly<Record<string, unknown>>;
			readonly status?: LatencyStatus;
		} = {},
	): void {
		this.record("schema_validation", phase, options);
	}

	/**
	 * Record the TOOL RESULT DELIVERY boundary — the moment the result
	 * became part of the conversation.
	 *
	 * Only SIZE and DIGEST are recorded; the result's content never
	 * leaves the process.
	 */
	recordToolResultDelivered(
		phase: "start" | "end",
		options: {
			readonly resultText?: string;
			readonly metadata?: Readonly<Record<string, unknown>>;
			readonly status?: LatencyStatus;
		} = {},
	): void {
		const metadata = {
			...(options.metadata ?? {}),
			...(options.resultText !== undefined
				? {
						toolResultBytes: Buffer.byteLength(options.resultText, "utf8"),
						toolResultCharCount: options.resultText.length,
						toolResultDigest: digestLatencyContent(options.resultText),
					}
				: {}),
		};
		this.record("tool_result_delivered", phase, {
			metadata,
			status: options.status,
		});
	}

	/**
	 * Record the PROVIDER-READY boundary — the moment the tool result was
	 * included, rewritten or truncated in the request that goes to the
	 * provider.
	 */
	recordProviderReady(
		phase: "start" | "end",
		options: {
			readonly metadata?: Readonly<Record<string, unknown>>;
			readonly status?: LatencyStatus;
		} = {},
	): void {
		this.record("provider_ready", phase, options);
	}

	/**
	 * Record the COMPACTION boundary.
	 */
	recordCompaction(
		phase: "start" | "end",
		options: {
			readonly metadata?: Readonly<Record<string, unknown>>;
			readonly status?: LatencyStatus;
		} = {},
	): void {
		this.record("compaction", phase, options);
	}

	/**
	 * The SCHEMA VALIDATION boundary, reported by the runtime.
	 *
	 * The runtime validates a tool call's input against the tool's own
	 * schema before approval and before execution. This records the
	 * outcome — never the input.
	 */
	onSchemaValidation(observation: ModelBehaviorTraceObservation): void {
		const valid = observation.payload.schemaValid !== false;
		if (valid) {
			this.record("schema_validation", "start", {
				metadata: observation.payload,
			});
			this.record("schema_validation", "end", {
				metadata: observation.payload,
				status: "ok",
			});
			return;
		}
		// A rejected schema is a REJECTION, not a successful validation.
		this.record("schema_validation", "start", {
			metadata: observation.payload,
		});
		this.record("schema_validation", "end", {
			metadata: observation.payload,
			status: "rejected",
		});
	}

	/**
	 * The TOOL RESULT DELIVERY boundary, reported by the runtime.
	 *
	 * The runtime reports this when the result becomes part of the
	 * conversation — not when the executor returned it. The result's
	 * content is never recorded; only its size and digest.
	 */
	onToolResultDelivered(observation: ModelBehaviorTraceObservation): void {
		this.record("tool_result_delivered", "start", {
			metadata: observation.payload,
		});
		this.record("tool_result_delivered", "end", {
			metadata: observation.payload,
			status: "ok",
		});
	}

	/**
	 * The COMPACTION boundary — START.
	 *
	 * The compaction pipeline reports its DIAGNOSTICS at the moment it
	 * decides whether to compact, which is the start of the compaction
	 * span. The diagnostics carry the before/after token budget and the
	 * trigger reason; the message counts arrive with the completion.
	 *
	 * This is the REAL production seam: the compaction pipeline in
	 * `extensions/context/compaction.ts` calls this channel before it
	 * runs its strategy.
	 */
	onCompactionDiagnostics(observation: ModelBehaviorTraceObservation): void {
		this.record("compaction", "start", {
			metadata: observation.payload,
		});
	}

	/**
	 * The COMPACTION boundary — END.
	 *
	 * The compaction pipeline reports its COMPLETION with the message
	 * counts before and after, the messages removed, and the evidence
	 * reference continuity. The compaction's OUTPUT SUMMARY is never
	 * recorded — only counts.
	 */
	onCompactionCompleted(observation: ModelBehaviorTraceObservation): void {
		this.record("compaction", "end", {
			metadata: observation.payload,
			status: "ok",
		});
	}

	/**
	 * The PROVIDER-READY boundary, reported by the runtime.
	 *
	 * The runtime reports this for the FINAL provider-bound message
	 * representation — after every transformation and safety pass. The
	 * request's content is never recorded; only its size, its digest and
	 * the inclusion classification of each tool result.
	 */
	onProviderReady(observation: ModelBehaviorTraceObservation): void {
		this.record("provider_ready", "start", {
			metadata: observation.payload,
		});
		this.record("provider_ready", "end", {
			metadata: observation.payload,
			status: "ok",
		});
	}

	// -------------------------------------------------------------------------
	// ModelBehaviorTraceSink channels
	// -------------------------------------------------------------------------

	/**
	 * The model request was prepared and is about to be issued.
	 *
	 * This is boundary 1 (`request_prepared`) and the START of boundary 2
	 * (`provider_submitted`): the runtime issues the request immediately
	 * after preparing it, so the two are entered together.
	 *
	 * `request_prepared` is closed at the moment the request is handed to
	 * the provider, so the preparation span measures the preparation and
	 * nothing else.
	 *
	 * The `provider_first_response` and `provider_first_token` spans are
	 * OPENED here, at submission, so their durations measure the time
	 * from handing the request to the provider until the corresponding
	 * event arrives. They are closed only when that event is observed;
	 * if it never is, the span stays open and the trace reports the
	 * measurement as unavailable rather than as a fabricated duration.
	 */
	onModelRequestStart(observation: ModelBehaviorTraceObservation): void {
		this.tracer.enter("request_prepared", observation.payload);
		this.tracer.enter("provider_submitted", observation.payload);
		this.tracer.enter("provider_first_response", observation.payload);
		this.tracer.enter("provider_first_token", observation.payload);
	}

	/**
	 * The model request completed.
	 *
	 * This closes the provider span.
	 *
	 * ## It does NOT fabricate a first-token measurement
	 *
	 * The runtime reports ONE event when the provider's stream ends. The
	 * first response EVENT and the first generated TOKEN are both
	 * distinct instants from that, so neither is inferred here. If the
	 * provider did not report them, they stay UNAVAILABLE — the trace
	 * says so explicitly rather than carrying a zero-duration span
	 * that would read as "the first token arrived at stream completion".
	 */
	onModelRequestFinish(observation: ModelBehaviorTraceObservation): void {
		this.tracer.exit("request_prepared", {
			metadata: observation.payload,
			status: "ok",
		});
		this.tracer.exit("provider_submitted", {
			metadata: observation.payload,
			status: "ok",
		});
		// The first response event and the first token are NOT inferred
		// from the stream's completion. If they were not observed, they
		// are explicitly unavailable.
		this.closeIfOpen("provider_first_response", observation.payload, "ok");
		this.closeIfOpen("provider_first_token", observation.payload, "ok");
		this.tracer.enter("provider_completed", observation.payload);
		this.tracer.exit("provider_completed", {
			metadata: observation.payload,
			status: "ok",
		});
	}

	/**
	 * Close a boundary IF it is still open.
	 *
	 * A boundary that was already closed by its own event is left alone.
	 * A boundary that is still open is marked unavailable, so the trace
	 * records that the measurement was not observed rather than leaving a
	 * span dangling.
	 */
	private closeIfOpen(
		boundary: LatencyBoundary,
		payload: Readonly<Record<string, unknown>>,
		status: LatencyStatus,
	): void {
		if (!this.tracer.isOpen(boundary)) {
			return;
		}
		this.tracer.markUnavailable(
			boundary,
			"the provider did not report this event",
			{ metadata: payload, status },
		);
	}

	/**
	 * The provider produced its FIRST RESPONSE EVENT.
	 *
	 * This is the provider acknowledging the request or sending its first
	 * byte — NOT the first generated token, and NOT the stream's
	 * completion. A host that observes it reports it here so the
	 * transport's time-to-first-byte is measurable.
	 *
	 * The span measures from the request's submission to the first
	 * response event, so the host reports the EVENT, not the span's
	 * endpoints.
	 */
	onProviderFirstResponse(observation: ModelBehaviorTraceObservation): void {
		this.tracer.exit("provider_first_response", {
			metadata: observation.payload,
			status: "ok",
		});
	}

	/**
	 * The provider generated its FIRST TOKEN.
	 *
	 * The span measures from the request's submission to the first
	 * generated token, which is the true time-to-first-token. A host that
	 * cannot observe the first token must NOT call this method; the
	 * measurement then stays UNAVAILABLE and the trace says so.
	 */
	onProviderFirstToken(observation: ModelBehaviorTraceObservation): void {
		this.tracer.exit("provider_first_token", {
			metadata: observation.payload,
			status: "ok",
		});
	}

	/**
	 * The model request failed.
	 */
	onModelRequestError(observation: ModelBehaviorTraceObservation): void {
		this.tracer.exit("request_prepared", {
			metadata: observation.payload,
			status: "failed",
		});
		this.tracer.exit("provider_submitted", {
			metadata: observation.payload,
			status: "failed",
		});
		this.closeIfOpen("provider_first_response", observation.payload, "failed");
		this.closeIfOpen("provider_first_token", observation.payload, "failed");
		this.tracer.enter("provider_completed", observation.payload);
		this.tracer.exit("provider_completed", {
			metadata: observation.payload,
			status: "failed",
		});
	}

	/**
	 * The model request was aborted.
	 */
	onModelRequestAbort(observation: ModelBehaviorTraceObservation): void {
		this.tracer.exit("request_prepared", {
			metadata: observation.payload,
			status: "aborted",
		});
		this.tracer.exit("provider_submitted", {
			metadata: observation.payload,
			status: "aborted",
		});
		this.closeIfOpen("provider_first_response", observation.payload, "aborted");
		this.closeIfOpen("provider_first_token", observation.payload, "aborted");
		this.tracer.enter("provider_completed", observation.payload);
		this.tracer.exit("provider_completed", {
			metadata: observation.payload,
			status: "aborted",
		});
	}

	/**
	 * A tool call started.
	 */
	onToolStart(observation: ModelBehaviorTraceObservation): void {
		this.tracer.enter("tool_execution", observation.payload);
	}

	/**
	 * A tool call finished.
	 *
	 * The status distinguishes a completed tool from one that was
	 * CANCELLED, FAILED or REJECTED. A cancelled tool must never be
	 * reported as a successful completion.
	 *
	 * ACT-CLINEMM-ROUND-C-HARNESS-02: the status is derived from the
	 * runtime's OWN outcome fields when the caller does not supply one.
	 *
	 * The runtime calls this channel with a single argument, so the
	 * previous default of `"ok"` reported EVERY finished tool call as a
	 * successful completion — including a call whose approval was
	 * DENIED and whose executor never ran. The runtime already publishes
	 * the authoritative facts in the payload:
	 *
	 *   - `outcome`            — `"success"` | `"error"` | ...
	 *   - `executionInvoked`   — the C1.2 authority: did the executor run?
	 *   - `skipReason`         — why the call never reached the executor
	 *
	 * A call that never reached its executor is NOT a successful
	 * completion, no matter what its (synthetic) result said.
	 */
	onToolFinish(
		observation: ModelBehaviorTraceObservation,
		status?: LatencyStatus,
	): void {
		this.tracer.exit("tool_execution", {
			metadata: observation.payload,
			status: status ?? deriveToolFinishStatus(observation.payload),
		});
	}
}
