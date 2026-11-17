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
	type LatencyTraceTruncation,
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
 * Derive the compaction span's terminal status from the OBSERVED outcome.
 *
 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01.
 *
 * The production seam reports the compaction's terminal outcome in the
 * completion payload:
 *
 *   - `compactionOutcome: "completed"` — the compaction produced a
 *     transcript. This is the only outcome that is a success.
 *   - `compactionOutcome: "failed"`   — the compaction ran and produced
 *     no transcript.
 *   - `compactionOutcome: "cancelled"` — the compaction was aborted.
 *
 * A payload that carries NO outcome is treated as `"ok"`: that is the
 * historical behaviour (the completion channel was always a success)
 * and it keeps every pre-existing producer working unchanged. The
 * distinction only matters for producers that adopted the outcome
 * classification.
 *
 * The status is never invented: a compaction that produced no
 * transcript is never reported as a successful completion.
 */
function deriveCompactionFinishStatus(
	payload: Readonly<Record<string, unknown>>,
): LatencyStatus {
	const outcome = payload.compactionOutcome;
	if (outcome === "failed" || outcome === "error") {
		return "failed";
	}
	if (outcome === "cancelled" || outcome === "aborted") {
		return "cancelled";
	}
	return "ok";
}

/**
 * Project the OBSERVATION IDENTITY onto the metadata bag.
 *
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 (P0-4 correction).
 *
 * The runtime carries the authoritative correlation identities on the
 * OBSERVATION (`observation.preparationRequestId`,
 * `observation.modelRequestId`), not on the payload. The latency tracer
 * only records METADATA, so an adapter that forwards only
 * `observation.payload` silently DROPS the join key — the exported trace
 * then cannot connect the compaction decision to the provider dispatch and
 * completion.
 *
 * This projection moves the identity fields into the metadata bag. They are
 * IDENTIFIERS (opaque ids), and they are still subject to the finite
 * metadata ALLOWLIST in `sanitizeLatencyMetadata`, so nothing escapes the
 * privacy contract.
 *
 * The payload's own value wins when both carry the same field: the payload
 * is the seam-specific value (for example the compaction seam's own
 * `preparationRequestId`), while the identity is the runtime-wide value.
 */
function withObservationCorrelation(
	observation: ModelBehaviorTraceObservation,
): Readonly<Record<string, unknown>> {
	return {
		...(observation.preparationRequestId !== undefined
			? { preparationRequestId: observation.preparationRequestId }
			: {}),
		...(observation.modelRequestId !== undefined
			? { modelRequestId: observation.modelRequestId }
			: {}),
		...observation.payload,
	};
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
	 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01-CORR01 — the completeness metadata
	 * of the BOUNDED capture.
	 *
	 * A host that exports the trace MUST carry this block: a truncated trace
	 * is INCOMPLETE, and presenting it as exhaustive would be a false
	 * statement about the measurement.
	 */
	getTruncation(): LatencyTraceTruncation {
		return this.tracer.getTruncation();
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
				metadata: withObservationCorrelation(observation),
			});
			this.record("schema_validation", "end", {
				metadata: withObservationCorrelation(observation),
				status: "ok",
			});
			return;
		}
		// A rejected schema is a REJECTION, not a successful validation.
		this.record("schema_validation", "start", {
			metadata: withObservationCorrelation(observation),
		});
		this.record("schema_validation", "end", {
			metadata: withObservationCorrelation(observation),
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
			metadata: withObservationCorrelation(observation),
		});
		this.record("tool_result_delivered", "end", {
			metadata: withObservationCorrelation(observation),
			status: "ok",
		});
	}

	/**
	 * The COMPACTION boundary — START.
	 *
	 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the MEASUREMENT BOUNDARY MOVED
	 * TO THE REAL COMPACTION-EXECUTION SEAM.
	 *
	 * ## The defect this repairs
	 *
	 * The compaction pipeline reports its DIAGNOSTICS at the moment it
	 * DECIDES whether to compact — before the decision is applied. The
	 * `auto` mode then returns `undefined` when the transcript is below
	 * the trigger, so NO compaction work ran.
	 *
	 * This sink used to open the `compaction` span on EVERY diagnostic,
	 * so every no-op eligibility CHECK left a span open forever. The
	 * tracer then reported each one as a `"span left open"` integrity
	 * failure. The packaged Round C dogfood run (session
	 * `1794780088950_tc1vx`) recorded 45 compaction starts, 2 compaction
	 * ends, and exactly 43 such integrity failures.
	 *
	 * ## The correction
	 *
	 * The production seam publishes `compactionInitiated` — a boolean
	 * classification that is true exactly when the seam proceeds PAST
	 * the decision point and begins real compaction work. The span is
	 * opened only then, so:
	 *
	 *   - a no-op eligibility check leaves NO open span;
	 *   - a real compaction is bounded by its own execution.
	 *
	 * The diagnostic itself is still OBSERVED — the eligibility check is
	 * real evidence and the trace must not lose it. What changes is only
	 * whether it opens a span.
	 *
	 * A producer that does not publish `compactionInitiated` at all is
	 * treated as having INITIATED a compaction: the span is opened. That
	 * is the conservative choice — it preserves the pre-correction
	 * behaviour for any producer that has not adopted the discriminator,
	 * so an older producer cannot silently lose its compaction span.
	 */
	onCompactionDiagnostics(observation: ModelBehaviorTraceObservation): void {
		const initiated = observation.payload.compactionInitiated;
		// ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — the DECISION RECORD.
		//
		// EVERY eligibility evaluation is now observable, whether or not
		// compaction followed. The decision is recorded as a POINT
		// OBSERVATION on the dedicated `compaction_decision` boundary:
		// no span is opened and NO duration is manufactured.
		//
		// Before this, a no-op eligibility check (`compactionInitiated
		// === false`) returned early and left NOTHING in the trace. That
		// is the evidence needed to explain why a compaction did NOT
		// happen — the request estimate, the effective threshold and the
		// calibration factor AT THE MOMENT the policy decided — and it
		// was missing.
		//
		// The `compaction` boundary remains EXCLUSIVELY the execution
		// boundary: only an INITIATED compaction opens a span, and only
		// its real terminal outcome closes it.
		this.tracer.recordPoint(
			"compaction_decision",
			withObservationCorrelation(observation),
		);
		if (initiated === false) {
			// A no-op eligibility CHECK: observed, but not a span.
			return;
		}
		this.record("compaction", "start", {
			metadata: withObservationCorrelation(observation),
		});
	}

	/**
	 * The COMPACTION boundary — END.
	 *
	 * The compaction pipeline reports its COMPLETION with the message
	 * counts before and after, the messages removed, and the evidence
	 * reference continuity. The compaction's OUTPUT SUMMARY is never
	 * recorded — only counts.
	 *
	 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 — the terminal status is the
	 * OBSERVED outcome, not an assumption. A compaction that ran and
	 * produced a transcript is `"ok"`. A compaction that was initiated
	 * but produced NO transcript is reported by the production seam with
	 * a terminal status, and this sink closes the span with THAT status
	 * — it never invents a successful completion.
	 */
	onCompactionCompleted(observation: ModelBehaviorTraceObservation): void {
		this.record("compaction", "end", {
			metadata: withObservationCorrelation(observation),
			status: deriveCompactionFinishStatus(observation.payload),
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
			metadata: withObservationCorrelation(observation),
		});
		this.record("provider_ready", "end", {
			metadata: withObservationCorrelation(observation),
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
	 * `provider_first_text`) are NOT opened here. They are opened at the
	 * ACTUAL SUBMISSION boundary ({@link onProviderRequestSubmitted}).
	 *
	 * Opening them here would anchor every provider timer at the start of
	 * request preparation and charge the preparation cost to the provider:
	 * a 250 ms preparation followed by 100 ms to the first text would
	 * report a 350 ms time-to-first-text instead of the true 100 ms.
	 */
	onModelRequestStart(observation: ModelBehaviorTraceObservation): void {
		this.tracer.enter(
			"request_preparation",
			withObservationCorrelation(observation),
		);
	}

	/**
	 * The provider request was ACTUALLY SUBMITTED.
	 *
	 * This is the anchor for every provider-side timer. It opens:
	 *
	 * - `provider_submitted` — the request is now in flight;
	 * - `provider_first_response` — the first provider RESPONSE EVENT;
	 * - `provider_first_text` — the first generated TOKEN.
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
		this.tracer.enter(
			"provider_submitted",
			withObservationCorrelation(observation),
		);
		this.tracer.enter(
			"provider_first_response",
			withObservationCorrelation(observation),
		);
		this.tracer.enter(
			"provider_first_text",
			withObservationCorrelation(observation),
		);
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
			metadata: withObservationCorrelation(observation),
			status: "ok",
		});
		this.tracer.enter(
			"request_prepared",
			withObservationCorrelation(observation),
		);
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
		this.closeIfOpen(
			"request_prepared",
			withObservationCorrelation(observation),
			"ok",
		);
	}

	/**
	 * The model request completed.
	 *
	 * This closes the provider span.
	 *
	 * ## It does NOT fabricate a first-text measurement
	 *
	 * The runtime reports ONE event when the provider's stream ends. The
	 * first response EVENT and the first generated TOKEN are both
	 * distinct instants from that, so neither is inferred here. If the
	 * provider did not report them, they stay UNAVAILABLE — the trace
	 * says so explicitly rather than carrying a zero-duration span
	 * that would read as "the first text arrived at stream completion".
	 */
	onModelRequestFinish(observation: ModelBehaviorTraceObservation): void {
		// `request_preparation` is closed at the provider-ready seam
		// (`onRequestPrepared`). If the runtime never reached that seam,
		// the preparation span is closed here so no span is left open.
		this.closeIfOpen(
			"request_preparation",
			withObservationCorrelation(observation),
			"ok",
		);
		// `request_prepared` is the provider-bound interval and is closed
		// by `onProviderRequestCompleted`; close it here as a fallback so
		// no span is left open.
		this.closeIfOpen(
			"request_prepared",
			withObservationCorrelation(observation),
			"ok",
		);
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02: guarded, because the
		// provider span is opened at the ACTUAL SUBMISSION boundary. A
		// request that never reached submission has no provider span.
		this.closeIfOpen(
			"provider_submitted",
			withObservationCorrelation(observation),
			"ok",
		);
		// The first response event and the first text are NOT inferred
		// from the stream's completion. If they were not observed, they
		// are explicitly unavailable.
		this.markUnavailableIfOpen(
			"provider_first_response",
			withObservationCorrelation(observation),
			"ok",
		);
		this.markUnavailableIfOpen(
			"provider_first_text",
			withObservationCorrelation(observation),
			"ok",
		);
		this.tracer.enter(
			"provider_completed",
			withObservationCorrelation(observation),
		);
		this.tracer.exit("provider_completed", {
			metadata: withObservationCorrelation(observation),
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
	 * The provider's first-response / first-text boundaries use a
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
	 * Used only for the provider's first-response / first-text events:
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
			metadata: withObservationCorrelation(observation),
			status: "ok",
		});
	}

	/**
	 * The provider produced its first observed GENERATED TEXT.
	 *
	 * The span measures from the request's submission to the first
	 * NON-EMPTY text delta. It is a CLIENT-SIDE measurement of generated
	 * TEXT.
	 *
	 * ## It is NOT an authoritative time-to-first-token
	 *
	 * ACT-CLINEMM-ROUND-C-TRACE-QUAL01 CORRECTION01 (P0-3). A reasoning-first
	 * request generates reasoning tokens before any text exists, and a
	 * tool-call-only request generates tokens without ever emitting text.
	 * The server-side TTFT is not observable at this seam and is recorded
	 * as explicitly UNAVAILABLE_FROM_TRACE.
	 *
	 * A host that cannot observe the first generated text must NOT call this
	 * method; the measurement then stays UNAVAILABLE and the trace says so.
	 */
	onProviderFirstText(observation: ModelBehaviorTraceObservation): void {
		this.tracer.exit("provider_first_text", {
			metadata: withObservationCorrelation(observation),
			status: "ok",
		});
	}

	/**
	 * The model request failed.
	 */
	onModelRequestError(observation: ModelBehaviorTraceObservation): void {
		this.closeIfOpen(
			"request_preparation",
			withObservationCorrelation(observation),
			"failed",
		);
		this.closeIfOpen(
			"request_prepared",
			withObservationCorrelation(observation),
			"failed",
		);
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02: the provider span is
		// opened at the ACTUAL SUBMISSION boundary. If the request never
		// reached submission (a preparation failure, a budget rejection),
		// there is no provider span to close, and closing one anyway would
		// fabricate an integrity failure.
		this.closeIfOpen(
			"provider_submitted",
			withObservationCorrelation(observation),
			"failed",
		);
		this.markUnavailableIfOpen(
			"provider_first_response",
			withObservationCorrelation(observation),
			"failed",
		);
		this.markUnavailableIfOpen(
			"provider_first_text",
			withObservationCorrelation(observation),
			"failed",
		);
		this.tracer.enter(
			"provider_completed",
			withObservationCorrelation(observation),
		);
		this.tracer.exit("provider_completed", {
			metadata: withObservationCorrelation(observation),
			status: "failed",
		});
	}

	/**
	 * The model request was aborted.
	 */
	onModelRequestAbort(observation: ModelBehaviorTraceObservation): void {
		this.closeIfOpen(
			"request_preparation",
			withObservationCorrelation(observation),
			"aborted",
		);
		this.closeIfOpen(
			"request_prepared",
			withObservationCorrelation(observation),
			"aborted",
		);
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02: guarded for the same
		// reason as the failure path — an abort before submission has no
		// provider span to close.
		this.closeIfOpen(
			"provider_submitted",
			withObservationCorrelation(observation),
			"aborted",
		);
		this.markUnavailableIfOpen(
			"provider_first_response",
			withObservationCorrelation(observation),
			"aborted",
		);
		this.markUnavailableIfOpen(
			"provider_first_text",
			withObservationCorrelation(observation),
			"aborted",
		);
		this.tracer.enter(
			"provider_completed",
			withObservationCorrelation(observation),
		);
		this.tracer.exit("provider_completed", {
			metadata: withObservationCorrelation(observation),
			status: "aborted",
		});
	}

	/**
	 * A tool call started.
	 */
	onToolStart(observation: ModelBehaviorTraceObservation): void {
		this.tracer.enter(
			"tool_execution",
			withObservationCorrelation(observation),
		);
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
			metadata: withObservationCorrelation(observation),
			status: status ?? deriveToolFinishStatus(observation.payload),
		});
	}
}
