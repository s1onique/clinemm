/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — pure observation helpers
 * that convert MCP completion events into per-task `TaskTelemetryTracker`
 * increments.
 *
 * CORRECTION01: the previous `observeMycToolStart` helper was wired
 * to the pre-execution `onToolStarted` seam and always passed
 * outcome `"success"` — it counted an attack as successful before
 * the tool had completed. CORRECTION01 moved outcome-aware
 * accounting to the real MCP completion seam (`McpHub.callTool`
 * post-resolution branch, exposed via `setMcpToolObserver`).
 *
 * CORRECTION02 (this revision): McpHub is the SINGLE cardinality
 * owner for every actual MCP call, including automatic prime.
 * Previously `observeMycPrimeResult` also called
 * `recordMycToolCall("myc", "myc_prime", ...)` — that produced
 * exactly the double-count the reviewer flagged (one real prime
 * ⇒ two tracker increments). Now:
 *
 *   - `observeMcpToolCompletion` is the sole entry point that
 *     calls `recordMycToolCall`. The McpHub observer fires once
 *     per `callTool()` resolution, with `outcome` classified by
 *     MCP semantics (CORRECTION02 §1: `isError === true` ⇒
 *     `outcome="error"`) and `hasNonEmptyContent` derived from the
 *     bounded `content.length > 0 || structuredContent
 *     non-empty` rule.
 *   - `observeMycPrimeResult` updates ONLY the prime-specific
 *     state (`automaticPrime.status` + `automaticPrime.attempted`).
 *     It NEVER calls `recordMycToolCall`. The prime's call MCP
 *     counter increment flows exclusively through the McpHub
 *     observer when the prime actually made the underlying call.
 *   - `skipped` (no myc server configured → no `callTool`
 *     happened) only updates the prime status. The compact
 *     form `myc S/T` therefore continues to read correctly.
 *
 * Cardinality invariant (CORRECTION02): ONE real MCP tool call
 * (including automatic prime) ⇒ EXACTLY ONE `recordMycToolCall`
 * event, fired from the McpHub completion observer. The
 * prime-specific helper is no longer a second counter.
 *
 * Privacy: only `serverName`, `toolName`, bounded outcome, and the
 * bounded `hasNonEmptyContent` boolean cross the helper boundary.
 * Argument values, response bodies, error messages never do. No
 * network emission.
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
 * the `McpHub` completion observer payload (CORRECTION02).
 *
 * `outcome`:
 *   - `"success"` — protocol resolved, `isError !== true`, content non-empty
 *   - `"empty"`   — protocol resolved, `isError !== true`, content empty
 *   - `"error"`   — protocol resolved with `isError: true` OR transport threw
 *
 * `hasNonEmptyContent` is a bounded privacy-safe boolean (no
 * response text crosses the helper boundary). For retrieval-like
 * myc tools it determines whether `usefulRetrievals` increments.
 *
 * `latencyMs` is optional: the McpHub observer does not record a
 * start timestamp, so the tracker records no latency at the
 * completion seam. The prime-specific helper may supply it when
 * known.
 */
export interface McpToolCompletion {
	readonly toolName: string
	readonly outcome: "success" | "empty" | "error"
	readonly hasNonEmptyContent: boolean
	readonly latencyMs?: number
}

/**
 * Map an McpHub completion event into a per-task tracker increment.
 * ONLY called for myc_-prefixed tools — the McpHub observer slot
 * is host-scoped and routes ALL completions through
 * `isMycToolName` to decide whether to feed the tracker. Non-myc
 * tools pass through (no increment).
 *
 * Useful-retrieval gate (CORRECTION02):
 *   - The retrieval call counter (`retrievalCalls`) increments
 *     for retrieval-like ops (`myc_prime` / `myc_recall` /
 *     `myc_ready`) regardless of outcome.
 *   - The useful-retrieval counter (`usefulRetrievals`) increments
 *     ONLY when the call succeeded AND returned non-empty
 *     content (i.e. `outcome === "success"` AND
 *     `hasNonEmptyContent === true`). The observer's
 *     `hasNonEmptyContent` is the load-bearing signal — it carries
 *     the privacy-safe "did the model get useful rows?" answer
 *     without ever exposing the response body.
 *
 * Latency is optional; non-finite values are filtered by
 * `recordMycToolCall`.
 */
export function observeMcpToolCompletion(tracker: TaskTelemetryTracker, event: McpToolCompletion): void {
	if (!isMycToolName(event.toolName)) {
		return
	}
	// Useful: success AND hasNonEmptyContent. Errors and empties
	// are never useful even if they returned an "error body" with
	// content — the user's "useful recall" means a real retrieval
	// returned real rows.
	const useful = event.outcome === "success" && event.hasNonEmptyContent === true
	tracker.recordMycToolCall("myc", event.toolName, event.outcome, event.latencyMs, useful)
}
/**
 * ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 — record the canonical
 * `MycPrimeResult` outcome into the per-task tracker.
 *
 * CORRECTION02 (this revision): this helper updates ONLY the
 * prime-specific state (`automaticPrime.status` +
 * `automaticPrime.attempted`). It does NOT call
 * `recordMycToolCall`. The prime's MCP call counter increment
 * flows exclusively through the McpHub completion observer when
 * the prime helper actually invokes `mcpHub.callTool(...)`.
 * That single-source-of-truth invariant is what makes the wire
 * read `myc 1/1` (not `myc 2/2`) for a single real prime.
 *
 * `ts` is preserved on the call site for telemetry that may
 * surface in MYC03 forensic diagnostics; it is NOT used here for
 * the wire counter (latency follows the McpHub observer seam).
 *
 * Skipped semantics (preserved from CORRECTION01): `skipped`
 * means no myc server was configured and no MCP call was made.
 * Only the prime status flips; nothing else moves. The compact
 * `myc S/T` form therefore continues to count actual
 * completed myc MCP calls (never short-circuit skips).
 */
export function observeMycPrimeResult(tracker: TaskTelemetryTracker, result: MycPrimeResult): void {
	tracker.recordMycPrimeStatus(result.status)
}
