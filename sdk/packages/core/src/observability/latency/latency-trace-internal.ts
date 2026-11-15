/**
 * ACT-CLINEMM-ROUND-C-DOGFOOD-TRACE01 — trusted-internal entry point for
 * the Round C latency trace.
 *
 * ## Why this module exists
 *
 * `LatencyTraceSink` (ACT-CLINEMM-ROUND-C-HARNESS-01/02) is a
 * {@link ModelBehaviorTraceSink} adapter that turns the runtime's existing
 * observation channels into a {@link LatencyTrace}. HARNESS-02 exercised it
 * through the SDK's OWN test suites, but the VSCodium extension host had no
 * way to reach it: the class lived behind the `@cline/core` package boundary
 * and was NOT re-exported from the public `@cline/core` barrel.
 *
 * This module is the NARROW, trusted-internal seam that closes that gap. It
 * follows the established
 * `@cline/core/internal/command-risk-internal` /
 * `@cline/core/internal/parser-helper-runtime` /
 * `@cline/core/internal/reformulation-classifier` precedent exactly:
 *
 *   - It is NOT re-exported from the public `@cline/core` index, so the
 *     package's PUBLIC surface does not widen.
 *   - It is reachable ONLY via the explicit
 *     `@cline/core/internal/latency-trace` deep import, which only trusted
 *     host adapters (the ClineMM VSCode extension host) use.
 *   - It exports the sink plus the read-only trace TYPES a host needs to
 *     serialize the artifact. It exports NO new capability of its own: the
 *     sink and the tracer are the SAME production classes HARNESS-02
 *     qualified.
 *
 * ## What is deliberately NOT here
 *
 *   - No new telemetry framework. The sink is the HARNESS-02 sink.
 *   - No new persistence. The host owns the artifact's location.
 *   - No public API. The extension host consumes this module; external
 *     consumers cannot.
 */

export { LatencyTraceSink } from "./latency-sink";
export type {
	LatencyBoundary,
	LatencyBoundaryEvent,
	LatencyClock,
	LatencyIntegrityFailure,
	LatencyMetadata,
	LatencySkipReasonClassification,
	LatencyStage,
	LatencyStageMeasurement,
	LatencyStatus,
	LatencyTrace,
	LatencyTracerOptions,
	LatencyTraceTruncation,
	LatencyUnavailableMeasurement,
} from "./latency-trace";
export {
	classifyLatencyStage,
	classifySkipReason,
	digestLatencyContent,
	LATENCY_METADATA_ALLOWLIST,
	LATENCY_TRACE_MAX_DISCARDED_SPAN_TOMBSTONES,
	LATENCY_TRACE_MAX_EVENTS,
	LATENCY_TRACE_MAX_INTEGRITY_FAILURES,
	LATENCY_TRACE_MAX_OPEN_SPANS,
	LATENCY_TRACE_MAX_UNAVAILABLE,
	LatencyTracer,
	sanitizeLatencyMetadata,
} from "./latency-trace";
