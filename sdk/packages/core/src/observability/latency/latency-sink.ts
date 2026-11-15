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
	 * This opens ONLY the `request_preparation` span. The preparation span
	 * is closed at the real provider-ready seam
	 * ({@link onRequestPrepared}), so it measures the preparation and
	 * nothing else.
	 *
	 * ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02: the PROVIDER-side spans
	 * (`provider_submitted`, `provider_first_response` and
	 * `provider_first_token`) are NOT opened here. They are opened at the
	 * ACTUAL SUBMISSION boundary ({@link onProviderRequestSubmitted}).
	 *
	 * Opening them here would anchor every provider timer at the start of
	 * request preparation and charge the preparation cost to the provider:
	 * a 250 ms preparation followed by 100 ms to the first token would
	 * report a 350 ms time-to-first-token instead of the true 100 ms.
	 */
	onModelRequestStart(observation: ModelBehaviorTraceObservation): void {
		this.tracer.enter("request_preparation", observation.payload);
	}

	/**
	 * The provider request was ACTUALLY SUBMITTED.
	 *
	 * This is the anchor for every provider-side timer. It opens:
	 *
	 * - `provider_submitted` — the request is now in flight;
	 * - `provider_first_response` — the first provider RESPONSE EVENT;
	 * - `provider_first_token` — the first generated TOKEN.
	 *
	 * The two first-event spans are closed only when the corresponding event
	 * is observed. If it never is, the span stays open and the trace
	 * reports the measurement as UNAVAILABLE rather than as a fabricated
	 * duration.
	 *
	 * The runtime reports this at the real dispatch seam — the instant the
	 * provider's `stream()` is invoked — so the provider interval is
	 * measured from submission and never includes request preparation.
	 */
	onProviderRequestSubmitted(observation: ModelBehaviorTraceObservation): void {
		this.tracer.enter("provider_submitted", observation.payload);
		this.tracer.enter("provider_first_response", observation.payload);
		this.tracer.enter("provider_first_token", observation.payload);
	}

	/**
	 * The request finished preparation and is now provider-ready.
	 *
	 * This closes the INDEPENDENT preparation span. The runtime reports
	 * this boundary at the seam where the request has passed compaction,
	 * every `beforeModel` transform and the final budget check — before
	 * the provider round trip begins. Keeping it separate prevents the
	 * provider's response time from being charged to request preparation.
	 */
	onRequestPrepared(observation: ModelBehaviorTraceObservation): void {
		if (!this.tracer.isOpen("request_preparation")) {
			return;
		}
		this.tracer.exit("request_preparation", {
			metadata: observation.payload,
			status: "ok",
		});
		this.tracer.enter("request_prepared", observation.payload);
	}

	/**
	 * The provider round trip has ENDED.
	 *
	 * The `request_prepared` span is the provider-bound interval: it opens
	 * when the request is handed to the provider and closes when the
	 * provider's stream ends. It is deliberately separate from
	 * `request_preparation`, so a provider round trip is never charged to
	 * request preparation.
	 */
	onProviderRequestCompleted(observation: ModelBehaviorTraceObservation): void {
		this.closeIfOpen("request_prepared", observation.payload, "ok");
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
		// `request_preparation` is closed at the provider-ready seam
		// (`onRequestPrepared`). If the runtime never reached that seam,
		// the preparation span is closed here so no span is left open.
		this.closeIfOpen("request_preparation", observation.payload, "ok");
		// `request_prepared` is the provider-bound interval and is closed
		// by `onProviderRequestCompleted`; close it here as a fallback so
		// no span is left open.
		this.closeIfOpen("request_prepared", observation.payload, "ok");
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02: guarded, because the
		// provider span is opened at the ACTUAL SUBMISSION boundary. A
		// request that never reached submission has no provider span.
		this.closeIfOpen("provider_submitted", observation.payload, "ok");
		// The first response event and the first token are NOT inferred
		// from the stream's completion. If they were not observed, they
		// are explicitly unavailable.
		this.markUnavailableIfOpen(
			"provider_first_response",
			observation.payload,
			"ok",
		);
		this.markUnavailableIfOpen(
			"provider_first_token",
			observation.payload,
			"ok",
		);
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
	 * A boundary that is still open is closed here with the supplied
	 * status, so the trace records the measured interval instead of
	 * leaving a span dangling.
	 *
	 * The provider's first-response / first-token boundaries use a
	 * different path: when they are still open at stream completion the
	 * measurement was genuinely NOT observed, so they are marked
	 * unavailable rather than given a fabricated duration.
	 */
	private closeIfOpen(
		boundary: LatencyBoundary,
		payload: Readonly<Record<string, unknown>>,
		status: LatencyStatus,
	): void {
		if (!this.tracer.isOpen(boundary)) {
			return;
		}
		this.tracer.exit(boundary, {
			metadata: payload,
			status,
		});
	}

	/**
	 * Mark a boundary as UNAVAILABLE if it is still open.
	 *
	 * Used only for the provider's first-response / first-token events:
	 * when the stream ends without those events, the measurement was not
	 * observed, so the trace must say so explicitly instead of recording
	 * the stream-completion instant as if it were the event.
	 */
	private markUnavailableIfOpen(
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
		this.closeIfOpen("request_preparation", observation.payload, "failed");
		this.closeIfOpen("request_prepared", observation.payload, "failed");
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02: the provider span is
		// opened at the ACTUAL SUBMISSION boundary. If the request never
		// reached submission (a preparation failure, a budget rejection),
		// there is no provider span to close, and closing one anyway would
		// fabricate an integrity failure.
		this.closeIfOpen("provider_submitted", observation.payload, "failed");
		this.markUnavailableIfOpen(
			"provider_first_response",
			observation.payload,
			"failed",
		);
		this.markUnavailableIfOpen(
			"provider_first_token",
			observation.payload,
			"failed",
		);
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
		this.closeIfOpen("request_preparation", observation.payload, "aborted");
		this.closeIfOpen("request_prepared", observation.payload, "aborted");
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02: guarded for the same
		// reason as the failure path — an abort before submission has no
		// provider span to close.
		this.closeIfOpen("provider_submitted", observation.payload, "aborted");
		this.markUnavailableIfOpen(
			"provider_first_response",
			observation.payload,
			"aborted",
		);
		this.markUnavailableIfOpen(
			"provider_first_token",
			observation.payload,
			"aborted",
		);
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
