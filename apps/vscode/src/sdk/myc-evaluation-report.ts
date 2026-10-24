/**
 * ACT-CLINEMM-MYC-REAL-WORKFLOW-AUTOCAPTURE01 — automatic evaluation
 * report builder.
 *
 * The report is generated FROM THE OBSERVED EVENTS plus INDEPENDENTLY
 * ESTABLISHED GROUND TRUTH. It never infers usefulness from a nonempty
 * response.
 *
 * Report sections (ACT §5):
 *   - Prime acquisition / injection cardinality.
 *   - MCP calls, outcomes, and latency.
 *   - Memory / context byte overhead.
 *   - Duplicate retrievals.
 *   - Task lifecycle and continuation.
 *   - Sequential session recovery.
 *   - Compaction events when naturally observed.
 *   - Evidence gaps and capture completeness.
 *
 * Each retrieval is classified SEPARATELY on the four-step ladder:
 *
 *   1. `CONTENT_RETURNED`
 *   2. `MODEL_CONTEXT_DELIVERED`
 *   3. `USEFULNESS_PROVEN`
 *   4. `USEFULNESS_NOT_ASSESSABLE`
 *
 * `USEFULNESS_PROVEN` requires INDEPENDENT ground truth (a supplied
 * `usefulnessGroundTruth` map). Without ground truth a retrieval is
 * `USEFULNESS_NOT_ASSESSABLE` -- a nonempty MCP response is NOT
 * automatically a useful retrieval.
 */

import type { MycEvaluationEvent, MycEvaluationResultClass, MycEvaluationRetrievalClass } from "./myc-evaluation-capture"

/**
 * Independently established ground truth for a retrieval.
 *
 * Keyed by the retrieval's `callId`. The value is the independently
 * established verdict -- NEVER derived from the MCP response body.
 */
export type MycEvaluationUsefulnessGroundTruth = ReadonlyMap<string, boolean>

/**
 * One classified retrieval in the report.
 */
export interface MycEvaluationRetrievalRow {
	readonly callId: string
	readonly toolName: string
	readonly contentReturned: boolean
	readonly modelContextDelivered: boolean
	readonly usefulness: MycEvaluationRetrievalClass
	readonly resultClass: MycEvaluationResultClass
	readonly durationMs?: number
	readonly outputBytes?: number
}

/**
 * The machine-readable summary of one session bundle.
 */
export interface MycEvaluationSummary {
	readonly sessionId: string
	readonly generatedAt: string
	readonly sourceHead?: string
	readonly mycSessionIds: readonly string[]
	readonly taskIds: readonly string[]
	readonly eventCounts: Readonly<Record<string, number>>
	readonly primeAcquisitionCount: number
	readonly primeInjectionCount: number
	readonly primeModelContextDeliveryCount: number
	readonly mcpCallCount: number
	readonly mcpOutcomeCounts: Readonly<Record<string, number>>
	readonly mcpLatencyMs: {
		readonly count: number
		readonly total: number
		readonly min: number
		readonly max: number
		readonly mean: number
	}
	readonly memoryBytesOverhead: {
		readonly primePacketBytes: number
		readonly mcpOutputBytes: number
		readonly modelPacketBytes: number
	}
	readonly duplicateRetrievals: readonly { readonly toolName: string; readonly count: number }[]
	readonly taskLifecycle: {
		readonly started: number
		readonly ended: number
		readonly continued: boolean
	}
	readonly sessionLifecycle: {
		readonly started: number
		readonly replaced: number
		readonly ended: number
	}
	readonly compactionEvents: number
	readonly retrievals: readonly MycEvaluationRetrievalRow[]
	readonly captureCompleteness: {
		readonly observedCount: number
		readonly droppedEventCount: number
		readonly droppedWriteCount: number
		readonly writeFailureCount: number
		readonly complete: boolean
	}
	readonly evidenceGaps: readonly string[]
}

/**
 * Input to the report builder. `events` are the OBSERVED events;
 * `usefulnessGroundTruth` is the INDEPENDENTLY established ground truth.
 */
export interface MycEvaluationReportInput {
	readonly sessionId: string
	readonly events: readonly MycEvaluationEvent[]
	readonly usefulnessGroundTruth?: MycEvaluationUsefulnessGroundTruth
	readonly observedCount?: number
	readonly droppedEventCount?: number
	readonly droppedWriteCount?: number
	readonly writeFailureCount?: number
	readonly generatedAt?: string
}

function countBy(values: readonly string[]): Record<string, number> {
	const out: Record<string, number> = {}
	for (const value of values) {
		out[value] = (out[value] ?? 0) + 1
	}
	return out
}

function uniqueSorted(values: readonly string[]): string[] {
	return Array.from(new Set(values)).sort()
}

function sum(values: readonly (number | undefined)[]): number {
	let total = 0
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) {
			total += value
		}
	}
	return total
}

/**
 * Classify ONE retrieval.
 *
 * The classification is the HIGHEST rung of the ACT §5 ladder that the
 * retrieval reached:
 *
 *   - `USEFULNESS_PROVEN` requires INDEPENDENT ground truth for the call.
 *     Without it, usefulness is NOT assessable — a nonempty response is
 *     NEVER automatically useful.
 *   - `MODEL_CONTEXT_DELIVERED` requires an OBSERVED model-context
 *     delivery event correlated to the same call (the content actually
 *     reached the model).
 *   - `CONTENT_RETURNED` requires an observable successful, non-empty MCP
 *     completion.
 *   - `USEFULNESS_NOT_ASSESSABLE` is the FLOOR: usefulness could not be
 *     established (no independent ground truth was supplied), regardless
 *     of whether content was returned.
 */
export function classifyRetrieval(input: {
	readonly contentReturned: boolean
	readonly modelContextDelivered: boolean
	readonly usefulnessProven: boolean
	readonly usefulnessAssessable: boolean
}): MycEvaluationRetrievalClass {
	if (input.usefulnessProven) return "USEFULNESS_PROVEN"
	if (!input.usefulnessAssessable) return "USEFULNESS_NOT_ASSESSABLE"
	if (input.modelContextDelivered) return "MODEL_CONTEXT_DELIVERED"
	return "CONTENT_RETURNED"
}

/**
 * Build the classified retrieval rows.
 *
 * A retrieval is an observed MCP completion. The model-context delivery is
 * a SEPARATE observation that is correlated by `callId` — the two are
 * never conflated.
 */
function buildRetrievalRows(
	events: readonly MycEvaluationEvent[],
	groundTruth: MycEvaluationUsefulnessGroundTruth | undefined,
): MycEvaluationRetrievalRow[] {
	const deliveredCallIds = new Set(
		events
			.filter((e) => e.eventType === "prime_model_context_delivery" || e.eventType === "model_packet_delivered")
			.map((e) => e.callId)
			.filter((v): v is string => typeof v === "string" && v.length > 0),
	)
	const rows: MycEvaluationRetrievalRow[] = []
	for (const event of events) {
		if (event.eventType !== "mcp_call_completed") continue
		const callId = event.callId ?? event.eventId
		const contentReturned = event.resultClass === "success"
		const modelContextDelivered = deliveredCallIds.has(callId)
		// Usefulness is assessable ONLY when the caller supplied
		// INDEPENDENT ground truth for this call. Without it, the
		// usefulness rung is NOT assessable — a nonempty response is
		// never automatically a useful retrieval.
		const hasGroundTruth = groundTruth?.has(callId) === true
		const usefulnessProven = groundTruth?.get(callId) === true
		rows.push({
			callId,
			toolName: event.toolName ?? "unknown",
			contentReturned,
			modelContextDelivered,
			usefulness: classifyRetrieval({
				contentReturned,
				modelContextDelivered,
				usefulnessProven,
				usefulnessAssessable: hasGroundTruth,
			}),
			resultClass: event.resultClass ?? "unknown",
			durationMs: event.durationMs,
			outputBytes: event.outputBytes,
		})
	}
	return rows
}

/**
 * Identify duplicate retrievals: the same tool invoked more than once
 * within the session. A duplicate is a RETRIEVAL FACT, not a verdict —
 * whether the duplicate was harmful is not inferable from metadata alone.
 */
function buildDuplicateRetrievals(mcpEvents: readonly MycEvaluationEvent[]): { toolName: string; count: number }[] {
	const counts = new Map<string, number>()
	for (const event of mcpEvents) {
		const toolName = event.toolName ?? "unknown"
		counts.set(toolName, (counts.get(toolName) ?? 0) + 1)
	}
	return Array.from(counts.entries())
		.filter(([, count]) => count > 1)
		.map(([toolName, count]) => ({ toolName, count }))
		.sort((a, b) => (a.toolName < b.toolName ? -1 : a.toolName > b.toolName ? 1 : 0))
}

/**
 * Build the machine-readable summary for one session bundle.
 */
export function buildMycEvaluationSummary(input: MycEvaluationReportInput): MycEvaluationSummary {
	const events = input.events
	const eventCounts = countBy(events.map((e) => e.eventType as string))
	const mycSessionIds = uniqueSorted(
		events.map((e) => e.mycSessionId).filter((v): v is string => typeof v === "string" && v.length > 0),
	)
	const taskIds = uniqueSorted(events.map((e) => e.taskId).filter((v): v is string => typeof v === "string" && v.length > 0))
	const sourceHead = events.find((e) => typeof e.sourceHead === "string")?.sourceHead

	const primeAcquisitionCount = events.filter((e) => e.eventType === "prime_acquisition").length
	const primeInjectionCount = events.filter((e) => e.eventType === "prime_injection").length
	const primeModelContextDeliveryCount = events.filter((e) => e.eventType === "prime_model_context_delivery").length

	const mcpEvents = events.filter((e) => e.eventType === "mcp_call_completed")
	const mcpOutcomeCounts = countBy(mcpEvents.map((e) => (e.resultClass ?? "unknown") as string))
	const latencies = mcpEvents.map((e) => e.durationMs).filter((v): v is number => typeof v === "number" && Number.isFinite(v))
	const mcpLatencyMs =
		latencies.length === 0
			? { count: 0, total: 0, min: 0, max: 0, mean: 0 }
			: {
					count: latencies.length,
					total: latencies.reduce((a, b) => a + b, 0),
					min: Math.min(...latencies),
					max: Math.max(...latencies),
					mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
				}

	const primePacketBytes = sum(events.filter((e) => e.eventType === "prime_injection").map((e) => e.outputBytes))
	const mcpOutputBytes = sum(mcpEvents.map((e) => e.outputBytes))
	const modelPacketBytes = sum(events.filter((e) => e.eventType === "prime_model_context_delivery").map((e) => e.outputBytes))

	const duplicateRetrievals = buildDuplicateRetrievals(mcpEvents)

	const taskStarted = events.filter((e) => e.eventType === "task_started").length
	const taskEnded = events.filter((e) => e.eventType === "task_ended").length
	const sessionStarted = events.filter((e) => e.eventType === "session_start").length
	const sessionReplaced = events.filter((e) => e.eventType === "session_replace").length
	const sessionEnded = events.filter((e) => e.eventType === "session_end").length
	const compactionEvents = events.filter(
		(e) => e.eventType === "compaction_started" || e.eventType === "compaction_completed",
	).length

	const retrievals = buildRetrievalRows(events, input.usefulnessGroundTruth)

	const observedCount = input.observedCount ?? events.length
	const droppedEventCount = input.droppedEventCount ?? 0
	const droppedWriteCount = input.droppedWriteCount ?? 0
	const writeFailureCount = input.writeFailureCount ?? 0

	const evidenceGaps: string[] = []
	if (droppedEventCount > 0) {
		evidenceGaps.push(`${droppedEventCount} event(s) dropped by the per-session retention bound`)
	}
	if (droppedWriteCount > 0) {
		evidenceGaps.push(`${droppedWriteCount} event write(s) dropped by the pending-write bound`)
	}
	if (writeFailureCount > 0) {
		evidenceGaps.push(`${writeFailureCount} event write(s) failed`)
	}
	if (mcpEvents.length === 0) {
		evidenceGaps.push("no MCP completion was observed in this bundle")
	}
	if (primeAcquisitionCount === 0) {
		evidenceGaps.push("no prime acquisition was observed in this bundle")
	}
	if (sessionEnded === 0) {
		evidenceGaps.push("no session end was observed (the session may have been interrupted)")
	}
	if (compactionEvents === 0) {
		evidenceGaps.push("no compaction was naturally observed in this bundle")
	}
	if (retrievals.length > 0 && !input.usefulnessGroundTruth) {
		evidenceGaps.push("usefulness was NOT assessable: no independent ground truth was supplied")
	}

	return {
		sessionId: input.sessionId,
		generatedAt: input.generatedAt ?? new Date().toISOString(),
		sourceHead,
		mycSessionIds,
		taskIds,
		eventCounts,
		primeAcquisitionCount,
		primeInjectionCount,
		primeModelContextDeliveryCount,
		mcpCallCount: mcpEvents.length,
		mcpOutcomeCounts,
		mcpLatencyMs,
		memoryBytesOverhead: { primePacketBytes, mcpOutputBytes, modelPacketBytes },
		duplicateRetrievals,
		taskLifecycle: {
			started: taskStarted,
			ended: taskEnded,
			continued: taskStarted > taskEnded,
		},
		sessionLifecycle: {
			started: sessionStarted,
			replaced: sessionReplaced,
			ended: sessionEnded,
		},
		compactionEvents,
		retrievals,
		captureCompleteness: {
			observedCount,
			droppedEventCount,
			droppedWriteCount,
			writeFailureCount,
			complete: droppedEventCount === 0 && droppedWriteCount === 0 && writeFailureCount === 0,
		},
		evidenceGaps,
	}
}

/**
 * Build the human-readable evaluation report (markdown).
 */
export function buildMycEvaluationReport(summary: MycEvaluationSummary): string {
	const lines: string[] = []
	lines.push(`# myc evaluation — ${summary.sessionId}`)
	lines.push("")
	lines.push(`- Generated: ${summary.generatedAt}`)
	if (summary.sourceHead) {
		lines.push(`- Source HEAD: ${summary.sourceHead}`)
	}
	if (summary.mycSessionIds.length > 0) {
		lines.push(`- myc session ids: ${summary.mycSessionIds.join(", ")}`)
	}
	if (summary.taskIds.length > 0) {
		lines.push(`- task ids: ${summary.taskIds.join(", ")}`)
	}
	lines.push("")

	lines.push("## Prime acquisition / injection cardinality")
	lines.push("")
	lines.push(`- Prime acquisitions observed: ${summary.primeAcquisitionCount}`)
	lines.push(`- Prime injections observed: ${summary.primeInjectionCount}`)
	lines.push(`- Prime model-context deliveries observed: ${summary.primeModelContextDeliveryCount}`)
	lines.push("")

	lines.push("## MCP calls, outcomes, and latency")
	lines.push("")
	lines.push(`- MCP completions observed: ${summary.mcpCallCount}`)
	for (const [outcome, count] of Object.entries(summary.mcpOutcomeCounts).sort()) {
		lines.push(`  - ${outcome}: ${count}`)
	}
	const latency = summary.mcpLatencyMs
	lines.push(
		`- Latency (ms): count=${latency.count} total=${Math.round(latency.total)} min=${Math.round(latency.min)} max=${Math.round(latency.max)} mean=${Math.round(latency.mean)}`,
	)
	lines.push("")

	lines.push("## Memory / context byte overhead")
	lines.push("")
	lines.push(`- Prime packet bytes: ${summary.memoryBytesOverhead.primePacketBytes}`)
	lines.push(`- MCP output bytes: ${summary.memoryBytesOverhead.mcpOutputBytes}`)
	lines.push(`- Model packet bytes: ${summary.memoryBytesOverhead.modelPacketBytes}`)
	lines.push("")

	lines.push("## Duplicate retrievals")
	lines.push("")
	if (summary.duplicateRetrievals.length === 0) {
		lines.push("- None observed.")
	} else {
		for (const dup of summary.duplicateRetrievals) {
			lines.push(`- ${dup.toolName}: ${dup.count} call(s)`)
		}
	}
	lines.push("")

	lines.push("## Task lifecycle and continuation")
	lines.push("")
	lines.push(`- Tasks started: ${summary.taskLifecycle.started}`)
	lines.push(`- Tasks ended: ${summary.taskLifecycle.ended}`)
	lines.push(`- Continuation observed: ${summary.taskLifecycle.continued ? "yes" : "no"}`)
	lines.push("")

	lines.push("## Session lifecycle")
	lines.push("")
	lines.push(`- Session starts: ${summary.sessionLifecycle.started}`)
	lines.push(`- Session replacements: ${summary.sessionLifecycle.replaced}`)
	lines.push(`- Session ends: ${summary.sessionLifecycle.ended}`)
	lines.push("")

	lines.push("## Compaction")
	lines.push("")
	lines.push(`- Compaction events observed: ${summary.compactionEvents}`)
	lines.push("")

	lines.push("## Retrievals")
	lines.push("")
	if (summary.retrievals.length === 0) {
		lines.push("- No retrieval was observed.")
	} else {
		lines.push("| callId | tool | result | content | model-context | usefulness |")
		lines.push("|---|---|---|---|---|---|")
		for (const row of summary.retrievals) {
			lines.push(
				`| ${row.callId} | ${row.toolName} | ${row.resultClass} | ${row.contentReturned ? "yes" : "no"} | ${row.modelContextDelivered ? "yes" : "no"} | ${row.usefulness} |`,
			)
		}
	}
	lines.push("")

	lines.push("## Evidence gaps and capture completeness")
	lines.push("")
	const completeness = summary.captureCompleteness
	lines.push(`- Observed events: ${completeness.observedCount}`)
	lines.push(`- Dropped events: ${completeness.droppedEventCount}`)
	lines.push(`- Dropped writes: ${completeness.droppedWriteCount}`)
	lines.push(`- Failed writes: ${completeness.writeFailureCount}`)
	lines.push(`- Capture complete: ${completeness.complete ? "yes" : "no"}`)
	if (summary.evidenceGaps.length === 0) {
		lines.push("- No evidence gaps were detected.")
	} else {
		for (const gap of summary.evidenceGaps) {
			lines.push(`- ${gap}`)
		}
	}
	lines.push("")
	return lines.join("\n")
}
