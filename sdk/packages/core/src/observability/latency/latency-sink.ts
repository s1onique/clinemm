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

	// -------------------------------------------------------------------------
	// ModelBehaviorTraceSink channels
	// -------------------------------------------------------------------------

	/**
	 * The model request was prepared and is about to be issued.
	 *
	 * This is boundary 1 (`request_prepared`) and the START of boundary 2
	 * (`provider_submitted`): the runtime issues the request immediately
	 * after preparing it, so the two are entered together.
	 */
	onModelRequestStart(observation: ModelBehaviorTraceObservation): void {
		this.tracer.enter("request_prepared", observation.payload);
		this.tracer.enter("provider_submitted", observation.payload);
	}

	/**
	 * The model request completed.
	 *
	 * This closes the provider span and is the START of the first-token
	 * span: the runtime reports the finish when the provider's stream
	 * ends, so the first-token boundary is entered at the same instant.
	 */
	onModelRequestFinish(observation: ModelBehaviorTraceObservation): void {
		this.tracer.exit("provider_submitted", {
			metadata: observation.payload,
			status: "ok",
		});
		this.tracer.enter("provider_first_token", observation.payload);
		this.tracer.exit("provider_first_token", {
			metadata: observation.payload,
			status: "ok",
		});
		this.tracer.enter("provider_completed", observation.payload);
	}

	/**
	 * The model request failed.
	 */
	onModelRequestError(observation: ModelBehaviorTraceObservation): void {
		this.tracer.exit("provider_submitted", {
			metadata: observation.payload,
			status: "failed",
		});
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
		this.tracer.exit("provider_submitted", {
			metadata: observation.payload,
			status: "aborted",
		});
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
	 */
	onToolFinish(observation: ModelBehaviorTraceObservation): void {
		this.tracer.exit("tool_execution", {
			metadata: observation.payload,
			status: "ok",
		});
	}
}
