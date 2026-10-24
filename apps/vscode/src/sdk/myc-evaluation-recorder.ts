/**
 * ACT-CLINEMM-MYC-REAL-WORKFLOW-AUTOCAPTURE01 — the boundary recorder.
 *
 * This is the SINGLE integration point between the production boundaries
 * and the capture store. Every production boundary calls one of the
 * `record*` functions below; each one is a strict no-op when the capture
 * is disabled (the public path is bit-identical to the pre-ACT path).
 *
 * The recorder never throws and never blocks execution.
 */

import {
	checkpointMycEvaluationSession,
	isMycEvaluationCaptureEnabled,
	type MycEvaluationEventType,
	type MycEvaluationResultClass,
	recordMycEvaluationEvent,
} from "./myc-evaluation-capture"
import {
	buildMycEvaluationReport,
	buildMycEvaluationSummary,
	type MycEvaluationUsefulnessGroundTruth,
} from "./myc-evaluation-report"

/**
 * Optional per-call context that production boundaries can supply.
 */
export interface MycEvaluationCallContext {
	/** The MCP call identity (one per `McpHub.callTool()` resolution). */
	readonly callId?: string
	/** The MCP tool name. NEVER the arguments. */
	readonly toolName?: string
	/** The myc-side session id, when observable. */
	readonly mycSessionId?: string
	/** The ClineMM task id, when observable. */
	readonly taskId?: string
	/** The measured duration in milliseconds. */
	readonly durationMs?: number
	/** The measurable input byte count. */
	readonly inputBytes?: number
	/** The measurable output byte count. */
	readonly outputBytes?: number
	/** The MEASURED token count (never estimated). */
	readonly tokenCount?: number
	/** The digest of the payload, where safe to compute. */
	readonly contentSha256?: string
	/** The observed result count, when measurable. */
	readonly resultCount?: number
	/** The bounded result classification. */
	readonly resultClass?: MycEvaluationResultClass
	/** A bounded discriminator (enum-like), never free text. */
	readonly detail?: string
	/** The source HEAD the evidence was produced from. */
	readonly sourceHead?: string
}

/**
 * Record a generic event at a production boundary.
 */
export function recordMycEvaluation(
	sessionId: string,
	eventType: MycEvaluationEventType,
	context: MycEvaluationCallContext = {},
): void {
	if (!isMycEvaluationCaptureEnabled()) return
	recordMycEvaluationEvent(sessionId, {
		eventType,
		...(context.callId !== undefined ? { callId: context.callId } : {}),
		...(context.toolName !== undefined ? { toolName: context.toolName } : {}),
		...(context.mycSessionId !== undefined ? { mycSessionId: context.mycSessionId } : {}),
		...(context.taskId !== undefined ? { taskId: context.taskId } : {}),
		...(context.durationMs !== undefined ? { durationMs: context.durationMs } : {}),
		...(context.inputBytes !== undefined ? { inputBytes: context.inputBytes } : {}),
		...(context.outputBytes !== undefined ? { outputBytes: context.outputBytes } : {}),
		...(context.tokenCount !== undefined ? { tokenCount: context.tokenCount } : {}),
		...(context.contentSha256 !== undefined ? { contentSha256: context.contentSha256 } : {}),
		...(context.resultCount !== undefined ? { resultCount: context.resultCount } : {}),
		...(context.resultClass !== undefined ? { resultClass: context.resultClass } : {}),
		...(context.detail !== undefined ? { detail: context.detail } : {}),
		...(context.sourceHead !== undefined ? { sourceHead: context.sourceHead } : {}),
	})
}

/**
 * Record an MCP completion.
 *
 * CARDINALITY INVARIANT: exactly ONE `mcp_call_completed` event per
 * `McpHub.callTool()` resolution. The McpHub completion observer is the
 * SINGLE cardinality owner; this recorder only observes the event the
 * observer already fires.
 */
export function recordMycEvaluationMcpCompletion(sessionId: string, context: MycEvaluationCallContext): void {
	recordMycEvaluation(sessionId, "mcp_call_completed", context)
}

/**
 * Checkpoint the session bundle (summary.json + evaluation.md).
 *
 * Checkpoints are EVENT-DRIVEN: they happen whenever a meaningful event
 * boundary is observed, INDEPENDENT of whether the C10 completion flow
 * succeeded. A checkpoint failure NEVER blocks execution.
 */
export function checkpointMycEvaluation(
	sessionId: string,
	options: { readonly usefulnessGroundTruth?: MycEvaluationUsefulnessGroundTruth } = {},
): void {
	if (!isMycEvaluationCaptureEnabled()) return
	checkpointMycEvaluationSession(sessionId, {
		buildSummary: (events, accounting) =>
			buildMycEvaluationSummary({
				sessionId,
				events,
				...accountingToReportInput(accounting),
				...(options.usefulnessGroundTruth ? { usefulnessGroundTruth: options.usefulnessGroundTruth } : {}),
			}),
		buildReport: (summary) => buildMycEvaluationReport(summary as ReturnType<typeof buildMycEvaluationSummary>),
	})
}

function accountingToReportInput(accounting: {
	observedCount: number
	droppedCount: number
	droppedWriteCount: number
	writeFailureCount: number
}): {
	observedCount: number
	droppedEventCount: number
	droppedWriteCount: number
	writeFailureCount: number
} {
	return {
		observedCount: accounting.observedCount,
		droppedEventCount: accounting.droppedCount,
		droppedWriteCount: accounting.droppedWriteCount,
		writeFailureCount: accounting.writeFailureCount,
	}
}
