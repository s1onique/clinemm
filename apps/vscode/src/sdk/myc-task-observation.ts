/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — pure observation helpers
 * that convert MCP completion events into per-task `TaskTelemetryTracker`
 * increments.
 *
 * CORRECTION01 (this revision): the previous `observeMycToolStart`
 * helper was wired to the pre-execution `onToolStarted` seam and
 * always passed outcome `"success"` — it counted an attack as
 * successful before the tool had completed. That was a wrong-capture-
 * boundary defect: the wire read `myc 1/1` for a `myc_recall` that
 * later errored. CORRECTION01 moves outcome-aware accounting to the
 * real MCP completion seam (`McpHub.callTool` post-resolution
 * `success`/`error` branch, exposed via `setMcpToolObserver`). The
 * pre-execution `onToolStarted` hook is now a NO-OP for the tracker
 * (`observeMycToolStart` exists only for backward-compatibility shim
 * purposes and never increments counters — see below).
 *
 * Cardinality invariant (ACT §17, CORRECTION01): ONE MCP tool call ⇒
 * EXACTLY ONE `recordMycToolCall` event, fired from the McpHub
 * completion observer. The pre-execution hook is not a second
 * counter. The prime-specific helper (`observeMycPrimeResult`) is
 * the canonical path for the automatic-prime MCP call because the
 * prime helper itself drives the call (and knows the latency and the
 * semantic outcome `ok`/`empty`/`failed`/`skipped`). For non-prime
 * myc calls (`myc_recall`, `myc_remember`, etc.) the McpHub observer
 * fires the outcome.
 *
 * Privacy: only `serverName`, `toolName`, and bounded outcome are
 * read. Argument values, response bodies, error messages never cross
 * the helper boundary. No network emission.
 */
import type { MycPrimeResult } from "./myc-prime-automation"
import type { TaskTelemetryTracker } from "./task-telemetry-tracker"

const MYC_TOOL_PREFIX = "myc_"

/**
 * Boundary shim. Returns `true` when the toolName is a myc tool,
 * `false` otherwise. NEVER increments the tracker. The caller can
 * use the return value for routing the post-execution event back
 * to the tracker. The McpHub completion observer is the canonical
 * seam — see `observeMcpToolCompletion`.
 */
export function isMycToolName(toolName: string | undefined): boolean {
	return typeof toolName === "string" && toolName.startsWith(MYC_TOOL_PREFIX)
}

/**
 * Outcome shape consumed by `observeMcpToolCompletion`. Mirrors
 * the `McpHub` completion observer payload exactly. `latencyMs`
 * is optional: when the caller cannot supply a latency (e.g. the
 * McpHub observer does not record a start timestamp), the tracker
 * records no latency.
 */
export interface McpToolCompletion {
	readonly toolName: string
	readonly outcome: "success" | "error"
	readonly latencyMs?: number
}

/**
 * Map an McpHub completion event into a per-task tracker increment.
 * ONLY called for myc_-prefixed tools — the McpHub observer slot is
 * host-scoped and routes ALL completions through `isMycToolName` to
 * decide whether to feed the tracker. Non-myc tools pass through
 * (no increment).
 *
 * `useful` defaults to `false` because the McpHub completion event
 * does not carry the response body (privacy boundary). The
 * automatic-prime path (which knows `result.text` length) is the
 * only call site that can set `useful=true` via
 * `observeMycPrimeResult`.
 */
export function observeMcpToolCompletion(tracker: TaskTelemetryTracker, event: McpToolCompletion, useful: boolean = false): void {
	if (!isMycToolName(event.toolName)) {
		return
	}
	tracker.recordMycToolCall("myc", event.toolName, event.outcome === "success" ? "success" : "error", event.latencyMs, useful)
}
/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — record the canonical
 * `MycPrimeResult` outcome into the per-task tracker. ONE prime ⇒
 * ONE call to `recordMycToolCall` plus ONE call to
 * `recordMycPrimeStatus`. Cardinality invariant (ACT §17,
 * CORRECTION01).
 *
 * `ts` (the prime's recorded timestamp) and `now` (the wall clock at
 * the moment we feed the tracker) yield the latency. Both MUST be
 * numbers; non-finite values are clamped to 0.
 *
 * CORRECTION01 (skipped semantics): the previous mapping of
 * `skipped` to `empty`/`success` incremented `callsSuccessful` for a
 * skipped prime (no actual MCP call occurred — `resolveMycServerName`
 * returned undefined and the helper short-circuited). That let the
 * wire read `myc 1/1` for a task where NO call happened. CORRECTION01
 * routes `skipped` exclusively through `recordMycPrimeStatus`; no
 * `recordMycToolCall` event is fired (because the underlying MCP
 * call was not made — there is no completion seam to feed). The
 * `myc N/N` compact form continues to count `callsSuccessful ===
 * callsTotal === actual completed myc MCP calls`, never short-
 * circuit skips. The `automaticPrime.status="skipped"` field
 * carries the skip semantics separately.
 */
export function observeMycPrimeResult(tracker: TaskTelemetryTracker, result: MycPrimeResult, now: number = Date.now()): void {
	// "skipped" = no myc server configured (no MCP call was made at
	// all). Record ONLY the prime status; do NOT increment any
	// call-counter (no completion seam happened).
	if (result.status === "skipped") {
		tracker.recordMycPrimeStatus("skipped")
		return
	}
	// Latency: clamp to 0 if ts is non-finite OR in the future
	// (clock skew safety). 0 is a valid latency observation.
	const latencyMs = typeof result.ts === "number" && Number.isFinite(result.ts) ? Math.max(0, now - result.ts) : 0
	const isFailure = result.status === "failed"
	const isUseful = result.status === "ok" && Boolean(result.text && result.text.length > 0)
	const outcome: "success" | "empty" | "error" = isFailure ? "error" : isUseful ? "success" : "empty"
	tracker.recordMycToolCall("myc", "myc_prime", outcome, latencyMs, isUseful)
	tracker.recordMycPrimeStatus(result.status)
}
